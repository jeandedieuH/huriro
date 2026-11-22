/**
 * Real PostgreSQL 18 + Hocuspocus `/collab` WebSocket integration tests (Gate G2):
 *   - Ticket security: `?ticket=`/`?token=` rejected (HTTP 400), single-use ticket replay rejected
 *   - `readOnly` ACL enforcement + mid-session `4003` close on visibility tighten / revoke
 *   - 10 concurrent `@hocuspocus/provider` editors converge with zero divergence
 *   - 2-node room lease fencing (`doc_room_leases` monotonic epochs)
 *   - Real child-process `SIGKILL` (`kill -9`) loses zero edits still held by a connected client
 *   - Graceful `stop()` flushes dirty docs and releases leases
 *   - Non-destructive forward CRDT version restore creates `pre_restore` and updates connected clients
 *   - Relative-position anchored comments survive concurrent insertions & detect orphaned spans
 *   - 10 MB document size hard limit
 */
import { beforeAll, describe, expect, setDefaultTimeout, test } from 'bun:test'
import { resolve } from 'node:path'
import { HocuspocusProvider, HocuspocusProviderWebsocket } from '@hocuspocus/provider'
import { withWorkspace } from '@huriro/db'
import {
	DOCUMENT_SIZE_MAX_BYTES,
	encodeTextAnchor,
	extractDocumentContent,
	resolveTextAnchor
} from '@huriro/editor'
import type { TestDb } from '@huriro/test-utils'
import * as Y from 'yjs'
import { acquireCollabRoomAndState, persistCollabDocumentState } from '../modules/docs'
import { createCollabRuntime, startRealtime } from '../realtime'
import { InProcessPubSub } from '../realtime/pubsub'
import { apiRequest, createIntegrationServer, getTestDb, seedM1Fixture } from './test-harness'

setDefaultTimeout(20_000)

let db: TestDb | null = null

beforeAll(async () => {
	db = await getTestDb()
})

interface ConnectedEditor {
	readonly ydoc: Y.Doc
	readonly wsProvider: HocuspocusProviderWebsocket
	readonly provider: HocuspocusProvider
	readonly events: { readonly closeCodes: number[]; readonly authFailed: boolean[] }
	readonly disconnect: () => void
}

async function waitForCondition(check: () => Promise<boolean> | boolean, timeoutMs = 6000): Promise<void> {
	const deadline = Date.now() + timeoutMs
	while (Date.now() < deadline) {
		if (await check()) return
		await new Promise((r) => setTimeout(r, 40))
	}
	throw new Error(`Condition not met within ${timeoutMs}ms`)
}

function appendParagraphToYDoc(ydoc: Y.Doc, text: string, origin = 'test:edit'): void {
	const fragment = ydoc.getXmlFragment('default')
	ydoc.transact(() => {
		const para = new Y.XmlElement('paragraph')
		para.setAttribute('blockId', `blk_${Math.random().toString(36).slice(2, 10)}`)
		para.insert(0, [new Y.XmlText(text)])
		fragment.push([para])
	}, origin)
}

async function issueTicketForUser(
	app: ReturnType<typeof createIntegrationServer>['app'],
	workspaceId: string,
	userId: string,
	pageId: string
): Promise<{ readonly ticket: string; readonly documentName: string; readonly permission: string }> {
	const res = await apiRequest(app, {
		method: 'POST',
		path: `/api/v1/docs/${pageId}/collab-ticket`,
		workspaceId,
		userId
	})
	expect(res.status).toBe(200)
	return {
		ticket: String(res.json['ticket']),
		documentName: String(res.json['documentName']),
		permission: String(res.json['permission'])
	}
}

async function connectCollabEditor(opts: {
	readonly port: number
	readonly documentName: string
	readonly ticket: string
	readonly existingDoc?: Y.Doc
	readonly maxAttempts?: number
}): Promise<ConnectedEditor> {
	const ydoc = opts.existingDoc ?? new Y.Doc()
	const events = { closeCodes: [] as number[], authFailed: [] as boolean[] }
	const wsProvider = new HocuspocusProviderWebsocket({
		url: `ws://127.0.0.1:${opts.port}/collab`,
		WebSocketPolyfill: WebSocket,
		maxAttempts: opts.maxAttempts ?? 1,
		delay: 100,
		minDelay: 100,
		onClose({ event }) {
			events.closeCodes.push(event.code)
		}
	})

	let resolveSynced: (() => void) | null = null
	let rejectSynced: ((err: Error) => void) | null = null
	const syncedPromise = new Promise<void>((res, rej) => {
		resolveSynced = res
		rejectSynced = rej
	})

	const timer = setTimeout(() => {
		rejectSynced?.(new Error('Collab provider initial sync timed out'))
	}, 6000)

	const provider = new HocuspocusProvider({
		websocketProvider: wsProvider,
		name: opts.documentName,
		document: ydoc,
		token: opts.ticket,
		onSynced() {
			clearTimeout(timer)
			resolveSynced?.()
		},
		onAuthenticationFailed() {
			events.authFailed.push(true)
			clearTimeout(timer)
			rejectSynced?.(new Error('Collab authentication failed'))
		}
	})
	provider.attach()

	try {
		await syncedPromise
	} catch (err) {
		provider.destroy()
		wsProvider.destroy()
		throw err
	}
	return {
		ydoc,
		wsProvider,
		provider,
		events,
		disconnect() {
			provider.destroy()
			wsProvider.destroy()
		}
	}
}

