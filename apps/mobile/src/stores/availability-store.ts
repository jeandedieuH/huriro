import type { EffectiveAvailabilityState, UserAvailabilityDto } from '@huriro/contracts'
import { create } from 'zustand'

interface MobileAvailabilityState {
	myAvailability: UserAvailabilityDto | null
	byUser: Record<string, UserAvailabilityDto>
	livePresence: Record<string, { status: 'online' | 'away'; lastSeenAt: number }>
	setMyAvailability: (row: UserAvailabilityDto | null) => void
	setWorkspaceAvailability: (rows: readonly UserAvailabilityDto[]) => void
	setPresence: (users: readonly { userId: string; status: 'online' | 'away'; lastSeenAt: number }[]) => void
}

export const useMobileAvailabilityStore = create<MobileAvailabilityState>((set) => ({
	myAvailability: null,
	byUser: {},
	livePresence: {},
	setMyAvailability: (myAvailability) =>
		set((state) => ({
			myAvailability,
			byUser: myAvailability ? { ...state.byUser, [myAvailability.userId]: myAvailability } : state.byUser
		})),
	setWorkspaceAvailability: (rows) =>
		set({ byUser: Object.fromEntries(rows.map((row) => [row.userId, row])) }),
	setPresence: (users) => set({ livePresence: Object.fromEntries(users.map((user) => [user.userId, user])) })
}))

export function availabilityColor(state: EffectiveAvailabilityState): string {
	switch (state) {
		case 'available':
			return '#16a34a'
		case 'busy':
			return '#d97706'
		case 'dnd':
			return '#dc2626'
		case 'off_hours':
		case 'ooo':
			return '#2563eb'
		case 'away':
			return '#ca8a04'
		default:
			return '#71717a'
	}
}
