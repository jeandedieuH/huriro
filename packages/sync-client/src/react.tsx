import type { Collection } from '@tanstack/db'
import { eq, useLiveQuery } from '@tanstack/react-db'
import { createContext, type ReactNode, useContext, useEffect, useState, useSyncExternalStore } from 'react'
import type { HuriroSyncEngine, SyncEngineStatus } from './engine'
import type { SyncConflict } from './outbox'
import type { ScopeSyncState } from './scoped-sync'

export { eq, useLiveQuery }

const SyncContext = createContext<HuriroSyncEngine | null>(null)

export interface SyncProviderProps {
	readonly engine: HuriroSyncEngine
	readonly children: ReactNode
}

export function SyncProvider({ engine, children }: SyncProviderProps) {
	return <SyncContext.Provider value={engine}>{children}</SyncContext.Provider>
}

export function useSyncEngine(): HuriroSyncEngine {
	const engine = useContext(SyncContext)
	if (!engine) {
		throw new Error('useSyncEngine must be used inside <SyncProvider>')
	}
	return engine
}

/**
 * Non-throwing variant for leaf UI that must render outside a booted
 * workspace (component tests, stories) without losing provider-less fallbacks.
 */
export function useOptionalSyncEngine(): HuriroSyncEngine | null {
	return useContext(SyncContext)
}

export function useSyncStatus(): SyncEngineStatus {
	const engine = useSyncEngine()
	return useSyncExternalStore(
		(cb) => engine.subscribe(cb),
		() => engine.getStatus(),
		() => engine.getStatus()
	)
}

export function useSyncConflicts(): readonly SyncConflict[] {
	const engine = useSyncEngine()
	return useSyncExternalStore(
		(cb) => engine.subscribe(cb),
		() => engine.getConflicts(),
		() => engine.getConflicts()
	)
}

export function useCollectionItems<T extends { readonly id: string }>(
	collection: Collection<T, string>
): T[] {
	const [items, setItems] = useState<T[]>(() => collection.toArray)

	useEffect(() => {
		setItems(collection.toArray)
		// Explicit `includeInitialState: false` calls `markAllStateAsSeen()` in @tanstack/db so
		// delete events for rows already present at mount time are not filtered out.
		const sub = collection.subscribeChanges(
			() => {
				setItems(collection.toArray)
			},
			{ includeInitialState: false }
		)
		return () => {
			sub.unsubscribe()
		}
	}, [collection])

	return items
}

export interface UseSyncScopeResult {
	/**
	 * `idle` — no scope requested (null input). `stale` — no live registry entry:
	 * either rows only exist from a previous session (lazy rehydration pending)
	 * or the scope was evicted under memory pressure (rows purged). Apps that
	 * need to distinguish the two can listen to `onScopeEvicted` on the engine.
	 * `hydrating`/`ready`/`error` mirror the manager lifecycle; on `error` the
	 * hook re-subscribes only after the scope input changes (recovery is
	 * release + re-subscribe by design).
	 */
	readonly state: ScopeSyncState | 'idle'
	readonly ready: boolean
}

/**
 * Subscribe a tier-2 scope (§8.1, ADR-0031) for the lifetime of the component:
 * subscribes on mount, releases on unmount, re-subscribes when the scope input
 * changes. `pinned` exempts the scope from LRU eviction while mounted. Pass
 * `null` to render conditionally without subscribing.
 */
export function useSyncScope(scope: string | null, opts?: { readonly pinned?: boolean }): UseSyncScopeResult {
	const engine = useSyncEngine()
	const pinned = opts?.pinned ?? false

	useEffect(() => {
		if (scope === null) return
		if (pinned) engine.pinScope(scope)
		// The rejection is already reflected in the manager's `error` state read
		// below — swallowing it here only avoids an unhandled rejection warning.
		void engine.subscribeScope(scope).catch(() => {})
		return () => {
			if (pinned) engine.unpinScope(scope)
			engine.releaseScope(scope)
		}
	}, [engine, scope, pinned])

	const state = useSyncExternalStore(
		(cb) => engine.subscribe(cb),
		(): ScopeSyncState | 'idle' =>
			scope === null ? 'idle' : (engine.getScopeState(scope)?.state ?? 'stale'),
		(): ScopeSyncState | 'idle' => 'idle'
	)
	return { state, ready: state === 'ready' }
}
