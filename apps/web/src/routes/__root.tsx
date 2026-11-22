import { activateI18n, i18n, t } from '@huriro/i18n'
import { SyncProvider, useCollectionItems, useSyncEngine } from '@huriro/sync-client'
import { I18nProvider } from '@lingui/react'
import {
	createRootRoute,
	HeadContent,
	Outlet,
	Scripts,
	useNavigate,
	useRouterState
} from '@tanstack/react-router'
import { type ReactNode, useEffect, useMemo, useRef, useState } from 'react'
import { AppShell } from '@/components/app-shell/app-shell'
import { Skeleton } from '@/components/ui/skeleton'
import { Toaster } from '@/components/ui/toast'
import { AuthGate } from '@/features/auth/components/auth-gate'
import { AuthLayout } from '@/features/auth/components/auth-layout'
import { OnboardingForm } from '@/features/auth/components/onboarding-form'
import { AuthFlowProvider } from '@/features/auth/context'
import { ImportDialog } from '@/features/imports/components/import-dialog'
import { ShortcutsDialog } from '@/features/keyboard/shortcuts-dialog'
import { CommandPalette } from '@/features/search/components/command-palette'
import { ConflictResolverDialog } from '@/features/sync/components/conflict-resolver-dialog'
import { SyncStatusBanner } from '@/features/sync/components/sync-status-banner'
import { type SocialProviderId, signOut } from '@/lib/auth'
import {
	DESTINATION_PATHS,
	destinationFromPathname,
	isAuthPathname,
	registerAppNavigator,
	registerDocNavigator,
	sanitizeRedirectPath
} from '@/lib/navigation'
import {
	type BootstrappedWorkspace,
	bootstrapWorkspace,
	isAuthRequired,
	isOnboardingRequired,
	type OnboardingRequired
} from '@/lib/sync-bootstrap'
import { useWorkspace, WorkspaceProvider } from '@/lib/workspace'
import { useUiStore } from '@/stores/ui-store'
import globalsCss from '@/styles/globals.css?url'

activateI18n('en')

export const Route = createRootRoute({
	head: () => ({
		meta: [
			{ charSet: 'utf-8' },
			{ name: 'viewport', content: 'width=device-width, initial-scale=1' },
			{ title: 'Huriro' }
		],
		links: [
			{ rel: 'stylesheet', href: globalsCss },
			{ rel: 'icon', type: 'image/png', href: '/images/icon.png' },
			{ rel: 'apple-touch-icon', href: '/images/icon.png' }
		]
	}),
	shellComponent: RootDocument,
	component: RootComponent
})

// Always SSR'd document shell — app content is client-only (start.ts: defaultSsr).
function RootDocument({ children }: { readonly children: ReactNode }) {
	return (
		<html lang="en">
			<head>
				<HeadContent />
			</head>
			<body>
				{children}
				<Scripts />
			</body>
		</html>
	)
}

type BootPhase =
	| { readonly kind: 'booting' }
	| {
			readonly kind: 'auth'
			readonly needsSetup: boolean
			readonly socialProviders: readonly SocialProviderId[]
	  }
	| {
			readonly kind: 'onboarding'
			readonly needsSetup: boolean
			readonly user: OnboardingRequired['user']
	  }
	| { readonly kind: 'ready'; readonly boot: BootstrappedWorkspace }

