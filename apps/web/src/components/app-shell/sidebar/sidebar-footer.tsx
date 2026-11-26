import { t } from '@huriro/i18n'
import {
	Check,
	ChevronDown,
	Keyboard,
	LogOut,
	Moon,
	PanelLeft,
	PanelLeftClose,
	Settings,
	Sun
} from 'lucide-react'
import type { ReactNode } from 'react'
import { Badge } from '@/components/ui/badge'
import {
	DropdownMenu,
	DropdownMenuContent,
	DropdownMenuItem,
	DropdownMenuLabel,
	DropdownMenuSeparator,
	DropdownMenuTrigger
} from '@/components/ui/dropdown-menu'
import { Tooltip, TooltipContent, TooltipTrigger } from '@/components/ui/tooltip'
import { AvailabilitySwitcher } from '@/features/availability'

export interface SidebarFooterProps {
	readonly userName?: string | undefined
	readonly workspaceName?: string | undefined
	readonly isPreview?: boolean | undefined
	readonly theme?: 'light' | 'dark' | undefined
	readonly collapsed?: boolean | undefined
	readonly utilitySlot?: ReactNode | undefined
	readonly onToggleCollapsed?: (() => void) | undefined
	readonly onToggleTheme?: (() => void) | undefined
	readonly onOpenShortcuts?: (() => void) | undefined
	readonly onOpenSettings?: (() => void) | undefined
	readonly onSignOut?: (() => void) | undefined
}

function getUserInitials(name?: string): string {
	const cleaned = (name ?? '')
		.replace(/[^a-zA-Z0-9\s]/g, ' ')
		.trim()
		.split(/\s+/)
		.filter(Boolean)
	if (cleaned.length >= 2) {
		return `${cleaned[0]?.[0] ?? ''}${cleaned[1]?.[0] ?? ''}`.toUpperCase()
	}
	const single = cleaned[0] ?? ''
	if (single.length >= 2) return single.slice(0, 2).toUpperCase()
	if (single.length === 1) return single.toUpperCase()
	return 'H'
}

