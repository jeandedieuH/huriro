/**
 * Observability baseline (ADR-0014): structured JSON logs to stdout +
 * Prometheus /metrics. Every request carries request_id, workspace_id and a
 * hashed user_id once auth lands — nothing reaches a log line without them.
 */
import { createHash, randomUUID } from 'node:crypto'
import type { Elysia } from 'elysia'
import pino from 'pino'
import client from 'prom-client'

const SECRET_PATTERNS = [
	/hrk_[A-Za-z0-9_-]{8}_[A-Za-z0-9_-]{10,}/g,
	/re_[A-Za-z0-9_-]{20,}/g,
	/em_[A-Za-z0-9_-]{20,}/g
]

/** Scrub credential-shaped strings (e.g. `hrk_…` API keys) from arbitrary log text. */
export function scrubSecrets(text: string): string {
	let out = text
	for (const re of SECRET_PATTERNS) out = out.replace(re, '[redacted]')
	return out
}

function deepScrub(value: unknown): unknown {
	if (typeof value === 'string') return scrubSecrets(value)
	if (Array.isArray(value)) return value.map(deepScrub)
	if (value !== null && typeof value === 'object') {
		return Object.fromEntries(Object.entries(value).map(([k, v]) => [k, deepScrub(v)]))
	}
	return value
}

export const log = pino({
	level: process.env['LOG_LEVEL'] ?? 'info',
	base: { service: 'huriro' },
	// Never log secrets/headers — §4.2: no secret in a log line.
	redact: {
		paths: [
			'req.headers.authorization',
			'req.headers.cookie',
			'*.password',
			'*.token',
			'*.secret',
			'*.webhookSecret',
			'*.signingSecret',
			'*.privateKey',
			'*.apiToken',
			'*.authSecret',
			'*.apiKey',
			'*.resendApiKey',
			'*.emailitApiKey',
			'*.smtpPass',
			'*.smtpUrl'
		],
		remove: true
	},
	// Value-level scrub for hrk_ API keys that reach a log field as part of a
	// message/detail string (redact.paths only covers whole fields).
	formatters: { log: (obj) => deepScrub(obj) as Record<string, unknown> }
})

export const metrics = new client.Registry()
client.collectDefaultMetrics({ register: metrics })

