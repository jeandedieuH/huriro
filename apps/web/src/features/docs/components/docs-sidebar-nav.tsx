import type { DocPageDto } from '@huriro/contracts'
import { t } from '@huriro/i18n'
import { useCollectionItems, useSyncEngine } from '@huriro/sync-client'
import { useNavigate } from '@tanstack/react-router'
import { Database as DatabaseIcon, FileText, Network, Plus, Settings2, Star, Upload } from 'lucide-react'
import { type CSSProperties, useEffect, useMemo, useRef, useState } from 'react'
import { SidebarNavItem, useSidebarCollapsed } from '@/components/app-shell/sidebar/sidebar-primitives'
import { Button } from '@/components/ui/button'
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from '@/components/ui/tooltip'
import { navigateToDoc } from '@/lib/navigation'
import { useUiStore } from '@/stores/ui-store'
import { DocsMovePageDialog } from './sidebar/docs-move-page-dialog'
import { DocsPageIconDialog } from './sidebar/docs-page-icon-dialog'
import { DocsSidebarFilter } from './sidebar/docs-sidebar-filter'
import { DocsSidebarRow, type DocsSidebarRowDnd } from './sidebar/docs-sidebar-row'
import { DocsSidebarSection } from './sidebar/docs-sidebar-section'
import {
	buildBreadcrumb,
	buildChildrenIndex,
	canDropPage,
	collectAncestorIds,
	collectExpandableIds,
	compareByPosition,
	type DocsDropZone,
	filterPagesByQuery,
	sortTeamspaces
} from './sidebar/docs-sidebar-tree'
import { useDocsSidebarActions } from './sidebar/use-docs-sidebar-actions'

export interface DocsSidebarNavProps {
	readonly activeSlug: string | null
	readonly collapsed?: boolean | undefined
	readonly onSelectSlug?: ((slug: string) => void) | undefined
}

interface DragState {
	readonly dragId: string | null
	readonly overId: string | null
	readonly zone: DocsDropZone | null
}

const IDLE_DRAG: DragState = { dragId: null, overId: null, zone: null }

/** A page can appear in several sections at once; inline rename must only open in the row that asked. */
type RowSurface = 'tree' | 'favorites' | 'results'

