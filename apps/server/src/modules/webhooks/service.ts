import { randomBytes } from 'node:crypto'
import type {
	CreateWebhookBody,
	CreateWebhookResponse,
	UpdateWebhookBody,
	WebhookDeliveryDto,
	WebhookEndpointDto
} from '@huriro/contracts'
import { type Queryable, type Sql, uuid7, withSystem, withWorkspace } from '@huriro/db'
import { type ActorContext, computeWebhookBackoffMs } from '@huriro/domain'
import { decryptSecret, encryptSecret, signWebhookPayload } from '../../api/crypto'
import {
	type DnsResolver,
	SsrfBlockedError,
	safeEgressFetch,
	validateAndResolveEgressUrl
} from '../../api/egress'
import { HttpError } from '../../api/error'
import { webhookDeliveriesTotal } from '../../api/observability'
import { WEBHOOK_EVENTS, WEBHOOKS_CONSUMER } from './events'
import { authorizeWebhookManage } from './policy'
import {
	type ClaimedDeliveryWithEndpoint,
	claimDueWebhookDeliveryRows,
	deleteWebhookEndpointRow,
	getWebhookEndpointWithSecret,
	insertWebhookDeliveryRow,
	insertWebhookEndpointRow,
	listMatchingEnabledEndpointIds,
	listWebhookDeliveryRows,
	listWebhookEndpointRows,
	resetWebhookDeliveryForReplayRow,
	updateWebhookDeliveryOutcome,
	updateWebhookEndpointRow
} from './repo'

export interface WebhookRuntimeOptions {
	readonly rootSecret: string
	readonly fetchImpl?: typeof fetch | undefined
	readonly resolver?: DnsResolver | undefined
	readonly nowMs?: (() => number) | undefined
}

function generateSigningSecret(): { readonly raw: string; readonly prefix: string } {
	const raw = `whsec_${randomBytes(24).toString('hex')}`
	return { raw, prefix: raw.slice(0, 12) }
}

function webhookAad(workspaceId: string, endpointId: string): string {
	return `${workspaceId}:webhook:${endpointId}`
}

async function assertSafeWebhookUrl(rawUrl: string, resolver?: DnsResolver): Promise<void> {
	try {
		await validateAndResolveEgressUrl(rawUrl, resolver)
	} catch (err) {
		if (err instanceof SsrfBlockedError) {
			throw new HttpError(422, 'ssrf_blocked', err.message)
		}
		throw err
	}
}

export async function listWebhookEndpoints(
	tx: Queryable,
	actor: ActorContext
): Promise<WebhookEndpointDto[]> {
	authorizeWebhookManage(actor)
	return listWebhookEndpointRows(tx, actor.workspaceId)
}

export async function createWebhookEndpoint(
	tx: Queryable,
	actor: ActorContext,
	input: CreateWebhookBody,
	opts: WebhookRuntimeOptions
): Promise<CreateWebhookResponse> {
	authorizeWebhookManage(actor)
	await assertSafeWebhookUrl(input.url, opts.resolver)

	const id = uuid7()
	const secret = generateSigningSecret()
	const secretEncrypted = encryptSecret(opts.rootSecret, webhookAad(actor.workspaceId, id), secret.raw)

	const endpoint = await insertWebhookEndpointRow(tx, {
		id,
		workspaceId: actor.workspaceId,
		name: input.name.trim(),
		url: input.url.trim(),
		secretEncrypted,
		secretPrefix: secret.prefix,
		events: input.events,
		enabled: input.enabled ?? true,
		createdBy: actor.principalId
	})

	await tx`
		INSERT INTO audit_log (workspace_id, actor_type, actor_id, action, target_type, target_id, metadata)
		VALUES (
			${actor.workspaceId},
			${actor.kind},
			${actor.principalId},
			'webhook.create',
			'webhook_endpoint',
			${endpoint.id},
			${tx.json({ name: endpoint.name, events: endpoint.events } as never)}
		)
	`

	await tx`
		INSERT INTO outbox (workspace_id, aggregate, aggregate_id, event_type, payload)
		VALUES (
			${actor.workspaceId},
			'webhook_endpoint',
			${endpoint.id},
			${WEBHOOK_EVENTS.EndpointCreated},
			${tx.json({ endpointId: endpoint.id, name: endpoint.name } as never)}
		)
	`

	return { endpoint, signingSecret: secret.raw }
}