function RootComponent() {
	const navigate = useNavigate()
	const [phase, setPhase] = useState<BootPhase>({ kind: 'booting' })
	// Bumped by auth/onboarding actions to re-run bootstrap; preview bypasses the api probe.
	const [bootAttempt, setBootAttempt] = useState(0)
	const preferPreview = useRef(false)
	const pendingRedirectRef = useRef<string | null>(null)

	// URL is the source of truth; keep the store's `destination` mirror in sync.
	const pathname = useRouterState({ select: (s) => s.location.pathname })
	useEffect(() => {
		if (isAuthPathname(pathname)) return
		const dest = destinationFromPathname(pathname)
		if (useUiStore.getState().destination !== dest) {
			useUiStore.setState({ destination: dest })
		}
	}, [pathname])

	// Bridge store-mediated navigation (sidebar, palette, G-chords, docs) to the router.
	useEffect(() => {
		registerAppNavigator((dest) => void navigate({ to: DESTINATION_PATHS[dest] }))
		registerDocNavigator((slug, hash) => {
			void navigate({
				to: '/docs/$slug',
				params: { slug },
				...(hash ? { hash } : {})
			})
		})
		return () => {
			registerAppNavigator(null)
			registerDocNavigator(null)
		}
	}, [navigate])

	// biome-ignore lint/correctness/useExhaustiveDependencies: bootAttempt is the re-run trigger bumped by auth/onboarding actions, not a referenced value
	useEffect(() => {
		let cancelled = false
		let activeBoot: BootstrappedWorkspace | null = null
		void bootstrapWorkspace({ preferPreview: preferPreview.current }).then((result) => {
			if (cancelled) {
				if (!isAuthRequired(result) && !isOnboardingRequired(result)) result.engine.dispose()
				return
			}
			if (isAuthRequired(result)) {
				setPhase({
					kind: 'auth',
					needsSetup: result.needsSetup,
					socialProviders: result.socialProviders
				})
				return
			}
			if (isOnboardingRequired(result)) {
				setPhase({
					kind: 'onboarding',
					needsSetup: result.needsSetup,
					user: result.user
				})
				return
			}
			activeBoot = result
			setPhase({ kind: 'ready', boot: result })
		})
		return () => {
			cancelled = true
			activeBoot?.engine.dispose()
		}
	}, [bootAttempt])

	// Keep the browser URL synchronized with the current auth/onboarding/workspace phase.
	useEffect(() => {
		if (phase.kind === 'auth') {
			if (!isAuthPathname(pathname) || pathname === '/onboarding') {
				const redirectTarget = pathname !== '/' && !isAuthPathname(pathname) ? pathname : undefined
				void navigate({
					to: phase.needsSetup ? '/setup' : '/sign-in',
					...(redirectTarget ? { search: { redirect: redirectTarget } } : {}),
					replace: true
				})
			}
			return
		}
		if (phase.kind === 'onboarding') {
			if (pathname !== '/onboarding') {
				const redirectTarget = pendingRedirectRef.current ?? undefined
				void navigate({
					to: '/onboarding',
					...(redirectTarget ? { search: { redirect: redirectTarget } } : {}),
					replace: true
				})
			}
			return
		}
		if (phase.kind === 'ready' && !phase.boot.isPreview && isAuthPathname(pathname)) {
			const target = pendingRedirectRef.current ?? '/tasks'
			pendingRedirectRef.current = null
			void navigate({ href: target, replace: true })
		}
	}, [phase, pathname, navigate])

	function handleAuthenticated(redirectTo?: string) {
		pendingRedirectRef.current = sanitizeRedirectPath(redirectTo)
		preferPreview.current = false
		setBootAttempt((n) => n + 1)
	}

	function handleUsePreview() {
		preferPreview.current = true
		setBootAttempt((n) => n + 1)
		if (isAuthPathname(pathname)) {
			void navigate({ to: '/tasks', replace: true })
		}
	}

	async function handleSignOut() {
		try {
			await signOut()
		} finally {
			window.location.reload()
		}
	}

	const authFlowValue = {
		needsSetup: phase.kind === 'auth' || phase.kind === 'onboarding' ? phase.needsSetup : false,
		socialProviders: phase.kind === 'auth' ? phase.socialProviders : [],
		onboardingUser: phase.kind === 'onboarding' ? phase.user : null,
		onAuthenticated: handleAuthenticated,
		onUsePreview: handleUsePreview,
		onSignOut: handleSignOut,
		onNavigate: (
			path: '/sign-in' | '/sign-up' | '/setup' | '/onboarding',
			search?: { readonly redirect?: string | undefined }
		) => {
			void navigate({
				to: path,
				...(search?.redirect ? { search: { redirect: search.redirect } } : {})
			})
		}
	}

	if (phase.kind === 'ready' && !(phase.boot.isPreview && isAuthPathname(pathname))) {
		if (!phase.boot.isPreview && isAuthPathname(pathname)) {
			return (
				<I18nProvider i18n={i18n}>
					<AppShell activeNav="tasks">
						<div className="space-y-3 p-6">
							<Skeleton className="h-8 w-64" />
							<Skeleton className="h-40 w-full" />
						</div>
					</AppShell>
				</I18nProvider>
			)
		}
		return (
			<I18nProvider i18n={i18n}>
				<SyncProvider engine={phase.boot.engine}>
					<WorkspaceProvider boot={phase.boot}>
						<WorkspaceFrame />
					</WorkspaceProvider>
				</SyncProvider>
			</I18nProvider>
		)
	}

	if (phase.kind === 'booting') {
		return (
			<I18nProvider i18n={i18n}>
				{isAuthPathname(pathname) ? (
					<div className="flex min-h-dvh items-center justify-center bg-background p-6">
						<div className="w-full max-w-md space-y-4">
							<Skeleton className="h-7 w-40" />
							<Skeleton className="h-4 w-64" />
							<Skeleton className="h-80 w-full rounded-xl" />
						</div>
					</div>
				) : (
					<AppShell activeNav="tasks">
						<div className="space-y-3 p-6">
							<Skeleton className="h-8 w-64" />
							<Skeleton className="h-40 w-full" />
						</div>
					</AppShell>
				)}
			</I18nProvider>
		)
	}

	if (phase.kind === 'onboarding') {
		return (
			<I18nProvider i18n={i18n}>
				<AuthFlowProvider value={authFlowValue}>
					{pathname === '/onboarding' ? (
						<Outlet />
					) : (
						<AuthLayout
							title={t('auth.onboarding.title')}
							subtitle={t('auth.onboarding.subtitle')}
							onUsePreview={handleUsePreview}
						>
							<OnboardingForm
								user={phase.user}
								needsSetup={phase.needsSetup}
								redirectTo={pendingRedirectRef.current ?? undefined}
								onComplete={handleAuthenticated}
								onSignOut={handleSignOut}
							/>
						</AuthLayout>
					)}
				</AuthFlowProvider>
			</I18nProvider>
		)
	}

	if (phase.kind === 'auth') {
		const isStandaloneAuthRoute = isAuthPathname(pathname) && pathname !== '/onboarding'
		const redirectTarget = pathname !== '/' && !isAuthPathname(pathname) ? pathname : undefined
		return (
			<I18nProvider i18n={i18n}>
				<AuthFlowProvider value={authFlowValue}>
					{isStandaloneAuthRoute ? (
						<Outlet />
					) : (
						<AuthGate
							needsSetup={phase.needsSetup}
							socialProviders={phase.socialProviders}
							redirectTo={redirectTarget}
							onAuthenticated={handleAuthenticated}
							onUsePreview={handleUsePreview}
						/>
					)}
				</AuthFlowProvider>
			</I18nProvider>
		)
	}

	// Preview mode explicitly inspecting an auth route (/sign-in, /sign-up, /setup, /onboarding).
	return (
		<I18nProvider i18n={i18n}>
			<AuthFlowProvider value={authFlowValue}>
				<Outlet />
			</AuthFlowProvider>
		</I18nProvider>
	)
}

