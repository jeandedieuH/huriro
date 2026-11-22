import type { DocPageDto } from '@huriro/contracts'
import { t } from '@huriro/i18n'
import {
	ChevronDown,
	ChevronRight,
	FileText,
	FolderInput,
	Lock,
	MoreHorizontal,
	Plus,
	Star,
	Trash2,
	Upload
} from 'lucide-react'
import { useMemo, useState } from 'react'
import { Button } from '@/components/ui/button'
import { Dialog, DialogContent, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog'
import {
	DropdownMenu,
	DropdownMenuContent,
	DropdownMenuItem,
	DropdownMenuTrigger
} from '@/components/ui/dropdown-menu'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select'
import { cn } from '@/lib/utils'

export interface PageTreeSidebarProps {
	readonly pages: readonly DocPageDto[]
	readonly activeSlug: string | null
	readonly onSelectSlug: (slug: string) => void
	readonly onCreatePage: () => void
	readonly onOpenImport: () => void
	readonly onMovePage: (pageId: string, parentId: string | null) => Promise<void>
	readonly onArchivePage: (pageId: string) => Promise<void>
}

function sortPages(a: DocPageDto, b: DocPageDto): number {
	return a.position < b.position ? -1 : a.position > b.position ? 1 : a.id.localeCompare(b.id)
}

export function PageTreeSidebar({
	pages,
	activeSlug,
	onSelectSlug,
	onCreatePage,
	onOpenImport,
	onMovePage,
	onArchivePage
}: PageTreeSidebarProps) {
	const [collapsed, setCollapsed] = useState<Set<string>>(() => new Set())
	const [moveTargetPage, setMoveTargetPage] = useState<DocPageDto | null>(null)
	const [nextParentId, setNextParentId] = useState<string>('root')

	const activePages = useMemo(() => pages.filter((p) => p.archivedAt === null && !p.isTemplate), [pages])
	const favorites = useMemo(() => activePages.filter((p) => p.isFavorite).sort(sortPages), [activePages])

	const childrenByParent = useMemo(() => {
		const map = new Map<string | null, DocPageDto[]>()
		for (const p of activePages) {
			const list = map.get(p.parentId) ?? []
			list.push(p)
			map.set(p.parentId, list)
		}
		for (const list of map.values()) list.sort(sortPages)
		return map
	}, [activePages])

	function toggleExpand(pageId: string) {
		setCollapsed((prev) => {
			const next = new Set(prev)
			if (next.has(pageId)) next.delete(pageId)
			else next.add(pageId)
			return next
		})
	}

	function renderBranch(parentId: string | null, level: number) {
		const nodes = childrenByParent.get(parentId) ?? []
		if (nodes.length === 0) return null
		return nodes.map((page) => {
			const kids = childrenByParent.get(page.id) ?? []
			const hasChildren = kids.length > 0
			const isExpanded = hasChildren && !collapsed.has(page.id)
			const isSelected = activeSlug === page.slug

			return (
				<li key={page.id} className="select-none">
					<div
						className={cn(
							'group flex items-center gap-1 rounded-md px-1.5 py-1 text-sm transition-colors',
							isSelected
								? 'bg-accent text-accent-foreground font-medium'
								: 'text-foreground hover:bg-muted/70'
						)}
						style={{ paddingLeft: `${(level - 1) * 12 + 4}px` }}
					>
						{hasChildren ? (
							<button
								type="button"
								aria-expanded={isExpanded}
								aria-label={isExpanded ? t('docs.sidebar.collapse') : t('docs.sidebar.expand')}
								onClick={() => toggleExpand(page.id)}
								className="flex size-5 shrink-0 items-center justify-center rounded hover:bg-muted"
							>
								{isExpanded ? (
									<ChevronDown className="size-3.5" aria-hidden />
								) : (
									<ChevronRight className="size-3.5" aria-hidden />
								)}
							</button>
						) : (
							<span className="size-5 shrink-0" aria-hidden />
						)}

						<button
							type="button"
							aria-current={isSelected ? 'page' : undefined}
							onClick={() => onSelectSlug(page.slug)}
							onKeyDown={(ev) => {
								if (ev.key === 'ArrowRight' && hasChildren && !isExpanded) toggleExpand(page.id)
								if (ev.key === 'ArrowLeft' && hasChildren && isExpanded) toggleExpand(page.id)
							}}
							className="flex min-w-0 flex-1 items-center gap-1.5 truncate text-left"
						>
							<span aria-hidden className="shrink-0 text-xs">
								{page.icon ?? <FileText className="size-3.5 text-muted-foreground" />}
							</span>
							<span className="truncate">{page.title}</span>
							{page.visibility === 'private' ? (
								<Lock className="size-3 shrink-0 text-muted-foreground" aria-hidden />
							) : null}
						</button>

						<DropdownMenu>
							<DropdownMenuTrigger asChild>
								<Button
									type="button"
									size="icon"
									tone="ghost"
									aria-label={`${page.title} actions`}
									className="size-6 opacity-0 group-hover:opacity-100 focus:opacity-100"
								>
									<MoreHorizontal className="size-3.5" aria-hidden />
								</Button>
							</DropdownMenuTrigger>
							<DropdownMenuContent align="end">
								<DropdownMenuItem
									onSelect={() => {
										setMoveTargetPage(page)
										setNextParentId(page.parentId ?? 'root')
									}}
								>
									<FolderInput className="size-3.5" aria-hidden />
									<span>{t('docs.sidebar.move-to')}</span>
								</DropdownMenuItem>
								<DropdownMenuItem
									className="text-destructive"
									onSelect={() => {
										void onArchivePage(page.id)
									}}
								>
									<Trash2 className="size-3.5" aria-hidden />
									<span>{t('docs.sidebar.archive')}</span>
								</DropdownMenuItem>
							</DropdownMenuContent>
						</DropdownMenu>
					</div>

					{isExpanded ? <ul>{renderBranch(page.id, level + 1)}</ul> : null}
				</li>
			)
		})
	}

	const eligibleMoveParents = useMemo(() => {
		if (!moveTargetPage) return []
		return activePages.filter(
			(p) => p.id !== moveTargetPage.id && !p.path.startsWith(`${moveTargetPage.path}/`)
		)
	}, [activePages, moveTargetPage])

	return (
		<aside
			aria-label={t('docs.sidebar.title')}
			className="flex w-64 shrink-0 flex-col border-r border-border bg-card/50"
		>
			<div className="flex items-center justify-between border-b border-border px-3 py-2.5">
				<span className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">
					{t('docs.sidebar.title')}
				</span>
				<div className="flex items-center gap-1">
					<Button
						type="button"
						size="icon"
						tone="ghost"
						aria-label={t('docs.sidebar.import')}
						onClick={onOpenImport}
					>
						<Upload className="size-3.5" aria-hidden />
					</Button>
					<Button
						type="button"
						size="icon"
						tone="ghost"
						aria-label={t('docs.sidebar.new-page')}
						onClick={onCreatePage}
					>
						<Plus className="size-4" aria-hidden />
					</Button>
				</div>
			</div>

			<div className="min-h-0 flex-1 space-y-4 overflow-y-auto p-2">
				{favorites.length > 0 ? (
					<section aria-label={t('docs.sidebar.favorites')}>
						<h2 className="px-2 pb-1 text-xs font-medium text-muted-foreground">
							{t('docs.sidebar.favorites')}
						</h2>
						<ul className="space-y-0.5">
							{favorites.map((fav) => (
								<li key={`fav-${fav.id}`}>
									<button
										type="button"
										onClick={() => onSelectSlug(fav.slug)}
										className={cn(
											'flex w-full items-center gap-1.5 rounded-md px-2 py-1 text-left text-sm transition-colors',
											activeSlug === fav.slug
												? 'bg-accent text-accent-foreground font-medium'
												: 'text-foreground hover:bg-muted/70'
										)}
									>
										<Star className="size-3.5 shrink-0 text-(--warning)" aria-hidden />
										<span className="truncate">{fav.title}</span>
									</button>
								</li>
							))}
						</ul>
					</section>
				) : null}

				<section aria-label={t('docs.sidebar.workspace')}>
					<h2 className="px-2 pb-1 text-xs font-medium text-muted-foreground">
						{t('docs.sidebar.workspace')}
					</h2>
					{activePages.length === 0 ? (
						<p className="px-2 py-4 text-xs text-muted-foreground">{t('docs.sidebar.empty')}</p>
					) : (
						<nav aria-label={t('docs.sidebar.workspace')}>
							<ul className="space-y-0.5">{renderBranch(null, 1)}</ul>
						</nav>
					)}
				</section>
			</div>

			<Dialog open={moveTargetPage !== null} onOpenChange={(o) => !o && setMoveTargetPage(null)}>
				<DialogContent className="max-w-sm">
					<DialogHeader>
						<DialogTitle>{t('docs.move.title')}</DialogTitle>
					</DialogHeader>
					<Select value={nextParentId} onValueChange={setNextParentId}>
						<SelectTrigger aria-label={t('docs.create.parent-label')}>
							<SelectValue />
						</SelectTrigger>
						<SelectContent>
							<SelectItem value="root">{t('docs.create.root-option')}</SelectItem>
							{eligibleMoveParents.map((p) => (
								<SelectItem key={p.id} value={p.id}>
									{p.title}
								</SelectItem>
							))}
						</SelectContent>
					</Select>
					<DialogFooter>
						<Button type="button" tone="outline" onClick={() => setMoveTargetPage(null)}>
							{t('common.cancel')}
						</Button>
						<Button
							type="button"
							onClick={() => {
								if (!moveTargetPage) return
								const targetParent = nextParentId === 'root' ? null : nextParentId
								void onMovePage(moveTargetPage.id, targetParent).then(() => setMoveTargetPage(null))
							}}
						>
							{t('docs.move.confirm')}
						</Button>
					</DialogFooter>
				</DialogContent>
			</Dialog>
		</aside>
	)
}
