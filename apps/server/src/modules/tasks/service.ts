/**
 * Tasks domain service (§5.3, §7.3):
 *   authorize → validate/check version → write domain rows + outbox + audit
 *   → allocate sync cursor LAST in the same transaction.
 */
import type {
	CreateCycleBody,
	CreateIssueBody,
	CreateIssueCommentBody,
	CreateIssueRelationBody,
	CreateLabelBody,
	CreateProjectBody,
	CreateSavedViewBody,
	CreateStatusBody,
	CycleDto,
	IssueCommentDto,
	IssueDto,
	IssueRelationDto,
	LabelDto,
	ListIssuesQuery,
	MoveIssueBody,
	ProjectDto,
	ProjectStatusDto,
	SavedViewDto,
	UpdateCycleBody,
	UpdateIssueBody,
	UpdateIssueCommentBody,
	UpdateLabelBody,
	UpdateProjectBody,
	UpdateSavedViewBody,
	UpdateStatusBody
} from '@huriro/contracts'
import { decodeCursor, encodeCursor } from '@huriro/contracts'
import { isAcceptableClientId, type Queryable } from '@huriro/db'
import {
	type ActorContext,
	generateKeyBetween,
	generateNKeysBetween,
	needsRebalance,
	rebalanceKeys
} from '@huriro/domain'
import { appendChange, appendChanges, type ChangeLogEntry } from '../../api/changelog'
import { HttpError } from '../../api/error'
import { grantAcl, resolveResourceAcl } from '../tenancy'
import { TASKS_EVENTS } from './events'
import { authorizeProject, authorizeWorkspaceTaskAction, isAdminProjectBypass } from './policy'
import {
	allocateIssueNumber,
	auditTasksAction,
	deleteIssueRelationRow,
	deleteSavedViewRow,
	emitTasksEvent,
	getCycleById,
	getDefaultStatusForProject,
	getIssueById,
	getIssueByKey,
	getIssueCommentById,
	getLabelById,
	getLastIssuePositionInColumn,
	getLastProjectPosition,
	getProjectById,
	getProjectByKey,
	getSavedViewById,
	getStatusById,
	insertCycleRow,
	insertIssueCommentRow,
	insertIssueRelationRow,
	insertIssueRow,
	insertLabelRow,
	insertProject,
	insertSavedViewRow,
	insertStatusRow,
	listColumnIssueIdsAndPositions,
	listCyclesForProjects,
	listIssueComments,
	listIssueRelations,
	listIssuesFiltered,
	listLabels,
	listSavedViewsForUser,
	listStatusesForProject,
	listVisibleProjects,
	listVisibleStatuses,
	replaceIssueLabelsRows,
	softDeleteIssueRow,
	updateCycleRow,
	updateIssueCommentRow,
	updateIssuePositionOnly,
	updateIssueRow,
	updateLabelRow,
	updateProjectRow,
	updateSavedViewRow,
	updateStatusRow
} from './repo'

const DEFAULT_STATUS_TEMPLATES = [
	{ name: 'Backlog', category: 'backlog', color: 'neutral', isDefault: false },
	{ name: 'Todo', category: 'unstarted', color: 'info', isDefault: true },
	{ name: 'In Progress', category: 'started', color: 'warning', isDefault: false },
	{ name: 'Done', category: 'completed', color: 'success', isDefault: false },
	{ name: 'Canceled', category: 'cancelled', color: 'danger', isDefault: false }
] as const

const MENTION_RE = /@([a-zA-Z0-9._+-]+@[a-zA-Z0-9.-]+\.[a-zA-Z]{2,}|[a-zA-Z0-9._-]{2,})/g

function extractMentions(text: string): string[] {
	const found = new Set<string>()
	for (const match of text.matchAll(MENTION_RE)) {
		if (match[1]) found.add(match[1].toLowerCase())
	}
	return [...found]
}

function assertValidClientId(id: string | undefined, label: string): void {
	if (id !== undefined && !isAcceptableClientId(id)) {
		throw new HttpError(
			422,
			'validation_failed',
			`Invalid client-supplied ${label}: must be UUIDv7 within ±24h window`
		)
	}
}

function throwStaleVersion(
	entityLabel: string,
	currentVersion: number,
	yourVersion: number,
	currentEntity: Record<string, unknown>,
	changedFields?: string[]
): never {
	throw new HttpError(409, 'stale_version', `${entityLabel} changed since you loaded it`, undefined, {
		currentVersion,
		yourVersion,
		currentEntity,
		...(changedFields ? { changedFields } : {})
	})
}

function computeChangedKeys(before: Record<string, unknown>, after: Record<string, unknown>): string[] {
	const changed: string[] = []
	for (const k of Object.keys(before)) {
		if (JSON.stringify(before[k]) !== JSON.stringify(after[k])) {
			changed.push(k)
		}
	}
	return changed
}

function isClosedCategory(category: ProjectStatusDto['category']): boolean {
	return category === 'completed' || category === 'cancelled'
}

export async function listAccessibleProjects(tx: Queryable, actor: ActorContext): Promise<ProjectDto[]> {
	if (actor.membership !== 'active') return []
	return listVisibleProjects(tx, {
		workspaceId: actor.workspaceId,
		userId: actor.principalId,
		isGuest: actor.roleKey === 'guest',
		bypassAcl: isAdminProjectBypass(actor)
	})
}

export async function listAccessibleProjectIds(tx: Queryable, actor: ActorContext): Promise<Set<string>> {
	const visible = await listAccessibleProjects(tx, actor)
	return new Set(visible.map((p) => p.id))
}

async function requireProjectRead(
	tx: Queryable,
	actor: ActorContext,
	projectId: string
): Promise<ProjectDto> {
	const project = await getProjectById(tx, actor.workspaceId, projectId)
	if (!project) throw new HttpError(404, 'not_found', 'Project not found')
	const acl = await resolveResourceAcl(tx, {
		workspaceId: actor.workspaceId,
		resourceType: 'project',
		resourceId: project.id,
		userId: actor.principalId
	})
	await authorizeProject(tx, actor, 'project.read', project, acl)
	return project
}

// ---------- Projects ----------

export async function createProject(
	tx: Queryable,
	actor: ActorContext,
	input: CreateProjectBody
): Promise<{ readonly data: ProjectDto; readonly statuses: ProjectStatusDto[]; readonly cursor: number }> {
	authorizeWorkspaceTaskAction(actor, 'project.write')
	assertValidClientId(input.id, 'project id')

	const existing = await getProjectByKey(tx, actor.workspaceId, input.key)
	if (existing) {
		throw new HttpError(409, 'conflict', `Project key "${input.key}" already exists`)
	}

	const lastPos = await getLastProjectPosition(tx, actor.workspaceId)
	const position = input.position ?? generateKeyBetween(lastPos, null)
	const visibility = input.visibility ?? 'workspace'

	const project = await insertProject(tx, {
		id: input.id,
		workspaceId: actor.workspaceId,
		key: input.key,
		name: input.name.trim(),
		description: input.description ?? '',
		visibility,
		position,
		createdBy: actor.principalId
	})

	const statusKeys = generateNKeysBetween(null, null, DEFAULT_STATUS_TEMPLATES.length)
	const statuses: ProjectStatusDto[] = []
	for (let i = 0; i < DEFAULT_STATUS_TEMPLATES.length; i++) {
		const tpl = DEFAULT_STATUS_TEMPLATES[i]!
		const st = await insertStatusRow(tx, {
			workspaceId: actor.workspaceId,
			projectId: project.id,
			name: tpl.name,
			category: tpl.category,
			color: tpl.color,
			position: statusKeys[i]!,
			isDefault: tpl.isDefault
		})
		statuses.push(st)
	}

	if (visibility === 'private') {
		await grantAcl(tx, {
			workspaceId: actor.workspaceId,
			resourceType: 'project',
			resourceId: project.id,
			principalType: 'user',
			principalId: actor.principalId,
			permission: 'manage',
			grantedBy: actor.principalId
		})
	}

	await emitTasksEvent(tx, {
		workspaceId: actor.workspaceId,
		aggregate: 'project',
		aggregateId: project.id,
		eventType: TASKS_EVENTS.ProjectCreated,
		payload: {
			projectId: project.id,
			key: project.key,
			name: project.name,
			description: project.description,
			visibility: project.visibility,
			actorId: actor.principalId
		}
	})

	await auditTasksAction(tx, {
		workspaceId: actor.workspaceId,
		actorType: actor.kind === 'agent' ? 'agent' : 'user',
		actorId: actor.principalId,
		action: 'project.create',
		targetType: 'project',
		targetId: project.id,
		metadata: { key: project.key, visibility: project.visibility }
	})

	const scope = [`project:${project.id}`]
	const changes: ChangeLogEntry[] = [
		{
			entityType: 'project',
			entityId: project.id,
			action: 'upsert',
			scope,
			payload: project as unknown as Record<string, unknown>,
			actorId: actor.principalId
		},
		...statuses.map(
			(s): ChangeLogEntry => ({
				entityType: 'project_status',
				entityId: s.id,
				action: 'upsert',
				scope,
				payload: s as unknown as Record<string, unknown>,
				actorId: actor.principalId
			})
		)
	]
	const cursor = await appendChanges(tx, actor.workspaceId, changes)

	return { data: project, statuses, cursor }
}

