import { createHash, randomBytes } from 'node:crypto'
import {
	CreateDocPageBody,
	CreateIssueBody,
	CreateIssueCommentBody,
	CreateProjectBody,
	CreateSavedViewBody,
	MoveDocPageBody,
	MoveIssueBody,
	type MutationEnvelope,
	type MutationResultDto,
	type MutationsBatchResponse,
	type RealtimeTicketResponse,
	type SyncChangeDto,
	type SyncChangesQuery,
	type SyncChangesResponse,
	type SyncSnapshotQuery,
	type SyncSnapshotResponse,
	UpdateDocPageBody,
	UpdateIssueBody,
	UpdateIssueCommentBody,
	UpdateProjectBody,
	UpdateSavedViewBody
} from '@huriro/contracts'
import { isUuid, type Queryable } from '@huriro/db'
import type { ActorContext } from '@huriro/domain'
import type { TSchema } from 'typebox'
import { Value } from 'typebox/value'
import { withIdempotency } from '../../api/context'
import { HttpError } from '../../api/error'
import {
	createDocPage,
	deleteDocPage,
	getDocsSnapshotData,
	listAccessibleDocPages,
	moveDocPage,
	updateDocPage
} from '../docs'
import { getNotificationsSnapshot, markNotificationRead } from '../notifications'
import {
	createIssue,
	createIssueComment,
	createProject,
	createSavedView,
	deleteIssue,
	getTasksSnapshotData,
	listAccessibleProjectIds,
	moveIssue,
	updateIssue,
	updateIssueComment,
	updateProject,
	updateSavedView
} from '../tasks'
import { assertActiveSyncMember } from './policy'
import {
	consumeRealtimeTicketRow,
	getWorkspaceCursorBounds,
	insertRealtimeTicketRow,
	type RawChangeLogRow,
	readChangeLogAfter,
	recordClientSyncCursor
} from './repo'

function extractProjectIdFromScope(scope: readonly string[]): string | null {
	for (const s of scope) {
		if (s.startsWith('project:')) return s.slice('project:'.length)
	}
	return null
}

function extractDocPageIdFromScope(scope: readonly string[]): string | null {
	for (const s of scope) {
		if (s.startsWith('doc_page:')) return s.slice('doc_page:'.length)
	}
	return null
}

