import { t } from '@huriro/i18n'
import { ChevronsDownUp, ChevronsUpDown, Search, X } from 'lucide-react'
import { Tooltip, TooltipContent, TooltipTrigger } from '@/components/ui/tooltip'

export interface DocsSidebarFilterProps {
	readonly value: string
	readonly onChange: (value: string) => void
	readonly canToggleAll?: boolean | undefined
	readonly allCollapsed?: boolean | undefined
	readonly onToggleAll?: (() => void) | undefined
}

/**
 * Compact "filter pages" toolbar with pixel-centered icons, Escape-to-clear,
 * and a Collapse/Expand All toggle when a hierarchy exists.
 */
export function DocsSidebarFilter({
	value,
	onChange,
	canToggleAll = false,
	allCollapsed = false,
	onToggleAll
}: DocsSidebarFilterProps) {
	const toggleAllLabel = allCollapsed ? t('docs.sidebar.expand-all') : t('docs.sidebar.collapse-all')

	return (
		<div className="flex items-center gap-1 px-0.5 pb-1.5">
			<div className="relative min-w-0 flex-1">
				<Search
					className="pointer-events-none absolute top-1/2 left-2.5 size-3.5 -translate-y-1/2 text-sidebar-muted-foreground/80"
					aria-hidden
				/>
				<input
					type="text"
					value={value}
					onChange={(ev) => onChange(ev.target.value)}
					onKeyDown={(ev) => {
						if (ev.key === 'Escape' && value) {
							ev.preventDefault()
							onChange('')
						}
					}}
					placeholder={t('docs.sidebar.filter-placeholder')}
					aria-label={t('docs.sidebar.filter-label')}
					className="h-8 w-full rounded-lg border border-sidebar-border/70 bg-sidebar-icon-well/60 pr-7 pl-8 text-[13px] text-sidebar-foreground outline-none transition-colors placeholder:text-sidebar-muted-foreground/70 hover:bg-sidebar-icon-well focus-visible:border-sidebar-primary/60 focus-visible:bg-sidebar focus-visible:ring-2 focus-visible:ring-sidebar-primary/20"
				/>
				{value ? (
					<button
						type="button"
						aria-label={t('docs.sidebar.filter-clear')}
						onClick={() => onChange('')}
						className="absolute top-1/2 right-1.5 flex size-5 -translate-y-1/2 items-center justify-center rounded-md text-sidebar-muted-foreground outline-none transition-colors hover:bg-sidebar-border/60 hover:text-sidebar-foreground focus-visible:ring-2 focus-visible:ring-sidebar-primary/60"
					>
						<X className="size-3.5" aria-hidden />
					</button>
				) : null}
			</div>

			{canToggleAll && !value && onToggleAll ? (
				<Tooltip>
					<TooltipTrigger asChild>
						<button
							type="button"
							aria-label={toggleAllLabel}
							onClick={onToggleAll}
							className="flex size-8 shrink-0 items-center justify-center rounded-lg border border-sidebar-border/70 bg-sidebar-icon-well/55 text-sidebar-muted-foreground outline-none transition-colors hover:bg-sidebar-accent hover:text-sidebar-foreground focus-visible:ring-2 focus-visible:ring-sidebar-primary/60"
						>
							{allCollapsed ? (
								<ChevronsUpDown className="size-3.5" aria-hidden />
							) : (
								<ChevronsDownUp className="size-3.5" aria-hidden />
							)}
						</button>
					</TooltipTrigger>
					<TooltipContent side="bottom">{toggleAllLabel}</TooltipContent>
				</Tooltip>
			) : null}
		</div>
	)
}
