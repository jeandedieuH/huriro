import { evaluateFilter, type FilterExpr } from '@huriro/domain'
import { t } from '@huriro/i18n'
import { isTier2Issue, useCollectionItems, useSyncEngine, useSyncStatus } from '@huriro/sync-client'
import { lazy, Suspense, useCallback, useEffect, useMemo, useState } from 'react'
import { useKeyboardShortcuts } from '@/features/keyboard/use-keyboard-shortcuts'
import type { TaskApiBridge, WorkspaceMemberSummary } from '@/lib/sync-bootstrap'
import { type TasksPreset, useUiStore } from '@/stores/ui-store'
import { BulkActionBar } from './bulk-action-bar'
import { ClosedHistorySection } from './closed-history-section'
import { CreateProjectDialog } from './create-project-dialog'
import { CreateTaskDialog } from './create-task-dialog'
import { CycleStrip } from './cycle-strip'
import { FilterBar } from './filter-bar'
import { IssueBoardView } from './task-board-view'
import { IssueDetailPanel } from './task-detail-panel'
import { IssueListView } from './task-list-view'
import { TriageInbox } from './triage-inbox'

// M8 planning canvases are deliberately lazy: the interactive shell and list/board
// path stay within the initial-bundle budget while timeline/calendar load on demand.
const TaskTimelineView = lazy(() =>
	import('./task-timeline-view').then((m) => ({ default: m.TaskTimelineView }))
)
const TaskCalendarView = lazy(() =>
	import('./task-calendar-view').then((m) => ({ default: m.TaskCalendarView }))
)

export interface TasksWorkspaceProps {
	readonly api: TaskApiBridge
	readonly currentUserId: string
}

function comparePos(a: string, b: string): number {
	return a < b ? -1 : a > b ? 1 : 0
}

const PRESET_LABELS: Record<
	TasksPreset,
	| 'tasks.all-issues'
	| 'tasks.sidebar.my-tasks'
	| 'tasks.sidebar.this-week'
	| 'tasks.sidebar.my-week'
	| 'tasks.sidebar.overdue'
	| 'tasks.sidebar.due-soon'
	| 'tasks.sidebar.trash'
	| 'tasks.triage.title'
> = {
	all: 'tasks.all-issues',
	'my-tasks': 'tasks.sidebar.my-tasks',
	'this-week': 'tasks.sidebar.this-week',
	'my-week': 'tasks.sidebar.my-week',
	overdue: 'tasks.sidebar.overdue',
	'due-soon': 'tasks.sidebar.due-soon',
	trash: 'tasks.sidebar.trash',
	triage: 'tasks.triage.title'
}

