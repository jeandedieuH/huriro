import type { MobilePushTokenDto } from '@huriro/contracts'
import { create } from 'zustand'
import type { MobileAuthSession } from '../lib/auth-store'

export interface MobileUiState {
	readonly session: MobileAuthSession | null
	readonly isPreview: boolean
	readonly isOnline: boolean
	readonly registeredPush: MobilePushTokenDto | null
	readonly setSession: (session: MobileAuthSession | null, isPreview?: boolean) => void
	readonly setOnline: (online: boolean) => void
	readonly setRegisteredPush: (push: MobilePushTokenDto | null) => void
}

export const useMobileUiStore = create<MobileUiState>((set) => ({
	session: null,
	isPreview: false,
	isOnline: true,
	registeredPush: null,
	setSession: (session, isPreview = false) => set({ session, isPreview }),
	setOnline: (isOnline) => set({ isOnline }),
	setRegisteredPush: (registeredPush) => set({ registeredPush })
}))
