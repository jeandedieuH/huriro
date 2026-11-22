/**
 * Observability baseline (ADR-0014): structured JSON logs to stdout +
 * Prometheus /metrics. Every request carries request_id, workspace_id and a
 * hashed user_id once auth lands — nothing reaches a log line without them.
 */
import { createHash, randomUUID } from 'node:crypto'
import type { Elysia } from 'elysia'
import pino from 'pino'
import client from 'prom-client'

export const log = pino({
	level: process.env['LOG_LEVEL'] ?? 'info',
	base: { service: 'huriro' },
	// Never log secrets/headers — §4.2: no secret in a log line.
	redact: {
		paths: ['req.headers.authorization', 'req.headers.cookie', '*.password', '*.token', '*.secret'],
		remove: true
	}
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
export const changeLogWriteMs = new client.Histogram({
	name: 'huriro_change_log_write_ms',
	help: 'Time to allocate a sync cursor + append change_log rows (§24 R3)',
	buckets: [1, 5, 10, 25, 50, 100]
})
metrics.registerMetric(httpDuration)
metrics.registerMetric(outboxLag)
metrics.registerMetric(changeLogWriteMs)

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