export const httpDuration = new client.Histogram({
	name: 'huriro_http_request_duration_seconds',
	help: 'HTTP request latency by route family and status class',
	labelNames: ['route', 'method', 'status_class'],
	buckets: [0.005, 0.02, 0.05, 0.12, 0.25, 0.5, 1, 2.5]
})
export const outboxLag = new client.Gauge({
	name: 'huriro_outbox_pending',
	help: 'Pending outbox events (worker lag signal, §4.3)'
})
export const outboxDeadLetters = new client.Gauge({
	name: 'huriro_outbox_dead_letters',
	help: 'Outbox events parked in dead-letter state awaiting operator replay (§5.5)'
})
export const outboxDeadLettersTotal = new client.Counter({
	name: 'huriro_outbox_dead_letters_total',
	help: 'Outbox events transitioned to dead-letter state, by event type (§5.5)',
	labelNames: ['event_type']
})
export const changeLogWriteMs = new client.Histogram({
	name: 'huriro_change_log_write_ms',
	help: 'Time to allocate a sync cursor + append change_log rows (§24 R3)',
	buckets: [1, 5, 10, 25, 50, 100]
})
export const collabRoomsGauge = new client.Gauge({
	name: 'huriro_collab_active_rooms',
	help: 'Currently loaded Hocuspocus document rooms'
})
export const collabConnectionsGauge = new client.Gauge({
	name: 'huriro_collab_active_connections',
	help: 'Currently active Hocuspocus WebSocket client connections'
})
export const collabStateBytesHistogram = new client.Histogram({
	name: 'huriro_collab_document_bytes',
	help: 'Encoded Y.Doc state size on persistence (§10.2)',
	buckets: [1024, 16384, 65536, 262144, 1048576, 2097152, 10485760]
})
export const collabLeaseConflictsTotal = new client.Counter({
	name: 'huriro_collab_lease_conflicts_total',
	help: 'Count of doc_room_leases ownership or epoch fencing conflicts (§10.5)'
})
export const collabStoreDurationSeconds = new client.Histogram({
	name: 'huriro_collab_store_duration_seconds',
	help: 'Duration of fenced Y.Doc PostgreSQL persistence (§10.5)',
	buckets: [0.005, 0.02, 0.05, 0.12, 0.25, 0.5, 1, 2.5]
})
export const chatMessagesTotal = new client.Counter({
	name: 'huriro_chat_messages_total',
	help: 'Total chat messages persisted (§15.1)',
	labelNames: ['kind']
})
export const chatFeedLatencyMs = new client.Histogram({
	name: 'huriro_chat_feed_latency_ms',
	help: 'Time to allocate channel seq/rev and persist chat messages (§15.1)',
	buckets: [1, 5, 10, 25, 50, 100, 250]
})
export const webhookDeliveriesTotal = new client.Counter({
	name: 'huriro_webhook_deliveries_total',
	help: 'Outbound webhook delivery attempts by outcome (§16.5)',
	labelNames: ['outcome']
})
export const fileScansTotal = new client.Counter({
	name: 'huriro_file_scans_total',
	help: 'Quarantine attachment scan results (§8.7)',
	labelNames: ['status']
})
export const githubSyncTotal = new client.Counter({
	name: 'huriro_github_sync_total',
	help: 'GitHub two-way sync operations by direction and status (§16.6)',
	labelNames: ['direction', 'status']
})
export const wsConnectionsGauge = new client.Gauge({
	name: 'huriro_ws_active_connections',
	help: 'Currently active signal-plane WebSocket connections (§20.1)'
})
export const emailsTotal = new client.Counter({
	name: 'huriro_emails_total',
	help: 'Transactional and notification emails processed by template, provider, and status',
	labelNames: ['template', 'provider', 'status']
})
export const emailRenderDurationSeconds = new client.Histogram({
	name: 'huriro_email_render_duration_seconds',
	help: 'Duration of React Email template rendering into HTML and plain text',
	labelNames: ['template'],
	buckets: [0.001, 0.005, 0.02, 0.05, 0.1, 0.25, 0.5, 1]
})
metrics.registerMetric(httpDuration)
metrics.registerMetric(outboxLag)
metrics.registerMetric(outboxDeadLetters)
metrics.registerMetric(outboxDeadLettersTotal)
metrics.registerMetric(changeLogWriteMs)
metrics.registerMetric(collabRoomsGauge)
metrics.registerMetric(collabConnectionsGauge)
metrics.registerMetric(collabStateBytesHistogram)
metrics.registerMetric(collabLeaseConflictsTotal)
metrics.registerMetric(collabStoreDurationSeconds)
metrics.registerMetric(chatMessagesTotal)
metrics.registerMetric(chatFeedLatencyMs)
metrics.registerMetric(webhookDeliveriesTotal)
metrics.registerMetric(fileScansTotal)
metrics.registerMetric(githubSyncTotal)
metrics.registerMetric(wsConnectionsGauge)
metrics.registerMetric(emailsTotal)
metrics.registerMetric(emailRenderDurationSeconds)

export function hashForLog(id: string | undefined): string | undefined {
	if (!id) return undefined
	return createHash('sha256').update(id).digest('hex').slice(0, 12)
}

/**
 * Request-scoped hooks: request id in/out, structured access log, duration
 * histogram keyed by route family (not raw paths — avoids label cardinality).
 * Header mutation + metrics live in onAfterHandle (pre-serialization);
 * onAfterResponse is post-send and too late for headers.
 *
 * Registered as a functional plugin — `.use(observability)` runs this on the
 * app instance itself, so hooks are global. (An Elysia-instance plugin would be
 * scoped to its own routes in v2 and these hooks would silently never run.)
 */
export function observability(app: Elysia): Elysia {
	return app
		.state('requestId', '')
		.onRequest(({ request, store }) => {
			store.requestId = request.headers.get('x-request-id') ?? `req_${randomUUID()}`
			;(store as { start?: number }).start = performance.now()
		})
		.onAfterHandle(({ request, store, set, route }) => {
			const ms = performance.now() - ((store as { start?: number }).start ?? 0)
			const status = Number(set.status ?? 200)
			httpDuration
				.labels(route || 'unmatched', request.method, `${Math.floor(status / 100)}xx`)
				.observe(ms / 1000)
			log.info(
				{
					request_id: store.requestId,
					method: request.method,
					path: new URL(request.url).pathname,
					route,
					status,
					ms: Math.round(ms * 100) / 100
				},
				'http'
			)
			set.headers['x-request-id'] = store.requestId
		})
		.onError(({ store, set }) => {
			// Error path still carries the correlation id out (§16.2).
			set.headers['x-request-id'] = store.requestId
		}) as unknown as Elysia
}