function filterRowForActor(
	row: RawChangeLogRow,
	actor: ActorContext,
	accessibleProjects: ReadonlySet<string>,
	accessibleDocPages: ReadonlySet<string>,
	accessibleArchivedDocPages: ReadonlySet<string>
): SyncChangeDto | null {
	if (row.entityType === 'notification') {
		if (!row.scope.includes(`user:${actor.principalId}`)) return null
		return {
			cursor: row.cursor,
			entity: row.entityType,
			id: row.entityId,
			action: row.action,
			scope: row.scope,
			data: row.payload,
			changedAt: row.changedAt
		}
	}

	if (row.entityType === 'saved_view') {
		const userScope = row.scope.find((s) => s.startsWith('user:'))
		if (userScope && userScope !== `user:${actor.principalId}`) return null
		const projectId = extractProjectIdFromScope(row.scope)
		if (projectId && !accessibleProjects.has(projectId)) return null
		return {
			cursor: row.cursor,
			entity: row.entityType,
			id: row.entityId,
			action: row.action,
			scope: row.scope,
			data: row.payload,
			changedAt: row.changedAt
		}
	}

	if (row.entityType === 'label') {
		if (actor.roleKey === 'guest' && accessibleProjects.size === 0) return null
		return {
			cursor: row.cursor,
			entity: row.entityType,
			id: row.entityId,
			action: row.action,
			scope: row.scope,
			data: row.payload,
			changedAt: row.changedAt
		}
	}

	if (row.entityType === 'doc_page' || row.entityType === 'doc_comment') {
		const pageId = extractDocPageIdFromScope(row.scope)
		if (row.action === 'revoke') {
			const p = row.payload ?? {}
			const isWorkspaceRevoke = p['principalType'] === 'workspace' || p['previousVisibility'] === 'workspace'
			const isUserRevoke = p['principalType'] === 'user' && p['principalId'] === actor.principalId
			if (!isWorkspaceRevoke && !isUserRevoke && (!pageId || accessibleDocPages.has(pageId))) {
				return null
			}
			return {
				cursor: row.cursor,
				entity: row.entityType,
				id: row.entityId,
				action: 'revoke',
				scope: row.scope,
				data: null,
				changedAt: row.changedAt
			}
		}

		if (row.action === 'grant') {
			if (!pageId || !accessibleDocPages.has(pageId)) return null
			return {
				cursor: row.cursor,
				entity: row.entityType,
				id: row.entityId,
				action: 'grant',
				scope: row.scope,
				data: row.payload,
				changedAt: row.changedAt
			}
		}

		if (row.action === 'delete') {
			const canSeeArchived =
				pageId !== null && (accessibleDocPages.has(pageId) || accessibleArchivedDocPages.has(pageId))
			const isWorkspaceVisibleDelete = actor.roleKey !== 'guest' && row.scope.includes('visibility:workspace')
			if (!canSeeArchived && !isWorkspaceVisibleDelete) {
				return null
			}
			return {
				cursor: row.cursor,
				entity: row.entityType,
				id: row.entityId,
				action: 'delete',
				scope: row.scope,
				data: null,
				changedAt: row.changedAt
			}
		}

		if (pageId && accessibleDocPages.has(pageId)) {
			return {
				cursor: row.cursor,
				entity: row.entityType,
				id: row.entityId,
				action: row.action,
				scope: row.scope,
				data: row.payload,
				changedAt: row.changedAt
			}
		}

		// Visibility tightened from workspace -> private: emit delete tombstone so unauthorized peers purge (§9.3).
		if (row.payload && row.payload['previousVisibility'] === 'workspace') {
			return {
				cursor: row.cursor,
				entity: row.entityType,
				id: row.entityId,
				action: 'delete',
				scope: row.scope,
				data: null,
				changedAt: row.changedAt
			}
		}

		return null
	}

	const projectId = extractProjectIdFromScope(row.scope)
	if (row.action === 'revoke') {
		const p = row.payload ?? {}
		const isWorkspaceRevoke = p['principalType'] === 'workspace' || p['previousVisibility'] === 'workspace'
		const isUserRevoke = p['principalType'] === 'user' && p['principalId'] === actor.principalId
		if (!isWorkspaceRevoke && !isUserRevoke && (!projectId || accessibleProjects.has(projectId))) {
			return null
		}
		return {
			cursor: row.cursor,
			entity: row.entityType,
			id: row.entityId,
			action: 'revoke',
			scope: row.scope,
			data: null,
			changedAt: row.changedAt
		}
	}

	if (row.action === 'grant') {
		if (!projectId || !accessibleProjects.has(projectId)) return null
		return {
			cursor: row.cursor,
			entity: row.entityType,
			id: row.entityId,
			action: 'grant',
			scope: row.scope,
			data: row.payload,
			changedAt: row.changedAt
		}
	}

	if (projectId && accessibleProjects.has(projectId)) {
		return {
			cursor: row.cursor,
			entity: row.entityType,
			id: row.entityId,
			action: row.action,
			scope: row.scope,
			data: row.action === 'delete' ? null : row.payload,
			changedAt: row.changedAt
		}
	}

	// Scope move or visibility restriction: send delete tombstone so unauthorized clients purge local copy (§9.3).
	if (
		row.action !== 'delete' &&
		row.payload &&
		(row.payload['previousVisibility'] === 'workspace' ||
			typeof row.payload['scopeMovedFromProjectId'] === 'string')
	) {
		const tombstoneScope =
			typeof row.payload['scopeMovedFromProjectId'] === 'string'
				? [`project:${row.payload['scopeMovedFromProjectId']}`]
				: row.scope
		return {
			cursor: row.cursor,
			entity: row.entityType,
			id: row.entityId,
			action: 'delete',
			scope: tombstoneScope,
			data: null,
			changedAt: row.changedAt
		}
	}

	return null
}

