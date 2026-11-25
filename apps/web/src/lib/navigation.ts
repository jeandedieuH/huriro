/**
 * Store ↔ router navigation bridge (§17.2 — Home + primary destinations).
 *
 * The router owns the URL; `ui-store.destination` is a read-only mirror for
 * non-React consumers (command palette, `G`-chords, tests). Callers keep using
 * `setDestination()` — it navigates here — while `__root` registers the live
 * navigate fn and syncs pathname → destination, so tests render components
 * without a RouterProvider (`navigate` is a no-op until registered).
 */
import type { AppDestination } from '@/stores/ui-store'

export const DESTINATION_PATHS = {
	home: '/',
	inbox: '/inbox',
	tasks: '/tasks',
	docs: '/docs',
	chat: '/chat',
	settings: '/settings'
} as const satisfies Record<AppDestination, string>

export const AUTH_PATHS = [
	'/sign-in',
	'/sign-up',
	'/setup',
	'/onboarding',
	'/forgot-password',
	'/reset-password',
	'/verify-email'
] as const
export type AuthPath = (typeof AUTH_PATHS)[number]

export function isAuthPathname(pathname: string): boolean {
	return AUTH_PATHS.some((path) => pathname === path || pathname.startsWith(`${path}/`))
}

/** Public published doc SSR routes (`/p/:workspaceSlug/:publicSlug`) render without workspace bootstrap or auth gates. */
export function isPublicDocPathname(pathname: string): boolean {
	return pathname === '/p' || pathname.startsWith('/p/')
}

/** While signed in without a workspace, `/setup` stays reachable iff instance bootstrap is still pending, and `/verify-email` stays accessible. */
export function isAllowedOnboardingPath(pathname: string, needsSetup: boolean): boolean {
	return pathname === '/onboarding' || pathname === '/verify-email' || (needsSetup && pathname === '/setup')
}

/**
 * Validate a post-auth redirect target so external URLs (`//evil.com`, `https://...`)
 * and auth-page loops are never followed.
 */
export function sanitizeRedirectPath(raw: string | undefined): string {
	if (!raw) return '/'
	const trimmed = raw.trim()
	if (!trimmed.startsWith('/') || trimmed.startsWith('//')) return '/'
	const pathname = trimmed.split('?')[0] ?? '/'
	if (isAuthPathname(pathname)) return '/'
	return trimmed
}

export function destinationFromPathname(pathname: string): AppDestination {
	const seg = pathname.split('/')[1]
	if (seg === 'inbox' || seg === 'mail') return 'inbox'
	if (seg === 'tasks' || seg === 'docs' || seg === 'chat' || seg === 'settings') return seg
	return 'home'
}

type NavigateFn = (dest: AppDestination) => void
type DocNavigateFn = (slug: string, hash?: string) => void
type ChatNavigateFn = (channelId?: string, messageId?: string) => void
type MailNavigateFn = (conversationId?: string) => void
type SettingsSectionNavigateFn = (section: string) => void
let navigateFn: NavigateFn | null = null
let docNavigateFn: DocNavigateFn | null = null
let chatNavigateFn: ChatNavigateFn | null = null
let mailNavigateFn: MailNavigateFn | null = null
let settingsSectionNavigateFn: SettingsSectionNavigateFn | null = null

export function registerAppNavigator(fn: NavigateFn | null) {
	navigateFn = fn
}

export function registerDocNavigator(fn: DocNavigateFn | null) {
	docNavigateFn = fn
}

export function registerChatNavigator(fn: ChatNavigateFn | null) {
	chatNavigateFn = fn
}

export function registerMailNavigator(fn: MailNavigateFn | null) {
	mailNavigateFn = fn
}

export function registerSettingsSectionNavigator(fn: SettingsSectionNavigateFn | null) {
	settingsSectionNavigateFn = fn
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

export function navigateToChat(channelId?: string, messageId?: string) {
	if (chatNavigateFn) {
		chatNavigateFn(channelId, messageId)
	} else {
		navigateFn?.('chat')
	}
}

export function navigateToMail(conversationId?: string) {
	if (mailNavigateFn) {
		mailNavigateFn(conversationId)
	} else {
		navigateFn?.('inbox')
	}
}

export function navigateToSettingsSection(section: string) {
	settingsSectionNavigateFn?.(section)
}
