import type {
	ImportDryRunBody,
	ImportDryRunPreviewDto,
	ImportExecuteBody,
	ImportJobDto,
	ImportRedirectResponse
} from '@huriro/contracts'
import type { Queryable } from '@huriro/db'
import type { ActorContext } from '@huriro/domain'
import { appendChange, appendChanges } from '../../api/changelog'
import { HttpError } from '../../api/error'
import { ensureChannelForImport, importChatMessage } from '../chat'
import { createDocPage, getDocPageForRedirect } from '../docs'
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
import { fetchJiraProjectPayload, normalizeJiraPayload } from './jira'
import { fetchLinearTeamPayload, type NormalizedImportDataset, normalizeLinearPayload } from './linear'
import { normalizeMarkdownPayload } from './markdown'
import { type NormalizedDocImportPage, normalizeNotionPayload } from './notion'
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
import { normalizeSlackPayload } from './slack'

interface NormalizedDocImportDataset {
	readonly source: 'notion' | 'markdown'
	readonly rootTitle: string | null
	readonly pages: NormalizedDocImportPage[]
}

function resolveDocDataset(input: {
	readonly source: 'notion' | 'markdown'
	readonly notion?: ImportDryRunBody['notion'] | undefined
	readonly markdown?: ImportDryRunBody['markdown'] | undefined
}): NormalizedDocImportDataset {
	if (input.source === 'notion') {
		if (!input.notion) {
			throw new HttpError(422, 'validation_failed', 'Provide notion payload')
		}
		const normalized = normalizeNotionPayload(input.notion)
		return { source: 'notion', rootTitle: normalized.rootTitle, pages: normalized.pages }
	}
	if (!input.markdown) {
		throw new HttpError(422, 'validation_failed', 'Provide markdown payload')
	}
	const normalized = normalizeMarkdownPayload(input.markdown)
	return { source: 'markdown', rootTitle: normalized.rootTitle, pages: normalized.pages }
}

