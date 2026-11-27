import type { UpdateMyAvailabilityBody, UserAvailabilityDto } from '@huriro/contracts'
import { resolveEffectiveAvailability } from '@huriro/domain'
import {
	type HuriroSyncEngine,
	PresenceActivityController,
	useOptionalSyncEngine,
	useSyncEngine,
	useSyncStatus
} from '@huriro/sync-client'
import { useCallback, useEffect, useMemo, useState } from 'react'
import type { BootstrappedWorkspace } from '@/lib/sync-bootstrap'
import { useOptionalWorkspace } from '@/lib/workspace'
import { retainAvailabilityTicker, useAvailabilityStore } from '../store/availability-store'

interface ObservableView<T> {
	readonly toArray: T[]
	subscribeChanges(callback: () => void, opts: { includeInitialState: boolean }): { unsubscribe(): void }
}

const inflightHydrations = new Map<string, Promise<void>>()

async function hydrateAvailabilityFromApi(
	key: string,
	workspace: BootstrappedWorkspace,
	engine: HuriroSyncEngine
): Promise<void> {
	const existing = inflightHydrations.get(key)
	if (existing) return existing
	const promise = (async () => {
		const [mine, all] = await Promise.all([
			workspace.api.getMyAvailability(),
			workspace.api.listWorkspaceAvailability().catch(() => [])
		])
		const merged = new Map<string, UserAvailabilityDto>()
		for (const row of all) merged.set(row.userId, row)
		merged.set(mine.userId, mine)
		await engine.syncUserAvailabilityRows([...merged.values()])
	})().finally(() => {
		inflightHydrations.delete(key)
	})
	inflightHydrations.set(key, promise)
	return promise
}

/** `useCollectionItems` with a null-safe collection for provider-less stories/tests. */
function useOptionalCollectionItems<T extends { readonly id: string }>(
	collection: ObservableView<T> | null
): T[] {
	const [items, setItems] = useState<T[]>(() => collection?.toArray ?? [])
	useEffect(() => {
		if (!collection) {
			setItems([])
			return
		}
		setItems(collection.toArray)
		const sub = collection.subscribeChanges(() => setItems(collection.toArray), {
			includeInitialState: false
		})
		return () => sub.unsubscribe()
	}, [collection])
	return items
}

function recompute(
	row: UserAvailabilityDto,
	presence: 'online' | 'away' | 'offline',
	nowUtcIso: string
): UserAvailabilityDto {
	const resolved = resolveEffectiveAvailability({
		profile: {
			userId: row.userId,
			manualState: row.manualState,
			manualStateExpiresAt: row.manualStateExpiresAt,
			statusEmoji: row.statusEmoji,
			statusText: row.statusText,
			statusExpiresAt: row.statusExpiresAt,
			dndUntil: row.dndUntil,
			workingHours: row.workingHours,
			timezone: row.timezone,
			suppressNotificationsOffHours: row.suppressNotificationsOffHours,
			allowUrgentOverride: row.allowUrgentOverride
		},
		windows: row.windows,
		livePresence: presence,
		nowUtcIso
	})
	return {
		...row,
		effectiveState: resolved.state,
		statusEmoji: resolved.statusEmoji,
		statusText: resolved.statusText,
		statusExpiresAt: resolved.statusExpiresAt,
		withinWorkingHours: resolved.withinWorkingHours,
		isRoutable: resolved.isRoutable,
		isAcceptingNotifications: resolved.isAcceptingNotifications,
		nextAvailableAt: resolved.nextAvailableAt,
		localTimeLabel: resolved.localTimeLabel,
		delegateUserId: resolved.delegateUserId
	}
}

