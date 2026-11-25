/**
 * Bulk issue service (§3.4): set-based single-tx bulk update and undo
 * restore. Same discipline as service.ts: authorize → validate/version →
 * domain rows + outbox events + batched change_log — all inside the
 * caller's `withWorkspace` tx.
 */
import {
	BULK_UNDO_WINDOW_MS,
	type BulkBeforeDto,
	type BulkIssuesBody,
	type BulkIssuesResponse,
	type BulkRestoreBody,
	type IssueDto
} from '@huriro/contracts'
import type { Queryable } from '@huriro/db'
import type { ActorContext } from '@huriro/domain'
import { appendChanges } from '../../api/changelog'
import { HttpError } from '../../api/error'
import { resolveResourceAcl } from '../tenancy'
import { TASKS_EVENTS } from './events'
import { authorizeProject } from './policy'
import {
	addIssueLabelsToMany,
	emitTasksEvents,
	getLabelById,
	getLabelMapForIssues,
	getProjectById,
	getStatusById,
	lockIssuesByIds,
	removeIssueLabelsFromMany,
	replaceIssueLabelsForMany,
	restoreIssueRows,
	updateIssuesSetColumns
} from './repo'
import { isClosedCategory as closedCat, deleteIssue, updateIssue } from './service'

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
