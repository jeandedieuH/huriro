import { type Static, Type } from 'typebox'
import { IssueDto } from './tasks'

export const SyncEntityType = Type.Union([
	Type.Literal('project'),
	Type.Literal('project_status'),
	Type.Literal('label'),
	Type.Literal('cycle'),
	Type.Literal('issue'),
	Type.Literal('issue_comment'),
	Type.Literal('issue_relation'),
	Type.Literal('saved_view'),
	Type.Literal('notification'),
	Type.Literal('doc_page'),
	Type.Literal('doc_comment'),
	Type.Literal('mail_inbox'),
	Type.Literal('mail_conversation'),
	// ADR-0033 graph edges. Never delivered as core change-feed rows — only
	// when the client's `scopes` subscription intersects the row's
	// `links:<type>:<id>` scope pair (§8.1, ADR-0031).
	Type.Literal('entity_link')
])
export type SyncEntityType = Static<typeof SyncEntityType>

export const SyncAction = Type.Union([
	Type.Literal('upsert'),
	Type.Literal('delete'),
	Type.Literal('reorder'),
	Type.Literal('revoke'),
	Type.Literal('grant')
])
export type SyncAction = Static<typeof SyncAction>

export const SyncChangeDto = Type.Object({
	cursor: Type.Integer({ minimum: 0 }),
	entity: SyncEntityType,
	id: Type.String({ format: 'uuid' }),
	action: SyncAction,
	scope: Type.Array(Type.String()),
	data: Type.Union([Type.Record(Type.String(), Type.Unknown()), Type.Null()]),
	changedAt: Type.String()
})
export type SyncChangeDto = Static<typeof SyncChangeDto>

export const SyncChangesQuery = Type.Object({
	since: Type.Optional(Type.Integer({ minimum: 0, default: 0 })),
	limit: Type.Optional(Type.Integer({ minimum: 1, maximum: 500, default: 200 })),
	clientId: Type.Optional(Type.String({ minLength: 1, maxLength: 120 })),
	// Comma-separated tier-2 scope subscriptions (§8.1, ADR-0031), each of the
	// form `<kind>:<id>` with kind in links|issue_hist|db|channel (e.g.
	// `links:issue:<uuid>`). Change-log rows whose scope array intersects this
	// list are delivered in addition to the core feed — this is the ONLY way
	// `entity_link` rows are ever delivered. Shape/content validated server-side
	// (max 50 entries, 422 on malformed input).
	scopes: Type.Optional(Type.String({ maxLength: 4000 }))
})
export type SyncChangesQuery = Static<typeof SyncChangesQuery>

export const SyncChangesResponse = Type.Object({
	changes: Type.Array(SyncChangeDto),
	nextCursor: Type.Integer({ minimum: 0 }),
	hasMore: Type.Boolean(),
	serverTime: Type.String()
})
export type SyncChangesResponse = Static<typeof SyncChangesResponse>

export const SyncSnapshotQuery = Type.Object({
	resources: Type.Optional(Type.String()),
	scope: Type.Optional(Type.String())
})
export type SyncSnapshotQuery = Static<typeof SyncSnapshotQuery>

export const SyncSnapshotResponse = Type.Object({
	cursor: Type.Integer({ minimum: 0 }),
	serverTime: Type.String(),
	projects: Type.Array(Type.Record(Type.String(), Type.Unknown())),
	projectStatuses: Type.Array(Type.Record(Type.String(), Type.Unknown())),
	labels: Type.Array(Type.Record(Type.String(), Type.Unknown())),
	cycles: Type.Array(Type.Record(Type.String(), Type.Unknown())),
	issues: Type.Array(Type.Record(Type.String(), Type.Unknown())),
	savedViews: Type.Array(Type.Record(Type.String(), Type.Unknown())),
	notifications: Type.Array(Type.Record(Type.String(), Type.Unknown())),
	docPages: Type.Array(Type.Record(Type.String(), Type.Unknown()))
})
export type SyncSnapshotResponse = Static<typeof SyncSnapshotResponse>

/**
 * Tier-2 lazy scope hydration (§8.1, ADR-0031). Only `issue_hist:<projectId>`
 * is implemented in M7 — it pages the project's closed-over-30d / deleted-over-30d
 * issues, keyset-paginated by (closedAt DESC, id) through the opaque `after`
 * cursor. `db:` / `links:` / `channel:` scopes are valid shapes but return empty
 * rows until their milestone lands (forward-compatible no-op).
 */
