/**
 * Realtime role — M0 stub (§19.1 role exists; sync/pubsub arrives with the
 * sync milestone). Serves /healthz and rejects /ws upgrades with a clear 501
 * so reverse-proxy smoke tests have a deterministic target.
 */
import { log } from '../api/observability'

export function startRealtime(port: number): { stop(): void } {
	const server = Bun.serve({
		port,
		fetch(req) {
			const url = new URL(req.url)
			if (url.pathname === '/healthz') return Response.json({ status: 'ok', role: 'realtime' })
			if (url.pathname === '/ws') {
				return new Response('Realtime sync arrives with the sync milestone (M1).', { status: 501 })
			}
			return new Response('Not found', { status: 404 })
		}
	})
	log.info({ port: server.port }, 'realtime stub listening')
	return { stop: () => server.stop() }
}
