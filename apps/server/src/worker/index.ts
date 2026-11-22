/**
 * Worker role: pg-boss queue + the transactional-outbox drain (§4.3, §19.1).
 *
 * pg-boss manages its own `pgboss` schema and needs DDL rights — it connects
 * with the admin URL. Job HANDLERS do tenant work through the huriro_app pool
 * inside withWorkspace, same as the API (§12.4).
 */
import { type Sql, withWorkspace } from '@huriro/db'
import { PgBoss } from 'pg-boss'
import { log, outboxLag } from '../api/observability'
import { processNotificationOutboxEvent } from '../modules/notifications'
import { processSearchOutboxEvent } from '../modules/search'
import type { RealtimePubSub } from '../realtime/pubsub'

export interface WorkerDeps {
	readonly adminUrl: string
	readonly app: Sql
	readonly pubsub?: RealtimePubSub
	readonly heartbeatUrl?: string | undefined
	readonly outboxIntervalMs?: number
}

const OUTBOX_BATCH = 200

interface PendingOutboxRow {
	readonly id: string
	readonly workspaceId: string | null
	readonly eventType: string
	readonly payload: Record<string, unknown>
}

/**
 * Drain pending outbox rows: dispatch to search & notifications consumers
 * inside `withWorkspace`, record in `processed_events`, and mark published.
 * Exported so integration tests can drain synchronously without polling.
 */
export async function drainOutboxOnce(app: Sql, pubsub?: RealtimePubSub): Promise<number> {
	const rows = await app.begin(async (tx) => {
		const picked = await tx<PendingOutboxRow[]>`
			SELECT id, workspace_id AS "workspaceId", event_type AS "eventType", payload
			FROM outbox
			WHERE published_at IS NULL
			ORDER BY created_at ASC
			LIMIT ${OUTBOX_BATCH}
			FOR UPDATE SKIP LOCKED
		`
		return picked
	})

	if (rows.length === 0) return 0

	let processedCount = 0
	const cursorsToPublish = new Map<string, number>()

	for (const row of rows) {
		try {
			if (row.workspaceId) {
				const cursor = await withWorkspace(app, { workspaceId: row.workspaceId }, async (tx) => {
					await processSearchOutboxEvent(tx, row)
					const notifRes = await processNotificationOutboxEvent(tx, row)
					await tx`
						INSERT INTO processed_events (consumer, event_id)
						VALUES ('outbox-drain', ${row.id})
						ON CONFLICT (consumer, event_id) DO NOTHING
					`
					await tx`UPDATE outbox SET published_at = now() WHERE id = ${row.id}`
					return notifRes.cursor
				})
				if (cursor !== null) {
					const prev = cursorsToPublish.get(row.workspaceId)
					cursorsToPublish.set(row.workspaceId, prev === undefined ? cursor : Math.max(prev, cursor))
				}
			} else {
				await app.begin(async (tx) => {
					await tx`
						INSERT INTO processed_events (consumer, event_id)
						VALUES ('outbox-drain', ${row.id})
						ON CONFLICT (consumer, event_id) DO NOTHING
					`
					await tx`UPDATE outbox SET published_at = now() WHERE id = ${row.id}`
				})
			}
			processedCount++
		} catch (err) {
			const msg = err instanceof Error ? err.message : String(err)
			log.error({ err, outboxId: row.id, eventType: row.eventType }, 'outbox consumer failed')
			await app`
				UPDATE outbox
				SET attempts = attempts + 1, last_error = ${msg}
				WHERE id = ${row.id}
			`.catch(() => {})
		}
	}

	if (pubsub) {
		for (const [wsId, cursor] of cursorsToPublish.entries()) {
			await pubsub.publishCursor(wsId, cursor).catch(() => {})
		}
	}

	if (processedCount > 0) log.info({ count: processedCount }, 'outbox drained')
	return processedCount
}

async function updateLagMetric(app: Sql) {
	const [row] = await app<{ n: number }[]>`SELECT count(*)::int AS n FROM outbox WHERE published_at IS NULL`
	outboxLag.set(row?.n ?? 0)
}

export async function startWorker(deps: WorkerDeps): Promise<{ stop(): Promise<void> }> {
	const boss = new PgBoss({ connectionString: deps.adminUrl })
	boss.on('error', (err: Error) => log.error({ err }, 'pg-boss error'))
	await boss.start()

	await boss.createQueue('outbox-drain')
	await boss.schedule('outbox-drain', '*/5 * * * * *', {}, { tz: 'UTC' })
	await boss.work('outbox-drain', async () => {
		await drainOutboxOnce(deps.app, deps.pubsub)
		await updateLagMetric(deps.app)
	})

	// Dead-man switch: page the operator if the worker loop goes quiet (§20.4).
	const heartbeatMs = 60_000
	const heartbeat = deps.heartbeatUrl
		? setInterval(() => {
				if (deps.heartbeatUrl) {
					fetch(deps.heartbeatUrl).catch((err) => log.warn({ err }, 'heartbeat ping failed'))
				}
			}, heartbeatMs)
		: null

	await updateLagMetric(deps.app)
	log.info({ queues: ['outbox-drain'] }, 'worker started')

	return {
		stop: async () => {
			if (heartbeat) clearInterval(heartbeat)
			await boss.stop({ graceful: true, timeout: 10_000 })
		}
	}
}
