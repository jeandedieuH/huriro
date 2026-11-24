/**
 * M6 Resilience, Probes, & Migration Safety integration tests:
 *   - /healthz (200) and /readyz (200 on PG18; 503 on failing DB stub without leaking secrets)
 *   - ResilientPubSub failover on abrupt RESP2 mock Valkey TCP drop
 *   - Migration checksum tampering detection
 */
import { describe, expect, it } from 'bun:test'
import net from 'node:net'
import { migrate, migrationsDir } from '@huriro/db'
import { getTestDb } from '@huriro/test-utils'
import { createApp } from '../api/app'
import { InProcessPubSub, type PubSubEvent, ResilientPubSub, ValkeyPubSub } from '../realtime/pubsub'
import { createTestAuth } from './test-harness'

describe('M6 Probes, Chaos Failover, & Migration Integrity', () => {
	it('serves /healthz and /readyz accurately and redacts DB failures', async () => {
		const db = await getTestDb()
		if (!db) return
		const healthyApp = createApp({
			sql: db.app,
			migrationsDir,
			mode: 'selfhost',
			auth: createTestAuth()
		})
		const hz = await healthyApp.handle(new Request('http://localhost/healthz'))
		expect(hz.status).toBe(200)
		expect(await hz.json()).toEqual({ status: 'ok' })

		const rz = await healthyApp.handle(new Request('http://localhost/readyz'))
		expect(rz.status).toBe(200)
		const rzBody = (await rz.json()) as {
			ready: boolean
			checks: { database: boolean; migrationsPending: number }
		}
		expect(rzBody.ready).toBe(true)
		expect(rzBody.checks.database).toBe(true)
		expect(rzBody.checks.migrationsPending).toBe(0)

		// Failing DB stub containing simulated secret in error text
		const brokenSql = (() =>
			Promise.reject(
				new Error('connect ECONNREFUSED postgres://huriro:SuperSecretDbPass99@10.0.0.5:5432/huriro')
			)) as unknown as typeof db.app
		const brokenApp = createApp({
			sql: brokenSql,
			migrationsDir,
			mode: 'selfhost',
			auth: createTestAuth()
		})
		const badRz = await brokenApp.handle(new Request('http://localhost/readyz'))
		expect(badRz.status).toBe(503)
		const text = await badRz.text()
		expect(text).not.toContain('SuperSecretDbPass99')
		expect(text).not.toContain('10.0.0.5')
	})

	it('fails over ResilientPubSub from dropped RESP2 Valkey TCP socket to InProcessPubSub', async () => {
		const activeSockets = new Set<net.Socket>()
		const server = net.createServer((socket) => {
			activeSockets.add(socket)
			let buf = ''
			socket.on('data', (chunk) => {
				buf += chunk.toString('utf8')
				const lines = buf.split('\r\n')
				if (lines.includes('PING')) {
					socket.write('+PONG\r\n')
					buf = ''
				} else if (lines.includes('SUBSCRIBE')) {
					const chanIdx = lines.indexOf('SUBSCRIBE')
					const chan = lines[chanIdx + 2] ?? 'huriro_signals'
					socket.write(`*3\r\n$9\r\nsubscribe\r\n$${Buffer.byteLength(chan)}\r\n${chan}\r\n:1\r\n`)
					buf = ''
				} else if (lines.includes('PUBLISH')) {
					socket.write(':1\r\n')
					buf = ''
				}
			})
			socket.on('close', () => activeSockets.delete(socket))
		})

		await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', () => resolve()))
		const addr = server.address() as net.AddressInfo

		const primary = new ValkeyPubSub(`redis://127.0.0.1:${addr.port}`)
		const fallback = new InProcessPubSub()
		const bus = new ResilientPubSub(primary, fallback)
		const events: PubSubEvent[] = []
		bus.subscribe((ev) => events.push(ev))

		await primary.connect(2000)
		expect(primary.isReady()).toBe(true)

		// Drop Valkey mid-flight
		for (const s of activeSockets) s.destroy()
		await new Promise<void>((resolve) => server.close(() => resolve()))
		await new Promise((r) => setTimeout(r, 40))

		await bus.publishCursor('0190a0b1-0000-7000-8000-000000000099', 555)
		expect(events.some((e) => e.type === 'cursor' && e.cursor === 555)).toBe(true)

		await bus.close()
	})

	it('rejects migration checksum tampering cleanly', async () => {
		const fakeSql = ((strings: TemplateStringsArray) => {
			const query = strings.join(' ')
			if (query.includes('FROM schema_migrations')) {
				return Promise.resolve([{ version: 1, name: '0001_init.sql', checksum: '0'.repeat(64) }])
			}
			return Promise.resolve([])
		}) as unknown as Parameters<typeof migrate>[0]

		await expect(migrate(fakeSql, migrationsDir)).rejects.toThrow(/modified after being applied/i)
	})
})
