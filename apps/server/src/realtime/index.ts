/**
 * Signal-plane WebSocket server (§9.4, §12.9).
 *
 * Carries opaque cursor signals only — NEVER domain payloads.
 * Supports:
 *   - Web first-party session cookie + Origin allowlist check
 *   - Mobile/desktop/API single-use ticket via POST /api/v1/realtime/ticket
 *   - 250 ms coalesced (1 s max-wait) cursor fan-out per workspace
 *   - Immediate socket termination (4003) on membership/ACL revocation
 *   - 60 messages/min per-socket token bucket rate limit
 *   - 20 s heartbeat ping/pong + 5 min periodic re-authorization check
 */
import type { WsClientMessage, WsPresenceUser, WsServerMessage } from '@huriro/contracts'
import { isUuid, type Sql, withWorkspace } from '@huriro/db'
import type { ServerWebSocket } from 'bun'
import { log } from '../api/observability'
import { canUserAccessChannel } from '../modules/chat'
import { type Auth, requireSession } from '../modules/identity'
import { verifyAndConsumeRealtimeTicket } from '../modules/sync'
import { resolveActor } from '../modules/tenancy'
import type { CollabRuntime } from './collab'
import { InProcessPubSub, type RealtimePubSub } from './pubsub'

export { type CollabRuntime, type CollabRuntimeDeps, createCollabRuntime } from './collab'

export interface RealtimeDeps {
	readonly port: number
	readonly sql?: Sql
	readonly auth?: Auth | null
	readonly pubsub?: RealtimePubSub
	readonly collab?: CollabRuntime
	readonly allowedOrigins?: readonly string[]
	readonly coalesceMs?: number
	readonly maxCoalesceMs?: number
}

interface SignalSocketData {
	readonly kind: 'signal'
	cookieUserId: string | null
	userId: string | null
	workspaceId: string | null
	authenticated: boolean
	msgTokens: number
	lastRefillAt: number
	handshakeTimer: ReturnType<typeof setTimeout> | null
}

interface CollabSocketData {
	readonly kind: 'collab'
	readonly request: Request
	clientConnection: ReturnType<CollabRuntime['handleConnection']> | null
}

type SocketData = SignalSocketData | CollabSocketData

interface CoalesceEntry {
	latest: number
	firstAt: number
	timer: ReturnType<typeof setTimeout>
}

const MAX_TOKENS = 60
const REFILL_WINDOW_MS = 60_000
const HEARTBEAT_MS = 20_000
const REAUTH_INTERVAL_MS = 5 * 60_000

function sendMsg(ws: ServerWebSocket<SocketData>, msg: WsServerMessage): void {
	try {
		ws.send(JSON.stringify(msg))
	} catch {
		// Socket closed mid-send; close handler cleans up.
	}
}

