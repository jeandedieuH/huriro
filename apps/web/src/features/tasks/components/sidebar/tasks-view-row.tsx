import type { SavedViewDto } from '@huriro/contracts'
import { t } from '@huriro/i18n'
import { useSyncEngine } from '@huriro/sync-client'
import { Bookmark, Columns3, Copy, Globe, ListChecks } from 'lucide-react'
import { SidebarActionRow, SidebarMenuAction } from '@/components/app-shell/sidebar/sidebar-action-row'
import { DropdownMenuSeparator } from '@/components/ui/dropdown-menu'
import { useUiStore } from '@/stores/ui-store'

export interface TasksViewRowProps {
	readonly view: SavedViewDto
	readonly active: boolean
	readonly collapsed: boolean
	readonly onSelect: (view: SavedViewDto, layoutOverride?: 'list' | 'board') => void
}

const MENU_ICON_CLASS = 'size-4 shrink-0 text-muted-foreground'

/** Saved view row with layout switcher (list/board) and duplicate action. */
export function TasksViewRow({ view, active, collapsed, onSelect }: TasksViewRowProps) {
	const engine = useSyncEngine()
	const pushToast = useUiStore((s) => s.pushToast)

	async function handleDuplicate() {
		try {
			await engine.createSavedView({
				name: t('tasks.sidebar.view-duplicate-name', { name: view.name }).slice(0, 100),
				projectId: view.projectId,
				layout: view.layout,
				filters: view.filters ?? {},
				filterExpr: view.filterExpr ?? null,
				displayOptions: view.displayOptions ?? {},
				sort: view.sort ?? {},
				isShared: view.isShared
			})
			pushToast({ tone: 'success', title: t('tasks.sidebar.view-duplicated-toast') })
		} catch (err) {
			pushToast({
				tone: 'danger',
				title: t('shell.sidebar.action-failed'),
				description: err instanceof Error ? err.message : undefined
			})
		}
	}

	return (
		<SidebarActionRow
			icon={<Bookmark className="size-4" />}
			label={view.name}
			active={active}
			isCurrentPage={active}
			collapsed={collapsed}
			trailingIcon={
				view.isShared ? <Globe className="size-3 text-sidebar-muted-foreground/80" aria-hidden /> : undefined
			}
			menuAriaLabel={t('tasks.sidebar.view-actions')}
			onClick={() => onSelect(view)}
			menuContent={
				<>
					<SidebarMenuAction
						icon={<ListChecks className={MENU_ICON_CLASS} aria-hidden />}
						label={t('tasks.sidebar.view-open-list')}
						onSelect={() => onSelect(view, 'list')}
					/>
					<SidebarMenuAction
						icon={<Columns3 className={MENU_ICON_CLASS} aria-hidden />}
						label={t('tasks.sidebar.view-open-board')}
						onSelect={() => onSelect(view, 'board')}
					/>
					<DropdownMenuSeparator className="my-1.5" />
					<SidebarMenuAction
						icon={<Copy className={MENU_ICON_CLASS} aria-hidden />}
						label={t('tasks.sidebar.view-duplicate')}
						onSelect={() => void handleDuplicate()}
					/>
				</>
			}
		/>
	)
}
