import type { SavedViewDto } from '@huriro/contracts'
import { t } from '@huriro/i18n'
import { useCollectionItems, useSyncEngine } from '@huriro/sync-client'
import {
	AlertTriangle,
	CalendarDays,
	CalendarRange,
	Clock,
	FolderKanban,
	Inbox,
	ListChecks,
	ListTodo,
	Plus,
	Trash2
} from 'lucide-react'
import { useMemo, useState } from 'react'
import { SidebarActionRow } from '@/components/app-shell/sidebar/sidebar-action-row'
import { SidebarCollapsibleSection } from '@/components/app-shell/sidebar/sidebar-collapsible-section'
import { SidebarFilterInput } from '@/components/app-shell/sidebar/sidebar-filter-input'
import { useSidebarCollapsed } from '@/components/app-shell/sidebar/sidebar-primitives'
import { Button } from '@/components/ui/button'
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from '@/components/ui/tooltip'
import { useOptionalWorkspace } from '@/lib/workspace'
import { type TasksDisplayOptions, type TasksPreset, useUiStore } from '@/stores/ui-store'
import { TasksProjectRow } from './sidebar/tasks-project-row'
import { TasksViewRow } from './sidebar/tasks-view-row'

function coerceGroupBy(value: string | undefined): TasksDisplayOptions['groupBy'] {
	switch (value) {
		case 'status_category':
		case 'priority':
		case 'assignee_id':
		case 'project_id':
		case 'cycle_id':
		case 'due_date':
			return value
		default:
			return 'none'
	}
}

function coerceSubGroupBy(value: string | null | undefined): TasksDisplayOptions['subGroupBy'] {
	return value === 'priority' || value === 'assignee_id' ? value : 'none'
}

function coerceSortBy(value: string | undefined): TasksDisplayOptions['sortBy'] {
	switch (value) {
		case 'priority':
		case 'due_date':
		case 'updated_at':
		case 'created_at':
		case 'estimate':
			return value
		default:
			return 'manual'
	}
}

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
		| 'tasks.triage.title'
	readonly icon: typeof ListTodo
}[] = [
	{ id: 'triage', labelId: 'tasks.triage.title', icon: Inbox },
	{ id: 'my-tasks', labelId: 'tasks.sidebar.my-tasks', icon: ListTodo },
	{ id: 'this-week', labelId: 'tasks.sidebar.this-week', icon: CalendarDays },
	{ id: 'my-week', labelId: 'tasks.sidebar.my-week', icon: CalendarRange },
	{ id: 'overdue', labelId: 'tasks.sidebar.overdue', icon: AlertTriangle },
	{ id: 'due-soon', labelId: 'tasks.sidebar.due-soon', icon: Clock }
]