export function TasksWorkspace({ api, currentUserId }: TasksWorkspaceProps) {
	const engine = useSyncEngine()
	const _syncStatus = useSyncStatus()

	const projects = useCollectionItems(engine.collections.projects)
	const statuses = useCollectionItems(engine.collections.projectStatuses)
	const labels = useCollectionItems(engine.collections.labels)
	const issues = useCollectionItems(engine.collections.issues)
	const savedViews = useCollectionItems(engine.collections.savedViews)
	const cycles = useCollectionItems(engine.collections.cycles)
	const initiatives = useCollectionItems(engine.collections.initiatives)
	const milestones = useCollectionItems(engine.collections.projectMilestones)
	const relations = useCollectionItems(engine.collections.issueRelations)

	const activeProjectId = useUiStore((s) => s.activeProjectId)
	const tasksPreset = useUiStore((s) => s.tasksPreset)
	const tasksLayout = useUiStore((s) => s.tasksLayout)
	const filters = useUiStore((s) => s.filters)
	const filterExpr = useUiStore((s) => s.filterExpr)
	const tasksDisplay = useUiStore((s) => s.tasksDisplay)
	const setActiveProjectId = useUiStore((s) => s.setActiveProjectId)
	const selectedIssueId = useUiStore((s) => s.selectedIssueId)
	const detailPanelOpen = useUiStore((s) => s.detailPanelOpen)
	const selectIssue = useUiStore((s) => s.selectIssue)
	const pushToast = useUiStore((s) => s.pushToast)

	const [members, setMembers] = useState<WorkspaceMemberSummary[]>([])
	const [boardAnnouncement, setBoardAnnouncement] = useState('')

	useEffect(() => {
		let cancelled = false
		void api
			.listMembers()
			.then((m) => {
				if (!cancelled) setMembers(m)
			})
			.catch(() => {})
		return () => {
			cancelled = true
		}
	}, [api])

	const statusesById = useMemo(() => new Map(statuses.map((s) => [s.id, s])), [statuses])
	const membersById = useMemo(() => new Map(members.map((m) => [m.userId, m])), [members])
	const currentMemberRole = membersById.get(currentUserId)?.role
	const canManageInitiatives = currentMemberRole === 'owner' || currentMemberRole === 'admin'
	const canWriteProjects = currentMemberRole !== undefined && currentMemberRole !== 'guest'

	const visibleStatuses = useMemo(() => {
		if (activeProjectId) {
			return statuses
				.filter((s) => s.projectId === activeProjectId)
				.sort((a, b) => comparePos(a.position, b.position))
		}
		const firstProjectId = projects[0]?.id
		return firstProjectId
			? statuses
					.filter((s) => s.projectId === firstProjectId)
					.sort((a, b) => comparePos(a.position, b.position))
			: statuses
	}, [activeProjectId, projects, statuses])

	const filteredIssues = useMemo(() => {
		const q = filters.query.trim().toLowerCase()
		const nowMs = Date.now()
		const todayStart = new Date(nowMs)
		todayStart.setHours(0, 0, 0, 0)
		const startOfTodayMs = todayStart.getTime()
		const weekEndMs = nowMs + 7 * 86_400_000
		const soonEndMs = startOfTodayMs + 3 * 86_400_000

		const statusCategoryOf = (statusId: string) => statusesById.get(statusId)?.category
		const exprCtx = { now: new Date(), statusCategoryOf }

		return issues
			.filter((issue) => {
				if (filterExpr) {
					// M7 compound filter — the AST is the wire format AND the local
					// query language; labelIds come from the replica row shape.
					try {
						if (!evaluateFilter(filterExpr as FilterExpr, issue as never, exprCtx)) return false
					} catch {
						// A malformed expr must never blank the list — fail open.
					}
				}
				if (tasksPreset === 'trash') {
					if (issue.deletedAt === null) return false
				} else if (issue.deletedAt !== null) {
					return false
				}

				// Tier-2 history rows (closed/deleted > 30d, §8.1) never belong in the
				// working list: they only reach the replica through the lazy
				// `issue_hist` scope and render in the closed-history section instead.
				// Trash keeps them — age does not undelete a row.
				if (tasksPreset !== 'trash' && isTier2Issue(issue, nowMs)) return false

				if (tasksPreset === 'my-tasks' && issue.assigneeId !== currentUserId) return false
				if (tasksPreset === 'this-week' || tasksPreset === 'my-week') {
					if (issue.closedAt !== null || !issue.dueDate) return false
					const dueMs = Date.parse(issue.dueDate)
					if (Number.isNaN(dueMs) || dueMs > weekEndMs) return false
					if (tasksPreset === 'my-week' && issue.assigneeId !== currentUserId) return false
				}
				if (tasksPreset === 'overdue') {
					if (issue.closedAt !== null || !issue.dueDate) return false
					const dueMs = Date.parse(issue.dueDate)
					if (Number.isNaN(dueMs) || dueMs >= startOfTodayMs) return false
				}
				if (tasksPreset === 'due-soon') {
					if (issue.closedAt !== null || !issue.dueDate) return false
					const dueMs = Date.parse(issue.dueDate)
					if (Number.isNaN(dueMs) || dueMs < startOfTodayMs || dueMs > soonEndMs) return false
				}

				if (activeProjectId && issue.projectId !== activeProjectId) return false
				if (filterExpr) return true
				if (filters.statusId !== 'all' && issue.statusId !== filters.statusId) return false
				if (filters.priority !== 'all' && issue.priority !== filters.priority) return false
				if (filters.assigneeId === 'me' && issue.assigneeId !== currentUserId) return false
				if (filters.assigneeId === 'unassigned' && issue.assigneeId !== null) return false
				if (
					filters.assigneeId !== 'all' &&
					filters.assigneeId !== 'me' &&
					filters.assigneeId !== 'unassigned' &&
					issue.assigneeId !== filters.assigneeId
				) {
					return false
				}
				if (q.length > 0) {
					const matches =
						issue.title.toLowerCase().includes(q) ||
						issue.identifier.toLowerCase().includes(q) ||
						issue.descriptionText.toLowerCase().includes(q)
					if (!matches) return false
				}
				return true
			})
			.sort((a, b) => comparePos(a.position, b.position))
	}, [activeProjectId, currentUserId, filterExpr, filters, issues, statusesById, tasksPreset])

	const pendingEntityIds = engine.getPendingMutationIds()
	const hasActiveFilters =
		filterExpr !== null ||
		filters.query.length > 0 ||
		filters.statusId !== 'all' ||
		filters.priority !== 'all' ||
		filters.assigneeId !== 'all'

	const handleMoveIssue = useCallback(
		async (issueId: string, target: { statusId: string; afterIssueId?: string; beforeIssueId?: string }) => {
			const issue = engine.collections.issues.get(issueId)
			const targetStatus = statusesById.get(target.statusId)
			await engine.moveIssue(issueId, target)
			if (issue && targetStatus) {
				setBoardAnnouncement(`${issue.identifier} moved to ${targetStatus.name}`)
			}
		},
		[engine, statusesById]
	)

	const handleMoveColumn = useCallback(
		(issueId: string, direction: -1 | 1) => {
			const issue = engine.collections.issues.get(issueId)
			if (!issue) return
			const projStatuses = statuses
				.filter((s) => s.projectId === issue.projectId)
				.sort((a, b) => comparePos(a.position, b.position))
			const idx = projStatuses.findIndex((s) => s.id === issue.statusId)
			const nextStatus = projStatuses[idx + direction]
			if (!nextStatus) return
			const tail = issues
				.filter((i) => i.statusId === nextStatus.id && i.id !== issueId)
				.sort((a, b) => comparePos(a.position, b.position))
				.at(-1)
			void handleMoveIssue(issueId, {
				statusId: nextStatus.id,
				...(tail ? { afterIssueId: tail.id } : {})
			})
		},
		[engine, handleMoveIssue, issues, statuses]
	)

	const handleReorderWithinColumn = useCallback(
		(issueId: string, direction: -1 | 1) => {
			const issue = engine.collections.issues.get(issueId)
			if (!issue) return
			const col = issues
				.filter((i) => i.projectId === issue.projectId && i.statusId === issue.statusId)
				.sort((a, b) => comparePos(a.position, b.position))
			const idx = col.findIndex((i) => i.id === issueId)
			const swapIdx = idx + direction
			const neighbor = col[swapIdx]
			if (idx < 0 || !neighbor) return
			const moveArg =
				direction < 0
					? { statusId: issue.statusId, beforeIssueId: neighbor.id }
					: { statusId: issue.statusId, afterIssueId: neighbor.id }
			void engine.moveIssue(issueId, moveArg).then(() => {
				setBoardAnnouncement(`${issue.identifier} reordered in column`)
			})
		},
		[engine, issues]
	)

	const orderedIssueIds = useMemo(() => filteredIssues.map((i) => i.id), [filteredIssues])

	useKeyboardShortcuts(
		useMemo(
			() => ({
				orderedIssueIds,
				onMoveColumn: handleMoveColumn,
				onReorderWithinColumn: handleReorderWithinColumn
			}),
			[handleMoveColumn, handleReorderWithinColumn, orderedIssueIds]
		)
	)

	const selectedIssue = selectedIssueId ? engine.collections.issues.get(selectedIssueId) : undefined

	const projectLabel = useMemo(() => {
		if (!activeProjectId) return t('tasks.sidebar.all-projects')
		return projects.find((p) => p.id === activeProjectId)?.name ?? t('tasks.sidebar.all-projects')
	}, [activeProjectId, projects])

	const triageProjectId = useMemo(() => {
		if (activeProjectId) {
			const proj = projects.find((p) => p.id === activeProjectId)
			if (proj?.triageEnabled) return proj.id
		}
		return projects.find((p) => p.triageEnabled)?.id ?? null
	}, [activeProjectId, projects])

	// Active cycle for the header strip (§3.3): only when a cycle-enabled
	// project is selected — cross-project presets have no single cycle to show.
	const activeCycle = useMemo(() => {
		if (!activeProjectId || tasksPreset === 'triage') return null
		const proj = projects.find((p) => p.id === activeProjectId)
		if (!proj?.cycleEnabled) return null
		return cycles.find((c) => c.projectId === activeProjectId && c.status === 'active') ?? null
	}, [activeProjectId, cycles, projects, tasksPreset])

	const cycleIssues = useMemo(
		() => (activeCycle ? issues.filter((i) => i.cycleId === activeCycle.id && i.deletedAt === null) : []),
		[activeCycle, issues]
	)

	const viewLabel = useMemo(() => {
		if (filters.activeViewId) {
			const activeView = savedViews.find((v) => v.id === filters.activeViewId)
			if (activeView) return activeView.name
		}
		return t(PRESET_LABELS[tasksPreset])
	}, [filters.activeViewId, savedViews, tasksPreset])

	const myAssigned = useMemo(
		() => filteredIssues.filter((i) => i.assigneeId === currentUserId),
		[currentUserId, filteredIssues]
	)
	const myCreated = useMemo(
		() => filteredIssues.filter((i) => i.creatorId === currentUserId),
		[currentUserId, filteredIssues]
	)

	return (
		<div className="flex h-full min-h-0">
			<div className="flex min-w-0 flex-1 flex-col">
				<FilterBar
					statuses={visibleStatuses}
					members={members}
					projectLabel={projectLabel}
					viewLabel={viewLabel}
					onSaveView={async (name) => {
						// Saved views v2 (§3.4): persist the compound filter AST and the
						// display options alongside the legacy flat filters — a non-null
						// filterExpr wins over `filters` when the view loads again.
						await engine.createSavedView({
							name,
							projectId: activeProjectId,
							layout:
								tasksLayout === 'board' || tasksLayout === 'timeline' || tasksLayout === 'calendar'
									? tasksLayout
									: 'list',
							filters: {
								...(filters.statusId !== 'all' ? { statusIds: [filters.statusId] } : {}),
								...(filters.priority !== 'all' ? { priorities: [filters.priority] } : {}),
								...(filters.assigneeId === 'me' ? { mine: true } : {}),
								...(filters.query.trim().length > 0 ? { search: filters.query.trim() } : {})
							},
							// The ui-store expr is `unknown` by design (user-authored JSON);
							// the builder produces exactly the wire AST shape.
							filterExpr: filterExpr === null ? null : (filterExpr as never),
							displayOptions: {
								groupBy: tasksDisplay.groupBy,
								subGroupBy: tasksDisplay.subGroupBy === 'none' ? null : tasksDisplay.subGroupBy,
								sortBy: tasksDisplay.sortBy,
								sortDirection: tasksDisplay.sortDirection,
								showSubIssues: tasksDisplay.showSubIssues
							},
							isShared: false
						})
					}}
				/>

				{activeCycle ? <CycleStrip cycle={activeCycle} cycleIssues={cycleIssues} /> : null}

				<div className="min-h-0 flex-1 overflow-y-auto">
					{tasksPreset === 'triage' && triageProjectId ? (
						<TriageInbox key={triageProjectId} projectId={triageProjectId} />
					) : null}

					{tasksPreset !== 'triage' && tasksLayout === 'list' ? (
						<>
							<IssueListView
								issues={filteredIssues}
								statusesById={statusesById}
								membersById={membersById}
								pendingEntityIds={pendingEntityIds}
								hasActiveFilters={hasActiveFilters}
							/>
							{activeProjectId && tasksPreset !== 'trash' ? (
								<ClosedHistorySection
									projectId={activeProjectId}
									issues={issues}
									statusesById={statusesById}
									membersById={membersById}
									pendingEntityIds={pendingEntityIds}
								/>
							) : null}
						</>
					) : null}

					{tasksPreset !== 'triage' && tasksLayout === 'board' ? (
						<IssueBoardView
							statuses={visibleStatuses}
							issues={filteredIssues}
							members={members}
							pendingEntityIds={pendingEntityIds}
							announcement={boardAnnouncement}
							onMoveIssue={handleMoveIssue}
							onPatchIssue={async (id, patch) => engine.updateIssue(id, patch)}
						/>
					) : null}

					{tasksPreset !== 'triage' && tasksLayout === 'timeline' ? (
						<Suspense
							fallback={<div className="p-6 text-sm text-muted-foreground">{t('tasks.timeline.title')}…</div>}
						>
							<TaskTimelineView
								issues={filteredIssues}
								projects={projects}
								initiatives={initiatives}
								milestones={milestones}
								relations={relations}
								statusesById={statusesById}
								canManageInitiatives={canManageInitiatives}
								canWriteProjects={canWriteProjects}
								onPatchIssue={(id, patch) => engine.updateIssue(id, patch)}
							/>
						</Suspense>
					) : null}

					{tasksPreset !== 'triage' && tasksLayout === 'calendar' ? (
						<Suspense
							fallback={<div className="p-6 text-sm text-muted-foreground">{t('tasks.calendar.title')}…</div>}
						>
							<TaskCalendarView
								issues={filteredIssues}
								milestones={milestones}
								onPatchIssue={(id, patch) => engine.updateIssue(id, patch)}
							/>
						</Suspense>
					) : null}

					{tasksPreset !== 'triage' && tasksLayout === 'my-work' ? (
						<div className="space-y-6 p-4">
							<section aria-label={t('tasks.my-work.assigned')} className="space-y-2">
								<h2 className="text-sm font-semibold">
									{t('tasks.my-work.assigned')} ({myAssigned.length})
								</h2>
								<div className="rounded-lg border border-border">
									<IssueListView
										issues={myAssigned}
										statusesById={statusesById}
										membersById={membersById}
										pendingEntityIds={pendingEntityIds}
										hasActiveFilters={false}
									/>
								</div>
							</section>
							<section aria-label={t('tasks.my-work.created')} className="space-y-2">
								<h2 className="text-sm font-semibold">
									{t('tasks.my-work.created')} ({myCreated.length})
								</h2>
								<div className="rounded-lg border border-border">
									<IssueListView
										issues={myCreated}
										statusesById={statusesById}
										membersById={membersById}
										pendingEntityIds={pendingEntityIds}
										hasActiveFilters={false}
									/>
								</div>
							</section>
						</div>
					) : null}
				</div>
			</div>

			{detailPanelOpen && selectedIssue ? (
				<IssueDetailPanel
					key={selectedIssue.id}
					issue={selectedIssue}
					allIssues={issues}
					statuses={statuses}
					labels={labels}
					members={members}
					api={api}
					onUpdateIssue={(id, patch) => engine.updateIssue(id, patch)}
					onCreateSubIssue={async (parentId, title) => {
						const parent = engine.collections.issues.get(parentId)
						if (!parent) return
						await engine.createIssue({
							projectId: parent.projectId,
							parentId,
							title
						})
					}}
					onDeleteIssue={async (id) => {
						const target = engine.collections.issues.get(id)
						await engine.deleteIssue(id)
						selectIssue(null, false)
						if (target) {
							pushToast({
								title: `Deleted ${target.identifier}`,
								description: target.title
							})
						}
					}}
				/>
			) : null}

			<BulkActionBar statuses={statuses} labels={labels} cycles={cycles} />

			<CreateTaskDialog
				projects={projects}
				statuses={statuses}
				onSubmit={async (input) => {
					const created = await engine.createIssue(input)
					selectIssue(created.id, false)
				}}
			/>

			<CreateProjectDialog
				onSubmit={async (input) => {
					const created = await engine.createProject(input)
					setActiveProjectId(created.id)
				}}
			/>
		</div>
	)
}
