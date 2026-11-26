/**
 * Realtime signal pub/sub abstraction (§9.4, §15.1, §15.2, §19.4 M6 HA).
 *
 * Signals carry ONLY opaque pointers (`{ workspaceId, cursor }`, `{ workspaceId, channelId, rev, lastMsgSeq }`,
 * `{ workspaceId, userId, reason }`, or ephemeral presence/typing hints) — never domain payloads.
 * - `InProcessPubSub`: zero-latency single-process fan-out (`--role=all` and tests).
 * - `PostgresNotifyPubSub`: multi-process fan-out over a dedicated LISTEN/NOTIFY session connection.
 * - `ValkeyPubSub`: zero-dependency RESP2 pub/sub client for multi-node realtime HA (`VALKEY_URL`).
 * - `ResilientPubSub`: uses `ValkeyPubSub` when healthy and fails over to fallback pubsub on outage.
 */
import net from 'node:net'
import tls from 'node:tls'
import type { Sql } from '@huriro/db'
import { log } from '../api/observability'

export type PubSubEvent =
	| { readonly type: 'cursor'; readonly workspaceId: string; readonly cursor: number }
	| {
			readonly type: 'chat'
			readonly workspaceId: string
			readonly channelId: string
			readonly rev: number
			readonly lastMsgSeq: number
	  }
	| {
			readonly type: 'revoke'
			readonly workspaceId: string
			readonly userId: string
			readonly reason: string
	  }
	| {
			readonly type: 'presence'
			readonly workspaceId: string
			readonly userId: string
			readonly status: 'online' | 'away' | 'offline'
			readonly lastSeenAt: number
			readonly originId?: string | undefined
	  }
	| {
			readonly type: 'typing'
			readonly workspaceId: string
			readonly channelId: string
			readonly userId: string
			readonly until: number
			readonly originId?: string | undefined
	  }

export type PubSubHandler = (event: PubSubEvent) => void

export interface RealtimePubSub {
	publishCursor(workspaceId: string, cursor: number): Promise<void>
	publishChat(workspaceId: string, channelId: string, rev: number, lastMsgSeq: number): Promise<void>
	publishRevoke(workspaceId: string, userId: string, reason: string): Promise<void>
	publishPresence?(
		workspaceId: string,
		userId: string,
		status: 'online' | 'away' | 'offline',
		lastSeenAt: number,
		originId?: string
	): Promise<void>
	publishTyping?(
		workspaceId: string,
		channelId: string,
		userId: string,
		until: number,
		originId?: string
	): Promise<void>
	subscribe(handler: PubSubHandler): () => void
	close(): Promise<void>
	isReady?(): boolean
}

export class InProcessPubSub implements RealtimePubSub {
	private readonly handlers = new Set<PubSubHandler>()

	async publishCursor(workspaceId: string, cursor: number): Promise<void> {
		const ev: PubSubEvent = { type: 'cursor', workspaceId, cursor }
		for (const h of this.handlers) h(ev)
	}

	async publishChat(workspaceId: string, channelId: string, rev: number, lastMsgSeq: number): Promise<void> {
		const ev: PubSubEvent = { type: 'chat', workspaceId, channelId, rev, lastMsgSeq }
		for (const h of this.handlers) h(ev)
	}

	async publishRevoke(workspaceId: string, userId: string, reason: string): Promise<void> {
		const ev: PubSubEvent = { type: 'revoke', workspaceId, userId, reason }
		for (const h of this.handlers) h(ev)
	}

	async publishPresence(
		workspaceId: string,
		userId: string,
		status: 'online' | 'away' | 'offline',
		lastSeenAt: number,
		originId?: string
	): Promise<void> {
		const ev: PubSubEvent = { type: 'presence', workspaceId, userId, status, lastSeenAt, originId }
		for (const h of this.handlers) h(ev)
	}