export async function updateProject(
	tx: Queryable,
	actor: ActorContext,
	projectId: string,
	input: UpdateProjectBody
): Promise<{ readonly data: ProjectDto; readonly cursor: number }> {
	const current = await getProjectById(tx, actor.workspaceId, projectId)
	if (!current) throw new HttpError(404, 'not_found', 'Project not found')

	const acl = await resolveResourceAcl(tx, {
		workspaceId: actor.workspaceId,
		resourceType: 'project',
		resourceId: projectId,
		userId: actor.principalId
	})
	await authorizeProject(
		tx,
		actor,
		input.visibility !== undefined && input.visibility !== current.visibility
			? 'project.manage'
			: 'project.write',
		current,
		acl
	)

	if (current.version !== input.version) {
		throwStaleVersion(
			'Project',
			current.version,
			input.version,
			current as unknown as Record<string, unknown>
		)
	}

	const nextVisibility = input.visibility ?? current.visibility
	const nextArchivedAt =
		input.archived === undefined
			? current.archivedAt
			: input.archived
				? (current.archivedAt ?? new Date().toISOString())
				: null

	const updated = await updateProjectRow(tx, {
		workspaceId: actor.workspaceId,
		projectId,
		expectedVersion: input.version,
		name: input.name?.trim() ?? current.name,
		description: input.description ?? current.description,
		visibility: nextVisibility,
		archivedAt: nextArchivedAt
	})
	if (!updated) {
		const latest = await getProjectById(tx, actor.workspaceId, projectId)
		throwStaleVersion(
			'Project',
			latest?.version ?? current.version + 1,
			input.version,
			(latest ?? current) as unknown as Record<string, unknown>
		)
	}

	// Ensure updater retains manage ACL if flipping workspace -> private so they aren't locked out.
	if (current.visibility === 'workspace' && nextVisibility === 'private') {
		await grantAcl(tx, {
			workspaceId: actor.workspaceId,
			resourceType: 'project',
			resourceId: projectId,
			principalType: 'user',
			principalId: actor.principalId,
			permission: 'manage',
			grantedBy: actor.principalId
		})
	}

	await emitTasksEvent(tx, {
		workspaceId: actor.workspaceId,
		aggregate: 'project',
		aggregateId: updated.id,
		eventType: TASKS_EVENTS.ProjectUpdated,
		payload: {
			projectId: updated.id,
			key: updated.key,
			name: updated.name,
			description: updated.description,
			visibility: updated.visibility,
			actorId: actor.principalId
		}
	})

	if (current.visibility !== nextVisibility) {
		await emitTasksEvent(tx, {
			workspaceId: actor.workspaceId,
			aggregate: 'project',
			aggregateId: updated.id,
			eventType: TASKS_EVENTS.ProjectVisibilityChanged,
			payload: {
				projectId: updated.id,
				from: current.visibility,
				to: nextVisibility,
				actorId: actor.principalId
			}
		})
		await auditTasksAction(tx, {
			workspaceId: actor.workspaceId,
			actorType: actor.kind === 'agent' ? 'agent' : 'user',
			actorId: actor.principalId,
			action: 'project.visibility_change',
			targetType: 'project',
			targetId: updated.id,
			metadata: { from: current.visibility, to: nextVisibility }
		})
	}

	const scope = [`project:${updated.id}`]
	const changes: ChangeLogEntry[] = []
	if (current.visibility === 'workspace' && nextVisibility === 'private') {
		changes.push({
			entityType: 'project',
			entityId: updated.id,
			action: 'revoke',
			scope,
			payload: { resourceType: 'project', resourceId: updated.id, previousVisibility: 'workspace' },
			actorId: actor.principalId
		})
	} else if (current.visibility === 'private' && nextVisibility === 'workspace') {
		changes.push({
			entityType: 'project',
			entityId: updated.id,
			action: 'grant',
			scope,
			payload: { resourceType: 'project', resourceId: updated.id, visibility: 'workspace' },
			actorId: actor.principalId
		})
	}
	changes.push({
		entityType: 'project',
		entityId: updated.id,
		action: 'upsert',
		scope,
		payload: {
			...(updated as unknown as Record<string, unknown>),
			...(current.visibility !== nextVisibility ? { previousVisibility: current.visibility } : {})
		},
		actorId: actor.principalId
	})
	const cursor = await appendChanges(tx, actor.workspaceId, changes)

	return { data: updated, cursor }
}

// ---------- Statuses ----------

export async function listProjectStatuses(
	tx: Queryable,
	actor: ActorContext,
	projectId: string
): Promise<ProjectStatusDto[]> {
	await requireProjectRead(tx, actor, projectId)
	return listStatusesForProject(tx, actor.workspaceId, projectId)
}

export async function createProjectStatus(
	tx: Queryable,
	actor: ActorContext,
	projectId: string,
	input: CreateStatusBody
): Promise<{ readonly data: ProjectStatusDto; readonly cursor: number }> {
	const project = await getProjectById(tx, actor.workspaceId, projectId)
	if (!project) throw new HttpError(404, 'not_found', 'Project not found')
	const acl = await resolveResourceAcl(tx, {
		workspaceId: actor.workspaceId,
		resourceType: 'project',
		resourceId: projectId,
		userId: actor.principalId
	})
	await authorizeProject(tx, actor, 'project.write', project, acl)

	const existing = await listStatusesForProject(tx, actor.workspaceId, projectId)
	const lastPos = existing.at(-1)?.position ?? null
	const position = input.position ?? generateKeyBetween(lastPos, null)

	const created = await insertStatusRow(tx, {
		workspaceId: actor.workspaceId,
		projectId,
		name: input.name.trim(),
		category: input.category,
		color: input.color ?? 'neutral',
		position,
		isDefault: input.isDefault ?? false
	})

	await emitTasksEvent(tx, {
		workspaceId: actor.workspaceId,
		aggregate: 'project_status',
		aggregateId: created.id,
		eventType: TASKS_EVENTS.StatusCreated,
		payload: { statusId: created.id, projectId, name: created.name }
	})

	const cursor = await appendChange(tx, actor.workspaceId, {
		entityType: 'project_status',
		entityId: created.id,
		action: 'upsert',
		scope: [`project:${projectId}`],
		payload: created as unknown as Record<string, unknown>,
		actorId: actor.principalId
	})
	return { data: created, cursor }
}