function WorkspaceFrame() {
	const { api, isPreview, userDisplayName } = useWorkspace()
	const engine = useSyncEngine()
	const notifications = useCollectionItems(engine.collections.notifications)

	const destination = useUiStore((s) => s.destination)
	const setDestination = useUiStore((s) => s.setDestination)
	const theme = useUiStore((s) => s.theme)
	const toggleTheme = useUiStore((s) => s.toggleTheme)
	const setCommandPaletteOpen = useUiStore((s) => s.setCommandPaletteOpen)
	const setCreateIssueOpen = useUiStore((s) => s.setCreateIssueOpen)
	const setCreateDocOpen = useUiStore((s) => s.setCreateDocOpen)
	const setShortcutsDialogOpen = useUiStore((s) => s.setShortcutsDialogOpen)
	const toasts = useUiStore((s) => s.toasts)
	const dismissToast = useUiStore((s) => s.dismissToast)

	const unreadCount = useMemo(
		() => notifications.filter((n) => n.archivedAt === null && n.readAt === null).length,
		[notifications]
	)

	return (
		<>
			<AppShell
				activeNav={destination}
				inboxUnreadCount={unreadCount}
				isPreview={isPreview}
				theme={theme}
				userName={userDisplayName}
				onSelectNav={setDestination}
				onOpenCommandPalette={() => setCommandPaletteOpen(true)}
				onCreateNew={() => (destination === 'docs' ? setCreateDocOpen(true) : setCreateIssueOpen(true))}
				onToggleTheme={toggleTheme}
				onOpenShortcuts={() => setShortcutsDialogOpen(true)}
				onSignOut={
					isPreview
						? undefined
						: async () => {
								// Reload after sign-out: the boot gate re-probes and lands on sign-in.
								try {
									await signOut()
								} finally {
									window.location.reload()
								}
							}
				}
			>
				<SyncStatusBanner />

				<div className="min-h-0 flex-1 overflow-y-auto">
					<Outlet />
				</div>
			</AppShell>

			<CommandPalette api={api} />
			<ConflictResolverDialog />
			<ShortcutsDialog />
			<ImportDialog api={api} />

			<Toaster toasts={toasts} onDismiss={dismissToast} />
		</>
	)
}