	async publishTyping(
		workspaceId: string,
		channelId: string,
		userId: string,
		until: number,
		originId?: string
	): Promise<void> {
		const ev: PubSubEvent = { type: 'typing', workspaceId, channelId, userId, until, originId }
		for (const h of this.handlers) h(ev)
	}

	subscribe(handler: PubSubHandler): () => void {
		this.handlers.add(handler)
		return () => {
			this.handlers.delete(handler)
		}
	}

	async close(): Promise<void> {
		this.handlers.clear()
	}

	isReady(): boolean {
		return true
	}
}

const NOTIFY_CHANNEL = 'huriro_realtime'

export class PostgresNotifyPubSub implements RealtimePubSub {
	private readonly handlers = new Set<PubSubHandler>()
	private readonly sql: Sql
	private listenHandle: { unlisten(): Promise<void> } | null = null

	constructor(sql: Sql) {
		this.sql = sql
	}

	async startListening(): Promise<void> {
		if (this.listenHandle) return
		this.listenHandle = await this.sql.listen(NOTIFY_CHANNEL, (raw) => {
			try {
				const parsed = JSON.parse(raw) as
					| { t: 'c'; w: string; c: number }
					| { t: 'm'; w: string; ch: string; r: number; s: number }
					| { t: 'r'; w: string; u: string; r: string }
					| { t: 'p'; w: string; u: string; st: 'online' | 'away' | 'offline'; ts: number; o?: string }
					| { t: 'y'; w: string; ch: string; u: string; un: number; o?: string }
				if (parsed.t === 'c') {
					for (const h of this.handlers) {
						h({ type: 'cursor', workspaceId: parsed.w, cursor: parsed.c })
					}
				} else if (parsed.t === 'm') {
					for (const h of this.handlers) {
						h({
							type: 'chat',
							workspaceId: parsed.w,
							channelId: parsed.ch,
							rev: parsed.r,
							lastMsgSeq: parsed.s
						})
					}
				} else if (parsed.t === 'r') {
					for (const h of this.handlers) {
						h({ type: 'revoke', workspaceId: parsed.w, userId: parsed.u, reason: parsed.r })
					}
				} else if (parsed.t === 'p') {
					for (const h of this.handlers) {
						h({
							type: 'presence',
							workspaceId: parsed.w,
							userId: parsed.u,
							status: parsed.st,
							lastSeenAt: parsed.ts,
							originId: parsed.o
						})
					}
				} else if (parsed.t === 'y') {
					for (const h of this.handlers) {
						h({
							type: 'typing',
							workspaceId: parsed.w,
							channelId: parsed.ch,
							userId: parsed.u,
							until: parsed.un,
							originId: parsed.o
						})
					}
				}
			} catch (err) {
				log.warn({ err }, 'failed to parse realtime notify payload')
			}
		})
	}

	async publishCursor(workspaceId: string, cursor: number): Promise<void> {
		const payload = JSON.stringify({ t: 'c', w: workspaceId, c: cursor })
		await this.sql.notify(NOTIFY_CHANNEL, payload)
	}

	async publishChat(workspaceId: string, channelId: string, rev: number, lastMsgSeq: number): Promise<void> {
		const payload = JSON.stringify({ t: 'm', w: workspaceId, ch: channelId, r: rev, s: lastMsgSeq })
		await this.sql.notify(NOTIFY_CHANNEL, payload)
	}

	async publishRevoke(workspaceId: string, userId: string, reason: string): Promise<void> {
		const payload = JSON.stringify({ t: 'r', w: workspaceId, u: userId, r: reason })
		await this.sql.notify(NOTIFY_CHANNEL, payload)
	}

	async publishPresence(
		workspaceId: string,
		userId: string,
		status: 'online' | 'away' | 'offline',
		lastSeenAt: number,
		originId?: string
	): Promise<void> {
		const payload = JSON.stringify({
			t: 'p',
			w: workspaceId,
			u: userId,
			st: status,
			ts: lastSeenAt,
			o: originId
		})
		await this.sql.notify(NOTIFY_CHANNEL, payload)
	}

