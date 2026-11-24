import type { Sql } from '@huriro/db'
import { can } from '@huriro/domain'
import { Elysia } from 'elysia'
import type { DnsResolver } from '../../api/egress'
import { HttpError } from '../../api/error'
import type { EmailPipeline } from '../../email'
import type { RealtimePubSub } from '../../realtime/pubsub'
import type { Auth } from '../identity'
import { workspaceDerive } from '../tenancy'
import {
	dispatchInstantNotificationEmails,
	type EmailMessage,
	type EmailTransport,
	runEmailDigestOnce
} from './digest'
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
	EmailPipelineStatusDto,
	MobileTokenIdParam,
	NotificationIdParam,
	NotificationsListQuery,
	RegisterMobilePushTokenBody,
	SendTestEmailBody,
	SendTestEmailResponse,
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
	dispatchInstantNotificationEmails,
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
	opts?: {
		readonly vapid?: VapidConfig | undefined
		readonly resolver?: DnsResolver | undefined
		readonly email?: EmailPipeline | undefined
	}
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
		.get('/notifications/email/status', { response: EmailPipelineStatusDto }, ({ inWorkspace }) =>
			inWorkspace(async () => {
				if (opts?.email) return opts.email.getStatus()
				return {
					configured: false,
					mode: 'selfhost' as const,
					provider: 'noop' as const,
					from: 'noreply@huriro.local',
					emailVerificationRequired: false
				}
			})
		)
		.post(
			'/notifications/email/test',
			{ body: SendTestEmailBody, response: SendTestEmailResponse },
			async ({ body, workspaceCtx, inWorkspace }) => {
				const workspaceName = await inWorkspace(async (tx, actor) => {
					if (can(actor, 'settings.manage', { type: 'workspace' }).effect !== 'allow') {
						throw new HttpError(403, 'insufficient_role', 'settings.manage required')
					}
					const [ws] = await tx<{ name: string }[]>`
						SELECT name FROM workspaces WHERE id = ${workspaceCtx.workspaceId}
					`
					return ws?.name ?? 'Huriro Workspace'
				})
				if (!opts?.email?.configured) {
					throw new HttpError(
						503,
						'email_not_configured',
						'Email provider is not configured',
						'Configure RESEND_API_KEY, SMTP_URL/SMTP_HOST, or EMAILIT_API_KEY on the server before sending test emails.'
					)
				}
				const targetEmail = (body.to ?? workspaceCtx.session.email).trim()
				const sent = await opts.email.sendTestEmail({
					to: targetEmail,
					workspaceName
				})
				return {
					sent: !sent.skipped,
					provider: sent.provider,
					messageId: sent.messageId,
					to: targetEmail
				}
			}
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
