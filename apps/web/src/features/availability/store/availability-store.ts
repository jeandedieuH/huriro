import { create } from 'zustand'

export interface LivePresenceEntry {
	readonly status: 'online' | 'away'
	readonly lastSeenAt: number
}

export interface AvailabilityStoreState {
	livePresenceByUser: Record<string, LivePresenceEntry>
	nowTick: number
	setPresence: (users: readonly ({ readonly userId: string } & LivePresenceEntry)[]) => void
	tick: () => void
}

/**
 * Ephemeral WS presence + a 60s clock tick for relative labels. Durable
 * availability lives in the TanStack DB `userAvailability` collection — this
 * store never mirrors it.
 */
export const useAvailabilityStore = create<AvailabilityStoreState>((set) => ({
	livePresenceByUser: {},
	nowTick: Date.now(),
	setPresence: (users) => {
		const next: Record<string, LivePresenceEntry> = {}
		for (const user of users) {
			next[user.userId] = { status: user.status, lastSeenAt: user.lastSeenAt }
		}
		set({ livePresenceByUser: next })
	},
	tick: () => set({ nowTick: Date.now() })
}))

let tickerListeners = 0
let tickerId: ReturnType<typeof setInterval> | null = null

/** Ref-counted 60s ticker shared across all availability hooks/components. */
export function retainAvailabilityTicker(): () => void {
	tickerListeners += 1
	if (tickerListeners === 1 && tickerId === null) {
		tickerId = setInterval(() => {
			useAvailabilityStore.getState().tick()
		}, 60_000)
	}
	return () => {
		tickerListeners = Math.max(0, tickerListeners - 1)
		if (tickerListeners === 0 && tickerId !== null) {
			clearInterval(tickerId)
			tickerId = null
		}
	}
}
