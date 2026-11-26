import { t } from '@huriro/i18n'
import { MoreHorizontal } from 'lucide-react'
import { type KeyboardEvent, type MutableRefObject, type ReactNode, useState } from 'react'
import {
	DropdownMenu,
	DropdownMenuContent,
	DropdownMenuItem,
	DropdownMenuTrigger
} from '@/components/ui/dropdown-menu'
import { Tooltip, TooltipContent, TooltipTrigger } from '@/components/ui/tooltip'
import { cn } from '@/lib/utils'
import { SidebarNavItem } from './sidebar-primitives'

export interface SidebarActionRowProps {
	readonly icon: ReactNode
	readonly label: string
	readonly sublabel?: string | undefined
	readonly active?: boolean | undefined
	readonly isCurrentPage?: boolean | undefined
	readonly emphasized?: boolean | undefined
	readonly muted?: boolean | undefined
	readonly disabled?: boolean | undefined
	readonly collapsed?: boolean | undefined
	readonly badgeCount?: number | undefined
	readonly badgeTone?: 'primary' | 'muted' | 'danger' | undefined
	readonly trailingText?: string | undefined
	readonly trailingIcon?: ReactNode | undefined
	readonly quickAction?: ReactNode | undefined
	readonly menuContent?: ReactNode | undefined
	readonly menuAriaLabel?: string | undefined
	readonly menuTooltip?: string | undefined
	readonly skipRestoreFocusRef?: MutableRefObject<boolean> | undefined
	readonly onClick?: (() => void) | undefined
	readonly onKeyDown?: ((ev: KeyboardEvent<HTMLButtonElement>) => void) | undefined
	readonly className?: string | undefined
}

const BADGE_TONE_CLASS = {
	primary: 'bg-sidebar-primary text-sidebar-primary-foreground',
	muted: 'bg-sidebar-border/60 text-sidebar-muted-foreground',
	danger: 'bg-destructive/15 text-destructive'
} as const

/**
 * Sleek 32px sidebar item matching the Docs sidebar aesthetic, with optional
 * hover quick-action button, `…` / right-click DropdownMenu, and roving arrow keys.
 */
