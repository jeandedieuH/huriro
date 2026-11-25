import type { DocHeadingDto } from '@huriro/contracts'
import { t } from '@huriro/i18n'
import { cn } from '@/lib/utils'

export interface OutlineFloatingRailProps {
	readonly headings: readonly DocHeadingDto[]
	readonly hidden?: boolean | undefined
}

function scrollToHeadingBlock(blockId: string) {
	if (typeof document === 'undefined') return
	const target = document.querySelector(`[data-block-id="${CSS.escape(blockId)}"]`)
	if (target instanceof HTMLElement) {
		target.scrollIntoView({ behavior: 'smooth', block: 'center' })
		target.classList.add('huriro-block-flash')
		window.setTimeout(() => target.classList.remove('huriro-block-flash'), 1600)
	}
}

export function OutlineFloatingRail({ headings, hidden = false }: OutlineFloatingRailProps) {
	if (hidden || headings.length < 2) return null

	return (
		<div
			data-docs-chrome="true"
			className="group/rail fixed top-1/2 right-4 z-(--z-raised) hidden -translate-y-1/2 flex-col items-end xl:flex"
		>
			{/* Minimal Notion-style tick lines */}
			<div
				aria-hidden="true"
				className="flex flex-col items-end gap-2 rounded-lg p-2 transition-opacity duration-(--motion-duration-fast) group-hover/rail:opacity-0 group-focus-within/rail:opacity-0"
			>
				{headings.slice(0, 14).map((h) => (
					<span
						key={`tick-${h.blockId}-${h.offset}`}
						className={cn(
							'block h-0.5 rounded-full bg-muted-foreground/35',
							h.level === 1 ? 'w-4 bg-muted-foreground/55' : h.level === 2 ? 'w-3' : 'w-2'
						)}
					/>
				))}
			</div>

			{/* Expanded floating card on hover or keyboard focus */}
			<nav
				aria-label={t('docs.outline.rail-label')}
				className="pointer-events-none absolute top-1/2 right-0 w-56 -translate-y-1/2 scale-95 rounded-xl border border-border/80 bg-popover/95 p-2.5 opacity-0 shadow-(--shadow-3) backdrop-blur-md transition-all duration-(--motion-duration-fast) group-hover/rail:pointer-events-auto group-hover/rail:scale-100 group-hover/rail:opacity-100 group-focus-within/rail:pointer-events-auto group-focus-within/rail:scale-100 group-focus-within/rail:opacity-100"
			>
				<p className="mb-1.5 px-1.5 text-[11px] font-semibold uppercase tracking-wider text-muted-foreground">
					{t('docs.panel.toc')}
				</p>
				<ul className="max-h-72 space-y-0.5 overflow-y-auto">
					{headings.map((h) => (
						<li
							key={`${h.blockId}-${h.offset}`}
							style={{ paddingLeft: `${Math.max(0, h.level - 1) * 10}px` }}
						>
							<a
								href={`#block-${h.blockId}`}
								onClick={(ev) => {
									ev.preventDefault()
									scrollToHeadingBlock(h.blockId)
								}}
								className="block truncate rounded-md px-1.5 py-1 text-xs text-muted-foreground transition-colors hover:bg-accent hover:text-foreground"
							>
								{h.text}
							</a>
						</li>
					))}
				</ul>
			</nav>
		</div>
	)
}
