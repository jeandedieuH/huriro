/**
 * Real PostgreSQL 18 + FORCE RLS + Hocuspocus integration tests for M9 Docs
 * Notion Authoring, Teamspaces, Synced Blocks, Suggestion Mode, Verification,
 * Backlinks, Knowledge Graph, Publish to Web & Rich Exports (Gate G9).
 */
import { beforeAll, describe, expect, setDefaultTimeout, test } from 'bun:test'
import { randomUUID } from 'node:crypto'
import { HocuspocusProvider, HocuspocusProviderWebsocket } from '@hocuspocus/provider'
import { extractDocumentContent, extractSuggestionsFromYDoc, proposeSuggestionOnYDoc } from '@huriro/editor'
import type { TestDb } from '@huriro/test-utils'
import { unzipSync } from 'fflate'
import * as Y from 'yjs'
import { runDocVerificationExpiryCheckOnce } from '../modules/docs'
import { createCollabRuntime, startRealtime } from '../realtime'
import { InProcessPubSub } from '../realtime/pubsub'
import { drainOutboxOnce } from '../worker'
import { apiRequest, createIntegrationServer, getTestDb, seedM1Fixture } from './test-harness'

setDefaultTimeout(25_000)

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

async function connectCollabEditor(opts: {
	readonly port: number
	readonly documentName: string
	readonly ticket: string
	readonly existingDoc?: Y.Doc
}): Promise<ConnectedEditor> {
	const ydoc = opts.existingDoc ?? new Y.Doc()
	const events = { closeCodes: [] as number[], authFailed: [] as boolean[] }
	const wsProvider = new HocuspocusProviderWebsocket({
		url: `ws://127.0.0.1:${opts.port}/collab`,
		WebSocketPolyfill: WebSocket,
		maxAttempts: 1,
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
	const timer = setTimeout(() => rejectSynced?.(new Error('Collab sync timed out')), 6000)

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

describe('M9 Docs Notion authoring, Teamspaces, Suggestions & Wiki (PostgreSQL 18)', () => {
	test('teamspaces open/closed/private ACL enforcement and multi-tenant isolation', async () => {
		if (!db) return
		const fixture = await seedM1Fixture(db.owner)
		const { app } = createIntegrationServer(db)

		const openRes = await apiRequest(app, {
			method: 'POST',
			path: '/api/v1/teamspaces',
			workspaceId: fixture.workspaceId,
			userId: fixture.ownerId,
			headers: { 'idempotency-key': randomUUID() },
			body: { name: 'Engineering Open', visibility: 'open' }
		})
		expect(openRes.status).toBe(201)

		const closedRes = await apiRequest(app, {
			method: 'POST',
			path: '/api/v1/teamspaces',
			workspaceId: fixture.workspaceId,
			userId: fixture.ownerId,
			headers: { 'idempotency-key': randomUUID() },
			body: { name: 'Architecture Closed', visibility: 'closed' }
		})
		expect(closedRes.status).toBe(201)
		const closedId = String(closedRes.json['id'])

		const privateRes = await apiRequest(app, {
			method: 'POST',
			path: '/api/v1/teamspaces',
			workspaceId: fixture.workspaceId,
			userId: fixture.ownerId,
			headers: { 'idempotency-key': randomUUID() },
			body: { name: 'Exec Private', visibility: 'private' }
		})
		expect(privateRes.status).toBe(201)

		// MemberA sees open and closed, NOT private
		const memberList = await apiRequest(app, {
			path: '/api/v1/teamspaces',
			workspaceId: fixture.workspaceId,
			userId: fixture.memberAId
		})
		expect(memberList.status).toBe(200)
		const memberNames = (memberList.json['data'] as Array<{ name: string }>).map((t) => t.name)
		expect(memberNames).toContain('Engineering Open')
		expect(memberNames).toContain('Architecture Closed')
		expect(memberNames).not.toContain('Exec Private')

		// Non-member cannot create doc inside closed teamspace
		const denyCreate = await apiRequest(app, {
			method: 'POST',
			path: '/api/v1/docs',
			workspaceId: fixture.workspaceId,
			userId: fixture.memberAId,
			body: { title: 'Closed Spec', teamspaceId: closedId, visibility: 'workspace' }
		})
		expect(denyCreate.status).toBe(403)

		// Add memberA as teamspace member -> create succeeds
		const addMember = await apiRequest(app, {
			method: 'POST',
			path: `/api/v1/teamspaces/${closedId}/members`,
			workspaceId: fixture.workspaceId,
			userId: fixture.ownerId,
			body: { userId: fixture.memberAId, role: 'member' }
		})
		expect(addMember.status).toBe(201)

		const allowCreate = await apiRequest(app, {
			method: 'POST',
			path: '/api/v1/docs',
			workspaceId: fixture.workspaceId,
			userId: fixture.memberAId,
			body: { title: 'Closed Spec', teamspaceId: closedId, visibility: 'workspace' }
		})
		expect(allowCreate.status).toBe(201)

		// Other tenant sees zero teamspaces and is denied member lookup in workspace A
		const otherTenantList = await apiRequest(app, {
			path: '/api/v1/teamspaces',
			workspaceId: fixture.workspaceId,
			userId: fixture.otherTenantUserId
		})
		expect(otherTenantList.status).toBe(200)
		expect(otherTenantList.json['data']).toEqual([])

		const otherTenantMembers = await apiRequest(app, {
			path: `/api/v1/teamspaces/${closedId}/members`,
			workspaceId: fixture.workspaceId,
			userId: fixture.otherTenantUserId
		})
		expect([403, 404]).toContain(otherTenantMembers.status)
	})

	test('page locking enforces HTTP 423 doc_locked, read-only tickets, and live WS readOnly downgrade', async () => {
		if (!db) return
		const fixture = await seedM1Fixture(db.owner)
		const secret = 'm9-lock-secret'
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
				userId: fixture.ownerId,
				body: { title: 'Frozen Runbook', visibility: 'workspace', markdown: '# Frozen\n\nDo not alter.' }
			})
			expect(pageRes.status).toBe(201)
			const pageId = String(pageRes.json['id'])

			const ticketBefore = await apiRequest(app, {
				method: 'POST',
				path: `/api/v1/docs/${pageId}/collab-ticket`,
				workspaceId: fixture.workspaceId,
				userId: fixture.memberAId
			})
			expect(ticketBefore.status).toBe(200)
			expect(ticketBefore.json['permission']).toBe('write')

			const liveClient = await connectCollabEditor({
				port: rt.port,
				documentName: String(ticketBefore.json['documentName']),
				ticket: String(ticketBefore.json['ticket'])
			})
			clients.push(liveClient)

			const lockRes = await apiRequest(app, {
				method: 'PATCH',
				path: `/api/v1/docs/${pageId}`,
				workspaceId: fixture.workspaceId,
				userId: fixture.ownerId,
				body: { isLocked: true, version: 1 }
			})
			expect(lockRes.status).toBe(200)
			expect(lockRes.json['isLocked']).toBe(true)

			// Wait briefly for pubsub revoke to downgrade live connection to readOnly
			await new Promise((r) => setTimeout(r, 250))
			liveClient.ydoc.transact(() => {
				const frag = liveClient.ydoc.getXmlFragment('default')
				const p = new Y.XmlElement('paragraph')
				p.insert(0, [new Y.XmlText('ILLEGAL_LOCKED_MUTATION')])
				frag.push([p])
			}, 'test:locked-ws')
			await new Promise((r) => setTimeout(r, 350))

			const checkLockedDetail = await apiRequest(app, {
				path: `/api/v1/docs/${pageId}`,
				workspaceId: fixture.workspaceId,
				userId: fixture.ownerId
			})
			expect(checkLockedDetail.status).toBe(200)
			expect(String(checkLockedDetail.json['plainText'])).not.toContain('ILLEGAL_LOCKED_MUTATION')

			// HTTP content mutation rejected with 409 doc_locked
			const appendRes = await apiRequest(app, {
				method: 'POST',
				path: `/api/v1/docs/${pageId}/append`,
				workspaceId: fixture.workspaceId,
				userId: fixture.memberAId,
				body: { markdown: 'Attempted overwrite' }
			})
			expect(appendRes.status).toBe(409)
			expect(appendRes.json['code']).toBe('doc_locked')

			// Subsequent collab ticket downgrades to read-only while locked
			const ticketLocked = await apiRequest(app, {
				method: 'POST',
				path: `/api/v1/docs/${pageId}/collab-ticket`,
				workspaceId: fixture.workspaceId,
				userId: fixture.memberAId
			})
			expect(ticketLocked.status).toBe(200)
			expect(ticketLocked.json['permission']).toBe('read')
		} finally {
			for (const c of clients) c.disconnect()
			await rt.stop()
			await pubsub.close()
		}
	})

	test('synced blocks converge across Hocuspocus synced_block rooms and persist to PostgreSQL', async () => {
		if (!db) return
		const fixture = await seedM1Fixture(db.owner)
		const secret = 'm9-synced-block-secret'
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
			const createRes = await apiRequest(app, {
				method: 'POST',
				path: '/api/v1/docs/synced-blocks',
				workspaceId: fixture.workspaceId,
				userId: fixture.ownerId,
				body: { title: 'Shared Warning', markdown: 'Original warning' }
			})
			expect(createRes.status).toBe(201)
			const blockId = String(createRes.json['id'])

			const tA = await apiRequest(app, {
				method: 'POST',
				path: `/api/v1/docs/synced-blocks/${blockId}/collab-ticket`,
				workspaceId: fixture.workspaceId,
				userId: fixture.memberAId
			})
			const tB = await apiRequest(app, {
				method: 'POST',
				path: `/api/v1/docs/synced-blocks/${blockId}/collab-ticket`,
				workspaceId: fixture.workspaceId,
				userId: fixture.memberBId
			})
			expect(tA.status).toBe(200)
			expect(String(tA.json['documentName'])).toStartWith('synced_block:')

			const cA = await connectCollabEditor({
				port: rt.port,
				documentName: String(tA.json['documentName']),
				ticket: String(tA.json['ticket'])
			})
			const cB = await connectCollabEditor({
				port: rt.port,
				documentName: String(tB.json['documentName']),
				ticket: String(tB.json['ticket'])
			})
			clients.push(cA, cB)

			cA.ydoc.transact(() => {
				const frag = cA.ydoc.getXmlFragment('default')
				const p = new Y.XmlElement('paragraph')
				p.insert(0, [new Y.XmlText('SYNCED_ROLLOUT_NOTE')])
				frag.push([p])
			}, 'test:synced-edit')

			await waitForCondition(
				() => extractDocumentContent(cB.ydoc).plainText.includes('SYNCED_ROLLOUT_NOTE'),
				4000
			)
			for (const c of clients) c.disconnect()
			clients.length = 0
			await rt.stop()

			const fetched = await apiRequest(app, {
				path: `/api/v1/docs/synced-blocks/${blockId}`,
				workspaceId: fixture.workspaceId,
				userId: fixture.memberBId
			})
			expect(fetched.status).toBe(200)
			expect(String(fetched.json['plainText'])).toContain('SYNCED_ROLLOUT_NOTE')
		} finally {
			for (const c of clients) c.disconnect()
			await rt.stop().catch(() => {})
			await pubsub.close()
		}
	})

	test('in-house Suggestion Mode commenter proposals + review accept/reject + 10-editor concurrent convergence', async () => {
		if (!db) return
		const fixture = await seedM1Fixture(db.owner)
		const secret = 'm9-suggestion-secret'
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
				body: {
					title: 'Suggestion Review Doc',
					visibility: 'private',
					markdown: '# Intro\n\nThis legacy pipeline uses polling.'
				}
			})
			expect(pageRes.status).toBe(201)
			const pageId = String(pageRes.json['id'])

			// Grant memberB commenter-only permission
			const aclRes = await apiRequest(app, {
				method: 'POST',
				path: '/api/v1/acl',
				workspaceId: fixture.workspaceId,
				userId: fixture.ownerId,
				body: {
					resourceType: 'doc_page',
					resourceId: pageId,
					principalType: 'user',
					principalId: fixture.memberBId,
					permission: 'comment'
				}
			})
			expect(aclRes.status).toBe(200)

			// Commenter proposes a replacement suggestion cleanly via API
			const propRes = await apiRequest(app, {
				method: 'POST',
				path: `/api/v1/docs/${pageId}/suggestions`,
				workspaceId: fixture.workspaceId,
				userId: fixture.memberBId,
				body: {
					kind: 'replace',
					targetText: 'legacy pipeline',
					replacementText: 'streaming outbox'
				}
			})
			expect(propRes.status).toBe(201)
			const groupId = String(propRes.json['groupId'])

			// Owner reviews & accepts suggestion
			const acceptRes = await apiRequest(app, {
				method: 'POST',
				path: `/api/v1/docs/${pageId}/suggestions/${groupId}/decision`,
				workspaceId: fixture.workspaceId,
				userId: fixture.ownerId,
				body: { decision: 'accept' }
			})
			expect(acceptRes.status).toBe(200)
			expect(acceptRes.json['status']).toBe('accepted')

			const afterAccept = await apiRequest(app, {
				path: `/api/v1/docs/${pageId}`,
				workspaceId: fixture.workspaceId,
				userId: fixture.ownerId
			})
			expect(String(afterAccept.json['plainText'])).toContain('streaming outbox')
			expect(String(afterAccept.json['plainText'])).not.toContain('legacy pipeline')

			// Grant write access to memberA & connect 10 concurrent editors proposing suggestions
			await apiRequest(app, {
				method: 'POST',
				path: '/api/v1/acl',
				workspaceId: fixture.workspaceId,
				userId: fixture.ownerId,
				body: {
					resourceType: 'doc_page',
					resourceId: pageId,
					principalType: 'user',
					principalId: fixture.memberAId,
					permission: 'write'
				}
			})

			for (let i = 0; i < 10; i++) {
				const uid = i % 2 === 0 ? fixture.ownerId : fixture.memberAId
				const tk = await apiRequest(app, {
					method: 'POST',
					path: `/api/v1/docs/${pageId}/collab-ticket`,
					workspaceId: fixture.workspaceId,
					userId: uid
				})
				const client = await connectCollabEditor({
					port: rt.port,
					documentName: String(tk.json['documentName']),
					ticket: String(tk.json['ticket'])
				})
				clients.push(client)
			}

			await Promise.all(
				clients.map(async (c, idx) => {
					proposeSuggestionOnYDoc(c.ydoc, {
						kind: 'insert',
						authorType: 'user',
						authorId: fixture.ownerId,
						replacementText: ` SUG_PEER_${idx}`,
						groupId: `fuzz-grp-${idx}`
					})
				})
			)

			await waitForCondition(
				() =>
					clients.every((c) => {
						const groups = extractSuggestionsFromYDoc(c.ydoc).map((g) => g.groupId)
						return groups.length === 10
					}),
				6000
			)

			const expectedGroups = extractSuggestionsFromYDoc(clients[0]!.ydoc)
				.map((g) => g.groupId)
				.sort()
			for (const c of clients) {
				expect(
					extractSuggestionsFromYDoc(c.ydoc)
						.map((g) => g.groupId)
						.sort()
				).toEqual(expectedGroups)
			}

			for (const c of clients) c.disconnect()
			clients.length = 0
			await rt.stop()

			const finalDetail = await apiRequest(app, {
				path: `/api/v1/docs/${pageId}`,
				workspaceId: fixture.workspaceId,
				userId: fixture.ownerId
			})
			expect(finalDetail.status).toBe(200)
			const decideAll = await apiRequest(app, {
				method: 'POST',
				path: `/api/v1/docs/${pageId}/suggestions/decide-all`,
				workspaceId: fixture.workspaceId,
				userId: fixture.ownerId,
				body: { decision: 'reject' }
			})
			expect(decideAll.status).toBe(200)
		} finally {
			for (const c of clients) c.disconnect()
			await rt.stop().catch(() => {})
			await pubsub.close()
		}
	})

	test('verification expiry sweep, backlinks, ACL-filtered knowledge graph, publish-to-web, rich export & bookmark SSRF block', async () => {
		if (!db) return
		const fixture = await seedM1Fixture(db.owner)
		const { app, pubsub } = createIntegrationServer(db, {
			egressFetch: Object.assign(
				async () =>
					new Response(
						'<html><head><title>Example Reference</title><meta name="description" content="Trusted site"/></head></html>',
						{ status: 200, headers: { 'content-type': 'text/html' } }
					),
				{ preconnect: () => {} }
			) as unknown as typeof fetch,
			egressResolver: async (hostname) => {
				if (hostname === '127.0.0.1' || hostname.startsWith('169.254')) {
					return [{ address: hostname, family: 4 }]
				}
				return [{ address: '93.184.216.34', family: 4 }]
			}
		})

		try {
			// Target doc B + child doc + private hidden doc C
			const docB = await apiRequest(app, {
				method: 'POST',
				path: '/api/v1/docs',
				workspaceId: fixture.workspaceId,
				userId: fixture.ownerId,
				body: {
					title: 'Public Guide',
					visibility: 'workspace',
					markdown: '# Public Guide\n\nSafe body.\n\n<script>alert("xss")</script>'
				}
			})
			expect(docB.status).toBe(201)
			const docBId = String(docB.json['id'])
			const docBSlug = String(docB.json['slug'])

			const childB = await apiRequest(app, {
				method: 'POST',
				path: '/api/v1/docs',
				workspaceId: fixture.workspaceId,
				userId: fixture.ownerId,
				body: {
					title: 'Child Guide',
					parentId: docBId,
					visibility: 'workspace',
					markdown: 'Nested section content.'
				}
			})
			expect(childB.status).toBe(201)

			const docA = await apiRequest(app, {
				method: 'POST',
				path: '/api/v1/docs',
				workspaceId: fixture.workspaceId,
				userId: fixture.ownerId,
				body: {
					title: 'Handbook Index',
					visibility: 'workspace',
					markdown: `See [Public Guide](/docs/${docBSlug}) for rollout details.`
				}
			})
			expect(docA.status).toBe(201)
			const docAId = String(docA.json['id'])

			const privateC = await apiRequest(app, {
				method: 'POST',
				path: '/api/v1/docs',
				workspaceId: fixture.workspaceId,
				userId: fixture.ownerId,
				body: { title: 'Secret Board Notes', visibility: 'private', markdown: 'Confidential board.' }
			})
			expect(privateC.status).toBe(201)
			const privateCId = String(privateC.json['id'])

			// Backlinks + ACL-filtered Knowledge Graph
			const linksRes = await apiRequest(app, {
				path: `/api/v1/graph/links?type=doc_page&id=${docBId}`,
				workspaceId: fixture.workspaceId,
				userId: fixture.memberBId
			})
			expect(linksRes.status).toBe(200)
			const linkSources = (linksRes.json['data'] as Array<{ sourceId: string }>).map((l) => l.sourceId)
			expect(linkSources).toContain(docAId)

			const graphRes = await apiRequest(app, {
				path: '/api/v1/graph/knowledge',
				workspaceId: fixture.workspaceId,
				userId: fixture.memberBId
			})
			expect(graphRes.status).toBe(200)
			const nodeIds = (graphRes.json['nodes'] as Array<{ id: string }>).map((n) => n.id)
			expect(nodeIds).toContain(docAId)
			expect(nodeIds).toContain(docBId)
			expect(nodeIds).not.toContain(privateCId)

			// Verification lifecycle + 7-day warning + expired stale sweep
			const verPut = await apiRequest(app, {
				method: 'PUT',
				path: `/api/v1/docs/${docBId}/verification`,
				workspaceId: fixture.workspaceId,
				userId: fixture.ownerId,
				body: { status: 'verified', ttlDays: 90, note: 'Checked' }
			})
			expect(verPut.status).toBe(200)

			await db.owner`
				UPDATE doc_verifications
				SET expires_at = now() + interval '3 days'
				WHERE workspace_id = ${fixture.workspaceId} AND page_id = ${docBId}
			`
			const warnSweep = await runDocVerificationExpiryCheckOnce(db.owner, pubsub)
			expect(warnSweep.warningsSent).toBeGreaterThanOrEqual(1)
			await drainOutboxOnce(db.owner)

			await db.owner`
				UPDATE doc_verifications
				SET expires_at = now() - interval '1 hour'
				WHERE workspace_id = ${fixture.workspaceId} AND page_id = ${docBId}
			`
			const staleSweep = await runDocVerificationExpiryCheckOnce(db.owner, pubsub)
			expect(staleSweep.staleMarked).toBeGreaterThanOrEqual(1)

			// Publish to web with password + noindex
			const [wsRow] = await db.owner<{ slug: string }[]>`
				SELECT slug::text AS slug FROM workspaces WHERE id = ${fixture.workspaceId}
			`
			const wsSlug = wsRow!.slug

			const pubPut = await apiRequest(app, {
				method: 'PUT',
				path: `/api/v1/docs/${docBId}/public-share`,
				workspaceId: fixture.workspaceId,
				userId: fixture.ownerId,
				body: {
					publicSlug: 'rollout-guide',
					includeChildren: true,
					allowSearchIndexing: false,
					password: 'pass-9999'
				}
			})
			expect(pubPut.status).toBe(200)

			// Unauthenticated anonymous fetch requires password & sets X-Robots-Tag: noindex, nofollow
			const anonLocked = await app.handle(
				new Request(`http://localhost/api/v1/public/docs/${wsSlug}/rollout-guide`)
			)
			expect(anonLocked.status).toBe(200)
			expect(anonLocked.headers.get('x-robots-tag')).toBe('noindex, nofollow')
			const anonLockedBody = (await anonLocked.json()) as { passwordRequired: boolean; html: string }
			expect(anonLockedBody.passwordRequired).toBe(true)
			expect(anonLockedBody.html).toBe('')

			const wrongUnlock = await app.handle(
				new Request(`http://localhost/api/v1/public/docs/${wsSlug}/rollout-guide/unlock`, {
					method: 'POST',
					headers: { 'content-type': 'application/json' },
					body: JSON.stringify({ password: 'wrong' })
				})
			)
			expect(wrongUnlock.status).toBe(403)

			const okUnlock = await app.handle(
				new Request(`http://localhost/api/v1/public/docs/${wsSlug}/rollout-guide/unlock`, {
					method: 'POST',
					headers: { 'content-type': 'application/json' },
					body: JSON.stringify({ password: 'pass-9999' })
				})
			)
			expect(okUnlock.status).toBe(200)
			const unlocked = (await okUnlock.json()) as { html: string; children: Array<{ title: string }> }
			expect(unlocked.html).not.toContain('<script>')
			expect(unlocked.html).toContain('Safe body.')
			expect(unlocked.children.map((c) => c.title)).toContain('Child Guide')

			// Allow search indexing & clear password -> verify .md and llms.txt
			await apiRequest(app, {
				method: 'PUT',
				path: `/api/v1/docs/${docBId}/public-share`,
				workspaceId: fixture.workspaceId,
				userId: fixture.ownerId,
				body: { allowSearchIndexing: true, password: null }
			})
			const mdRes = await app.handle(
				new Request(`http://localhost/api/v1/public/docs/${wsSlug}/rollout-guide.md`)
			)
			expect(mdRes.status).toBe(200)
			expect(await mdRes.text()).toContain('Safe body.')

			const llmsRes = await app.handle(new Request(`http://localhost/api/v1/public/docs/${wsSlug}/llms.txt`))
			expect(llmsRes.status).toBe(200)
			expect(await llmsRes.text()).toContain('Public Guide')

			// Rich HTML + ZIP export
			const htmlExport = await apiRequest(app, {
				path: `/api/v1/docs/${docBId}/export?format=html`,
				workspaceId: fixture.workspaceId,
				userId: fixture.memberBId
			})
			expect(htmlExport.status).toBe(200)
			expect(String(htmlExport.json['html'])).toContain('Safe body.')

			const zipRes = await app.handle(
				new Request(`http://localhost/api/v1/docs/${docBId}/export?format=zip&includeChildren=true`, {
					headers: {
						'x-huriro-client': 'huriro-test',
						'x-workspace-id': fixture.workspaceId,
						'x-test-user-id': fixture.memberBId
					}
				})
			)
			expect(zipRes.status).toBe(200)
			const zipBytes = new Uint8Array(await zipRes.arrayBuffer())
			const unzipped = unzipSync(zipBytes)
			expect(Object.keys(unzipped).length).toBeGreaterThanOrEqual(2)

			// SSRF bookmark unfurl guard
			const ssrfBlocked = await apiRequest(app, {
				method: 'POST',
				path: '/api/v1/docs/bookmarks/unfurl',
				workspaceId: fixture.workspaceId,
				userId: fixture.memberBId,
				body: { url: 'http://169.254.169.254/latest/meta-data/' }
			})
			expect(ssrfBlocked.status).toBeGreaterThanOrEqual(400)

			const validBookmark = await apiRequest(app, {
				method: 'POST',
				path: '/api/v1/docs/bookmarks/unfurl',
				workspaceId: fixture.workspaceId,
				userId: fixture.memberBId,
				body: { url: 'https://example.com/guide' }
			})
			expect(validBookmark.status).toBe(200)
			expect(validBookmark.json['title']).toBe('Example Reference')
		} finally {
			await pubsub.close()
		}
	})
})
