/**
 * ScopedSyncManager — tier-2 lazy scope hydration with ref-counted subscriptions
 * and quota-bounded LRU eviction (§8.1, ADR-0031).
 *
 * Framework-free by design: the engine wires `fetchPage`/`applyRows`/`purgeRows`
 * to the transport and the TanStack collections; this class only owns the
 * subscription lifecycle, hydration paging, byte accounting, and eviction policy.
 *
 * Lifecycle contract:
 * - `subscribe(scope)` ALWAYS takes a ref and returns a promise that resolves
 *   when the scope is hydrated (`ready`) or rejects when hydration fails. The
 *   caller owns the ref either way and MUST eventually call `release(scope)`.
 * - `release(scope)` drops a ref; at zero refs the scope is purged and forgotten
 *   unless it is pinned (a pinned zero-ref scope is retained as a warm cache).
 * - Unpinning a zero-ref scope purges + drops it too — an entry only survives
 *   with zero refs while it is pinned or was restored stale from persistence.
 * - Mid-pagination errors leave the scope in `error` state: the rows already
 *   applied are kept (better partial data than none for offline rendering) but
 *   the scope is NOT active and never retries on its own. Recovery is
 *   release + re-subscribe; subscribing an errored scope returns a rejected
 *   promise without starting a new hydration.
 * - Boot-restored entries start `stale` with zero refs: their rows are already
 *   in the replica (persisted last session) so they count towards the quota and
 *   join `activeScopes`, but they only rehydrate lazily on the next subscribe.
 */
export type ScopeSyncState = 'stale' | 'hydrating' | 'ready' | 'error'

export interface ScopeRegistryEntry {
	readonly scope: string
	readonly refCount: number
	readonly lastAccess: number
	readonly byteSize: number
	readonly pinned: boolean
	readonly state: ScopeSyncState
}

/** Persisted shape — metadata only, never rows (§8.1 quota bookkeeping). */
export interface PersistedScopeEntry {
	readonly scope: string
	readonly byteSize: number
	readonly lastAccess: number
	readonly pinned: boolean
}

export interface ScopePage {
	readonly rows: readonly unknown[]
	readonly nextAfter: string | null
	readonly hasMore: boolean
}

export interface ScopedSyncManagerOptions {
	readonly fetchPage: (scope: string, after: string | null) => Promise<ScopePage>
	readonly applyRows: (scope: string, rows: readonly unknown[]) => void
	/**
	 * Remove the scope's rows from the local replica. `rowIds` are the ids this
	 * manager applied during hydration — empty for boot-restored stale entries,
	 * so implementations that need completeness should scan by scope rather than
	 * trust the id list (the engine does exactly that for `issue_hist`).
	 */
	readonly purgeRows: (scope: string, rowIds: readonly string[]) => void
	readonly quotaBytes: number
	readonly now?: (() => number) | undefined
	readonly onEvict?: ((scope: string) => void) | undefined
	readonly onRegistryChange?: ((entries: readonly PersistedScopeEntry[]) => void) | undefined
	/** Row-id extraction for purge bookkeeping; defaults to the `.id` property. */
	readonly getRowId?: ((row: unknown) => string | null) | undefined
}

interface MutableEntry {
	scope: string
	refCount: number
	lastAccess: number
	byteSize: number
	pinned: boolean
	state: ScopeSyncState
	/** Ids applied in the current hydration generation (purge bookkeeping). */
	rowIds: string[]
	/** Bumped on release/reset so in-flight pages of a dropped hydration no-op. */
	generation: number
	hydrationPromise: Promise<void> | null
	error: string | null
}

function defaultGetRowId(row: unknown): string | null {
	if (row && typeof row === 'object') {
		const id = (row as { id?: unknown }).id
		if (typeof id === 'string') return id
	}
	return null
}

export class ScopedSyncManager {
	private readonly fetchPage: ScopedSyncManagerOptions['fetchPage']
	private readonly applyRows: ScopedSyncManagerOptions['applyRows']
	private readonly purgeRows: ScopedSyncManagerOptions['purgeRows']
	private readonly quotaBytes: number
	private readonly now: () => number
	private readonly onEvict: ((scope: string) => void) | undefined
	private readonly onRegistryChange: ((entries: readonly PersistedScopeEntry[]) => void) | undefined
	private readonly getRowId: (row: unknown) => string | null
	private readonly entries = new Map<string, MutableEntry>()

