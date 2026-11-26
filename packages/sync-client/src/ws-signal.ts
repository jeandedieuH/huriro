/**
 * Signal-plane WebSocket client (§9.4, §9.5) with 10 s degraded HTTP poll
 * fallback and BroadcastChannel cross-tab cursor notification.
 */
import type { WsClientMessage, WsServerMessage } from '@huriro/contracts'

const DEFAULT_HEARTBEAT_MS = 20_000

export interface WsSignalClientOptions {
	readonly workspaceId: string
	readonly wsUrl?: string | undefined
	readonly getCursor: () => number
	readonly getTicket?: (() => Promise<string | undefined>) | undefined
	readonly onCursorSignal: (cursor: number) => void
	readonly onChatSignal?: ((ev: { channelId: string; rev: number; lastMsgSeq: number }) => void) | undefined
	readonly onPresence?:
		| ((users: readonly { userId: string; status: 'online' | 'away'; lastSeenAt: number }[]) => void)
		| undefined
	readonly onTyping?: ((ev: { channelId: string; userId: string; until: number }) => void) | undefined
	readonly onRevokeSignal: (reason: string) => void
	readonly onPollFallback: () => void
	readonly onConnectionChange?: ((connected: boolean) => void) | undefined
	readonly onReconnect?: (() => void) | undefined
	readonly heartbeatTimeoutMs?: number | undefined
	readonly webSocketFactory?: ((url: string) => WebSocket) | undefined
	readonly pollIntervalMs?: number
}

export class WsSignalClient {
	private readonly opts: WsSignalClientOptions
	private socket: WebSocket | null = null
	private pollTimer: ReturnType<typeof setInterval> | null = null
	private reconnectTimer: ReturnType<typeof setTimeout> | null = null
	private heartbeatTimer: ReturnType<typeof setInterval> | null = null
	private channel: BroadcastChannel | null = null
	private stopped = false
	private reconnectAttempt = 0
	private isConnected = false
	private heartbeatMs = DEFAULT_HEARTBEAT_MS
	private lastActivityAt = 0
	private hasConnectedOnce = false
	private connectGeneration = 0

	constructor(opts: WsSignalClientOptions) {
		this.opts = opts
		if (typeof BroadcastChannel !== 'undefined') {
			try {
				this.channel = new BroadcastChannel(`huriro-sync:${opts.workspaceId}`)
				this.channel.onmessage = (ev) => {
					const data = ev.data as {
						t?: string
						cursor?: number
						reason?: string
						channelId?: string
						rev?: number
						lastMsgSeq?: number
					} | null
					if (!data) return
					if (data.t === 'cursor' && typeof data.cursor === 'number') {
						this.opts.onCursorSignal(data.cursor)
					} else if (
						data.t === 'chat' &&
						typeof data.channelId === 'string' &&
						typeof data.rev === 'number' &&
						typeof data.lastMsgSeq === 'number'
					) {
						this.opts.onChatSignal?.({
							channelId: data.channelId,
							rev: data.rev,
							lastMsgSeq: data.lastMsgSeq
						})
					} else if (data.t === 'revoke' && typeof data.reason === 'string') {
						this.opts.onRevokeSignal(data.reason)
					}
				}
			} catch {
				this.channel = null
			}
		}
	}

	start(): void {
		this.stopped = false
		this.startPollLoop()
		if (this.opts.wsUrl && (this.opts.webSocketFactory || typeof WebSocket !== 'undefined')) {
			void this.connect()
		}
	}

	stop(): void {
		this.stopped = true
		this.connectGeneration += 1
		this.stopHeartbeatWatchdog()
		if (this.pollTimer) {
			clearInterval(this.pollTimer)
			this.pollTimer = null
		}
		if (this.reconnectTimer) {
			clearTimeout(this.reconnectTimer)
			this.reconnectTimer = null
		}
		if (this.socket) {
			try {
				this.socket.close(1000, 'client_stop')
			} catch {
				// Ignore close failures
			}
			this.socket = null
		}
		if (this.channel) {
			this.channel.close()
			this.channel = null
		}
		this.setConnected(false)
	}

	/** Verify socket liveness on wake/focus; replace closed or silent zombie sockets immediately. */
	ensureAlive(): void {
		if (this.stopped || !this.opts.wsUrl) return
		if (!this.opts.webSocketFactory && typeof WebSocket === 'undefined') return
		const rs = this.socket?.readyState
		if (!this.socket || rs === 2 || rs === 3) {
			if (this.reconnectTimer) {
				clearTimeout(this.reconnectTimer)
				this.reconnectTimer = null
			}
			this.reconnectAttempt = 0
			void this.connect()
			return
		}
		if (
			rs === 1 &&
			this.lastActivityAt > 0 &&
			Date.now() - this.lastActivityAt > this.getHeartbeatTimeoutMs()
		) {
			this.forceReconnect('stale_on_resume')
		}
	}

	broadcastCursor(cursor: number): void {
		this.channel?.postMessage({ t: 'cursor', cursor })
	}

	sendPresence(status: 'online' | 'away'): void {
		const openState = typeof WebSocket !== 'undefined' ? WebSocket.OPEN : 1
		if (this.socket?.readyState === openState) {
			this.socket.send(JSON.stringify({ t: 'presence', status } satisfies WsClientMessage))
		}
	}

	sendTyping(channelId: string): void {
		const openState = typeof WebSocket !== 'undefined' ? WebSocket.OPEN : 1
		if (this.socket?.readyState === openState) {
			this.socket.send(JSON.stringify({ t: 'typing', channelId } satisfies WsClientMessage))
		}
	}

	private setConnected(next: boolean): void {
		if (this.isConnected === next) return
		this.isConnected = next
		this.opts.onConnectionChange?.(next)
	}