function collapseChangesPerEntity(changes: readonly SyncChangeDto[]): SyncChangeDto[] {
	// Single backward pass: keep grant/revoke control markers distinct, and keep only the latest data mutation per (entity, id).
	const seen = new Set<string>()
	const deduped: SyncChangeDto[] = []
	for (let i = changes.length - 1; i >= 0; i--) {
		const item = changes[i]
		if (!item) continue
		if (item.action === 'grant' || item.action === 'revoke') {
			deduped.push(item)
			continue
		}
		const key = `${item.entity}:${item.id}`
		if (seen.has(key)) continue
		seen.add(key)
		deduped.push(item)
	}
	deduped.reverse()
	return deduped
}

export async function getSyncChanges(
	tx: Queryable,
	actor: ActorContext,
	query: SyncChangesQuery
): Promise<SyncChangesResponse> {
	assertActiveSyncMember(actor)
	const since = query.since ?? 0
	const limit = query.limit ?? 200

	const { lastCursor, minLogCursor } = await getWorkspaceCursorBounds(tx, actor.workspaceId)
	const expired =
		(minLogCursor !== null && since < minLogCursor - 1) || (minLogCursor === null && since < lastCursor)

	if (expired) {
		throw new HttpError(
			410,
			'sync_cursor_expired',
			'Sync cursor predates change log retention; snapshot resync required',
			undefined,
			{ resync: '/api/v1/sync/snapshot' }
		)
	}

	const { rows, hasMore } = await readChangeLogAfter(tx, actor.workspaceId, since, limit)
	const nextCursor = rows.length > 0 ? rows[rows.length - 1]!.cursor : Math.max(since, lastCursor)

	const [accessibleProjects, accessibleDocs] = await Promise.all([
		listAccessibleProjectIds(tx, actor),
		listAccessibleDocPages(tx, actor, { includeArchived: true, includeTemplates: true })
	])
	const accessibleDocPages = new Set<string>()
	const accessibleArchivedDocPages = new Set<string>()
	for (const doc of accessibleDocs) {
		if (doc.archivedAt === null) accessibleDocPages.add(doc.id)
		else accessibleArchivedDocPages.add(doc.id)
	}
	const filtered: SyncChangeDto[] = []
	for (const row of rows) {
		const mapped = filterRowForActor(
			row,
			actor,
			accessibleProjects,
			accessibleDocPages,
			accessibleArchivedDocPages
		)
		if (mapped) filtered.push(mapped)
	}

	const collapsed = collapseChangesPerEntity(filtered)

	if (query.clientId) {
		await recordClientSyncCursor(tx, actor.workspaceId, query.clientId, nextCursor)
	}

	return {
		changes: collapsed,
		nextCursor,
		hasMore,
		serverTime: new Date().toISOString()
	}
}

export async function getSyncSnapshot(
	tx: Queryable,
	actor: ActorContext,
	query: SyncSnapshotQuery
): Promise<SyncSnapshotResponse> {
	assertActiveSyncMember(actor)

	let scopeProjectId: string | undefined
	let scopeDocPageId: string | undefined
	if (query.scope?.startsWith('project:')) {
		scopeProjectId = query.scope.slice('project:'.length)
	} else if (query.scope?.startsWith('doc_page:')) {
		scopeDocPageId = query.scope.slice('doc_page:'.length)
	}

	const { lastCursor } = await getWorkspaceCursorBounds(tx, actor.workspaceId)
	const emptyTasks = {
		projects: [],
		projectStatuses: [],
		labels: [],
		cycles: [],
		issues: [],
		savedViews: []
	}
	const [tasksSnap, docsSnap, notifSnap] = await Promise.all([
		scopeDocPageId ? Promise.resolve(emptyTasks) : getTasksSnapshotData(tx, actor, scopeProjectId),
		scopeProjectId ? Promise.resolve({ docPages: [] }) : getDocsSnapshotData(tx, actor, scopeDocPageId),
		scopeProjectId || scopeDocPageId ? Promise.resolve([]) : getNotificationsSnapshot(tx, actor)
	])

	return {
		cursor: lastCursor,
		serverTime: new Date().toISOString(),
		projects: tasksSnap.projects as unknown as Record<string, unknown>[],
		projectStatuses: tasksSnap.projectStatuses as unknown as Record<string, unknown>[],
		labels: tasksSnap.labels as unknown as Record<string, unknown>[],
		cycles: tasksSnap.cycles as unknown as Record<string, unknown>[],
		issues: tasksSnap.issues as unknown as Record<string, unknown>[],
		savedViews: tasksSnap.savedViews as unknown as Record<string, unknown>[],
		notifications: notifSnap as unknown as Record<string, unknown>[],
		docPages: docsSnap.docPages as unknown as Record<string, unknown>[]
	}
}