export function DocsSidebarNav({ activeSlug, collapsed, onSelectSlug }: DocsSidebarNavProps) {
	const navigate = useNavigate()
	const ctxCollapsed = useSidebarCollapsed()
	const isCollapsed = collapsed ?? ctxCollapsed
	const engine = useSyncEngine()
	const pages = useCollectionItems(engine.collections.docPages)
	const teamspaces = useCollectionItems(engine.collections.teamspaces)
	const setTeamspaceManagerOpen = useUiStore((s) => s.setTeamspaceManagerOpen)
	const setDocsGraphOpen = useUiStore((s) => s.setDocsGraphOpen)
	const setCreateDocOpen = useUiStore((s) => s.setCreateDocOpen)

	// Collapsed set (not expanded set) so every branch is open by default and new pages appear unfolded.
	const [collapsedNodes, setCollapsedNodes] = useState<Set<string>>(() => new Set())
	const [filter, setFilter] = useState('')
	const [renaming, setRenaming] = useState<{ readonly id: string; readonly surface: RowSurface } | null>(null)
	const [moveTargetPage, setMoveTargetPage] = useState<DocPageDto | null>(null)
	const [iconTargetPage, setIconTargetPage] = useState<DocPageDto | null>(null)
	const [drag, setDrag] = useState<DragState>(IDLE_DRAG)
	// Refs mirror active drag target so synchronous dragStart→dragOver→drop frames never read stale state.
	const dragIdRef = useRef<string | null>(null)
	const dragZoneRef = useRef<DocsDropZone | null>(null)

	const activePages = useMemo(() => pages.filter((p) => p.archivedAt === null && !p.isTemplate), [pages])
	const pagesById = useMemo(() => new Map(activePages.map((p) => [p.id, p])), [activePages])
	const activeTeamspaces = useMemo(
		() => sortTeamspaces(teamspaces.filter((ts) => ts.archivedAt === null)),
		[teamspaces]
	)
	const childrenByParent = useMemo(() => buildChildrenIndex(activePages), [activePages])
	const favorites = useMemo(
		() => activePages.filter((p) => p.isFavorite).sort(compareByPosition),
		[activePages]
	)
	const rootPages = useMemo(() => childrenByParent.get(null) ?? [], [childrenByParent])
	const unassignedRootPages = useMemo(() => {
		const tsIds = new Set(activeTeamspaces.map((ts) => ts.id))
		return rootPages.filter((p) => !p.teamspaceId || !tsIds.has(p.teamspaceId))
	}, [activeTeamspaces, rootPages])

	const expandableIds = useMemo(() => collectExpandableIds(childrenByParent), [childrenByParent])
	const allCollapsed = expandableIds.length > 0 && expandableIds.every((id) => collapsedNodes.has(id))

	const trimmedFilter = filter.trim()
	const filterResults = useMemo(
		() => (trimmedFilter ? filterPagesByQuery(activePages, trimmedFilter) : []),
		[activePages, trimmedFilter]
	)

	// Reveal the active page: re-open its collapsed ancestors only when the active page itself changes,
	// so a user who manually folds a branch isn't fought on every sync tick.
	const activeAncestorKey = useMemo(() => {
		const active = activeSlug ? activePages.find((p) => p.slug === activeSlug) : undefined
		return active ? collectAncestorIds(active, pagesById).join(',') : ''
	}, [activePages, activeSlug, pagesById])
	useEffect(() => {
		if (!activeAncestorKey) return
		const ancestorIds = activeAncestorKey.split(',')
		setCollapsedNodes((prev) => {
			if (!ancestorIds.some((id) => prev.has(id))) return prev
			const next = new Set(prev)
			for (const id of ancestorIds) next.delete(id)
			return next
		})
	}, [activeAncestorKey])

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

	function expandNode(pageId: string) {
		setCollapsedNodes((prev) => {
			if (!prev.has(pageId)) return prev
			const next = new Set(prev)
			next.delete(pageId)
			return next
		})
	}

	function handleToggleAll() {
		setCollapsedNodes(allCollapsed ? new Set() : new Set(expandableIds))
	}

	const actions = useDocsSidebarActions({ activePages, childrenByParent, activeSlug, selectSlug, expandNode })

	const dnd: DocsSidebarRowDnd = {
		onDragStart: (page) => {
			dragIdRef.current = page.id
			dragZoneRef.current = null
			setDrag({ dragId: page.id, overId: null, zone: null })
		},
		onDragOver: (page, zone) => {
			const activeDragId = dragIdRef.current ?? drag.dragId
			const dragged = activeDragId ? pagesById.get(activeDragId) : undefined
			if (!dragged || !canDropPage(dragged, page, zone)) {
				dragZoneRef.current = null
				if (drag.overId) setDrag((prev) => ({ ...prev, overId: null, zone: null }))
				return false
			}
			dragZoneRef.current = zone
			if (drag.overId !== page.id || drag.zone !== zone)
				setDrag((prev) => ({ ...prev, overId: page.id, zone }))
			return true
		},
		onDragLeave: (page) => {
			if (drag.overId === page.id) {
				dragZoneRef.current = null
				setDrag((prev) => ({ ...prev, overId: null, zone: null }))
			}
		},
		onDrop: (page) => {
			const activeDragId = dragIdRef.current ?? drag.dragId
			const dragged = activeDragId ? pagesById.get(activeDragId) : undefined
			const zone = dragZoneRef.current ?? drag.zone
			dragIdRef.current = null
			dragZoneRef.current = null
			setDrag(IDLE_DRAG)
			if (dragged && zone) void actions.dropPage(dragged, page, zone)
		},
		onDragEnd: () => {
			dragIdRef.current = null
			dragZoneRef.current = null
			setDrag(IDLE_DRAG)
		}
	}

	if (isCollapsed) {
		return (
			<TooltipProvider delayDuration={300}>
				<nav aria-label={t('docs.sidebar.workspace')} className="space-y-1">
					{rootPages.map((page) => (
						<SidebarNavItem
							key={page.id}
							icon={
								page.icon ? <span className="text-xs">{page.icon}</span> : <FileText className="size-4" />
							}
							label={page.title}
							active={activeSlug === page.slug}
							isCurrentPage={activeSlug === page.slug}
							collapsed
							onClick={() => selectSlug(page.slug)}
						/>
					))}
					<div className="mx-auto my-2 h-px w-6 bg-sidebar-border" aria-hidden />
					<SidebarNavItem
						icon={<DatabaseIcon className="size-4" />}
						label={t('databases.home.title')}
						active={activeSlug === 'databases'}
						isCurrentPage={activeSlug === 'databases'}
						collapsed
						onClick={() => void navigate({ to: '/docs/databases' })}
					/>
					<SidebarNavItem
						icon={<Network className="size-4" />}
						label={t('docs.graph.open')}
						collapsed
						onClick={() => setDocsGraphOpen(true)}
					/>
					<SidebarNavItem
						icon={<Settings2 className="size-4" />}
						label={t('docs.teamspaces.manage')}
						collapsed
						onClick={() => setTeamspaceManagerOpen(true)}
					/>
				</nav>
			</TooltipProvider>
		)
	}

	/** Shared row factory so tree, favorites and filter results stay visually identical. */
	function renderRow(
		page: DocPageDto,
		level: number,
		options: {
			readonly surface?: RowSurface
			readonly hasChildren?: boolean
			readonly childCount?: number
			readonly reserveGutter?: boolean
			readonly isExpanded?: boolean
			readonly breadcrumb?: string
			readonly draggable?: boolean
		} = {}
	) {
		const surface = options.surface ?? 'tree'
		return (
			<DocsSidebarRow
				page={page}
				level={level}
				isSelected={activeSlug === page.slug}
				hasChildren={options.hasChildren ?? false}
				isExpanded={options.isExpanded ?? false}
				childCount={options.childCount}
				reserveGutter={options.reserveGutter ?? false}
				breadcrumb={options.breadcrumb}
				isRenaming={renaming?.id === page.id && renaming.surface === surface}
				isDragging={drag.dragId === page.id}
				dropZone={drag.overId === page.id ? drag.zone : null}
				actions={actions}
				dnd={options.draggable ? dnd : undefined}
				onSelect={selectSlug}
				onToggleExpand={toggleExpand}
				onStartRename={(id) => setRenaming({ id, surface })}
				onStopRename={() => setRenaming(null)}
				onOpenMove={setMoveTargetPage}
				onOpenIcon={setIconTargetPage}
			/>
		)
	}

	function renderBranch(parentId: string | null, level: number, overrideNodes?: readonly DocPageDto[]) {
		const nodes = parentId === null && overrideNodes ? overrideNodes : (childrenByParent.get(parentId) ?? [])
		if (nodes.length === 0) return null
		// Keep leaf-only branches flush with standard sidebar actions; reserve the chevron gutter only when a sibling can expand.
		const hasExpandableSiblings = nodes.some((node) => (childrenByParent.get(node.id) ?? []).length > 0)
		return nodes.map((page) => {
			const kids = childrenByParent.get(page.id) ?? []
			const hasChildren = kids.length > 0
			const isExpanded = hasChildren && !collapsedNodes.has(page.id)

			return (
				<li key={page.id} className="select-none">
					{renderRow(page, level, {
						hasChildren,
						childCount: kids.length,
						isExpanded,
						reserveGutter: hasExpandableSiblings,
						draggable: true
					})}
					{isExpanded ? (
						<ul
							// Indent guide drawn as a pseudo-element (keeps <ul> children valid <li>s for assistive tech).
							className="relative mt-0.5 space-y-0.5 before:pointer-events-none before:absolute before:inset-y-0.5 before:left-(--guide-left) before:w-px before:bg-sidebar-border/60"
							style={{ '--guide-left': `${(level - 1) * 12 + 14}px` } as CSSProperties}
						>
							{renderBranch(page.id, level + 1)}
						</ul>
					) : null}
				</li>
			)
		})
	}

	const hasAnyContent = unassignedRootPages.length > 0 || activeTeamspaces.length > 0 || rootPages.length > 0
	const workspaceTitle =
		activeTeamspaces.length > 0 ? t('docs.teamspaces.workspace-root') : t('docs.sidebar.workspace')

	return (
		<TooltipProvider delayDuration={300}>
			<div data-docs-sidebar className="space-y-1">
				{activePages.length > 0 ? (
					<DocsSidebarFilter
						value={filter}
						onChange={setFilter}
						canToggleAll={expandableIds.length > 0}
						allCollapsed={allCollapsed}
						onToggleAll={handleToggleAll}
					/>
				) : null}

				{trimmedFilter ? (
					<DocsSidebarSection
						title={t('docs.sidebar.filter-results')}
						collapsible={false}
						count={filterResults.length}
					>
						{filterResults.length === 0 ? (
							<p className="px-2 py-3 text-xs text-sidebar-muted-foreground">
								{t('docs.sidebar.filter-empty', { query: trimmedFilter })}
							</p>
						) : (
							<nav aria-label={t('docs.sidebar.filter-results')}>
								<ul className="space-y-0.5">
									{filterResults.map((page) => (
										<li key={page.id}>
											{renderRow(page, 1, {
												surface: 'results',
												breadcrumb: buildBreadcrumb(page, pagesById)
											})}
										</li>
									))}
								</ul>
							</nav>
						)}
					</DocsSidebarSection>
				) : (
					<>
						{favorites.length > 0 ? (
							<DocsSidebarSection
								title={t('docs.sidebar.favorites')}
								icon={<Star className="size-3 fill-(--warning) text-(--warning)" aria-hidden />}
								count={favorites.length}
							>
								<ul className="space-y-0.5">
									{favorites.map((fav) => (
										<li key={`fav-${fav.id}`}>{renderRow(fav, 1, { surface: 'favorites' })}</li>
									))}
								</ul>
							</DocsSidebarSection>
						) : null}

						{activeTeamspaces.map((ts) => {
							const tsRoots = rootPages.filter((p) => p.teamspaceId === ts.id)
							return (
								<DocsSidebarSection
									key={ts.id}
									title={ts.name}
									icon={
										ts.icon ? (
											<span aria-hidden className="text-xs leading-none">
												{ts.icon}
											</span>
										) : undefined
									}
									count={tsRoots.length}
									action={
										<SectionAddButton
											label={t('docs.sidebar.new-page-in', { name: ts.name })}
											onClick={() => void actions.createPage({ parentId: null, teamspaceId: ts.id })}
										/>
									}
								>
									{tsRoots.length === 0 ? (
										<div className="space-y-1.5 px-2 py-1.5">
											<p className="text-xs text-sidebar-muted-foreground">
												{t('docs.sidebar.teamspace-empty')}
											</p>
											<Button
												type="button"
												size="sm"
												tone="outline"
												className="h-7 gap-1 px-2 text-xs"
												onClick={() => void actions.createPage({ parentId: null, teamspaceId: ts.id })}
											>
												<Plus className="size-3" aria-hidden />
												{t('docs.sidebar.teamspace-add-first')}
											</Button>
										</div>
									) : (
										<nav aria-label={ts.name}>
											<ul className="space-y-0.5">{renderBranch(null, 1, tsRoots)}</ul>
										</nav>
									)}
								</DocsSidebarSection>
							)
						})}

						<DocsSidebarSection
							title={workspaceTitle}
							count={unassignedRootPages.length}
							action={
								hasAnyContent ? (
									<SectionAddButton
										label={t('docs.sidebar.new-page-in', { name: workspaceTitle })}
										onClick={() => void actions.createPage({ parentId: null, teamspaceId: null })}
									/>
								) : null
							}
						>
							{!hasAnyContent ? (
								<DocsSidebarEmpty onCreate={() => setCreateDocOpen(true)} />
							) : unassignedRootPages.length === 0 ? null : (
								<nav aria-label={t('docs.sidebar.workspace')}>
									<ul className="space-y-0.5">{renderBranch(null, 1, unassignedRootPages)}</ul>
								</nav>
							)}
						</DocsSidebarSection>
					</>
				)}

				<DocsSidebarSection title={t('docs.sidebar.explore')}>
					<SidebarNavItem
						icon={<DatabaseIcon className="size-4" />}
						label={t('databases.home.title')}
						active={activeSlug === 'databases'}
						isCurrentPage={activeSlug === 'databases'}
						onClick={() => void navigate({ to: '/docs/databases' })}
					/>
					<SidebarNavItem
						icon={<Network className="size-4" />}
						label={t('docs.graph.open')}
						onClick={() => setDocsGraphOpen(true)}
					/>
					<SidebarNavItem
						icon={<Settings2 className="size-4" />}
						label={t('docs.teamspaces.manage')}
						onClick={() => setTeamspaceManagerOpen(true)}
					/>
				</DocsSidebarSection>

				<DocsMovePageDialog
					page={moveTargetPage}
					pages={activePages}
					teamspaces={activeTeamspaces}
					onClose={() => setMoveTargetPage(null)}
					onMove={actions.movePage}
				/>
				<DocsPageIconDialog
					page={iconTargetPage}
					onClose={() => setIconTargetPage(null)}
					onSelect={actions.setPageIcon}
				/>
			</div>
		</TooltipProvider>
	)
}