export async function updateProjectStatus(
	tx: Queryable,
	actor: ActorContext,
	statusId: string,
	input: UpdateStatusBody
): Promise<{ readonly data: ProjectStatusDto; readonly cursor: number }> {
	const current = await getStatusById(tx, actor.workspaceId, statusId)
	if (!current) throw new HttpError(404, 'not_found', 'Status not found')
	const project = await getProjectById(tx, actor.workspaceId, current.projectId)
	if (!project) throw new HttpError(404, 'not_found', 'Project not found')

	const acl = await resolveResourceAcl(tx, {
		workspaceId: actor.workspaceId,
		resourceType: 'project',
		resourceId: project.id,
		userId: actor.principalId
	})
	await authorizeProject(tx, actor, 'project.write', project, acl)

	if (current.version !== input.version) {
		throwStaleVersion('Status', current.version, input.version, current as unknown as Record<string, unknown>)
	}

	const updated = await updateStatusRow(tx, {
		workspaceId: actor.workspaceId,
		statusId,
		projectId: project.id,
		expectedVersion: input.version,
		name: input.name?.trim() ?? current.name,
		category: input.category ?? current.category,
		color: input.color ?? current.color,
		position: input.position ?? current.position,
		isDefault: input.isDefault ?? current.isDefault
	})
	if (!updated) {
		throwStaleVersion(
			'Status',
			current.version + 1,
			input.version,
			current as unknown as Record<string, unknown>
		)
	}

	await emitTasksEvent(tx, {
		workspaceId: actor.workspaceId,
		aggregate: 'project_status',
		aggregateId: updated.id,
		eventType: TASKS_EVENTS.StatusUpdated,
		payload: { statusId: updated.id, projectId: project.id, name: updated.name }
	})

	const cursor = await appendChange(tx, actor.workspaceId, {
		entityType: 'project_status',
		entityId: updated.id,
		action: 'upsert',
		scope: [`project:${project.id}`],
		payload: updated as unknown as Record<string, unknown>,
		actorId: actor.principalId
	})
	return { data: updated, cursor }
}

// ---------- Labels ----------

export async function listWorkspaceLabels(tx: Queryable, actor: ActorContext): Promise<LabelDto[]> {
	if (actor.membership !== 'active') throw new HttpError(403, 'not_workspace_member', 'Membership required')
	return listLabels(tx, actor.workspaceId)
}

export async function createLabel(
	tx: Queryable,
	actor: ActorContext,
	input: CreateLabelBody
): Promise<{ readonly data: LabelDto; readonly cursor: number }> {
	authorizeWorkspaceTaskAction(actor, 'issue.write')
	const created = await insertLabelRow(tx, {
		workspaceId: actor.workspaceId,
		name: input.name.trim(),
		color: input.color ?? 'neutral'
	})
	await emitTasksEvent(tx, {
		workspaceId: actor.workspaceId,
		aggregate: 'label',
		aggregateId: created.id,
		eventType: TASKS_EVENTS.LabelCreated,
		payload: { labelId: created.id, name: created.name }
	})
	const cursor = await appendChange(tx, actor.workspaceId, {
		entityType: 'label',
		entityId: created.id,
		action: 'upsert',
		scope: [],
		payload: created as unknown as Record<string, unknown>,
		actorId: actor.principalId
	})
	return { data: created, cursor }
}

export async function updateLabel(
	tx: Queryable,
	actor: ActorContext,
	labelId: string,
	input: UpdateLabelBody
): Promise<{ readonly data: LabelDto; readonly cursor: number }> {
	authorizeWorkspaceTaskAction(actor, 'issue.write')
	const current = await getLabelById(tx, actor.workspaceId, labelId)
	if (!current) throw new HttpError(404, 'not_found', 'Label not found')
	if (current.version !== input.version) {
		throwStaleVersion('Label', current.version, input.version, current as unknown as Record<string, unknown>)
	}
	const updated = await updateLabelRow(tx, {
		workspaceId: actor.workspaceId,
		labelId,
		expectedVersion: input.version,
		name: input.name?.trim() ?? current.name,
		color: input.color ?? current.color
	})
	if (!updated) {
		throwStaleVersion(
			'Label',
			current.version + 1,
			input.version,
			current as unknown as Record<string, unknown>
		)
	}
	await emitTasksEvent(tx, {
		workspaceId: actor.workspaceId,
		aggregate: 'label',
		aggregateId: updated.id,
		eventType: TASKS_EVENTS.LabelUpdated,
		payload: { labelId: updated.id, name: updated.name }
	})
	const cursor = await appendChange(tx, actor.workspaceId, {
		entityType: 'label',
		entityId: updated.id,
		action: 'upsert',
		scope: [],
		payload: updated as unknown as Record<string, unknown>,
		actorId: actor.principalId
	})
	return { data: updated, cursor }
}

// ---------- Cycles ----------

export async function listCycles(
	tx: Queryable,
	actor: ActorContext,
	projectId?: string
): Promise<CycleDto[]> {
	if (projectId) {
		await requireProjectRead(tx, actor, projectId)
		return listCyclesForProjects(tx, actor.workspaceId, [projectId])
	}
	const projects = await listAccessibleProjects(tx, actor)
	return listCyclesForProjects(
		tx,
		actor.workspaceId,
		projects.map((p) => p.id)
	)
}

export async function createCycle(
	tx: Queryable,
	actor: ActorContext,
	input: CreateCycleBody
): Promise<{ readonly data: CycleDto; readonly cursor: number }> {
	const project = await getProjectById(tx, actor.workspaceId, input.projectId)
	if (!project) throw new HttpError(404, 'not_found', 'Project not found')
	const acl = await resolveResourceAcl(tx, {
		workspaceId: actor.workspaceId,
		resourceType: 'project',
		resourceId: project.id,
		userId: actor.principalId
	})
	await authorizeProject(tx, actor, 'project.write', project, acl)

	if (input.endsAt < input.startsAt) {
		throw new HttpError(422, 'validation_failed', 'Cycle end date must be on or after start date')
	}

	const created = await insertCycleRow(tx, {
		workspaceId: actor.workspaceId,
		projectId: project.id,
		name: input.name.trim(),
		description: input.description ?? '',
		status: input.status ?? 'planned',
		startsAt: input.startsAt,
		endsAt: input.endsAt
	})
	await emitTasksEvent(tx, {
		workspaceId: actor.workspaceId,
		aggregate: 'cycle',
		aggregateId: created.id,
		eventType: TASKS_EVENTS.CycleCreated,
		payload: { cycleId: created.id, projectId: project.id, name: created.name }
	})
	const cursor = await appendChange(tx, actor.workspaceId, {
		entityType: 'cycle',
		entityId: created.id,
		action: 'upsert',
		scope: [`project:${project.id}`],
		payload: created as unknown as Record<string, unknown>,
		actorId: actor.principalId
	})
	return { data: created, cursor }
}

export async function updateCycle(
	tx: Queryable,
	actor: ActorContext,
	cycleId: string,
	input: UpdateCycleBody
): Promise<{ readonly data: CycleDto; readonly cursor: number }> {
	const current = await getCycleById(tx, actor.workspaceId, cycleId)
	if (!current) throw new HttpError(404, 'not_found', 'Cycle not found')
	const project = await getProjectById(tx, actor.workspaceId, current.projectId)
	if (!project) throw new HttpError(404, 'not_found', 'Project not found')
	const acl = await resolveResourceAcl(tx, {
		workspaceId: actor.workspaceId,
		resourceType: 'project',
		resourceId: project.id,
		userId: actor.principalId
	})
	await authorizeProject(tx, actor, 'project.write', project, acl)

	if (current.version !== input.version) {
		throwStaleVersion('Cycle', current.version, input.version, current as unknown as Record<string, unknown>)
	}
	const startsAt = input.startsAt ?? current.startsAt
	const endsAt = input.endsAt ?? current.endsAt
	if (endsAt < startsAt) {
		throw new HttpError(422, 'validation_failed', 'Cycle end date must be on or after start date')
	}

	const updated = await updateCycleRow(tx, {
		workspaceId: actor.workspaceId,
		cycleId,
		expectedVersion: input.version,
		name: input.name?.trim() ?? current.name,
		description: input.description ?? current.description,
		status: input.status ?? current.status,
		startsAt,
		endsAt
	})
	if (!updated) {
		throwStaleVersion(
			'Cycle',
			current.version + 1,
			input.version,
			current as unknown as Record<string, unknown>
		)
	}

	await emitTasksEvent(tx, {
		workspaceId: actor.workspaceId,
		aggregate: 'cycle',
		aggregateId: updated.id,
		eventType: TASKS_EVENTS.CycleUpdated,
		payload: { cycleId: updated.id, projectId: project.id, name: updated.name }
	})
	const cursor = await appendChange(tx, actor.workspaceId, {
		entityType: 'cycle',
		entityId: updated.id,
		action: 'upsert',
		scope: [`project:${project.id}`],
		payload: updated as unknown as Record<string, unknown>,
		actorId: actor.principalId
	})
	return { data: updated, cursor }
}

