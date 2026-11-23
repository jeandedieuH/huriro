import type { SavedViewDto } from '@huriro/contracts'
import { t } from '@huriro/i18n'
import { useCollectionItems, useSyncEngine } from '@huriro/sync-client'
import {
	AlertTriangle,
	Bookmark,
	CalendarDays,
	CalendarRange,
	Clock,
	FolderKanban,
	Layers,
	ListChecks,
	ListTodo,
	Lock,
	Plus,
	Trash2
} from 'lucide-react'
import { useState } from 'react'
import {
	SidebarNavItem,
	SidebarProjectDot,
	SidebarSection,
	useSidebarCollapsed
} from '@/components/app-shell/sidebar/sidebar-primitives'
import { cn } from '@/lib/utils'
import { type TasksPreset, useUiStore } from '@/stores/ui-store'

export interface TasksSidebarNavProps {
	readonly collapsed?: boolean | undefined
}

const MY_WORK_PRESETS: readonly {
	readonly id: Exclude<TasksPreset, 'all' | 'trash'>
	readonly labelId:
		| 'tasks.sidebar.my-tasks'
		| 'tasks.sidebar.this-week'
		| 'tasks.sidebar.my-week'
		| 'tasks.sidebar.overdue'
		| 'tasks.sidebar.due-soon'
	readonly icon: typeof ListTodo
}[] = [
	{ id: 'my-tasks', labelId: 'tasks.sidebar.my-tasks', icon: ListTodo },
	{ id: 'this-week', labelId: 'tasks.sidebar.this-week', icon: CalendarDays },
	{ id: 'my-week', labelId: 'tasks.sidebar.my-week', icon: CalendarRange },
	{ id: 'overdue', labelId: 'tasks.sidebar.overdue', icon: AlertTriangle },
	{ id: 'due-soon', labelId: 'tasks.sidebar.due-soon', icon: Clock }
]

