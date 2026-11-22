import type {
	ImportDryRunBody,
	ImportDryRunPreviewDto,
	ImportExecuteBody,
	ImportJobDto,
	ImportRedirectResponse
} from '@huriro/contracts'
import type { Queryable } from '@huriro/db'
import type { ActorContext } from '@huriro/domain'
import { appendChange } from '../../api/changelog'
import { HttpError } from '../../api/error'
import {
	createIssue,
	createIssueComment,
	ensureLabelForImport,
	ensureProjectForImport,
	getIssueByIdForRedirect
} from '../tasks'
import { listWorkspaceMembers } from '../tenancy'
import { IMPORTS_EVENTS } from './events'
import { fetchGithubRepoPayload, normalizeGithubPayload } from './github'
import { fetchLinearTeamPayload, type NormalizedImportDataset, normalizeLinearPayload } from './linear'
import { authorizeImportRun } from './policy'
import {
	findMappedRemoteIds,
	findMappingByRemoteIdentifier,
	getImportJobById,
	insertImportJobRow,
	insertImportMapping,
	listImportJobsForWorkspace,
	markImportJobCompleted
} from './repo'

async function resolveNormalizedDataset(input: {
	readonly source: 'linear' | 'github'
	readonly linear?: ImportDryRunBody['linear'] | undefined
	readonly github?: ImportDryRunBody['github'] | undefined
	readonly apiToken?: string | undefined
	readonly teamKey?: string | undefined
	readonly repo?: string | undefined
}): Promise<NormalizedImportDataset> {
	if (input.source === 'linear') {
		if (input.linear) return normalizeLinearPayload(input.linear)
		if (input.apiToken && input.teamKey) {
			const payload = await fetchLinearTeamPayload(input.apiToken, input.teamKey)
			return normalizeLinearPayload(payload)
		}
		throw new HttpError(422, 'validation_failed', 'Provide either linear payload or apiToken + teamKey')
	}

	if (input.github) return normalizeGithubPayload(input.github)
	if (input.apiToken && input.repo) {
		const payload = await fetchGithubRepoPayload(input.apiToken, input.repo)
		return normalizeGithubPayload(payload)
	}
	throw new HttpError(422, 'validation_failed', 'Provide either github payload or apiToken + repo')
}

export async function dryRunImport(
	tx: Queryable,
	actor: ActorContext,
	body: ImportDryRunBody
): Promise<ImportDryRunPreviewDto> {
	authorizeImportRun(actor)

	const dataset = await resolveNormalizedDataset({
		source: body.source,
		linear: body.linear,
		github: body.github,
		apiToken: body.apiToken,
		teamKey: body.teamKey,
		repo: body.repo
	})

	const members = await listWorkspaceMembers(tx, actor.workspaceId)
	const memberByEmail = new Map(members.map((m) => [m.email.toLowerCase(), m.userId]))
	const existingIssues = await findMappedRemoteIds(tx, actor.workspaceId, dataset.source, 'issue')

	let commentCount = 0
	let skippedExisting = 0
	const labelSet = new Set<string>()
	const userMap = new Map<string, string | null>()

	for (const issue of dataset.issues) {
		if (existingIssues.has(issue.remoteId)) skippedExisting++
		commentCount += issue.comments.length
		for (const l of issue.labels) labelSet.add(l)
		if (issue.assigneeEmail && !userMap.has(issue.assigneeEmail)) {
			userMap.set(issue.assigneeEmail, memberByEmail.get(issue.assigneeEmail) ?? null)
		}
	}

	const userMappings = [...userMap.entries()].map(([remoteIdentifier, matchedUserId]) => ({
		remoteIdentifier,
		matchedUserId
	}))

	// Never persist apiToken in config (§4.2).
	const safeConfig: Record<string, unknown> = {
		source: dataset.source,
		projectKey: dataset.projectKey,
		projectName: dataset.projectName,
		...(dataset.source === 'linear'
			? {
					linear: body.linear ?? {
						projectKey: dataset.projectKey,
						projectName: dataset.projectName,
						issues: []
					}
				}
			: {
					github: body.github ?? {
						repo: body.repo ?? dataset.projectName,
						projectKey: dataset.projectKey,
						projectName: dataset.projectName,
						issues: []
					}
				})
	}

	const previewPayload = {
		source: dataset.source,
		projectKey: dataset.projectKey,
		projectName: dataset.projectName,
		counts: {
			issues: dataset.issues.length,
			comments: commentCount,
			labels: labelSet.size,
			skippedExisting
		},
		userMappings,
		unmappedFields: [...dataset.unmappedFields]
	}

	const job = await insertImportJobRow(tx, {
		workspaceId: actor.workspaceId,
		source: dataset.source,
		status: 'dry_run',
		targetProjectId: body.targetProjectId ?? null,
		createdBy: actor.principalId,
		config: safeConfig,
		preview: previewPayload
	})

	await tx`
		INSERT INTO outbox (workspace_id, aggregate, aggregate_id, event_type, payload)
		VALUES (
			${actor.workspaceId},
			'import_job',
			${job.id},
			${IMPORTS_EVENTS.DryRunCreated},
			${tx.json({ jobId: job.id, source: dataset.source, counts: previewPayload.counts } as never)}
		)
	`

	return { jobId: job.id, ...previewPayload }
}