const PG_UNIQUE_VIOLATION = '23505'
const PG_VALIDATION_CODES = new Set(['23514', '23502', '22P02'])
const PG_FK_VIOLATION = '23503'

function validateMutationPayload<T>(schema: TSchema, payload: unknown, label: string): T {
	if (Value.Check(schema, payload)) {
		return payload as T
	}
	// TypeBox 1.x yields { instancePath, message } — format without leaking internals.
	const [firstError] = Value.Errors(schema, payload)
	const field = firstError?.instancePath || '/'
	const detail = firstError ? `${field} ${firstError.message}` : 'invalid payload'
	throw new HttpError(422, 'validation_failed', `Invalid ${label}: ${detail}`)
}

async function runSingleMutation(
	tx: Queryable,
	actor: ActorContext,
	m: MutationEnvelope
): Promise<{ readonly data: Record<string, unknown>; readonly cursor: number }> {
	const patch = m.patch

	if (m.entity === 'issue') {
		if (m.op === 'create') {
			const input = validateMutationPayload<CreateIssueBody>(
				CreateIssueBody,
				{ ...patch, id: m.entityId },
				'issue.create'
			)
			const res = await createIssue(tx, actor, input)
			return { data: res.data as unknown as Record<string, unknown>, cursor: res.cursor }
		}
		if (m.op === 'update') {
			const version = m.baseVersion ?? Number(patch['version'] ?? 1)
			const input = validateMutationPayload<UpdateIssueBody>(
				UpdateIssueBody,
				{ ...patch, version },
				'issue.update'
			)
			const res = await updateIssue(tx, actor, m.entityId, input)
			return { data: res.data as unknown as Record<string, unknown>, cursor: res.cursor }
		}
		if (m.op === 'move') {
			const version = m.baseVersion ?? Number(patch['version'] ?? 1)
			const input = validateMutationPayload<MoveIssueBody>(MoveIssueBody, { ...patch, version }, 'issue.move')
			const res = await moveIssue(tx, actor, m.entityId, input)
			return { data: res.data as unknown as Record<string, unknown>, cursor: res.cursor }
		}
		if (m.op === 'delete') {
			const res = await deleteIssue(tx, actor, m.entityId, m.baseVersion)
			return { data: { id: res.id, deleted: true }, cursor: res.cursor }
		}
	}

	if (m.entity === 'project') {
		if (m.op === 'create') {
			const input = validateMutationPayload<CreateProjectBody>(
				CreateProjectBody,
				{ ...patch, id: m.entityId },
				'project.create'
			)
			const res = await createProject(tx, actor, input)
			return { data: res.data as unknown as Record<string, unknown>, cursor: res.cursor }
		}
		if (m.op === 'update') {
			const version = m.baseVersion ?? Number(patch['version'] ?? 1)
			const input = validateMutationPayload<UpdateProjectBody>(
				UpdateProjectBody,
				{ ...patch, version },
				'project.update'
			)
			const res = await updateProject(tx, actor, m.entityId, input)
			return { data: res.data as unknown as Record<string, unknown>, cursor: res.cursor }
		}
	}

	if (m.entity === 'issue_comment') {
		const rawIssueId = typeof patch['issueId'] === 'string' ? patch['issueId'] : ''
		if (!isUuid(rawIssueId)) {
			throw new HttpError(422, 'validation_failed', 'Invalid issue_comment: missing or invalid issueId')
		}
		const { issueId: _ignoredIssueId, ...commentPatch } = patch
		if (m.op === 'create') {
			const input = validateMutationPayload<CreateIssueCommentBody>(
				CreateIssueCommentBody,
				{ ...commentPatch, id: m.entityId },
				'issue_comment.create'
			)
			const res = await createIssueComment(tx, actor, rawIssueId, input)
			return { data: res.data as unknown as Record<string, unknown>, cursor: res.cursor }
		}
		if (m.op === 'update') {
			const version = m.baseVersion ?? Number(patch['version'] ?? 1)
			const input = validateMutationPayload<UpdateIssueCommentBody>(
				UpdateIssueCommentBody,
				{ ...commentPatch, version },
				'issue_comment.update'
			)
			const res = await updateIssueComment(tx, actor, rawIssueId, m.entityId, input)
			return { data: res.data as unknown as Record<string, unknown>, cursor: res.cursor }
		}
	}

	if (m.entity === 'saved_view') {
		if (m.op === 'create') {
			const input = validateMutationPayload<CreateSavedViewBody>(
				CreateSavedViewBody,
				{ ...patch, id: m.entityId },
				'saved_view.create'
			)
			const res = await createSavedView(tx, actor, input)
			return { data: res.data as unknown as Record<string, unknown>, cursor: res.cursor }
		}
		if (m.op === 'update') {
			const version = m.baseVersion ?? Number(patch['version'] ?? 1)
			const input = validateMutationPayload<UpdateSavedViewBody>(
				UpdateSavedViewBody,
				{ ...patch, version },
				'saved_view.update'
			)
			const res = await updateSavedView(tx, actor, m.entityId, input)
			return { data: res.data as unknown as Record<string, unknown>, cursor: res.cursor }
		}
	}

	if (m.entity === 'notification' && m.op === 'mark_read') {
		const res = await markNotificationRead(tx, actor, m.entityId)
		return { data: res.data as unknown as Record<string, unknown>, cursor: res.cursor }
	}

	if (m.entity === 'doc_page') {
		if (m.op === 'create') {
			const input = validateMutationPayload<CreateDocPageBody>(
				CreateDocPageBody,
				{ ...patch, id: m.entityId },
				'doc_page.create'
			)
			const res = await createDocPage(tx, actor, input)
			return { data: res.data as unknown as Record<string, unknown>, cursor: res.cursor }
		}
		if (m.op === 'update') {
			const version = m.baseVersion ?? Number(patch['version'] ?? 1)
			const input = validateMutationPayload<UpdateDocPageBody>(
				UpdateDocPageBody,
				{ ...patch, version },
				'doc_page.update'
			)
			const res = await updateDocPage(tx, actor, m.entityId, input)
			return { data: res.data as unknown as Record<string, unknown>, cursor: res.cursor }
		}
		if (m.op === 'move') {
			const version = m.baseVersion ?? Number(patch['version'] ?? 1)
			const input = validateMutationPayload<MoveDocPageBody>(
				MoveDocPageBody,
				{ ...patch, version },
				'doc_page.move'
			)
			const res = await moveDocPage(tx, actor, m.entityId, input)
			return { data: res.data as unknown as Record<string, unknown>, cursor: res.cursor }
		}
		if (m.op === 'delete') {
			const res = await deleteDocPage(tx, actor, m.entityId, m.baseVersion)
			return { data: { id: res.id, deleted: true }, cursor: res.cursor }
		}
	}

	throw new HttpError(422, 'validation_failed', `Unsupported mutation ${m.entity}.${m.op}`)
}

