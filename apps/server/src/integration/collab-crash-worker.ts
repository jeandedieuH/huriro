/**
 * Real child-process realtime worker helper for Gate G2 `SIGKILL` (`kill -9`) and
 * graceful `SIGTERM` flush integration tests (§21.3, Gate G2).
 */
import { createAppPool } from '@huriro/db'
import { createCollabRuntime, startRealtime } from '../realtime'
import { InProcessPubSub } from '../realtime/pubsub'

async function main() {
	const appUrl = process.env['HURIRO_TEST_APP_DB_URL']
	if (!appUrl) {
		throw new Error('HURIRO_TEST_APP_DB_URL is required')
	}
	const ticketSecret = process.env['HURIRO_TEST_TICKET_SECRET'] ?? 'huriro-test-collab-secret'
	const nodeId = process.env['HURIRO_TEST_NODE_ID'] ?? `worker_${process.pid}`
	const leaseTtlMs = Number(process.env['HURIRO_TEST_LEASE_TTL_MS'] ?? '1500')
	const debounceMs = Number(process.env['HURIRO_TEST_DEBOUNCE_MS'] ?? '60000')
	const maxDebounceMs = Number(
		process.env['HURIRO_TEST_MAX_DEBOUNCE_MS'] ?? String(Math.max(debounceMs, 1000))
	)

	const sql = createAppPool(appUrl, { max: 4 })
	const pubsub = new InProcessPubSub()
	const collab = createCollabRuntime({
		sql,
		pubsub,
		ticketSecret,
		nodeId,
		leaseTtlMs,
		leaseRenewMs: Math.max(200, Math.floor(leaseTtlMs / 3)),
		debounceMs,
		maxDebounceMs
	})

	const rt = startRealtime({
		port: 0,
		sql,
		pubsub,
		collab
	})

	process.stdout.write(
		`${JSON.stringify({ HuriroCrashWorkerReady: true, port: rt.port, nodeId: collab.nodeId })}\n`
	)

	const shutdown = async () => {
		try {
			await rt.stop()
		} finally {
			await sql.end()
		}
		process.exit(0)
	}

	process.on('SIGTERM', () => {
		void shutdown()
	})
	process.on('SIGINT', () => {
		void shutdown()
	})
}

void main()
