/**
 * Notification email digest & instant alert dispatchers (§15.2):
 *   - Respects hourly/daily cadence, instant-email preference, quiet hours & timezone
 *   - Composes HTML + plain-text emails via React Email (`src/email`)
 *   - Executes mail transport cleanly outside Postgres transactions.
 */

import type { NotificationDto } from '@huriro/contracts'
import { type Sql, withSystem, withWorkspace } from '@huriro/db'
import { evaluateNotificationSuppression, isWithinQuietHours } from '@huriro/domain'
import { createElement } from 'react'
import {
	createNoopEmailTransport,
	createSmtpTransport,
	type EmailMessage,
	type EmailPipeline,
	type EmailTransport,
	NotificationDigestEmail,
	renderEmail
} from '../../email'
import type { PresenceRegistry } from '../../realtime/presence-registry'
import { getUsersAvailabilityMap } from '../availability'
import {
	insertNotificationDeliveryLog,
	listUnreadNotificationsSince,
	listUsersDueForEmailDigest,
	markDigestSent,
	resolveWorkspaceEmailRecipients
} from './repo'

export type { EmailMessage, EmailTransport }

export interface SmtpConfig {
	readonly host?: string | undefined
	readonly port?: number | undefined
	readonly secure?: boolean | undefined
	readonly user?: string | undefined
	readonly pass?: string | undefined
	readonly from?: string | undefined
}

export function createDefaultEmailTransport(smtp?: SmtpConfig): EmailTransport {
	const host = smtp?.host
	const secure = smtp?.secure ?? smtp?.port === 465
	const port = smtp?.port ?? (secure ? 465 : 587)
	const from = smtp?.from ?? 'notifications@huriro.local'

	if (!host) {
		return createNoopEmailTransport('notification email skipped (SMTP unconfigured)')
	}

	return createSmtpTransport({
		host,
		port,
		secure,
		user: smtp.user,
		pass: smtp.pass,
		defaultFrom: from
	})
}

function buildActionPath(notification: NotificationDto): string {
	const meta = notification.metadata ?? {}
	if (notification.entityType === 'issue') return '/tasks'
	if (notification.entityType === 'doc_page') {
		const slug = typeof meta['slug'] === 'string' && meta['slug'] ? meta['slug'] : null
		return slug ? `/docs/${encodeURIComponent(slug)}` : '/docs'
	}
	if (notification.entityType === 'channel') {
		return `/chat?channel=${encodeURIComponent(notification.entityId)}`
	}
	if (notification.entityType === 'mail_conversation') {
		return `/mail?conversation=${encodeURIComponent(notification.entityId)}`
	}
	if (notification.entityType === 'agent_approval') {
		return '/settings?section=approvals'
	}
	return '/inbox'
}

function resolveContextLabel(notification: NotificationDto): string | undefined {
	const meta = notification.metadata ?? {}
	if (typeof meta['identifier'] === 'string' && meta['identifier']) return meta['identifier']
	if (typeof meta['channelName'] === 'string' && meta['channelName']) return `#${meta['channelName']}`
	if (typeof meta['slug'] === 'string' && meta['slug']) return meta['slug']
	return undefined
}

