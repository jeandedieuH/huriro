import type { DocPageDto } from '@huriro/contracts'
import { t } from '@huriro/i18n'
import { ChevronRight, FilePlus2, FileText, Lock } from 'lucide-react'
import { type KeyboardEvent, useState } from 'react'
import { Tooltip, TooltipContent, TooltipTrigger } from '@/components/ui/tooltip'
import { cn } from '@/lib/utils'
import { DocsSidebarInlineRename } from './docs-sidebar-inline-rename'
import { DocsSidebarRowMenu } from './docs-sidebar-row-menu'
import { type DocsDropZone, resolveDropZone } from './docs-sidebar-tree'
import type { DocsSidebarActions } from './use-docs-sidebar-actions'

/** Drag-and-drop plumbing owned by the tree; rows only report pointer events. */
export interface DocsSidebarRowDnd {
	readonly onDragStart: (page: DocPageDto) => void
	/** Returns true when the drop is legal here (row then calls preventDefault). */
	readonly onDragOver: (page: DocPageDto, zone: DocsDropZone) => boolean
	readonly onDragLeave: (page: DocPageDto) => void
	readonly onDrop: (page: DocPageDto) => void
	readonly onDragEnd: () => void
}

export interface DocsSidebarRowProps {
	readonly page: DocPageDto
	/** 1-based tree depth; drives indentation. */
	readonly level: number
	readonly isSelected: boolean
	readonly hasChildren: boolean
	readonly isExpanded: boolean
	readonly childCount?: number | undefined
	/** Reserve the chevron gutter so leaf siblings align with expandable ones. */
	readonly reserveGutter: boolean
	/** Parent trail, shown under the title in filter results. */
	readonly breadcrumb?: string | undefined
	readonly isRenaming: boolean
	readonly isDragging?: boolean | undefined
	readonly dropZone: DocsDropZone | null
	readonly actions: DocsSidebarActions
	readonly dnd?: DocsSidebarRowDnd | undefined
	readonly onSelect: (slug: string) => void
	readonly onToggleExpand: (pageId: string) => void
	readonly onStartRename: (pageId: string) => void
	readonly onStopRename: () => void
	readonly onOpenMove: (page: DocPageDto) => void
	readonly onOpenIcon: (page: DocPageDto) => void
}

