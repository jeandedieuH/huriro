/**
 * Worker role: pg-boss queue + the transactional-outbox drain (§4.3, §19.1).
 *
 * pg-boss manages its own `pgboss` schema and needs DDL rights — it connects
 * with the admin URL. Job HANDLERS do tenant work through the huriro_app pool
 * inside withWorkspace, same as the API (§12.4).
 */
import type { Sql } from '@huriro/db'
import { PgBoss } from 'pg-boss'
import { log, outboxLag } from '../api/observability'

export interface WorkerDeps {
	readonly adminUrl: string
	readonly app: Sql
	readonly heartbeatUrl?: string | undefined
	readonly outboxIntervalMs?: number
}

const OUTBOX_BATCH = 200

/**
 * Drain pending outbox rows: mark published + record in processed_events so
 * consumers stay idempotent (at-least-once → effect-once, §4.3).
 */
async function drainOutbox(app: Sql): Promise<number> {
	return app.begin(async (tx) => {
		const rows = await tx<{ id: string; eventType: string; workspaceId: string | null }[]>`
			SELECT id, event_type AS "eventType", workspace_id AS "workspaceId"
			FROM outbox
			WHERE published_at IS NULL
			ORDER BY created_at
			LIMIT ${OUTBOX_BATCH}
			FOR UPDATE SKIP LOCKED
		`
		if (rows.length === 0) return 0
		for (const row of rows) {
			await tx`
				INSERT INTO processed_events (consumer, event_id)
				VALUES ('outbox-drain', ${row.id})
				ON CONFLICT (consumer, event_id) DO NOTHING
			`
			await tx`UPDATE outbox SET published_at = now() WHERE id = ${row.id}`
		}
		log.info({ count: rows.length }, 'outbox drained')
		return rows.length
	})
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
		await drainOutbox(deps.app)
		await updateLagMetric(deps.app)
	})

	// Dead-man switch: page the operator if the worker loop goes quiet (§20.4).
	const heartbeatMs = 60_000
	const heartbeat = deps.heartbeatUrl
		? setInterval(() => {
				fetch(deps.heartbeatUrl!).catch((err) => log.warn({ err }, 'heartbeat ping failed'))
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
