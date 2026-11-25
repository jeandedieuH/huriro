/**
 * Triage service (§3.1): triage queue reads, accept/snooze/decline/merge
 * actions, deterministic FTS duplicate suggestions, and the snooze wake
 * sweep. Same discipline as service.ts: authorize → validate/version →
 * domain rows + outbox events + batched change_log — all inside the
 * caller's `withWorkspace` tx.
 */
import type { IssueDto, TriageActionBody, TriageSuggestionsDto } from '@huriro/contracts'
import { type Queryable, type Sql, withSystem, withWorkspace } from '@huriro/db'
import type { ActorContext } from '@huriro/domain'
import { appendChange, appendChanges } from '../../api/changelog'
import { HttpError } from '../../api/error'
import { resolveResourceAcl } from '../tenancy'
import { TASKS_EVENTS } from './events'
import { authorizeProject } from './policy'
import {
	emitTasksEvents,
	ensureIssueRelationRow,
	getIssueById,
	getLabelMapForIssues,
	getProjectById,
	getStatusById,
	listStatusesForProject,
	listTriageQueueRows,
	listWorkspacesWithSnoozedDue,
	lockIssuesByIds,
	replaceIssueLabelsRows,
	searchSimilarIssues,
	updateIssueRow,
	wakeSnoozedIssues
} from './repo'
import { isClosedCategory as closedCat, listAccessibleProjects, requireProjectRead } from './service'

// ---------- Triage queue (§3.1) ----------

export async function listTriageQueue(
	tx: Queryable,
	actor: ActorContext,
	projectId: string,
	state: 'pending' | 'snoozed' | 'resolved'
): Promise<IssueDto[]> {
	await requireProjectRead(tx, actor, projectId)
	return listTriageQueueRows(tx, {
		workspaceId: actor.workspaceId,
		projectId,
		state,
		limit: 200
	})
}

async function firstCancelledStatusId(
	tx: Queryable,
	workspaceId: string,
	projectId: string
): Promise<string | null> {
	const statuses = await listStatusesForProject(tx, workspaceId, projectId)
	const cancelled = statuses.find((s) => s.category === 'cancelled')
	return cancelled?.id ?? null
}