	async publishTyping(
		workspaceId: string,
		channelId: string,
		userId: string,
		until: number,
		originId?: string
	): Promise<void> {
		const payload = JSON.stringify({
			t: 'y',
			w: workspaceId,
			ch: channelId,
			u: userId,
			un: until,
			o: originId
		})
		await this.sql.notify(NOTIFY_CHANNEL, payload)
	}

	subscribe(handler: PubSubHandler): () => void {
		this.handlers.add(handler)
		return () => {
			this.handlers.delete(handler)
		}
	}

	async close(): Promise<void> {
		this.handlers.clear()
		if (this.listenHandle) {
			await this.listenHandle.unlisten().catch(() => {})
			this.listenHandle = null
		}
	}

	isReady(): boolean {
		return true
	}
}

// ---------- Valkey/Redis RESP2 pub/sub client (§19.4, M6 HA) ----------

type RespValue = string | number | null | RespValue[]

function encodeRespCommand(...args: string[]): Buffer {
	const parts: Buffer[] = [Buffer.from(`*${args.length}\r\n`, 'utf8')]
	for (const arg of args) {
		const buf = Buffer.from(arg, 'utf8')
		parts.push(Buffer.from(`$${buf.byteLength}\r\n`, 'utf8'), buf, Buffer.from('\r\n', 'utf8'))
	}
	return Buffer.concat(parts)
}

class RespStreamDecoder {
	private buf: Buffer = Buffer.alloc(0)

	feed(chunk: Buffer): RespValue[] {
		this.buf = this.buf.byteLength === 0 ? chunk : Buffer.concat([this.buf, chunk])
		const values: RespValue[] = []
		let offset = 0
		while (offset < this.buf.byteLength) {
			const parsed = this.readValue(offset)
			if (!parsed) break
			values.push(parsed.value)
			offset = parsed.nextOffset
		}
		if (offset > 0) {
			this.buf = this.buf.subarray(offset)
		}
		return values
	}

	reset(): void {
		this.buf = Buffer.alloc(0)
	}

	private readLine(start: number): { readonly line: string; readonly nextOffset: number } | null {
		const idx = this.buf.indexOf('\r\n', start, 'utf8')
		if (idx < 0) return null
		return {
			line: this.buf.toString('utf8', start, idx),
			nextOffset: idx + 2
		}
	}

	private readValue(start: number): { readonly value: RespValue; readonly nextOffset: number } | null {
		if (start >= this.buf.byteLength) return null
		const prefix = String.fromCharCode(this.buf[start] ?? 0)
		if (prefix === '+' || prefix === '-' || prefix === ':') {
			const line = this.readLine(start + 1)
			if (!line) return null
			if (prefix === ':') return { value: Number.parseInt(line.line, 10), nextOffset: line.nextOffset }
			return { value: line.line, nextOffset: line.nextOffset }
		}
		if (prefix === '$') {
			const line = this.readLine(start + 1)
			if (!line) return null
			const len = Number.parseInt(line.line, 10)
			if (len === -1) return { value: null, nextOffset: line.nextOffset }
			const end = line.nextOffset + len
			if (this.buf.byteLength < end + 2) return null
			return {
				value: this.buf.toString('utf8', line.nextOffset, end),
				nextOffset: end + 2
			}
		}
		if (prefix === '*') {
			const line = this.readLine(start + 1)
			if (!line) return null
			const count = Number.parseInt(line.line, 10)
			if (count === -1) return { value: null, nextOffset: line.nextOffset }
			const items: RespValue[] = []
			let cursor = line.nextOffset
			for (let i = 0; i < count; i++) {
				const child = this.readValue(cursor)
				if (!child) return null
				items.push(child.value)
				cursor = child.nextOffset
			}
			return { value: items, nextOffset: cursor }
		}
		return null
	}
}

