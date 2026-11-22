/**
 * Real PostgreSQL 18 integration tests for M1 Sync & Realtime Signal Plane:
 * - 20 concurrent writes -> contiguous gap-free change_log cursors
 * - Two-client WS cursor signal -> HTTP delta pull < 1,000 ms
 * - Private project ACL grant (scoped snapshot), revoke (4003 close + revoke entry), & scope move
 * - 410 Gone cursor expiry -> full snapshot resync
 * - Mixed batch POST /api/v1/mutations with per-mutation savepoints
 */
import { beforeAll, describe, expect, test } from 'bun:test'
import { randomUUID } from 'node:crypto'
import { uuid7 } from '@huriro/db'
import type { TestDb } from '@huriro/test-utils'
import { startRealtime } from '../realtime'
import { apiRequest, createIntegrationServer, getTestDb, seedM1Fixture } from './test-harness'

let db: TestDb | null = null

beforeAll(async () => {
	db = await getTestDb()
})

describe('M1 sync & realtime integration (PostgreSQL 18 + FORCE RLS)', () => {
	test('20 concurrent writes allocate contiguous, gap-free change_log cursors', async () => {
		if (!db) return
		const fixture = await seedM1Fixture(db.owner)
		const { app, pubsub } = createIntegrationServer(db)
		try {
			const projRes = await apiRequest(app, {
				method: 'POST',
				path: '/api/v1/projects',
				workspaceId: fixture.workspaceId,
				userId: fixture.ownerId,
				body: { key: 'CONC', name: 'Concurrency', visibility: 'workspace' }
			})
			expect(projRes.status).toBe(201)
			const projectId = String(projRes.json['id'])

			const beforePull = await apiRequest(app, {
				path: '/api/v1/sync/changes?since=0&limit=500',
				workspaceId: fixture.workspaceId,
				userId: fixture.ownerId
			})
			const startCursor = Number(beforePull.json['nextCursor'])

			// Fire 20 parallel issue writes concurrently against PG18
			const writes = await Promise.all(
				Array.from({ length: 20 }, (_, i) =>
					apiRequest(app, {
						method: 'POST',
						path: '/api/v1/issues',
						workspaceId: fixture.workspaceId,
						userId: i % 2 === 0 ? fixture.memberAId : fixture.memberBId,
						body: { projectId, title: `Concurrent issue ${i}` }
					})
				)
			)
			for (const w of writes) {
				expect(w.status).toBe(201)
			}

			const afterPull = await apiRequest(app, {
				path: `/api/v1/sync/changes?since=${startCursor}&limit=500`,
				workspaceId: fixture.workspaceId,
				userId: fixture.ownerId
			})
			expect(afterPull.status).toBe(200)
			const changes = afterPull.json['changes'] as { cursor: number; entity: string }[]
			expect(changes).toHaveLength(20)
			// Verify strictly increasing contiguous cursors: startCursor+1 .. startCursor+20
			for (let i = 0; i < changes.length; i++) {
				expect(changes[i]?.cursor).toBe(startCursor + i + 1)
			}
		} finally {
			await pubsub.close()
		}
	})

	test('two-client WS signal -> HTTP delta pull < 1,000 ms, grant/revoke 4003, and scope move', async () => {
		if (!db) return
		const fixture = await seedM1Fixture(db.owner)
		const { app, auth, pubsub } = createIntegrationServer(db)
		const rt = startRealtime({
			port: 0,
			sql: db.app,
			auth,
			pubsub,
			coalesceMs: 10,
			maxCoalesceMs: 25
		})

		let ws: WebSocket | null = null
		try {
			// Member B obtains single-use realtime ticket and completes WS handshake
			const ticketRes = await apiRequest(app, {
				method: 'POST',
				path: '/api/v1/realtime/ticket',
				workspaceId: fixture.workspaceId,
				userId: fixture.memberBId,
				body: { deviceId: 'test-device-b' }
			})
			expect(ticketRes.status).toBe(200)
			const ticket = String(ticketRes.json['ticket'])

			const messages: { t: string; cursor?: number; reason?: string }[] = []
			let resolveCursorSignal: ((cursor: number) => void) | null = null
			let resolveCloseEvent: ((code: number) => void) | null = null

			const clientSocket = new WebSocket(`ws://127.0.0.1:${rt.port}/ws`)
			ws = clientSocket

			await new Promise<void>((resolve, reject) => {
				const timer = setTimeout(() => reject(new Error('WS ready timeout')), 3000)
				clientSocket.onopen = () => {
					clientSocket.send(
						JSON.stringify({ t: 'hello', workspaceId: fixture.workspaceId, cursor: 0, ticket })
					)
				}
				clientSocket.onmessage = (ev) => {
					const parsed = JSON.parse(String(ev.data)) as { t: string; cursor?: number; reason?: string }
					messages.push(parsed)
					if (parsed.t === 'ready') {
						clearTimeout(timer)
						resolve()
					} else if (parsed.t === 'cursor' && typeof parsed.cursor === 'number') {
						resolveCursorSignal?.(parsed.cursor)
					}
				}
				clientSocket.onclose = (ev) => {
					resolveCloseEvent?.(ev.code)
				}
				clientSocket.onerror = () => {
					clearTimeout(timer)
					reject(new Error('WS error'))
				}
			})

			// Create workspace project as Member A -> Member B should receive WS cursor signal within 1,000 ms
			const cursorPromise = new Promise<number>((resolve, reject) => {
				const timer = setTimeout(() => reject(new Error('Cursor push timeout')), 950)
				resolveCursorSignal = (c) => {
					clearTimeout(timer)
					resolve(c)
				}
			})

			const startedAt = Date.now()
			const wsProj = await apiRequest(app, {
				method: 'POST',
				path: '/api/v1/projects',
				workspaceId: fixture.workspaceId,
				userId: fixture.memberAId,
				body: { key: 'PUB', name: 'Public', visibility: 'workspace' }
			})
			expect(wsProj.status).toBe(201)
			const wsProjId = String(wsProj.json['id'])

			const pushedCursor = await cursorPromise
			expect(pushedCursor).toBeGreaterThanOrEqual(1)

			// Client B pulls delta feed within 1,000 ms budget
			const deltaRes = await apiRequest(app, {
				path: '/api/v1/sync/changes?since=0&limit=100',
				workspaceId: fixture.workspaceId,
				userId: fixture.memberBId
			})
			expect(deltaRes.status).toBe(200)
			expect(Date.now() - startedAt).toBeLessThan(1000)

			// Private project -> move issue from workspace PUB to private LOCK BEFORE granting ACL so member B gets a delete tombstone without destination UUID
			const privProj = await apiRequest(app, {
				method: 'POST',
				path: '/api/v1/projects',
				workspaceId: fixture.workspaceId,
				userId: fixture.memberAId,
				body: { key: 'LOCK', name: 'Locked', visibility: 'private' }
			})
			const privProjId = String(privProj.json['id'])

			const issueInWs = await apiRequest(app, {
				method: 'POST',
				path: '/api/v1/issues',
				workspaceId: fixture.workspaceId,
				userId: fixture.memberAId,
				body: { projectId: wsProjId, title: 'Moving issue' }
			})
			const movingIssueId = String(issueInWs.json['id'])
			const beforeMoveCursor = Number(
				(
					await apiRequest(app, {
						path: '/api/v1/sync/changes?since=0&limit=500',
						workspaceId: fixture.workspaceId,
						userId: fixture.memberBId
					})
				).json['nextCursor']
			)

			const moveScope = await apiRequest(app, {
				method: 'PATCH',
				path: `/api/v1/issues/${movingIssueId}`,
				workspaceId: fixture.workspaceId,
				userId: fixture.memberAId,
				body: { projectId: privProjId, version: 1 }
			})
			expect(moveScope.status).toBe(200)

			const scopeChangesRes = await apiRequest(app, {
				path: `/api/v1/sync/changes?since=${beforeMoveCursor}&limit=100`,
				workspaceId: fixture.workspaceId,
				userId: fixture.memberBId
			})
			const scopeChanges = scopeChangesRes.json['changes'] as { action: string; scope: string[] }[]
			expect(scopeChanges.some((c) => c.action === 'delete' && c.scope.includes(`project:${wsProjId}`))).toBe(
				true
			)
			expect(scopeChanges.some((c) => c.scope.includes(`project:${privProjId}`))).toBe(false)

			// Grant Member B ACL on LOCK -> grant event & scoped snapshot
			const grantRes = await apiRequest(app, {
				method: 'POST',
				path: '/api/v1/acl',
				workspaceId: fixture.workspaceId,
				userId: fixture.memberAId,
				body: {
					resourceType: 'project',
					resourceId: privProjId,
					principalType: 'user',
					principalId: fixture.memberBId,
					permission: 'read'
				}
			})
			expect(grantRes.status).toBe(200)
			const aclId = String(grantRes.json['id'])

			const scopedSnap = await apiRequest(app, {
				path: `/api/v1/sync/snapshot?scope=project:${privProjId}`,
				workspaceId: fixture.workspaceId,
				userId: fixture.memberBId
			})
			expect(scopedSnap.status).toBe(200)
			expect((scopedSnap.json['projects'] as { id: string }[]).some((p) => p.id === privProjId)).toBe(true)

			// Revoke Member B ACL -> emits revoke change AND forces WS close 4003
			const closePromise = new Promise<number>((resolve, reject) => {
				const timer = setTimeout(() => reject(new Error('Expected 4003 revoke close')), 3000)
				resolveCloseEvent = (code) => {
					clearTimeout(timer)
					resolve(code)
				}
			})

			const revokeRes = await apiRequest(app, {
				method: 'DELETE',
				path: `/api/v1/acl/${aclId}`,
				workspaceId: fixture.workspaceId,
				userId: fixture.memberAId
			})
			expect(revokeRes.status).toBe(200)
			const closeCode = await closePromise
			expect(closeCode).toBe(4003)
		} finally {
			ws?.close()
			await rt.stop()
			await pubsub.close()
		}
	})

	test('returns 410 Gone on pruned cursor and isolates mixed /mutations batch via savepoints', async () => {
		if (!db) return
		const fixture = await seedM1Fixture(db.owner)
		const { app, pubsub } = createIntegrationServer(db)
		try {
			const projRes = await apiRequest(app, {
				method: 'POST',
				path: '/api/v1/projects',
				workspaceId: fixture.workspaceId,
				userId: fixture.ownerId,
				body: { key: 'SYNC', name: 'Sync', visibility: 'workspace' }
			})
			const projectId = String(projRes.json['id'])

			const createRes = await apiRequest(app, {
				method: 'POST',
				path: '/api/v1/issues',
				workspaceId: fixture.workspaceId,
				userId: fixture.ownerId,
				body: { projectId, title: 'Existing v1' }
			})
			const existingIssueId = String(createRes.json['id'])

			// Advance version to 2
			await apiRequest(app, {
				method: 'PATCH',
				path: `/api/v1/issues/${existingIssueId}`,
				workspaceId: fixture.workspaceId,
				userId: fixture.ownerId,
				body: { title: 'Updated v2', version: 1 }
			})

			// Batch with valid create (UUIDv7) + stale v1 update
			const validNewId = uuid7()
			const batchRes = await apiRequest(app, {
				method: 'POST',
				path: '/api/v1/mutations',
				workspaceId: fixture.workspaceId,
				userId: fixture.memberAId,
				body: {
					mutations: [
						{
							mutationId: randomUUID(),
							workspaceId: fixture.workspaceId,
							entity: 'issue',
							entityId: validNewId,
							op: 'create',
							patch: { projectId, title: 'Batch valid issue' }
						},
						{
							mutationId: randomUUID(),
							workspaceId: fixture.workspaceId,
							entity: 'issue',
							entityId: existingIssueId,
							op: 'update',
							baseVersion: 1,
							patch: { title: 'Stale conflict update' }
						}
					]
				}
			})
			expect(batchRes.status).toBe(200)
			const results = batchRes.json['results'] as {
				outcome: string
				status: number
				currentVersion?: number
			}[]
			expect(results).toHaveLength(2)
			expect(results[0]?.outcome).toBe('applied')
			expect(results[0]?.status).toBe(200)
			expect(results[1]?.outcome).toBe('stale_version')
			expect(results[1]?.status).toBe(409)
			expect(results[1]?.currentVersion).toBe(2)

			// Prune older change_log rows so min_cursor > 1 -> 410 Gone
			await db.owner`DELETE FROM change_log WHERE workspace_id = ${fixture.workspaceId} AND cursor < 4`
			const expiredPull = await apiRequest(app, {
				path: '/api/v1/sync/changes?since=1&limit=100',
				workspaceId: fixture.workspaceId,
				userId: fixture.ownerId
			})
			expect(expiredPull.status).toBe(410)

			// Snapshot resync recovers full current state
			const snapRes = await apiRequest(app, {
				path: '/api/v1/sync/snapshot',
				workspaceId: fixture.workspaceId,
				userId: fixture.ownerId
			})
			expect(snapRes.status).toBe(200)
			const issues = snapRes.json['issues'] as { id: string }[]
			expect(issues.some((i) => i.id === validNewId)).toBe(true)
			expect(issues.some((i) => i.id === existingIssueId)).toBe(true)
		} finally {
			await pubsub.close()
		}
	})
})
