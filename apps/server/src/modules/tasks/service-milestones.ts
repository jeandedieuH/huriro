/**
 * Project milestone service (§3.2): per-project milestone CRUD. Follows
 * the module write invariant — authorization first, optimistic-version
 * validation, domain/outbox/audit/change rows in the one tenant
 * transaction, sync cursor allocated last.
 */
import type {
	CreateProjectMilestoneBody,
	ProjectMilestoneDto,
	UpdateProjectMilestoneBody
} from '@huriro/contracts'
import type { Queryable } from '@huriro/db'
import { type ActorContext, generateKeyBetween } from '@huriro/domain'
import { appendChanges, type ChangeLogEntry } from '../../api/changelog'
import { HttpError } from '../../api/error'
import { TASKS_EVENTS } from './events'
import { auditTasksAction, emitTasksEvent } from './repo'
import {
	deleteProjectMilestoneRow,
	getLastMilestonePosition,
	getProjectMilestoneRow,
	insertProjectMilestoneRow,
	listProjectMilestoneRows,
	updateProjectMilestoneRow
} from './repo-planning'
import { assertValidClientId, requireProjectRead, requireProjectWrite, throwStaleVersion } from './service'

export async function listProjectMilestones(
	tx: Queryable,
	actor: ActorContext,
	projectId: string
): Promise<ProjectMilestoneDto[]> {
	await requireProjectRead(tx, actor, projectId)
	return listProjectMilestoneRows(tx, actor.workspaceId, [projectId])
}

function milestoneChange(
	actor: ActorContext,
	milestone: ProjectMilestoneDto,
	action: 'upsert' | 'delete'
): ChangeLogEntry {
	return {
		entityType: 'project_milestone',
		entityId: milestone.id,
		action,
		scope: [`project:${milestone.projectId}`],
		payload: action === 'delete' ? null : (milestone as unknown as Record<string, unknown>),
		actorId: actor.principalId
	}
}

export async function createProjectMilestone(
	tx: Queryable,
	actor: ActorContext,
	projectId: string,
	input: CreateProjectMilestoneBody
): Promise<{ data: ProjectMilestoneDto; cursor: number }> {
	await requireProjectWrite(tx, actor, projectId)
	assertValidClientId(input.id, 'milestone id')
	const position =
		input.position ??
		generateKeyBetween(await getLastMilestonePosition(tx, actor.workspaceId, projectId), null)
	const milestone = await insertProjectMilestoneRow(tx, {
		id: input.id,
		workspaceId: actor.workspaceId,
		projectId,
		name: input.name.trim(),
		description: input.description ?? '',
		targetDate: input.targetDate ?? null,
		status: input.status ?? 'planned',
		position
	})
	await emitTasksEvent(tx, {
		workspaceId: actor.workspaceId,
		aggregate: 'project_milestone',
		aggregateId: milestone.id,
		eventType: TASKS_EVENTS.ProjectMilestoneCreated,
		payload: { milestoneId: milestone.id, projectId, actorId: actor.principalId }
	})
	await auditTasksAction(tx, {
		workspaceId: actor.workspaceId,
		actorType: actor.kind === 'agent' ? 'agent' : 'user',
		actorId: actor.principalId,
		action: 'project_milestone.create',
		targetType: 'project_milestone',
		targetId: milestone.id,
		metadata: { projectId }
	})
	const cursor = await appendChanges(tx, actor.workspaceId, [milestoneChange(actor, milestone, 'upsert')])
	return { data: milestone, cursor }
}

export async function updateProjectMilestone(
	tx: Queryable,
	actor: ActorContext,
	projectId: string,
	milestoneId: string,
	input: UpdateProjectMilestoneBody
): Promise<{ data: ProjectMilestoneDto; cursor: number }> {
	await requireProjectWrite(tx, actor, projectId)
	const current = await getProjectMilestoneRow(tx, actor.workspaceId, milestoneId)
	if (!current || current.projectId !== projectId)
		throw new HttpError(404, 'not_found', 'Milestone not found')
	if (current.version !== input.version)
		throwStaleVersion(
			'Milestone',
			current.version,
			input.version,
			current as unknown as Record<string, unknown>
		)
	const updated = await updateProjectMilestoneRow(tx, {
		workspaceId: actor.workspaceId,
		milestoneId,
		expectedVersion: input.version,
		name: input.name?.trim() ?? current.name,
		description: input.description ?? current.description,
		targetDate: input.targetDate !== undefined ? input.targetDate : current.targetDate,
		status: input.status ?? current.status,
		position: input.position ?? current.position
	})
	if (!updated)
		throwStaleVersion(
			'Milestone',
			current.version + 1,
			input.version,
			current as unknown as Record<string, unknown>
		)
	await emitTasksEvent(tx, {
		workspaceId: actor.workspaceId,
		aggregate: 'project_milestone',
		aggregateId: milestoneId,
		eventType: TASKS_EVENTS.ProjectMilestoneUpdated,
		payload: { milestoneId, projectId, actorId: actor.principalId }
	})
	await auditTasksAction(tx, {
		workspaceId: actor.workspaceId,
		actorType: actor.kind === 'agent' ? 'agent' : 'user',
		actorId: actor.principalId,
		action: 'project_milestone.update',
		targetType: 'project_milestone',
		targetId: milestoneId,
		metadata: { projectId }
	})
	const cursor = await appendChanges(tx, actor.workspaceId, [milestoneChange(actor, updated, 'upsert')])
	return { data: updated, cursor }
}

export async function deleteProjectMilestone(
	tx: Queryable,
	actor: ActorContext,
	projectId: string,
	milestoneId: string
): Promise<{ cursor: number }> {
	await requireProjectWrite(tx, actor, projectId)
	const current = await getProjectMilestoneRow(tx, actor.workspaceId, milestoneId)
	if (!current || current.projectId !== projectId)
		throw new HttpError(404, 'not_found', 'Milestone not found')
	const deleted = await deleteProjectMilestoneRow(tx, actor.workspaceId, milestoneId)
	if (!deleted) throw new HttpError(404, 'not_found', 'Milestone not found')
	await emitTasksEvent(tx, {
		workspaceId: actor.workspaceId,
		aggregate: 'project_milestone',
		aggregateId: milestoneId,
		eventType: TASKS_EVENTS.ProjectMilestoneDeleted,
		payload: { milestoneId, projectId, actorId: actor.principalId }
	})
	await auditTasksAction(tx, {
		workspaceId: actor.workspaceId,
		actorType: actor.kind === 'agent' ? 'agent' : 'user',
		actorId: actor.principalId,
		action: 'project_milestone.delete',
		targetType: 'project_milestone',
		targetId: milestoneId,
		metadata: { projectId }
	})
	const cursor = await appendChanges(tx, actor.workspaceId, [milestoneChange(actor, current, 'delete')])
	return { cursor }
}