export function TasksSidebarNav({ collapsed }: TasksSidebarNavProps) {
	const ctxCollapsed = useSidebarCollapsed()
	const isCollapsed = collapsed ?? ctxCollapsed
	const workspace = useOptionalWorkspace()
	const currentUserId = workspace?.currentUserId ?? null
	const engine = useSyncEngine()
	const projects = useCollectionItems(engine.collections.projects)
	const statuses = useCollectionItems(engine.collections.projectStatuses)
	const issues = useCollectionItems(engine.collections.issues)
	const savedViews = useCollectionItems(engine.collections.savedViews)

	const activeProjectId = useUiStore((s) => s.activeProjectId)
	const tasksPreset = useUiStore((s) => s.tasksPreset)
	const activeViewId = useUiStore((s) => s.filters.activeViewId)
	const setActiveProjectId = useUiStore((s) => s.setActiveProjectId)
	const setTasksPreset = useUiStore((s) => s.setTasksPreset)
	const setTasksLayout = useUiStore((s) => s.setTasksLayout)
	const setFilterPatch = useUiStore((s) => s.setFilterPatch)
	const setFilterExpr = useUiStore((s) => s.setFilterExpr)
	const setTasksDisplay = useUiStore((s) => s.setTasksDisplay)
	const setCreateProjectOpen = useUiStore((s) => s.setCreateProjectOpen)
	const resetFilters = useUiStore((s) => s.resetFilters)

	const [filter, setFilter] = useState('')
	const needle = filter.trim().toLowerCase()

	const activeProjects = useMemo(() => projects.filter((p) => p.archivedAt === null), [projects])
	const statusesById = useMemo(() => new Map(statuses.map((s) => [s.id, s])), [statuses])

	// Triage nav gating (§3.1): hidden until at least one project collects inbound requests.
	const triageProjectIds = useMemo(
		() => new Set(activeProjects.filter((p) => p.triageEnabled).map((p) => p.id)),
		[activeProjects]
	)
	const hasTriageProject = triageProjectIds.size > 0

	const { totalOpenCount, triagePendingCount, myTasksCount, overdueCount, openCountByProject } =
		useMemo(() => {
			const todayStart = new Date()
			todayStart.setHours(0, 0, 0, 0)
			const startOfTodayMs = todayStart.getTime()

			let totalOpen = 0
			let triagePending = 0
			let myTasks = 0
			let overdue = 0
			const byProject = new Map<string, number>()

			for (const issue of issues) {
				if (issue.deletedAt !== null) continue
				if (issue.triageStatus === 'pending' && triageProjectIds.has(issue.projectId)) {
					triagePending += 1
				}
				if (issue.triageStatus === 'pending' || issue.triageStatus === 'snoozed') continue
				if (issue.closedAt !== null) continue
				const category = statusesById.get(issue.statusId)?.category
				if (category === 'completed' || category === 'canceled') continue

				totalOpen += 1
				byProject.set(issue.projectId, (byProject.get(issue.projectId) ?? 0) + 1)
				if (currentUserId && issue.assigneeId === currentUserId) myTasks += 1
				if (issue.dueDate) {
					const dueMs = Date.parse(issue.dueDate)
					if (!Number.isNaN(dueMs) && dueMs < startOfTodayMs) overdue += 1
				}
			}

			return {
				totalOpenCount: totalOpen,
				triagePendingCount: triagePending,
				myTasksCount: myTasks,
				overdueCount: overdue,
				openCountByProject: byProject
			}
		}, [currentUserId, issues, statusesById, triageProjectIds])

	const filteredProjects = useMemo(() => {
		if (!needle) return activeProjects
		return activeProjects.filter(
			(p) => p.name.toLowerCase().includes(needle) || p.key.toLowerCase().includes(needle)
		)
	}, [activeProjects, needle])

	const filteredViews = useMemo(() => {
		if (!needle) return savedViews
		return savedViews.filter((v) => v.name.toLowerCase().includes(needle))
	}, [needle, savedViews])

	function handleSelectView(view: SavedViewDto, layoutOverride?: 'list' | 'board') {
		setTasksPreset('all')
		setActiveProjectId(view.projectId)
		setTasksLayout(layoutOverride ?? (view.layout === 'board' ? 'board' : 'list'))
		// Compound expr restores first — the setter clears activeViewId as a side
		// effect, and the flat-filter patch below re-establishes it.
		setFilterExpr(view.filterExpr ?? null)
		const opts = view.displayOptions ?? {}
		setTasksDisplay({
			groupBy: coerceGroupBy(opts.groupBy),
			subGroupBy: coerceSubGroupBy(opts.subGroupBy),
			sortBy: coerceSortBy(opts.sortBy),
			sortDirection: opts.sortDirection === 'desc' ? 'desc' : 'asc',
			showSubIssues: opts.showSubIssues ?? true
		})
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

	const showFilter = !isCollapsed && (activeProjects.length > 0 || savedViews.length > 0)
	const emptyFilter = needle.length > 0 && filteredProjects.length === 0 && filteredViews.length === 0

	return (
		<TooltipProvider delayDuration={300}>
			<nav data-feature-sidebar aria-label={t('tasks.title')} className="space-y-0.5">
				{showFilter ? (
					<SidebarFilterInput
						value={filter}
						onChange={setFilter}
						placeholder={t('tasks.sidebar.filter-placeholder')}
						ariaLabel={t('tasks.sidebar.filter-label')}
						clearLabel={t('shell.sidebar.filter-clear')}
					/>
				) : null}

				{emptyFilter ? (
					<div className="space-y-2 px-2 py-4 text-center">
						<p className="text-xs text-sidebar-muted-foreground">
							{t('shell.sidebar.filter-empty', { query: filter.trim() })}
						</p>
						<button
							type="button"
							onClick={() => setFilter('')}
							className="text-xs font-medium text-sidebar-primary underline-offset-4 hover:underline"
						>
							{t('shell.sidebar.filter-clear')}
						</button>
					</div>
				) : (
					<>
						{!needle ? (
							<>
								<SidebarActionRow
									icon={<ListChecks className="size-4" />}
									label={t('tasks.all-issues')}
									active={tasksPreset === 'all' && activeViewId === null}
									isCurrentPage={tasksPreset === 'all' && activeViewId === null}
									badgeCount={totalOpenCount}
									badgeTone="muted"
									collapsed={isCollapsed}
									onClick={() => {
										setTasksPreset('all')
										resetFilters()
									}}
								/>

								<SidebarCollapsibleSection title={t('tasks.sidebar.my-work')} railCollapsed={isCollapsed}>
									{MY_WORK_PRESETS.filter((preset) => preset.id !== 'triage' || hasTriageProject).map(
										(preset) => {
											const Icon = preset.icon
											const count =
												preset.id === 'triage'
													? triagePendingCount
													: preset.id === 'my-tasks'
														? myTasksCount
														: preset.id === 'overdue'
															? overdueCount
															: 0
											const badgeTone =
												preset.id === 'triage' ? 'primary' : preset.id === 'overdue' ? 'danger' : 'muted'
											return (
												<SidebarActionRow
													key={preset.id}
													icon={<Icon className="size-4" />}
													label={t(preset.labelId)}
													active={tasksPreset === preset.id && activeViewId === null}
													isCurrentPage={tasksPreset === preset.id && activeViewId === null}
													badgeCount={count}
													badgeTone={badgeTone}
													collapsed={isCollapsed}
													onClick={() => {
														setTasksPreset(preset.id)
														resetFilters()
													}}
												/>
											)
										}
									)}
								</SidebarCollapsibleSection>
							</>
						) : null}

						{filteredViews.length > 0 ? (
							<SidebarCollapsibleSection
								title={t('tasks.sidebar.views')}
								count={filteredViews.length}
								railCollapsed={isCollapsed}
							>
								{filteredViews.map((view) => (
									<TasksViewRow
										key={view.id}
										view={view}
										active={activeViewId === view.id}
										collapsed={isCollapsed}
										onSelect={handleSelectView}
									/>
								))}
							</SidebarCollapsibleSection>
						) : null}

						<SidebarCollapsibleSection
							title={t('tasks.projects')}
							count={filteredProjects.length}
							railCollapsed={isCollapsed}
							action={
								!isCollapsed ? (
									<Tooltip>
										<TooltipTrigger asChild>
											<button
												type="button"
												aria-label={t('tasks.new-project')}
												onClick={() => setCreateProjectOpen(true)}
												className="flex size-5 items-center justify-center rounded-md text-sidebar-muted-foreground/80 outline-none transition-colors hover:bg-sidebar-accent hover:text-sidebar-foreground focus-visible:ring-2 focus-visible:ring-sidebar-primary/60"
											>
												<Plus className="size-3.5" aria-hidden />
											</button>
										</TooltipTrigger>
										<TooltipContent side="top">{t('tasks.new-project')}</TooltipContent>
									</Tooltip>
								) : null
							}
						>
							{!needle ? (
								<SidebarActionRow
									icon={<FolderKanban className="size-4" />}
									label={t('tasks.sidebar.all-projects')}
									active={activeProjectId === null}
									collapsed={isCollapsed}
									onClick={() => {
										setActiveProjectId(null)
										resetFilters()
									}}
								/>
							) : null}

							{filteredProjects.length === 0 && !needle && !isCollapsed ? (
								<div className="space-y-1.5 px-2 py-2">
									<p className="text-xs text-sidebar-muted-foreground">{t('tasks.sidebar.project-empty')}</p>
									<Button
										type="button"
										size="sm"
										tone="outline"
										className="h-7 gap-1 px-2 text-xs"
										onClick={() => setCreateProjectOpen(true)}
									>
										<Plus className="size-3" aria-hidden />
										{t('tasks.new-project')}
									</Button>
								</div>
							) : (
								filteredProjects.map((project, idx) => (
									<TasksProjectRow
										key={project.id}
										project={project}
										index={idx}
										active={activeProjectId === project.id}
										openCount={openCountByProject.get(project.id) ?? 0}
										collapsed={isCollapsed}
										onSelect={() => {
											setActiveProjectId(project.id)
											resetFilters()
										}}
									/>
								))
							)}
						</SidebarCollapsibleSection>
					</>
				)}
			</nav>
		</TooltipProvider>
	)
}

export function TasksSidebarHeaderAction() {
	const setCreateIssueOpen = useUiStore((s) => s.setCreateIssueOpen)
	return (
		<Tooltip>
			<TooltipTrigger asChild>
				<button
					type="button"
					aria-label={t('tasks.new-issue')}
					onClick={() => setCreateIssueOpen(true)}
					className="flex size-7 items-center justify-center rounded-lg text-sidebar-muted-foreground transition-colors hover:bg-sidebar-accent hover:text-sidebar-foreground"
				>
					<Plus className="size-4" aria-hidden />
				</button>
			</TooltipTrigger>
			<TooltipContent side="bottom">{t('tasks.new-issue')}</TooltipContent>
		</Tooltip>
	)
}

export function TasksSidebarFooterUtility({ collapsed }: { readonly collapsed?: boolean | undefined }) {
	const ctxCollapsed = useSidebarCollapsed()
	const isCollapsed = collapsed ?? ctxCollapsed
	const engine = useSyncEngine()
	const issues = useCollectionItems(engine.collections.issues)
	const tasksPreset = useUiStore((s) => s.tasksPreset)
	const activeViewId = useUiStore((s) => s.filters.activeViewId)
	const setTasksPreset = useUiStore((s) => s.setTasksPreset)
	const resetFilters = useUiStore((s) => s.resetFilters)

	const trashedCount = useMemo(() => issues.filter((i) => i.deletedAt !== null).length, [issues])

	return (
		<SidebarActionRow
			icon={<Trash2 className="size-4" />}
			label={t('tasks.sidebar.trash')}
			active={tasksPreset === 'trash' && activeViewId === null}
			isCurrentPage={tasksPreset === 'trash' && activeViewId === null}
			badgeCount={trashedCount}
			badgeTone="muted"
			collapsed={isCollapsed}
			onClick={() => {
				setTasksPreset('trash')
				resetFilters()
			}}
		/>
	)
}