export async function updateWebhookEndpoint(
	tx: Queryable,
	actor: ActorContext,
	endpointId: string,
	input: UpdateWebhookBody,
	opts: WebhookRuntimeOptions
): Promise<{ readonly endpoint: WebhookEndpointDto; readonly signingSecret?: string | undefined }> {
	authorizeWebhookManage(actor)
	const existing = await getWebhookEndpointWithSecret(tx, actor.workspaceId, endpointId)
	if (!existing) throw new HttpError(404, 'not_found', 'Webhook endpoint not found')

	if (existing.endpoint.version !== input.version) {
		throw new HttpError(409, 'stale_version', 'Webhook endpoint modified concurrently', undefined, {
			currentVersion: existing.endpoint.version,
			yourVersion: input.version
		})
	}

	const nextUrl = input.url !== undefined ? input.url.trim() : existing.endpoint.url
	if (input.url !== undefined) {
		await assertSafeWebhookUrl(nextUrl, opts.resolver)
	}

	let secretEncrypted = existing.secretEncrypted
	let secretPrefix = existing.endpoint.secretPrefix
	let rotatedPlaintext: string | undefined
	if (input.rotateSecret) {
		const fresh = generateSigningSecret()
		secretEncrypted = encryptSecret(opts.rootSecret, webhookAad(actor.workspaceId, endpointId), fresh.raw)
		secretPrefix = fresh.prefix
		rotatedPlaintext = fresh.raw
	}

	const updated = await updateWebhookEndpointRow(tx, {
		workspaceId: actor.workspaceId,
		endpointId,
		expectedVersion: input.version,
		name: input.name !== undefined ? input.name.trim() : existing.endpoint.name,
		url: nextUrl,
		events: input.events ?? existing.endpoint.events,
		enabled: input.enabled ?? existing.endpoint.enabled,
		secretEncrypted,
		secretPrefix
	})
	if (!updated) throw new HttpError(409, 'stale_version', 'Webhook endpoint modified concurrently')

	await tx`
		INSERT INTO audit_log (workspace_id, actor_type, actor_id, action, target_type, target_id, metadata)
		VALUES (
			${actor.workspaceId},
			${actor.kind},
			${actor.principalId},
			${input.rotateSecret ? 'webhook.secret.rotate' : 'webhook.update'},
			'webhook_endpoint',
			${updated.id},
			${tx.json({ enabled: updated.enabled, events: updated.events } as never)}
		)
	`

	return rotatedPlaintext !== undefined
		? { endpoint: updated, signingSecret: rotatedPlaintext }
		: { endpoint: updated }
}

export async function deleteWebhookEndpoint(
	tx: Queryable,
	actor: ActorContext,
	endpointId: string
): Promise<void> {
	authorizeWebhookManage(actor)
	const ok = await deleteWebhookEndpointRow(tx, actor.workspaceId, endpointId)
	if (!ok) throw new HttpError(404, 'not_found', 'Webhook endpoint not found')

	await tx`
		INSERT INTO audit_log (workspace_id, actor_type, actor_id, action, target_type, target_id, metadata)
		VALUES (
			${actor.workspaceId},
			${actor.kind},
			${actor.principalId},
			'webhook.delete',
			'webhook_endpoint',
			${endpointId},
			'{}'::jsonb
		)
	`
}