export function SidebarFooter({
	userName,
	workspaceName,
	isPreview = false,
	theme = 'light',
	collapsed = false,
	utilitySlot,
	onToggleCollapsed,
	onToggleTheme,
	onOpenShortcuts,
	onOpenSettings,
	onSignOut
}: SidebarFooterProps) {
	const displayName = userName ?? t('shell.profile')
	const initials = getUserInitials(userName)

	const collapseButton = onToggleCollapsed ? (
		<Tooltip>
			<TooltipTrigger asChild>
				<button
					type="button"
					aria-label={collapsed ? t('shell.sidebar.expand') : t('shell.sidebar.collapse')}
					aria-expanded={!collapsed}
					onClick={onToggleCollapsed}
					className="flex size-9 shrink-0 items-center justify-center rounded-xl border border-sidebar-border/80 bg-sidebar-icon-well/50 text-sidebar-muted-foreground transition-colors hover:bg-sidebar-accent hover:text-sidebar-foreground"
				>
					{collapsed ? (
						<PanelLeft className="size-4" aria-hidden />
					) : (
						<PanelLeftClose className="size-4" aria-hidden />
					)}
				</button>
			</TooltipTrigger>
			<TooltipContent side={collapsed ? 'right' : 'top'}>
				{collapsed ? t('shell.sidebar.expand') : t('shell.sidebar.collapse')}
			</TooltipContent>
		</Tooltip>
	) : null

	const userDropdownContent = (
		<DropdownMenuContent align="start" side={collapsed ? 'right' : 'top'} className="w-56">
			<DropdownMenuLabel className="flex items-center justify-between gap-2">
				<span className="truncate">{displayName}</span>
				{isPreview ? <Badge tone="secondary">{t('shell.preview-badge')}</Badge> : null}
			</DropdownMenuLabel>
			{/* Workspace switcher — relocated from the sidebar header when the brand logo took its slot */}
			{workspaceName ? (
				<>
					<DropdownMenuSeparator />
					<DropdownMenuLabel>{t('shell.workspace-switcher')}</DropdownMenuLabel>
					<DropdownMenuItem disabled>
						<Check className="size-3.5 text-primary" aria-hidden />
						<span className="truncate font-medium">{workspaceName}</span>
					</DropdownMenuItem>
				</>
			) : null}
			<DropdownMenuSeparator />
			{onToggleTheme ? (
				<DropdownMenuItem onSelect={onToggleTheme}>
					{theme === 'dark' ? (
						<Sun className="size-3.5" aria-hidden />
					) : (
						<Moon className="size-3.5" aria-hidden />
					)}
					<span>{theme === 'dark' ? t('shell.theme.to-light') : t('shell.theme.to-dark')}</span>
				</DropdownMenuItem>
			) : null}
			{onOpenShortcuts ? (
				<DropdownMenuItem onSelect={onOpenShortcuts}>
					<Keyboard className="size-3.5" aria-hidden />
					<span>{t('shell.shortcuts-button')}</span>
				</DropdownMenuItem>
			) : null}
			{onOpenSettings ? (
				<DropdownMenuItem onSelect={onOpenSettings}>
					<Settings className="size-3.5" aria-hidden />
					<span>{t('shell.workspace-settings')}</span>
				</DropdownMenuItem>
			) : null}
			{onSignOut ? (
				<>
					<DropdownMenuSeparator />
					<DropdownMenuItem onSelect={() => void onSignOut()}>
						<LogOut className="size-3.5" aria-hidden />
						<span>{t('auth.sign-out')}</span>
					</DropdownMenuItem>
				</>
			) : null}
		</DropdownMenuContent>
	)

	return (
		<div className="mt-auto space-y-2 pt-2">
			{utilitySlot ? <div className="space-y-0.5">{utilitySlot}</div> : null}
			<div className="border-t border-sidebar-border/60 pt-1.5">
				<AvailabilitySwitcher collapsed={collapsed} />
			</div>

			{collapsed ? (
				<div className="flex flex-col items-center gap-1.5 border-t border-sidebar-border/60 pt-2">
					<DropdownMenu>
						<Tooltip>
							<TooltipTrigger asChild>
								<DropdownMenuTrigger
									aria-label={t('shell.user-menu')}
									className="flex size-9 items-center justify-center rounded-xl border border-sidebar-border/80 bg-sidebar-icon-well/70 text-xs font-semibold text-sidebar-foreground transition-colors hover:bg-sidebar-accent"
								>
									{initials}
								</DropdownMenuTrigger>
							</TooltipTrigger>
							<TooltipContent side="right">{displayName}</TooltipContent>
						</Tooltip>
						{userDropdownContent}
					</DropdownMenu>
					{collapseButton}
				</div>
			) : (
				<div className="flex items-center gap-1.5 border-t border-sidebar-border/60 pt-2">
					<DropdownMenu>
						<DropdownMenuTrigger
							aria-label={t('shell.user-menu')}
							className="flex min-w-0 flex-1 items-center justify-between gap-2 rounded-xl border border-sidebar-border/80 bg-sidebar-icon-well/70 px-2 py-1.5 text-left text-sm text-sidebar-foreground transition-colors hover:bg-sidebar-accent"
						>
							<span className="flex min-w-0 items-center gap-2">
								<span className="flex size-6 shrink-0 items-center justify-center rounded-full border border-sidebar-border bg-sidebar-accent text-[11px] font-semibold text-sidebar-foreground">
									{initials}
								</span>
								<span className="flex min-w-0 flex-col items-start">
									<span className="max-w-full truncate text-xs font-medium">{displayName}</span>
									{workspaceName ? (
										<span className="max-w-full truncate text-[10px] leading-tight text-sidebar-muted-foreground">
											{workspaceName}
										</span>
									) : null}
								</span>
							</span>
							<ChevronDown className="size-3.5 shrink-0 text-sidebar-muted-foreground" aria-hidden />
						</DropdownMenuTrigger>
						{userDropdownContent}
					</DropdownMenu>
					{collapseButton}
				</div>
			)}
		</div>
	)
}
