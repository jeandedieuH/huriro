import {
	AvailabilityUserParam,
	AvailabilityWindowParam,
	CreateAvailabilityWindowBody,
	ListWorkspaceAvailabilityQuery,
	UpdateAvailabilityWindowBody,
	UpdateMyAvailabilityBody
} from '@huriro/contracts'
import type { Sql } from '@huriro/db'
import { Elysia } from 'elysia'
import { withIdempotency } from '../../api/context'
import type { PresenceRegistry } from '../../realtime/presence-registry'
import type { RealtimePubSub } from '../../realtime/pubsub'
import type { Auth } from '../identity'
import { workspaceDerive } from '../tenancy'
import {
	createAvailabilityWindow,
	deleteAvailabilityWindow,
	getMyAvailability,
	getUserAvailability,
	listMyAvailabilityWindows,
	listWorkspaceAvailability,
	updateAvailabilityWindow,
	updateMyAvailability
} from './service'

export {
	type AvailabilitySweepResult,
	buildUserAvailabilityDto,
	createAvailabilityWindow,
	deleteAvailabilityWindow,
	getAvailabilitySnapshot,
	getEffectiveAvailabilityForUser,
	getMyAvailability,
	getUserAvailability,
	getUsersAvailabilityMap,
	listMyAvailabilityWindows,
	listWorkspaceAvailability,
	runAvailabilitySweepOnce,
	updateAvailabilityWindow,
	updateMyAvailability
} from './service'

export interface AvailabilityModuleOptions {
	readonly presence?: PresenceRegistry | undefined
}

export function availabilityModule(
	sql: Sql,
	auth: Auth | null,
	pubsub?: RealtimePubSub,
	opts?: AvailabilityModuleOptions
) {
	const presence = opts?.presence
	return new Elysia({ name: 'huriro.availability' })
		.derive(workspaceDerive(sql, auth))
		.get('/availability', { query: ListWorkspaceAvailabilityQuery }, ({ query, inWorkspace }) =>
			inWorkspace((tx, actor) => listWorkspaceAvailability(tx, actor, query, presence))
		)
		.get('/availability/me', ({ inWorkspace }) =>
			inWorkspace((tx, actor) => getMyAvailability(tx, actor, presence))
		)
		.put(
			'/availability/me',
			{ body: UpdateMyAvailabilityBody },
			async ({ body, headers, workspaceCtx, inWorkspace, set }) => {
				const res = await inWorkspace((tx, actor) =>
					withIdempotency(tx, {
						workspaceId: workspaceCtx.workspaceId,
						key: headers['idempotency-key'],
						endpoint: 'PUT /api/v1/availability/me',
						requestBody: body,
						execute: () => updateMyAvailability(tx, actor, body, presence)
					})
				)
				set.status = res.status
				if (!res.replayed && pubsub) {
					await pubsub.publishCursor(workspaceCtx.workspaceId, res.body.cursor)
				}
				return res.body.data
			}
		)
		.get('/availability/users/:userId', { params: AvailabilityUserParam }, ({ params, inWorkspace }) =>
			inWorkspace((tx, actor) => getUserAvailability(tx, actor, params.userId, presence))
		)
		.get('/availability/windows', ({ inWorkspace }) =>
			inWorkspace(async (tx, actor) => ({ data: await listMyAvailabilityWindows(tx, actor) }))
		)
		.post(
			'/availability/windows',
			{ body: CreateAvailabilityWindowBody },
			async ({ body, headers, workspaceCtx, inWorkspace, set }) => {
				const res = await inWorkspace((tx, actor) =>
					withIdempotency(tx, {
						workspaceId: workspaceCtx.workspaceId,
						key: headers['idempotency-key'],
						endpoint: 'POST /api/v1/availability/windows',
						requestBody: body,
						successStatus: 201,
						execute: () => createAvailabilityWindow(tx, actor, body)
					})
				)
				set.status = res.status
				if (!res.replayed && pubsub) {
					await pubsub.publishCursor(workspaceCtx.workspaceId, res.body.cursor)
				}
				return res.body.data
			}
		)
		.patch(
			'/availability/windows/:id',
			{ params: AvailabilityWindowParam, body: UpdateAvailabilityWindowBody },
			async ({ params, body, headers, workspaceCtx, inWorkspace }) => {
				const res = await inWorkspace((tx, actor) =>
					withIdempotency(tx, {
						workspaceId: workspaceCtx.workspaceId,
						key: headers['idempotency-key'],
						endpoint: `PATCH /api/v1/availability/windows/${params.id}`,
						requestBody: body,
						execute: () => updateAvailabilityWindow(tx, actor, params.id, body)
					})
				)
				if (!res.replayed && pubsub) {
					await pubsub.publishCursor(workspaceCtx.workspaceId, res.body.cursor)
				}
				return res.body.data
			}
		)
		.delete(
			'/availability/windows/:id',
			{ params: AvailabilityWindowParam },
			async ({ params, workspaceCtx, inWorkspace }) => {
				const result = await inWorkspace((tx, actor) => deleteAvailabilityWindow(tx, actor, params.id))
				if (pubsub) await pubsub.publishCursor(workspaceCtx.workspaceId, result.cursor)
				return { deleted: true, id: result.id }
			}
		)
}
