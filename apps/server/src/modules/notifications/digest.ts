/**
 * Notification email digest worker (§15.2):
 *   - Respects hourly/daily cadence + per-user quiet hours + timezone
 *   - Records sent & quiet-hours-skipped attempts in `notification_delivery_log`
 *   - Executes mail transport cleanly outside Postgres transactions.
 */
import net from 'node:net'
import { type Sql, withSystem, withWorkspace } from '@huriro/db'
import { isWithinQuietHours } from '@huriro/domain'
import { log } from '../../api/observability'
import {
	insertNotificationDeliveryLog,
	listUnreadNotificationsSince,
	listUsersDueForEmailDigest,
	markDigestSent
} from './repo'

export interface EmailMessage {
	readonly to: string
	readonly subject: string
	readonly text: string
	readonly html: string
}

export interface EmailTransport {
	send(message: EmailMessage): Promise<void>
}

export interface SmtpConfig {
	readonly host?: string | undefined
	readonly port?: number | undefined
	readonly from?: string | undefined
}

export function createDefaultEmailTransport(smtp?: SmtpConfig): EmailTransport {
	const host = smtp?.host
	const port = smtp?.port ?? 587
	const from = smtp?.from ?? 'notifications@huriro.local'

	if (!host) {
		return {
			async send(msg) {
				log.info(
					{ to: msg.to, subject: msg.subject },
					'notification email digest skipped (SMTP unconfigured)'
				)
			}
		}
	}

	return {
		async send(msg) {
			await new Promise<void>((resolve, reject) => {
				const socket = net.createConnection({ host, port, timeout: 5_000 })
				socket.setTimeout(5_000)
				const cleanTo = msg.to.replace(/[\r\n]/g, '')
				const cleanSubject = msg.subject.replace(/[\r\n]/g, '')
				const lines = [
					`EHLO huriro.local\r\n`,
					`MAIL FROM:<${from}>\r\n`,
					`RCPT TO:<${cleanTo}>\r\n`,
					`DATA\r\n`,
					`From: Huriro <${from}>\r\nTo: <${cleanTo}>\r\nSubject: ${cleanSubject}\r\nMIME-Version: 1.0\r\nContent-Type: text/plain; charset=utf-8\r\n\r\n${msg.text}\r\n.\r\n`,
					`QUIT\r\n`
				]
				let idx = 0
				socket.on('data', () => {
					if (idx < lines.length) {
						socket.write(lines[idx++]!)
					} else {
						socket.end()
						resolve()
					}
				})
				socket.on('timeout', () => {
					socket.destroy(new Error('SMTP timeout'))
				})
				socket.on('error', (err) => reject(err))
			})
		}
	}
}

export async function runEmailDigestOnce(
	app: Sql,
	opts?: {
		readonly nowUtcIso?: string | undefined
		readonly transport?: EmailTransport | undefined
		readonly smtp?: SmtpConfig | undefined
	}
): Promise<{ readonly sent: number; readonly skippedQuietHours: number }> {
	const nowIso = opts?.nowUtcIso ?? new Date().toISOString()
	const transport = opts?.transport ?? createDefaultEmailTransport(opts?.smtp)

	const workspaces = await withSystem(
		app,
		(tx) =>
			tx<{ id: string; name: string }[]>`
			SELECT id, name FROM list_active_workspaces_for_worker()
		`
	)

	let sent = 0
	let skippedQuietHours = 0

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

			for (const c of candidates) {
				const fallbackSince = new Date(Date.now() - 24 * 3600 * 1000).toISOString()
				const since = c.lastDigestSentAt ?? fallbackSince
				const unread = await listUnreadNotificationsSince(tx, ws.id, c.userId, since)
				if (unread.length === 0) continue

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

				const summaryLines = unread.slice(0, 15).map((n) => `- ${n.title}${n.body ? `: ${n.body}` : ''}`)
				toSend.push({
					userId: c.userId,
					email: c.email,
					subject: `[${ws.name}] ${unread.length} unread notifications`,
					text: `Hi ${c.displayName},\n\nYou have ${unread.length} unread notifications in ${ws.name}:\n\n${summaryLines.join('\n')}\n`,
					html: `<p>Hi ${c.displayName},</p><p>You have ${unread.length} unread notifications in ${ws.name}:</p><ul>${unread
						.slice(0, 15)
						.map((n) => `<li><strong>${n.title}</strong></li>`)
						.join('')}</ul>`,
					latestNotificationId: unread[0]?.id ?? null
				})
			}

			return { toSend, skippedIds }
		})

		skippedQuietHours += prepared.skippedIds.length

		for (const item of prepared.toSend) {
			let ok = true
			let errorDetail: string | null = null
			try {
				await transport.send({
					to: item.email,
					subject: item.subject,
					text: item.text,
					html: item.html
				})
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

	return { sent, skippedQuietHours }
}
