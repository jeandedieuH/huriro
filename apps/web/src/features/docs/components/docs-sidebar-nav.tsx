import type { DocPageDto } from '@huriro/contracts'
import { t } from '@huriro/i18n'
import { useCollectionItems, useSyncEngine } from '@huriro/sync-client'
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
import {
	SidebarNavItem,
	SidebarSection,
	useSidebarCollapsed
} from '@/components/app-shell/sidebar/sidebar-primitives'
import { Button } from '@/components/ui/button'
import { Dialog, DialogContent, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog'
import {
	DropdownMenu,
	DropdownMenuContent,
	DropdownMenuItem,
	DropdownMenuTrigger
} from '@/components/ui/dropdown-menu'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select'
import { Tooltip, TooltipContent, TooltipTrigger } from '@/components/ui/tooltip'
import { navigateToDoc } from '@/lib/navigation'
import { cn } from '@/lib/utils'
import { useUiStore } from '@/stores/ui-store'

export interface DocsSidebarNavProps {
	readonly activeSlug: string | null
	readonly collapsed?: boolean | undefined
	readonly onSelectSlug?: ((slug: string) => void) | undefined
}

function sortPages(a: DocPageDto, b: DocPageDto): number {
	return a.position < b.position ? -1 : a.position > b.position ? 1 : a.id.localeCompare(b.id)
}

export function DocsSidebarNav({ activeSlug, collapsed, onSelectSlug }: DocsSidebarNavProps) {
	const ctxCollapsed = useSidebarCollapsed()
	const isCollapsed = collapsed ?? ctxCollapsed
	const engine = useSyncEngine()
	const pages = useCollectionItems(engine.collections.docPages)

	const [collapsedNodes, setCollapsedNodes] = useState<Set<string>>(() => new Set())
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

	function selectSlug(slug: string) {
		if (onSelectSlug) onSelectSlug(slug)
		else navigateToDoc(slug)
	}

	function toggleExpand(pageId: string) {
		setCollapsedNodes((prev) => {
			const next = new Set(prev)
			if (next.has(pageId)) next.delete(pageId)
			else next.add(pageId)
			return next
		})
	}

	async function handleMovePage(pageId: string, parentId: string | null) {
		await engine.moveDocPage(pageId, { parentId })
	}

	async function handleArchivePage(pageId: string) {
		await engine.deleteDocPage(pageId)
	}

	const eligibleMoveParents = useMemo(() => {
		if (!moveTargetPage) return []
		return activePages.filter(
			(p) => p.id !== moveTargetPage.id && !p.path.startsWith(`${moveTargetPage.path}/`)
		)
	}, [activePages, moveTargetPage])

	if (isCollapsed) {
		const topLevelPages = childrenByParent.get(null) ?? []
		return (
			<nav aria-label={t('docs.sidebar.workspace')} className="space-y-1">
				{topLevelPages.map((page) => (
					<SidebarNavItem
						key={page.id}
						icon={page.icon ? <span className="text-xs">{page.icon}</span> : <FileText className="size-4" />}
						label={page.title}
						active={activeSlug === page.slug}
						isCurrentPage={activeSlug === page.slug}
						collapsed
						onClick={() => selectSlug(page.slug)}
					/>
				))}
			</nav>
		)
	}

	function renderBranch(parentId: string | null, level: number) {
		const nodes = childrenByParent.get(parentId) ?? []
		if (nodes.length === 0) return null
		return nodes.map((page) => {
			const kids = childrenByParent.get(page.id) ?? []
			const hasChildren = kids.length > 0
			const isExpanded = hasChildren && !collapsedNodes.has(page.id)
			const isSelected = activeSlug === page.slug

			return (
				<li key={page.id} className="select-none">
					<div
						className={cn(
							'group flex items-center gap-1 rounded-xl px-1.5 py-1 text-sm transition-colors',
							isSelected
								? 'bg-sidebar-accent font-medium text-sidebar-accent-foreground'
								: 'text-sidebar-muted-foreground hover:bg-sidebar-accent/60 hover:text-sidebar-foreground'
						)}
						style={{ paddingLeft: `${(level - 1) * 12 + 4}px` }}
					>
						{hasChildren ? (
							<button
								type="button"
								aria-expanded={isExpanded}
								aria-label={isExpanded ? t('docs.sidebar.collapse') : t('docs.sidebar.expand')}
								onClick={() => toggleExpand(page.id)}
								className="flex size-5 shrink-0 items-center justify-center rounded hover:bg-sidebar-accent"
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
							onClick={() => selectSlug(page.slug)}
							onKeyDown={(ev) => {
								if (ev.key === 'ArrowRight' && hasChildren && !isExpanded) toggleExpand(page.id)
								if (ev.key === 'ArrowLeft' && hasChildren && isExpanded) toggleExpand(page.id)
							}}
							className="flex min-w-0 flex-1 items-center gap-2 truncate text-left"
						>
							<span
								aria-hidden
								className={cn(
									'flex size-6 shrink-0 items-center justify-center rounded-md text-xs',
									isSelected
										? 'bg-sidebar-primary text-sidebar-primary-foreground'
										: 'border border-sidebar-border/60 bg-sidebar-icon-well text-sidebar-muted-foreground'
								)}
							>
								{page.icon ?? <FileText className="size-3.5" />}
							</span>
							<span className="truncate">{page.title}</span>
							{page.visibility === 'private' ? (
								<Lock className="size-3 shrink-0 text-sidebar-muted-foreground" aria-hidden />
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
										void handleArchivePage(page.id)
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

	return (
		<div className="space-y-2">
			{favorites.length > 0 ? (
				<SidebarSection title={t('docs.sidebar.favorites')}>
					<ul className="space-y-0.5">
						{favorites.map((fav) => (
							<li key={`fav-${fav.id}`}>
								<SidebarNavItem
									icon={<Star className="size-3.5 text-(--warning)" />}
									label={fav.title}
									active={activeSlug === fav.slug}
									onClick={() => selectSlug(fav.slug)}
								/>
							</li>
						))}
					</ul>
				</SidebarSection>
			) : null}

			<SidebarSection title={t('docs.sidebar.workspace')}>
				{activePages.length === 0 ? (
					<p className="px-2 py-3 text-xs text-sidebar-muted-foreground">{t('docs.sidebar.empty')}</p>
				) : (
					<nav aria-label={t('docs.sidebar.workspace')}>
						<ul className="space-y-0.5">{renderBranch(null, 1)}</ul>
					</nav>
				)}
			</SidebarSection>

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
								void handleMovePage(moveTargetPage.id, targetParent).then(() => setMoveTargetPage(null))
							}}
						>
							{t('docs.move.confirm')}
						</Button>
					</DialogFooter>
				</DialogContent>
			</Dialog>
		</div>
	)
}

export function DocsSidebarHeaderAction() {
	const setCreateDocOpen = useUiStore((s) => s.setCreateDocOpen)
	return (
		<Tooltip>
			<TooltipTrigger asChild>
				<button
					type="button"
					aria-label={t('docs.sidebar.new-page')}
					onClick={() => setCreateDocOpen(true)}
					className="flex size-7 items-center justify-center rounded-lg text-sidebar-muted-foreground transition-colors hover:bg-sidebar-accent hover:text-sidebar-foreground"
				>
					<Plus className="size-4" aria-hidden />
				</button>
			</TooltipTrigger>
			<TooltipContent side="bottom">{t('docs.sidebar.new-page')}</TooltipContent>
		</Tooltip>
	)
}

export function DocsSidebarFooterUtility({ collapsed }: { readonly collapsed?: boolean | undefined }) {
	const ctxCollapsed = useSidebarCollapsed()
	const isCollapsed = collapsed ?? ctxCollapsed
	const setDocImportOpen = useUiStore((s) => s.setDocImportOpen)
	return (
		<SidebarNavItem
			icon={<Upload className="size-4" />}
			label={t('docs.sidebar.import')}
			collapsed={isCollapsed}
			onClick={() => setDocImportOpen(true)}
		/>
	)
}