async function resolveNormalizedDataset(input: {
	readonly source: 'linear' | 'github' | 'jira'
	readonly linear?: ImportDryRunBody['linear'] | undefined
	readonly github?: ImportDryRunBody['github'] | undefined
	readonly jira?: ImportDryRunBody['jira'] | undefined
	readonly apiToken?: string | undefined
	readonly teamKey?: string | undefined
	readonly repo?: string | undefined
	readonly jiraBaseUrl?: string | undefined
	readonly jiraProjectKey?: string | undefined
	readonly jiraEmail?: string | undefined
}): Promise<NormalizedImportDataset> {
	if (input.source === 'linear') {
		if (input.linear) return normalizeLinearPayload(input.linear)
		if (input.apiToken && input.teamKey) {
			const payload = await fetchLinearTeamPayload(input.apiToken, input.teamKey)
			return normalizeLinearPayload(payload)
		}
		throw new HttpError(422, 'validation_failed', 'Provide either linear payload or apiToken + teamKey')
	}

	if (input.source === 'jira') {
		if (input.jira) return normalizeJiraPayload(input.jira)
		if (input.jiraBaseUrl && input.jiraEmail && input.apiToken && input.jiraProjectKey) {
			const payload = await fetchJiraProjectPayload({
				jiraBaseUrl: input.jiraBaseUrl,
				jiraEmail: input.jiraEmail,
				apiToken: input.apiToken,
				jiraProjectKey: input.jiraProjectKey
			})
			return normalizeJiraPayload(payload)
		}
		throw new HttpError(
			422,
			'validation_failed',
			'Provide either jira payload (CSV/JSON) or jiraBaseUrl + jiraEmail + apiToken + jiraProjectKey'
		)
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

	if (body.source === 'notion' || body.source === 'markdown') {
		const docDataset = resolveDocDataset({
			source: body.source,
			notion: body.notion,
			markdown: body.markdown
		})
		const existingPages = await findMappedRemoteIds(tx, actor.workspaceId, docDataset.source, 'doc_page')
		let skippedExisting = 0
		for (const p of docDataset.pages) {
			if (existingPages.has(p.remoteId)) skippedExisting++
		}
		const projectName =
			docDataset.rootTitle ?? (docDataset.source === 'notion' ? 'Notion Import' : 'Markdown Import')
		const safeConfig: Record<string, unknown> = {
			source: docDataset.source,
			...(docDataset.source === 'notion' ? { notion: body.notion } : { markdown: body.markdown })
		}
		const previewPayload = {
			source: docDataset.source,
			projectKey: 'DOCS',
			projectName,
			counts: {
				issues: 0,
				comments: 0,
				labels: 0,
				skippedExisting,
				pages: docDataset.pages.length
			},
			userMappings: [] as { remoteIdentifier: string; matchedUserId: string | null }[],
			unmappedFields: [] as string[]
		}
		const job = await insertImportJobRow(tx, {
			workspaceId: actor.workspaceId,
			source: docDataset.source,
			status: 'dry_run',
			targetProjectId: null,
			createdBy: actor.userId,
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
				${tx.json({ jobId: job.id, source: docDataset.source, counts: previewPayload.counts } as never)}
			)
		`
		return { jobId: job.id, ...previewPayload }
	}

	if (body.source === 'slack') {
		if (!body.slack) {
			throw new HttpError(422, 'validation_failed', 'Provide slack payload')
		}
		const slackDataset = normalizeSlackPayload(body.slack)
		const members = await listWorkspaceMembers(tx, actor.workspaceId)
		const memberByEmail = new Map(members.map((m) => [m.email.toLowerCase(), m.userId]))
		const existingChannels = await findMappedRemoteIds(tx, actor.workspaceId, 'slack', 'channel')
		const existingMessages = await findMappedRemoteIds(tx, actor.workspaceId, 'slack', 'message')

		let skippedExisting = 0
		for (const ch of slackDataset.channels) {
			if (existingChannels.has(ch.remoteId)) skippedExisting++
			for (const m of ch.messages) {
				if (existingMessages.has(m.remoteId)) skippedExisting++
			}
		}

		const userMappings = slackDataset.emails.map((email) => ({
			remoteIdentifier: email,
			matchedUserId: memberByEmail.get(email) ?? null
		}))

		const previewPayload = {
			source: 'slack' as const,
			projectKey: 'CHAT',
			projectName: 'Slack Workspace Import',
			counts: {
				issues: 0,
				comments: 0,
				labels: 0,
				skippedExisting,
				channels: slackDataset.channels.length,
				messages: slackDataset.totalMessages,
				threads: slackDataset.totalThreads
			},
			userMappings,
			unmappedFields: [] as string[]
		}

		const job = await insertImportJobRow(tx, {
			workspaceId: actor.workspaceId,
			source: 'slack',
			status: 'dry_run',
			targetProjectId: null,
			createdBy: actor.userId,
			config: { source: 'slack', slack: body.slack },
			preview: previewPayload
		})

		await tx`
			INSERT INTO outbox (workspace_id, aggregate, aggregate_id, event_type, payload)
			VALUES (
				${actor.workspaceId},
				'import_job',
				${job.id},
				${IMPORTS_EVENTS.DryRunCreated},
				${tx.json({ jobId: job.id, source: 'slack', counts: previewPayload.counts } as never)}
			)
		`
		return { jobId: job.id, ...previewPayload }
	}

	const dataset = await resolveNormalizedDataset({
		source: body.source,
		linear: body.linear,
		github: body.github,
		jira: body.jira,
		apiToken: body.apiToken,
		teamKey: body.teamKey,
		repo: body.repo,
		jiraBaseUrl: body.jiraBaseUrl,
		jiraProjectKey: body.jiraProjectKey,
		jiraEmail: body.jiraEmail
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
			: dataset.source === 'jira'
				? {
						jira: body.jira ?? {
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
		createdBy: actor.userId,
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

	if (source === 'notion' || source === 'markdown') {
		const notionInput =
			body.notion ?? (existingJob?.config['notion'] as ImportDryRunBody['notion'] | undefined)
		const markdownInput =
			body.markdown ?? (existingJob?.config['markdown'] as ImportDryRunBody['markdown'] | undefined)
		const docDataset = resolveDocDataset({
			source,
			notion: notionInput,
			markdown: markdownInput
		})

		const job =
			existingJob ??
			(await insertImportJobRow(tx, {
				workspaceId: actor.workspaceId,
				source,
				status: 'running',
				targetProjectId: null,
				createdBy: actor.userId,
				config: { source, rootTitle: docDataset.rootTitle },
				preview: { pages: docDataset.pages.length }
			}))

		const existingPages = await findMappedRemoteIds(tx, actor.workspaceId, source, 'doc_page')
		let rootPageId: string | null = body.targetParentPageId ?? null
		if (docDataset.rootTitle) {
			const rootKey = `root:${docDataset.rootTitle}`
			const mappedRoot = existingPages.get(rootKey)
			if (mappedRoot) {
				rootPageId = mappedRoot
			} else {
				const rootCreated = await createDocPage(tx, actor, {
					parentId: rootPageId,
					title: docDataset.rootTitle
				})
				rootPageId = rootCreated.data.id
				existingPages.set(rootKey, rootPageId)
				await insertImportMapping(tx, {
					workspaceId: actor.workspaceId,
					importJobId: job.id,
					source,
					remoteType: 'doc_page',
					remoteId: rootKey,
					remoteIdentifier: rootKey,
					remoteUrl: null,
					localType: 'doc_page',
					localId: rootPageId
				})
			}
		}

		const createdByRemotePath = new Map<string, string>()
		let importedPages = 0
		let skippedPages = 0
		const redirects: { remoteIdentifier: string; slug: string; pageId: string }[] = []
		let latestCursor = 0

		for (const p of docDataset.pages) {
			const existingLocalId = existingPages.get(p.remoteId)
			if (existingLocalId) {
				createdByRemotePath.set(p.remotePath, existingLocalId)
				skippedPages++
				continue
			}

			const parentId = (p.parentRemotePath ? createdByRemotePath.get(p.parentRemotePath) : null) ?? rootPageId
			const created = await createDocPage(tx, actor, {
				parentId,
				title: p.title,
				...(p.markdown.trim().length > 0 ? { markdown: p.markdown } : {})
			})
			createdByRemotePath.set(p.remotePath, created.data.id)
			existingPages.set(p.remoteId, created.data.id)
			importedPages++
			latestCursor = Math.max(latestCursor, created.cursor)
			redirects.push({
				remoteIdentifier: p.remoteIdentifier,
				slug: created.data.slug,
				pageId: created.data.id
			})

			await insertImportMapping(tx, {
				workspaceId: actor.workspaceId,
				importJobId: job.id,
				source,
				remoteType: 'doc_page',
				remoteId: p.remoteId,
				remoteIdentifier: p.remoteIdentifier,
				remoteUrl: null,
				localType: 'doc_page',
				localId: created.data.id
			})
		}

		const report = {
			importedPages,
			skippedPages,
			rootPageId,
			redirects
		}

		const completed = await markImportJobCompleted(tx, {
			workspaceId: actor.workspaceId,
			jobId: job.id,
			targetProjectId: null,
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
				${tx.json({ source, importedPages, skippedPages } as never)}
			)
		`

		const cursor = latestCursor > 0 ? latestCursor : await appendChanges(tx, actor.workspaceId, [])
		return { job: completed, cursor }
	}

	if (source === 'slack') {
		const slackInput = body.slack ?? (existingJob?.config['slack'] as ImportDryRunBody['slack'] | undefined)
		if (!slackInput) {
			throw new HttpError(422, 'validation_failed', 'Provide slack payload')
		}
		const slackDataset = normalizeSlackPayload(slackInput)
		const job =
			existingJob ??
			(await insertImportJobRow(tx, {
				workspaceId: actor.workspaceId,
				source: 'slack',
				status: 'running',
				targetProjectId: null,
				createdBy: actor.userId,
				config: { source: 'slack' },
				preview: { channels: slackDataset.channels.length, messages: slackDataset.totalMessages }
			}))

		const members = await listWorkspaceMembers(tx, actor.workspaceId)
		const memberByEmail = new Map(members.map((m) => [m.email.toLowerCase(), m.userId]))
		const existingChannels = await findMappedRemoteIds(tx, actor.workspaceId, 'slack', 'channel')
		const existingMessages = await findMappedRemoteIds(tx, actor.workspaceId, 'slack', 'message')

		let importedChannels = 0
		let skippedChannels = 0
		let importedMessages = 0
		let skippedMessages = 0

		for (const ch of slackDataset.channels) {
			let localChannelId = existingChannels.get(ch.remoteId)
			if (localChannelId) {
				skippedChannels++
			} else {
				const ensured = await ensureChannelForImport(tx, actor, {
					name: ch.slug,
					kind: ch.kind,
					topic: ch.topic
				})
				localChannelId = ensured.id
				existingChannels.set(ch.remoteId, localChannelId)
				importedChannels++
				await insertImportMapping(tx, {
					workspaceId: actor.workspaceId,
					importJobId: job.id,
					source: 'slack',
					remoteType: 'channel',
					remoteId: ch.remoteId,
					remoteIdentifier: `#${ch.slug}`,
					remoteUrl: null,
					localType: 'chat_channel',
					localId: localChannelId
				})
			}

			const localMsgByTs = new Map<string, string>()
			for (const msg of ch.messages) {
				const mappedMsgId = existingMessages.get(msg.remoteId)
				if (mappedMsgId) {
					localMsgByTs.set(msg.ts, mappedMsgId)
					skippedMessages++
					continue
				}

				const threadParentId = msg.threadTs
					? (localMsgByTs.get(msg.threadTs) ?? existingMessages.get(`${ch.remoteId}:${msg.threadTs}`))
					: undefined

				const authorId =
					(msg.authorEmail ? memberByEmail.get(msg.authorEmail) : undefined) ?? actor.principalId
				const reactions = msg.reactions.map((rx) => ({
					emoji: rx.emoji,
					userIds: rx.authorEmails
						.map((e) => memberByEmail.get(e))
						.filter((uid): uid is string => typeof uid === 'string')
				}))

				const createdMsg = await importChatMessage(tx, actor, {
					channelId: localChannelId,
					authorId,
					bodyText: msg.bodyText,
					...(threadParentId ? { threadParentId } : {}),
					...(reactions.length > 0 ? { reactions } : {})
				})
				localMsgByTs.set(msg.ts, createdMsg.id)
				existingMessages.set(msg.remoteId, createdMsg.id)
				importedMessages++
				await insertImportMapping(tx, {
					workspaceId: actor.workspaceId,
					importJobId: job.id,
					source: 'slack',
					remoteType: 'message',
					remoteId: msg.remoteId,
					remoteIdentifier: msg.remoteIdentifier,
					remoteUrl: null,
					localType: 'chat_message',
					localId: createdMsg.id
				})
			}
		}

		const report = {
			importedChannels,
			skippedChannels,
			importedMessages,
			skippedMessages
		}
		const completed = await markImportJobCompleted(tx, {
			workspaceId: actor.workspaceId,
			jobId: job.id,
			targetProjectId: null,
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
				${tx.json({ source: 'slack', ...report } as never)}
			)
		`
		const cursor = await appendChanges(tx, actor.workspaceId, [])
		return { job: completed, cursor }
	}

	const linearInput = body.linear ?? (existingJob?.config['linear'] as ImportDryRunBody['linear'] | undefined)
	const githubInput = body.github ?? (existingJob?.config['github'] as ImportDryRunBody['github'] | undefined)
	const jiraInput = body.jira ?? (existingJob?.config['jira'] as ImportDryRunBody['jira'] | undefined)

	const dataset = await resolveNormalizedDataset({
		source,
		linear: linearInput,
		github: githubInput,
		jira: jiraInput,
		apiToken: body.apiToken,
		teamKey: body.teamKey,
		repo: body.repo,
		jiraBaseUrl: body.jiraBaseUrl,
		jiraProjectKey: body.jiraProjectKey,
		jiraEmail: body.jiraEmail
	})

	const job =
		existingJob ??
		(await insertImportJobRow(tx, {
			workspaceId: actor.workspaceId,
			source,
			status: 'running',
			targetProjectId: body.targetProjectId ?? null,
			createdBy: actor.userId,
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
	if (mapping.localType === 'doc_page') {
		const docPage = await getDocPageForRedirect(tx, actor.workspaceId, mapping.localId)
		const slug = docPage?.slug ?? null
		return {
			remoteIdentifier: mapping.remoteIdentifier,
			localType: mapping.localType,
			localId: mapping.localId,
			identifier: slug,
			deepLink: slug ? `/docs/${slug}` : '/docs'
		}
	}
	if (mapping.localType === 'chat_channel') {
		return {
			remoteIdentifier: mapping.remoteIdentifier,
			localType: mapping.localType,
			localId: mapping.localId,
			identifier: mapping.remoteIdentifier,
			deepLink: `/chat?channel=${mapping.localId}`
		}
	}
	if (mapping.localType === 'chat_message') {
		return {
			remoteIdentifier: mapping.remoteIdentifier,
			localType: mapping.localType,
			localId: mapping.localId,
			identifier: mapping.remoteIdentifier,
			deepLink: `/chat?message=${mapping.localId}`
		}
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