export function TasksSidebarNav({ collapsed }: TasksSidebarNavProps) {
	const ctxCollapsed = useSidebarCollapsed()
	const isCollapsed = collapsed ?? ctxCollapsed
	const engine = useSyncEngine()
	const projects = useCollectionItems(engine.collections.projects)
	const savedViews = useCollectionItems(engine.collections.savedViews)

	const activeProjectId = useUiStore((s) => s.activeProjectId)
	const tasksPreset = useUiStore((s) => s.tasksPreset)
	const activeViewId = useUiStore((s) => s.filters.activeViewId)
	const setActiveProjectId = useUiStore((s) => s.setActiveProjectId)
	const setTasksPreset = useUiStore((s) => s.setTasksPreset)
	const setTasksLayout = useUiStore((s) => s.setTasksLayout)
	const setFilterPatch = useUiStore((s) => s.setFilterPatch)
	const setCreateProjectOpen = useUiStore((s) => s.setCreateProjectOpen)
	const resetFilters = useUiStore((s) => s.resetFilters)

	const [viewsExpanded, setViewsExpanded] = useState(true)

	function handleSelectView(view: SavedViewDto) {
		setTasksPreset('all')
		setActiveProjectId(view.projectId)
		setTasksLayout(view.layout)
		const priorityRaw = view.filters.priorities?.[0]
		const statusRaw = view.filters.statusIds?.[0]
		setFilterPatch({
			activeViewId: view.id,
			priority: typeof priorityRaw === 'number' ? priorityRaw : 'all',
			statusId: typeof statusRaw === 'string' ? statusRaw : 'all',
			assigneeId: view.filters.mine ? 'me' : (view.filters.assigneeIds?.[0] ?? 'all'),
			query: view.filters.search ?? ''
		})
	}

	return (
		<nav aria-label={t('tasks.title')} className="space-y-0.5">
			<SidebarNavItem
				icon={<ListChecks className="size-4" />}
				label={t('tasks.all-issues')}
				active={tasksPreset === 'all' && activeViewId === null}
				collapsed={isCollapsed}
				onClick={() => {
					setTasksPreset('all')
					resetFilters()
				}}
			/>

			<SidebarNavItem
				icon={<Layers className="size-4" />}
				label={t('tasks.sidebar.views')}
				active={activeViewId !== null}
				collapsed={isCollapsed}
				onClick={() => setViewsExpanded((prev) => !prev)}
			/>

			{!isCollapsed && viewsExpanded && savedViews.length > 0 ? (
				<div className="space-y-0.5 pl-3 pt-0.5">
					{savedViews.map((view) => {
						const isSelected = activeViewId === view.id
						return (
							<button
								key={view.id}
								type="button"
								onClick={() => handleSelectView(view)}
								className={cn(
									'flex w-full items-center gap-2 rounded-lg px-2.5 py-1.5 text-left text-xs transition-colors',
									isSelected
										? 'bg-sidebar-accent font-medium text-sidebar-accent-foreground'
										: 'text-sidebar-muted-foreground hover:bg-sidebar-accent/60 hover:text-sidebar-foreground'
								)}
							>
								<Bookmark className="size-3.5 shrink-0" aria-hidden />
								<span className="truncate">{view.name}</span>
							</button>
						)
					})}
				</div>
			) : null}

			<SidebarSection title={t('tasks.sidebar.my-work')} collapsed={isCollapsed}>
				{MY_WORK_PRESETS.map((preset) => {
					const Icon = preset.icon
					return (
						<SidebarNavItem
							key={preset.id}
							icon={<Icon className="size-4" />}
							label={t(preset.labelId)}
							active={tasksPreset === preset.id && activeViewId === null}
							collapsed={isCollapsed}
							onClick={() => {
								setTasksPreset(preset.id)
								resetFilters()
							}}
						/>
					)
				})}
			</SidebarSection>

			<SidebarSection title={t('tasks.projects')} collapsed={isCollapsed}>
				<SidebarNavItem
					icon={<FolderKanban className="size-4" />}
					label={t('tasks.sidebar.all-projects')}
					active={activeProjectId === null}
					collapsed={isCollapsed}
					onClick={() => {
						setActiveProjectId(null)
						resetFilters()
					}}
				/>

				{projects.map((project, idx) => {
					const isSelected = activeProjectId === project.id
					return (
						<SidebarNavItem
							key={project.id}
							icon={<SidebarProjectDot index={idx} active={isSelected} />}
							label={project.name}
							active={isSelected}
							collapsed={isCollapsed}
							trailingIcon={
								project.visibility === 'private' ? (
									<Lock className="size-3 text-sidebar-muted-foreground" aria-hidden />
								) : undefined
							}
							onClick={() => {
								setActiveProjectId(project.id)
								resetFilters()
							}}
						/>
					)
				})}

				<SidebarNavItem
					icon={<Plus className="size-4" />}
					label={t('tasks.new-project')}
					collapsed={isCollapsed}
					onClick={() => setCreateProjectOpen(true)}
				/>
			</SidebarSection>
		</nav>
	)
}

export function TasksSidebarFooterUtility({ collapsed }: { readonly collapsed?: boolean | undefined }) {
	const ctxCollapsed = useSidebarCollapsed()
	const isCollapsed = collapsed ?? ctxCollapsed
	const tasksPreset = useUiStore((s) => s.tasksPreset)
	const activeViewId = useUiStore((s) => s.filters.activeViewId)
	const setTasksPreset = useUiStore((s) => s.setTasksPreset)
	const resetFilters = useUiStore((s) => s.resetFilters)

	return (
		<SidebarNavItem
			icon={<Trash2 className="size-4" />}
			label={t('tasks.sidebar.trash')}
			active={tasksPreset === 'trash' && activeViewId === null}
			collapsed={isCollapsed}
			onClick={() => {
				setTasksPreset('trash')
				resetFilters()
			}}
		/>
	)
}