export async function runEmailDigestOnce(
	app: Sql,
	opts?: {
		readonly nowUtcIso?: string | undefined
		readonly transport?: EmailTransport | undefined
		readonly email?: EmailPipeline | undefined
		readonly smtp?: SmtpConfig | undefined
		readonly baseUrl?: string | undefined
		readonly presence?: PresenceRegistry | undefined
	}
): Promise<{
	readonly sent: number
	readonly skippedQuietHours: number
	readonly skippedAvailability: number
}> {
	const nowIso = opts?.nowUtcIso ?? new Date().toISOString()
	const baseUrl = (opts?.baseUrl ?? opts?.email?.baseUrl ?? 'http://localhost:3000').replace(/\/+$/, '')
	const appName = opts?.email?.appName ?? 'Huriro'
	const transport = opts?.transport ?? opts?.email?.transport ?? createDefaultEmailTransport(opts?.smtp)

	const workspaces = await withSystem(
		app,
		(tx) =>
			tx<{ id: string; name: string }[]>`
			SELECT id, name FROM list_active_workspaces_for_worker()
		`
	)

	let sent = 0
	let skippedQuietHours = 0
	let skippedAvailability = 0

	for (const ws of workspaces) {
		const prepared = await withWorkspace(app, { workspaceId: ws.id }, async (tx) => {
			const candidates = await listUsersDueForEmailDigest(tx, ws.id)
			const toSend: {
				readonly userId: string
				readonly email: string
				readonly subject: string
				readonly text: string
				readonly html: string
				readonly latestNotificationId: string | null
			}[] = []
			const skippedIds: { readonly userId: string; readonly latestNotificationId: string | null }[] = []
			const availability = await getUsersAvailabilityMap(
				tx,
				ws.id,
				candidates.map((c) => c.userId),
				opts?.presence,
				nowIso
			)
			let skippedByAvailability = 0

			for (const c of candidates) {
				const fallbackSince = new Date(Date.now() - 24 * 3600 * 1000).toISOString()
				const since = c.lastDigestSentAt ?? fallbackSince
				const unread = await listUnreadNotificationsSince(tx, ws.id, c.userId, since)
				if (unread.length === 0) continue

				const resolved = availability.get(c.userId)
				if (resolved) {
					const reason = evaluateNotificationSuppression({
						availability: {
							state: resolved.state,
							isAcceptingNotifications: resolved.isAcceptingNotifications
						},
						nowUtcIso: nowIso,
						allowUrgentOverride: resolved.allowUrgentOverride
					})
					if (reason) {
						await insertNotificationDeliveryLog(tx, {
							workspaceId: ws.id,
							notificationId: unread[0]?.id ?? null,
							userId: c.userId,
							channel: 'email_digest',
							status: reason,
							detail: `Suppressed by availability (${resolved.state})`
						})
						skippedIds.push({ userId: c.userId, latestNotificationId: unread[0]?.id ?? null })
						skippedByAvailability += 1
						continue
					}
				}

				if (isWithinQuietHours(nowIso, c.quietHoursStart, c.quietHoursEnd, c.timezone)) {
					await insertNotificationDeliveryLog(tx, {
						workspaceId: ws.id,
						notificationId: unread[0]?.id ?? null,
						userId: c.userId,
						channel: 'email_digest',
						status: 'skipped_quiet_hours',
						detail: `Quiet hours (${c.quietHoursStart}-${c.quietHoursEnd} ${c.timezone})`
					})
					skippedIds.push({ userId: c.userId, latestNotificationId: unread[0]?.id ?? null })
					continue
				}

				const rendered = await renderEmail(
					createElement(NotificationDigestEmail, {
						recipientName: c.displayName,
						workspaceName: ws.name,
						cadence: c.emailDigestFrequency,
						totalUnread: unread.length,
						items: unread.slice(0, 15).map((n) => ({
							kind: n.kind,
							title: n.title,
							body: n.body || undefined,
							createdAt: n.createdAt
						})),
						inboxUrl: `${baseUrl}/inbox`,
						preferencesUrl: `${baseUrl}/settings?section=notifications`,
						appName,
						baseUrl
					}),
					'notification_digest'
				)

				toSend.push({
					userId: c.userId,
					email: c.email,
					subject: `[${ws.name}] ${unread.length} unread notification${unread.length === 1 ? '' : 's'}`,
					text: rendered.text,
					html: rendered.html,
					latestNotificationId: unread[0]?.id ?? null
				})
			}

			return { toSend, skippedIds, skippedByAvailability }
		})

		skippedQuietHours += prepared.skippedIds.length
		skippedAvailability += prepared.skippedByAvailability

		for (const item of prepared.toSend) {
			let ok = true
			let errorDetail: string | null = null
			try {
				if (opts?.email && !opts?.transport) {
					await opts.email.sendRaw(
						{
							to: item.email,
							subject: item.subject,
							text: item.text,
							html: item.html
						},
						'notification_digest'
					)
				} else {
					await transport.send({
						to: item.email,
						subject: item.subject,
						text: item.text,
						html: item.html
					})
				}
			} catch (err) {
				ok = false
				errorDetail = err instanceof Error ? err.message.slice(0, 200) : 'Email send failed'
			}

			await withWorkspace(app, { workspaceId: ws.id }, async (tx) => {
				if (ok) {
					await markDigestSent(tx, ws.id, item.userId)
				}
				await insertNotificationDeliveryLog(tx, {
					workspaceId: ws.id,
					notificationId: item.latestNotificationId,
					userId: item.userId,
					channel: 'email_digest',
					status: ok ? 'sent' : 'failed',
					detail: ok ? 'Digest delivered' : errorDetail
				})
			})
			if (ok) sent++
		}
	}

	return { sent, skippedQuietHours, skippedAvailability }
}

