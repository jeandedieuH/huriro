import { activateI18n } from '@huriro/i18n'
import { SyncProvider } from '@huriro/sync-client'
import { createContext, type ReactNode, useCallback, useContext, useEffect, useState } from 'react'
import { AppState } from 'react-native'
import { useMobileUiStore } from '../stores/mobile-ui-store'
import { type MobileAuthSession, MobileAuthStore } from './auth-store'
import { bootstrapMobileRuntime, type MobileRuntime } from './workspace-bootstrap'

activateI18n('en')

interface MobileRuntimeContextValue {
	readonly runtime: MobileRuntime | null
	readonly loading: boolean
	readonly signInWithSession: (session: MobileAuthSession) => Promise<void>
	readonly enterPreview: () => Promise<void>
	readonly signOut: () => Promise<void>
}

const MobileRuntimeContext = createContext<MobileRuntimeContextValue | null>(null)
const authStore = new MobileAuthStore()

export function MobileRuntimeProvider({ children }: { readonly children: ReactNode }) {
	const [runtime, setRuntime] = useState<MobileRuntime | null>(null)
	const [loading, setLoading] = useState(true)
	const setSession = useMobileUiStore((s) => s.setSession)

	const boot = useCallback(
		async (opts: { readonly session?: MobileAuthSession | null; readonly preview?: boolean }) => {
			setLoading(true)
			try {
				const rt = await bootstrapMobileRuntime(opts)
				setRuntime((prev) => {
					prev?.dispose()
					return rt
				})
				setSession(opts.session ?? null, rt.isPreview)
			} finally {
				setLoading(false)
			}
		},
		[setSession]
	)

	useEffect(() => {
		let cancelled = false
		void authStore.loadSession().then(async (saved) => {
			if (cancelled) return
			if (saved) {
				await boot({ session: saved })
			} else {
				setLoading(false)
			}
		})
		return () => {
			cancelled = true
		}
	}, [boot])

	useEffect(() => {
		if (!runtime) return
		const sub = AppState.addEventListener('change', (nextState) => {
			if (nextState === 'active') {
				void runtime.engine.resume()
			}
		})
		return () => {
			sub.remove()
		}
	}, [runtime])

	const signInWithSession = useCallback(
		async (session: MobileAuthSession) => {
			await authStore.saveSession(session)
			await boot({ session })
		},
		[boot]
	)

	const enterPreview = useCallback(async () => {
		await authStore.clearSession()
		await boot({ preview: true })
	}, [boot])

	const signOut = useCallback(async () => {
		await authStore.clearSession()
		if (runtime) {
			await runtime.engine.signOutAndWipe()
		}
		setRuntime(null)
		setSession(null, false)
	}, [runtime, setSession])

	return (
		<MobileRuntimeContext.Provider
			value={{
				runtime,
				loading,
				signInWithSession,
				enterPreview,
				signOut
			}}
		>
			{runtime ? <SyncProvider engine={runtime.engine}>{children}</SyncProvider> : children}
		</MobileRuntimeContext.Provider>
	)
}

export function useMobileRuntime(): MobileRuntimeContextValue {
	const ctx = useContext(MobileRuntimeContext)
	if (!ctx) throw new Error('useMobileRuntime must be used inside MobileRuntimeProvider')
	return ctx
}