function mapMutationError(mutationId: string, err: unknown): MutationResultDto {
	if (err instanceof HttpError) {
		if (err.code === 'stale_version') {
			return {
				mutationId,
				status: 409,
				outcome: 'stale_version',
				...(typeof err.ext?.['currentVersion'] === 'number'
					? { currentVersion: err.ext['currentVersion'] }
					: {}),
				...(err.ext?.['currentEntity']
					? { currentEntity: err.ext['currentEntity'] as Record<string, unknown> }
					: {}),
				...(Array.isArray(err.ext?.['changedFields'])
					? { changedFields: err.ext['changedFields'] as string[] }
					: {}),
				error: err.message
			}
		}
		if (err.status === 403) {
			return { mutationId, status: 403, outcome: 'forbidden', error: err.message }
		}
		if (err.status === 404) {
			return { mutationId, status: 404, outcome: 'not_found', error: err.message }
		}
		return { mutationId, status: err.status, outcome: 'validation_failed', error: err.message }
	}
	// Map constraint / input PostgresErrors to per-item rejections instead of poisoning the whole batch with 500.
	const pgCode =
		typeof err === 'object' && err !== null && 'code' in err ? (err as { code?: unknown }).code : undefined
	if (typeof pgCode === 'string') {
		if (pgCode === PG_UNIQUE_VIOLATION) {
			return {
				mutationId,
				status: 409,
				outcome: 'validation_failed',
				error: 'A record with this unique value already exists'
			}
		}
		if (PG_VALIDATION_CODES.has(pgCode)) {
			return {
				mutationId,
				status: 422,
				outcome: 'validation_failed',
				error: 'Mutation payload failed validation'
			}
		}
		if (pgCode === PG_FK_VIOLATION) {
			return {
				mutationId,
				status: 404,
				outcome: 'not_found',
				error: 'Referenced record was not found'
			}
		}
	}
	throw err
}