export class ValkeyPubSub implements RealtimePubSub {
	private readonly handlers = new Set<PubSubHandler>()
	private readonly host: string
	private readonly port: number
	private readonly useTls: boolean
	private readonly username: string | undefined
	private readonly password: string | undefined
	private readonly dbIndex: string | undefined
	private readonly channel: string

	private pubSocket: net.Socket | null = null
	private subSocket: net.Socket | null = null
	private pubReady = false
	private subReady = false
	private closed = false
	private reconnectTimer: ReturnType<typeof setTimeout> | null = null
	private reconnectAttempt = 0
	private connectingPromise: Promise<void> | null = null

	constructor(url: string, channel = NOTIFY_CHANNEL) {
		const parsed = new URL(url)
		this.host = parsed.hostname || '127.0.0.1'
		this.port = parsed.port ? Number.parseInt(parsed.port, 10) : 6379
		this.useTls = parsed.protocol === 'rediss:'
		this.username = parsed.username ? decodeURIComponent(parsed.username) : undefined
		this.password = parsed.password ? decodeURIComponent(parsed.password) : undefined
		const pathDb = parsed.pathname.replace(/^\//, '').trim()
		this.dbIndex = pathDb && /^\d+$/.test(pathDb) ? pathDb : undefined
		this.channel = channel
	}

	isReady(): boolean {
		return !this.closed && this.pubReady && this.subReady
	}

	private createSocket(): net.Socket {
		const sock = this.useTls
			? tls.connect({ host: this.host, port: this.port })
			: net.createConnection({ host: this.host, port: this.port })
		sock.setNoDelay(true)
		return sock
	}

	private sendPreamble(sock: net.Socket): void {
		if (this.password) {
			if (this.username) {
				sock.write(encodeRespCommand('AUTH', this.username, this.password))
			} else {
				sock.write(encodeRespCommand('AUTH', this.password))
			}
		}
		if (this.dbIndex) {
			sock.write(encodeRespCommand('SELECT', this.dbIndex))
		}
	}

	private scheduleReconnect(): void {
		if (this.closed || this.reconnectTimer) return
		const delay = Math.min(5_000, 150 * 2 ** this.reconnectAttempt)
		this.reconnectAttempt += 1
		this.reconnectTimer = setTimeout(() => {
			this.reconnectTimer = null
			void this.connect().catch(() => {})
		}, delay)
		this.reconnectTimer.unref?.()
	}

	async connect(timeoutMs = 3_000): Promise<void> {
		if (this.closed) return
		if (this.isReady()) return
		if (this.connectingPromise) return this.connectingPromise

		this.connectingPromise = (async () => {
			try {
				await Promise.all([this.connectPub(timeoutMs), this.connectSub(timeoutMs)])
				this.reconnectAttempt = 0
			} finally {
				this.connectingPromise = null
			}
		})()

		return this.connectingPromise
	}

	private connectPub(timeoutMs: number): Promise<void> {
		if (this.pubSocket && this.pubReady) return Promise.resolve()
		this.pubSocket?.destroy()
		this.pubReady = false

		return new Promise((resolve, reject) => {
			const sock = this.createSocket()
			this.pubSocket = sock
			const decoder = new RespStreamDecoder()
			let settled = false
			const timer = setTimeout(() => {
				if (!settled) {
					settled = true
					sock.destroy()
					reject(new Error('Valkey publisher connection timed out'))
				}
			}, timeoutMs)

			sock.on('connect', () => {
				this.sendPreamble(sock)
				sock.write(encodeRespCommand('PING'))
			})

			sock.on('data', (chunk: Buffer) => {
				const vals = decoder.feed(chunk)
				for (const val of vals) {
					if (!settled && (val === 'PONG' || val === 'OK')) {
						if (val === 'PONG') {
							settled = true
							clearTimeout(timer)
							this.pubReady = true
							resolve()
						}
					}
				}
			})

			sock.on('error', (err) => {
				this.pubReady = false
				if (!settled) {
					settled = true
					clearTimeout(timer)
					reject(err)
				}
				this.scheduleReconnect()
			})

			sock.on('close', () => {
				this.pubReady = false
				decoder.reset()
				if (!settled) {
					settled = true
					clearTimeout(timer)
					reject(new Error('Valkey publisher socket closed'))
				}
				this.scheduleReconnect()
			})
		})
	}

	private connectSub(timeoutMs: number): Promise<void> {
		if (this.subSocket && this.subReady) return Promise.resolve()
		this.subSocket?.destroy()
		this.subReady = false

		return new Promise((resolve, reject) => {
			const sock = this.createSocket()
			this.subSocket = sock
			const decoder = new RespStreamDecoder()
			let settled = false
			const timer = setTimeout(() => {
				if (!settled) {
					settled = true
					sock.destroy()
					reject(new Error('Valkey subscriber connection timed out'))
				}
			}, timeoutMs)

			sock.on('connect', () => {
				this.sendPreamble(sock)
				sock.write(encodeRespCommand('SUBSCRIBE', this.channel))
			})

			sock.on('data', (chunk: Buffer) => {
				const vals = decoder.feed(chunk)
				for (const val of vals) {
					if (!Array.isArray(val) || val.length < 3) continue
					const kind = val[0]
					const chan = val[1]
					const payload = val[2]
					if (kind === 'subscribe' && chan === this.channel) {
						this.subReady = true
						if (!settled) {
							settled = true
							clearTimeout(timer)
							resolve()
						}
					} else if (kind === 'message' && chan === this.channel && typeof payload === 'string') {
						try {
							const ev = JSON.parse(payload) as PubSubEvent
							for (const h of this.handlers) h(ev)
						} catch {
							// Ignore malformed pubsub JSON
						}
					}
				}
			})

			sock.on('error', (err) => {
				this.subReady = false
				if (!settled) {
					settled = true
					clearTimeout(timer)
					reject(err)
				}
				this.scheduleReconnect()
			})

			sock.on('close', () => {
				this.subReady = false
				decoder.reset()
				if (!settled) {
					settled = true
					clearTimeout(timer)
					reject(new Error('Valkey subscriber socket closed'))
				}
				this.scheduleReconnect()
			})
		})
	}

	private async publishEvent(ev: PubSubEvent): Promise<void> {
		if (this.closed || !this.pubSocket || !this.pubReady || this.pubSocket.destroyed) {
			throw new Error('Valkey publisher unavailable')
		}
		const payload = JSON.stringify(ev)
		await new Promise<void>((resolve, reject) => {
			const sock = this.pubSocket
			if (!sock || sock.destroyed) {
				reject(new Error('Valkey publisher socket closed'))
				return
			}
			sock.write(encodeRespCommand('PUBLISH', this.channel, payload), (err) => {
				if (err) reject(err)
				else resolve()
			})
		})
	}

	publishCursor(workspaceId: string, cursor: number): Promise<void> {
		return this.publishEvent({ type: 'cursor', workspaceId, cursor })
	}

	publishChat(workspaceId: string, channelId: string, rev: number, lastMsgSeq: number): Promise<void> {
		return this.publishEvent({ type: 'chat', workspaceId, channelId, rev, lastMsgSeq })
	}

	publishRevoke(workspaceId: string, userId: string, reason: string): Promise<void> {
		return this.publishEvent({ type: 'revoke', workspaceId, userId, reason })
	}

	publishPresence(
		workspaceId: string,
		userId: string,
		status: 'online' | 'away' | 'offline',
		lastSeenAt: number,
		originId?: string
	): Promise<void> {
		return this.publishEvent({ type: 'presence', workspaceId, userId, status, lastSeenAt, originId })
	}

	publishTyping(
		workspaceId: string,
		channelId: string,
		userId: string,
		until: number,
		originId?: string
	): Promise<void> {
		return this.publishEvent({ type: 'typing', workspaceId, channelId, userId, until, originId })
	}

	subscribe(handler: PubSubHandler): () => void {
		this.handlers.add(handler)
		return () => {
			this.handlers.delete(handler)
		}
	}

	async close(): Promise<void> {
		this.closed = true
		this.pubReady = false
		this.subReady = false
		if (this.reconnectTimer) {
			clearTimeout(this.reconnectTimer)
			this.reconnectTimer = null
		}
		this.pubSocket?.destroy()
		this.subSocket?.destroy()
		this.pubSocket = null
		this.subSocket = null
		this.handlers.clear()
	}
}

export class ResilientPubSub implements RealtimePubSub {
	private readonly handlers = new Set<PubSubHandler>()
	private readonly primary: RealtimePubSub
	private readonly fallback: RealtimePubSub
	private readonly unsubPrimary: () => void
	private readonly unsubFallback: () => void

