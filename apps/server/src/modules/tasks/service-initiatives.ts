/**
 * Initiative service (§3.2): cross-project initiative CRUD plus the
 * planning snapshot aggregate read. Follows the module write invariant —
 * authorization first, optimistic-version validation, domain/outbox/audit/
 * change rows in the one tenant transaction, sync cursor allocated last.
 */
import type { CreateInitiativeBody, InitiativeDto, UpdateInitiativeBody } from '@huriro/contracts'
import type { Queryable } from '@huriro/db'
import { type ActorContext, generateKeyBetween, generateNKeysBetween } from '@huriro/domain'
import { appendChanges, type ChangeLogEntry } from '../../api/changelog'
import { HttpError } from '../../api/error'
import { TASKS_EVENTS } from './events'
import { authorizeWorkspaceTaskAction } from './policy'
import { auditTasksAction, emitTasksEvent } from './repo'
import {
	deleteInitiativeRow,
	getInitiativeRow,
	getLastInitiativePosition,
	insertInitiativeRow,
	listInitiativeProjectEdges,
	listInitiativeRows,
	listProjectMilestoneRows,
	listProjectUpdateRows,
	replaceInitiativeProjectEdges,
	updateInitiativeRow
} from './repo-planning'
import { assertValidClientId, listAccessibleProjectIds, throwStaleVersion } from './service'

function composeInitiative(
	row: Omit<InitiativeDto, 'projectIds'>,
	edges: readonly { initiativeId: string; projectId: string }[],
	visibleProjectIds: ReadonlySet<string>
): InitiativeDto {
	return {
		...row,
		projectIds: edges
			.filter((e) => e.initiativeId === row.id && visibleProjectIds.has(e.projectId))
			.map((e) => e.projectId)
	}
}

function initiativeChanges(
	actor: ActorContext,
	initiative: InitiativeDto,
	action: 'upsert' | 'delete'
): ChangeLogEntry[] {
	return [
		{
			entityType: 'initiative',
			entityId: initiative.id,
			action,
			scope: ['workspace'],
			payload: action === 'delete' ? null : (initiative as unknown as Record<string, unknown>),
			actorId: actor.principalId
		}
	]
}

async function validateInitiativeProjects(
	tx: Queryable,
	actor: ActorContext,
	projectIds: readonly string[]
): Promise<void> {
	const accessible = await listAccessibleProjectIds(tx, actor)
	const denied = projectIds.filter((id) => !accessible.has(id))
	if (denied.length > 0) {
		throw new HttpError(
			422,
			'validation_failed',
			'Initiative projects must be visible projects in this workspace',
			undefined,
			{
				projectIds: denied
			}
		)
	}
}

export async function listInitiatives(tx: Queryable, actor: ActorContext): Promise<InitiativeDto[]> {
	if (actor.membership !== 'active') return []
	const visibleProjectIds = await listAccessibleProjectIds(tx, actor)
	const [rows, edges] = await Promise.all([
		listInitiativeRows(tx, actor.workspaceId),
		listInitiativeProjectEdges(tx, actor.workspaceId)
	])
	return rows
		.map((row) => composeInitiative(row, edges, visibleProjectIds))
		.filter((initiative) => actor.roleKey !== 'guest' || initiative.projectIds.length > 0)
}

export async function createInitiative(
	tx: Queryable,
	actor: ActorContext,
	input: CreateInitiativeBody
): Promise<{ data: InitiativeDto; cursor: number }> {
	authorizeWorkspaceTaskAction(actor, 'initiative.manage')
	assertValidClientId(input.id, 'initiative id')
	const projectIds = input.projectIds ?? []
	await validateInitiativeProjects(tx, actor, projectIds)
	const position =
		input.position ?? generateKeyBetween(await getLastInitiativePosition(tx, actor.workspaceId), null)
	const row = await insertInitiativeRow(tx, {
		id: input.id,
		workspaceId: actor.workspaceId,
		name: input.name.trim(),
		description: input.description ?? null,
		descriptionText: input.descriptionText ?? '',
		health: input.health ?? 'on_track',
		ownerId: input.ownerId ?? null,
		targetDate: input.targetDate ?? null,
		position
	})
	const positions = generateNKeysBetween(null, null, projectIds.length)
	await replaceInitiativeProjectEdges(tx, {
		workspaceId: actor.workspaceId,
		initiativeId: row.id,
		projectPositions: projectIds.map((projectId, index) => ({ projectId, position: positions[index]! }))
	})
	const initiative = { ...row, projectIds }
	await emitTasksEvent(tx, {
		workspaceId: actor.workspaceId,
		aggregate: 'initiative',
		aggregateId: row.id,
		eventType: TASKS_EVENTS.InitiativeCreated,
		payload: { initiativeId: row.id, projectIds, actorId: actor.principalId }
	})
	await auditTasksAction(tx, {
		workspaceId: actor.workspaceId,
		actorType: actor.kind === 'agent' ? 'agent' : 'user',
		actorId: actor.principalId,
		action: 'initiative.create',
		targetType: 'initiative',
		targetId: row.id,
		metadata: { projectIds }
	})
	const cursor = await appendChanges(tx, actor.workspaceId, initiativeChanges(actor, initiative, 'upsert'))
	return { data: initiative, cursor }
}

