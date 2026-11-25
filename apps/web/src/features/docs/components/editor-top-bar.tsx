import type { DocFontStyle, DocPageDto, UpdateDocPageBody } from '@huriro/contracts'
import { t } from '@huriro/i18n'
import {
	Download,
	FileEdit,
	FileText,
	GitPullRequestDraft,
	Globe,
	History,
	ListTree,
	Lock,
	MessageSquare,
	MoreHorizontal,
	Scissors,
	Share2,
	Star,
	Unlock
} from 'lucide-react'
import { useMemo, useState } from 'react'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover'
import { Separator } from '@/components/ui/separator'
import { cn } from '@/lib/utils'
import type { DocSidePanel } from '@/stores/ui-store'

export interface EditorTopBarProps {
	readonly page: DocPageDto
	readonly pages: readonly DocPageDto[]
	readonly titleDraft: string
	readonly effectiveEditable: boolean
	readonly canShare: boolean
	readonly canWrite: boolean
	readonly canPublish: boolean
	readonly isPreview: boolean
	readonly connStatus: string
	readonly suggestingMode: boolean
	readonly activePanel: DocSidePanel
	readonly openCommentCount?: number | undefined
	readonly openSuggestionCount?: number | undefined
	readonly wordCount?: number | undefined
	readonly onSelectSlug?: ((slug: string) => void) | undefined
	readonly onToggleSuggesting: () => void
	readonly onToggleFavorite: () => void
	readonly onOpenShare: () => void
	readonly onTogglePanel: (panel: Exclude<DocSidePanel, null>) => void
	readonly onUpdateMeta: (patch: Omit<UpdateDocPageBody, 'version'>) => Promise<void>
	readonly onSplitPage: () => void
	readonly onExportMarkdown: () => Promise<void>
	readonly onExportHtml: (print: boolean) => Promise<void>
	readonly onExportZip: () => Promise<void>
	readonly onOpenPublish: () => void
}

const FONT_OPTIONS: readonly {
	readonly id: DocFontStyle
	readonly label: () => string
	readonly sampleClass: string
}[] = [
	{ id: 'sans', label: () => t('docs.style.font.sans'), sampleClass: 'font-sans' },
	{ id: 'serif', label: () => t('docs.style.font.serif'), sampleClass: 'font-serif' },
	{ id: 'mono', label: () => t('docs.style.font.mono'), sampleClass: 'font-mono' }
]

function buildAncestors(page: DocPageDto, pages: readonly DocPageDto[]): DocPageDto[] {
	const byId = new Map(pages.map((p) => [p.id, p]))
	const visited = new Set<string>([page.id])
	const chain: DocPageDto[] = []
	let curParentId = page.parentId
	let depth = 0
	while (curParentId && !visited.has(curParentId) && depth < 8) {
		const parent = byId.get(curParentId)
		if (!parent) break
		visited.add(parent.id)
		chain.unshift(parent)
		curParentId = parent.parentId
		depth += 1
	}
	return chain
}

