/**
 * Ephemeral presence registry (ADR-0035, §15.2).
 *
 * Live connection state is never a Postgres row and never a durable heartbeat.
 * Realtime nodes publish ephemeral presence hints over the existing signal
 * pub/sub; API/worker processes keep a local TTL view fed by those hints so
 * Mail round-robin can ask "is this member online right now?" without a DB
 * write path. When the registry has no entry (restart, disabled realtime), the
 * caller must fall back to the durable availability model.
 */
import type { PubSubEvent, RealtimePubSub } from './pubsub'

export type PresenceStatus = 'online' | 'away' | 'offline'

export interface PresenceEntry {
	readonly status: 'online' | 'away'
	readonly lastSeenAt: number
}

export interface PresenceRegistry {
	set(workspaceId: string, userId: string, status: PresenceStatus, lastSeenAt?: number): void
	get(workspaceId: string, userId: string): PresenceEntry | null
	/** TTL-aware lookup: unknown/expired entries read as `offline`. */
	getStatus(workspaceId: string, userId: string): PresenceStatus
	isOnline(workspaceId: string, userId: string): boolean
	list(workspaceId: string): ReadonlyArray<{ readonly userId: string } & PresenceEntry>
	clear(): void
}

export interface PresenceRegistryOptions {
	/** Entries older than this are treated as offline. Default 90s (>= 20s ping). */
	readonly ttlMs?: number | undefined
	readonly now?: (() => number) | undefined
}

export class InMemoryPresenceRegistry implements PresenceRegistry {
	private readonly byWorkspace = new Map<string, Map<string, PresenceEntry>>()
	private readonly ttlMs: number
	private readonly now: () => number

	constructor(opts?: PresenceRegistryOptions) {
		this.ttlMs = opts?.ttlMs ?? 90_000
		this.now = opts?.now ?? (() => Date.now())
	}

	set(workspaceId: string, userId: string, status: PresenceStatus, lastSeenAt?: number): void {
		let map = this.byWorkspace.get(workspaceId)
		if (!map) {
			map = new Map()
			this.byWorkspace.set(workspaceId, map)
		}
		if (status === 'offline') {
			map.delete(userId)
			if (map.size === 0) this.byWorkspace.delete(workspaceId)
			return
		}
		map.set(userId, { status, lastSeenAt: lastSeenAt ?? this.now() })
	}

	get(workspaceId: string, userId: string): PresenceEntry | null {
		const entry = this.byWorkspace.get(workspaceId)?.get(userId)
		if (!entry) return null
		if (this.now() - entry.lastSeenAt > this.ttlMs) {
			this.byWorkspace.get(workspaceId)?.delete(userId)
			return null
		}
		return entry
	}

	getStatus(workspaceId: string, userId: string): PresenceStatus {
		return this.get(workspaceId, userId)?.status ?? 'offline'
	}

	isOnline(workspaceId: string, userId: string): boolean {
		return this.getStatus(workspaceId, userId) === 'online'
	}

	list(workspaceId: string): ReadonlyArray<{ readonly userId: string } & PresenceEntry> {
		const map = this.byWorkspace.get(workspaceId)
		if (!map) return []
		const now = this.now()
		const rows: Array<{ userId: string } & PresenceEntry> = []
		for (const [userId, entry] of map) {
			if (now - entry.lastSeenAt > this.ttlMs) {
				map.delete(userId)
				continue
			}
			rows.push({ userId, ...entry })
		}
		return rows
	}

	clear(): void {
		this.byWorkspace.clear()
	}
}

/**
 * Wires a registry to signal-plane presence events so API and worker replicas
 * see the same live view as realtime nodes (Postgres NOTIFY or Valkey fan-out).
 */
export function createPresenceRegistry(
	pubsub: RealtimePubSub,
	opts?: PresenceRegistryOptions
): { readonly registry: InMemoryPresenceRegistry; readonly stop: () => void } {
	const registry = new InMemoryPresenceRegistry(opts)
	const unsubscribe = pubsub.subscribe((event: PubSubEvent) => {
		if (event.type !== 'presence') return
		registry.set(event.workspaceId, event.userId, event.status, event.lastSeenAt)
	})
	return { registry, stop: unsubscribe }
}