	constructor(primary: RealtimePubSub, fallback: RealtimePubSub) {
		this.primary = primary
		this.fallback = fallback
		const dispatch = (ev: PubSubEvent) => {
			for (const h of this.handlers) h(ev)
		}
		this.unsubPrimary = primary.subscribe(dispatch)
		this.unsubFallback = fallback.subscribe(dispatch)
	}

	isReady(): boolean {
		return (this.primary.isReady?.() ?? true) || (this.fallback.isReady?.() ?? true)
	}

	private async publishWithFailover(
		primaryCall: () => Promise<void> | undefined,
		fallbackCall: () => Promise<void> | undefined
	): Promise<void> {
		const primaryReady = this.primary.isReady ? this.primary.isReady() : true
		if (primaryReady) {
			try {
				await primaryCall()
				return
			} catch (err) {
				log.warn({ err }, 'primary pubsub failed; failing over to local/pg pubsub')
			}
		}
		await fallbackCall()
	}

	publishCursor(workspaceId: string, cursor: number): Promise<void> {
		return this.publishWithFailover(
			() => this.primary.publishCursor(workspaceId, cursor),
			() => this.fallback.publishCursor(workspaceId, cursor)
		)
	}

	publishChat(workspaceId: string, channelId: string, rev: number, lastMsgSeq: number): Promise<void> {
		return this.publishWithFailover(
			() => this.primary.publishChat(workspaceId, channelId, rev, lastMsgSeq),
			() => this.fallback.publishChat(workspaceId, channelId, rev, lastMsgSeq)
		)
	}