export function startRealtime(portOrDeps: number | RealtimeDeps): { stop(): Promise<void>; port: number } {
	const deps: RealtimeDeps = typeof portOrDeps === 'number' ? { port: portOrDeps } : portOrDeps
	const pubsub = deps.pubsub ?? new InProcessPubSub()
	const coalesceMs = deps.coalesceMs ?? 250
	const maxCoalesceMs = deps.maxCoalesceMs ?? 1_000
	const allowedOrigins = deps.allowedOrigins ?? []

	const workspaceSockets = new Map<string, Set<ServerWebSocket<SocketData>>>()
	const pendingCursors = new Map<string, CoalesceEntry>()
	// Ephemeral presence & typing state (never written to Postgres per §15.1).
	const workspacePresence = new Map<string, Map<string, { status: 'online' | 'away'; lastSeenAt: number }>>()
	const typingThrottle = new Map<string, number>()

	function broadcastPresence(workspaceId: string) {
		const map = workspacePresence.get(workspaceId)
		const users: WsPresenceUser[] = map
			? [...map.entries()].map(([userId, state]) => ({
					userId,
					status: state.status,
					lastSeenAt: state.lastSeenAt
				}))
			: []
		const payload = JSON.stringify({ t: 'presence', users } satisfies WsServerMessage)
		const set = workspaceSockets.get(workspaceId)
		if (!set) return
		for (const ws of set) {
			if (ws.data.kind === 'signal' && ws.data.authenticated) {
				try {
					ws.send(payload)
				} catch {
					// Ignore closed sockets
				}
			}
		}
	}

	function setUserPresence(workspaceId: string, userId: string, status: 'online' | 'away') {
		let map = workspacePresence.get(workspaceId)
		if (!map) {
			map = new Map()
			workspacePresence.set(workspaceId, map)
		}
		map.set(userId, { status, lastSeenAt: Date.now() })
		broadcastPresence(workspaceId)
	}

	function addSocket(workspaceId: string, ws: ServerWebSocket<SocketData>) {
		let set = workspaceSockets.get(workspaceId)
		if (!set) {
			set = new Set()
			workspaceSockets.set(workspaceId, set)
		}
		set.add(ws)
	}

	function removeSocket(ws: ServerWebSocket<SocketData>) {
		if (ws.data.kind !== 'signal') return
		if (ws.data.handshakeTimer) {
			clearTimeout(ws.data.handshakeTimer)
			ws.data.handshakeTimer = null
		}
		const wsId = ws.data.workspaceId
		const userId = ws.data.userId
		if (!wsId) return
		const set = workspaceSockets.get(wsId)
		if (!set) return
		set.delete(ws)
		if (set.size === 0) workspaceSockets.delete(wsId)

		if (userId) {
			const stillConnected = [...(set ?? [])].some(
				(s) => s.data.kind === 'signal' && s.data.authenticated && s.data.userId === userId
			)
			if (!stillConnected) {
				const pres = workspacePresence.get(wsId)
				if (pres?.delete(userId)) {
					if (pres.size === 0) workspacePresence.delete(wsId)
					broadcastPresence(wsId)
				}
			}
		}
	}

	function flushCursor(workspaceId: string) {
		const entry = pendingCursors.get(workspaceId)
		if (!entry) return
		clearTimeout(entry.timer)
		pendingCursors.delete(workspaceId)

		const set = workspaceSockets.get(workspaceId)
		if (!set || set.size === 0) return
		const payload = JSON.stringify({ t: 'cursor', cursor: entry.latest } satisfies WsServerMessage)
		for (const ws of set) {
			if (ws.data.kind === 'signal' && ws.data.authenticated) {
				try {
					ws.send(payload)
				} catch {
					// Ignore closed sockets
				}
			}
		}
	}

	function scheduleCursor(workspaceId: string, cursor: number) {
		const now = Date.now()
		const existing = pendingCursors.get(workspaceId)
		if (existing) {
			existing.latest = Math.max(existing.latest, cursor)
			const elapsed = now - existing.firstAt
			if (elapsed >= maxCoalesceMs) {
				flushCursor(workspaceId)
				return
			}
			clearTimeout(existing.timer)
			const wait = Math.min(coalesceMs, maxCoalesceMs - elapsed)
			existing.timer = setTimeout(() => flushCursor(workspaceId), wait)
			return
		}
		const timer = setTimeout(() => flushCursor(workspaceId), coalesceMs)
		pendingCursors.set(workspaceId, { latest: cursor, firstAt: now, timer })
	}

	function revokeUserSockets(workspaceId: string, userId: string, reason: string) {
		const set = workspaceSockets.get(workspaceId)
		if (!set) return
		for (const ws of [...set]) {
			if (ws.data.kind === 'signal' && ws.data.userId === userId) {
				sendMsg(ws, { t: 'revoke', reason })
				ws.close(4003, reason)
				set.delete(ws)
			}
		}
		if (set.size === 0) workspaceSockets.delete(workspaceId)
	}

	async function filterAuthorizedChannelSockets(
		workspaceId: string,
		channelId: string,
		sockets: ServerWebSocket<SocketData>[]
	): Promise<ServerWebSocket<SocketData>[]> {
		if (!deps.sql || !isUuid(channelId)) return []
		const db = deps.sql
		const byUser = new Map<string, ServerWebSocket<SocketData>[]>()
		for (const ws of sockets) {
			if (ws.data.kind !== 'signal' || !ws.data.authenticated || !ws.data.userId) continue
			const list = byUser.get(ws.data.userId) ?? []
			list.push(ws)
			byUser.set(ws.data.userId, list)
		}
		const allowed: ServerWebSocket<SocketData>[] = []
		await Promise.all(
			[...byUser.entries()].map(async ([userId, userSockets]) => {
				try {
					const ok = await withWorkspace(db, { workspaceId, userId }, async (tx) => {
						const actor = await resolveActor(tx, { workspaceId, userId })
						return canUserAccessChannel(tx, actor, channelId)
					})
					if (ok) allowed.push(...userSockets)
				} catch {
					// Fail closed: skip sockets that fail authorization
				}
			})
		)
		return allowed
	}

	async function fanOutChatSignal(ev: {
		readonly workspaceId: string
		readonly channelId: string
		readonly rev: number
		readonly lastMsgSeq: number
	}) {
		const set = workspaceSockets.get(ev.workspaceId)
		if (!set || set.size === 0) return
		const authorized = await filterAuthorizedChannelSockets(ev.workspaceId, ev.channelId, [...set])
		if (authorized.length === 0) return
		const payload = JSON.stringify({
			t: 'chat',
			channelId: ev.channelId,
			rev: ev.rev,
			lastMsgSeq: ev.lastMsgSeq
		} satisfies WsServerMessage)
		for (const ws of authorized) {
			try {
				ws.send(payload)
			} catch {
				// Ignore closed socket
			}
		}
	}

	const unsubscribe = pubsub.subscribe((ev) => {
		if (ev.type === 'cursor') {
			scheduleCursor(ev.workspaceId, ev.cursor)
		} else if (ev.type === 'chat') {
			void fanOutChatSignal(ev)
		} else if (ev.type === 'revoke') {
			revokeUserSockets(ev.workspaceId, ev.userId, ev.reason)
		}
	})

	async function handleHello(ws: ServerWebSocket<SocketData>, msg: Extract<WsClientMessage, { t: 'hello' }>) {
		if (ws.data.kind !== 'signal') return
		if (!deps.sql) {
			sendMsg(ws, { t: 'error', code: 'not_implemented', message: 'Database unavailable' })
			ws.close(1011, 'no_db')
			return
		}
		if (!isUuid(msg.workspaceId)) {
			sendMsg(ws, { t: 'error', code: 'workspace_required', message: 'Valid workspaceId is required' })
			ws.close(4000, 'invalid_workspace')
			return
		}

		let resolvedUserId: string | null = ws.data.cookieUserId
		if (msg.ticket) {
			const ticket = msg.ticket
			const consumed = await withWorkspace(deps.sql, { workspaceId: msg.workspaceId }, (tx) =>
				verifyAndConsumeRealtimeTicket(tx, msg.workspaceId, ticket)
			)
			if (!consumed) {
				sendMsg(ws, { t: 'error', code: 'unauthorized', message: 'Invalid or expired ticket' })
				ws.close(4001, 'invalid_ticket')
				return
			}
			resolvedUserId = consumed.userId
		}

		if (!resolvedUserId) {
			sendMsg(ws, { t: 'error', code: 'unauthorized', message: 'Authentication required' })
			ws.close(4001, 'unauthorized')
			return
		}

		const userIdForQuery = resolvedUserId
		const { active, serverCursor } = await withWorkspace(
			deps.sql,
			{ workspaceId: msg.workspaceId, userId: userIdForQuery },
			async (tx) => {
				const actor = await resolveActor(tx, {
					workspaceId: msg.workspaceId,
					userId: userIdForQuery
				})
				const [seq] = await tx<{ lastCursor: string | number }[]>`
					SELECT last_cursor AS "lastCursor" FROM workspace_seq WHERE workspace_id = ${msg.workspaceId}
				`
				return {
					active: actor.membership === 'active',
					serverCursor: seq ? Number(seq.lastCursor) : 0
				}
			}
		)

		if (!active) {
			sendMsg(ws, { t: 'error', code: 'forbidden', message: 'Not an active workspace member' })
			ws.close(4003, 'not_member')
			return
		}

		if (ws.data.handshakeTimer) {
			clearTimeout(ws.data.handshakeTimer)
			ws.data.handshakeTimer = null
		}
		ws.data.userId = userIdForQuery
		ws.data.workspaceId = msg.workspaceId
		ws.data.authenticated = true
		addSocket(msg.workspaceId, ws)
		setUserPresence(msg.workspaceId, userIdForQuery, 'online')

		sendMsg(ws, {
			t: 'ready',
			serverCursor,
			heartbeatMs: HEARTBEAT_MS
		})
	}

	const heartbeatInterval = setInterval(() => {
		const ping = JSON.stringify({ t: 'ping' } satisfies WsServerMessage)
		for (const set of workspaceSockets.values()) {
			for (const ws of set) {
				if (ws.data.kind === 'signal' && ws.data.authenticated) {
					try {
						ws.send(ping)
					} catch {
						// Ignore closed sockets
					}
				}
			}
		}
	}, HEARTBEAT_MS)

	const reauthInterval = setInterval(() => {
		if (!deps.sql) return
		const db = deps.sql
		for (const [wsId, set] of workspaceSockets.entries()) {
			for (const ws of [...set]) {
				if (ws.data.kind !== 'signal') continue
				const userId = ws.data.userId
				if (!ws.data.authenticated || !userId) continue
				void withWorkspace(db, { workspaceId: wsId, userId }, async (tx) => {
					const actor = await resolveActor(tx, { workspaceId: wsId, userId })
					if (actor.membership !== 'active') {
						revokeUserSockets(wsId, userId, 'membership_revoked')
					}
				}).catch(() => {})
			}
		}
	}, REAUTH_INTERVAL_MS)

	const server = Bun.serve<SocketData>({
		port: deps.port,
		async fetch(req, srv) {
			const url = new URL(req.url)
			if (url.pathname === '/healthz') {
				return Response.json({ status: 'ok', role: 'realtime' })
			}
			if (url.pathname === '/ws') {
				if (!deps.sql) {
					return new Response('Realtime signal server requires database configuration.', { status: 501 })
				}
				const origin = req.headers.get('origin')
				if (
					origin &&
					allowedOrigins.length > 0 &&
					!allowedOrigins.includes(origin) &&
					origin !== url.origin
				) {
					return new Response('Forbidden origin', { status: 403 })
				}

				let cookieUserId: string | null = null
				if (deps.auth && req.headers.has('cookie')) {
					try {
						const session = await requireSession(deps.auth, req)
						cookieUserId = session.userId
					} catch {
						cookieUserId = null
					}
				}

				const upgraded = srv.upgrade(req, {
					data: {
						kind: 'signal',
						cookieUserId,
						userId: null,
						workspaceId: null,
						authenticated: false,
						msgTokens: MAX_TOKENS,
						lastRefillAt: Date.now(),
						handshakeTimer: null
					}
				})
				return upgraded ? undefined : new Response('WebSocket upgrade failed', { status: 400 })
			}
			if (url.pathname === '/collab') {
				if (!deps.collab) {
					return new Response('Collaborative editor runtime not configured.', { status: 501 })
				}
				const origin = req.headers.get('origin')
				if (
					origin &&
					allowedOrigins.length > 0 &&
					!allowedOrigins.includes(origin) &&
					origin !== url.origin
				) {
					return new Response('Forbidden origin', { status: 403 })
				}
				if (url.searchParams.has('ticket') || url.searchParams.has('token')) {
					return new Response('Ticket must not be sent in query string', { status: 400 })
				}
				const upgraded = srv.upgrade(req, {
					data: {
						kind: 'collab',
						request: req,
						clientConnection: null
					}
				})
				return upgraded ? undefined : new Response('WebSocket upgrade failed', { status: 400 })
			}
			return new Response('Not found', { status: 404 })
		},
		websocket: {
			open(ws) {
				if (ws.data.kind === 'collab') {
					const collab = deps.collab
					if (!collab) {
						ws.close(1011, 'collab_unconfigured')
						return
					}
					const wsLike = {
						get readyState() {
							return ws.readyState
						},
						send(data: string | ArrayBufferLike | Blob | ArrayBufferView) {
							try {
								if (ws.readyState === 1) {
									ws.send(data as Parameters<ServerWebSocket<SocketData>['send']>[0])
								}
							} catch {
								// Socket closed mid-send.
							}
						},
						close(code?: number, reason?: string) {
							try {
								ws.close(code, reason)
							} catch {
								// Socket already closed.
							}
						}
					}
					ws.data.clientConnection = collab.handleConnection(wsLike, ws.data.request)
					return
				}

				ws.data.handshakeTimer = setTimeout(() => {
					if (ws.data.kind === 'signal' && !ws.data.authenticated) {
						ws.close(4008, 'handshake_timeout')
					}
				}, 10_000)
			},
			async message(ws, raw) {
				if (ws.data.kind === 'collab') {
					const bytes =
						typeof raw === 'string' ? new Uint8Array(Buffer.from(raw, 'utf8')) : new Uint8Array(raw)
					ws.data.clientConnection?.handleMessage(bytes)
					return
				}

				// Per-socket 60/min rate limit (§12.9).
				const now = Date.now()
				const elapsed = now - ws.data.lastRefillAt
				if (elapsed >= REFILL_WINDOW_MS) {
					ws.data.msgTokens = MAX_TOKENS
					ws.data.lastRefillAt = now
				}
				if (ws.data.msgTokens <= 0) {
					sendMsg(ws, { t: 'error', code: 'rate_limited', message: 'Too many socket messages' })
					ws.close(4029, 'rate_limited')
					return
				}
				ws.data.msgTokens -= 1

				const text = typeof raw === 'string' ? raw : Buffer.from(raw).toString('utf8')
				let msg: WsClientMessage
				try {
					msg = JSON.parse(text) as WsClientMessage
				} catch {
					sendMsg(ws, { t: 'error', code: 'validation_failed', message: 'Invalid JSON message' })
					return
				}

				if (msg.t === 'pong') return
				if (msg.t === 'hello') {
					await handleHello(ws, msg)
					return
				}
				if (!ws.data.authenticated || !ws.data.workspaceId || !ws.data.userId) {
					return
				}
				if (msg.t === 'presence') {
					if (msg.status === 'online' || msg.status === 'away') {
						setUserPresence(ws.data.workspaceId, ws.data.userId, msg.status)
					}
					return
				}
				if (msg.t === 'typing' && isUuid(msg.channelId) && deps.sql) {
					const throttleKey = `${ws.data.workspaceId}:${msg.channelId}:${ws.data.userId}`
					const lastTyping = typingThrottle.get(throttleKey) ?? 0
					if (now - lastTyping < 2_500) return
					typingThrottle.set(throttleKey, now)

					const senderId = ws.data.userId
					const wsId = ws.data.workspaceId
					const okSender = await withWorkspace(
						deps.sql,
						{ workspaceId: wsId, userId: senderId },
						async (tx) => {
							const actor = await resolveActor(tx, { workspaceId: wsId, userId: senderId })
							return canUserAccessChannel(tx, actor, msg.channelId)
						}
					).catch(() => false)
					if (!okSender) return

					const set = workspaceSockets.get(wsId)
					if (!set) return
					const peers = await filterAuthorizedChannelSockets(wsId, msg.channelId, [...set])
					const typingPayload = JSON.stringify({
						t: 'typing',
						channelId: msg.channelId,
						userId: senderId,
						until: now + 5_000
					} satisfies WsServerMessage)
					for (const peer of peers) {
						if (peer.data.kind === 'signal' && peer.data.userId !== senderId) {
							try {
								peer.send(typingPayload)
							} catch {
								// Ignore closed socket
							}
						}
					}
				}
			},
			pong(ws) {
				if (ws.data.kind === 'collab') {
					ws.data.clientConnection?.touch()
				}
			},
			close(ws, code, reason) {
				if (ws.data.kind === 'collab') {
					ws.data.clientConnection?.handleClose({ code, reason })
					return
				}
				removeSocket(ws)
			}
		}
	})

	log.info({ port: server.port }, 'realtime signal + collab server listening')
	return {
		port: server.port ?? deps.port,
		stop: async () => {
			clearInterval(heartbeatInterval)
			clearInterval(reauthInterval)
			for (const entry of pendingCursors.values()) clearTimeout(entry.timer)
			pendingCursors.clear()
			unsubscribe()
			if (deps.collab) {
				await deps.collab.stop()
			}
			server.stop(true)
		}
	}
}
