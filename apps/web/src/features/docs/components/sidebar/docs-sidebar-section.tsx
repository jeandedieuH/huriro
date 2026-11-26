import { t } from '@huriro/i18n'
import { ChevronRight } from 'lucide-react'
import { type ReactNode, useState } from 'react'
import { cn } from '@/lib/utils'

export interface DocsSidebarSectionProps {
	readonly title: string
	readonly icon?: ReactNode | undefined
	readonly count?: number | undefined
	readonly collapsible?: boolean | undefined
	readonly defaultCollapsed?: boolean | undefined
	readonly action?: ReactNode | undefined
	readonly children: ReactNode
}

/**
 * Docs-specific collapsible section header with optional leading icon, item count
 * badge, and hover/header action slot. Preserves `<section aria-label={title}>`
 * landmark semantics for assistive tech.
 */
export function DocsSidebarSection({
	title,
	icon,
	count,
	collapsible = true,
	defaultCollapsed = false,
	action,
	children
}: DocsSidebarSectionProps) {
	const [isCollapsed, setIsCollapsed] = useState(defaultCollapsed)
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
								? t('docs.sidebar.section-expand', { title })
								: t('docs.sidebar.section-collapse', { title })
						}
						onClick={() => setIsCollapsed((prev) => !prev)}
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
