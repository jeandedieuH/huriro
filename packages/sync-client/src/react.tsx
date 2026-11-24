import type { Collection } from '@tanstack/db'
import { eq, useLiveQuery } from '@tanstack/react-db'
import { createContext, type ReactNode, useContext, useEffect, useState, useSyncExternalStore } from 'react'
import type { HuriroSyncEngine, SyncEngineStatus } from './engine'
import type { SyncConflict } from './outbox'

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