function SectionAddButton({ label, onClick }: { readonly label: string; readonly onClick: () => void }) {
	return (
		<Tooltip>
			<TooltipTrigger asChild>
				<button
					type="button"
					aria-label={label}
					onClick={onClick}
					className="flex size-5 items-center justify-center rounded-md text-sidebar-muted-foreground/80 outline-none transition-colors hover:bg-sidebar-accent hover:text-sidebar-foreground focus-visible:ring-2 focus-visible:ring-sidebar-primary/60"
				>
					<Plus className="size-3.5" aria-hidden />
				</button>
			</TooltipTrigger>
			<TooltipContent side="top">{label}</TooltipContent>
		</Tooltip>
	)
}

function DocsSidebarEmpty({ onCreate }: { readonly onCreate: () => void }) {
	return (
		<div className="flex flex-col items-center gap-2 rounded-xl border border-dashed border-sidebar-border px-3 py-5 text-center">
			<span className="flex size-9 items-center justify-center rounded-xl border border-sidebar-border/70 bg-sidebar-icon-well text-sidebar-muted-foreground">
				<FileText className="size-4" aria-hidden />
			</span>
			<p className="text-[13px] font-medium text-sidebar-foreground">{t('docs.sidebar.empty-title')}</p>
			<p className="text-xs text-sidebar-muted-foreground">{t('docs.sidebar.empty')}</p>
			<Button type="button" size="sm" tone="outline" className="mt-1 h-7 gap-1.5 text-xs" onClick={onCreate}>
				<Plus className="size-3.5" aria-hidden />
				{t('docs.sidebar.empty-cta')}
			</Button>
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