export async function updateInitiative(
	tx: Queryable,
	actor: ActorContext,
	initiativeId: string,
	input: UpdateInitiativeBody
): Promise<{ data: InitiativeDto; cursor: number }> {
	authorizeWorkspaceTaskAction(actor, 'initiative.manage')
	const current = await getInitiativeRow(tx, actor.workspaceId, initiativeId)
	if (!current) throw new HttpError(404, 'not_found', 'Initiative not found')
	if (current.version !== input.version)
		throwStaleVersion(
			'Initiative',
			current.version,
			input.version,
			current as unknown as Record<string, unknown>
		)
	const projectIds =
		input.projectIds ??
		(await listInitiativeProjectEdges(tx, actor.workspaceId))
			.filter((e) => e.initiativeId === initiativeId)
			.map((e) => e.projectId)
	await validateInitiativeProjects(tx, actor, projectIds)
	const updated = await updateInitiativeRow(tx, {
		workspaceId: actor.workspaceId,
		initiativeId,
		expectedVersion: input.version,
		name: input.name?.trim() ?? current.name,
		description: input.description !== undefined ? input.description : current.description,
		descriptionText: input.descriptionText ?? current.descriptionText,
		health: input.health ?? current.health,
		ownerId: input.ownerId !== undefined ? input.ownerId : current.ownerId,
		targetDate: input.targetDate !== undefined ? input.targetDate : current.targetDate,
		position: input.position ?? current.position
	})
	if (!updated)
		throwStaleVersion(
			'Initiative',
			current.version + 1,
			input.version,
			current as unknown as Record<string, unknown>
		)
	if (input.projectIds !== undefined) {
		const positions = generateNKeysBetween(null, null, projectIds.length)
		await replaceInitiativeProjectEdges(tx, {
			workspaceId: actor.workspaceId,
			initiativeId,
			projectPositions: projectIds.map((projectId, index) => ({ projectId, position: positions[index]! }))
		})
	}
	const initiative = { ...updated, projectIds }
	await emitTasksEvent(tx, {
		workspaceId: actor.workspaceId,
		aggregate: 'initiative',
		aggregateId: initiativeId,
		eventType: TASKS_EVENTS.InitiativeUpdated,
		payload: { initiativeId, projectIds, actorId: actor.principalId }
	})
	await auditTasksAction(tx, {
		workspaceId: actor.workspaceId,
		actorType: actor.kind === 'agent' ? 'agent' : 'user',
		actorId: actor.principalId,
		action: 'initiative.update',
		targetType: 'initiative',
		targetId: initiativeId,
		metadata: { projectIds }
	})
	const cursor = await appendChanges(tx, actor.workspaceId, initiativeChanges(actor, initiative, 'upsert'))
	return { data: initiative, cursor }
}

export async function deleteInitiative(
	tx: Queryable,
	actor: ActorContext,
	initiativeId: string
): Promise<{ cursor: number }> {
	authorizeWorkspaceTaskAction(actor, 'initiative.manage')
	const deleted = await deleteInitiativeRow(tx, actor.workspaceId, initiativeId)
	if (!deleted) throw new HttpError(404, 'not_found', 'Initiative not found')
	await emitTasksEvent(tx, {
		workspaceId: actor.workspaceId,
		aggregate: 'initiative',
		aggregateId: initiativeId,
		eventType: TASKS_EVENTS.InitiativeDeleted,
		payload: { initiativeId, actorId: actor.principalId }
	})
	await auditTasksAction(tx, {
		workspaceId: actor.workspaceId,
		actorType: actor.kind === 'agent' ? 'agent' : 'user',
		actorId: actor.principalId,
		action: 'initiative.delete',
		targetType: 'initiative',
		targetId: initiativeId,
		metadata: {}
	})
	const cursor = await appendChanges(
		tx,
		actor.workspaceId,
		initiativeChanges(actor, { ...deleted, projectIds: [] }, 'delete')
	)
	return { cursor }
}

export async function getPlanningSnapshotData(tx: Queryable, actor: ActorContext) {
	const visibleProjectIds = [...(await listAccessibleProjectIds(tx, actor))]
	const [initiatives, projectMilestones, projectUpdates] = await Promise.all([
		listInitiatives(tx, actor),
		listProjectMilestoneRows(tx, actor.workspaceId, visibleProjectIds),
		listProjectUpdateRows(tx, actor.workspaceId, visibleProjectIds)
	])
	return { initiatives, projectMilestones, projectUpdates }
}