export function EditorTopBar({
	page,
	pages,
	titleDraft,
	effectiveEditable,
	canShare,
	canWrite,
	canPublish,
	isPreview,
	connStatus,
	suggestingMode,
	activePanel,
	openCommentCount = 0,
	openSuggestionCount = 0,
	wordCount = 0,
	onSelectSlug,
	onToggleSuggesting,
	onToggleFavorite,
	onOpenShare,
	onTogglePanel,
	onUpdateMeta,
	onSplitPage,
	onExportMarkdown,
	onExportHtml,
	onExportZip,
	onOpenPublish
}: EditorTopBarProps) {
	const [moreOpen, setMoreOpen] = useState(false)

	const ancestors = useMemo(() => buildAncestors(page, pages), [page, pages])
	const lockAllowed = canShare || canWrite
	const activeFont: DocFontStyle = page.fontStyle ?? 'sans'
	const readMinutes = Math.max(1, Math.ceil(wordCount / 200))
	const updatedDate = page.updatedAt.slice(0, 10)
	const displayTitle = titleDraft.trim() || page.title || t('docs.editor.title-placeholder')

	const syncIndicator = !effectiveEditable
		? { dot: 'bg-muted-foreground', label: t('docs.editor.read-only') }
		: isPreview
			? { dot: 'bg-muted-foreground', label: t('docs.editor.offline') }
			: connStatus === 'connected'
				? { dot: 'bg-(--success)', label: t('docs.editor.synced') }
				: { dot: 'bg-(--info)', label: t('docs.editor.connecting') }

	return (
		<header
			data-docs-chrome="true"
			className="sticky top-0 z-(--z-sticky) flex h-11 shrink-0 items-center justify-between gap-2 border-b border-border/60 bg-background/85 px-3 backdrop-blur-md sm:px-4"
		>
			<div className="flex min-w-0 flex-1 items-center gap-2">
				<nav
					aria-label={t('docs.breadcrumbs.label')}
					className="flex min-w-0 items-center gap-1 text-xs text-muted-foreground"
				>
					{ancestors.map((ancestor) => (
						<span key={ancestor.id} className="flex min-w-0 items-center gap-1">
							<button
								type="button"
								onClick={() => onSelectSlug?.(ancestor.slug)}
								className="flex max-w-32 items-center gap-1 truncate rounded-md px-1.5 py-0.5 transition-colors hover:bg-accent hover:text-foreground"
							>
								{ancestor.icon ? <span aria-hidden>{ancestor.icon}</span> : null}
								<span className="truncate">{ancestor.title}</span>
							</button>
							<span aria-hidden className="text-(--ink-tertiary)">
								/
							</span>
						</span>
					))}
					<span className="flex min-w-0 max-w-56 items-center gap-1.5 truncate px-1.5 py-0.5 font-medium text-foreground">
						{page.icon ? (
							<span aria-hidden className="shrink-0">
								{page.icon}
							</span>
						) : (
							<FileText className="size-3.5 shrink-0 text-muted-foreground" aria-hidden />
						)}
						<span className="truncate">{displayTitle}</span>
					</span>
				</nav>

				<span className="hidden items-center gap-1.5 rounded-full border border-border/70 bg-muted/40 px-2 py-0.5 text-[11px] text-muted-foreground sm:inline-flex">
					<span className={cn('size-1.5 rounded-full', syncIndicator.dot)} aria-hidden />
					<span>{syncIndicator.label}</span>
				</span>

				{page.isLocked ? (
					<span
						title={t('docs.lock.banner')}
						className="inline-flex items-center gap-1 rounded-full border border-(--warning)/35 bg-(--warning)/10 px-2 py-0.5 text-[11px] text-(--warning)"
					>
						<Lock className="size-3" aria-hidden />
					</span>
				) : null}
			</div>

			<div className="flex shrink-0 items-center gap-1">
				{effectiveEditable ? (
					<Button
						type="button"
						size="sm"
						tone={suggestingMode ? 'secondary' : 'ghost'}
						onClick={onToggleSuggesting}
						className="h-7 gap-1 px-2 text-xs"
					>
						{suggestingMode ? (
							<>
								<GitPullRequestDraft className="size-3.5 text-(--info)" aria-hidden />
								<span>{t('docs.mode.suggesting')}</span>
							</>
						) : (
							<>
								<FileEdit className="size-3.5 text-muted-foreground" aria-hidden />
								<span>{t('docs.mode.editing')}</span>
							</>
						)}
					</Button>
				) : null}

				{canShare ? (
					<Button
						type="button"
						size="sm"
						tone="outline"
						onClick={onOpenShare}
						className="h-7 gap-1 px-2.5 text-xs"
					>
						<Share2 className="size-3.5" aria-hidden />
						<span>{t('docs.editor.share')}</span>
					</Button>
				) : null}

				<Button
					type="button"
					size="icon"
					tone="ghost"
					aria-label={page.isFavorite ? t('docs.editor.unfavorite') : t('docs.editor.favorite')}
					onClick={onToggleFavorite}
					className="size-7"
				>
					<Star
						className={
							page.isFavorite
								? 'size-3.5 fill-(--warning) text-(--warning)'
								: 'size-3.5 text-muted-foreground'
						}
						aria-hidden
					/>
				</Button>

				<div className="flex items-center gap-0.5 rounded-lg bg-muted/40 p-0.5">
					<Button
						type="button"
						size="sm"
						tone={activePanel === 'comments' ? 'secondary' : 'ghost'}
						aria-label={t('docs.panel.comments')}
						aria-pressed={activePanel === 'comments'}
						onClick={() => onTogglePanel('comments')}
						className="h-6 gap-1 px-1.5 text-xs"
					>
						<MessageSquare className="size-3.5" aria-hidden />
						{openCommentCount > 0 ? <span className="tnum text-[11px]">{openCommentCount}</span> : null}
					</Button>
					<Button
						type="button"
						size="sm"
						tone={activePanel === 'suggestions' ? 'secondary' : 'ghost'}
						aria-label={t('docs.panel.suggestions')}
						aria-pressed={activePanel === 'suggestions'}
						onClick={() => onTogglePanel('suggestions')}
						className="h-6 gap-1 px-1.5 text-xs"
					>
						<GitPullRequestDraft className="size-3.5" aria-hidden />
						{openSuggestionCount > 0 ? <Badge tone="info">{openSuggestionCount}</Badge> : null}
					</Button>
					<Button
						type="button"
						size="icon"
						tone={activePanel === 'versions' ? 'secondary' : 'ghost'}
						aria-label={t('docs.panel.versions')}
						aria-pressed={activePanel === 'versions'}
						onClick={() => onTogglePanel('versions')}
						className="size-6"
					>
						<History className="size-3.5" aria-hidden />
					</Button>
					<Button
						type="button"
						size="icon"
						tone={activePanel === 'toc' ? 'secondary' : 'ghost'}
						aria-label={t('docs.panel.toc')}
						aria-pressed={activePanel === 'toc'}
						onClick={() => onTogglePanel('toc')}
						className="size-6"
					>
						<ListTree className="size-3.5" aria-hidden />
					</Button>
				</div>

				<Popover open={moreOpen} onOpenChange={setMoreOpen}>
					<PopoverTrigger asChild>
						<Button
							type="button"
							size="icon"
							tone="ghost"
							aria-label={t('docs.topbar.more')}
							className="size-7"
						>
							<MoreHorizontal className="size-4" aria-hidden />
						</Button>
					</PopoverTrigger>
					<PopoverContent
						align="end"
						className="w-72 space-y-3 rounded-xl border-border/90 bg-popover/98 p-3 shadow-(--shadow-3) backdrop-blur-md"
					>
						{canWrite ? (
							<>
								<div className="space-y-1.5">
									<span className="text-[11px] font-semibold uppercase tracking-wider text-muted-foreground">
										{t('docs.style.font')}
									</span>
									<div className="grid grid-cols-3 gap-1.5">
										{FONT_OPTIONS.map((font) => {
											const selected = activeFont === font.id
											return (
												<button
													key={font.id}
													type="button"
													aria-pressed={selected}
													onClick={() => void onUpdateMeta({ fontStyle: font.id })}
													className={cn(
														'flex flex-col items-center gap-0.5 rounded-lg border px-2 py-2 transition-colors',
														selected
															? 'border-primary bg-accent/70 text-foreground'
															: 'border-border/70 bg-background/60 text-muted-foreground hover:bg-accent/50 hover:text-foreground'
													)}
												>
													<span className={cn('text-lg font-semibold leading-tight', font.sampleClass)}>
														Ag
													</span>
													<span className="text-[11px]">{font.label()}</span>
												</button>
											)
										})}
									</div>
								</div>

								<div className="space-y-2">
									<div className="flex items-center justify-between gap-2">
										<span className="text-xs text-foreground">{t('docs.style.small-text')}</span>
										<button
											type="button"
											role="switch"
											aria-label={t('docs.style.small-text')}
											aria-checked={Boolean(page.smallText)}
											onClick={() => void onUpdateMeta({ smallText: !page.smallText })}
											className={cn(
												'relative inline-flex h-5 w-9 shrink-0 items-center rounded-full transition-colors',
												page.smallText ? 'bg-primary' : 'bg-muted'
											)}
										>
											<span
												className={cn(
													'inline-block size-3.5 rounded-full bg-background shadow-xs transition-transform',
													page.smallText ? 'translate-x-4.5' : 'translate-x-1'
												)}
											/>
										</button>
									</div>

									<div className="flex items-center justify-between gap-2">
										<span className="text-xs text-foreground">{t('docs.style.full-width')}</span>
										<button
											type="button"
											role="switch"
											aria-label={t('docs.style.full-width')}
											aria-checked={Boolean(page.fullWidth)}
											onClick={() => void onUpdateMeta({ fullWidth: !page.fullWidth })}
											className={cn(
												'relative inline-flex h-5 w-9 shrink-0 items-center rounded-full transition-colors',
												page.fullWidth ? 'bg-primary' : 'bg-muted'
											)}
										>
											<span
												className={cn(
													'inline-block size-3.5 rounded-full bg-background shadow-xs transition-transform',
													page.fullWidth ? 'translate-x-4.5' : 'translate-x-1'
												)}
											/>
										</button>
									</div>
								</div>

								<Separator />
							</>
						) : null}

						<div className="space-y-1">
							{lockAllowed ? (
								<button
									type="button"
									onClick={() => {
										void onUpdateMeta({ isLocked: !page.isLocked })
										setMoreOpen(false)
									}}
									className="flex w-full items-center gap-2 rounded-lg px-2 py-1.5 text-left text-xs text-foreground transition-colors hover:bg-accent"
								>
									{page.isLocked ? (
										<Unlock className="size-3.5 text-muted-foreground" aria-hidden />
									) : (
										<Lock className="size-3.5 text-muted-foreground" aria-hidden />
									)}
									<span>{page.isLocked ? t('docs.lock.unlock-page') : t('docs.lock.lock-page')}</span>
								</button>
							) : null}

							{effectiveEditable ? (
								<button
									type="button"
									onClick={() => {
										onSplitPage()
										setMoreOpen(false)
									}}
									className="flex w-full items-center gap-2 rounded-lg px-2 py-1.5 text-left text-xs text-foreground transition-colors hover:bg-accent"
								>
									<Scissors className="size-3.5 text-muted-foreground" aria-hidden />
									<span>{t('docs.editor.split-page')}</span>
								</button>
							) : null}

							{canPublish ? (
								<button
									type="button"
									onClick={() => {
										onOpenPublish()
										setMoreOpen(false)
									}}
									className="flex w-full items-center gap-2 rounded-lg px-2 py-1.5 text-left text-xs text-foreground transition-colors hover:bg-accent"
								>
									<Globe className="size-3.5 text-muted-foreground" aria-hidden />
									<span>{t('docs.publish.button')}</span>
								</button>
							) : null}
						</div>

						<Separator />

						<div className="space-y-1.5">
							<div className="flex items-center gap-1.5 px-1 text-[11px] font-semibold uppercase tracking-wider text-muted-foreground">
								<Download className="size-3" aria-hidden />
								<span>{t('docs.export.menu')}</span>
							</div>
							<div className="grid grid-cols-2 gap-1">
								<Button
									type="button"
									size="sm"
									tone="ghost"
									className="h-7 justify-start px-2 text-xs"
									onClick={() => {
										void onExportMarkdown()
										setMoreOpen(false)
									}}
								>
									{t('docs.export.markdown')}
								</Button>
								<Button
									type="button"
									size="sm"
									tone="ghost"
									className="h-7 justify-start px-2 text-xs"
									onClick={() => {
										void onExportHtml(false)
										setMoreOpen(false)
									}}
								>
									{t('docs.export.html')}
								</Button>
								<Button
									type="button"
									size="sm"
									tone="ghost"
									className="h-7 justify-start px-2 text-xs"
									onClick={() => {
										void onExportHtml(true)
										setMoreOpen(false)
									}}
								>
									{t('docs.export.pdf-html')}
								</Button>
								<Button
									type="button"
									size="sm"
									tone="ghost"
									className="h-7 justify-start px-2 text-xs"
									onClick={() => {
										void onExportZip()
										setMoreOpen(false)
									}}
								>
									{t('docs.export.zip')}
								</Button>
							</div>
						</div>

						<Separator />

						<div className="flex flex-wrap items-center justify-between gap-2 px-1 text-[11px] text-muted-foreground">
							<span className="tnum">
								{t('docs.topbar.words', { count: wordCount })} ·{' '}
								{t('docs.topbar.read-time', { minutes: readMinutes })}
							</span>
							<time>{t('docs.topbar.updated', { date: updatedDate })}</time>
						</div>
					</PopoverContent>
				</Popover>
			</div>
		</header>
	)
}
