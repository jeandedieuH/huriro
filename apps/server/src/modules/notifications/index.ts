import type { Sql } from '@huriro/db'
import { Elysia } from 'elysia'
import type { DnsResolver } from '../../api/egress'
import type { RealtimePubSub } from '../../realtime/pubsub'
import type { Auth } from '../identity'
import { workspaceDerive } from '../tenancy'
import { type EmailMessage, type EmailTransport, runEmailDigestOnce } from './digest'
import {
	dispatchMobilePushNotifications,
	dispatchWebPushNotifications,
	type ExpoPushConfig,
	sendWebPushToUser,
	type VapidConfig
} from './push'
import {
	CreateWebPushSubscriptionBody,
	DeliveryLogQuery,
	MobileTokenIdParam,
	NotificationIdParam,
	NotificationsListQuery,
	RegisterMobilePushTokenBody,
	SubscriptionIdParam,
	UpdateNotificationPreferencesBody
} from './schema'
import {
	archiveNotification,
	deleteMyMobilePushToken,
	deleteMyWebPushSubscription,
	getMyNotificationPreferences,
	getNotificationsSnapshot,
	listMyMobilePushTokens,
	listMyNotificationDeliveries,
	listMyNotifications,
	listMyWebPushSubscriptions,
	markAllNotificationsRead,
	markNotificationRead,
	processNotificationOutboxEvent,
	registerMobilePushToken,
	registerWebPushSubscription,
	updateMyNotificationPreferences
} from './service'

export {
	dispatchMobilePushNotifications,
	dispatchWebPushNotifications,
	type EmailMessage,
	type EmailTransport,
	type ExpoPushConfig,
	getNotificationsSnapshot,
	markNotificationRead,
	processNotificationOutboxEvent,
	runEmailDigestOnce,
	sendWebPushToUser,
	type VapidConfig
}

export function notificationsModule(
	sql: Sql,
	auth: Auth | null,
	pubsub?: RealtimePubSub,
	opts?: { readonly vapid?: VapidConfig | undefined; readonly resolver?: DnsResolver | undefined }
) {
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
		.get('/notifications/preferences', ({ inWorkspace }) =>
			inWorkspace((tx, actor) => getMyNotificationPreferences(tx, actor))
		)
		.patch(
			'/notifications/preferences',
			{ body: UpdateNotificationPreferencesBody },
			({ body, inWorkspace }) => inWorkspace((tx, actor) => updateMyNotificationPreferences(tx, actor, body))
		)
		.get('/notifications/push/vapid-key', () => ({
			publicKey: opts?.vapid?.publicKey ?? null
		}))
		.get('/notifications/push/subscriptions', ({ inWorkspace }) =>
			inWorkspace((tx, actor) => listMyWebPushSubscriptions(tx, actor))
		)
		.post(
			'/notifications/push/subscriptions',
			{ body: CreateWebPushSubscriptionBody },
			async ({ body, inWorkspace, set }) => {
				const created = await inWorkspace((tx, actor) =>
					registerWebPushSubscription(tx, actor, body, opts?.resolver)
				)
				set.status = 201
				return created
			}
		)
		.delete(
			'/notifications/push/subscriptions/:id',
			{ params: SubscriptionIdParam },
			async ({ params, inWorkspace }) => {
				await inWorkspace((tx, actor) => deleteMyWebPushSubscription(tx, actor, params.id))
				return { deleted: true, id: params.id }
			}
		)
		.get('/notifications/push/mobile-tokens', ({ inWorkspace }) =>
			inWorkspace((tx, actor) => listMyMobilePushTokens(tx, actor))
		)
		.post(
			'/notifications/push/mobile-tokens',
			{ body: RegisterMobilePushTokenBody },
			async ({ body, inWorkspace, set }) => {
				const created = await inWorkspace((tx, actor) => registerMobilePushToken(tx, actor, body))
				set.status = 201
				return created
			}
		)
		.delete(
			'/notifications/push/mobile-tokens/:id',
			{ params: MobileTokenIdParam },
			async ({ params, inWorkspace }) => {
				await inWorkspace((tx, actor) => deleteMyMobilePushToken(tx, actor, params.id))
				return { deleted: true, id: params.id }
			}
		)
		.get('/notifications/deliveries', { query: DeliveryLogQuery }, ({ query, inWorkspace }) =>
			inWorkspace(async (tx, actor) => ({
				data: await listMyNotificationDeliveries(tx, actor, query.limit ?? 50)
			}))
		)
}