export async function triageIssue(
	tx: Queryable,
	actor: ActorContext,
	issueId: string,
	body: TriageActionBody
): Promise<{ readonly data: IssueDto; readonly cursor: number }> {
	const current = await getIssueById(tx, actor.workspaceId, issueId)
	if (!current) throw new HttpError(404, 'not_found', 'Issue not found')
	const project = await getProjectById(tx, actor.workspaceId, current.projectId)
	if (!project) throw new HttpError(404, 'not_found', 'Project not found')
	const acl = await resolveResourceAcl(tx, {
		workspaceId: actor.workspaceId,
		resourceType: 'project',
		resourceId: project.id,
		userId: actor.userId
	})
	await authorizeProject(tx, actor, 'issue.write', project, acl)

	if (current.version !== body.version) {
		throw new HttpError(409, 'stale_version', `Issue ${current.identifier} was modified`, undefined, {
			expected: body.version,
			actual: current.version
		})
	}
	if (current.triageStatus !== 'pending' && current.triageStatus !== 'snoozed') {
		throw new HttpError(
			409,
			'conflict',
			`Issue ${current.identifier} is not in the triage queue`,
			undefined,
			{
				triageStatus: current.triageStatus
			}
		)
	}

	let nextStatusId = current.statusId
	let nextPriority = current.priority
	let nextAssigneeId = current.assigneeId
	let nextAssigneeType = current.assigneeType
	let nextLabelIds = current.labelIds
	let closedAt = current.closedAt
	let nextTriage: string
	let snoozedUntil: string | null = null
	let declinedReason: string | null = null
	let triageEvent: string
	const eventPayload: Record<string, unknown> = {}

	if (body.action === 'accept') {
		if (body.statusId !== undefined) {
			const st = await getStatusById(tx, actor.workspaceId, body.statusId)
			if (!st || st.projectId !== project.id) {
				throw new HttpError(422, 'validation_failed', 'Status does not belong to this project')
			}
			nextStatusId = st.id
		}
		if (body.priority !== undefined) nextPriority = body.priority
		if (body.assigneeId !== undefined) {
			nextAssigneeId = body.assigneeId
			nextAssigneeType = body.assigneeId === null ? null : 'user'
		}
		if (body.labelIds !== undefined) nextLabelIds = body.labelIds
		// Accepting into a closed category falls back to the project default.
		const nextStatus = await getStatusById(tx, actor.workspaceId, nextStatusId)
		if (nextStatus && closedCat(nextStatus.category)) {
			const statuses = await listStatusesForProject(tx, actor.workspaceId, project.id)
			const def = statuses.find((s) => s.isDefault)
			if (!def) throw new HttpError(422, 'validation_failed', 'Project has no default status')
			nextStatusId = def.id
		}
		nextTriage = 'accepted'
		triageEvent = TASKS_EVENTS.IssueTriageAccepted
	} else if (body.action === 'snooze') {
		const until = new Date(body.until)
		if (!Number.isFinite(until.getTime())) {
			throw new HttpError(422, 'validation_failed', 'Invalid snooze timestamp')
		}
		const now = Date.now()
		const max = now + 366 * 24 * 3600 * 1000
		if (until.getTime() <= now || until.getTime() > max) {
			throw new HttpError(422, 'validation_failed', 'Snooze target must be in the future and within one year')
		}
		snoozedUntil = until.toISOString()
		nextTriage = 'snoozed'
		triageEvent = TASKS_EVENTS.IssueTriageSnoozed
		eventPayload['until'] = snoozedUntil
	} else {
		// decline | merge — both close the issue into the cancelled status.
		const cancelledId = await firstCancelledStatusId(tx, actor.workspaceId, project.id)
		if (!cancelledId) {
			throw new HttpError(422, 'validation_failed', 'Project has no cancelled status')
		}
		if (body.action === 'merge') {
			if (body.duplicateOfIssueId === issueId) {
				throw new HttpError(422, 'validation_failed', 'Cannot merge an issue into itself')
			}
			const target = await getIssueById(tx, actor.workspaceId, body.duplicateOfIssueId)
			if (!target) throw new HttpError(404, 'not_found', 'Duplicate target issue not found')
			await requireProjectRead(tx, actor, target.projectId)
			await ensureIssueRelationRow(tx, {
				workspaceId: actor.workspaceId,
				sourceIssueId: issueId,
				targetIssueId: target.id,
				kind: 'duplicates',
				createdBy: actor.userId
			})
			nextTriage = 'merged'
			triageEvent = TASKS_EVENTS.IssueTriageMerged
			eventPayload['duplicateOfIssueId'] = target.id
			eventPayload['duplicateOfIdentifier'] = target.identifier
		} else {
			declinedReason = body.reason
			nextTriage = 'declined'
			triageEvent = TASKS_EVENTS.IssueTriageDeclined
			eventPayload['reason'] = body.reason
		}
		nextStatusId = cancelledId
		closedAt = current.closedAt ?? new Date().toISOString()
	}

	if (nextLabelIds !== current.labelIds) {
		await replaceIssueLabelsRows(tx, actor.workspaceId, issueId, nextLabelIds)
	}

	const updated = await updateIssueRow(tx, {
		workspaceId: actor.workspaceId,
		issueId,
		expectedVersion: body.version,
		projectKey: project.key,
		parentId: current.parentId,
		cycleId: current.cycleId,
		milestoneId: current.milestoneId ?? null,
		title: current.title,
		description: current.description,
		descriptionText: current.descriptionText,
		statusId: nextStatusId,
		priority: nextPriority,
		assigneeType: nextAssigneeType,
		assigneeId: nextAssigneeId,
		position: current.position,
		startDate: current.startDate,
		dueDate: current.dueDate,
		estimate: current.estimate,
		closedAt,
		labelIds: nextLabelIds,
		triageStatus: nextTriage,
		triageSnoozedUntil: snoozedUntil,
		triageDeclinedReason: declinedReason
	})
	if (!updated) {
		throw new HttpError(409, 'stale_version', `Issue ${current.identifier} was modified`, undefined, {
			expected: body.version
		})
	}

	const events: {
		aggregate: string
		aggregateId: string
		eventType: string
		payload: Record<string, unknown>
	}[] = [
		{
			aggregate: 'issue',
			aggregateId: issueId,
			eventType: triageEvent,
			payload: {
				issueId,
				projectId: project.id,
				identifier: current.identifier,
				title: current.title,
				actorType: actor.kind,
				actorId: actor.principalId,
				...eventPayload
			}
		}
	]
	if (updated.statusId !== current.statusId) {
		events.push({
			aggregate: 'issue',
			aggregateId: issueId,
			eventType: TASKS_EVENTS.IssueStatusChanged,
			payload: {
				issueId,
				projectId: project.id,
				identifier: updated.identifier,
				title: updated.title,
				statusId: updated.statusId,
				assigneeUserId: updated.assigneeType === 'user' ? updated.assigneeId : null,
				creatorId: updated.creatorId,
				actorType: actor.kind,
				actorId: actor.principalId
			}
		})
	}
	if (updated.assigneeType === 'user' && updated.assigneeId && updated.assigneeId !== current.assigneeId) {
		events.push({
			aggregate: 'issue',
			aggregateId: issueId,
			eventType: TASKS_EVENTS.IssueAssigned,
			payload: {
				issueId,
				projectId: project.id,
				identifier: updated.identifier,
				title: updated.title,
				assigneeUserId: updated.assigneeId,
				actorType: actor.kind,
				actorId: actor.principalId
			}
		})
	}
	await emitTasksEvents(tx, actor.workspaceId, events)

	const cursor = await appendChange(tx, actor.workspaceId, {
		entityType: 'issue',
		entityId: issueId,
		action: 'upsert',
		scope: [`project:${project.id}`],
		payload: updated as unknown as Record<string, unknown>,
		actorId: actor.principalId
	})
	return { data: updated, cursor }
}

