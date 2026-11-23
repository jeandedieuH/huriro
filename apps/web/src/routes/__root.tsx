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
import { ChatSidebarNav } from '@/features/chat/components/chat-sidebar-nav'
import { selectTotalChatUnread, useChatStore } from '@/features/chat/store/chat-store'
import {
	DocsSidebarFooterUtility,
	DocsSidebarHeaderAction,
	DocsSidebarNav
} from '@/features/docs/components/docs-sidebar-nav'
import { ImportDialog } from '@/features/imports/components/import-dialog'
import { ShortcutsDialog } from '@/features/keyboard/shortcuts-dialog'
import { useKeyboardShortcuts } from '@/features/keyboard/use-keyboard-shortcuts'
import {
	InboxSidebarFooterUtility,
	InboxSidebarNav
} from '@/features/notifications/components/inbox-sidebar-nav'
import { CommandPalette } from '@/features/search/components/command-palette'
import { SettingsSidebarNav } from '@/features/settings/components/settings-sidebar-nav'
import { ConflictResolverDialog } from '@/features/sync/components/conflict-resolver-dialog'
import { SyncStatusBanner } from '@/features/sync/components/sync-status-banner'
import { TasksSidebarFooterUtility, TasksSidebarNav } from '@/features/tasks/components/tasks-sidebar-nav'
import { type SocialProviderId, signOut } from '@/lib/auth'
import {
	DESTINATION_PATHS,
	destinationFromPathname,
	isAuthPathname,
	registerAppNavigator,
	registerChatNavigator,
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
	// Only reset sidebarLevel when the destination actually changes so clicking `<`
	// to inspect the root menu isn't immediately overridden.
	const pathname = useRouterState({ select: (s) => s.location.pathname })
	useEffect(() => {
		if (isAuthPathname(pathname)) return
		const dest = destinationFromPathname(pathname)
		const current = useUiStore.getState()
		if (current.destination !== dest) {
			useUiStore.setState({
				destination: dest,
				sidebarLevel: dest === 'home' ? 'root' : 'feature'
			})
		}
	}, [pathname])

	// Bridge store-mediated navigation (sidebar, palette, G-chords, docs, chat) to the router.
	useEffect(() => {
		registerAppNavigator((dest) => void navigate({ to: DESTINATION_PATHS[dest] }))
		registerDocNavigator((slug, hash) => {
			void navigate({
				to: '/docs/$slug',
				params: { slug },
				...(hash ? { hash } : {})
			})
		})
		registerChatNavigator((channelId, messageId) => {
			void navigate({
				to: '/chat',
				...(channelId || messageId
					? {
							search: {
								...(channelId ? { channel: channelId } : {}),
								...(messageId ? { message: messageId } : {})
							}
						}
					: {})
			})
		})
		return () => {
			registerAppNavigator(null)
			registerDocNavigator(null)
			registerChatNavigator(null)
		}
	}, [navigate])

	// biome-ignore lint/correctness/useExhaustiveDependencies: bootAttempt is the re-run trigger bumped by auth/onboarding actions, not a referenced value
	useEffect(() => {
		let cancelled = false
		let activeBoot: BootstrappedWorkspace | null = null
		void bootstrapWorkspace({
			preferPreview: preferPreview.current,
			onChatSignal: (ev) => {
				if (activeBoot) void useChatStore.getState().handleChatSignal(activeBoot.api, ev)
			},
			onPresence: (users) => useChatStore.getState().applyPresence(users),
			onTyping: (ev) => useChatStore.getState().applyTyping(ev)
		}).then((result) => {
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
			const target = pendingRedirectRef.current ?? '/'
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
			void navigate({ to: '/', replace: true })
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
					<AppShell activeNav="home">
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
					<AppShell activeNav="home">
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

function GlobalShortcutsBridge() {
	useKeyboardShortcuts(useMemo(() => ({ orderedIssueIds: [] }), []))
	return null
}

function WorkspaceFrame() {
	const { api, isPreview, userDisplayName, workspaceName } = useWorkspace()
	const engine = useSyncEngine()
	const notifications = useCollectionItems(engine.collections.notifications)
	const pathname = useRouterState({ select: (s) => s.location.pathname })

	const destination = useUiStore((s) => s.destination)
	const sidebarLevel = useUiStore((s) => s.sidebarLevel)
	const sidebarCollapsed = useUiStore((s) => s.sidebarCollapsed)
	const setDestination = useUiStore((s) => s.setDestination)
	const setSidebarLevel = useUiStore((s) => s.setSidebarLevel)
	const toggleSidebarCollapsed = useUiStore((s) => s.toggleSidebarCollapsed)
	const theme = useUiStore((s) => s.theme)
	const toggleTheme = useUiStore((s) => s.toggleTheme)
	const setCommandPaletteOpen = useUiStore((s) => s.setCommandPaletteOpen)
	const setShortcutsDialogOpen = useUiStore((s) => s.setShortcutsDialogOpen)
	const toasts = useUiStore((s) => s.toasts)
	const dismissToast = useUiStore((s) => s.dismissToast)

	const unreadCount = useMemo(
		() => notifications.filter((n) => n.archivedAt === null && n.readAt === null).length,
		[notifications]
	)
	const chatChannels = useChatStore((s) => s.channels)
	const loadChatChannels = useChatStore((s) => s.loadChannels)
	const chatUnreadCount = useChatStore(selectTotalChatUnread)

	useEffect(() => {
		if (chatChannels.length === 0) {
			void loadChatChannels(api)
		}
	}, [api, chatChannels.length, loadChatChannels])

	const rawDocSlug = pathname.startsWith('/docs/')
		? (pathname.slice('/docs/'.length).split('/')[0] ?? '')
		: ''
	const activeDocSlug = rawDocSlug ? decodeURIComponent(rawDocSlug) : null

	const featureSlot = useMemo(() => {
		switch (destination) {
			case 'tasks':
				return {
					featureTitle: t('nav.tasks'),
					featureSidebar: <TasksSidebarNav />,
					featureFooterUtility: <TasksSidebarFooterUtility />
				}
			case 'docs':
				return {
					featureTitle: t('nav.docs'),
					featureSidebar: <DocsSidebarNav activeSlug={activeDocSlug} />,
					featureHeaderAction: <DocsSidebarHeaderAction />,
					featureFooterUtility: <DocsSidebarFooterUtility />
				}
			case 'inbox':
				return {
					featureTitle: t('nav.inbox'),
					featureSidebar: <InboxSidebarNav />,
					featureFooterUtility: <InboxSidebarFooterUtility />
				}
			case 'chat':
				return {
					featureTitle: t('nav.chat'),
					featureSidebar: <ChatSidebarNav />
				}
			case 'settings':
				return {
					featureTitle: t('nav.settings'),
					featureSidebar: <SettingsSidebarNav />
				}
			case 'home':
				return {}
		}
	}, [activeDocSlug, destination])

	return (
		<>
			{destination !== 'tasks' ? <GlobalShortcutsBridge /> : null}

			<AppShell
				activeNav={destination}
				sidebarLevel={sidebarLevel}
				sidebarCollapsed={sidebarCollapsed}
				workspaceName={workspaceName}
				inboxUnreadCount={unreadCount}
				chatUnreadCount={chatUnreadCount}
				isPreview={isPreview}
				theme={theme}
				userName={userDisplayName}
				{...featureSlot}
				onSelectNav={(dest) => {
					if (dest === destination && dest !== 'home') {
						setSidebarLevel('feature')
						return
					}
					setDestination(dest)
				}}
				onBackToRoot={() => setSidebarLevel('root')}
				onToggleSidebarCollapsed={toggleSidebarCollapsed}
				onOpenCommandPalette={() => setCommandPaletteOpen(true)}
				onToggleTheme={toggleTheme}
				onOpenShortcuts={() => setShortcutsDialogOpen(true)}
				onOpenSettings={() => setDestination('settings')}
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
