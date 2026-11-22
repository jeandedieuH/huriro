import type { DocHeadingDto } from '@huriro/contracts'
import { t } from '@huriro/i18n'
import { ListTree } from 'lucide-react'

export interface TocRailProps {
	readonly headings: readonly DocHeadingDto[]
	readonly onJumpToBlock?: (blockId: string) => void
}

export function TocRail({ headings, onJumpToBlock }: TocRailProps) {
	if (headings.length === 0) {
		return <p className="p-4 text-xs text-muted-foreground">{t('docs.toc.empty')}</p>
	}

	return (
		<nav aria-label={t('docs.panel.toc')} className="space-y-1 p-3">
			<div className="flex items-center gap-1.5 pb-1 text-xs font-medium text-muted-foreground">
				<ListTree className="size-3.5" aria-hidden />
				<span>{t('docs.panel.toc')}</span>
			</div>
			<ul className="space-y-1">
				{headings.map((h) => (
					<li key={`${h.blockId}-${h.offset}`} style={{ paddingLeft: `${Math.max(0, h.level - 1) * 10}px` }}>
						<a
							href={`#block-${h.blockId}`}
							onClick={(ev) => {
								if (onJumpToBlock) {
									ev.preventDefault()
									onJumpToBlock(h.blockId)
								}
							}}
							className="block truncate rounded px-1.5 py-0.5 text-xs text-muted-foreground transition-colors hover:bg-muted hover:text-foreground"
						>
							{h.text}
						</a>
					</li>
				))}
			</ul>
		</nav>
	)
}
