import { activateI18n, i18n } from '@huriro/i18n'
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
import { type ReactNode, useEffect, useMemo, useState } from 'react'
import { AppShell } from '@/components/app-shell/app-shell'
import { Skeleton } from '@/components/ui/skeleton'
import { Toaster } from '@/components/ui/toast'
import { ImportDialog } from '@/features/imports/components/import-dialog'
import { ShortcutsDialog } from '@/features/keyboard/shortcuts-dialog'
import { CommandPalette } from '@/features/search/components/command-palette'
import { ConflictResolverDialog } from '@/features/sync/components/conflict-resolver-dialog'
import { SyncStatusBanner } from '@/features/sync/components/sync-status-banner'
import { DESTINATION_PATHS, destinationFromPathname, registerAppNavigator } from '@/lib/navigation'
import { type BootstrappedWorkspace, bootstrapWorkspace } from '@/lib/sync-bootstrap'
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
		links: [{ rel: 'stylesheet', href: globalsCss }]
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

function RootComponent() {
	const navigate = useNavigate()
	const [boot, setBoot] = useState<BootstrappedWorkspace | null>(null)

	// URL is the source of truth; keep the store's `destination` mirror in sync.
	const pathname = useRouterState({ select: (s) => s.location.pathname })
	useEffect(() => {
		const dest = destinationFromPathname(pathname)
		if (useUiStore.getState().destination !== dest) {
			useUiStore.setState({ destination: dest })
		}
	}, [pathname])

	// Bridge store-mediated navigation (sidebar, palette, G-chords) to the router.
	useEffect(() => {
		registerAppNavigator((dest) => void navigate({ to: DESTINATION_PATHS[dest] }))
		return () => registerAppNavigator(null)
	}, [navigate])

	useEffect(() => {
		let cancelled = false
		let activeBoot: BootstrappedWorkspace | null = null
		void bootstrapWorkspace().then((b) => {
			if (cancelled) {
				b.engine.dispose()
				return
			}
			activeBoot = b
			setBoot(b)
		})
		return () => {
			cancelled = true
			activeBoot?.engine.dispose()
		}
	}, [])

	return (
		<I18nProvider i18n={i18n}>
			{boot ? (
				<SyncProvider engine={boot.engine}>
					<WorkspaceProvider boot={boot}>
						<WorkspaceFrame />
					</WorkspaceProvider>
				</SyncProvider>
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

function WorkspaceFrame() {
	const { api, workspaceName, isPreview } = useWorkspace()
	const engine = useSyncEngine()
	const notifications = useCollectionItems(engine.collections.notifications)

	const destination = useUiStore((s) => s.destination)
	const setDestination = useUiStore((s) => s.setDestination)
	const theme = useUiStore((s) => s.theme)
	const toggleTheme = useUiStore((s) => s.toggleTheme)
	const setCommandPaletteOpen = useUiStore((s) => s.setCommandPaletteOpen)
	const setCreateIssueOpen = useUiStore((s) => s.setCreateIssueOpen)
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
				workspaceName={workspaceName}
				inboxUnreadCount={unreadCount}
				isPreview={isPreview}
				theme={theme}
				onSelectNav={setDestination}
				onOpenCommandPalette={() => setCommandPaletteOpen(true)}
				onCreateNew={() => setCreateIssueOpen(true)}
				onToggleTheme={toggleTheme}
				onOpenShortcuts={() => setShortcutsDialogOpen(true)}
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