/** Deterministic FTS duplicate suggestions — no LLM (§3.1). */
export async function getTriageSuggestions(
	tx: Queryable,
	actor: ActorContext,
	issueId: string
): Promise<TriageSuggestionsDto> {
	const issue = await getIssueById(tx, actor.workspaceId, issueId)
	if (!issue) throw new HttpError(404, 'not_found', 'Issue not found')
	await requireProjectRead(tx, actor, issue.projectId)

	const projects = await listAccessibleProjects(tx, actor)
	const candidates = await searchSimilarIssues(tx, {
		workspaceId: actor.workspaceId,
		projectIds: projects.map((p) => p.id),
		excludeIssueId: issue.id,
		queryText: `${issue.title} ${issue.descriptionText}`.trim() || issue.title,
		limit: 10
	})

	// Reciprocal-rank-fusion style score over the FTS ranking (single list →
	// normalized by the top rank so `score` lands in (0, 1]).
	const top = candidates[0]?.rank ?? 0
	const duplicates = candidates.map((c, i) => ({
		issueId: c.id,
		identifier: c.identifier,
		title: c.title,
		statusCategory: c.statusCategory as TriageSuggestionsDto['duplicates'][number]['statusCategory'],
		score: top > 0 ? c.rank / top : 1 / (i + 1)
	}))

	const strong = duplicates.slice(0, 3).filter((d) => d.score >= 0.5)
	let suggestedPriority: number | null = null
	if (strong.length > 0) {
		const rows = await lockIssuesByIds(tx, {
			workspaceId: actor.workspaceId,
			issueIds: strong.map((d) => d.issueId)
		})
		const ps = rows.map((r) => r.priority).sort((a, b) => a - b)
		suggestedPriority = ps.length > 0 ? Math.round(ps[Math.floor(ps.length / 2)]!) : null
	}

	const strongIds = strong.map((d) => d.issueId)
	const labelMap = strongIds.length
		? await getLabelMapForIssues(tx, actor.workspaceId, strongIds)
		: new Map<string, string[]>()
	const labelCounts = new Map<string, number>()
	const assigneeCounts = new Map<string, number>()
	for (const id of strongIds) {
		for (const lid of labelMap.get(id) ?? []) {
			labelCounts.set(lid, (labelCounts.get(lid) ?? 0) + 1)
		}
	}
	const suggestedLabelIds = [...labelCounts.entries()].filter(([, n]) => n >= 2).map(([lid]) => lid)
	if (strongIds.length) {
		const rows = await lockIssuesByIds(tx, {
			workspaceId: actor.workspaceId,
			issueIds: strongIds
		})
		for (const r of rows) {
			if (r.assigneeType === 'user' && r.assigneeId) {
				assigneeCounts.set(r.assigneeId, (assigneeCounts.get(r.assigneeId) ?? 0) + 1)
			}
		}
	}
	const suggestedAssigneeId =
		[...assigneeCounts.entries()].filter(([, n]) => n >= 2).sort((a, b) => b[1] - a[1])[0]?.[0] ?? null

	return { duplicates, suggestedPriority, suggestedLabelIds, suggestedAssigneeId }
}

// ---------- Snooze wake sweep (§3.1) ----------

/**
 * 60s pg-boss sweep: flips snoozed issues past `triage_snoozed_until` back to
 * pending — one withWorkspace tx per workspace, capped at 500 rows per run.
 */
export async function runTriageWakeOnce(app: Sql, now?: Date): Promise<{ readonly woken: number }> {
	const ts = (now ?? new Date()).toISOString()
	const workspaces = await withSystem(app, (tx) => listWorkspacesWithSnoozedDue(tx, ts))
	let woken = 0
	for (const ws of workspaces) {
		const rows = await withWorkspace(app, { workspaceId: ws.workspaceId }, async (tx) => {
			const updated = await wakeSnoozedIssues(tx, ws.workspaceId, ts)
			if (updated.length === 0) return updated
			await emitTasksEvents(
				tx,
				ws.workspaceId,
				updated.map((r) => ({
					aggregate: 'issue',
					aggregateId: r.id,
					eventType: TASKS_EVENTS.IssueTriageWoken,
					payload: {
						issueId: r.id,
						projectId: r.projectId,
						identifier: `${r.projectKey}-${r.number}`,
						title: r.title,
						actorType: 'system'
					}
				}))
			)
			const labelMap = await getLabelMapForIssues(
				tx,
				ws.workspaceId,
				updated.map((r) => r.id)
			)
			await appendChanges(
				tx,
				ws.workspaceId,
				updated.map((r) => ({
					entityType: 'issue' as const,
					entityId: r.id,
					action: 'upsert' as const,
					scope: [`project:${r.projectId}`],
					payload: {
						...r,
						identifier: `${r.projectKey}-${r.number}`,
						labelIds: labelMap.get(r.id) ?? []
					} as unknown as Record<string, unknown>,
					actorId: null
				}))
			)
			return updated
		}).catch(() => [] as Awaited<ReturnType<typeof wakeSnoozedIssues>>)
		woken += rows.length
	}
	return { woken }
}
