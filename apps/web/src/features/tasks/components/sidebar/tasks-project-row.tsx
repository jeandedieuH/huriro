import type { ProjectDto } from '@huriro/contracts'
import { t } from '@huriro/i18n'
import { useSyncEngine } from '@huriro/sync-client'
import { Archive, Copy, Globe, Inbox, Lock, Pencil, Plus, Settings2 } from 'lucide-react'
import { useRef, useState } from 'react'
import { SidebarActionRow, SidebarMenuAction } from '@/components/app-shell/sidebar/sidebar-action-row'
import { SidebarInlineRename } from '@/components/app-shell/sidebar/sidebar-inline-rename'
import { SidebarProjectDot } from '@/components/app-shell/sidebar/sidebar-primitives'
import { DropdownMenuSeparator } from '@/components/ui/dropdown-menu'
import { Tooltip, TooltipContent, TooltipTrigger } from '@/components/ui/tooltip'
import { useUiStore } from '@/stores/ui-store'

export interface TasksProjectRowProps {
	readonly project: ProjectDto
	readonly index: number
	readonly active: boolean
	readonly openCount: number
	readonly collapsed: boolean
	readonly onSelect: () => void
}

const MENU_ICON_CLASS = 'size-4 shrink-0 text-muted-foreground'

/** Project row with hover quick-create, inline rename (F2), visibility/triage toggles, and undoable archive. */
export function TasksProjectRow({
	project,
	index,
	active,
	openCount,
	collapsed,
	onSelect
}: TasksProjectRowProps) {
	const engine = useSyncEngine()
	const setActiveProjectId = useUiStore((s) => s.setActiveProjectId)
	const setTasksPreset = useUiStore((s) => s.setTasksPreset)
	const setCreateIssueOpen = useUiStore((s) => s.setCreateIssueOpen)
	const setProjectSettingsOpen = useUiStore((s) => s.setProjectSettingsOpen)
	const pushToast = useUiStore((s) => s.pushToast)

	const [renaming, setRenaming] = useState(false)
	const skipRestoreFocusRef = useRef(false)

	async function guarded(action: () => Promise<void>) {
		try {
			await action()
		} catch (err) {
			pushToast({
				tone: 'danger',
				title: t('shell.sidebar.action-failed'),
				description: err instanceof Error ? err.message : undefined
			})
		}
	}

	function handleNewTask() {
		setTasksPreset('all')
		setActiveProjectId(project.id)
		setCreateIssueOpen(true)
	}

	function handleOpenSettings() {
		setTasksPreset('all')
		setActiveProjectId(project.id)
		setProjectSettingsOpen(true)
	}

	function handleRenameCommit(nextName: string) {
		setRenaming(false)
		const clean = nextName.trim().slice(0, 120)
		if (!clean || clean === project.name) return
		void guarded(() => engine.updateProject(project.id, { name: clean }))
	}

	function handleCopyKey() {
		void guarded(async () => {
			if (typeof navigator === 'undefined' || !navigator.clipboard) {
				throw new Error('Clipboard is unavailable in this context')
			}
			await navigator.clipboard.writeText(project.key)
			pushToast({ tone: 'success', title: t('tasks.sidebar.project-key-copied', { key: project.key }) })
		})
	}

	function handleArchive() {
		void guarded(async () => {
			await engine.updateProject(project.id, { archived: true })
			if (active) setActiveProjectId(null)
			pushToast({
				tone: 'success',
				title: t('tasks.sidebar.project-archived-toast', { name: project.name }),
				actionLabel: t('common.undo'),
				onAction: () => {
					void guarded(() => engine.updateProject(project.id, { archived: false }))
				}
			})
		})
	}

	if (renaming && !collapsed) {
		return (
			<div className="flex items-center gap-1.5 rounded-lg px-1.5 py-0.5">
				<span aria-hidden className="flex size-5 shrink-0 items-center justify-center">
					<SidebarProjectDot index={index} active={active} />
				</span>
				<SidebarInlineRename
					initialValue={project.name}
					ariaLabel={t('tasks.sidebar.project-rename-label')}
					maxLength={120}
					onCommit={handleRenameCommit}
					onCancel={() => setRenaming(false)}
				/>
			</div>
		)
	}

	return (
		<SidebarActionRow
			icon={<SidebarProjectDot index={index} active={active} />}
			label={project.name}
			sublabel={project.key}
			active={active}
			isCurrentPage={active}
			collapsed={collapsed}
			badgeCount={openCount}
			badgeTone="muted"
			trailingIcon={
				project.visibility === 'private' ? (
					<Lock className="size-3 text-sidebar-muted-foreground/80" aria-hidden />
				) : undefined
			}
			skipRestoreFocusRef={skipRestoreFocusRef}
			menuAriaLabel={t('tasks.sidebar.project-actions')}
			onClick={onSelect}
			onKeyDown={(ev) => {
				if (ev.key === 'F2') {
					ev.preventDefault()
					setRenaming(true)
				}
			}}
			quickAction={
				<Tooltip>
					<TooltipTrigger asChild>
						<button
							type="button"
							aria-label={t('tasks.sidebar.new-task-in', { name: project.name })}
							onClick={(ev) => {
								ev.stopPropagation()
								handleNewTask()
							}}
							className="flex size-6 items-center justify-center rounded-md text-sidebar-muted-foreground outline-none transition-colors hover:bg-sidebar-border/60 hover:text-sidebar-foreground focus-visible:ring-2 focus-visible:ring-sidebar-primary/60"
						>
							<Plus className="size-3.5" aria-hidden />
						</button>
					</TooltipTrigger>
					<TooltipContent side="top">{t('tasks.new-issue')}</TooltipContent>
				</Tooltip>
			}
			menuContent={
				<>
					<SidebarMenuAction
						icon={<Plus className={MENU_ICON_CLASS} aria-hidden />}
						label={t('tasks.new-issue')}
						onSelect={handleNewTask}
					/>
					<SidebarMenuAction
						icon={<Pencil className={MENU_ICON_CLASS} aria-hidden />}
						label={t('tasks.sidebar.project-rename')}
						hint="F2"
						onSelect={() => {
							skipRestoreFocusRef.current = true
							setRenaming(true)
						}}
					/>
					<SidebarMenuAction
						icon={<Settings2 className={MENU_ICON_CLASS} aria-hidden />}
						label={t('tasks.sidebar.project-settings')}
						onSelect={handleOpenSettings}
					/>

					<DropdownMenuSeparator className="my-1.5" />

					<SidebarMenuAction
						icon={
							project.visibility === 'private' ? (
								<Globe className={MENU_ICON_CLASS} aria-hidden />
							) : (
								<Lock className={MENU_ICON_CLASS} aria-hidden />
							)
						}
						label={
							project.visibility === 'private'
								? t('tasks.sidebar.project-make-workspace')
								: t('tasks.sidebar.project-make-private')
						}
						onSelect={() =>
							void guarded(() =>
								engine.updateProject(project.id, {
									visibility: project.visibility === 'private' ? 'workspace' : 'private'
								})
							)
						}
					/>
					<SidebarMenuAction
						icon={<Inbox className={MENU_ICON_CLASS} aria-hidden />}
						label={
							project.triageEnabled
								? t('tasks.sidebar.project-disable-triage')
								: t('tasks.sidebar.project-enable-triage')
						}
						onSelect={() =>
							void guarded(() => engine.updateProject(project.id, { triageEnabled: !project.triageEnabled }))
						}
					/>
					<SidebarMenuAction
						icon={<Copy className={MENU_ICON_CLASS} aria-hidden />}
						label={t('tasks.sidebar.project-copy-key')}
						onSelect={handleCopyKey}
					/>

					<DropdownMenuSeparator className="my-1.5" />

					<SidebarMenuAction
						tone="danger"
						icon={<Archive className="size-4 shrink-0" aria-hidden />}
						label={t('tasks.sidebar.project-archive')}
						onSelect={handleArchive}
					/>
				</>
			}
		/>
	)
}
