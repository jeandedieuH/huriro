import type { Sql } from '@huriro/db'
import { Elysia } from 'elysia'
import { appendChange, appendChanges } from '../../api/changelog'
import type { RealtimePubSub } from '../../realtime/pubsub'
import type { Auth } from '../identity'
import { workspaceDerive } from '../tenancy'
import {
	MutationsBatchBody,
	RealtimeTicketBody,
	SyncChangesQuery,
	SyncScopeSnapshotQuery,
	SyncSnapshotQuery
} from './schema'
import {
	applyMutationsBatch,
	getScopeSnapshot,
	getSyncChanges,
	getSyncSnapshot,
	issueRealtimeTicket,
	verifyAndConsumeRealtimeTicket
} from './service'

export { appendChange, appendChanges, verifyAndConsumeRealtimeTicket }

export function syncModule(sql: Sql, auth: Auth | null, pubsub?: RealtimePubSub) {
	return new Elysia({ name: 'huriro.sync' })
		.derive(workspaceDerive(sql, auth))
		.get('/sync/changes', { query: SyncChangesQuery }, ({ query, inWorkspace }) =>
			inWorkspace((tx, actor) => getSyncChanges(tx, actor, query))
		)
		.get('/sync/snapshot', { query: SyncSnapshotQuery }, ({ query, inWorkspace }) =>
			inWorkspace((tx, actor) => getSyncSnapshot(tx, actor, query))
		)
		.get('/sync/scope-snapshot', { query: SyncScopeSnapshotQuery }, ({ query, inWorkspace }) =>
			inWorkspace((tx, actor) => getScopeSnapshot(tx, actor, query))
		)
		.post('/mutations', { body: MutationsBatchBody }, async ({ body, workspaceCtx, inWorkspace }) => {
			const result = await inWorkspace((tx, actor) => applyMutationsBatch(tx, actor, body.mutations))
			if (pubsub && result.maxCursor !== null) {
				await pubsub.publishCursor(workspaceCtx.workspaceId, result.maxCursor)
			}
			return result.response
		})
		.post('/realtime/ticket', { body: RealtimeTicketBody }, ({ body, inWorkspace }) =>
			inWorkspace((tx, actor) => issueRealtimeTicket(tx, actor, body.deviceId))
		)
}
