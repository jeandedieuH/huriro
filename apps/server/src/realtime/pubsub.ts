/**
 * Realtime signal pub/sub abstraction (§9.4, §15.1, §15.2).
 *
 * Signals carry ONLY opaque pointers (`{ workspaceId, cursor }`, `{ workspaceId, channelId, rev, lastMsgSeq }`,
 * or `{ workspaceId, userId, reason }`) — never domain payloads.
 * - `InProcessPubSub`: zero-latency single-process fan-out (`--role=all` and tests).
 * - `PostgresNotifyPubSub`: multi-process fan-out over a dedicated LISTEN/NOTIFY
 *   session connection (`api` / `worker` → `realtime`).
 */
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

export type PubSubHandler = (event: PubSubEvent) => void

export interface RealtimePubSub {
	publishCursor(workspaceId: string, cursor: number): Promise<void>
	publishChat(workspaceId: string, channelId: string, rev: number, lastMsgSeq: number): Promise<void>
	publishRevoke(workspaceId: string, userId: string, reason: string): Promise<void>
	subscribe(handler: PubSubHandler): () => void
	close(): Promise<void>
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

	subscribe(handler: PubSubHandler): () => void {
		this.handlers.add(handler)
		return () => {
			this.handlers.delete(handler)
		}
	}

	async close(): Promise<void> {
		this.handlers.clear()
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
}
