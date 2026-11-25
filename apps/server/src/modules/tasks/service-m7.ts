/**
 * M7 tasks services (§3.1 triage, §3.4 filter query + bulk). Same discipline
 * as service.ts: authorize → validate/version → domain rows + outbox events +
 * batched change_log — all inside the caller's `withWorkspace` tx.
 */
import {
	BULK_UNDO_WINDOW_MS,
	type BulkBeforeDto,
	type BulkIssuesBody,
	type BulkIssuesResponse,
	type BulkRestoreBody,
	decodeCursor,
	encodeCursor,
	type IssueDto,
	type QueryIssuesBody,
	type TriageActionBody,
	type TriageSuggestionsDto
} from '@huriro/contracts'
import { type Queryable, type Sql, withSystem, withWorkspace } from '@huriro/db'
import type { ActorContext } from '@huriro/domain'
import { appendChange, appendChanges } from '../../api/changelog'
import { HttpError } from '../../api/error'
import { resolveResourceAcl } from '../tenancy'
import { TASKS_EVENTS } from './events'
import { buildIssueFilterSql } from './filter-sql'
import { authorizeProject } from './policy'
import {
	addIssueLabelsToMany,
	emitTasksEvents,
	ensureIssueRelationRow,
	getIssueById,
	getLabelById,
	getLabelMapForIssues,
	getProjectById,
	getStatusById,
	listStatusesForProject,
	listTriageQueueRows,
	listWorkspacesWithSnoozedDue,
	lockIssuesByIds,
	queryIssuesExpr,
	removeIssueLabelsFromMany,
	replaceIssueLabelsForMany,
	replaceIssueLabelsRows,
	restoreIssueRows,
	searchSimilarIssues,
	updateIssueRow,
	updateIssuesSetColumns,
	wakeSnoozedIssues
} from './repo'
import {
	isClosedCategory as closedCat,
	deleteIssue,
	listAccessibleProjects,
	requireProjectRead,
	updateIssue
} from './service'

// ---------- POST /issues/query (§3.4) ----------

export async function queryIssues(
	tx: Queryable,
	actor: ActorContext,
	body: QueryIssuesBody
): Promise<{ readonly data: IssueDto[]; readonly nextCursor: string | null; readonly hasMore: boolean }> {
	if (actor.membership !== 'active') {
		throw new HttpError(403, 'not_workspace_member', 'Active workspace membership required')
	}
	const projects = await listAccessibleProjects(tx, actor)
	const visibleIds = projects.map((p) => p.id)
	const filter = body.filter ? buildIssueFilterSql(tx, body.filter, { now: new Date() }) : undefined
	const sortBy = body.sortBy === 'manual' || body.sortBy === undefined ? 'position' : body.sortBy
	const sortDir = body.sortDirection ?? 'asc'
	const cursor = decodeCursor<{ k: string | number | null; id: string }>(body.cursor)
	const limit = body.limit ?? 50

	const res = await queryIssuesExpr(tx, {
		workspaceId: actor.workspaceId,
		visibleProjectIds: visibleIds,
		filter,
		sortBy,
		sortDir,
		cursor,
		limit
	})
	const last = res.items.at(-1) as (IssueDto & { sortKey?: string | number | null }) | undefined
	const nextCursor = res.hasMore && last ? encodeCursor({ k: last.sortKey ?? null, id: last.id }) : null
	return {
		data: res.items.map(({ ...i }) => i as IssueDto),
		nextCursor,
		hasMore: res.hasMore
	}
}

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

// ---------- Bulk (§3.4) ----------

