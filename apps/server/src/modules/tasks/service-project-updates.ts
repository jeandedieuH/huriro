/**
 * Project status update service (§3.2): per-project health updates.
 * Follows the module write invariant — authorization first,
 * optimistic-version validation, domain/outbox/audit/change rows in the
 * one tenant transaction, sync cursor allocated last.
 */
import type { CreateProjectUpdateBody, ProjectUpdateDto } from '@huriro/contracts'
import type { Queryable } from '@huriro/db'
import type { ActorContext } from '@huriro/domain'
import { appendChanges } from '../../api/changelog'
import { TASKS_EVENTS } from './events'
import { auditTasksAction, emitTasksEvent } from './repo'
import { getProjectIssueCounts, insertProjectUpdateRow, listProjectUpdateRows } from './repo-planning'
import { assertValidClientId, requireProjectRead, requireProjectWrite } from './service'

export async function listProjectUpdates(
	tx: Queryable,
	actor: ActorContext,
	projectId: string
): Promise<ProjectUpdateDto[]> {
	await requireProjectRead(tx, actor, projectId)
	return listProjectUpdateRows(tx, actor.workspaceId, [projectId])
}

export async function createProjectUpdate(
	tx: Queryable,
	actor: ActorContext,
	projectId: string,
	input: CreateProjectUpdateBody
): Promise<{ data: ProjectUpdateDto; cursor: number }> {
	await requireProjectWrite(tx, actor, projectId)
	assertValidClientId(input.id, 'project update id')
	const counts = await getProjectIssueCounts(tx, actor.workspaceId, projectId)
	const update = await insertProjectUpdateRow(tx, {
		id: input.id,
		workspaceId: actor.workspaceId,
		projectId,
		health: input.health,
		body: input.body ?? null,
		bodyText: input.bodyText ?? '',
		completedIssues: input.completedIssues ?? counts.completedIssues,
		totalIssues: input.totalIssues ?? counts.totalIssues,
		scopeChange: input.scopeChange ?? 0,
		// project_updates.created_by references users.id; for agent writes the
		// accountable owner user is stored, while principalId remains in audit/event attribution.
		createdBy: actor.userId
	})
	await emitTasksEvent(tx, {
		workspaceId: actor.workspaceId,
		aggregate: 'project_update',
		aggregateId: update.id,
		eventType: TASKS_EVENTS.ProjectUpdateCreated,
		payload: { projectUpdateId: update.id, projectId, health: update.health, actorId: actor.principalId }
	})
	await auditTasksAction(tx, {
		workspaceId: actor.workspaceId,
		actorType: actor.kind === 'agent' ? 'agent' : 'user',
		actorId: actor.principalId,
		action: 'project_update.create',
		targetType: 'project_update',
		targetId: update.id,
		metadata: { projectId, health: update.health }
	})
	const cursor = await appendChanges(tx, actor.workspaceId, [
		{
			entityType: 'project_update',
			entityId: update.id,
			action: 'upsert',
			scope: [`project:${projectId}`],
			payload: update as unknown as Record<string, unknown>,
			actorId: actor.principalId
		}
	])
	return { data: update, cursor }
}
