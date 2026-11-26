/** M11 collaborative mail-draft editing: two realtime clients co-edit one
 * draft through Hocuspocus `mail_draft` rooms, converge without divergence,
 * and the fenced persistence path writes the merged content back to the
 * draft row. Mirrors the production `/collab` wiring (Gate G2 harness).
 */
import { beforeAll, describe, expect, setDefaultTimeout, test } from 'bun:test'
import { HocuspocusProvider, HocuspocusProviderWebsocket } from '@hocuspocus/provider'
import type { TestDb } from '@huriro/test-utils'
import * as Y from 'yjs'
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
	readonly provider: HocuspocusProvider
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

function appendParagraph(ydoc: Y.Doc, text: string): void {
	const fragment = ydoc.getXmlFragment('default')
	ydoc.transact(() => {
		const para = new Y.XmlElement('paragraph')
		para.setAttribute('blockId', `blk_${Math.random().toString(36).slice(2, 10)}`)
		para.insert(0, [new Y.XmlText(text)])
		fragment.push([para])
	}, 'test:edit')
}

function docText(ydoc: Y.Doc): string {
	const fragment = ydoc.getXmlFragment('default')
	let out = ''
	for (let i = 0; i < fragment.length; i++) {
		const node = fragment.get(i)
		if (node instanceof Y.XmlElement) {
			for (let j = 0; j < node.length; j++) {
				const child = node.get(j)
				if (child instanceof Y.XmlText) out += child.toString()
			}
		}
	}
	return out
}

async function connectEditor(opts: {
	readonly port: number
	readonly documentName: string
	readonly ticket: string
}): Promise<ConnectedEditor> {
	const ydoc = new Y.Doc()
	const wsProvider = new HocuspocusProviderWebsocket({
		url: `ws://127.0.0.1:${opts.port}/collab`,
		WebSocketPolyfill: WebSocket,
		maxAttempts: 1,
		delay: 100,
		minDelay: 100
	})
	let resolveSynced: (() => void) | null = null
	let rejectSynced: ((err: Error) => void) | null = null
	const syncedPromise = new Promise<void>((res, rej) => {
		resolveSynced = res
		rejectSynced = rej
	})
	const timer = setTimeout(() => rejectSynced?.(new Error('initial sync timed out')), 6000)
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
			clearTimeout(timer)
			rejectSynced?.(new Error('collab authentication failed'))
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
		provider,
		disconnect() {
			provider.destroy()
			wsProvider.destroy()
		}
	}
}

describe('M11 collaborative mail drafts (PostgreSQL 18 + Hocuspocus)', () => {
	test('two clients co-edit one draft, converge, and persistence fences back to the draft row', async () => {
		if (!db) return
		const fixture = await seedM1Fixture(db.owner)
		const secret = 'mail-collab-test-secret'
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
			pubsub,
			mail: { publicBaseUrl: 'http://localhost' }
		})
		const rt = startRealtime({ port: 0, sql: db.app, auth, pubsub, collab })
		const ws = fixture.workspaceId
		const a = fixture.memberAId
		const b = fixture.memberBId
		const asA = (path: string, init?: { method?: string; body?: unknown }) =>
			apiRequest(app, { path, workspaceId: ws, userId: a, ...init })
		const asB = (path: string, init?: { method?: string; body?: unknown }) =>
			apiRequest(app, { path, workspaceId: ws, userId: b, ...init })

		const clients: ConnectedEditor[] = []
		try {
			// Setup: account + identity + inbox + proactive outbound with collabEnabled draft.
			const acct = await asA('/api/v1/mail/accounts', {
				method: 'POST',
				body: { provider: 'inbound_parse', address: 'support@test.huriro.dev', displayName: 'Support' }
			})
			expect(acct.status).toBe(201)
			const identity = await asA('/api/v1/mail/identities', {
				method: 'POST',
				body: {
					accountId: acct.json['id'],
					address: 'support@test.huriro.dev',
					displayName: 'Support',
					isDefault: true
				}
			})
			expect(identity.status).toBe(201)
			const inbox = await asA('/api/v1/mail/inboxes', { method: 'POST', body: { name: 'Support' } })
			expect(inbox.status).toBe(201)
			const outbound = await asA('/api/v1/mail/outbound', {
				method: 'POST',
				body: {
					inboxId: inbox.json['id'],
					identityId: identity.json['id'],
					subject: 'Collab draft test',
					recipients: { to: [{ email: 'jane@customer.example' }] },
					bodyText: 'initial draft body',
					collabEnabled: true
				}
			})
			expect(outbound.status).toBe(201)
			const draft = outbound.json['draft'] as Record<string, unknown>
			const draftId = String(draft['id'])

			// Both members issue single-use tickets for the same room.
			const ticketA = await asA(`/api/v1/mail/drafts/${draftId}/collab-ticket`, { method: 'POST' })
			expect(ticketA.status).toBe(200)
			const ticketB = await asB(`/api/v1/mail/drafts/${draftId}/collab-ticket`, { method: 'POST' })
			expect(ticketB.status).toBe(200)
			const documentName = String(ticketA.json['documentName'])
			expect(documentName).toBe(`mail_draft:${ws}:${draftId}`)
			expect(String(ticketB.json['documentName'])).toBe(documentName)

			// Ticket replay is single-use: reusing A's exact ticket must fail auth.
			const editorA = await connectEditor({
				port: rt.port,
				documentName,
				ticket: String(ticketA.json['ticket'])
			})
			clients.push(editorA)
			const editorB = await connectEditor({
				port: rt.port,
				documentName,
				ticket: String(ticketB.json['ticket'])
			})
			clients.push(editorB)

			// A types, B sees it; B types, A sees it — CRDT convergence both ways.
			appendParagraph(editorA.ydoc, 'hello from agent A')
			await waitForCondition(() => docText(editorB.ydoc).includes('hello from agent A'))
			appendParagraph(editorB.ydoc, 'reply from agent B')
			await waitForCondition(() => docText(editorA.ydoc).includes('reply from agent B'))

			// States converge exactly — zero divergence.
			const stateA = Buffer.from(Y.encodeStateAsUpdate(editorA.ydoc)).toString('base64')
			const stateB = Buffer.from(Y.encodeStateAsUpdate(editorB.ydoc)).toString('base64')
			expect(stateA).toBe(stateB)

			// Both disconnect; the runtime debounce-persists room state back to the draft.
			for (const c of clients.splice(0)) c.disconnect()
			await waitForCondition(async () => {
				const rows = await db!.owner<{ bodyText: string }[]>`
					SELECT body_text AS "bodyText" FROM mail_drafts
					WHERE workspace_id = ${ws} AND id = ${draftId}
				`
				const text = rows[0]?.bodyText ?? ''
				return text.includes('hello from agent A') && text.includes('reply from agent B')
			}, 8000)
		} finally {
			for (const c of clients) c.disconnect()
			await rt.stop()
		}
	})
})