// ---------- Issues ----------

export async function listIssues(
	tx: Queryable,
	actor: ActorContext,
	query: ListIssuesQuery
): Promise<{ readonly data: IssueDto[]; readonly nextCursor: string | null; readonly hasMore: boolean }> {
	if (actor.membership !== 'active') {
		throw new HttpError(403, 'not_workspace_member', 'Active workspace membership required')
	}

	let visibleIds: string[]
	if (query.projectId) {
		await requireProjectRead(tx, actor, query.projectId)
		visibleIds = [query.projectId]
	} else {
		const projects = await listAccessibleProjects(tx, actor)
		visibleIds = projects.map((p) => p.id)
	}

	const cursorPos = decodeCursor<{ position: string; id: string }>(query.cursor)
	const limit = query.limit ?? 50
	const res = await listIssuesFiltered(tx, {
		workspaceId: actor.workspaceId,
		visibleProjectIds: visibleIds,
		projectId: query.projectId,
		statusId: query.statusId,
		assigneeId: query.assigneeId,
		cycleId: query.cycleId,
		parentId: query.parentId,
		priority: query.priority,
		mineUserId: query.mine ? actor.principalId : undefined,
		q: query.q,
		cursorPos,
		limit
	})

	const last = res.items.at(-1)
	const nextCursor = res.hasMore && last ? encodeCursor({ position: last.position, id: last.id }) : null
	return { data: res.items, nextCursor, hasMore: res.hasMore }
}

export async function getIssueDetail(
	tx: Queryable,
	actor: ActorContext,
	issueId: string
): Promise<{
	readonly issue: IssueDto
	readonly relations: IssueRelationDto[]
	readonly comments: IssueCommentDto[]
	readonly subIssues: IssueDto[]
}> {
	const issue = await getIssueById(tx, actor.workspaceId, issueId)
	if (!issue) throw new HttpError(404, 'not_found', 'Issue not found')
	await requireProjectRead(tx, actor, issue.projectId)

	const [relations, comments, subRes] = await Promise.all([
		listIssueRelations(tx, actor.workspaceId, issue.id),
		listIssueComments(tx, actor.workspaceId, issue.id),
		listIssuesFiltered(tx, {
			workspaceId: actor.workspaceId,
			visibleProjectIds: [issue.projectId],
			parentId: issue.id,
			limit: 100
		})
	])

	return { issue, relations, comments, subIssues: subRes.items }
}

export async function getIssueByIdentifier(
	tx: Queryable,
	actor: ActorContext,
	identifier: string
): Promise<IssueDto> {
	const m = /^([A-Z][A-Z0-9]{1,9})-(\d+)$/i.exec(identifier.trim())
	if (!m) throw new HttpError(404, 'not_found', `Unknown issue identifier "${identifier}"`)
	const projectKey = (m[1] ?? '').toUpperCase()
	const number = Number.parseInt(m[2] ?? '', 10)
	const issue = await getIssueByKey(tx, actor.workspaceId, projectKey, number)
	if (!issue) throw new HttpError(404, 'not_found', `Issue ${identifier} not found`)
	await requireProjectRead(tx, actor, issue.projectId)
	return issue
}

export async function createIssue(
	tx: Queryable,
	actor: ActorContext,
	input: CreateIssueBody,
	opts?: { readonly skipChangeLog?: boolean }
): Promise<{ readonly data: IssueDto; readonly cursor: number }> {
	assertValidClientId(input.id, 'issue id')
	const project = await getProjectById(tx, actor.workspaceId, input.projectId)
	if (!project) throw new HttpError(404, 'not_found', 'Project not found')
	const acl = await resolveResourceAcl(tx, {
		workspaceId: actor.workspaceId,
		resourceType: 'project',
		resourceId: project.id,
		userId: actor.principalId
	})
	await authorizeProject(tx, actor, 'issue.write', project, acl)

	const status = input.statusId
		? await getStatusById(tx, actor.workspaceId, input.statusId)
		: await getDefaultStatusForProject(tx, actor.workspaceId, project.id)
	if (!status || status.projectId !== project.id) {
		throw new HttpError(422, 'validation_failed', 'Invalid status for target project')
	}

	if (input.parentId) {
		const parent = await getIssueById(tx, actor.workspaceId, input.parentId)
		if (!parent || parent.projectId !== project.id) {
			throw new HttpError(422, 'validation_failed', 'Parent issue must exist in the same project')
		}
	}

	const assigneeType = input.assigneeId ? (input.assigneeType ?? 'user') : null
	const assigneeId = input.assigneeId ?? null
	if (assigneeId === null && input.assigneeType) {
		throw new HttpError(422, 'validation_failed', 'assigneeId is required when assigneeType is set')
	}

	const lastPos = await getLastIssuePositionInColumn(tx, actor.workspaceId, project.id, status.id)
	const position = input.position ?? generateKeyBetween(lastPos, null)
	const number = await allocateIssueNumber(tx, actor.workspaceId, project.id)
	const closedAt = isClosedCategory(status.category) ? new Date().toISOString() : null

	const created = await insertIssueRow(tx, {
		id: input.id,
		workspaceId: actor.workspaceId,
		projectId: project.id,
		projectKey: project.key,
		number,
		parentId: input.parentId ?? null,
		cycleId: input.cycleId ?? null,
		title: input.title.trim(),
		description: input.description ?? null,
		descriptionText: input.descriptionText ?? '',
		statusId: status.id,
		priority: input.priority ?? 0,
		assigneeType,
		assigneeId,
		creatorId: actor.principalId,
		position,
		startDate: input.startDate ?? null,
		dueDate: input.dueDate ?? null,
		estimate: input.estimate ?? null,
		closedAt,
		labelIds: input.labelIds ?? []
	})

	await emitTasksEvent(tx, {
		workspaceId: actor.workspaceId,
		aggregate: 'issue',
		aggregateId: created.id,
		eventType: TASKS_EVENTS.IssueCreated,
		payload: {
			issueId: created.id,
			projectId: project.id,
			identifier: created.identifier,
			title: created.title,
			descriptionText: created.descriptionText,
			actorId: actor.principalId
		}
	})

	if (created.assigneeType === 'user' && created.assigneeId) {
		await emitTasksEvent(tx, {
			workspaceId: actor.workspaceId,
			aggregate: 'issue',
			aggregateId: created.id,
			eventType: TASKS_EVENTS.IssueAssigned,
			payload: {
				issueId: created.id,
				projectId: project.id,
				identifier: created.identifier,
				title: created.title,
				assigneeUserId: created.assigneeId,
				actorType: actor.kind,
				actorId: actor.principalId
			}
		})
	}

	await auditTasksAction(tx, {
		workspaceId: actor.workspaceId,
		actorType: actor.kind === 'agent' ? 'agent' : 'user',
		actorId: actor.principalId,
		action: 'issue.create',
		targetType: 'issue',
		targetId: created.id,
		metadata: { identifier: created.identifier, projectId: project.id }
	})

	const cursor = opts?.skipChangeLog
		? 0
		: await appendChange(tx, actor.workspaceId, {
				entityType: 'issue',
				entityId: created.id,
				action: 'upsert',
				scope: [`project:${project.id}`],
				payload: created as unknown as Record<string, unknown>,
				actorId: actor.principalId
			})

	return { data: created, cursor }
}