/**
 * Worker-safe instant notification email dispatcher: resolves recipient email
 * addresses inside `withWorkspace`, sends rendered React Emails outside open DB
 * transactions, and persists `email_instant` delivery logs.
 */
export async function dispatchInstantNotificationEmails(
	app: Sql,
	workspaceId: string,
	items: readonly { readonly userId: string; readonly notification: NotificationDto }[],
	opts: { readonly email?: EmailPipeline | undefined }
): Promise<void> {
	if (items.length === 0 || !opts.email?.configured) return

	const userIds = [...new Set(items.map((item) => item.userId))]
	const recipients = await withWorkspace(app, { workspaceId }, (tx) =>
		resolveWorkspaceEmailRecipients(tx, workspaceId, userIds)
	)
	if (recipients.size === 0) return

	const outcomes: {
		readonly userId: string
		readonly notificationId: string
		readonly status: 'sent' | 'failed'
		readonly detail: string
	}[] = []

	for (const item of items) {
		const recipient = recipients.get(item.userId)
		if (!recipient) continue
		const n = item.notification
		try {
			if (n.kind === 'approval.requested') {
				const meta = n.metadata ?? {}
				const agentName =
					typeof meta['agentId'] === 'string' ? (n.title.split(' by ').at(-1) ?? 'Agent') : 'Agent'
				const toolName = typeof meta['tool'] === 'string' ? meta['tool'] : 'agent.tool'
				const tier = typeof meta['tier'] === 'string' ? meta['tier'] : 'R2'
				const approvalId = typeof meta['approvalId'] === 'string' ? meta['approvalId'] : n.entityId
				const result = await opts.email.sendAgentApprovalRequested({
					to: recipient.email,
					recipientName: recipient.displayName,
					workspaceName: recipient.workspaceName,
					agentName,
					toolName,
					tier,
					approvalId,
					idempotencyKey: `email-instant:${n.id}`
				})
				outcomes.push({
					userId: item.userId,
					notificationId: n.id,
					status: 'sent',
					detail: `provider=${result.provider}${result.messageId ? ` id=${result.messageId}` : ''}`
				})
			} else {
				const result = await opts.email.sendInstantNotification({
					to: recipient.email,
					recipientName: recipient.displayName,
					workspaceName: recipient.workspaceName,
					kind: n.kind,
					title: n.title,
					body: n.body || undefined,
					contextLabel: resolveContextLabel(n),
					actionPath: buildActionPath(n),
					idempotencyKey: `email-instant:${n.id}`
				})
				outcomes.push({
					userId: item.userId,
					notificationId: n.id,
					status: 'sent',
					detail: `provider=${result.provider}${result.messageId ? ` id=${result.messageId}` : ''}`
				})
			}
		} catch (err) {
			outcomes.push({
				userId: item.userId,
				notificationId: n.id,
				status: 'failed',
				detail: (err instanceof Error ? err.message : 'Instant email failed').slice(0, 200)
			})
		}
	}

	if (outcomes.length === 0) return

	await withWorkspace(app, { workspaceId }, async (tx) => {
		for (const o of outcomes) {
			await insertNotificationDeliveryLog(tx, {
				workspaceId,
				notificationId: o.notificationId,
				userId: o.userId,
				channel: 'email_instant',
				status: o.status,
				dedupeKey: `email_instant:${o.notificationId}`,
				detail: o.detail
			})
		}
	})
}
