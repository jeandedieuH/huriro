/**
 * App shell (§17.9): fixed chrome — unified drill-down sidebar + responsive
 * mobile drawer — with only the content column scrolling.
 */
import { t } from '@huriro/i18n'
import { Menu, Search, X } from 'lucide-react'
import { type ReactNode, useEffect, useState } from 'react'
import type { AppDestination, SidebarLevel } from '@/stores/ui-store'
import { Sidebar } from './sidebar/sidebar'

export interface AppShellProps {
	readonly children: ReactNode
	readonly activeNav?: AppDestination | string
	readonly sidebarLevel?: SidebarLevel | undefined
	readonly sidebarCollapsed?: boolean | undefined
	readonly workspaceName?: string | undefined
	readonly inboxUnreadCount?: number | undefined
	readonly chatUnreadCount?: number | undefined
	readonly isPreview?: boolean | undefined
	readonly theme?: 'light' | 'dark' | undefined
	readonly userName?: string | undefined
	readonly featureTitle?: string | undefined
	readonly featureSidebar?: ReactNode | undefined
	readonly featureHeaderAction?: ReactNode | undefined
	readonly featureFooterUtility?: ReactNode | undefined
	readonly onSelectNav?: ((dest: AppDestination) => void) | undefined
	readonly onBackToRoot?: (() => void) | undefined
	readonly onToggleSidebarCollapsed?: (() => void) | undefined
	readonly onOpenCommandPalette?: (() => void) | undefined
	readonly onToggleTheme?: (() => void) | undefined
	readonly onOpenShortcuts?: (() => void) | undefined
	readonly onOpenSettings?: (() => void) | undefined
	readonly onSignOut?: (() => void) | undefined
}

export function AppShell({
	children,
	activeNav,
	sidebarLevel,
	sidebarCollapsed = false,
	workspaceName,
	inboxUnreadCount,
	chatUnreadCount,
	isPreview,
	theme,
	userName,
	featureTitle,
	featureSidebar,
	featureHeaderAction,
	featureFooterUtility,
	onSelectNav,
	onBackToRoot,
	onToggleSidebarCollapsed,
	onOpenCommandPalette,
	onToggleTheme,
	onOpenShortcuts,
	onOpenSettings,
	onSignOut
}: AppShellProps) {
	const [mobileOpen, setMobileOpen] = useState(false)

	useEffect(() => {
		if (!mobileOpen) return
		function handleKeyDown(ev: KeyboardEvent) {
			if (ev.key === 'Escape') setMobileOpen(false)
		}
		window.addEventListener('keydown', handleKeyDown)
		return () => window.removeEventListener('keydown', handleKeyDown)
	}, [mobileOpen])

	const sharedSidebarProps = {
		active: activeNav ?? 'home',
		sidebarLevel,
		workspaceName,
		inboxUnreadCount,
		chatUnreadCount,
		isPreview,
		theme,
		userName,
		featureTitle,
		featureSidebar,
		featureHeaderAction,
		featureFooterUtility,
		onSelect: onSelectNav,
		onBackToRoot,
		onOpenCommandPalette,
		onToggleTheme,
		onOpenShortcuts,
		onOpenSettings,
		onSignOut
	}

	return (
		<div className="flex h-dvh w-full flex-col overflow-hidden bg-background md:flex-row">
			<a
				href="#content"
				className="sr-only focus:not-sr-only focus:absolute focus:z-(--z-modal) focus:m-2 focus:rounded-md focus:bg-primary focus:px-3 focus:py-1.5 focus:text-primary-foreground"
			>
				{t('shell.skip-to-content')}
			</a>

			{/* Desktop fixed sidebar */}
			<div className="hidden h-full shrink-0 md:flex">
				<Sidebar
					{...sharedSidebarProps}
					collapsed={sidebarCollapsed}
					onToggleCollapsed={onToggleSidebarCollapsed}
				/>
			</div>

			{/* Compact mobile header + slide-over navigation drawer (WCAG 1.4.10 Reflow) */}
			<header className="flex h-12 shrink-0 items-center justify-between border-b border-sidebar-border bg-sidebar px-3 text-sidebar-foreground md:hidden">
				<div className="flex min-w-0 items-center gap-2">
					<button
						type="button"
						aria-label={t('shell.sidebar.open-menu')}
						aria-expanded={mobileOpen}
						onClick={() => setMobileOpen(true)}
						className="flex size-8 items-center justify-center rounded-lg border border-sidebar-border bg-sidebar-icon-well text-sidebar-foreground hover:bg-sidebar-accent"
					>
						<Menu className="size-4" aria-hidden />
					</button>
					{/* Brand logo — same light/dark swap as the sidebar header */}
					<img src="/images/logo.png" alt={t('app.name')} className="h-7 w-auto dark:hidden" />
					<img src="/images/logo-white.png" alt={t('app.name')} className="hidden h-7 w-auto dark:block" />
				</div>

				<button
					type="button"
					aria-label={t('shell.command-palette')}
					onClick={onOpenCommandPalette}
					className="flex size-8 items-center justify-center rounded-lg border border-sidebar-border bg-sidebar-icon-well text-sidebar-muted-foreground hover:bg-sidebar-accent hover:text-sidebar-foreground"
				>
					<Search className="size-4" aria-hidden />
				</button>
			</header>

			{mobileOpen ? (
				<div className="fixed inset-0 z-(--z-overlay) flex md:hidden">
					<button
						type="button"
						aria-label={t('common.close')}
						onClick={() => setMobileOpen(false)}
						className="fixed inset-0 bg-background/80 backdrop-blur-xs"
					/>
					<div className="relative z-10 flex h-full">
						<Sidebar
							{...sharedSidebarProps}
							collapsed={false}
							onSelect={(dest) => {
								onSelectNav?.(dest)
								if (dest === 'home') setMobileOpen(false)
							}}
							onOpenCommandPalette={() => {
								setMobileOpen(false)
								onOpenCommandPalette?.()
							}}
						/>
						<button
							type="button"
							aria-label={t('common.close')}
							onClick={() => setMobileOpen(false)}
							className="m-2 flex size-8 items-center justify-center self-start rounded-lg border border-sidebar-border bg-sidebar text-sidebar-foreground shadow-(--shadow-2)"
						>
							<X className="size-4" aria-hidden />
						</button>
					</div>
				</div>
			) : null}

			<main id="content" className="flex min-h-0 min-w-0 flex-1 flex-col overflow-hidden">
				{children}
			</main>
		</div>
	)
}
