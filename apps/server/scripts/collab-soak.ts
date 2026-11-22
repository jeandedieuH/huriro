/**
 * Configurable multi-editor WebSocket soak runner (Gate G2):
 *
 *   bun run soak:collab --editors=10 --duration-ms=1800000
 *   bun run soak:collab --editors=10 --duration-ms=4000
 */
import { HocuspocusProvider, HocuspocusProviderWebsocket } from '@hocuspocus/provider'
import { extractDocumentContent } from '@huriro/editor'
import { getTestDb } from '@huriro/test-utils'
import * as Y from 'yjs'
import { apiRequest, createIntegrationServer, seedM1Fixture } from '../src/integration/test-harness'
import { createCollabRuntime, startRealtime } from '../src/realtime'

function parseArg(name: string, fallback: number): number {
	const prefix = `--${name}=`
	const match = process.argv.slice(2).find((a) => a.startsWith(prefix))
	if (!match) return fallback
	const parsed = Number(match.slice(prefix.length))
	return Number.isFinite(parsed) && parsed > 0 ? parsed : fallback
}

if (process.argv.includes('--help')) {
	console.log('Usage: bun run soak:collab [--editors=10] [--duration-ms=1800000] [--edit-interval-ms=250]')
	process.exit(0)
}

async function main() {
	const editorCount = parseArg('editors', 10)
	const durationMs = parseArg('duration-ms', 30 * 60 * 1000)
	const editIntervalMs = parseArg('edit-interval-ms', 250)

	const db = await getTestDb()
	if (!db) {
		console.error('Database unavailable: set DATABASE_URL or HURIRO_TESTCONTAINERS=1')
		process.exit(1)
	}

	const secret = 'soak-collab-secret'
	const collab = createCollabRuntime({
		sql: db.app,
		ticketSecret: secret,
		debounceMs: 250,
		maxDebounceMs: 1000
	})
	const { app, auth, pubsub } = createIntegrationServer(db, {
		collabBridge: collab.bridge,
		collabTicketSecret: secret
	})
	const rt = startRealtime({ port: 0, sql: db.app, auth, pubsub, collab })

	const clients: {
		readonly idx: number
		readonly ydoc: Y.Doc
		readonly provider: HocuspocusProvider
		readonly wsProvider: HocuspocusProviderWebsocket
	}[] = []

	try {
		const fixture = await seedM1Fixture(db.owner)
		const pageRes = await apiRequest(app, {
			method: 'POST',
			path: '/api/v1/docs',
			workspaceId: fixture.workspaceId,
			userId: fixture.ownerId,
			body: { title: 'Soak Test Document', visibility: 'workspace', markdown: '# Soak start' }
		})
		if (pageRes.status !== 201) {
			throw new Error(`Failed to create soak page: ${pageRes.status}`)
		}
		const pageId = String(pageRes.json['id'])
		const actors = [fixture.ownerId, fixture.adminId, fixture.memberAId, fixture.memberBId]

		for (let i = 0; i < editorCount; i++) {
			const userId = actors[i % actors.length] ?? fixture.ownerId
			const tRes = await apiRequest(app, {
				method: 'POST',
				path: `/api/v1/docs/${pageId}/collab-ticket`,
				workspaceId: fixture.workspaceId,
				userId
			})
			if (tRes.status !== 200) throw new Error(`Ticket issue failed for editor ${i}`)
			const ydoc = new Y.Doc()
			const wsProvider = new HocuspocusProviderWebsocket({
				url: `ws://127.0.0.1:${rt.port}/collab`,
				WebSocketPolyfill: WebSocket,
				maxAttempts: 3,
				delay: 150,
				minDelay: 150
			})
			let resolveSync: (() => void) | null = null
			const synced = new Promise<void>((r) => {
				resolveSync = r
			})
			const provider = new HocuspocusProvider({
				websocketProvider: wsProvider,
				name: String(tRes.json['documentName']),
				document: ydoc,
				token: String(tRes.json['ticket']),
				onSynced: () => resolveSync?.()
			})
			provider.attach()
			await synced
			clients.push({ idx: i, ydoc, provider, wsProvider })
		}

		const markers: string[] = []
		const endAt = Date.now() + durationMs
		let tick = 0
		while (Date.now() < endAt) {
			const c = clients[tick % clients.length]
			if (c) {
				const marker = `SOAK_E${c.idx}_T${tick}`
				markers.push(marker)
				c.ydoc.transact(() => {
					const el = new Y.XmlElement('paragraph')
					el.setAttribute('blockId', `soak_${tick}`)
					el.insert(0, [new Y.XmlText(marker)])
					c.ydoc.getXmlFragment('default').push([el])
				}, `soak:${c.idx}`)
			}
			tick += 1
			await new Promise((r) => setTimeout(r, editIntervalMs))
		}

		// Wait up to 15s for full convergence across all editors
		const convDeadline = Date.now() + 15_000
		let converged = false
		while (Date.now() < convDeadline) {
			const texts = clients.map((c) => extractDocumentContent(c.ydoc).plainText)
			const ref = texts[0] ?? ''
			if (markers.every((m) => ref.includes(m)) && texts.every((t) => t === ref)) {
				converged = true
				break
			}
			await new Promise((r) => setTimeout(r, 100))
		}
		if (!converged) {
			throw new Error('Soak test finished without full peer convergence')
		}

		// Flush cleanly and compare PostgreSQL doc_state
		await rt.stop()
		const finalDetail = await apiRequest(app, {
			path: `/api/v1/docs/${pageId}`,
			workspaceId: fixture.workspaceId,
			userId: fixture.ownerId
		})
		const finalDbText = String(finalDetail.json['plainText'] ?? '')
		const clientRefText = extractDocumentContent(clients[0]?.ydoc ?? new Y.Doc()).plainText
		if (finalDbText !== clientRefText) {
			throw new Error('PostgreSQL doc_state diverged from converged Y.Doc')
		}

		console.log(
			JSON.stringify({
				status: 'ok',
				editors: editorCount,
				durationMs,
				editsApplied: markers.length,
				converged: true,
				heapUsedMb: Math.round(process.memoryUsage().heapUsed / (1024 * 1024))
			})
		)
	} finally {
		for (const c of clients) {
			c.provider.destroy()
			c.wsProvider.destroy()
		}
		await rt.stop()
		await pubsub.close()
		await db.stop()
	}
}

void main()