export async function executeImport(
	tx: Queryable,
	actor: ActorContext,
	body: ImportExecuteBody
): Promise<{ readonly job: ImportJobDto; readonly cursor: number }> {
	authorizeImportRun(actor)

	let existingJob: (ImportJobDto & { config: Record<string, unknown> }) | null = null
	if (body.jobId) {
		existingJob = await getImportJobById(tx, actor.workspaceId, body.jobId)
		if (!existingJob) throw new HttpError(404, 'not_found', 'Import job not found')
	}

	const source = body.source ?? existingJob?.source
	if (!source) throw new HttpError(422, 'validation_failed', 'Import source is required')

	const linearInput = body.linear ?? (existingJob?.config['linear'] as ImportDryRunBody['linear'] | undefined)
	const githubInput = body.github ?? (existingJob?.config['github'] as ImportDryRunBody['github'] | undefined)

	const dataset = await resolveNormalizedDataset({
		source,
		linear: linearInput,
		github: githubInput,
		apiToken: body.apiToken,
		teamKey: body.teamKey,
		repo: body.repo
	})

	const job =
		existingJob ??
		(await insertImportJobRow(tx, {
			workspaceId: actor.workspaceId,
			source,
			status: 'running',
			targetProjectId: body.targetProjectId ?? null,
			createdBy: actor.principalId,
			config: { source, projectKey: dataset.projectKey, projectName: dataset.projectName },
			preview: { issues: dataset.issues.length }
		}))

	const { project, statuses } = await ensureProjectForImport(tx, actor, {
		targetProjectId: body.targetProjectId ?? job.targetProjectId ?? undefined,
		key: dataset.projectKey,
		name: dataset.projectName
	})

	const statusByCategory = new Map(statuses.map((s) => [s.category, s.id]))
	const statusByName = new Map(statuses.map((s) => [s.name.toLowerCase(), s.id]))
	const defaultStatusId = statuses.find((s) => s.isDefault)?.id ?? statuses[0]?.id
	if (!defaultStatusId) {
		throw new HttpError(422, 'validation_failed', 'Target project has no statuses')
	}

	const members = await listWorkspaceMembers(tx, actor.workspaceId)
	const memberByEmail = new Map(members.map((m) => [m.email.toLowerCase(), m.userId]))
	const existingIssues = await findMappedRemoteIds(tx, actor.workspaceId, source, 'issue')
	const existingComments = await findMappedRemoteIds(tx, actor.workspaceId, source, 'comment')

	const labelIdCache = new Map<string, string>()
	let importedIssues = 0
	let skippedIssues = 0
	let importedComments = 0
	const redirects: { remoteIdentifier: string; localIdentifier: string; issueId: string }[] = []

	for (const issue of dataset.issues) {
		let localIssueId = existingIssues.get(issue.remoteId)
		if (localIssueId) {
			skippedIssues++
		} else {
			const labelIds: string[] = []
			for (const lblName of issue.labels) {
				let lblId = labelIdCache.get(lblName.toLowerCase())
				if (!lblId) {
					const ensured = await ensureLabelForImport(tx, actor, lblName)
					lblId = ensured.id
					labelIdCache.set(lblName.toLowerCase(), lblId)
				}
				labelIds.push(lblId)
			}

			const statusId =
				(issue.statusName ? statusByName.get(issue.statusName.toLowerCase()) : undefined) ??
				statusByCategory.get(issue.statusCategory) ??
				defaultStatusId
			const assigneeId = issue.assigneeEmail ? (memberByEmail.get(issue.assigneeEmail) ?? null) : null

			const created = await createIssue(
				tx,
				actor,
				{
					projectId: project.id,
					title: issue.title,
					descriptionText: issue.descriptionText,
					statusId,
					priority: issue.priority,
					...(assigneeId ? { assigneeType: 'user' as const, assigneeId } : {}),
					labelIds
				},
				{ skipChangeLog: true } // Coarse sync grant emitted once below (§9.2).
			)
			localIssueId = created.data.id
			existingIssues.set(issue.remoteId, localIssueId)
			importedIssues++
			redirects.push({
				remoteIdentifier: issue.remoteIdentifier,
				localIdentifier: created.data.identifier,
				issueId: created.data.id
			})

			await insertImportMapping(tx, {
				workspaceId: actor.workspaceId,
				importJobId: job.id,
				source,
				remoteType: 'issue',
				remoteId: issue.remoteId,
				remoteIdentifier: issue.remoteIdentifier,
				remoteUrl: issue.remoteUrl,
				localType: 'issue',
				localId: localIssueId
			})
		}

		for (const comment of issue.comments) {
			if (existingComments.has(comment.remoteId)) continue
			const createdComment = await createIssueComment(
				tx,
				actor,
				localIssueId,
				{ bodyText: comment.bodyText },
				{ skipChangeLog: true }
			)
			existingComments.set(comment.remoteId, createdComment.data.id)
			importedComments++
			await insertImportMapping(tx, {
				workspaceId: actor.workspaceId,
				importJobId: job.id,
				source,
				remoteType: 'comment',
				remoteId: comment.remoteId,
				remoteIdentifier: null,
				remoteUrl: null,
				localType: 'issue_comment',
				localId: createdComment.data.id
			})
		}
	}

	const report = {
		projectId: project.id,
		projectKey: project.key,
		importedIssues,
		skippedIssues,
		importedComments,
		redirects
	}

	const completed = await markImportJobCompleted(tx, {
		workspaceId: actor.workspaceId,
		jobId: job.id,
		targetProjectId: project.id,
		report
	})

	await tx`
		INSERT INTO outbox (workspace_id, aggregate, aggregate_id, event_type, payload)
		VALUES (
			${actor.workspaceId},
			'import_job',
			${completed.id},
			${IMPORTS_EVENTS.Completed},
			${tx.json(report as never)}
		)
	`

	await tx`
		INSERT INTO audit_log (workspace_id, actor_type, actor_id, action, target_type, target_id, metadata)
		VALUES (
			${actor.workspaceId},
			${actor.kind === 'agent' ? 'agent' : 'user'},
			${actor.principalId},
			'import.execute',
			'import_job',
			${completed.id},
			${tx.json({ source, projectId: project.id, importedIssues, skippedIssues } as never)}
		)
	`

	// §9.2: bulk imports emit ONE coarse grant event so clients pull a scoped snapshot.
	const cursor = await appendChange(tx, actor.workspaceId, {
		entityType: 'project',
		entityId: project.id,
		action: 'grant',
		scope: [`project:${project.id}`],
		payload: {
			resourceType: 'project',
			resourceId: project.id,
			importJobId: completed.id
		},
		actorId: actor.principalId
	})

	return { job: completed, cursor }
}