async function spawnCrashWorker(args: {
	readonly appUrl: string
	readonly ticketSecret: string
	readonly nodeId: string
	readonly leaseTtlMs: number
	readonly debounceMs: number
}) {
	const workerPath = resolve(import.meta.dir, 'collab-crash-worker.ts')
	const proc = Bun.spawn(['bun', workerPath], {
		env: {
			...process.env,
			HURIRO_TEST_APP_DB_URL: args.appUrl,
			HURIRO_TEST_TICKET_SECRET: args.ticketSecret,
			HURIRO_TEST_NODE_ID: args.nodeId,
			HURIRO_TEST_LEASE_TTL_MS: String(args.leaseTtlMs),
			HURIRO_TEST_DEBOUNCE_MS: String(args.debounceMs),
			HURIRO_TEST_MAX_DEBOUNCE_MS: String(args.debounceMs)
		},
		stdout: 'pipe',
		stderr: 'pipe'
	})

	const reader = proc.stdout.getReader()
	const decoder = new TextDecoder()
	let buffer = ''
	const deadline = Date.now() + 10_000
	while (Date.now() < deadline) {
		const { value, done } = await reader.read()
		if (done) break
		buffer += decoder.decode(value, { stream: true })
		const lines = buffer.split(/\r?\n/)
		buffer = lines.pop() ?? ''
		for (const line of lines) {
			const trimmed = line.trim()
			if (!trimmed.startsWith('{')) continue
			try {
				const parsed = JSON.parse(trimmed) as {
					HuriroCrashWorkerReady?: boolean
					port?: number
					nodeId?: string
				}
				if (parsed.HuriroCrashWorkerReady && typeof parsed.port === 'number') {
					void reader.cancel().catch(() => {})
					return { proc, port: parsed.port, nodeId: parsed.nodeId ?? args.nodeId }
				}
			} catch {
				// Ignore non-JSON stdout line
			}
		}
	}
	proc.kill('SIGKILL')
	throw new Error('Crash worker failed to signal ready in time')
}