	private getHeartbeatTimeoutMs(): number {
		return this.opts.heartbeatTimeoutMs ?? Math.round(this.heartbeatMs * 2.5)
	}

	private stopHeartbeatWatchdog(): void {
		if (this.heartbeatTimer) {
			clearInterval(this.heartbeatTimer)
			this.heartbeatTimer = null
		}
	}

	private startHeartbeatWatchdog(): void {
		this.stopHeartbeatWatchdog()
		const timeoutMs = this.getHeartbeatTimeoutMs()
		const intervalMs = Math.max(25, Math.min(5_000, Math.floor(timeoutMs / 2)))
		this.heartbeatTimer = setInterval(() => {
			if (
				!this.stopped &&
				this.socket &&
				this.isConnected &&
				this.lastActivityAt > 0 &&
				Date.now() - this.lastActivityAt > timeoutMs
			) {
				this.forceReconnect('heartbeat_timeout')
			}
		}, intervalMs)
	}

	private forceReconnect(reason: string): void {
		this.connectGeneration += 1
		this.stopHeartbeatWatchdog()
		if (this.reconnectTimer) {
			clearTimeout(this.reconnectTimer)
			this.reconnectTimer = null
		}
		const stale = this.socket
		this.socket = null
		this.setConnected(false)
		if (stale) {
			try {
				stale.close(4000, reason)
			} catch {
				// Ignore close failures on half-open sockets
			}
		}
		if (!this.stopped) {
			this.reconnectAttempt = 0
			void this.connect()
		}
	}

	private startPollLoop(): void {
		if (this.pollTimer) return
		const intervalMs = this.opts.pollIntervalMs ?? 10_000
		this.pollTimer = setInterval(() => {
			if (!this.isConnected && !this.stopped) {
				this.opts.onPollFallback()
			}
		}, intervalMs)
	}

	private async connect(): Promise<void> {
		if (this.stopped || !this.opts.wsUrl) return
		const gen = ++this.connectGeneration
		let ticket: string | undefined
		if (this.opts.getTicket) {
			try {
				ticket = await this.opts.getTicket()
			} catch {
				if (!this.stopped && gen === this.connectGeneration) {
					this.scheduleReconnect()
				}
				return
			}
		}
		if (this.stopped || gen !== this.connectGeneration) return

		const ws = this.opts.webSocketFactory
			? this.opts.webSocketFactory(this.opts.wsUrl)
			: new WebSocket(this.opts.wsUrl)
		this.socket = ws

		ws.onopen = () => {
			if (this.socket !== ws) return
			this.lastActivityAt = Date.now()
			const hello: WsClientMessage = {
				t: 'hello',
				workspaceId: this.opts.workspaceId,
				cursors: { workspace: this.opts.getCursor() },
				...(ticket ? { ticket } : {})
			}
			ws.send(JSON.stringify(hello))
		}

		ws.onmessage = (ev) => {
			if (this.socket !== ws) return
			this.lastActivityAt = Date.now()
			try {
				const msg = JSON.parse(String(ev.data)) as WsServerMessage
				if (msg.t === 'ready') {
					const wasReconnect = this.hasConnectedOnce
					this.hasConnectedOnce = true
					if (
						typeof msg.heartbeatMs === 'number' &&
						Number.isFinite(msg.heartbeatMs) &&
						msg.heartbeatMs > 0
					) {
						this.heartbeatMs = msg.heartbeatMs
					}
					this.reconnectAttempt = 0
					this.setConnected(true)
					this.startHeartbeatWatchdog()
					if (msg.serverCursor > this.opts.getCursor()) {
						this.opts.onCursorSignal(msg.serverCursor)
					}
					if (wasReconnect) {
						this.opts.onReconnect?.()
					}
				} else if (msg.t === 'cursor') {
					this.channel?.postMessage({ t: 'cursor', cursor: msg.cursor })
					this.opts.onCursorSignal(msg.cursor)
				} else if (msg.t === 'chat') {
					this.channel?.postMessage({
						t: 'chat',
						channelId: msg.channelId,
						rev: msg.rev,
						lastMsgSeq: msg.lastMsgSeq
					})
					this.opts.onChatSignal?.({
						channelId: msg.channelId,
						rev: msg.rev,
						lastMsgSeq: msg.lastMsgSeq
					})
				} else if (msg.t === 'presence') {
					this.opts.onPresence?.(msg.users)
				} else if (msg.t === 'typing') {
					this.opts.onTyping?.({
						channelId: msg.channelId,
						userId: msg.userId,
						until: msg.until
					})
				} else if (msg.t === 'ping') {
					ws.send(JSON.stringify({ t: 'pong' } satisfies WsClientMessage))
				} else if (msg.t === 'revoke') {
					this.channel?.postMessage({ t: 'revoke', reason: msg.reason })
					this.opts.onRevokeSignal(msg.reason)
				}
			} catch {
				// Ignore malformed socket message
			}
		}

		ws.onclose = () => {
			if (this.socket !== ws) return
			this.socket = null
			this.stopHeartbeatWatchdog()
			this.setConnected(false)
			if (!this.stopped) {
				this.scheduleReconnect()
			}
		}

		ws.onerror = () => {
			if (this.socket !== ws) return
			this.setConnected(false)
		}
	}

	private scheduleReconnect(): void {
		if (this.stopped || this.reconnectTimer) return
		const base = Math.min(30_000, 500 * 2 ** this.reconnectAttempt)
		const jitter = Math.floor(Math.random() * 250)
		this.reconnectAttempt += 1
		this.reconnectTimer = setTimeout(() => {
			this.reconnectTimer = null
			void this.connect()
		}, base + jitter)
	}
}