export async function listWebhookDeliveries(
	tx: Queryable,
	actor: ActorContext,
	endpointId: string,
	limit = 50
): Promise<WebhookDeliveryDto[]> {
	authorizeWebhookManage(actor)
	const ep = await getWebhookEndpointWithSecret(tx, actor.workspaceId, endpointId)
	if (!ep) throw new HttpError(404, 'not_found', 'Webhook endpoint not found')
	return listWebhookDeliveryRows(tx, actor.workspaceId, endpointId, limit)
}

export async function enqueueWebhookDeliveriesForOutboxEvent(
	tx: Queryable,
	event: {
		readonly id: string
		readonly workspaceId: string | null
		readonly eventType: string
		readonly payload: Record<string, unknown>
	}
): Promise<number> {
	if (!event.workspaceId) return 0
	if (event.eventType.startsWith('webhooks.')) return 0

	const claimed = await tx<{ eventId: string }[]>`
		INSERT INTO processed_events (consumer, event_id)
		VALUES (${WEBHOOKS_CONSUMER}, ${event.id})
		ON CONFLICT (consumer, event_id) DO NOTHING
		RETURNING event_id AS "eventId"
	`
	if (claimed.length === 0) return 0

	const endpoints = await listMatchingEnabledEndpointIds(tx, event.workspaceId, event.eventType)
	for (const ep of endpoints) {
		await insertWebhookDeliveryRow(tx, {
			workspaceId: event.workspaceId,
			endpointId: ep.id,
			eventId: event.id,
			eventType: event.eventType,
			payload: event.payload
		})
	}
	return endpoints.length
}

async function attemptSingleDelivery(
	item: ClaimedDeliveryWithEndpoint,
	opts: WebhookRuntimeOptions
): Promise<{
	readonly deliveryId: string
	readonly status: 'delivered' | 'retrying' | 'failed'
	readonly attempts: number
	readonly nextAttemptAtIso: string
	readonly lastStatusCode: number | null
	readonly lastResponseBody: string | null
	readonly lastError: string | null
	readonly deliveredAtIso: string | null
}> {
	const nowMs = opts.nowMs ? opts.nowMs() : Date.now()
	const nextAttempts = item.delivery.attempts + 1

	const failWith = (statusCode: number | null, responseBody: string | null, errMsg: string) => {
		const backoffMs = computeWebhookBackoffMs(nextAttempts, item.delivery.maxAttempts)
		const terminal = backoffMs === null
		webhookDeliveriesTotal.inc({ outcome: terminal ? 'failed' : 'retrying' })
		return {
			deliveryId: item.delivery.id,
			status: (terminal ? 'failed' : 'retrying') as 'failed' | 'retrying',
			attempts: nextAttempts,
			nextAttemptAtIso: new Date(nowMs + (backoffMs ?? 0)).toISOString(),
			lastStatusCode: statusCode,
			lastResponseBody: responseBody,
			lastError: errMsg.slice(0, 500),
			deliveredAtIso: null
		}
	}

	let secret: string
	try {
		secret = decryptSecret(
			opts.rootSecret,
			webhookAad(item.delivery.workspaceId, item.delivery.endpointId),
			item.secretEncrypted
		)
	} catch (err) {
		return failWith(null, null, err instanceof Error ? err.message : 'Failed to decrypt webhook secret')
	}

	const rawBody = JSON.stringify({
		id: item.delivery.id,
		eventId: item.delivery.eventId,
		eventType: item.delivery.eventType,
		workspaceId: item.delivery.workspaceId,
		createdAt: item.delivery.createdAt,
		data: item.delivery.payload
	})
	const sig = signWebhookPayload(secret, Math.floor(nowMs / 1000), rawBody)

	try {
		const res = await safeEgressFetch(item.url, {
			method: 'POST',
			headers: {
				'content-type': 'application/json',
				'x-huriro-signature': sig,
				'x-huriro-event': item.delivery.eventType,
				'x-huriro-delivery': item.delivery.id
			},
			body: rawBody,
			timeoutMs: 10_000,
			maxBytes: 65_536,
			...(opts.fetchImpl ? { fetcher: opts.fetchImpl } : {}),
			...(opts.resolver ? { resolver: opts.resolver } : {})
		})
		const snippet = new TextDecoder('utf-8', { fatal: false }).decode(res.bodyBytes).slice(0, 500)
		if (res.status >= 200 && res.status < 300) {
			webhookDeliveriesTotal.inc({ outcome: 'delivered' })
			return {
				deliveryId: item.delivery.id,
				status: 'delivered',
				attempts: nextAttempts,
				nextAttemptAtIso: new Date(nowMs).toISOString(),
				lastStatusCode: res.status,
				lastResponseBody: snippet,
				lastError: null,
				deliveredAtIso: new Date(nowMs).toISOString()
			}
		}
		return failWith(res.status, snippet, `Receiver returned HTTP ${res.status}`)
	} catch (err) {
		return failWith(null, null, err instanceof Error ? err.message : 'Webhook egress failed')
	}
}