export async function listImportJobs(tx: Queryable, actor: ActorContext): Promise<ImportJobDto[]> {
	authorizeImportRun(actor)
	return listImportJobsForWorkspace(tx, actor.workspaceId)
}

export async function getImportJob(tx: Queryable, actor: ActorContext, jobId: string): Promise<ImportJobDto> {
	authorizeImportRun(actor)
	const job = await getImportJobById(tx, actor.workspaceId, jobId)
	if (!job) throw new HttpError(404, 'not_found', 'Import job not found')
	return job
}

export async function resolveImportRedirect(
	tx: Queryable,
	actor: ActorContext,
	remoteIdentifier: string
): Promise<ImportRedirectResponse> {
	if (actor.membership !== 'active') {
		throw new HttpError(403, 'not_workspace_member', 'Active workspace membership is required')
	}
	const mapping = await findMappingByRemoteIdentifier(tx, actor.workspaceId, remoteIdentifier)
	if (!mapping) {
		throw new HttpError(404, 'not_found', `No imported mapping found for "${remoteIdentifier}"`)
	}
	const issue =
		mapping.localType === 'issue'
			? await getIssueByIdForRedirect(tx, actor.workspaceId, mapping.localId)
			: null
	const identifier = issue?.identifier ?? null
	return {
		remoteIdentifier: mapping.remoteIdentifier,
		localType: mapping.localType,
		localId: mapping.localId,
		identifier,
		deepLink: identifier ? `/tasks/issues/${identifier}` : `/tasks/issues/${mapping.localId}`
	}
}
