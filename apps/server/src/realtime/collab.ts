/**
 * Hocuspocus v4 collaborative editing runtime (§10, §10.5):
 *   - Single-use HKDF collab ticket auth via MessageType.Auth (never URL query)
 *   - Single-homed room leases in `doc_room_leases` with epoch fencing
 *   - Live `readOnly` enforcement + mid-session revocation (`4003` close on lose-read,
 *     read-only downgrade on lose-write)
 *   - 2 MB warn / 10 MB hard document size guard
 *   - Fenced Y.Doc persistence + auto version checkpoints + anchor orphan sync
 *   - `openDirectConnection` bridge for server/API writes and non-destructive restore
 *   - Graceful `SIGTERM` flush + unload + lease release
 */
import { randomUUID } from 'node:crypto'
import { Hocuspocus } from '@hocuspocus/server'
import { isUuid, type Sql, withWorkspace } from '@huriro/db'
import {
	appendProseMirrorNodesToYDoc,
	DOCUMENT_SIZE_MAX_BYTES,
	replaceYDocContent,
	ydocToProseMirrorJson
} from '@huriro/editor'
import * as Y from 'yjs'
import {
	collabConnectionsGauge,
	collabLeaseConflictsTotal,
	collabRoomsGauge,
	collabStateBytesHistogram,
	collabStoreDurationSeconds,
	log
} from '../api/observability'
import {
	acquireCollabRoomAndState,
	type CollabDirectBridge,
	consumeAndAuthorizeCollabTicket,
	persistCollabDocumentState,
	releaseCollabRoomLease,
	renewCollabRoomLease,
	verifyCollabTicketSignature,
	verifyLiveCollabSessionAccess
} from '../modules/docs'
import { resolveActor } from '../modules/tenancy'
import type { RealtimePubSub } from './pubsub'

export interface CollabWebSocketLike {
	send(data: string | ArrayBufferLike | Blob | ArrayBufferView): void
	close(code?: number, reason?: string): void
	readonly readyState: number
}

export interface CollabContext {
	readonly userId: string
	readonly workspaceId: string
	readonly pageId: string
	readonly permission: 'read' | 'write'
	readonly readOnly: boolean
	readonly socketId: string
	readonly internalDirect?: boolean | undefined
}

interface RoomLeaseState {
	readonly workspaceId: string
	readonly pageId: string
	epoch: number
	readonly authors: Set<string>
	renewTimer: ReturnType<typeof setInterval> | null
	leaseLost: boolean
	lastByteSize: number
}

interface ActiveCollabConnection {
	readonly socketId: string
	readonly workspaceId: string
	readonly pageId: string
	readonly userId: string
	readonly ws: CollabWebSocketLike
	readOnly: boolean
}

export interface CollabRuntimeDeps {
	readonly sql: Sql
	readonly pubsub?: RealtimePubSub | undefined
	readonly ticketSecret: string
	readonly nodeId?: string | undefined
	readonly leaseTtlMs?: number | undefined
	readonly leaseRenewMs?: number | undefined
	readonly debounceMs?: number | undefined
	readonly maxDebounceMs?: number | undefined
	readonly reauthIntervalMs?: number | undefined
}

export interface CollabRuntime {
	readonly nodeId: string
	readonly bridge: CollabDirectBridge
	readonly handleConnection: (
		ws: CollabWebSocketLike,
		request: Request
	) => ReturnType<Hocuspocus<CollabContext>['handleConnection']>
	readonly getRoomLeaseEpoch: (workspaceId: string, pageId: string) => number | null
	readonly getActiveRoomCount: () => number
	readonly getActiveConnectionCount: () => number
	readonly simulateCrashWithoutRelease: () => Promise<void>
	readonly stop: () => Promise<void>
}

function parseDocumentName(documentName: string): { readonly workspaceId: string; readonly pageId: string } {
	const parts = documentName.split(':')
	const workspaceId = parts[0] ?? ''
	const pageId = parts[1] ?? ''
	if (parts.length !== 2 || !isUuid(workspaceId) || !isUuid(pageId)) {
		throw new Error('Invalid document room name; expected <workspaceId>:<pageId>')
	}
	return { workspaceId, pageId }
}