export async function applyMutationsBatch(
	tx: Queryable,
	actor: ActorContext,
	mutations: readonly MutationEnvelope[]
): Promise<{ readonly response: MutationsBatchResponse; readonly maxCursor: number | null }> {
	assertActiveSyncMember(actor)
	const results: MutationResultDto[] = []
	let maxCursor: number | null = null

	for (let i = 0; i < mutations.length; i++) {
		const m = mutations[i]
		if (!m) continue
		if (m.workspaceId !== actor.workspaceId) {
			results.push({
				mutationId: m.mutationId,
				status: 403,
				outcome: 'forbidden',
				error: 'Mutation workspaceId does not match request workspace'
			})
			continue
		}

		// Use postgres.js nested tx.begin() (SAVEPOINT) so an error inside one mutation
		// stays in the savepoint's uncaught scope instead of aborting the outer batch transaction.
		try {
			const res = await tx.begin((sp) =>
				withIdempotency(sp, {
					workspaceId: actor.workspaceId,
					key: `mut:${m.mutationId}`,
					endpoint: 'POST /api/v1/mutations',
					requestBody: { entity: m.entity, entityId: m.entityId, op: m.op, patch: m.patch },
					successStatus: 200,
					execute: async () => runSingleMutation(sp, actor, m)
				})
			)
			if (!res.replayed && res.body.cursor > 0) {
				maxCursor = maxCursor === null ? res.body.cursor : Math.max(maxCursor, res.body.cursor)
			}
			results.push({
				mutationId: m.mutationId,
				status: 200,
				outcome: 'applied',
				data: res.body.data
			})
		} catch (err) {
			results.push(mapMutationError(m.mutationId, err))
		}
	}

	const { lastCursor } = await getWorkspaceCursorBounds(tx, actor.workspaceId)
	return {
		response: { results, cursor: lastCursor },
		maxCursor
	}
}

function hashTicket(token: string): string {
	return createHash('sha256').update(token, 'utf8').digest('hex')
}

export async function issueRealtimeTicket(
	tx: Queryable,
	actor: ActorContext,
	deviceId: string
): Promise<RealtimeTicketResponse> {
	assertActiveSyncMember(actor)
	const ticket = `rt_${randomBytes(24).toString('base64url')}`
	const expiresAt = new Date(Date.now() + 60_000)
	await insertRealtimeTicketRow(tx, {
		workspaceId: actor.workspaceId,
		userId: actor.userId,
		deviceId,
		tokenHash: hashTicket(ticket),
		expiresAt
	})
	return { ticket, expiresAt: expiresAt.toISOString() }
}

export async function verifyAndConsumeRealtimeTicket(
	tx: Queryable,
	workspaceId: string,
	ticket: string
): Promise<{ readonly userId: string; readonly deviceId: string } | null> {
	return consumeRealtimeTicketRow(tx, workspaceId, hashTicket(ticket))
}
