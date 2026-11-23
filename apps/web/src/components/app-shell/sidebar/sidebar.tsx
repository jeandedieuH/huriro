import { t } from '@huriro/i18n'
import { Keyboard } from 'lucide-react'
import type { ReactNode } from 'react'
import { TooltipProvider } from '@/components/ui/tooltip'
import { cn } from '@/lib/utils'
import type { AppDestination, SidebarLevel } from '@/stores/ui-store'
import { SidebarFooter } from './sidebar-footer'
import { SidebarHeader } from './sidebar-header'
import { SidebarBackHeader, SidebarCollapsedContext, SidebarNavItem } from './sidebar-primitives'
import { SidebarRootNav } from './sidebar-root-nav'

export interface SidebarProps {
	readonly active?: string
	readonly sidebarLevel?: SidebarLevel | undefined
	readonly collapsed?: boolean | undefined
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
	readonly onSelect?: ((dest: AppDestination) => void) | undefined
	readonly onBackToRoot?: (() => void) | undefined
	readonly onToggleCollapsed?: (() => void) | undefined
	readonly onOpenCommandPalette?: (() => void) | undefined
	readonly onToggleTheme?: (() => void) | undefined
	readonly onOpenShortcuts?: (() => void) | undefined
	readonly onOpenSettings?: (() => void) | undefined
	readonly onSignOut?: (() => void) | undefined
	readonly className?: string | undefined
}

export function Sidebar({
	active = 'home',
	sidebarLevel = 'root',
	collapsed = false,
	workspaceName,
	inboxUnreadCount = 0,
	chatUnreadCount = 0,
	isPreview = false,
	theme = 'light',
	userName,
	featureTitle,
	featureSidebar,
	featureHeaderAction,
	featureFooterUtility,
	onSelect,
	onBackToRoot,
	onToggleCollapsed,
	onOpenCommandPalette,
	onToggleTheme,
	onOpenShortcuts,
	onOpenSettings,
	onSignOut,
	className
}: SidebarProps) {
	const showRoot = sidebarLevel === 'root' || active === 'home' || !featureSidebar
	const rootUtility =
		showRoot && onOpenShortcuts ? (
			<SidebarNavItem
				icon={<Keyboard className="size-4" />}
				label={t('shell.shortcuts-button')}
				trailingText="?"
				collapsed={collapsed}
				onClick={onOpenShortcuts}
			/>
		) : undefined

	return (
		<TooltipProvider delayDuration={300}>
			<SidebarCollapsedContext.Provider value={collapsed}>
				<aside
					aria-label={t('shell.sidebar.label')}
					className={cn(
						'flex h-full shrink-0 flex-col border-r border-sidebar-border bg-sidebar px-3 py-3 text-sidebar-foreground transition-[width] duration-(--motion-duration-fast) ease-(--motion-easing-standard)',
						collapsed ? 'w-16 px-2' : 'w-60',
						className
					)}
				>
					<SidebarHeader
						collapsed={collapsed}
						onGoHome={onSelect ? () => onSelect('home') : undefined}
						onOpenCommandPalette={onOpenCommandPalette}
					/>

					<div className="min-h-0 flex-1 overflow-y-auto overflow-x-hidden pr-0.5">
						{showRoot ? (
							<SidebarRootNav
								active={active}
								inboxUnreadCount={inboxUnreadCount}
								chatUnreadCount={chatUnreadCount}
								collapsed={collapsed}
								onSelect={onSelect}
							/>
						) : (
							<div className="motion-reduce:animate-none">
								<SidebarBackHeader
									title={featureTitle ?? active}
									collapsed={collapsed}
									rightAction={featureHeaderAction}
									onBack={() => onBackToRoot?.()}
								/>
								{featureSidebar}
							</div>
						)}
					</div>

					<SidebarFooter
						userName={userName}
						workspaceName={workspaceName ?? t('app.name')}
						isPreview={isPreview}
						theme={theme}
						collapsed={collapsed}
						utilitySlot={showRoot ? rootUtility : featureFooterUtility}
						onToggleCollapsed={onToggleCollapsed}
						onToggleTheme={onToggleTheme}
						onOpenShortcuts={onOpenShortcuts}
						onOpenSettings={onOpenSettings ?? (onSelect ? () => onSelect('settings') : undefined)}
						onSignOut={onSignOut}
					/>
				</aside>
			</SidebarCollapsedContext.Provider>
		</TooltipProvider>
	)
}