/**
 * Pin transaction-local `plan_cache_mode = force_custom_plan` for bulk statements
 * (Gate G7). The bulk path keys on `id = ANY($1::uuid[])` with 200-element arrays;
 * at scale the generic plan mis-estimates array cardinality, so when PostgreSQL
 * flips the prepared statements to the generic plan at the 6th execution the lock
 * and set-based UPDATE degrade ~5ms → ~60ms each. Re-planning these simple
 * statements with real parameter values costs microseconds. `set_config(…, true)`
 * is transaction-local (same semantics as SET LOCAL): it auto-reverts at commit,
 * so the setting can never leak across pooled connections or non-bulk traffic.
 */
async function pinCustomPlans(tx: Queryable): Promise<void> {
	await tx`SELECT set_config('plan_cache_mode', 'force_custom_plan', true)`
}

function beforeFields(row: {
	statusId: string
	priority: number
	assigneeType: 'user' | 'agent' | null
	assigneeId: string | null
	cycleId: string | null
}): Omit<BulkBeforeDto['fields'], 'labelIds' | 'deleted'> {
	return {
		statusId: row.statusId,
		priority: row.priority,
		assigneeType: row.assigneeType,
		assigneeId: row.assigneeId,
		cycleId: row.cycleId
	}
}

export async function bulkUpdateIssues(
	tx: Queryable,
	actor: ActorContext,
	body: BulkIssuesBody
): Promise<BulkIssuesResponse> {
	if (actor.membership !== 'active') {
		throw new HttpError(403, 'not_workspace_member', 'Active workspace membership required')
	}
	const { issueIds, patch } = body

	// Must precede the first ANY-array statement in this tx — see pinCustomPlans.
	await pinCustomPlans(tx)

	// One lock pass, id-ordered to avoid deadlocks.
	const locked = await lockIssuesByIds(tx, { workspaceId: actor.workspaceId, issueIds })
	const found = new Set(locked.map((r) => r.id))
	const missing = issueIds.filter((id) => !found.has(id))
	if (missing.length > 0) {
		throw new HttpError(404, 'not_found', 'Some issues were not found', undefined, {
			missingIssueIds: missing
		})
	}

	// Authorize issue.write per DISTINCT project; delete needs issue.delete.
	const projectIds = [...new Set(locked.map((r) => r.projectId))]
	const writeAction = patch.delete === true ? 'issue.delete' : 'issue.write'
	for (const pid of projectIds) {
		const project = await getProjectById(tx, actor.workspaceId, pid)
		if (!project) throw new HttpError(404, 'not_found', 'Project not found')
		const acl = await resolveResourceAcl(tx, {
			workspaceId: actor.workspaceId,
			resourceType: 'project',
			resourceId: pid,
			userId: actor.userId
		})
		await authorizeProject(tx, actor, writeAction, project, acl)
		if (patch.delete !== true) {
			await authorizeProject(tx, actor, 'issue.write', project, acl)
		}
	}

	// Patch reference validation.
	if (patch.projectId !== undefined && (patch.statusId !== undefined || patch.cycleId !== undefined)) {
		throw new HttpError(
			422,
			'validation_failed',
			'Cannot combine a project move with a status or cycle change in one bulk patch'
		)
	}
	if (patch.statusId !== undefined) {
		if (projectIds.length !== 1) {
			throw new HttpError(
				422,
				'validation_failed',
				'A bulk status change requires all issues to share one project'
			)
		}
		const st = await getStatusById(tx, actor.workspaceId, patch.statusId)
		if (!st || st.projectId !== projectIds[0]) {
			throw new HttpError(422, 'validation_failed', "Status does not belong to the issues' project")
		}
	}
	if (patch.cycleId !== undefined && patch.cycleId !== null) {
		if (projectIds.length !== 1) {
			throw new HttpError(
				422,
				'validation_failed',
				'A bulk cycle change requires all issues to share one project'
			)
		}
	}
	if (patch.assigneeId !== undefined || patch.assigneeType !== undefined) {
		if (patch.assigneeType !== undefined && patch.assigneeId === undefined) {
			throw new HttpError(422, 'validation_failed', 'assigneeId is required when assigneeType is set')
		}
	}
	for (const lid of [...(patch.addLabelIds ?? []), ...(patch.removeLabelIds ?? [])]) {
		const label = await getLabelById(tx, actor.workspaceId, lid)
		if (!label) throw new HttpError(422, 'validation_failed', `Unknown label ${lid}`)
	}

	const preLabels = await getLabelMapForIssues(tx, actor.workspaceId, issueIds)
	const beforeById = new Map(
		locked.map((r) => [
			r.id,
			{ fields: { ...beforeFields(r), labelIds: preLabels.get(r.id) ?? [], deleted: false } }
		])
	)

	// Slow path (documented — no perf guarantee): projectId move goes through
	// the per-issue updateIssue service inside the same tx.
	if (patch.projectId !== undefined) {
		const dest = await getProjectById(tx, actor.workspaceId, patch.projectId)
		if (!dest) throw new HttpError(404, 'not_found', 'Target project not found')
		const destAcl = await resolveResourceAcl(tx, {
			workspaceId: actor.workspaceId,
			resourceType: 'project',
			resourceId: dest.id,
			userId: actor.userId
		})
		await authorizeProject(tx, actor, 'issue.write', dest, destAcl)
		for (const r of locked) {
			await updateIssue(tx, actor, r.id, { projectId: dest.id, version: r.version })
		}
	}

	// Fast path: ONE set-based UPDATE for the uniform column patch.
	const hasColumnPatch =
		patch.statusId !== undefined ||
		patch.priority !== undefined ||
		patch.assigneeId !== undefined ||
		patch.assigneeType !== undefined ||
		patch.cycleId !== undefined
	if (hasColumnPatch) {
		let closedAt: string | null | undefined
		if (patch.statusId !== undefined) {
			const st = await getStatusById(tx, actor.workspaceId, patch.statusId)
			closedAt = st && closedCat(st.category) ? new Date().toISOString() : null
		}
		await updateIssuesSetColumns(tx, {
			workspaceId: actor.workspaceId,
			issueIds,
			statusId: patch.statusId,
			closedAt,
			priority: patch.priority,
			setAssignee: patch.assigneeId !== undefined,
			assigneeType: patch.assigneeId === null ? null : (patch.assigneeType ?? 'user'),
			assigneeId: patch.assigneeId,
			setCycle: patch.cycleId !== undefined,
			cycleId: patch.cycleId
		})
	}
	await addIssueLabelsToMany(tx, actor.workspaceId, issueIds, patch.addLabelIds ?? [])
	await removeIssueLabelsFromMany(tx, actor.workspaceId, issueIds, patch.removeLabelIds ?? [])

	// Slow path: delete goes through the per-issue service (events + change_log).
	if (patch.delete === true) {
		for (const r of locked) {
			await deleteIssue(tx, actor, r.id)
		}
	}

	// Re-read final state (rows already locked) for DTOs + new versions.
	const finalRows = await lockIssuesByIds(tx, {
		workspaceId: actor.workspaceId,
		issueIds,
		includeDeleted: true
	})
	const finalLabels = await getLabelMapForIssues(tx, actor.workspaceId, issueIds)
	const data = finalRows.map((r) => ({
		id: r.id,
		workspaceId: r.workspaceId,
		projectId: r.projectId,
		projectKey: r.projectKey,
		number: r.number,
		identifier: `${r.projectKey}-${r.number}`,
		parentId: r.parentId,
		cycleId: r.cycleId,
		title: r.title,
		description: r.description,
		descriptionText: r.descriptionText,
		statusId: r.statusId,
		priority: r.priority,
		assigneeType: r.assigneeType,
		assigneeId: r.assigneeId,
		creatorId: r.creatorId,
		position: r.position,
		startDate: r.startDate,
		dueDate: r.dueDate,
		estimate: r.estimate,
		triageStatus: r.triageStatus,
		triageSnoozedUntil: r.triageSnoozedUntil,
		triageDeclinedReason: r.triageDeclinedReason,
		sourceKind: r.sourceKind,
		closedAt: r.closedAt,
		createdAt: r.createdAt,
		updatedAt: r.updatedAt,
		deletedAt: r.deletedAt,
		version: r.version,
		labelIds: finalLabels.get(r.id) ?? []
	})) as IssueDto[]

	const before: BulkBeforeDto[] = finalRows.map((r) => ({
		issueId: r.id,
		version: r.version,
		fields: beforeById.get(r.id)!.fields
	}))

	// Per-issue events in ONE multi-row outbox insert (non-deleted only —
	// deleteIssue already emitted its own events).
	const nonDeleted = finalRows.filter((r) => r.deletedAt === null)
	const beforeMap = new Map(locked.map((r) => [r.id, r]))
	const events: {
		aggregate: string
		aggregateId: string
		eventType: string
		payload: Record<string, unknown>
	}[] = []
	for (const r of nonDeleted) {
		const prev = beforeMap.get(r.id)!
		events.push({
			aggregate: 'issue',
			aggregateId: r.id,
			eventType: TASKS_EVENTS.IssueUpdated,
			payload: {
				issueId: r.id,
				projectId: r.projectId,
				identifier: `${r.projectKey}-${r.number}`,
				title: r.title,
				actorId: actor.principalId,
				bulk: true
			}
		})
		if (r.statusId !== prev.statusId) {
			events.push({
				aggregate: 'issue',
				aggregateId: r.id,
				eventType: TASKS_EVENTS.IssueStatusChanged,
				payload: {
					issueId: r.id,
					projectId: r.projectId,
					identifier: `${r.projectKey}-${r.number}`,
					title: r.title,
					statusId: r.statusId,
					assigneeUserId: r.assigneeType === 'user' ? r.assigneeId : null,
					creatorId: r.creatorId,
					actorType: actor.kind,
					actorId: actor.principalId
				}
			})
		}
		if (r.assigneeType === 'user' && r.assigneeId && r.assigneeId !== prev.assigneeId) {
			events.push({
				aggregate: 'issue',
				aggregateId: r.id,
				eventType: TASKS_EVENTS.IssueAssigned,
				payload: {
					issueId: r.id,
					projectId: r.projectId,
					identifier: `${r.projectKey}-${r.number}`,
					title: r.title,
					assigneeUserId: r.assigneeId,
					actorType: actor.kind,
					actorId: actor.principalId
				}
			})
		}
	}
	await emitTasksEvents(tx, actor.workspaceId, events)

	const cursor = await appendChanges(
		tx,
		actor.workspaceId,
		data
			.filter((i) => i.deletedAt === null)
			.map((i) => ({
				entityType: 'issue' as const,
				entityId: i.id,
				action: 'upsert' as const,
				scope: [`project:${i.projectId}`],
				payload: i as unknown as Record<string, unknown>,
				actorId: actor.principalId
			}))
	)

	return { data, before, cursor, undoWindowMs: BULK_UNDO_WINDOW_MS }
}

