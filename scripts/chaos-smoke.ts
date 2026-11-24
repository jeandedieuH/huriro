#!/usr/bin/env bun
/**
 * Chaos smoke test (M6 HA & Resilience):
 *   1. Starts an ephemeral mock RESP2 Valkey server over loopback TCP.
 *   2. Verifies `ResilientPubSub` delivers signals through `ValkeyPubSub`.
 *   3. Kills the mock Valkey server mid-flight and verifies immediate failover
 *      to `InProcessPubSub` without exceptions or dropped local deliveries.
 *   4. Re-starts the mock Valkey server on the same port and verifies clean close.
 *   5. Verifies `ApiRateLimiter` enforces per-window ceilings.
 */
import net from 'node:net'
import { ApiRateLimiter } from '../apps/server/src/api/rate-limit'
import {
	InProcessPubSub,
	type PubSubEvent,
	ResilientPubSub,
	ValkeyPubSub
} from '../apps/server/src/realtime/pubsub'

function encodeArray(items: string[]): string {
	return `*${items.length}\r\n${items.map((i) => `$${Buffer.byteLength(i)}\r\n${i}\r\n`).join('')}`
}

function startMockValkey(port = 0) {
	const subscribers = new Set<net.Socket>()
	const activeSockets = new Set<net.Socket>()
	const server = net.createServer((socket) => {
		activeSockets.add(socket)
		let buf = ''
		socket.on('data', (chunk) => {
			buf += chunk.toString('utf8')
			while (buf.includes('\r\n')) {
				if (!buf.startsWith('*')) {
					buf = ''
					break
				}
				const lines = buf.split('\r\n')
				const count = Number.parseInt(lines[0]?.slice(1) ?? '0', 10)
				if (Number.isNaN(count) || lines.length < 1 + count * 2) break
				const args: string[] = []
				let idx = 1
				for (let i = 0; i < count; i++) {
					idx += 1 // $<len>
					args.push(lines[idx] ?? '')
					idx += 1
				}
				buf = lines.slice(idx).join('\r\n')
				const cmd = (args[0] ?? '').toUpperCase()
				if (cmd === 'PING') {
					socket.write('+PONG\r\n')
				} else if (cmd === 'AUTH' || cmd === 'SELECT') {
					socket.write('+OK\r\n')
				} else if (cmd === 'SUBSCRIBE') {
					const chan = args[1] ?? ''
					subscribers.add(socket)
					socket.write(`*3\r\n$9\r\nsubscribe\r\n$${Buffer.byteLength(chan)}\r\n${chan}\r\n:1\r\n`)
				} else if (cmd === 'PUBLISH') {
					const chan = args[1] ?? ''
					const payload = args[2] ?? ''
					socket.write(`:${subscribers.size}\r\n`)
					const msg = encodeArray(['message', chan, payload])
					for (const sub of subscribers) {
						if (!sub.destroyed) sub.write(msg)
					}
				} else {
					socket.write('+OK\r\n')
				}
			}
		})
		socket.on('close', () => {
			subscribers.delete(socket)
			activeSockets.delete(socket)
		})
	})

	return {
		server,
		start: () =>
			new Promise<number>((resolve, reject) => {
				server.once('error', reject)
				server.listen(port, '127.0.0.1', () => {
					const addr = server.address()
					if (!addr || typeof addr === 'string') {
						reject(new Error('Failed to bind mock Valkey port'))
						return
					}
					resolve(addr.port)
				})
			}),
		killAll: () =>
			new Promise<void>((resolve) => {
				for (const s of activeSockets) s.destroy()
				subscribers.clear()
				activeSockets.clear()
				server.close(() => resolve())
			})
	}
}

const mock1 = startMockValkey(0)
const port = await mock1.start()

const primary = new ValkeyPubSub(`redis://127.0.0.1:${port}`)
const fallback = new InProcessPubSub()
const bus = new ResilientPubSub(primary, fallback)

const received: PubSubEvent[] = []
bus.subscribe((ev) => received.push(ev))

await primary.connect(2000)
if (!bus.isReady() || !primary.isReady()) {
	throw new Error('Expected Valkey primary pubsub to be ready')
}

await bus.publishCursor('ws-chaos-1', 101)
await new Promise((r) => setTimeout(r, 80))
if (!received.some((e) => e.type === 'cursor' && e.cursor === 101)) {
	throw new Error('Expected cursor event via Valkey primary')
}
console.log('  ok: Valkey primary delivered cursor=101')

// Kill Valkey abruptly and verify instant failover to InProcessPubSub
await mock1.killAll()
await new Promise((r) => setTimeout(r, 60))

await bus.publishCursor('ws-chaos-1', 202)
await new Promise((r) => setTimeout(r, 40))
if (!received.some((e) => e.type === 'cursor' && e.cursor === 202)) {
	throw new Error('Expected cursor event via InProcessPubSub fallback after Valkey outage')
}
console.log('  ok: failover delivered cursor=202 while Valkey was down')

// Bring Valkey back briefly and verify clean shutdown
const mock2 = startMockValkey(port)
await mock2.start()
await bus.close()
await mock2.killAll()

const limiter = new ApiRateLimiter({ limitPerMinute: 2, windowMs: 60_000 })
if (!limiter.check('ip:1').allowed || !limiter.check('ip:1').allowed || limiter.check('ip:1').allowed) {
	throw new Error('Expected ApiRateLimiter to block 3rd request over limit=2')
}
console.log('  ok: ApiRateLimiter blocked excess burst cleanly')
console.log('chaos smoke: passed')