export async function processDueWebhookDeliveriesOnce(
	app: Sql,
	opts: WebhookRuntimeOptions
): Promise<{ readonly delivered: number; readonly retrying: number; readonly failed: number }> {
	const workspaces = await withSystem(
		app,
		(tx) => tx<{ id: string }[]>`SELECT id FROM list_active_workspaces_for_worker()`
	)

	let delivered = 0
	let retrying = 0
	let failed = 0

	for (const ws of workspaces) {
		const claimed = await withWorkspace(app, { workspaceId: ws.id }, (tx) =>
			claimDueWebhookDeliveryRows(tx, ws.id, 50)
		)
		if (claimed.length === 0) continue

		const outcomes: Awaited<ReturnType<typeof attemptSingleDelivery>>[] = []
		for (const item of claimed) {
			if (!item.endpointEnabled) continue
			outcomes.push(await attemptSingleDelivery(item, opts))
		}
		if (outcomes.length === 0) continue

		await withWorkspace(app, { workspaceId: ws.id }, async (tx) => {
			for (const o of outcomes) {
				await updateWebhookDeliveryOutcome(tx, { workspaceId: ws.id, ...o })
				if (o.status === 'delivered') delivered++
				else if (o.status === 'retrying') retrying++
				else failed++
			}
		})
	}

	return { delivered, retrying, failed }
}

export async function replayWebhookDelivery(
	app: Sql,
	actor: ActorContext,
	deliveryId: string,
	opts: WebhookRuntimeOptions
): Promise<WebhookDeliveryDto> {
	const reset = await withWorkspace(
		app,
		{ workspaceId: actor.workspaceId, userId: actor.principalId },
		async (tx) => {
			authorizeWebhookManage(actor)
			const item = await resetWebhookDeliveryForReplayRow(tx, actor.workspaceId, deliveryId)
			if (!item) throw new HttpError(404, 'not_found', 'Webhook delivery not found')
			return item
		}
	)

	const outcome = await attemptSingleDelivery(reset, opts)
	const updated = await withWorkspace(
		app,
		{ workspaceId: actor.workspaceId, userId: actor.principalId },
		async (tx) => {
			const row = await updateWebhookDeliveryOutcome(tx, {
				workspaceId: actor.workspaceId,
				...outcome
			})
			await tx`
				INSERT INTO audit_log (workspace_id, actor_type, actor_id, action, target_type, target_id, metadata)
				VALUES (
					${actor.workspaceId},
					${actor.kind},
					${actor.principalId},
					'webhook.delivery.replay',
					'webhook_delivery',
					${deliveryId},
					${tx.json({ status: outcome.status, statusCode: outcome.lastStatusCode } as never)}
				)
			`
			return row
		}
	)
	return updated ?? reset.delivery
}
