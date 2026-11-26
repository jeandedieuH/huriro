import type { UserAvailabilityDto } from '@huriro/contracts'
import { resolveEffectiveAvailability } from '@huriro/domain'
import {
	PresenceActivityController,
	useOptionalSyncEngine,
	useSyncEngine,
	useSyncStatus
} from '@huriro/sync-client'
import { useCallback, useEffect, useMemo, useState } from 'react'
import { useOptionalWorkspace } from '@/lib/workspace'
import { useAvailabilityStore } from '../store/availability-store'

interface ObservableView<T> {
	readonly toArray: T[]
	subscribeChanges(callback: () => void, opts: { includeInitialState: boolean }): { unsubscribe(): void }
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

	useEffect(() => {
		const id = setInterval(() => useAvailabilityStore.getState().tick(), 60_000)
		return () => clearInterval(id)
	}, [])

	const byUser = useMemo(() => {
		const atIso = new Date(nowTick).toISOString()
		const map = new Map<string, UserAvailabilityDto>()
		for (const row of rows) {
			const presence = livePresenceByUser[row.userId]?.status ?? 'offline'
			map.set(row.userId, recompute(row, presence, atIso))
		}
		return map
	}, [rows, livePresenceByUser, nowTick])

	const updateMyAvailability = useCallback(
		async (patch: Parameters<NonNullable<typeof engine>['updateMyAvailability']>[0]) => {
			if (!engine) return null
			return engine.updateMyAvailability(patch)
		},
		[engine]
	)

	return {
		currentUserId,
		rows,
		byUser,
		myAvailability: byUser.get(currentUserId) ?? null,
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
