import type { DocPageDto } from '@huriro/contracts'
import { t } from '@huriro/i18n'
import {
	Copy,
	Download,
	ExternalLink,
	FilePlus2,
	FolderInput,
	Globe,
	Link2,
	Lock,
	MoreHorizontal,
	Pencil,
	Share2,
	SmilePlus,
	Star,
	StarOff,
	Trash2,
	Unlock
} from 'lucide-react'
import { type ReactNode, useRef } from 'react'
import {
	DropdownMenu,
	DropdownMenuContent,
	DropdownMenuItem,
	DropdownMenuSeparator,
	DropdownMenuTrigger
} from '@/components/ui/dropdown-menu'
import { Tooltip, TooltipContent, TooltipTrigger } from '@/components/ui/tooltip'
import type { DocsSidebarActions } from './use-docs-sidebar-actions'

export interface DocsSidebarRowMenuProps {
	readonly page: DocPageDto
	readonly actions: DocsSidebarActions
	readonly open: boolean
	readonly onOpenChange: (open: boolean) => void
	readonly onRename: () => void
	readonly onChangeIcon: () => void
	readonly onMove: () => void
}

const MENU_ITEM_CLASS = 'gap-2.5 rounded-lg px-2.5 py-1.5 text-[13px]'
const MENU_ICON_CLASS = 'size-4 shrink-0 text-muted-foreground'