export async function updateIssue(
	tx: Queryable,
	actor: ActorContext,
	issueId: string,
	input: UpdateIssueBody
): Promise<{ readonly data: IssueDto; readonly cursor: number }> {
	const current = await getIssueById(tx, actor.workspaceId, issueId)
	if (!current) throw new HttpError(404, 'not_found', 'Issue not found')
	const project = await getProjectById(tx, actor.workspaceId, current.projectId)
	if (!project) throw new HttpError(404, 'not_found', 'Project not found')

	const acl = await resolveResourceAcl(tx, {
		workspaceId: actor.workspaceId,
		resourceType: 'project',
		resourceId: project.id,
		userId: actor.principalId
	})
	await authorizeProject(tx, actor, 'issue.write', project, acl)

	if (current.version !== input.version) {
		throwStaleVersion(
			`Issue ${current.identifier}`,
			current.version,
			input.version,
			current as unknown as Record<string, unknown>
		)
	}

	let targetProject = project
	let nextNumber: number | undefined
	let scopeMovedFromProjectId: string | undefined
	if (input.projectId && input.projectId !== current.projectId) {
		const dest = await getProjectById(tx, actor.workspaceId, input.projectId)
		if (!dest) throw new HttpError(404, 'not_found', 'Target project not found')
		const destAcl = await resolveResourceAcl(tx, {
			workspaceId: actor.workspaceId,
			resourceType: 'project',
			resourceId: dest.id,
			userId: actor.principalId
		})
		await authorizeProject(tx, actor, 'issue.write', dest, destAcl)
		targetProject = dest
		nextNumber = await allocateIssueNumber(tx, actor.workspaceId, dest.id)
		scopeMovedFromProjectId = current.projectId
	}

	let nextStatusId = input.statusId ?? current.statusId
	let nextClosedAt = current.closedAt
	if (scopeMovedFromProjectId && input.statusId === undefined) {
		const destDefault = await getDefaultStatusForProject(tx, actor.workspaceId, targetProject.id)
		if (!destDefault) throw new HttpError(422, 'validation_failed', 'Target project has no default status')
		nextStatusId = destDefault.id
		nextClosedAt = isClosedCategory(destDefault.category)
			? (current.closedAt ?? new Date().toISOString())
			: null
	} else if (nextStatusId !== current.statusId || scopeMovedFromProjectId !== undefined) {
		const status = await getStatusById(tx, actor.workspaceId, nextStatusId)
		if (!status || status.projectId !== targetProject.id) {
			throw new HttpError(422, 'validation_failed', 'Target status does not belong to target project')
		}
		nextClosedAt = isClosedCategory(status.category) ? (current.closedAt ?? new Date().toISOString()) : null
	}

	const nextAssigneeId = input.assigneeId === undefined ? current.assigneeId : input.assigneeId
	const nextAssigneeType =
		nextAssigneeId === null ? null : (input.assigneeType ?? current.assigneeType ?? 'user')

	const nextLabelIds = input.labelIds ?? current.labelIds
	if (input.labelIds !== undefined) {
		await replaceIssueLabelsRows(tx, actor.workspaceId, current.id, input.labelIds)
	}

	const updated = await updateIssueRow(tx, {
		workspaceId: actor.workspaceId,
		issueId: current.id,
		expectedVersion: input.version,
		projectId: targetProject.id !== current.projectId ? targetProject.id : undefined,
		number: nextNumber,
		projectKey: targetProject.key,
		parentId: input.parentId === undefined ? current.parentId : input.parentId,
		cycleId: input.cycleId === undefined ? current.cycleId : input.cycleId,
		title: input.title !== undefined ? input.title.trim() : current.title,
		description: input.description === undefined ? current.description : input.description,
		descriptionText: input.descriptionText ?? current.descriptionText,
		statusId: nextStatusId,
		priority: input.priority ?? current.priority,
		assigneeType: nextAssigneeType,
		assigneeId: nextAssigneeId,
		position: input.position ?? current.position,
		startDate: input.startDate === undefined ? current.startDate : input.startDate,
		dueDate: input.dueDate === undefined ? current.dueDate : input.dueDate,
		estimate: input.estimate === undefined ? current.estimate : input.estimate,
		closedAt: nextClosedAt,
		labelIds: nextLabelIds
	})
	if (!updated) {
		const latest = await getIssueById(tx, actor.workspaceId, issueId)
		const changedFields = latest
			? computeChangedKeys(
					current as unknown as Record<string, unknown>,
					latest as unknown as Record<string, unknown>
				)
			: undefined
		throwStaleVersion(
			`Issue ${current.identifier}`,
			latest?.version ?? current.version + 1,
			input.version,
			(latest ?? current) as unknown as Record<string, unknown>,
			changedFields
		)
	}

	await emitTasksEvent(tx, {
		workspaceId: actor.workspaceId,
		aggregate: 'issue',
		aggregateId: updated.id,
		eventType: TASKS_EVENTS.IssueUpdated,
		payload: {
			issueId: updated.id,
			projectId: targetProject.id,
			identifier: updated.identifier,
			title: updated.title,
			descriptionText: updated.descriptionText,
			actorId: actor.principalId
		}
	})

	if (updated.assigneeType === 'user' && updated.assigneeId && updated.assigneeId !== current.assigneeId) {
		await emitTasksEvent(tx, {
			workspaceId: actor.workspaceId,
			aggregate: 'issue',
			aggregateId: updated.id,
			eventType: TASKS_EVENTS.IssueAssigned,
			payload: {
				issueId: updated.id,
				projectId: targetProject.id,
				identifier: updated.identifier,
				title: updated.title,
				assigneeUserId: updated.assigneeId,
				actorType: actor.kind,
				actorId: actor.principalId
			}
		})
	}

	if (updated.statusId !== current.statusId) {
		await emitTasksEvent(tx, {
			workspaceId: actor.workspaceId,
			aggregate: 'issue',
			aggregateId: updated.id,
			eventType: TASKS_EVENTS.IssueStatusChanged,
			payload: {
				issueId: updated.id,
				projectId: targetProject.id,
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

	const cursor = await appendChange(tx, actor.workspaceId, {
		entityType: 'issue',
		entityId: updated.id,
		action: 'upsert',
		scope: [`project:${targetProject.id}`],
		payload: {
			...(updated as unknown as Record<string, unknown>),
			...(scopeMovedFromProjectId ? { scopeMovedFromProjectId } : {})
		},
		actorId: actor.principalId
	})

	return { data: updated, cursor }
}

export async function moveIssue(
	tx: Queryable,
	actor: ActorContext,
	issueId: string,
	input: MoveIssueBody
): Promise<{ readonly data: IssueDto; readonly rebalanced: boolean; readonly cursor: number }> {
	const current = await getIssueById(tx, actor.workspaceId, issueId)
	if (!current) throw new HttpError(404, 'not_found', 'Issue not found')
	const project = await getProjectById(tx, actor.workspaceId, current.projectId)
	if (!project) throw new HttpError(404, 'not_found', 'Project not found')
	const acl = await resolveResourceAcl(tx, {
		workspaceId: actor.workspaceId,
		resourceType: 'project',
		resourceId: project.id,
		userId: actor.principalId
	})
	await authorizeProject(tx, actor, 'issue.write', project, acl)

	if (current.version !== input.version) {
		throwStaleVersion(
			`Issue ${current.identifier}`,
			current.version,
			input.version,
			current as unknown as Record<string, unknown>
		)
	}

	const targetStatusId = input.statusId ?? current.statusId
	const targetStatus = await getStatusById(tx, actor.workspaceId, targetStatusId)
	if (!targetStatus || targetStatus.projectId !== project.id) {
		throw new HttpError(422, 'validation_failed', 'Target status does not belong to this project')
	}

	let newPosition = input.position
	if (!newPosition) {
		let afterPos: string | null = null
		let beforePos: string | null = null
		if (input.afterIssueId) {
			const after = await getIssueById(tx, actor.workspaceId, input.afterIssueId)
			if (!after || after.projectId !== project.id || after.statusId !== targetStatusId) {
				throw new HttpError(422, 'validation_failed', 'afterIssueId is not in the target column')
			}
			afterPos = after.position
		}
		if (input.beforeIssueId) {
			const before = await getIssueById(tx, actor.workspaceId, input.beforeIssueId)
			if (!before || before.projectId !== project.id || before.statusId !== targetStatusId) {
				throw new HttpError(422, 'validation_failed', 'beforeIssueId is not in the target column')
			}
			beforePos = before.position
		}
		if (afterPos === null && beforePos === null) {
			afterPos = await getLastIssuePositionInColumn(tx, actor.workspaceId, project.id, targetStatusId)
			// If moving within the same column and it's already the last item, avoid comparing against self.
			if (afterPos === current.position && targetStatusId === current.statusId) {
				newPosition = current.position
			}
		}
		if (!newPosition) {
			try {
				newPosition = generateKeyBetween(afterPos, beforePos)
			} catch (err) {
				throw new HttpError(
					422,
					'validation_failed',
					err instanceof Error ? err.message : 'Invalid move bounds'
				)
			}
		}
	}

	const nextClosedAt = isClosedCategory(targetStatus.category)
		? (current.closedAt ?? new Date().toISOString())
		: null

	let updated = await updateIssueRow(tx, {
		workspaceId: actor.workspaceId,
		issueId: current.id,
		expectedVersion: input.version,
		projectKey: project.key,
		parentId: current.parentId,
		cycleId: current.cycleId,
		title: current.title,
		description: current.description,
		descriptionText: current.descriptionText,
		statusId: targetStatusId,
		priority: current.priority,
		assigneeType: current.assigneeType,
		assigneeId: current.assigneeId,
		position: newPosition,
		startDate: current.startDate,
		dueDate: current.dueDate,
		estimate: current.estimate,
		closedAt: nextClosedAt,
		labelIds: current.labelIds
	})
	if (!updated) {
		throwStaleVersion(
			`Issue ${current.identifier}`,
			current.version + 1,
			input.version,
			current as unknown as Record<string, unknown>
		)
	}

	const changes: ChangeLogEntry[] = []
	let rebalanced = false
	const colRows = await listColumnIssueIdsAndPositions(tx, actor.workspaceId, project.id, targetStatusId)
	if (needsRebalance(colRows.map((r) => r.position))) {
		rebalanced = true
		const freshKeys = rebalanceKeys(colRows.length)
		for (let i = 0; i < colRows.length; i++) {
			const row = colRows[i]!
			const freshPos = freshKeys[i]!
			if (row.position === freshPos) continue
			const rebalancedIssue = await updateIssuePositionOnly(tx, actor.workspaceId, row.id, freshPos)
			if (rebalancedIssue) {
				if (rebalancedIssue.id === updated.id) updated = rebalancedIssue
				changes.push({
					entityType: 'issue',
					entityId: rebalancedIssue.id,
					action: 'reorder',
					scope: [`project:${project.id}`],
					payload: rebalancedIssue as unknown as Record<string, unknown>,
					actorId: actor.principalId
				})
			}
		}
	}

	if (!rebalanced) {
		changes.push({
			entityType: 'issue',
			entityId: updated.id,
			action: 'reorder',
			scope: [`project:${project.id}`],
			payload: updated as unknown as Record<string, unknown>,
			actorId: actor.principalId
		})
	}

	await emitTasksEvent(tx, {
		workspaceId: actor.workspaceId,
		aggregate: 'issue',
		aggregateId: updated.id,
		eventType: TASKS_EVENTS.IssueMoved,
		payload: {
			issueId: updated.id,
			projectId: project.id,
			statusId: updated.statusId,
			position: updated.position,
			rebalanced
		}
	})

	if (updated.statusId !== current.statusId) {
		await emitTasksEvent(tx, {
			workspaceId: actor.workspaceId,
			aggregate: 'issue',
			aggregateId: updated.id,
			eventType: TASKS_EVENTS.IssueStatusChanged,
			payload: {
				issueId: updated.id,
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

	const cursor = await appendChanges(tx, actor.workspaceId, changes)
	return { data: updated, rebalanced, cursor }
}

export async function setIssueLabels(
	tx: Queryable,
	actor: ActorContext,
	issueId: string,
	labelIds: readonly string[],
	expectedVersion: number
): Promise<{ readonly data: IssueDto; readonly cursor: number }> {
	return updateIssue(tx, actor, issueId, { labelIds: [...labelIds], version: expectedVersion })
}

export async function deleteIssue(
	tx: Queryable,
	actor: ActorContext,
	issueId: string,
	expectedVersion?: number
): Promise<{ readonly id: string; readonly cursor: number }> {
	const current = await getIssueById(tx, actor.workspaceId, issueId)
	if (!current) throw new HttpError(404, 'not_found', 'Issue not found')
	const project = await getProjectById(tx, actor.workspaceId, current.projectId)
	if (!project) throw new HttpError(404, 'not_found', 'Project not found')
	const acl = await resolveResourceAcl(tx, {
		workspaceId: actor.workspaceId,
		resourceType: 'project',
		resourceId: project.id,
		userId: actor.principalId
	})
	await authorizeProject(tx, actor, 'issue.delete', project, acl)

	if (expectedVersion !== undefined && current.version !== expectedVersion) {
		throwStaleVersion(
			`Issue ${current.identifier}`,
			current.version,
			expectedVersion,
			current as unknown as Record<string, unknown>
		)
	}

	const deleted = await softDeleteIssueRow(tx, actor.workspaceId, issueId, expectedVersion)
	if (!deleted) {
		throwStaleVersion(
			`Issue ${current.identifier}`,
			current.version + 1,
			expectedVersion ?? current.version,
			current as unknown as Record<string, unknown>
		)
	}

	await emitTasksEvent(tx, {
		workspaceId: actor.workspaceId,
		aggregate: 'issue',
		aggregateId: issueId,
		eventType: TASKS_EVENTS.IssueDeleted,
		payload: { issueId, projectId: project.id, identifier: current.identifier }
	})
	await auditTasksAction(tx, {
		workspaceId: actor.workspaceId,
		actorType: actor.kind === 'agent' ? 'agent' : 'user',
		actorId: actor.principalId,
		action: 'issue.delete',
		targetType: 'issue',
		targetId: issueId,
		metadata: { identifier: current.identifier }
	})

	const cursor = await appendChange(tx, actor.workspaceId, {
		entityType: 'issue',
		entityId: issueId,
		action: 'delete',
		scope: [`project:${project.id}`],
		payload: null,
		actorId: actor.principalId
	})
	return { id: issueId, cursor }
}

// ---------- Relations & Comments ----------

export async function createIssueRelation(
	tx: Queryable,
	actor: ActorContext,
	sourceIssueId: string,
	input: CreateIssueRelationBody
): Promise<{ readonly data: IssueRelationDto; readonly cursor: number }> {
	if (sourceIssueId === input.targetIssueId) {
		throw new HttpError(422, 'validation_failed', 'An issue cannot relate to itself')
	}
	const source = await getIssueById(tx, actor.workspaceId, sourceIssueId)
	const target = await getIssueById(tx, actor.workspaceId, input.targetIssueId)
	if (!source || !target) throw new HttpError(404, 'not_found', 'Issue not found')

	const project = await getProjectById(tx, actor.workspaceId, source.projectId)
	if (!project) throw new HttpError(404, 'not_found', 'Project not found')
	const acl = await resolveResourceAcl(tx, {
		workspaceId: actor.workspaceId,
		resourceType: 'project',
		resourceId: project.id,
		userId: actor.principalId
	})
	await authorizeProject(tx, actor, 'issue.write', project, acl)
	await requireProjectRead(tx, actor, target.projectId)

	const created = await insertIssueRelationRow(tx, {
		workspaceId: actor.workspaceId,
		sourceIssueId,
		targetIssueId: input.targetIssueId,
		kind: input.kind,
		createdBy: actor.principalId
	})
	await emitTasksEvent(tx, {
		workspaceId: actor.workspaceId,
		aggregate: 'issue_relation',
		aggregateId: created.id,
		eventType: TASKS_EVENTS.IssueRelationCreated,
		payload: { relationId: created.id, sourceIssueId, targetIssueId: input.targetIssueId, kind: input.kind }
	})
	const cursor = await appendChange(tx, actor.workspaceId, {
		entityType: 'issue_relation',
		entityId: created.id,
		action: 'upsert',
		scope: [`project:${project.id}`],
		payload: created as unknown as Record<string, unknown>,
		actorId: actor.principalId
	})
	return { data: created, cursor }
}

export async function deleteIssueRelation(
	tx: Queryable,
	actor: ActorContext,
	issueId: string,
	relationId: string
): Promise<{ readonly deleted: boolean; readonly cursor: number }> {
	const issue = await getIssueById(tx, actor.workspaceId, issueId)
	if (!issue) throw new HttpError(404, 'not_found', 'Issue not found')
	const project = await getProjectById(tx, actor.workspaceId, issue.projectId)
	if (!project) throw new HttpError(404, 'not_found', 'Project not found')
	const acl = await resolveResourceAcl(tx, {
		workspaceId: actor.workspaceId,
		resourceType: 'project',
		resourceId: project.id,
		userId: actor.principalId
	})
	await authorizeProject(tx, actor, 'issue.write', project, acl)

	const deleted = await deleteIssueRelationRow(tx, actor.workspaceId, relationId)
	if (!deleted) throw new HttpError(404, 'not_found', 'Relation not found')

	await emitTasksEvent(tx, {
		workspaceId: actor.workspaceId,
		aggregate: 'issue_relation',
		aggregateId: relationId,
		eventType: TASKS_EVENTS.IssueRelationDeleted,
		payload: { relationId, issueId }
	})
	const cursor = await appendChange(tx, actor.workspaceId, {
		entityType: 'issue_relation',
		entityId: relationId,
		action: 'delete',
		scope: [`project:${project.id}`],
		payload: null,
		actorId: actor.principalId
	})
	return { deleted: true, cursor }
}

export async function createIssueComment(
	tx: Queryable,
	actor: ActorContext,
	issueId: string,
	input: CreateIssueCommentBody,
	opts?: { readonly skipChangeLog?: boolean }
): Promise<{ readonly data: IssueCommentDto; readonly cursor: number }> {
	assertValidClientId(input.id, 'comment id')
	const issue = await getIssueById(tx, actor.workspaceId, issueId)
	if (!issue) throw new HttpError(404, 'not_found', 'Issue not found')
	const project = await getProjectById(tx, actor.workspaceId, issue.projectId)
	if (!project) throw new HttpError(404, 'not_found', 'Project not found')
	const acl = await resolveResourceAcl(tx, {
		workspaceId: actor.workspaceId,
		resourceType: 'project',
		resourceId: project.id,
		userId: actor.principalId
	})
	await authorizeProject(tx, actor, 'issue.write', project, acl)

	const created = await insertIssueCommentRow(tx, {
		id: input.id,
		workspaceId: actor.workspaceId,
		issueId,
		authorType: actor.kind,
		authorId: actor.principalId,
		body: input.body ?? null,
		bodyText: input.bodyText
	})

	const mentionedHandles = extractMentions(input.bodyText)
	await emitTasksEvent(tx, {
		workspaceId: actor.workspaceId,
		aggregate: 'issue_comment',
		aggregateId: created.id,
		eventType: TASKS_EVENTS.IssueCommentCreated,
		payload: {
			commentId: created.id,
			issueId: issue.id,
			projectId: project.id,
			identifier: issue.identifier,
			issueTitle: issue.title,
			bodyText: created.bodyText,
			assigneeUserId: issue.assigneeType === 'user' ? issue.assigneeId : null,
			creatorId: issue.creatorId,
			mentionedHandles,
			actorType: actor.kind,
			actorId: actor.principalId
		}
	})

	const cursor = opts?.skipChangeLog
		? 0
		: await appendChange(tx, actor.workspaceId, {
				entityType: 'issue_comment',
				entityId: created.id,
				action: 'upsert',
				scope: [`project:${project.id}`],
				payload: created as unknown as Record<string, unknown>,
				actorId: actor.principalId
			})

	return { data: created, cursor }
}

export async function updateIssueComment(
	tx: Queryable,
	actor: ActorContext,
	issueId: string,
	commentId: string,
	input: UpdateIssueCommentBody
): Promise<{ readonly data: IssueCommentDto; readonly cursor: number }> {
	const current = await getIssueCommentById(tx, actor.workspaceId, commentId)
	if (!current || current.issueId !== issueId) {
		throw new HttpError(404, 'not_found', 'Comment not found')
	}
	const issue = await getIssueById(tx, actor.workspaceId, issueId)
	if (!issue) throw new HttpError(404, 'not_found', 'Issue not found')
	const project = await getProjectById(tx, actor.workspaceId, issue.projectId)
	if (!project) throw new HttpError(404, 'not_found', 'Project not found')
	const acl = await resolveResourceAcl(tx, {
		workspaceId: actor.workspaceId,
		resourceType: 'project',
		resourceId: project.id,
		userId: actor.principalId
	})
	await authorizeProject(tx, actor, 'issue.write', project, acl)

	if (current.authorId !== actor.principalId && !isAdminProjectBypass(actor)) {
		throw new HttpError(403, 'insufficient_role', 'Only the author or an admin can edit this comment')
	}
	if (current.version !== input.version) {
		throwStaleVersion(
			'Comment',
			current.version,
			input.version,
			current as unknown as Record<string, unknown>
		)
	}

	const updated = await updateIssueCommentRow(tx, {
		workspaceId: actor.workspaceId,
		commentId,
		expectedVersion: input.version,
		body: input.body ?? current.body,
		bodyText: input.bodyText
	})
	if (!updated) {
		throwStaleVersion(
			'Comment',
			current.version + 1,
			input.version,
			current as unknown as Record<string, unknown>
		)
	}

	await emitTasksEvent(tx, {
		workspaceId: actor.workspaceId,
		aggregate: 'issue_comment',
		aggregateId: updated.id,
		eventType: TASKS_EVENTS.IssueCommentUpdated,
		payload: {
			commentId: updated.id,
			issueId: issue.id,
			projectId: project.id,
			identifier: issue.identifier,
			issueTitle: issue.title,
			bodyText: updated.bodyText,
			actorId: actor.principalId
		}
	})

	const cursor = await appendChange(tx, actor.workspaceId, {
		entityType: 'issue_comment',
		entityId: updated.id,
		action: 'upsert',
		scope: [`project:${project.id}`],
		payload: updated as unknown as Record<string, unknown>,
		actorId: actor.principalId
	})
	return { data: updated, cursor }
}

// ---------- Saved views ----------

export async function listSavedViews(tx: Queryable, actor: ActorContext): Promise<SavedViewDto[]> {
	if (actor.membership !== 'active') {
		throw new HttpError(403, 'not_workspace_member', 'Membership required')
	}
	const projects = await listAccessibleProjects(tx, actor)
	return listSavedViewsForUser(
		tx,
		actor.workspaceId,
		actor.principalId,
		projects.map((p) => p.id)
	)
}

export async function createSavedView(
	tx: Queryable,
	actor: ActorContext,
	input: CreateSavedViewBody
): Promise<{ readonly data: SavedViewDto; readonly cursor: number }> {
	assertValidClientId(input.id, 'saved view id')
	authorizeWorkspaceTaskAction(actor, 'issue.read')
	if (input.projectId) {
		await requireProjectRead(tx, actor, input.projectId)
	}
	const existing = await listSavedViews(tx, actor)
	const lastPos = existing.at(-1)?.position ?? null
	const position = input.position ?? generateKeyBetween(lastPos, null)

	const created = await insertSavedViewRow(tx, {
		id: input.id,
		workspaceId: actor.workspaceId,
		projectId: input.projectId ?? null,
		ownerUserId: actor.principalId,
		name: input.name.trim(),
		layout: input.layout ?? 'list',
		filters: (input.filters ?? {}) as Record<string, unknown>,
		sort: input.sort ?? {},
		isShared: input.isShared ?? false,
		position
	})

	await emitTasksEvent(tx, {
		workspaceId: actor.workspaceId,
		aggregate: 'saved_view',
		aggregateId: created.id,
		eventType: TASKS_EVENTS.SavedViewCreated,
		payload: { viewId: created.id, name: created.name }
	})

	const scope = created.projectId
		? [`project:${created.projectId}`]
		: created.isShared
			? []
			: [`user:${actor.principalId}`]
	const cursor = await appendChange(tx, actor.workspaceId, {
		entityType: 'saved_view',
		entityId: created.id,
		action: 'upsert',
		scope,
		payload: created as unknown as Record<string, unknown>,
		actorId: actor.principalId
	})
	return { data: created, cursor }
}

export async function updateSavedView(
	tx: Queryable,
	actor: ActorContext,
	viewId: string,
	input: UpdateSavedViewBody
): Promise<{ readonly data: SavedViewDto; readonly cursor: number }> {
	authorizeWorkspaceTaskAction(actor, 'issue.read')
	const current = await getSavedViewById(tx, actor.workspaceId, viewId)
	if (!current) throw new HttpError(404, 'not_found', 'Saved view not found')
	if (current.ownerUserId !== actor.principalId && !isAdminProjectBypass(actor)) {
		throw new HttpError(403, 'insufficient_role', 'Cannot modify another user view')
	}
	if (current.version !== input.version) {
		throwStaleVersion(
			'Saved view',
			current.version,
			input.version,
			current as unknown as Record<string, unknown>
		)
	}

	const updated = await updateSavedViewRow(tx, {
		workspaceId: actor.workspaceId,
		viewId,
		expectedVersion: input.version,
		name: input.name?.trim() ?? current.name,
		layout: input.layout ?? current.layout,
		filters: (input.filters ?? current.filters) as Record<string, unknown>,
		sort: input.sort ?? current.sort,
		isShared: input.isShared ?? current.isShared
	})
	if (!updated) {
		throwStaleVersion(
			'Saved view',
			current.version + 1,
			input.version,
			current as unknown as Record<string, unknown>
		)
	}

	const scope = updated.projectId
		? [`project:${updated.projectId}`]
		: updated.isShared
			? []
			: [`user:${updated.ownerUserId ?? actor.principalId}`]
	const cursor = await appendChange(tx, actor.workspaceId, {
		entityType: 'saved_view',
		entityId: updated.id,
		action: 'upsert',
		scope,
		payload: updated as unknown as Record<string, unknown>,
		actorId: actor.principalId
	})
	return { data: updated, cursor }
}

export async function deleteSavedView(
	tx: Queryable,
	actor: ActorContext,
	viewId: string
): Promise<{ readonly deleted: boolean; readonly cursor: number }> {
	authorizeWorkspaceTaskAction(actor, 'issue.read')
	const current = await getSavedViewById(tx, actor.workspaceId, viewId)
	if (!current) throw new HttpError(404, 'not_found', 'Saved view not found')
	if (current.ownerUserId !== actor.principalId && !isAdminProjectBypass(actor)) {
		throw new HttpError(403, 'insufficient_role', 'Cannot delete another user view')
	}
	await deleteSavedViewRow(tx, actor.workspaceId, viewId)
	const scope = current.projectId
		? [`project:${current.projectId}`]
		: current.isShared
			? []
			: [`user:${current.ownerUserId ?? actor.principalId}`]
	const cursor = await appendChange(tx, actor.workspaceId, {
		entityType: 'saved_view',
		entityId: viewId,
		action: 'delete',
		scope,
		payload: null,
		actorId: actor.principalId
	})
	return { deleted: true, cursor }
}

// ---------- Sync snapshot seam (called by sync module) ----------

export async function getTasksSnapshotData(
	tx: Queryable,
	actor: ActorContext,
	scopeProjectId?: string
): Promise<{
	readonly projects: ProjectDto[]
	readonly projectStatuses: ProjectStatusDto[]
	readonly labels: LabelDto[]
	readonly cycles: CycleDto[]
	readonly issues: IssueDto[]
	readonly savedViews: SavedViewDto[]
}> {
	if (actor.membership !== 'active') {
		return {
			projects: [],
			projectStatuses: [],
			labels: [],
			cycles: [],
			issues: [],
			savedViews: []
		}
	}

	const allProjects = await listAccessibleProjects(tx, actor)
	const scopedProjects = scopeProjectId ? allProjects.filter((p) => p.id === scopeProjectId) : allProjects
	const projectIds = scopedProjects.map((p) => p.id)

	const [projectStatuses, labelRows, cycleRows, issuesPage, savedViews] = await Promise.all([
		listVisibleStatuses(tx, actor.workspaceId, projectIds),
		actor.roleKey === 'guest' && projectIds.length === 0
			? Promise.resolve([])
			: listLabels(tx, actor.workspaceId),
		listCyclesForProjects(tx, actor.workspaceId, projectIds),
		listIssuesFiltered(tx, {
			workspaceId: actor.workspaceId,
			visibleProjectIds: projectIds,
			limit: 500
		}),
		listSavedViewsForUser(tx, actor.workspaceId, actor.principalId, projectIds)
	])

	return {
		projects: scopedProjects,
		projectStatuses,
		labels: labelRows,
		cycles: cycleRows,
		issues: issuesPage.items,
		savedViews
	}
}

export async function ensureProjectForImport(
	tx: Queryable,
	actor: ActorContext,
	args: { readonly targetProjectId?: string | undefined; readonly key: string; readonly name: string }
): Promise<{
	readonly project: ProjectDto
	readonly statuses: ProjectStatusDto[]
	readonly created: boolean
}> {
	if (args.targetProjectId) {
		const existing = await getProjectById(tx, actor.workspaceId, args.targetProjectId)
		if (!existing) throw new HttpError(404, 'not_found', 'Target project not found')
		const statuses = await listStatusesForProject(tx, actor.workspaceId, existing.id)
		return { project: existing, statuses, created: false }
	}

	const existingByKey = await getProjectByKey(tx, actor.workspaceId, args.key)
	if (existingByKey) {
		const statuses = await listStatusesForProject(tx, actor.workspaceId, existingByKey.id)
		return { project: existingByKey, statuses, created: false }
	}

	const created = await createProject(tx, actor, {
		key: args.key,
		name: args.name,
		visibility: 'workspace'
	})
	return { project: created.data, statuses: created.statuses, created: true }
}

export async function ensureLabelForImport(
	tx: Queryable,
	actor: ActorContext,
	name: string
): Promise<LabelDto> {
	const existing = (await listLabels(tx, actor.workspaceId)).find(
		(l) => l.name.toLowerCase() === name.trim().toLowerCase()
	)
	if (existing) return existing
	const created = await createLabel(tx, actor, { name: name.trim(), color: 'info' })
	return created.data
}

export async function getIssueByIdForRedirect(
	tx: Queryable,
	workspaceId: string,
	issueId: string
): Promise<IssueDto | null> {
	return getIssueById(tx, workspaceId, issueId)
}
