import { t } from '@huriro/i18n'
import { ChevronLeft, ChevronRight } from 'lucide-react'
import { createContext, type ReactNode, useContext } from 'react'
import { Tooltip, TooltipContent, TooltipTrigger } from '@/components/ui/tooltip'
import { cn } from '@/lib/utils'

export const SidebarCollapsedContext = createContext(false)

export function useSidebarCollapsed(): boolean {
	return useContext(SidebarCollapsedContext)
}

const PROJECT_DOT_CLASSES = [
	'bg-chart-1',
	'bg-chart-2',
	'bg-chart-3',
	'bg-chart-4',
	'bg-chart-5',
	'bg-(--info)'
] as const

export interface SidebarIconTileProps {
	readonly active?: boolean | undefined
	readonly disabled?: boolean | undefined
	readonly children: ReactNode
	readonly className?: string | undefined
}

/** Signature rounded-square icon well matching the reference sidebar tiles. */
export function SidebarIconTile({ active, disabled, children, className }: SidebarIconTileProps) {
	return (
		<span
			aria-hidden
			className={cn(
				'flex size-7 shrink-0 items-center justify-center rounded-lg transition-colors duration-(--motion-duration-fast)',
				active
					? 'bg-sidebar-primary text-sidebar-primary-foreground shadow-xs'
					: disabled
						? 'border border-sidebar-border/40 bg-sidebar-icon-well/50 text-sidebar-muted-foreground/45'
						: 'border border-sidebar-border/70 bg-sidebar-icon-well text-sidebar-muted-foreground group-hover:bg-sidebar-accent group-hover:text-sidebar-foreground',
				className
			)}
		>
			{children}
		</span>
	)
}

export interface SidebarProjectDotProps {
	readonly index: number
	readonly active?: boolean | undefined
}

/** Semantic chart-colored dot rendered inside a project's SidebarIconTile. */
export function SidebarProjectDot({ index, active }: SidebarProjectDotProps) {
	const colorClass = PROJECT_DOT_CLASSES[index % PROJECT_DOT_CLASSES.length] ?? 'bg-chart-1'
	return (
		<span
			aria-hidden
			className={cn(
				'size-2.5 rounded-full transition-transform duration-(--motion-duration-fast)',
				active ? 'bg-sidebar-primary-foreground' : colorClass
			)}
		/>
	)
}

export interface SidebarNavItemProps {
	readonly icon: ReactNode
	readonly label: string
	readonly active?: boolean | undefined
	readonly isCurrentPage?: boolean | undefined
	readonly disabled?: boolean | undefined
	readonly collapsed?: boolean | undefined
	readonly badgeCount?: number | undefined
	readonly showDot?: boolean | undefined
	readonly trailingText?: string | undefined
	readonly trailingIcon?: ReactNode | undefined
	readonly showChevron?: boolean | undefined
	readonly onClick?: (() => void) | undefined
	readonly className?: string | undefined
}