export function createCollabRuntime(deps: CollabRuntimeDeps): CollabRuntime {
	const nodeId = deps.nodeId ?? process.env['HURIRO_NODE_ID'] ?? `node_${randomUUID().slice(0, 8)}`
	const leaseTtlMs = deps.leaseTtlMs ?? 30_000
	const leaseRenewMs = deps.leaseRenewMs ?? Math.max(500, Math.floor(leaseTtlMs / 3))
	const reauthIntervalMs = deps.reauthIntervalMs ?? 5 * 60_000

	const rooms = new Map<string, RoomLeaseState>()
	const pendingSockets = new Map<string, CollabWebSocketLike>()
	const activeConnections = new Map<string, ActiveCollabConnection>()
	let stopped = false
	let stopPromise: Promise<void> | null = null

	function updateRoomMetrics() {
		collabRoomsGauge.set(rooms.size)
		collabConnectionsGauge.set(activeConnections.size)
	}

	function stopRenewTimer(room: RoomLeaseState) {
		if (room.renewTimer) {
			clearInterval(room.renewTimer)
			room.renewTimer = null
		}
	}

	async function revokeConnectionsForWorkspace(
		workspaceId: string,
		targetUserId: string,
		reason: string
	): Promise<void> {
		for (const conn of [...activeConnections.values()]) {
			if (conn.workspaceId !== workspaceId) continue
			if (targetUserId !== '*' && conn.userId !== targetUserId) continue
			try {
				const access = await withWorkspace(
					deps.sql,
					{ workspaceId: conn.workspaceId, userId: conn.userId },
					async (tx) => {
						const actor = await resolveActor(tx, { workspaceId: conn.workspaceId, userId: conn.userId })
						return verifyLiveCollabSessionAccess(tx, actor, conn.pageId)
					}
				)
				if (!access.allowed) {
					conn.ws.close(4003, reason)
					activeConnections.delete(conn.socketId)
					continue
				}
				if (!access.canWrite && !conn.readOnly) {
					conn.readOnly = true
					const doc = hocuspocus.documents.get(`${conn.workspaceId}:${conn.pageId}`)
					if (doc) {
						for (const c of doc.getConnections()) {
							if (c.socketId === conn.socketId) {
								c.readOnly = true
							}
						}
					}
				}
			} catch {
				conn.ws.close(4003, reason)
				activeConnections.delete(conn.socketId)
			}
		}
		updateRoomMetrics()
	}

	const unsubscribePubSub = deps.pubsub
		? deps.pubsub.subscribe((ev) => {
				if (ev.type === 'revoke') {
					void revokeConnectionsForWorkspace(ev.workspaceId, ev.userId, ev.reason)
				}
			})
		: () => {}

	const reauthTimer = setInterval(() => {
		if (stopped) return
		for (const conn of [...activeConnections.values()]) {
			void withWorkspace(deps.sql, { workspaceId: conn.workspaceId, userId: conn.userId }, async (tx) => {
				const actor = await resolveActor(tx, { workspaceId: conn.workspaceId, userId: conn.userId })
				const access = await verifyLiveCollabSessionAccess(tx, actor, conn.pageId)
				if (!access.allowed) {
					conn.ws.close(4003, 'access_revoked')
					activeConnections.delete(conn.socketId)
					updateRoomMetrics()
					return
				}
				if (!access.canWrite && !conn.readOnly) {
					conn.readOnly = true
					const doc = hocuspocus.documents.get(`${conn.workspaceId}:${conn.pageId}`)
					if (doc) {
						for (const c of doc.getConnections()) {
							if (c.socketId === conn.socketId) c.readOnly = true
						}
					}
				}
			}).catch(() => {})
		}
	}, reauthIntervalMs)

	const hocuspocus = new Hocuspocus<CollabContext>({
		name: `huriro-collab-${nodeId}`,
		quiet: true,
		debounce: deps.debounceMs ?? 1500,
		maxDebounce: deps.maxDebounceMs ?? 8000,
		unloadImmediately: true,
		yDocOptions: { gc: true, gcFilter: () => true },

		async onAuthenticate(data) {
			if (stopped) throw new Error('server_shutting_down')
			const { workspaceId, pageId } = parseDocumentName(data.documentName)
			const reqUrl = new URL(data.request.url, 'http://localhost')
			if (reqUrl.searchParams.has('ticket') || reqUrl.searchParams.has('token')) {
				throw new Error('ticket_in_query_forbidden')
			}

			const token = data.token
			if (!token) throw new Error('collab_ticket_required')

			const claims = verifyCollabTicketSignature(deps.ticketSecret, token)
			if (!claims || claims.ws !== workspaceId || claims.page !== pageId) {
				throw new Error('collab_ticket_invalid')
			}

			const authRes = await withWorkspace(
				deps.sql,
				{ workspaceId: claims.ws, userId: claims.uid },
				async (tx) => {
					const actor = await resolveActor(tx, { workspaceId: claims.ws, userId: claims.uid })
					return consumeAndAuthorizeCollabTicket(tx, actor, claims, token)
				}
			)

			data.connectionConfig.readOnly = authRes.readOnly
			const socketLike = pendingSockets.get(data.socketId)
			if (socketLike) {
				pendingSockets.delete(data.socketId)
				activeConnections.set(data.socketId, {
					socketId: data.socketId,
					workspaceId,
					pageId,
					userId: claims.uid,
					ws: socketLike,
					readOnly: authRes.readOnly
				})
				updateRoomMetrics()
			}

			return {
				userId: claims.uid,
				workspaceId,
				pageId,
				permission: authRes.permission,
				readOnly: authRes.readOnly,
				socketId: data.socketId
			}
		},

		async onLoadDocument(data) {
			if (stopped) throw new Error('server_shutting_down')
			const { workspaceId, pageId } = parseDocumentName(data.documentName)
			const actorUserId =
				data.context?.userId && isUuid(data.context.userId) ? data.context.userId : undefined

			const acquired = await withWorkspace(
				deps.sql,
				actorUserId ? { workspaceId, userId: actorUserId } : { workspaceId },
				(tx) =>
					acquireCollabRoomAndState(tx, {
						workspaceId,
						pageId,
						nodeId,
						ttlMs: leaseTtlMs
					})
			)

			if (!acquired.acquired) {
				collabLeaseConflictsTotal.inc()
				throw new Error(`collab_lease_conflict: owned by ${acquired.ownerNodeId}`)
			}

			const existingRoom = rooms.get(data.documentName)
			if (existingRoom) {
				stopRenewTimer(existingRoom)
			}

			const roomState: RoomLeaseState = {
				workspaceId,
				pageId,
				epoch: acquired.epoch,
				authors: new Set(actorUserId ? [actorUserId] : []),
				renewTimer: null,
				leaseLost: false,
				lastByteSize: acquired.state.byteLength
			}

			roomState.renewTimer = setInterval(() => {
				if (stopped || roomState.leaseLost) return
				void withWorkspace(deps.sql, { workspaceId }, (tx) =>
					renewCollabRoomLease(tx, { workspaceId, pageId, nodeId, ttlMs: leaseTtlMs })
				)
					.then((res) => {
						if (!res.acquired || res.epoch !== roomState.epoch) {
							roomState.leaseLost = true
							stopRenewTimer(roomState)
							collabLeaseConflictsTotal.inc()
							hocuspocus.closeConnections(data.documentName)
						}
					})
					.catch(() => {})
			}, leaseRenewMs)

			rooms.set(data.documentName, roomState)
			updateRoomMetrics()

			// Load initial DB Yjs snapshot without marking the room dirty.
			Y.applyUpdate(data.document, acquired.state, 'huriro:load')
			collabStateBytesHistogram.observe(acquired.state.byteLength)
		},

		async beforeSync(data) {
			// Block oversized sync/update payloads before merging into room memory.
			if ((data.type === 1 || data.type === 2) && !data.connection.readOnly) {
				const room = rooms.get(data.documentName)
				if (data.payload.byteLength > DOCUMENT_SIZE_MAX_BYTES) {
					throw new Error('doc_too_large')
				}
				if (room && room.lastByteSize + data.payload.byteLength > DOCUMENT_SIZE_MAX_BYTES) {
					const testDoc = new Y.Doc()
					Y.applyUpdate(testDoc, Y.encodeStateAsUpdate(data.document))
					try {
						Y.applyUpdate(testDoc, data.payload)
					} catch {
						// Ignore malformed payload here; MessageReceiver validates below.
					}
					if (Y.encodeStateAsUpdate(testDoc).byteLength > DOCUMENT_SIZE_MAX_BYTES) {
						throw new Error('doc_too_large')
					}
				}
			}
		},

		async onChange(data) {
			if (data.transactionOrigin === 'huriro:load') return
			const room = rooms.get(data.documentName)
			if (!room) return
			const uid = data.context?.userId
			if (uid && isUuid(uid)) {
				room.authors.add(uid)
			}
			const approx = Y.encodeStateAsUpdate(data.document).byteLength
			room.lastByteSize = approx
		},

		async onStoreDocument(data) {
			const room = rooms.get(data.documentName)
			if (!room || room.leaseLost) return

			const startedAt = performance.now()
			const authors = [...room.authors].filter((id) => isUuid(id))
			const primaryActorId =
				data.lastContext?.userId && isUuid(data.lastContext.userId)
					? data.lastContext.userId
					: (authors[0] ?? null)

			const stateSize = Y.encodeStateAsUpdate(data.document).byteLength
			if (stateSize > DOCUMENT_SIZE_MAX_BYTES) {
				log.warn(
					{ workspaceId: room.workspaceId, pageId: room.pageId, stateSize },
					'skipping persistence: document exceeds 10 MB limit'
				)
				return
			}

			const res = await withWorkspace(
				deps.sql,
				primaryActorId
					? { workspaceId: room.workspaceId, userId: primaryActorId }
					: { workspaceId: room.workspaceId },
				(tx) =>
					persistCollabDocumentState(tx, {
						workspaceId: room.workspaceId,
						pageId: room.pageId,
						nodeId,
						leaseEpoch: room.epoch,
						ydoc: data.document,
						authorUserIds: authors,
						actorId: primaryActorId
					})
			)

			collabStoreDurationSeconds.observe((performance.now() - startedAt) / 1000)
			collabStateBytesHistogram.observe(stateSize)

			if (res.fenced) {
				room.leaseLost = true
				stopRenewTimer(room)
				collabLeaseConflictsTotal.inc()
				hocuspocus.closeConnections(data.documentName)
				return
			}

			room.lastByteSize = stateSize
			if (deps.pubsub && res.cursor !== null) {
				await deps.pubsub.publishCursor(room.workspaceId, res.cursor)
			}
		},

		async onDisconnect(data) {
			activeConnections.delete(data.socketId)
			pendingSockets.delete(data.socketId)
			updateRoomMetrics()
		},

		async afterUnloadDocument(data) {
			const room = rooms.get(data.documentName)
			if (!room) return
			stopRenewTimer(room)
			rooms.delete(data.documentName)
			updateRoomMetrics()

			if (!stopped && !room.leaseLost) {
				await withWorkspace(deps.sql, { workspaceId: room.workspaceId }, (tx) =>
					releaseCollabRoomLease(tx, {
						workspaceId: room.workspaceId,
						pageId: room.pageId,
						nodeId,
						epoch: room.epoch
					})
				).catch(() => {})
			}
		}
	})

	async function runDirectDocumentMutation(
		workspaceId: string,
		pageId: string,
		origin: string,
		actorId: string | null | undefined,
		mutate: (liveDoc: Y.Doc) => void
	): Promise<boolean> {
		const documentName = `${workspaceId}:${pageId}`
		const directCtx: CollabContext = {
			userId: actorId ?? '',
			workspaceId,
			pageId,
			permission: 'write',
			readOnly: false,
			socketId: `direct:${randomUUID()}`,
			internalDirect: true
		}
		const dc = await hocuspocus.openDirectConnection(documentName, directCtx)
		try {
			await dc.transact(mutate)
			const liveDoc = dc.document
			if (liveDoc) {
				await hocuspocus.storeDocumentHooks(
					liveDoc,
					{
						clientsCount: liveDoc.getConnectionsCount(),
						document: liveDoc,
						documentName,
						lastContext: directCtx,
						lastTransactionOrigin: origin,
						instance: hocuspocus
					},
					true
				)
			}
			await dc.disconnect({ unloadImmediately: true })
			return true
		} catch (err) {
			await dc.disconnect({ unloadImmediately: true }).catch(() => {})
			throw err
		}
	}

	const bridge: CollabDirectBridge = {
		isRoomLoaded(workspaceId, pageId) {
			return hocuspocus.documents.has(`${workspaceId}:${pageId}`)
		},

		async replaceDocument(workspaceId, pageId, snapshotState, origin, actorId) {
			const targetDoc = new Y.Doc()
			Y.applyUpdate(targetDoc, snapshotState)
			const targetJson = ydocToProseMirrorJson(targetDoc)
			return runDirectDocumentMutation(workspaceId, pageId, origin, actorId, (liveDoc) => {
				replaceYDocContent(liveDoc, targetJson, origin)
			})
		},

		async appendNodes(workspaceId, pageId, nodes, origin, actorId) {
			if (nodes.length === 0) return true
			return runDirectDocumentMutation(workspaceId, pageId, origin, actorId, (liveDoc) => {
				appendProseMirrorNodesToYDoc(liveDoc, nodes as unknown as Record<string, unknown>[], origin)
			})
		}
	}

	return {
		nodeId,
		bridge,
		handleConnection(ws, request) {
			const conn = hocuspocus.handleConnection(ws, request)
			const socketId = (conn as unknown as { socketId?: string }).socketId
			if (socketId) {
				pendingSockets.set(socketId, ws)
				const origHandleClose = conn.handleClose.bind(conn)
				conn.handleClose = (event) => {
					pendingSockets.delete(socketId)
					activeConnections.delete(socketId)
					updateRoomMetrics()
					return origHandleClose(event)
				}
			}
			return conn
		},
		getRoomLeaseEpoch(workspaceId, pageId) {
			return rooms.get(`${workspaceId}:${pageId}`)?.epoch ?? null
		},
		getActiveRoomCount() {
			return rooms.size
		},
		getActiveConnectionCount() {
			return activeConnections.size
		},
		async simulateCrashWithoutRelease() {
			// Test hook for simulating ungraceful crash while leaving lease row un-expired.
			stopped = true
			clearInterval(reauthTimer)
			unsubscribePubSub()
			for (const room of rooms.values()) {
				stopRenewTimer(room)
			}
			hocuspocus.closeConnections()
			rooms.clear()
			activeConnections.clear()
			pendingSockets.clear()
			updateRoomMetrics()
		},
		stop() {
			if (stopPromise) return stopPromise
			stopPromise = (async () => {
				stopped = true
				clearInterval(reauthTimer)
				unsubscribePubSub()

				// Flush every dirty document BEFORE closing connections so afterUnloadDocument
				// does not evict `rooms` entries prior to storeDocumentHooks completing.
				const leaseReleases: Array<{
					readonly workspaceId: string
					readonly pageId: string
					readonly epoch: number
				}> = []
				for (const [docName, doc] of hocuspocus.documents.entries()) {
					const room = rooms.get(docName)
					try {
						await hocuspocus.storeDocumentHooks(
							doc,
							{
								clientsCount: doc.getConnectionsCount(),
								document: doc,
								documentName: docName,
								lastContext: undefined,
								lastTransactionOrigin: 'huriro:shutdown',
								instance: hocuspocus
							},
							true
						)
					} catch (err) {
						log.warn({ err, docName }, 'failed to flush document on collab shutdown')
					}
					if (room) {
						stopRenewTimer(room)
						if (!room.leaseLost) {
							leaseReleases.push({
								workspaceId: room.workspaceId,
								pageId: room.pageId,
								epoch: room.epoch
							})
						}
						rooms.delete(docName)
					}
				}
				hocuspocus.closeConnections()
				hocuspocus.flushPendingStores()
				await Promise.allSettled([...hocuspocus.unloadingDocuments.values()])
				for (const doc of [...hocuspocus.documents.values()]) {
					await hocuspocus.unloadDocument(doc).catch(() => {})
				}
				for (const rel of leaseReleases) {
					await withWorkspace(deps.sql, { workspaceId: rel.workspaceId }, (tx) =>
						releaseCollabRoomLease(tx, {
							workspaceId: rel.workspaceId,
							pageId: rel.pageId,
							nodeId,
							epoch: rel.epoch
						})
					).catch(() => {})
				}
				await hocuspocus.hooks('onDestroy', { instance: hocuspocus }).catch(() => {})
				activeConnections.clear()
				pendingSockets.clear()
				updateRoomMetrics()
			})()
			return stopPromise
		}
	}
}
