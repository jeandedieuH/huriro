import type { EffectiveAvailabilityState, UserAvailabilityDto } from '@huriro/contracts'
import { lightTheme } from '@huriro/design-tokens/rn-theme'
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

export interface AvailabilityColorPalette {
	readonly success: string
	readonly warning: string
	readonly danger: string
	readonly info: string
	readonly muted: string
}

/** Map an effective user availability state onto the active Huriro semantic color palette. */
export function resolveAvailabilityColor(
	state: EffectiveAvailabilityState,
	colors: AvailabilityColorPalette
): string {
	switch (state) {
		case 'available':
			return colors.success
		case 'busy':
		case 'away':
			return colors.warning
		case 'dnd':
			return colors.danger
		case 'off_hours':
		case 'ooo':
			return colors.info
		default:
			return colors.muted
	}
}

export function availabilityColor(state: EffectiveAvailabilityState): string {
	return resolveAvailabilityColor(state, {
		success: lightTheme.colors['success'] ?? '#25984d',
		warning: lightTheme.colors['warning'] ?? '#dfa11a',
		danger: lightTheme.colors['destructive'] ?? '#d73431',
		info: lightTheme.colors['info'] ?? '#008fd6',
		muted: lightTheme.colors['muted-foreground'] ?? '#52555b'
	})
}
