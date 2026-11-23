/**
 * Signal-plane WebSocket client (§9.4, §9.5) with 10 s degraded HTTP poll
 * fallback and BroadcastChannel cross-tab cursor notification.
 */
import type { WsClientMessage, WsServerMessage } from '@huriro/contracts'

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
	readonly pollIntervalMs?: number
}

export class WsSignalClient {
	private readonly opts: WsSignalClientOptions
	private socket: WebSocket | null = null
	private pollTimer: ReturnType<typeof setInterval> | null = null
	private reconnectTimer: ReturnType<typeof setTimeout> | null = null
	private channel: BroadcastChannel | null = null
	private stopped = false
	private reconnectAttempt = 0
	private isConnected = false

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
		if (this.opts.wsUrl && typeof WebSocket !== 'undefined') {
			void this.connect()
		}
	}

	stop(): void {
		this.stopped = true
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

	broadcastCursor(cursor: number): void {
		this.channel?.postMessage({ t: 'cursor', cursor })
	}

	sendPresence(status: 'online' | 'away'): void {
		if (this.socket?.readyState === WebSocket.OPEN) {
			this.socket.send(JSON.stringify({ t: 'presence', status } satisfies WsClientMessage))
		}
	}

	sendTyping(channelId: string): void {
		if (this.socket?.readyState === WebSocket.OPEN) {
			this.socket.send(JSON.stringify({ t: 'typing', channelId } satisfies WsClientMessage))
		}
	}

	private setConnected(next: boolean): void {
		if (this.isConnected === next) return
		this.isConnected = next
		this.opts.onConnectionChange?.(next)
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
		let ticket: string | undefined
		if (this.opts.getTicket) {
			try {
				ticket = await this.opts.getTicket()
			} catch {
				this.scheduleReconnect()
				return
			}
		}
		if (this.stopped) return

		const ws = new WebSocket(this.opts.wsUrl)
		this.socket = ws

		ws.onopen = () => {
			const hello: WsClientMessage = {
				t: 'hello',
				workspaceId: this.opts.workspaceId,
				cursors: { workspace: this.opts.getCursor() },
				...(ticket ? { ticket } : {})
			}
			ws.send(JSON.stringify(hello))
		}

		ws.onmessage = (ev) => {
			try {
				const msg = JSON.parse(String(ev.data)) as WsServerMessage
				if (msg.t === 'ready') {
					this.reconnectAttempt = 0
					this.setConnected(true)
					if (msg.serverCursor > this.opts.getCursor()) {
						this.opts.onCursorSignal(msg.serverCursor)
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
			if (this.socket === ws) this.socket = null
			this.setConnected(false)
			if (!this.stopped) {
				this.scheduleReconnect()
			}
		}

		ws.onerror = () => {
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
