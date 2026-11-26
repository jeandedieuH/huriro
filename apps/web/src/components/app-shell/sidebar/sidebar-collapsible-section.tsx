import { t } from '@huriro/i18n'
import { ChevronRight } from 'lucide-react'
import { type ReactNode, useState } from 'react'
import { cn } from '@/lib/utils'

export interface SidebarCollapsibleSectionProps {
	readonly title: string
	readonly icon?: ReactNode | undefined
	readonly count?: number | undefined
	/** Mirrors outer sidebar collapse state: renders a divider while keeping icons visible. */
	readonly railCollapsed?: boolean | undefined
	readonly collapsible?: boolean | undefined
	readonly defaultCollapsed?: boolean | undefined
	readonly collapsed?: boolean | undefined
	readonly onToggleCollapsed?: (() => void) | undefined
	readonly action?: ReactNode | undefined
	readonly children: ReactNode
}

/**
 * Collapsible sidebar section header shared across feature sidebars.
 * Preserves `<section aria-label={title}>` landmark semantics and `<h2>` heading.
 */
export function SidebarCollapsibleSection({
	title,
	icon,
	count,
	railCollapsed = false,
	collapsible = true,
	defaultCollapsed = false,
	collapsed,
	onToggleCollapsed,
	action,
	children
}: SidebarCollapsibleSectionProps) {
	const [uncontrolledCollapsed, setUncontrolledCollapsed] = useState(defaultCollapsed)
	const isCollapsed = collapsed ?? uncontrolledCollapsed

	if (railCollapsed) {
		return (
			<section aria-label={title} className="space-y-0.5 pt-2">
				<div className="mx-auto my-2 h-px w-6 bg-sidebar-border" aria-hidden />
				<div className="space-y-0.5">{children}</div>
			</section>
		)
	}

	function handleToggle() {
		if (onToggleCollapsed) onToggleCollapsed()
		else setUncontrolledCollapsed((prev) => !prev)
	}

	const countBadge =
		typeof count === 'number' && count > 0 ? (
			<span className="shrink-0 font-mono text-[10px] font-medium text-sidebar-muted-foreground/60 tnum">
				{count}
			</span>
		) : null

	return (
		<section aria-label={title} className="space-y-1 pt-2.5">
			<div className="flex items-center justify-between gap-1 px-1.5 pb-0.5">
				{collapsible ? (
					<button
						type="button"
						aria-expanded={!isCollapsed}
						aria-label={
							isCollapsed
								? t('shell.sidebar.section-expand', { title })
								: t('shell.sidebar.section-collapse', { title })
						}
						onClick={handleToggle}
						className="group/sec flex min-w-0 flex-1 items-center gap-1 rounded-md py-0.5 text-left outline-none transition-colors hover:text-sidebar-foreground focus-visible:ring-2 focus-visible:ring-sidebar-primary/60"
					>
						<ChevronRight
							className={cn(
								'size-3 shrink-0 text-sidebar-muted-foreground/65 transition-transform duration-(--motion-duration-fast) motion-reduce:transition-none',
								!isCollapsed && 'rotate-90'
							)}
							aria-hidden
						/>
						{icon}
						<h2 className="truncate text-[11px] font-semibold uppercase tracking-wider text-sidebar-muted-foreground/75 transition-colors group-hover/sec:text-sidebar-foreground">
							{title}
						</h2>
						{countBadge}
					</button>
				) : (
					<div className="flex min-w-0 flex-1 items-center gap-1.5 py-0.5">
						{icon}
						<h2 className="truncate text-[11px] font-semibold uppercase tracking-wider text-sidebar-muted-foreground/75">
							{title}
						</h2>
						{countBadge}
					</div>
				)}
				{action ? <div className="shrink-0">{action}</div> : null}
			</div>

			{!isCollapsed ? <div className="space-y-0.5">{children}</div> : null}
		</section>
	)
}
