import type { Sql } from '@huriro/db'
import { Elysia } from 'elysia'
import type { RealtimePubSub } from '../../realtime/pubsub'
import type { Auth } from '../identity'
import { workspaceDerive } from '../tenancy'
import { NotificationIdParam, NotificationsListQuery } from './schema'
import {
	archiveNotification,
	getNotificationsSnapshot,
	listMyNotifications,
	markAllNotificationsRead,
	markNotificationRead,
	processNotificationOutboxEvent
} from './service'

export { getNotificationsSnapshot, markNotificationRead, processNotificationOutboxEvent }

export function notificationsModule(sql: Sql, auth: Auth | null, pubsub?: RealtimePubSub) {
	return new Elysia({ name: 'huriro.notifications' })
		.derive(workspaceDerive(sql, auth))
		.get('/notifications', { query: NotificationsListQuery }, ({ query, inWorkspace }) =>
			inWorkspace((tx, actor) => listMyNotifications(tx, actor, query))
		)
		.post(
			'/notifications/:id/read',
			{ params: NotificationIdParam },
			async ({ params, workspaceCtx, inWorkspace }) => {
				const result = await inWorkspace((tx, actor) => markNotificationRead(tx, actor, params.id))
				if (pubsub) await pubsub.publishCursor(workspaceCtx.workspaceId, result.cursor)
				return result.data
			}
		)
		.post('/notifications/read-all', async ({ workspaceCtx, inWorkspace }) => {
			const result = await inWorkspace((tx, actor) => markAllNotificationsRead(tx, actor))
			if (pubsub && result.cursor !== null)
				await pubsub.publishCursor(workspaceCtx.workspaceId, result.cursor)
			return { updatedCount: result.updatedCount }
		})
		.post(
			'/notifications/:id/archive',
			{ params: NotificationIdParam },
			async ({ params, workspaceCtx, inWorkspace }) => {
				const result = await inWorkspace((tx, actor) => archiveNotification(tx, actor, params.id))
				if (pubsub) await pubsub.publishCursor(workspaceCtx.workspaceId, result.cursor)
				return { archived: true, id: params.id }
			}
		)
}