	publishRevoke(workspaceId: string, userId: string, reason: string): Promise<void> {
		return this.publishWithFailover(
			() => this.primary.publishRevoke(workspaceId, userId, reason),
			() => this.fallback.publishRevoke(workspaceId, userId, reason)
		)
	}

	publishPresence(
		workspaceId: string,
		userId: string,
		status: 'online' | 'away' | 'offline',
		lastSeenAt: number,
		originId?: string
	): Promise<void> {
		return this.publishWithFailover(
			() => this.primary.publishPresence?.(workspaceId, userId, status, lastSeenAt, originId),
			() => this.fallback.publishPresence?.(workspaceId, userId, status, lastSeenAt, originId)
		)
	}

	publishTyping(
		workspaceId: string,
		channelId: string,
		userId: string,
		until: number,
		originId?: string
	): Promise<void> {
		return this.publishWithFailover(
			() => this.primary.publishTyping?.(workspaceId, channelId, userId, until, originId),
			() => this.fallback.publishTyping?.(workspaceId, channelId, userId, until, originId)
		)
	}

	subscribe(handler: PubSubHandler): () => void {
		this.handlers.add(handler)
		return () => {
			this.handlers.delete(handler)
		}
	}

	async close(): Promise<void> {
		this.unsubPrimary()
		this.unsubFallback()
		this.handlers.clear()
		await Promise.all([this.primary.close(), this.fallback.close()])
	}
}