export function SidebarNavItem({
	icon,
	label,
	active = false,
	isCurrentPage = false,
	disabled = false,
	collapsed = false,
	badgeCount = 0,
	showDot = false,
	trailingText,
	trailingIcon,
	showChevron = false,
	onClick,
	className
}: SidebarNavItemProps) {
	const hasBadge = badgeCount > 0

	if (collapsed) {
		const button = (
			<button
				type="button"
				disabled={disabled}
				aria-label={label}
				aria-current={isCurrentPage ? 'page' : undefined}
				onClick={disabled ? undefined : onClick}
				className={cn(
					'group relative mx-auto flex size-9 items-center justify-center rounded-xl transition-colors duration-(--motion-duration-fast)',
					disabled ? 'cursor-not-allowed opacity-55' : 'hover:bg-sidebar-accent/70',
					className
				)}
			>
				<SidebarIconTile active={active} disabled={disabled}>
					{icon}
				</SidebarIconTile>
				{hasBadge || showDot ? (
					<span
						aria-hidden
						className="absolute top-1 right-1 size-2 rounded-full bg-sidebar-primary ring-2 ring-sidebar"
					/>
				) : null}
			</button>
		)

		return (
			<Tooltip>
				<TooltipTrigger asChild>{button}</TooltipTrigger>
				<TooltipContent side="right">
					<span>{label}</span>
					{trailingText ? <span className="ml-1.5 opacity-75">· {trailingText}</span> : null}
					{hasBadge ? <span className="ml-1.5 font-mono tnum">({badgeCount})</span> : null}
				</TooltipContent>
			</Tooltip>
		)
	}

	return (
		<button
			type="button"
			disabled={disabled}
			aria-current={isCurrentPage ? 'page' : undefined}
			onClick={disabled ? undefined : onClick}
			className={cn(
				'group flex w-full items-center justify-between gap-2 rounded-xl px-1.5 py-1 text-left text-sm transition-colors duration-(--motion-duration-fast)',
				disabled
					? 'cursor-not-allowed text-sidebar-muted-foreground/50'
					: active
						? 'font-medium text-sidebar-foreground hover:bg-sidebar-accent/55'
						: 'text-sidebar-muted-foreground hover:bg-sidebar-accent/60 hover:text-sidebar-foreground',
				className
			)}
		>
			<span className="flex min-w-0 flex-1 items-center gap-2.5">
				<SidebarIconTile active={active} disabled={disabled}>
					{icon}
				</SidebarIconTile>
				<span className="truncate">{label}</span>
			</span>

			<span className="flex shrink-0 items-center gap-1.5 pr-1">
				{trailingIcon}
				{trailingText ? (
					<span className="text-[11px] font-normal text-sidebar-muted-foreground/65">{trailingText}</span>
				) : null}
				{hasBadge ? (
					<span className="inline-flex min-w-5 items-center justify-center rounded-full bg-sidebar-primary px-1.5 py-0.5 font-mono text-[11px] font-semibold leading-none text-sidebar-primary-foreground tnum">
						{badgeCount}
					</span>
				) : showDot ? (
					<span aria-hidden className="size-2 rounded-full bg-sidebar-primary" />
				) : null}
				{showChevron ? (
					<ChevronRight
						className="size-3.5 text-sidebar-muted-foreground transition-transform group-hover:translate-x-0.5"
						aria-hidden
					/>
				) : null}
			</span>
		</button>
	)
}

export interface SidebarSectionProps {
	readonly title: string
	readonly collapsed?: boolean | undefined
	readonly action?: ReactNode | undefined
	readonly children: ReactNode
}

export function SidebarSection({ title, collapsed = false, action, children }: SidebarSectionProps) {
	return (
		<section aria-label={title} className="space-y-1 pt-3">
			{collapsed ? (
				<div className="mx-auto my-2 h-px w-6 bg-sidebar-border" aria-hidden />
			) : (
				<div className="flex items-center justify-between px-2 pb-0.5">
					<h2 className="text-[11px] font-semibold uppercase tracking-wider text-sidebar-muted-foreground/75">
						{title}
					</h2>
					{action}
				</div>
			)}
			<div className="space-y-0.5">{children}</div>
		</section>
	)
}

export interface SidebarBackHeaderProps {
	readonly title: string
	readonly collapsed?: boolean | undefined
	readonly rightAction?: ReactNode | undefined
	readonly onBack: () => void
}

/** Drill-down feature header bar (`<  Tasks`) sitting directly under global Search. */
export function SidebarBackHeader({ title, collapsed = false, rightAction, onBack }: SidebarBackHeaderProps) {
	const backButton = (
		<button
			type="button"
			aria-label={t('shell.back-to-menu')}
			onClick={onBack}
			className={cn(
				'flex size-7 shrink-0 items-center justify-center rounded-lg text-sidebar-muted-foreground transition-colors hover:bg-sidebar-accent hover:text-sidebar-foreground',
				collapsed && 'mx-auto size-9 rounded-xl border border-sidebar-border/70 bg-sidebar-icon-well'
			)}
		>
			<ChevronLeft className="size-4" aria-hidden />
		</button>
	)

	if (collapsed) {
		return (
			<div className="pb-2">
				<Tooltip>
					<TooltipTrigger asChild>{backButton}</TooltipTrigger>
					<TooltipContent side="right">{t('shell.back-to-menu')}</TooltipContent>
				</Tooltip>
			</div>
		)
	}

	return (
		<div className="flex items-center justify-between gap-2 px-1 pb-2.5">
			<Tooltip>
				<TooltipTrigger asChild>{backButton}</TooltipTrigger>
				<TooltipContent side="right">{t('shell.back-to-menu')}</TooltipContent>
			</Tooltip>
			<span className="min-w-0 flex-1 truncate text-center text-sm font-medium text-sidebar-foreground">
				{title}
			</span>
			<div className="flex size-7 shrink-0 items-center justify-end">{rightAction}</div>
		</div>
	)
}
