/**
 * RFC 8292 Web Push sender + automatic `404`/`410` subscription revocation (§15.2).
 *
 * All push endpoints pass through `safeEgressFetch` so attackers cannot
 * register internal webhook URLs as browser push subscriptions.
 */
import { createPrivateKey, type KeyObject, sign } from 'node:crypto'
import type { NotificationDto } from '@huriro/contracts'
import { type Queryable, type Sql, withWorkspace } from '@huriro/db'
import { type DnsResolver, safeEgressFetch } from '../../api/egress'
import {
	insertNotificationDeliveryLog,
	listActiveWebPushSubscriptionSecretsForUser,
	revokeWebPushSubscriptionById,
	touchWebPushSubscription,
	type WebPushSubscriptionSecretRow
} from './repo'

export interface VapidConfig {
	readonly publicKey: string
	readonly privateKey: string
	readonly subject: string
}

export interface WebPushSendOptions {
	readonly vapid?: VapidConfig | undefined
	readonly fetchImpl?: typeof fetch | undefined
	readonly resolver?: DnsResolver | undefined
}

function toBase64Url(buf: Uint8Array | Buffer): string {
	return Buffer.from(buf).toString('base64url')
}

function parseVapidPrivateKey(config: VapidConfig): KeyObject {
	if (config.privateKey.includes('BEGIN')) {
		return createPrivateKey(config.privateKey)
	}
	const pubBytes = Buffer.from(config.publicKey, 'base64url')
	if (pubBytes.length === 65 && pubBytes[0] === 0x04) {
		const x = pubBytes.subarray(1, 33).toString('base64url')
		const y = pubBytes.subarray(33, 65).toString('base64url')
		return createPrivateKey({
			key: {
				kty: 'EC',
				crv: 'P-256',
				x,
				y,
				d: config.privateKey
			},
			format: 'jwk'
		})
	}
	throw new Error('Invalid VAPID key format')
}

export function createVapidAuthorizationHeader(endpoint: string, vapid: VapidConfig): string {
	const origin = new URL(endpoint).origin
	const exp = Math.floor(Date.now() / 1000) + 12 * 3600
	const header = toBase64Url(Buffer.from(JSON.stringify({ typ: 'JWT', alg: 'ES256' })))
	const claims = toBase64Url(
		Buffer.from(
			JSON.stringify({
				aud: origin,
				exp,
				sub: vapid.subject
			})
		)
	)
	const signingInput = `${header}.${claims}`
	const privateKey = parseVapidPrivateKey(vapid)
	const signature = sign('sha256', Buffer.from(signingInput), {
		key: privateKey,
		dsaEncoding: 'ieee-p1363'
	})
	return `vapid t=${signingInput}.${toBase64Url(signature)}, k=${vapid.publicKey}`
}

async function deliverSingleSubscription(
	sub: WebPushSubscriptionSecretRow,
	notification: NotificationDto,
	opts: WebPushSendOptions
): Promise<{ readonly status: 'sent' | 'failed'; readonly revoked: boolean; readonly detail: string }> {
	const headers: Record<string, string> = {
		'content-type': 'application/json',
		ttl: '3600',
		urgency: 'normal'
	}
	if (opts.vapid) {
		headers['authorization'] = createVapidAuthorizationHeader(sub.endpoint, opts.vapid)
	}

	const payload = JSON.stringify({
		id: notification.id,
		kind: notification.kind,
		title: notification.title,
		body: notification.body,
		entityType: notification.entityType,
		entityId: notification.entityId
	})

	try {
		const res = await safeEgressFetch(sub.endpoint, {
			method: 'POST',
			headers,
			body: payload,
			timeoutMs: 5_000,
			maxBytes: 16_384,
			...(opts.fetchImpl ? { fetcher: opts.fetchImpl } : {}),
			...(opts.resolver ? { resolver: opts.resolver } : {})
		})
		if (res.status === 404 || res.status === 410) {
			return { status: 'failed', revoked: true, detail: `HTTP ${res.status} subscription gone` }
		}
		if (res.status >= 200 && res.status < 300) {
			return { status: 'sent', revoked: false, detail: `HTTP ${res.status}` }
		}
		return { status: 'failed', revoked: false, detail: `HTTP ${res.status}` }
	} catch (err) {
		return {
			status: 'failed',
			revoked: false,
			detail: (err instanceof Error ? err.message : 'Push delivery error').slice(0, 200)
		}
	}
}

export async function sendWebPushToUser(
	tx: Queryable,
	workspaceId: string,
	userId: string,
	notification: NotificationDto,
	opts: WebPushSendOptions
): Promise<{ readonly attempted: number; readonly sent: number; readonly revoked: number }> {
	const subs = await listActiveWebPushSubscriptionSecretsForUser(tx, workspaceId, userId)
	if (subs.length === 0) return { attempted: 0, sent: 0, revoked: 0 }

	let sent = 0
	let revoked = 0
	for (const sub of subs) {
		const outcome = await deliverSingleSubscription(sub, notification, opts)
		if (outcome.revoked) {
			await revokeWebPushSubscriptionById(tx, workspaceId, sub.id)
			revoked++
		} else if (outcome.status === 'sent') {
			await touchWebPushSubscription(tx, workspaceId, sub.id)
			sent++
		}
		await insertNotificationDeliveryLog(tx, {
			workspaceId,
			notificationId: notification.id,
			userId,
			channel: 'web_push',
			status: outcome.status,
			detail: outcome.detail
		})
	}
	return { attempted: subs.length, sent, revoked }
}

/**
 * Worker-safe dispatcher: reads subscriptions in `withWorkspace`, executes HTTP
 * calls outside open DB transactions, then persists outcomes in `withWorkspace`.
 */
export async function dispatchWebPushNotifications(
	app: Sql,
	workspaceId: string,
	items: readonly { readonly userId: string; readonly notification: NotificationDto }[],
	opts: WebPushSendOptions
): Promise<void> {
	if (items.length === 0) return

	const work = await withWorkspace(app, { workspaceId }, async (tx) => {
		const batch: {
			readonly userId: string
			readonly notification: NotificationDto
			readonly subs: WebPushSubscriptionSecretRow[]
		}[] = []
		for (const item of items) {
			const subs = await listActiveWebPushSubscriptionSecretsForUser(tx, workspaceId, item.userId)
			if (subs.length > 0) batch.push({ ...item, subs })
		}
		return batch
	})

	if (work.length === 0) return

	const outcomes: {
		readonly subId: string
		readonly userId: string
		readonly notificationId: string
		readonly status: 'sent' | 'failed'
		readonly revoked: boolean
		readonly detail: string
	}[] = []

	for (const entry of work) {
		for (const sub of entry.subs) {
			const outcome = await deliverSingleSubscription(sub, entry.notification, opts)
			outcomes.push({
				subId: sub.id,
				userId: entry.userId,
				notificationId: entry.notification.id,
				...outcome
			})
		}
	}

	await withWorkspace(app, { workspaceId }, async (tx) => {
		for (const o of outcomes) {
			if (o.revoked) {
				await revokeWebPushSubscriptionById(tx, workspaceId, o.subId)
			} else if (o.status === 'sent') {
				await touchWebPushSubscription(tx, workspaceId, o.subId)
			}
			await insertNotificationDeliveryLog(tx, {
				workspaceId,
				notificationId: o.notificationId,
				userId: o.userId,
				channel: 'web_push',
				status: o.status,
				detail: o.detail
			})
		}
	})
}