export const SyncScopeSnapshotQuery = Type.Object({
	scope: Type.String({ minLength: 1, maxLength: 200 }),
	limit: Type.Optional(Type.Integer({ minimum: 1, maximum: 1000, default: 500 })),
	after: Type.Optional(Type.String({ maxLength: 500 }))
})
export type SyncScopeSnapshotQuery = Static<typeof SyncScopeSnapshotQuery>

export const SyncScopeSnapshotResponse = Type.Object({
	scope: Type.String(),
	rows: Type.Array(IssueDto),
	nextAfter: Type.Union([Type.String(), Type.Null()]),
	hasMore: Type.Boolean()
})
export type SyncScopeSnapshotResponse = Static<typeof SyncScopeSnapshotResponse>

export const MutationEntity = Type.Union([
	Type.Literal('project'),
	Type.Literal('issue'),
	Type.Literal('issue_comment'),
	Type.Literal('saved_view'),
	Type.Literal('notification'),
	Type.Literal('doc_page')
])
export type MutationEntity = Static<typeof MutationEntity>

export const MutationOp = Type.Union([
	Type.Literal('create'),
	Type.Literal('update'),
	Type.Literal('delete'),
	Type.Literal('move'),
	Type.Literal('mark_read')
])
export type MutationOp = Static<typeof MutationOp>

export const MutationEnvelope = Type.Object({
	mutationId: Type.String({ format: 'uuid' }),
	workspaceId: Type.String({ format: 'uuid' }),
	entity: MutationEntity,
	entityId: Type.String({ format: 'uuid' }),
	op: MutationOp,
	patch: Type.Record(Type.String(), Type.Unknown()),
	baseVersion: Type.Optional(Type.Integer({ minimum: 1 })),
	queuedAt: Type.Optional(Type.String())
})
export type MutationEnvelope = Static<typeof MutationEnvelope>

export const MutationsBatchBody = Type.Object({
	mutations: Type.Array(MutationEnvelope, { minItems: 1, maxItems: 50 })
})
export type MutationsBatchBody = Static<typeof MutationsBatchBody>

export const MutationResultDto = Type.Object({
	mutationId: Type.String({ format: 'uuid' }),
	status: Type.Integer(),
	outcome: Type.Union([
		Type.Literal('applied'),
		Type.Literal('stale_version'),
		Type.Literal('forbidden'),
		Type.Literal('validation_failed'),
		Type.Literal('not_found')
	]),
	data: Type.Optional(Type.Record(Type.String(), Type.Unknown())),
	currentVersion: Type.Optional(Type.Integer()),
	currentEntity: Type.Optional(Type.Record(Type.String(), Type.Unknown())),
	changedFields: Type.Optional(Type.Array(Type.String())),
	error: Type.Optional(Type.String())
})
export type MutationResultDto = Static<typeof MutationResultDto>

export const MutationsBatchResponse = Type.Object({
	results: Type.Array(MutationResultDto),
	cursor: Type.Integer({ minimum: 0 })
})
export type MutationsBatchResponse = Static<typeof MutationsBatchResponse>

export const RealtimeTicketBody = Type.Object({
	deviceId: Type.String({ minLength: 1, maxLength: 120 })
})
export type RealtimeTicketBody = Static<typeof RealtimeTicketBody>

export const RealtimeTicketResponse = Type.Object({
	ticket: Type.String(),
	expiresAt: Type.String()
})
export type RealtimeTicketResponse = Static<typeof RealtimeTicketResponse>

export type WsClientMessage =
	| {
			readonly t: 'hello'
			readonly workspaceId: string
			readonly cursors?: { readonly workspace?: number }
			readonly ticket?: string
	  }
	| { readonly t: 'pong' }
	| { readonly t: 'presence'; readonly status: 'online' | 'away' }
	| { readonly t: 'typing'; readonly channelId: string }

export type WsPresenceUser = {
	readonly userId: string
	readonly status: 'online' | 'away'
	readonly lastSeenAt: number
}

export type WsServerMessage =
	| { readonly t: 'ready'; readonly serverCursor: number; readonly heartbeatMs: number }
	| { readonly t: 'cursor'; readonly cursor: number }
	| {
			readonly t: 'chat'
			readonly channelId: string
			readonly rev: number
			readonly lastMsgSeq: number
	  }
	| { readonly t: 'presence'; readonly users: readonly WsPresenceUser[] }
	| {
			readonly t: 'typing'
			readonly channelId: string
			readonly userId: string
			readonly until: number
	  }
	| { readonly t: 'revoke'; readonly reason: string }
	| { readonly t: 'ping' }
	| { readonly t: 'error'; readonly code: string; readonly message: string }