export function useWorkspaceAvailability() {
	const workspace = useOptionalWorkspace()
	const engine = useOptionalSyncEngine()
	const currentUserId = workspace?.currentUserId ?? ''
	const rows = useOptionalCollectionItems<UserAvailabilityDto>(engine?.collections.userAvailability ?? null)
	const livePresenceByUser = useAvailabilityStore((s) => s.livePresenceByUser)
	const nowTick = useAvailabilityStore((s) => s.nowTick)
	const [hydrating, setHydrating] = useState(false)
	const [hydrationError, setHydrationError] = useState<string | null>(null)

	useEffect(() => retainAvailabilityTicker(), [])

	const hasMine = currentUserId.length > 0 && rows.some((row) => row.userId === currentUserId)

	// Hydrate directly from REST if the local replica lacks the user's availability row
	// (e.g. legacy cached snapshot or first load after an older schema).
	useEffect(() => {
		if (!workspace || !engine || !currentUserId || hasMine) return
		let cancelled = false
		setHydrating(true)
		setHydrationError(null)
		void hydrateAvailabilityFromApi(`${engine.workspaceId}:${currentUserId}`, workspace, engine)
			.catch((err) => {
				if (!cancelled) {
					setHydrationError(err instanceof Error ? err.message : 'Could not load availability')
				}
			})
			.finally(() => {
				if (!cancelled) setHydrating(false)
			})
		return () => {
			cancelled = true
		}
	}, [currentUserId, engine, hasMine, workspace])

	const byUser = useMemo(() => {
		const atIso = new Date(nowTick).toISOString()
		const map = new Map<string, UserAvailabilityDto>()
		for (const row of rows) {
			const presence = livePresenceByUser[row.userId]?.status ?? 'offline'
			map.set(row.userId, recompute(row, presence, atIso))
		}
		return map
	}, [rows, livePresenceByUser, nowTick])

	const refreshMyAvailability = useCallback(async () => {
		if (!workspace || !engine || !currentUserId) return null
		setHydrating(true)
		setHydrationError(null)
		try {
			await hydrateAvailabilityFromApi(`${engine.workspaceId}:${currentUserId}`, workspace, engine)
			return engine.collections.userAvailability.get(currentUserId) ?? null
		} catch (err) {
			setHydrationError(err instanceof Error ? err.message : 'Could not load availability')
			return null
		} finally {
			setHydrating(false)
		}
	}, [currentUserId, engine, workspace])

	const updateMyAvailability = useCallback(
		async (patch: UpdateMyAvailabilityBody) => {
			if (!engine) return null
			const online =
				engine.getStatus().online && (typeof navigator === 'undefined' || navigator.onLine !== false)
			if (workspace && online) {
				const saved = await workspace.api.updateMyAvailability(patch)
				await engine.syncUserAvailabilityRow(saved)
				return saved
			}
			return engine.updateMyAvailability(patch)
		},
		[engine, workspace]
	)

	return {
		currentUserId,
		rows,
		byUser,
		myAvailability: byUser.get(currentUserId) ?? null,
		hydrating,
		hydrationError,
		refreshMyAvailability,
		updateMyAvailability
	}
}

export function useUserAvailability(userId: string | null | undefined): UserAvailabilityDto | null {
	const { byUser } = useWorkspaceAvailability()
	return userId ? (byUser.get(userId) ?? null) : null
}

export function useMyAvailability(): UserAvailabilityDto | null {
	return useWorkspaceAvailability().myAvailability
}

/**
 * Shared auto-idle wiring: DOM activity + visibility → WS presence heartbeat.
 * Manual overrides are unaffected because they live in the durable row and win
 * in the precedence ladder.
 */
export function usePresenceAutoIdle(): void {
	const engine = useSyncEngine()
	const status = useSyncStatus()

	useEffect(() => {
		if (typeof document === 'undefined') return
		const controller = new PresenceActivityController({
			sendPresence: (presence) => engine.sendPresence(presence)
		})
		controller.setHidden(document.visibilityState === 'hidden')
		controller.start()
		const activity = () => controller.noteActivity()
		const onVisibility = () => controller.setHidden(document.visibilityState === 'hidden')
		document.addEventListener('pointerdown', activity, { passive: true })
		document.addEventListener('keydown', activity)
		document.addEventListener('visibilitychange', onVisibility)
		return () => {
			document.removeEventListener('pointerdown', activity)
			document.removeEventListener('keydown', activity)
			document.removeEventListener('visibilitychange', onVisibility)
			controller.stop()
		}
	}, [engine])

	// Replay current presence after a signal-plane reconnect.
	useEffect(() => {
		if (status.wsConnected) engine.sendPresence('online')
	}, [engine, status.wsConnected])
}