export function SidebarActionRow({
	icon,
	label,
	sublabel,
	active = false,
	isCurrentPage = false,
	emphasized = false,
	muted = false,
	disabled = false,
	collapsed = false,
	badgeCount = 0,
	badgeTone = 'primary',
	trailingText,
	trailingIcon,
	quickAction,
	menuContent,
	menuAriaLabel,
	menuTooltip,
	skipRestoreFocusRef,
	onClick,
	onKeyDown,
	className
}: SidebarActionRowProps) {
	const [menuOpen, setMenuOpen] = useState(false)

	if (collapsed) {
		return (
			<SidebarNavItem
				icon={icon}
				label={label}
				active={active}
				isCurrentPage={isCurrentPage}
				disabled={disabled}
				collapsed
				badgeCount={badgeCount}
				trailingText={trailingText}
				trailingIcon={trailingIcon}
				onClick={onClick}
				className={className}
			/>
		)
	}

	const hasBadge = badgeCount > 0
	const hasOverlay = Boolean(quickAction || menuContent)
	const hasBothActions = Boolean(quickAction && menuContent)

	function handleRowKeyDown(ev: KeyboardEvent<HTMLButtonElement>) {
		if (ev.key === 'ArrowDown' || ev.key === 'ArrowUp') {
			const root = ev.currentTarget.closest('[data-feature-sidebar]')
			if (root) {
				const rows = Array.from(root.querySelectorAll<HTMLElement>('[data-sidebar-row]'))
				const next = rows[rows.indexOf(ev.currentTarget) + (ev.key === 'ArrowDown' ? 1 : -1)]
				if (next) {
					ev.preventDefault()
					next.focus()
					return
				}
			}
		}
		onKeyDown?.(ev)
	}

	return (
		// biome-ignore lint/a11y/noStaticElementInteractions: pointer-only right-click context menu; keyboard users open the same menu via the `…` trigger inside.
		<div
			data-menu-open={menuOpen}
			onContextMenu={
				menuContent
					? (ev) => {
							ev.preventDefault()
							setMenuOpen(true)
						}
					: undefined
			}
			className={cn(
				'group/row relative flex items-center rounded-lg px-1.5 text-[13px] transition-colors duration-(--motion-duration-fast)',
				disabled
					? 'cursor-not-allowed text-sidebar-muted-foreground/50'
					: active
						? 'bg-sidebar-accent/95 font-medium text-sidebar-accent-foreground shadow-(--shadow-1)'
						: emphasized
							? 'font-semibold text-sidebar-foreground hover:bg-sidebar-accent/55'
							: 'text-sidebar-muted-foreground hover:bg-sidebar-accent/55 hover:text-sidebar-foreground',
				muted && !active && 'opacity-65',
				className
			)}
		>
			<button
				type="button"
				data-sidebar-row
				disabled={disabled}
				aria-current={isCurrentPage ? 'page' : undefined}
				onClick={disabled ? undefined : onClick}
				onKeyDown={handleRowKeyDown}
				className={cn(
					'flex min-w-0 flex-1 items-center gap-2 rounded-md py-1.5 pr-1 text-left outline-none focus-visible:ring-2 focus-visible:ring-sidebar-primary/60',
					hasBothActions
						? 'group-focus-within/row:pr-[3.75rem] group-hover/row:pr-[3.75rem] group-data-[menu-open=true]/row:pr-[3.75rem]'
						: hasOverlay
							? 'group-focus-within/row:pr-9 group-hover/row:pr-9 group-data-[menu-open=true]/row:pr-9'
							: ''
				)}
			>
				<span
					aria-hidden
					className={cn(
						'flex size-5 shrink-0 items-center justify-center',
						!active && !emphasized && 'opacity-85 group-hover/row:opacity-100'
					)}
				>
					{icon}
				</span>
				<span className="flex min-w-0 flex-1 items-baseline gap-1.5">
					<span className="truncate">{label}</span>
					{sublabel ? (
						<span className="shrink-0 font-mono text-[10px] font-normal text-sidebar-muted-foreground/70 tnum">
							{sublabel}
						</span>
					) : null}
				</span>

				<span
					className={cn(
						'flex shrink-0 items-center gap-1.5',
						hasOverlay &&
							'group-hover/row:hidden group-focus-within/row:hidden group-data-[menu-open=true]/row:hidden'
					)}
				>
					{trailingIcon}
					{trailingText ? (
						<span className="font-mono text-[11px] font-normal text-sidebar-muted-foreground/70">
							{trailingText}
						</span>
					) : null}
					{hasBadge ? (
						<span
							className={cn(
								'inline-flex min-w-5 items-center justify-center rounded-full px-1.5 py-0.5 font-mono text-[10px] font-semibold leading-none tnum',
								BADGE_TONE_CLASS[badgeTone]
							)}
						>
							{badgeCount}
						</span>
					) : null}
				</span>
			</button>

			{hasOverlay ? (
				<div
					className={cn(
						'absolute top-1/2 right-1 flex -translate-y-1/2 items-center gap-0.5 opacity-0 transition-opacity duration-(--motion-duration-fast)',
						'group-focus-within/row:opacity-100 group-hover/row:opacity-100 group-data-[menu-open=true]/row:opacity-100 pointer-coarse:opacity-100'
					)}
				>
					{quickAction}
					{menuContent ? (
						<DropdownMenu open={menuOpen} onOpenChange={setMenuOpen}>
							<Tooltip>
								<TooltipTrigger asChild>
									<DropdownMenuTrigger asChild>
										<button
											type="button"
											aria-label={menuAriaLabel ?? t('shell.sidebar.more-actions')}
											className="flex size-6 items-center justify-center rounded-md text-sidebar-muted-foreground outline-none transition-colors hover:bg-sidebar-border/60 hover:text-sidebar-foreground focus-visible:ring-2 focus-visible:ring-sidebar-primary/60 data-[state=open]:bg-sidebar-border/60 data-[state=open]:text-sidebar-foreground"
										>
											<MoreHorizontal className="size-4" aria-hidden />
										</button>
									</DropdownMenuTrigger>
								</TooltipTrigger>
								<TooltipContent side="top">{menuTooltip ?? t('shell.sidebar.more-actions')}</TooltipContent>
							</Tooltip>
							<DropdownMenuContent
								align="start"
								side="right"
								className="w-56 rounded-xl border-border/80 bg-popover/98 p-1.5 shadow-(--shadow-3) backdrop-blur-md"
								onCloseAutoFocus={(ev) => {
									if (!skipRestoreFocusRef?.current) return
									ev.preventDefault()
									skipRestoreFocusRef.current = false
								}}
							>
								{menuContent}
							</DropdownMenuContent>
						</DropdownMenu>
					) : null}
				</div>
			) : null}

			{active ? (
				<span
					aria-hidden
					className="pointer-events-none absolute top-1.5 bottom-1.5 left-0 w-0.5 rounded-full bg-sidebar-primary"
				/>
			) : null}
		</div>
	)
}

export interface SidebarMenuActionProps {
	readonly icon: ReactNode
	readonly label: string
	readonly hint?: string | undefined
	readonly disabled?: boolean | undefined
	readonly tone?: 'default' | 'danger' | undefined
	readonly onSelect: () => void
}

const MENU_ITEM_CLASS = 'gap-2.5 rounded-lg px-2.5 py-1.5 text-[13px]'

/** Consistent styled item inside `SidebarActionRow` dropdown menus. */
export function SidebarMenuAction({
	icon,
	label,
	hint,
	disabled,
	tone = 'default',
	onSelect
}: SidebarMenuActionProps) {
	return (
		<DropdownMenuItem
			disabled={disabled}
			onSelect={onSelect}
			className={
				tone === 'danger'
					? `${MENU_ITEM_CLASS} text-destructive focus:bg-destructive/10 focus:text-destructive`
					: MENU_ITEM_CLASS
			}
		>
			{icon}
			<span className="flex-1 truncate">{label}</span>
			{hint ? <span className="font-mono text-[11px] text-muted-foreground">{hint}</span> : null}
		</DropdownMenuItem>
	)
}