	constructor(opts: ScopedSyncManagerOptions) {
		this.fetchPage = opts.fetchPage
		this.applyRows = opts.applyRows
		this.purgeRows = opts.purgeRows
		this.quotaBytes = opts.quotaBytes
		this.now = opts.now ?? Date.now
		this.onEvict = opts.onEvict
		this.onRegistryChange = opts.onRegistryChange
		this.getRowId = opts.getRowId ?? defaultGetRowId
	}

	/**
	 * Take a subscription ref on `scope` and return a promise resolving once the
	 * scope is hydrated. The first subscriber kicks off hydration; concurrent
	 * subscribers join the in-flight one. Rehydration of a `stale` (boot-restored)
	 * scope re-fetches every page — rows are upserted, never duplicated.
	 */
	subscribe(scope: string): Promise<void> {
		let entry = this.entries.get(scope)
		if (!entry) {
			entry = this.makeEntry(scope)
			this.entries.set(scope, entry)
		}
		entry.refCount += 1
		entry.lastAccess = this.now()
		this.notifyRegistryChange()

		if (entry.state === 'ready') return Promise.resolve()
		if (entry.state === 'error') {
			// No silent retry: recovery is release + re-subscribe (documented contract).
			return Promise.reject(new Error(entry.error ?? `Scope "${scope}" hydration failed`))
		}
		if (entry.state === 'hydrating' && entry.hydrationPromise) {
			return entry.hydrationPromise
		}
		return this.startHydration(entry)
	}

	/**
	 * Drop a subscription ref. At zero refs the scope is purged and forgotten —
	 * unless pinned, in which case the hydrated rows stay as a warm cache.
	 * Releasing an unknown scope is a no-op (idempotent for eviction races).
	 */
	release(scope: string): void {
		const entry = this.entries.get(scope)
		if (!entry) return
		entry.refCount = Math.max(0, entry.refCount - 1)
		if (entry.refCount > 0) {
			this.notifyRegistryChange()
			return
		}
		if (entry.pinned) {
			// Pinned entries survive release as warm cache; `state` is untouched so
			// a later subscribe resolves instantly (ready) or lazily (stale).
			this.notifyRegistryChange()
			return
		}
		this.dropEntry(entry, { purge: true })
	}

	touch(scope: string): void {
		const entry = this.entries.get(scope)
		if (!entry) return
		entry.lastAccess = this.now()
	}

	pin(scope: string): void {
		const entry = this.entries.get(scope)
		if (!entry) {
			// Pinning an unknown scope registers a stale pinned entry so the pin
			// survives restarts even when the pinning component never remounts.
			const fresh = this.makeEntry(scope)
			fresh.pinned = true
			this.entries.set(scope, fresh)
			this.notifyRegistryChange()
			return
		}
		if (entry.pinned) return
		entry.pinned = true
		this.notifyRegistryChange()
	}

	unpin(scope: string): void {
		const entry = this.entries.get(scope)
		if (!entry?.pinned) return
		entry.pinned = false
		if (entry.refCount === 0 && entry.state !== 'stale') {
			// Nothing keeps this entry alive anymore — same end-of-life as a release.
			this.dropEntry(entry, { purge: true })
			return
		}
		this.notifyRegistryChange()
	}

	/**
	 * Scopes whose rows are currently held locally and therefore subscribed in
	 * `/sync/changes` — `ready` entries plus boot-restored `stale` ones (their
	 * persisted rows are in the replica, so the feed must keep them fresh).
	 * Hydrating scopes are excluded: the in-flight snapshot pages already carry
	 * the current state. Error scopes are excluded: recovery is a full rehydrate.
	 */
	activeScopes(): string[] {
		const out: string[] = []
		for (const entry of this.entries.values()) {
			if (entry.state === 'ready' || entry.state === 'stale') out.push(entry.scope)
		}
		return out.sort()
	}

	getScopeState(scope: string): ScopeRegistryEntry | null {
		const entry = this.entries.get(scope)
		if (!entry) return null
		return {
			scope: entry.scope,
			refCount: entry.refCount,
			lastAccess: entry.lastAccess,
			byteSize: entry.byteSize,
			pinned: entry.pinned,
			state: entry.state
		}
	}

	totalBytes(): number {
		let total = 0
		for (const entry of this.entries.values()) total += entry.byteSize
		return total
	}

	/** Persisted metadata (never rows) — written under its own storage key. */
	exportRegistry(): PersistedScopeEntry[] {
		return [...this.entries.values()].map((e) => ({
			scope: e.scope,
			byteSize: e.byteSize,
			lastAccess: e.lastAccess,
			pinned: e.pinned
		}))
	}