/** Full per-page action menu — the single place every page operation is reachable from. */
export function DocsSidebarRowMenu({
	page,
	actions,
	open,
	onOpenChange,
	onRename,
	onChangeIcon,
	onMove
}: DocsSidebarRowMenuProps) {
	// Radix returns focus to the trigger on close; skip that when the choice moves focus elsewhere (inline rename).
	const skipRestoreFocusRef = useRef(false)
	const isLocked = page.isLocked

	return (
		<DropdownMenu open={open} onOpenChange={onOpenChange}>
			<Tooltip>
				<TooltipTrigger asChild>
					<DropdownMenuTrigger asChild>
						<button
							type="button"
							aria-label={t('docs.sidebar.page-actions', { title: page.title })}
							className="flex size-6 items-center justify-center rounded-md text-sidebar-muted-foreground outline-none transition-colors hover:bg-sidebar-border/60 hover:text-sidebar-foreground focus-visible:ring-2 focus-visible:ring-sidebar-primary/60 data-[state=open]:bg-sidebar-border/60 data-[state=open]:text-sidebar-foreground"
						>
							<MoreHorizontal className="size-4" aria-hidden />
						</button>
					</DropdownMenuTrigger>
				</TooltipTrigger>
				<TooltipContent side="top">{t('docs.sidebar.more-actions')}</TooltipContent>
			</Tooltip>

			<DropdownMenuContent
				align="start"
				side="right"
				className="w-56 rounded-xl border-border/80 bg-popover/98 p-1.5 shadow-(--shadow-3) backdrop-blur-md"
				onCloseAutoFocus={(ev) => {
					if (!skipRestoreFocusRef.current) return
					ev.preventDefault()
					skipRestoreFocusRef.current = false
				}}
			>
				{/* Group 1: Create & Edit */}
				<MenuAction
					icon={<FilePlus2 className={MENU_ICON_CLASS} aria-hidden />}
					label={t('docs.sidebar.add-subpage')}
					onSelect={() => void actions.createPage({ parentId: page.id })}
				/>
				<MenuAction
					icon={<Pencil className={MENU_ICON_CLASS} aria-hidden />}
					label={t('docs.sidebar.rename')}
					hint="F2"
					disabled={isLocked}
					onSelect={() => {
						skipRestoreFocusRef.current = true
						onRename()
					}}
				/>
				<MenuAction
					icon={<SmilePlus className={MENU_ICON_CLASS} aria-hidden />}
					label={t('docs.sidebar.change-icon')}
					disabled={isLocked}
					onSelect={onChangeIcon}
				/>

				<DropdownMenuSeparator className="my-1.5" />

				{/* Group 2: Organize & Navigate */}
				{actions.hasApi ? (
					<MenuAction
						icon={
							page.isFavorite ? (
								<StarOff className={MENU_ICON_CLASS} aria-hidden />
							) : (
								<Star className={MENU_ICON_CLASS} aria-hidden />
							)
						}
						label={page.isFavorite ? t('docs.sidebar.unfavorite') : t('docs.sidebar.favorite')}
						onSelect={() => void actions.toggleFavorite(page)}
					/>
				) : null}
				{actions.hasApi ? (
					<MenuAction
						icon={<Copy className={MENU_ICON_CLASS} aria-hidden />}
						label={t('docs.sidebar.duplicate')}
						onSelect={() => void actions.duplicatePage(page)}
					/>
				) : null}
				<MenuAction
					icon={<Link2 className={MENU_ICON_CLASS} aria-hidden />}
					label={t('docs.sidebar.copy-link')}
					onSelect={() => void actions.copyPageLink(page)}
				/>
				<MenuAction
					icon={<ExternalLink className={MENU_ICON_CLASS} aria-hidden />}
					label={t('docs.sidebar.open-new-tab')}
					onSelect={() => actions.openInNewTab(page)}
				/>
				<MenuAction
					icon={<FolderInput className={MENU_ICON_CLASS} aria-hidden />}
					label={t('docs.sidebar.move-to')}
					disabled={isLocked}
					onSelect={onMove}
				/>

				{/* Group 3: Share & Export */}
				{actions.hasApi ? (
					<>
						<DropdownMenuSeparator className="my-1.5" />
						<MenuAction
							icon={<Share2 className={MENU_ICON_CLASS} aria-hidden />}
							label={t('docs.share.title')}
							onSelect={() => actions.openShare(page)}
						/>
						<MenuAction
							icon={<Globe className={MENU_ICON_CLASS} aria-hidden />}
							label={t('docs.publish.button')}
							onSelect={() => actions.openPublish(page)}
						/>
						<MenuAction
							icon={<Download className={MENU_ICON_CLASS} aria-hidden />}
							label={t('docs.sidebar.export-markdown')}
							onSelect={() => void actions.exportMarkdown(page)}
						/>
					</>
				) : null}

				<DropdownMenuSeparator className="my-1.5" />

				{/* Group 4: Protection & Danger */}
				<MenuAction
					icon={
						isLocked ? (
							<Unlock className={MENU_ICON_CLASS} aria-hidden />
						) : (
							<Lock className={MENU_ICON_CLASS} aria-hidden />
						)
					}
					label={isLocked ? t('docs.lock.unlock-page') : t('docs.lock.lock-page')}
					onSelect={() => void actions.toggleLock(page)}
				/>
				<MenuAction
					tone="danger"
					icon={<Trash2 className="size-4 shrink-0" aria-hidden />}
					label={t('docs.sidebar.archive')}
					disabled={isLocked}
					onSelect={() => void actions.archivePage(page)}
				/>
			</DropdownMenuContent>
		</DropdownMenu>
	)
}

interface MenuActionProps {
	readonly icon: ReactNode
	readonly label: string
	readonly hint?: string | undefined
	readonly disabled?: boolean | undefined
	readonly tone?: 'default' | 'danger' | undefined
	readonly onSelect: () => void
}

function MenuAction({ icon, label, hint, disabled, tone = 'default', onSelect }: MenuActionProps) {
	return (
		<DropdownMenuItem
			disabled={disabled}
			onSelect={onSelect}
			className={
				tone === 'danger'
					? `${MENU_ITEM_CLASS} text-destructive focus:bg-destructive/10 focus:text-destructive`
					: MENU_ITEM_CLASS
			}
		>
			{icon}
			<span className="flex-1 truncate">{label}</span>
			{hint ? <span className="font-mono text-[11px] text-muted-foreground">{hint}</span> : null}
		</DropdownMenuItem>
	)
}
