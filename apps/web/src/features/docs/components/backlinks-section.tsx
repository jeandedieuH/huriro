import type { DocPageDto, EntityLinkDto } from '@huriro/contracts'
import { t } from '@huriro/i18n'
import { ArrowUpRight, ChevronDown, ChevronRight, FileText, Link2 } from 'lucide-react'
import { useEffect, useState } from 'react'
import type { TaskApiBridge } from '@/lib/sync-bootstrap'

export interface BacklinksSectionProps {
	readonly api: TaskApiBridge
	readonly pageId: string
	readonly pages: readonly DocPageDto[]
	readonly onSelectSlug: (slug: string) => void
}

export function BacklinksSection({ api, pageId, pages, onSelectSlug }: BacklinksSectionProps) {
	const [links, setLinks] = useState<EntityLinkDto[]>([])
	const [expanded, setExpanded] = useState(false)

	useEffect(() => {
		let cancelled = false
		void api
			.listEntityLinks('doc_page', pageId)
			.then((rows) => {
				if (!cancelled) {
					// Keep incoming links referencing this page from other pages/tasks.
					const incoming = rows.filter((l) => l.targetType === 'doc_page' && l.targetId === pageId)
					setLinks(incoming)
					if (incoming.length > 0) setExpanded(true)
				}
			})
			.catch(() => {
				if (!cancelled) setLinks([])
			})
		return () => {
			cancelled = true
		}
	}, [api, pageId])

	const pagesById = new Map(pages.map((p) => [p.id, p]))

	return (
		<section
			aria-label={t('docs.backlinks.title', { count: links.length })}
			className="mt-14 border-t border-border/60 pt-4"
		>
			<button
				type="button"
				aria-expanded={expanded}
				onClick={() => setExpanded((prev) => !prev)}
				className="flex items-center gap-1.5 rounded-md px-1.5 py-1 text-xs font-medium text-muted-foreground transition-colors hover:bg-muted/60 hover:text-foreground"
			>
				{expanded ? (
					<ChevronDown className="size-3.5" aria-hidden />
				) : (
					<ChevronRight className="size-3.5" aria-hidden />
				)}
				<Link2 className="size-3.5" aria-hidden />
				<span>{t('docs.backlinks.title', { count: links.length })}</span>
			</button>

			{expanded ? (
				<div className="mt-2.5 pl-1">
					{links.length === 0 ? (
						<p className="text-xs text-muted-foreground">{t('docs.backlinks.empty')}</p>
					) : (
						<ul className="flex flex-wrap gap-1.5">
							{links.map((link) => {
								const sourcePage = link.sourceType === 'doc_page' ? pagesById.get(link.sourceId) : undefined
								return (
									<li key={link.id}>
										{sourcePage ? (
											<button
												type="button"
												onClick={() => onSelectSlug(sourcePage.slug)}
												className="inline-flex items-center gap-1.5 rounded-lg border border-border/70 bg-card/70 px-2.5 py-1.5 text-xs text-foreground transition-colors hover:border-border hover:bg-accent"
											>
												{sourcePage.icon ? (
													<span aria-hidden>{sourcePage.icon}</span>
												) : (
													<FileText className="size-3.5 text-muted-foreground" aria-hidden />
												)}
												<span>{sourcePage.title}</span>
												<ArrowUpRight className="size-3 text-muted-foreground" aria-hidden />
											</button>
										) : (
											<span className="inline-flex items-center gap-1 rounded-lg border border-border/60 bg-muted/40 px-2.5 py-1 text-xs text-muted-foreground">
												{link.sourceType}: {link.sourceId.slice(0, 8)}
											</span>
										)}
									</li>
								)
							})}
						</ul>
					)}
				</div>
			) : null}
		</section>
	)
}
