/**
 * Store ↔ router navigation bridge (§17.2 — strictly 5 primary destinations).
 *
 * The router owns the URL; `ui-store.destination` is a read-only mirror for
 * non-React consumers (command palette, `G`-chords, tests). Callers keep using
 * `setDestination()` — it navigates here — while `__root` registers the live
 * navigate fn and syncs pathname → destination, so tests render components
 * without a RouterProvider (`navigate` is a no-op until registered).
 */
import type { AppDestination } from '@/stores/ui-store'

export const DESTINATION_PATHS = {
	inbox: '/inbox',
	tasks: '/tasks',
	docs: '/docs',
	chat: '/chat',
	settings: '/settings'
} as const satisfies Record<AppDestination, string>

export const AUTH_PATHS = ['/sign-in', '/sign-up', '/setup', '/onboarding'] as const
export type AuthPath = (typeof AUTH_PATHS)[number]

export function isAuthPathname(pathname: string): boolean {
	return AUTH_PATHS.some((path) => pathname === path || pathname.startsWith(`${path}/`))
}

/**
 * Validate a post-auth redirect target so external URLs (`//evil.com`, `https://...`)
 * and auth-page loops are never followed.
 */
export function sanitizeRedirectPath(raw: string | undefined): string {
	if (!raw) return '/tasks'
	const trimmed = raw.trim()
	if (!trimmed.startsWith('/') || trimmed.startsWith('//')) return '/tasks'
	const pathname = trimmed.split('?')[0] ?? '/'
	if (pathname === '/' || isAuthPathname(pathname)) return '/tasks'
	return trimmed
}

export function destinationFromPathname(pathname: string): AppDestination {
	const seg = pathname.split('/')[1]
	if (seg === 'inbox' || seg === 'docs' || seg === 'chat' || seg === 'settings') return seg
	return 'tasks'
}

type NavigateFn = (dest: AppDestination) => void
type DocNavigateFn = (slug: string, hash?: string) => void
let navigateFn: NavigateFn | null = null
let docNavigateFn: DocNavigateFn | null = null

export function registerAppNavigator(fn: NavigateFn | null) {
	navigateFn = fn
}

export function registerDocNavigator(fn: DocNavigateFn | null) {
	docNavigateFn = fn
}

export function navigateToDestination(dest: AppDestination) {
	navigateFn?.(dest)
}

export function navigateToDoc(slug: string, hash?: string) {
	if (docNavigateFn) {
		docNavigateFn(slug, hash)
	} else {
		navigateFn?.('docs')
	}
}