describe('M2 collaborative editing & Gate G2 integration (PostgreSQL 18 + Hocuspocus)', () => {
	test('rejects query-string tickets, prevents single-use ticket replay, enforces readOnly, and closes 4003 on revocation', async () => {
		if (!db) return
		const fixture = await seedM1Fixture(db.owner)
		const secret = 'g2-ticket-security-secret'
		// One shared bus so PATCH revoke signals reach the collab runtime (prod wiring).
		const pubsub = new InProcessPubSub()
		const collab = createCollabRuntime({
			sql: db.app,
			pubsub,
			ticketSecret: secret,
			debounceMs: 120,
			maxDebounceMs: 250
		})
		const { app, auth } = createIntegrationServer(db, {
			collabBridge: collab.bridge,
			collabTicketSecret: secret,
			pubsub
		})
		const rt = startRealtime({ port: 0, sql: db.app, auth, pubsub, collab })

		const clients: ConnectedEditor[] = []
		try {
			const pageRes = await apiRequest(app, {
				method: 'POST',
				path: '/api/v1/docs',
				workspaceId: fixture.workspaceId,
				userId: fixture.memberAId,
				body: { title: 'Private ACL Spec', visibility: 'private', markdown: 'Initial confidential line.' }
			})
			expect(pageRes.status).toBe(201)
			const pageId = String(pageRes.json['id'])

			// Reject query-string tickets and tokens on /collab
			const qTicketRes = await fetch(`http://127.0.0.1:${rt.port}/collab?ticket=bad`)
			expect(qTicketRes.status).toBe(400)
			const qTokenRes = await fetch(`http://127.0.0.1:${rt.port}/collab?token=bad`)
			expect(qTokenRes.status).toBe(400)

			// Grant read-only ACL to MemberB
			await apiRequest(app, {
				method: 'POST',
				path: '/api/v1/acl',
				workspaceId: fixture.workspaceId,
				userId: fixture.memberAId,
				body: {
					resourceType: 'doc_page',
					resourceId: pageId,
					principalType: 'user',
					principalId: fixture.memberBId,
					permission: 'read'
				}
			})

			const ticketA = await issueTicketForUser(app, fixture.workspaceId, fixture.memberAId, pageId)
			expect(ticketA.permission).toBe('write')
			const clientA = await connectCollabEditor({
				port: rt.port,
				documentName: ticketA.documentName,
				ticket: ticketA.ticket
			})
			clients.push(clientA)

			// Replaying ticketA fails authentication
			await expect(
				connectCollabEditor({ port: rt.port, documentName: ticketA.documentName, ticket: ticketA.ticket })
			).rejects.toThrow()

			// Read-only MemberB receives initial doc but edits are ignored server-side
			const ticketB = await issueTicketForUser(app, fixture.workspaceId, fixture.memberBId, pageId)
			expect(ticketB.permission).toBe('read')
			const clientB = await connectCollabEditor({
				port: rt.port,
				documentName: ticketB.documentName,
				ticket: ticketB.ticket
			})
			clients.push(clientB)
			expect(extractDocumentContent(clientB.ydoc).plainText).toContain('Initial confidential line.')

			appendParagraphToYDoc(clientB.ydoc, 'ILLEGAL_READONLY_MUTATION')
			await new Promise((r) => setTimeout(r, 350))
			const checkDetail = await apiRequest(app, {
				path: `/api/v1/docs/${pageId}`,
				workspaceId: fixture.workspaceId,
				userId: fixture.memberAId
			})
			expect(String(checkDetail.json['plainText'])).not.toContain('ILLEGAL_READONLY_MUTATION')

			// Mid-session revocation on a workspace page -> client closes 4003
			const wsPage = await apiRequest(app, {
				method: 'POST',
				path: '/api/v1/docs',
				workspaceId: fixture.workspaceId,
				userId: fixture.memberAId,
				body: { title: 'Soon Private', visibility: 'workspace', markdown: 'Shared for a moment.' }
			})
			const wsPageId = String(wsPage.json['id'])
			const ticketB2 = await issueTicketForUser(app, fixture.workspaceId, fixture.memberBId, wsPageId)
			const liveClientB = await connectCollabEditor({
				port: rt.port,
				documentName: ticketB2.documentName,
				ticket: ticketB2.ticket,
				maxAttempts: 1
			})
			clients.push(liveClientB)

			// Visibility changes require doc.share, which members lack — the owner tightens.
			const tightenRes = await apiRequest(app, {
				method: 'PATCH',
				path: `/api/v1/docs/${wsPageId}`,
				workspaceId: fixture.workspaceId,
				userId: fixture.ownerId,
				body: { visibility: 'private', version: 1 }
			})
			expect(tightenRes.status).toBe(200)

			await waitForCondition(() => liveClientB.events.closeCodes.includes(4003), 3000)
			expect(liveClientB.events.closeCodes).toContain(4003)
		} finally {
			for (const c of clients) c.disconnect()
			await rt.stop()
			await pubsub.close()
		}
	})

	test('10 concurrent editors converge with zero divergence across all peers and PostgreSQL doc_state', async () => {
		if (!db) return
		const fixture = await seedM1Fixture(db.owner)
		const secret = 'g2-convergence-secret'
		const collab = createCollabRuntime({
			sql: db.app,
			ticketSecret: secret,
			debounceMs: 150,
			maxDebounceMs: 300
		})
		const { app, auth, pubsub } = createIntegrationServer(db, {
			collabBridge: collab.bridge,
			collabTicketSecret: secret
		})
		const rt = startRealtime({ port: 0, sql: db.app, auth, pubsub, collab })

		const clients: ConnectedEditor[] = []
		try {
			const pageRes = await apiRequest(app, {
				method: 'POST',
				path: '/api/v1/docs',
				workspaceId: fixture.workspaceId,
				userId: fixture.ownerId,
				body: { title: '10-Editor Convergence', visibility: 'workspace', markdown: '# Baseline' }
			})
			expect(pageRes.status).toBe(201)
			const pageId = String(pageRes.json['id'])

			const users = [
				fixture.ownerId,
				fixture.adminId,
				fixture.memberAId,
				fixture.memberBId,
				fixture.ownerId,
				fixture.adminId,
				fixture.memberAId,
				fixture.memberBId,
				fixture.memberAId,
				fixture.memberBId
			]

			for (const uid of users) {
				const t = await issueTicketForUser(app, fixture.workspaceId, uid, pageId)
				const c = await connectCollabEditor({ port: rt.port, documentName: t.documentName, ticket: t.ticket })
				clients.push(c)
			}

			// Fire concurrent edits from all 10 peers simultaneously
			const expectedMarkers: string[] = []
			await Promise.all(
				clients.map(async (c, idx) => {
					const m1 = `CONCURRENT_PEER_${idx}_FIRST`
					const m2 = `CONCURRENT_PEER_${idx}_SECOND`
					expectedMarkers.push(m1, m2)
					appendParagraphToYDoc(c.ydoc, m1)
					await new Promise((r) => setTimeout(r, 15))
					appendParagraphToYDoc(c.ydoc, m2)
				})
			)

			// Wait until all 10 peers converge to identical text containing all 20 markers
			await waitForCondition(() => {
				const texts = clients.map((c) => extractDocumentContent(c.ydoc).plainText)
				const baseline = texts[0] ?? ''
				if (!expectedMarkers.every((m) => baseline.includes(m))) return false
				return texts.every((t) => t === baseline)
			}, 8000)

			// Wait for debounce flush to PostgreSQL and verify DB matches clients
			await waitForCondition(async () => {
				const detail = await apiRequest(app, {
					path: `/api/v1/docs/${pageId}`,
					workspaceId: fixture.workspaceId,
					userId: fixture.ownerId
				})
				const dbText = String(detail.json['plainText'] ?? '')
				return expectedMarkers.every((m) => dbText.includes(m))
			}, 5000)

			const finalDetail = await apiRequest(app, {
				path: `/api/v1/docs/${pageId}`,
				workspaceId: fixture.workspaceId,
				userId: fixture.ownerId
			})
			expect(finalDetail.json['plainText']).toBe(
				extractDocumentContent(clients[0]?.ydoc ?? new Y.Doc()).plainText
			)
		} finally {
			for (const c of clients) c.disconnect()
			await rt.stop()
			await pubsub.close()
		}
	})

	test('enforces 2-node room lease fencing and graceful stop() flush/release', async () => {
		if (!db) return
		const fixture = await seedM1Fixture(db.owner)
		const secret = 'g2-lease-fencing-secret'
		const collabA = createCollabRuntime({
			sql: db.app,
			ticketSecret: secret,
			nodeId: 'lease-node-a',
			leaseTtlMs: 1200,
			leaseRenewMs: 400,
			debounceMs: 60_000,
			maxDebounceMs: 60_000
		})
		const { app, auth, pubsub } = createIntegrationServer(db, {
			collabBridge: collabA.bridge,
			collabTicketSecret: secret
		})
		const rtA = startRealtime({ port: 0, sql: db.app, auth, pubsub, collab: collabA })

		const clients: ConnectedEditor[] = []
		try {
			const pageRes = await apiRequest(app, {
				method: 'POST',
				path: '/api/v1/docs',
				workspaceId: fixture.workspaceId,
				userId: fixture.ownerId,
				body: { title: 'Lease Fenced Doc', visibility: 'workspace', markdown: '# Lease Test' }
			})
			const pageId = String(pageRes.json['id'])

			const ticket1 = await issueTicketForUser(app, fixture.workspaceId, fixture.memberAId, pageId)
			const clientA = await connectCollabEditor({
				port: rtA.port,
				documentName: ticket1.documentName,
				ticket: ticket1.ticket
			})
			clients.push(clientA)
			const epochA = collabA.getRoomLeaseEpoch(fixture.workspaceId, pageId)
			expect(epochA).toBe(1)

			// While lease is fresh on node-a, node-b cannot acquire the room lease
			const conflictAttempt = await withWorkspace(db.app, { workspaceId: fixture.workspaceId }, (tx) =>
				acquireCollabRoomAndState(tx, {
					workspaceId: fixture.workspaceId,
					pageId,
					nodeId: 'lease-node-b',
					ttlMs: 1200
				})
			)
			expect(conflictAttempt.acquired).toBe(false)
			if (!conflictAttempt.acquired) {
				expect(conflictAttempt.ownerNodeId).toBe('lease-node-a')
			}

			// Simulate crash of node-a without releasing lease, then wait past TTL
			await collabA.simulateCrashWithoutRelease()
			await new Promise((r) => setTimeout(r, 1400))

			// Node-b acquires epoch 2 cleanly
			const handover = await withWorkspace(db.app, { workspaceId: fixture.workspaceId }, (tx) =>
				acquireCollabRoomAndState(tx, {
					workspaceId: fixture.workspaceId,
					pageId,
					nodeId: 'lease-node-b',
					ttlMs: 3000
				})
			)
			expect(handover.acquired).toBe(true)
			if (handover.acquired) {
				expect(handover.epoch).toBe(2)
			}

			// Stale flush from node-a at epoch 1 is fenced in SQL
			const staleDoc = new Y.Doc()
			appendParagraphToYDoc(staleDoc, 'STALE_EPOCH_OVERWRITE')
			const staleFlush = await withWorkspace(
				db.app,
				{ workspaceId: fixture.workspaceId, userId: fixture.ownerId },
				(tx) =>
					persistCollabDocumentState(tx, {
						workspaceId: fixture.workspaceId,
						pageId,
						nodeId: 'lease-node-a',
						leaseEpoch: 1,
						ydoc: staleDoc,
						authorUserIds: [fixture.ownerId],
						actorId: fixture.ownerId
					})
			)
			expect(staleFlush.fenced).toBe(true)

			// Graceful stop() flushes dirty doc and releases lease
			const collabC = createCollabRuntime({
				sql: db.app,
				ticketSecret: secret,
				nodeId: 'graceful-node-c',
				leaseTtlMs: 30_000,
				debounceMs: 60_000,
				maxDebounceMs: 60_000
			})
			const rtC = startRealtime({ port: 0, sql: db.app, auth, pubsub, collab: collabC })
			try {
				const p2Res = await apiRequest(app, {
					method: 'POST',
					path: '/api/v1/docs',
					workspaceId: fixture.workspaceId,
					userId: fixture.ownerId,
					body: { title: 'Graceful Flush Doc', visibility: 'workspace', markdown: '# Start' }
				})
				const p2Id = String(p2Res.json['id'])
				const t2 = await issueTicketForUser(app, fixture.workspaceId, fixture.ownerId, p2Id)
				const c2 = await connectCollabEditor({
					port: rtC.port,
					documentName: t2.documentName,
					ticket: t2.ticket
				})
				clients.push(c2)
				appendParagraphToYDoc(c2.ydoc, 'FLUSHED_ON_GRACEFUL_STOP')
				await new Promise((r) => setTimeout(r, 150))

				await rtC.stop()
				const d2 = await apiRequest(app, {
					path: `/api/v1/docs/${p2Id}`,
					workspaceId: fixture.workspaceId,
					userId: fixture.ownerId
				})
				expect(String(d2.json['plainText'])).toContain('FLUSHED_ON_GRACEFUL_STOP')
			} finally {
				await rtC.stop()
			}
		} finally {
			for (const c of clients) c.disconnect()
			await rtA.stop()
			await pubsub.close()
		}
	})

	test('kill -9 (SIGKILL) of real realtime child process loses zero edits still held by connected client', async () => {
		if (!db) return
		const fixture = await seedM1Fixture(db.owner)
		const secret = 'g2-sigkill-recovery-secret'
		const { app, pubsub } = createIntegrationServer(db, { collabTicketSecret: secret })

		const localYDoc = new Y.Doc()
		let worker1: Awaited<ReturnType<typeof spawnCrashWorker>> | null = null
		let worker2: Awaited<ReturnType<typeof spawnCrashWorker>> | null = null
		let clientA1: ConnectedEditor | null = null
		let clientA2: ConnectedEditor | null = null
		let clientB: ConnectedEditor | null = null

		try {
			const pageRes = await apiRequest(app, {
				method: 'POST',
				path: '/api/v1/docs',
				workspaceId: fixture.workspaceId,
				userId: fixture.memberAId,
				body: { title: 'Crash Recovery Doc', visibility: 'workspace', markdown: '# Durable baseline' }
			})
			expect(pageRes.status).toBe(201)
			const pageId = String(pageRes.json['id'])

			worker1 = await spawnCrashWorker({
				appUrl: db.appUrl,
				ticketSecret: secret,
				nodeId: 'sigkill-worker-1',
				leaseTtlMs: 1400,
				debounceMs: 60_000
			})

			const t1 = await issueTicketForUser(app, fixture.workspaceId, fixture.memberAId, pageId)
			clientA1 = await connectCollabEditor({
				port: worker1.port,
				documentName: t1.documentName,
				ticket: t1.ticket,
				existingDoc: localYDoc
			})

			// Make edit in clientA while worker1 debounce is 60s (unflushed to Postgres)
			appendParagraphToYDoc(localYDoc, 'SURVIVED_SIGKILL_EDIT')
			await new Promise((r) => setTimeout(r, 150))

			// Kill worker1 with real SIGKILL (no shutdown hooks run)
			worker1.proc.kill('SIGKILL')
			await worker1.proc.exited
			worker1 = null
			clientA1.disconnect()
			clientA1 = null

			// Confirm PostgreSQL does NOT yet have the unflushed edit while clientA still holds it locally
			expect(extractDocumentContent(localYDoc).plainText).toContain('SURVIVED_SIGKILL_EDIT')
			const beforeRecovery = await apiRequest(app, {
				path: `/api/v1/docs/${pageId}`,
				workspaceId: fixture.workspaceId,
				userId: fixture.memberAId
			})
			expect(String(beforeRecovery.json['plainText'])).not.toContain('SURVIVED_SIGKILL_EDIT')

			// Wait past lease TTL so worker2 takes ownership cleanly
			await new Promise((r) => setTimeout(r, 1650))

			worker2 = await spawnCrashWorker({
				appUrl: db.appUrl,
				ticketSecret: secret,
				nodeId: 'sigkill-worker-2',
				leaseTtlMs: 5000,
				debounceMs: 120
			})

			// Reconnect clientA retaining the SAME localYDoc onto worker2 with a fresh single-use ticket
			const t2 = await issueTicketForUser(app, fixture.workspaceId, fixture.memberAId, pageId)
			clientA2 = await connectCollabEditor({
				port: worker2.port,
				documentName: t2.documentName,
				ticket: t2.ticket,
				existingDoc: localYDoc
			})

			await waitForCondition(async () => {
				const d = await apiRequest(app, {
					path: `/api/v1/docs/${pageId}`,
					workspaceId: fixture.workspaceId,
					userId: fixture.memberAId
				})
				return String(d.json['plainText'] ?? '').includes('SURVIVED_SIGKILL_EDIT')
			}, 6000)

			// A brand-new peer connecting to worker2 receives the recovered edit
			const tB = await issueTicketForUser(app, fixture.workspaceId, fixture.memberBId, pageId)
			clientB = await connectCollabEditor({
				port: worker2.port,
				documentName: tB.documentName,
				ticket: tB.ticket
			})
			expect(extractDocumentContent(clientB.ydoc).plainText).toContain('SURVIVED_SIGKILL_EDIT')
		} finally {
			clientA1?.disconnect()
			clientA2?.disconnect()
			clientB?.disconnect()
			if (worker1) {
				worker1.proc.kill('SIGKILL')
				await worker1.proc.exited.catch(() => {})
			}
			if (worker2) {
				worker2.proc.kill('SIGKILL')
				await worker2.proc.exited.catch(() => {})
			}
			await pubsub.close()
		}
	})

	test('non-destructive forward CRDT version restore creates pre_restore and updates connected clients', async () => {
		if (!db) return
		const fixture = await seedM1Fixture(db.owner)
		const secret = 'g2-version-restore-secret'
		const collab = createCollabRuntime({
			sql: db.app,
			ticketSecret: secret,
			debounceMs: 120,
			maxDebounceMs: 250
		})
		const { app, auth, pubsub } = createIntegrationServer(db, {
			collabBridge: collab.bridge,
			collabTicketSecret: secret
		})
		const rt = startRealtime({ port: 0, sql: db.app, auth, pubsub, collab })

		const clients: ConnectedEditor[] = []
		try {
			const pageRes = await apiRequest(app, {
				method: 'POST',
				path: '/api/v1/docs',
				workspaceId: fixture.workspaceId,
				userId: fixture.memberAId,
				body: { title: 'Versioned Doc', visibility: 'workspace', markdown: 'Initial text' }
			})
			const pageId = String(pageRes.json['id'])

			const t1 = await issueTicketForUser(app, fixture.workspaceId, fixture.memberAId, pageId)
			const editor = await connectCollabEditor({
				port: rt.port,
				documentName: t1.documentName,
				ticket: t1.ticket
			})
			clients.push(editor)

			appendParagraphToYDoc(editor.ydoc, 'VERSION_ONE_BASELINE')
			await waitForCondition(async () => {
				const d = await apiRequest(app, {
					path: `/api/v1/docs/${pageId}`,
					workspaceId: fixture.workspaceId,
					userId: fixture.memberAId
				})
				return String(d.json['plainText'] ?? '').includes('VERSION_ONE_BASELINE')
			}, 4000)

			const snapRes = await apiRequest(app, {
				method: 'POST',
				path: `/api/v1/docs/${pageId}/versions`,
				workspaceId: fixture.workspaceId,
				userId: fixture.memberAId,
				body: { label: 'v1-clean' }
			})
			expect(snapRes.status).toBe(201)
			const v1Id = String(snapRes.json['id'])

			appendParagraphToYDoc(editor.ydoc, 'VERSION_TWO_ACCIDENTAL')
			await waitForCondition(async () => {
				const d = await apiRequest(app, {
					path: `/api/v1/docs/${pageId}`,
					workspaceId: fixture.workspaceId,
					userId: fixture.memberAId
				})
				return String(d.json['plainText'] ?? '').includes('VERSION_TWO_ACCIDENTAL')
			}, 4000)

			const restoreRes = await apiRequest(app, {
				method: 'POST',
				path: `/api/v1/docs/${pageId}/versions/${v1Id}/restore`,
				workspaceId: fixture.workspaceId,
				userId: fixture.memberAId,
				body: {}
			})
			expect(restoreRes.status).toBe(200)
			const checkpoint = restoreRes.json['checkpointVersion'] as { kind: string }
			expect(checkpoint.kind).toBe('pre_restore')

			const restoredDetail = restoreRes.json['detail'] as { plainText: string }
			expect(restoredDetail.plainText).toContain('VERSION_ONE_BASELINE')
			expect(restoredDetail.plainText).not.toContain('VERSION_TWO_ACCIDENTAL')

			// Connected WS client converges via forward CRDT replacement
			await waitForCondition(() => {
				const liveText = extractDocumentContent(editor.ydoc).plainText
				return liveText.includes('VERSION_ONE_BASELINE') && !liveText.includes('VERSION_TWO_ACCIDENTAL')
			}, 4000)
		} finally {
			for (const c of clients) c.disconnect()
			await rt.stop()
			await pubsub.close()
		}
	})

	test('relative-position anchored comments survive concurrent insertions and detect orphaned spans', async () => {
		if (!db) return
		const fixture = await seedM1Fixture(db.owner)
		const secret = 'g2-anchor-secret'
		const collab = createCollabRuntime({
			sql: db.app,
			ticketSecret: secret,
			debounceMs: 120,
			maxDebounceMs: 250
		})
		const { app, auth, pubsub } = createIntegrationServer(db, {
			collabBridge: collab.bridge,
			collabTicketSecret: secret
		})
		const rt = startRealtime({ port: 0, sql: db.app, auth, pubsub, collab })

		const clients: ConnectedEditor[] = []
		try {
			const pageRes = await apiRequest(app, {
				method: 'POST',
				path: '/api/v1/docs',
				workspaceId: fixture.workspaceId,
				userId: fixture.memberAId,
				body: {
					title: 'Anchored Spec',
					visibility: 'workspace',
					markdown: 'Alpha sentence. Target quote here. Omega sentence.'
				}
			})
			expect(pageRes.status).toBe(201)
			const pageId = String(pageRes.json['id'])

			const seedDetail = await apiRequest(app, {
				path: `/api/v1/docs/${pageId}`,
				workspaceId: fixture.workspaceId,
				userId: fixture.memberAId
			})
			const seedDoc = new Y.Doc()
			Y.applyUpdate(seedDoc, Buffer.from(String(seedDetail.json['stateBase64']), 'base64'))
			const seedText = extractDocumentContent(seedDoc).plainText
			const targetStart = seedText.indexOf('Target quote')
			expect(targetStart).toBeGreaterThanOrEqual(0)
			const anchor = encodeTextAnchor(seedDoc, targetStart, targetStart + 'Target quote'.length)
			expect(anchor).not.toBeNull()

			const commentRes = await apiRequest(app, {
				method: 'POST',
				path: `/api/v1/docs/${pageId}/comments`,
				workspaceId: fixture.workspaceId,
				userId: fixture.memberAId,
				body: {
					...(anchor ?? {}),
					bodyText: 'Check this quote!'
				}
			})
			expect(commentRes.status).toBe(201)
			const commentId = String(commentRes.json['id'])

			const t1 = await issueTicketForUser(app, fixture.workspaceId, fixture.memberBId, pageId)
			const editor = await connectCollabEditor({
				port: rt.port,
				documentName: t1.documentName,
				ticket: t1.ticket
			})
			clients.push(editor)

			// Concurrent edit 1: prepend new paragraph and prefix text before anchored quote
			editor.ydoc.transact(() => {
				const fragment = editor.ydoc.getXmlFragment('default')
				const intro = new Y.XmlElement('paragraph')
				intro.setAttribute('blockId', 'blk_intro')
				intro.insert(0, [new Y.XmlText('Inserted intro heading')])
				fragment.insert(0, [intro])

				const targetPara = fragment.get(1)
				if (targetPara instanceof Y.XmlElement) {
					const xt = targetPara.get(0)
					if (xt instanceof Y.XmlText) {
						xt.insert(0, 'Prefix ')
					}
				}
			}, 'test:concurrent-shift')

			await waitForCondition(async () => {
				const d = await apiRequest(app, {
					path: `/api/v1/docs/${pageId}`,
					workspaceId: fixture.workspaceId,
					userId: fixture.memberAId
				})
				return String(d.json['plainText'] ?? '').includes('Inserted intro heading')
			}, 4000)

			const afterShift = await apiRequest(app, {
				path: `/api/v1/docs/${pageId}`,
				workspaceId: fixture.workspaceId,
				userId: fixture.memberAId
			})
			const shiftedComment = (
				afterShift.json['comments'] as {
					id: string
					anchorOrphaned: boolean
					anchorFrom: string | null
					anchorTo: string | null
				}[]
			).find((c) => c.id === commentId)
			expect(shiftedComment?.anchorOrphaned).toBe(false)

			const dbDocAfterShift = new Y.Doc()
			Y.applyUpdate(dbDocAfterShift, Buffer.from(String(afterShift.json['stateBase64']), 'base64'))
			const resolved = resolveTextAnchor(
				dbDocAfterShift,
				shiftedComment?.anchorFrom ?? null,
				shiftedComment?.anchorTo ?? null
			)
			expect(resolved.status).toBe('attached')
			if (resolved.status === 'attached') {
				expect(resolved.text).toBe('Target quote')
			}

			// Concurrent edit 2: delete the anchored text span -> comment transitions to orphaned
			editor.ydoc.transact(() => {
				const fragment = editor.ydoc.getXmlFragment('default')
				const targetPara = fragment.get(1)
				if (targetPara instanceof Y.XmlElement) {
					const xt = targetPara.get(0)
					if (xt instanceof Y.XmlText) {
						const full = xt.toString()
						const idx = full.indexOf('Target quote')
						if (idx >= 0) xt.delete(idx, 'Target quote'.length)
					}
				}
			}, 'test:delete-anchored-span')

			await waitForCondition(async () => {
				const d = await apiRequest(app, {
					path: `/api/v1/docs/${pageId}`,
					workspaceId: fixture.workspaceId,
					userId: fixture.memberAId
				})
				return !String(d.json['plainText'] ?? '').includes('Target quote')
			}, 4000)

			const afterDelete = await apiRequest(app, {
				path: `/api/v1/docs/${pageId}`,
				workspaceId: fixture.workspaceId,
				userId: fixture.memberAId
			})
			const orphanedComment = (
				afterDelete.json['comments'] as { id: string; anchorOrphaned: boolean }[]
			).find((c) => c.id === commentId)
			expect(orphanedComment?.anchorOrphaned).toBe(true)
		} finally {
			for (const c of clients) c.disconnect()
			await rt.stop()
			await pubsub.close()
		}
	})

	test('enforces 10 MB document size hard limit in persistence and live collab sync', async () => {
		if (!db) return
		const fixture = await seedM1Fixture(db.owner)
		const secret = 'g2-size-guard-secret'
		const collab = createCollabRuntime({
			sql: db.app,
			ticketSecret: secret,
			debounceMs: 120,
			maxDebounceMs: 250
		})
		const { app, auth, pubsub } = createIntegrationServer(db, {
			collabBridge: collab.bridge,
			collabTicketSecret: secret
		})
		const rt = startRealtime({ port: 0, sql: db.app, auth, pubsub, collab })

		const clients: ConnectedEditor[] = []
		try {
			const pageRes = await apiRequest(app, {
				method: 'POST',
				path: '/api/v1/docs',
				workspaceId: fixture.workspaceId,
				userId: fixture.ownerId,
				body: { title: 'Bounded Doc', visibility: 'workspace', markdown: 'Safe baseline' }
			})
			const pageId = String(pageRes.json['id'])

			// Direct persistence check rejects >10 MB payload cleanly
			const oversizedDoc = new Y.Doc()
			appendParagraphToYDoc(oversizedDoc, 'x'.repeat(DOCUMENT_SIZE_MAX_BYTES + 65_536))
			await expect(
				withWorkspace(db.app, { workspaceId: fixture.workspaceId, userId: fixture.ownerId }, (tx) =>
					persistCollabDocumentState(tx, {
						workspaceId: fixture.workspaceId,
						pageId,
						nodeId: collab.nodeId,
						leaseEpoch: 1,
						ydoc: oversizedDoc,
						authorUserIds: [fixture.ownerId],
						actorId: fixture.ownerId
					})
				)
			).rejects.toThrow(/10 MB|doc_too_large/i)

			// Live WS client pushing >10 MB update cannot corrupt persisted doc_state
			const t1 = await issueTicketForUser(app, fixture.workspaceId, fixture.ownerId, pageId)
			const editor = await connectCollabEditor({
				port: rt.port,
				documentName: t1.documentName,
				ticket: t1.ticket,
				maxAttempts: 1
			})
			clients.push(editor)
			appendParagraphToYDoc(editor.ydoc, 'z'.repeat(DOCUMENT_SIZE_MAX_BYTES + 65_536))
			await new Promise((r) => setTimeout(r, 400))

			const after = await apiRequest(app, {
				path: `/api/v1/docs/${pageId}`,
				workspaceId: fixture.workspaceId,
				userId: fixture.ownerId
			})
			expect(Number(after.json['byteSize'])).toBeLessThan(DOCUMENT_SIZE_MAX_BYTES)
			expect(String(after.json['plainText'])).toBe('Safe baseline')
		} finally {
			for (const c of clients) c.disconnect()
			await rt.stop()
			await pubsub.close()
		}
	})
})
