import { createContext, type MouseEvent, type ReactNode, useContext } from 'react'
import type { SocialProviderId } from '@/lib/auth'
import type { AuthPath } from '@/lib/navigation'
import type { OnboardingRequired } from '@/lib/sync-bootstrap'

export interface AuthFlowContextValue {
	readonly needsSetup: boolean
	readonly socialProviders: readonly SocialProviderId[]
	readonly onboardingUser: OnboardingRequired['user'] | null
	readonly onAuthenticated: (redirectTo?: string) => void
	readonly onUsePreview: () => void
	readonly onSignOut: () => Promise<void>
	readonly onNavigate: (path: AuthPath, search?: { readonly redirect?: string | undefined }) => void
}

const DEFAULT_AUTH_FLOW: AuthFlowContextValue = {
	needsSetup: false,
	socialProviders: [],
	onboardingUser: null,
	onAuthenticated: () => {},
	onUsePreview: () => {},
	onSignOut: async () => {},
	onNavigate: () => {}
}

const AuthFlowContext = createContext<AuthFlowContextValue>(DEFAULT_AUTH_FLOW)

export interface AuthFlowProviderProps {
	readonly value: AuthFlowContextValue
	readonly children: ReactNode
}

/**
 * Bridges auth routes/forms to `__root` boot state and TanStack Router navigation
 * while remaining safe to mount standalone in Vitest and Storybook.
 */
export function AuthFlowProvider({ value, children }: AuthFlowProviderProps) {
	return <AuthFlowContext.Provider value={value}>{children}</AuthFlowContext.Provider>
}

export function useAuthFlow(): AuthFlowContextValue {
	return useContext(AuthFlowContext)
}

export function buildAuthHref(to: AuthPath, redirect?: string): string {
	if (!redirect) return to
	const params = new URLSearchParams({ redirect })
	return `${to}?${params.toString()}`
}

export interface AuthNavLinkProps {
	readonly to: AuthPath
	readonly redirect?: string | undefined
	readonly className?: string | undefined
	readonly children: ReactNode
}

/**
 * Semantic anchor link between `/sign-in`, `/sign-up`, `/setup`, and `/onboarding`.
 * Left-clicks route in-app via `AuthFlowContext.onNavigate`; middle-clicks / new-tab
 * keep working natively via `href`.
 */
export function AuthNavLink({ to, redirect, className, children }: AuthNavLinkProps) {
	const { onNavigate } = useAuthFlow()

	function handleClick(event: MouseEvent<HTMLAnchorElement>) {
		if (event.defaultPrevented || event.button !== 0) return
		if (event.metaKey || event.altKey || event.ctrlKey || event.shiftKey) return
		event.preventDefault()
		onNavigate(to, redirect ? { redirect } : undefined)
	}

	return (
		<a href={buildAuthHref(to, redirect)} onClick={handleClick} className={className}>
			{children}
		</a>
	)
}