export async function bulkRestoreIssues(
	tx: Queryable,
	actor: ActorContext,
	body: BulkRestoreBody
): Promise<{ readonly data: IssueDto[]; readonly cursor: number }> {
	if (actor.membership !== 'active') {
		throw new HttpError(403, 'not_workspace_member', 'Active workspace membership required')
	}
	const ids = body.items.map((it) => it.issueId)

	// Same ANY-array shapes as the bulk update path — see pinCustomPlans.
	await pinCustomPlans(tx)

	// Include deleted rows — restores un-delete.
	const locked = await lockIssuesByIds(tx, {
		workspaceId: actor.workspaceId,
		issueIds: ids,
		includeDeleted: true
	})
	const byId = new Map(locked.map((r) => [r.id, r]))
	const missing = ids.filter((id) => !byId.has(id))
	if (missing.length > 0) {
		throw new HttpError(404, 'not_found', 'Some issues were not found', undefined, {
			missingIssueIds: missing
		})
	}

	// All-or-nothing optimistic check: anything stale rejects the whole restore.
	const stale = body.items.filter((it) => byId.get(it.issueId)!.version !== it.expectedVersion)
	if (stale.length > 0) {
		throw new HttpError(
			409,
			'bulk_restore_conflict',
			'Some issues changed since the bulk action',
			undefined,
			{
				staleIssueIds: stale.map((s) => s.issueId)
			}
		)
	}

	const projectIds = [...new Set(locked.map((r) => r.projectId))]
	for (const pid of projectIds) {
		const project = await getProjectById(tx, actor.workspaceId, pid)
		if (!project) throw new HttpError(404, 'not_found', 'Project not found')
		const acl = await resolveResourceAcl(tx, {
			workspaceId: actor.workspaceId,
			resourceType: 'project',
			resourceId: pid,
			userId: actor.userId
		})
		await authorizeProject(tx, actor, 'issue.write', project, acl)
	}

	const rows = await restoreIssueRows(tx, {
		workspaceId: actor.workspaceId,
		items: body.items.map((it) => ({
			id: it.issueId,
			statusId: it.fields.statusId,
			priority: it.fields.priority,
			assigneeType: it.fields.assigneeType,
			assigneeId: it.fields.assigneeId,
			cycleId: it.fields.cycleId,
			projectKey: byId.get(it.issueId)!.projectKey
		}))
	})
	if (rows.length !== body.items.length) {
		throw new HttpError(422, 'validation_failed', 'A restore status no longer exists in the target project')
	}

	await replaceIssueLabelsForMany(
		tx,
		actor.workspaceId,
		body.items.flatMap((it) => it.fields.labelIds.map((lid) => ({ issueId: it.issueId, labelId: lid })))
	)

	const labelMap = await getLabelMapForIssues(tx, actor.workspaceId, ids)
	const data = rows.map((r) => ({
		...r,
		identifier: `${r.projectKey}-${r.number}`,
		labelIds: labelMap.get(r.id) ?? []
	})) as unknown as IssueDto[]

	const beforeMap = new Map(locked.map((r) => [r.id, r]))
	const events: {
		aggregate: string
		aggregateId: string
		eventType: string
		payload: Record<string, unknown>
	}[] = []
	for (const r of rows) {
		const prev = beforeMap.get(r.id)!
		events.push({
			aggregate: 'issue',
			aggregateId: r.id,
			eventType: TASKS_EVENTS.IssueUpdated,
			payload: {
				issueId: r.id,
				projectId: r.projectId,
				identifier: `${r.projectKey}-${r.number}`,
				title: r.title,
				actorId: actor.principalId,
				bulkRestore: true
			}
		})
		if (r.statusId !== prev.statusId) {
			events.push({
				aggregate: 'issue',
				aggregateId: r.id,
				eventType: TASKS_EVENTS.IssueStatusChanged,
				payload: {
					issueId: r.id,
					projectId: r.projectId,
					identifier: `${r.projectKey}-${r.number}`,
					title: r.title,
					statusId: r.statusId,
					assigneeUserId: r.assigneeType === 'user' ? r.assigneeId : null,
					creatorId: r.creatorId,
					actorType: actor.kind,
					actorId: actor.principalId
				}
			})
		}
	}
	await emitTasksEvents(tx, actor.workspaceId, events)

	const cursor = await appendChanges(
		tx,
		actor.workspaceId,
		data.map((i) => ({
			entityType: 'issue' as const,
			entityId: i.id,
			action: 'upsert' as const,
			scope: [`project:${i.projectId}`],
			payload: i as unknown as Record<string, unknown>,
			actorId: actor.principalId
		}))
	)
	return { data, cursor }
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