	/**
	 * Boot restore: entries come back `stale` with zero refs. Their rows are
	 * already in the replica from last session's persisted state, so they count
	 * towards the quota immediately — a over-quota restore evicts LRU-first.
	 * Freshness rationale: rows are as fresh as the persisted sync cursor; the
	 * change feed refreshes them because stale scopes join `activeScopes`, and a
	 * full rehydration happens lazily on the next subscribe.
	 */
	restoreRegistry(entries: readonly PersistedScopeEntry[]): void {
		for (const persisted of entries) {
			if (this.entries.has(persisted.scope)) continue
			const entry = this.makeEntry(persisted.scope)
			entry.byteSize = persisted.byteSize
			entry.lastAccess = persisted.lastAccess
			entry.pinned = persisted.pinned
			this.entries.set(persisted.scope, entry)
		}
		this.evictIfNeeded()
		this.notifyRegistryChange()
	}

	/** Drop every entry without purging — used after the collections are wiped. */
	reset(): void {
		for (const entry of this.entries.values()) {
			entry.generation += 1
		}
		this.entries.clear()
		this.notifyRegistryChange()
	}

	private makeEntry(scope: string): MutableEntry {
		return {
			scope,
			refCount: 0,
			lastAccess: this.now(),
			byteSize: 0,
			pinned: false,
			state: 'stale',
			rowIds: [],
			generation: 0,
			hydrationPromise: null,
			error: null
		}
	}

	private startHydration(entry: MutableEntry): Promise<void> {
		entry.state = 'hydrating'
		entry.error = null
		entry.byteSize = 0
		entry.rowIds = []
		const generation = entry.generation
		this.notifyRegistryChange()

		const promise = this.runHydration(entry, generation)
		entry.hydrationPromise = promise
		return promise
	}

	private async runHydration(entry: MutableEntry, generation: number): Promise<void> {
		// Returns true while this hydration generation still owns the entry —
		// a release/reset bumps the generation so late pages become no-ops.
		const owns = () => this.entries.get(entry.scope) === entry && entry.generation === generation
		let after: string | null = null
		try {
			for (;;) {
				const page = await this.fetchPage(entry.scope, after)
				if (!owns()) return
				this.applyRows(entry.scope, page.rows)
				let pageBytes = 0
				for (const row of page.rows) {
					// UTF-16 length approximates UTF-8 bytes closely enough for quota
					// bookkeeping — exactness is not required for an LRU heuristic.
					pageBytes += JSON.stringify(row).length
					const id = this.getRowId(row)
					if (id !== null) entry.rowIds.push(id)
				}
				entry.byteSize += pageBytes
				if (!page.hasMore) break
				if (page.nextAfter === null) {
					throw new Error(`Scope "${entry.scope}" hydration stalled: hasMore without cursor`)
				}
				after = page.nextAfter
			}
			if (!owns()) return
			entry.state = 'ready'
			entry.lastAccess = this.now()
			entry.hydrationPromise = null
			this.notifyRegistryChange()
			this.evictIfNeeded()
		} catch (err) {
			if (!owns()) return
			entry.state = 'error'
			entry.error = err instanceof Error ? err.message : 'Scope hydration failed'
			entry.hydrationPromise = null
			this.notifyRegistryChange()
			throw err
		}
	}

	/**
	 * LRU eviction: while over quota, purge the least-recently-accessed unpinned
	 * entry that is not mid-hydration (in-flight writes must not be orphaned).
	 * Stale and error entries are eligible — both hold rows in the replica.
	 */
	private evictIfNeeded(): void {
		for (;;) {
			if (this.totalBytes() <= this.quotaBytes) return
			let victim: MutableEntry | null = null
			for (const entry of this.entries.values()) {
				if (entry.pinned || entry.state === 'hydrating') continue
				if (!victim || entry.lastAccess < victim.lastAccess) victim = entry
			}
			if (!victim) return
			this.dropEntry(victim, { purge: true, evict: true })
		}
	}

	private dropEntry(entry: MutableEntry, opts: { purge: boolean; evict?: boolean }): void {
		// Bump the generation first so any in-flight hydration page becomes a no-op.
		entry.generation += 1
		this.entries.delete(entry.scope)
		if (opts.purge) {
			this.purgeRows(entry.scope, entry.rowIds)
		}
		if (opts.evict) {
			this.onEvict?.(entry.scope)
		}
		this.notifyRegistryChange()
	}

	private notifyRegistryChange(): void {
		this.onRegistryChange?.(this.exportRegistry())
	}
}