/** One page in the docs sidebar: disclosure, glyph, title, status badges and hover actions. */
export function DocsSidebarRow({
	page,
	level,
	isSelected,
	hasChildren,
	isExpanded,
	childCount,
	reserveGutter,
	breadcrumb,
	isRenaming,
	isDragging = false,
	dropZone,
	actions,
	dnd,
	onSelect,
	onToggleExpand,
	onStartRename,
	onStopRename,
	onOpenMove,
	onOpenIcon
}: DocsSidebarRowProps) {
	const [menuOpen, setMenuOpen] = useState(false)
	const isRestricted = page.visibility === 'private' || page.isLocked

	function handleRowKeyDown(ev: KeyboardEvent<HTMLButtonElement>) {
		if (ev.key === 'ArrowRight' && hasChildren && !isExpanded) onToggleExpand(page.id)
		else if (ev.key === 'ArrowLeft' && hasChildren && isExpanded) onToggleExpand(page.id)
		else if (ev.key === 'F2' && !page.isLocked) {
			ev.preventDefault()
			onStartRename(page.id)
		} else if (ev.key === 'ArrowDown' || ev.key === 'ArrowUp') {
			// Roving focus across every visible row in this sidebar.
			const root = ev.currentTarget.closest('[data-docs-sidebar]')
			if (!root) return
			const rows = Array.from(root.querySelectorAll<HTMLElement>('[data-docs-row]'))
			const next = rows[rows.indexOf(ev.currentTarget) + (ev.key === 'ArrowDown' ? 1 : -1)]
			if (!next) return
			ev.preventDefault()
			next.focus()
		}
	}

	return (
		// biome-ignore lint/a11y/noStaticElementInteractions: pointer-only gestures (right-click menu, drag/drop reorder); every keyboard/AT path lives on the real buttons inside, and "Move to…" is the accessible alternative to dragging.
		<div
			data-menu-open={menuOpen}
			draggable={Boolean(dnd) && !isRenaming}
			onContextMenu={(ev) => {
				ev.preventDefault()
				setMenuOpen(true)
			}}
			onDragStart={(ev) => {
				if (!dnd) return
				ev.dataTransfer.effectAllowed = 'move'
				ev.dataTransfer.setData('text/plain', page.id)
				dnd.onDragStart(page)
			}}
			onDragOver={(ev) => {
				if (!dnd) return
				const rect = ev.currentTarget.getBoundingClientRect()
				if (!dnd.onDragOver(page, resolveDropZone(ev.clientY - rect.top, rect.height))) return
				ev.preventDefault()
				ev.dataTransfer.dropEffect = 'move'
			}}
			onDragLeave={(ev) => {
				if (!ev.currentTarget.contains(ev.relatedTarget as Node | null)) dnd?.onDragLeave(page)
			}}
			onDrop={(ev) => {
				if (!dnd) return
				ev.preventDefault()
				dnd.onDrop(page)
			}}
			onDragEnd={() => dnd?.onDragEnd()}
			className={cn(
				'group/row relative flex items-center gap-0.5 rounded-lg pr-1 text-[13px] transition-colors duration-(--motion-duration-fast)',
				isSelected
					? 'bg-sidebar-accent/95 font-medium text-sidebar-accent-foreground shadow-(--shadow-1)'
					: 'text-sidebar-muted-foreground hover:bg-sidebar-accent/55 hover:text-sidebar-foreground',
				isDragging && 'opacity-45',
				dropZone === 'inside' && 'bg-sidebar-accent/70 ring-1 ring-sidebar-primary/70'
			)}
			style={{ paddingLeft: `${(level - 1) * 12 + 4}px` }}
		>
			{hasChildren ? (
				<button
					type="button"
					aria-expanded={isExpanded}
					aria-label={isExpanded ? t('docs.sidebar.collapse') : t('docs.sidebar.expand')}
					onClick={() => onToggleExpand(page.id)}
					className="flex size-5 shrink-0 items-center justify-center rounded-md text-sidebar-muted-foreground outline-none transition-colors hover:bg-sidebar-border/60 hover:text-sidebar-foreground focus-visible:ring-2 focus-visible:ring-sidebar-primary/60"
				>
					<ChevronRight
						className={cn(
							'size-3.5 transition-transform duration-(--motion-duration-fast) motion-reduce:transition-none',
							isExpanded && 'rotate-90'
						)}
						aria-hidden
					/>
				</button>
			) : reserveGutter ? (
				<span className="size-5 shrink-0" aria-hidden />
			) : null}

			{isRenaming ? (
				<DocsSidebarInlineRename
					initialTitle={page.title}
					onCommit={(title) => {
						onStopRename()
						void actions.renamePage(page, title)
					}}
					onCancel={onStopRename}
				/>
			) : (
				<button
					type="button"
					data-docs-row
					aria-current={isSelected ? 'page' : undefined}
					onClick={() => onSelect(page.slug)}
					onKeyDown={handleRowKeyDown}
					className="flex min-w-0 flex-1 items-center gap-2 rounded-md py-1.5 pr-1 text-left outline-none focus-visible:ring-2 focus-visible:ring-sidebar-primary/60 group-focus-within/row:pr-[3.75rem] group-hover/row:pr-[3.75rem] group-data-[menu-open=true]/row:pr-[3.75rem]"
				>
					<span
						aria-hidden
						className="flex size-5 shrink-0 items-center justify-center text-[15px] leading-none"
					>
						{page.icon ? page.icon : <FileText className={cn('size-4', !isSelected && 'opacity-70')} />}
					</span>
					<span className="flex min-w-0 flex-1 flex-col">
						<span className="truncate">{page.title}</span>
						{breadcrumb ? (
							<span className="truncate text-[11px] font-normal text-sidebar-muted-foreground/70">
								{breadcrumb}
							</span>
						) : null}
					</span>
					{page.verificationStatus === 'verified' ? (
						<span
							role="img"
							title={t('docs.verify.badge.verified')}
							className="size-1.5 shrink-0 rounded-full bg-(--success)"
							aria-label={t('docs.verify.badge.verified')}
						/>
					) : page.verificationStatus === 'stale' ? (
						<span
							role="img"
							title={t('docs.verify.badge.stale')}
							className="size-1.5 shrink-0 rounded-full bg-(--warning)"
							aria-label={t('docs.verify.badge.stale')}
						/>
					) : null}
					{isRestricted ? (
						<Lock className="size-3 shrink-0 text-sidebar-muted-foreground/80" aria-hidden />
					) : null}
					{hasChildren && !isExpanded && (childCount ?? 0) > 0 ? (
						<span
							aria-hidden
							className="shrink-0 rounded-full bg-sidebar-border/50 px-1.5 py-0.5 font-mono text-[10px] leading-none text-sidebar-muted-foreground tnum group-hover/row:hidden group-focus-within/row:hidden group-data-[menu-open=true]/row:hidden"
						>
							{childCount}
						</span>
					) : null}
				</button>
			)}

			{/*
			 * Overlay actions: absolutely positioned so they never steal width from the title.
			 * Stays mounted while renaming (just hidden) so the dropdown's focus restore can't
			 * race the inline input and blur-cancel the edit.
			 */}
			<div
				className={cn(
					'absolute top-1/2 right-1 flex -translate-y-1/2 items-center gap-0.5 opacity-0 transition-opacity duration-(--motion-duration-fast)',
					'group-focus-within/row:opacity-100 group-hover/row:opacity-100 group-data-[menu-open=true]/row:opacity-100 pointer-coarse:opacity-100',
					isRenaming && 'hidden'
				)}
			>
				<Tooltip>
					<TooltipTrigger asChild>
						<button
							type="button"
							aria-label={t('docs.sidebar.add-subpage-to', { title: page.title })}
							onClick={(ev) => {
								ev.stopPropagation()
								void actions.createPage({ parentId: page.id })
							}}
							className="flex size-6 items-center justify-center rounded-md text-sidebar-muted-foreground outline-none transition-colors hover:bg-sidebar-border/60 hover:text-sidebar-foreground focus-visible:ring-2 focus-visible:ring-sidebar-primary/60"
						>
							<FilePlus2 className="size-4" aria-hidden />
						</button>
					</TooltipTrigger>
					<TooltipContent side="top">{t('docs.sidebar.add-subpage')}</TooltipContent>
				</Tooltip>
				<DocsSidebarRowMenu
					page={page}
					actions={actions}
					open={menuOpen}
					onOpenChange={setMenuOpen}
					onRename={() => onStartRename(page.id)}
					onChangeIcon={() => onOpenIcon(page)}
					onMove={() => onOpenMove(page)}
				/>
			</div>

			{/* Decorative state markers live last so the interactive controls stay the first children. */}
			{isSelected ? (
				<span
					aria-hidden
					className="pointer-events-none absolute top-1.5 bottom-1.5 left-0 w-0.5 rounded-full bg-sidebar-primary"
				/>
			) : null}
			{dropZone === 'before' || dropZone === 'after' ? (
				<span
					aria-hidden
					className={cn(
						'pointer-events-none absolute right-1 left-2 z-10 h-0.5 rounded-full bg-sidebar-primary',
						dropZone === 'before' ? '-top-px' : '-bottom-px'
					)}
				/>
			) : null}
		</div>
	)
}
