import type { IssueDto, ProjectStatusDto } from '@huriro/contracts'
import { t } from '@huriro/i18n'
import { Clock } from 'lucide-react'
import { useMemo } from 'react'
import { Button } from '@/components/ui/button'
import { Checkbox } from '@/components/ui/checkbox'
import { EmptyState } from '@/components/ui/empty-state'
import type { WorkspaceMemberSummary } from '@/lib/sync-bootstrap'
import { cn } from '@/lib/utils'
import { useUiStore } from '@/stores/ui-store'
import { PriorityBadge, StatusBadge } from './priority-status-badge'

export interface IssueListViewProps {
	readonly issues: readonly IssueDto[]
	readonly statusesById: ReadonlyMap<string, ProjectStatusDto>
	readonly membersById: ReadonlyMap<string, WorkspaceMemberSummary>
	readonly pendingEntityIds: ReadonlySet<string>
	readonly hasActiveFilters: boolean
}

function comparePos(a: string, b: string): number {
	return a < b ? -1 : a > b ? 1 : 0
}

export function IssueListView({
	issues,
	statusesById,
	membersById,
	pendingEntityIds,
	hasActiveFilters
}: IssueListViewProps) {
	const tasksDisplay = useUiStore((s) => s.tasksDisplay)
	const setCreateIssueOpen = useUiStore((s) => s.setCreateIssueOpen)
	const resetFilters = useUiStore((s) => s.resetFilters)

	// Sort + tree-shape + group — display options are ephemeral ui-store state
	// (§3.4). Sub-issue nesting only applies to the flat (ungrouped) list:
	// grouped rows stay flat so group membership stays unambiguous.
	const rows = useMemo(() => {
		const dir = tasksDisplay.sortDirection === 'desc' ? -1 : 1
		const sorted = [...issues].sort((a, b) => {
			switch (tasksDisplay.sortBy) {
				case 'priority':
					return (a.priority - b.priority) * dir || comparePos(a.position, b.position)
				case 'due_date': {
					const av = a.dueDate ? Date.parse(a.dueDate) : Number.MAX_SAFE_INTEGER
					const bv = b.dueDate ? Date.parse(b.dueDate) : Number.MAX_SAFE_INTEGER
					return (av - bv) * dir || comparePos(a.position, b.position)
				}
				case 'updated_at':
					return (Date.parse(a.updatedAt) - Date.parse(b.updatedAt)) * dir
				case 'created_at':
					return (Date.parse(a.createdAt) - Date.parse(b.createdAt)) * dir
				case 'estimate': {
					const av = Number(a.estimate ?? -1)
					const bv = Number(b.estimate ?? -1)
					return (av - bv) * dir || comparePos(a.position, b.position)
				}
				default:
					return comparePos(a.position, b.position)
			}
		})

		if (tasksDisplay.groupBy === 'none' && tasksDisplay.showSubIssues) {
			// Nest children directly under their parent when both are visible;
			// orphans (parent filtered out) render as top-level rows.
			const visible = new Set(sorted.map((i) => i.id))
			const childrenOf = new Map<string, IssueDto[]>()
			const roots: IssueDto[] = []
			for (const issue of sorted) {
				if (issue.parentId && visible.has(issue.parentId)) {
					const list = childrenOf.get(issue.parentId) ?? []
					list.push(issue)
					childrenOf.set(issue.parentId, list)
				} else {
					roots.push(issue)
				}
			}
			// roll-up counts across the *whole* subtree, not just visible rows
			const rollup = new Map<string, { done: number; total: number }>()
			const allByParent = new Map<string, IssueDto[]>()
			for (const issue of issues) {
				if (!issue.parentId) continue
				const list = allByParent.get(issue.parentId) ?? []
				list.push(issue)
				allByParent.set(issue.parentId, list)
			}
			for (const [parentId, kids] of allByParent) {
				const done = kids.filter(
					(k) => k.closedAt !== null || statusesById.get(k.statusId)?.category === 'completed'
				).length
				rollup.set(parentId, { done, total: kids.length })
			}
			const flat: { issue: IssueDto; depth: number; rollup?: { done: number; total: number } }[] = []
			const walk = (issue: IssueDto, depth: number) => {
				const r = rollup.get(issue.id)
				flat.push({ issue, depth, ...(r && r.total > 0 ? { rollup: r } : {}) })
				for (const kid of childrenOf.get(issue.id) ?? []) walk(kid, depth + 1)
			}
			for (const root of roots) walk(root, 0)
			return flat
		}
		return sorted.map((issue) => ({ issue, depth: 0 }))
	}, [issues, statusesById, tasksDisplay])

	const groups = useMemo(() => {
		if (tasksDisplay.groupBy === 'none') return [{ key: 'all', label: null as string | null, rows }]
		const byGroup = new Map<string, typeof rows>()
		for (const row of rows) {
			const key = groupKey(row.issue, tasksDisplay.groupBy, statusesById)
			const list = byGroup.get(key) ?? []
			list.push(row)
			byGroup.set(key, list)
		}
		return [...byGroup.entries()]
			.sort(([a], [b]) => a.localeCompare(b))
			.map(([key, groupRows]) => ({
				key,
				label: groupLabel(key, tasksDisplay.groupBy, statusesById, membersById),
				rows: groupRows
			}))
	}, [membersById, rows, statusesById, tasksDisplay.groupBy])

	if (issues.length === 0) {
		return (
			<EmptyState
				className="m-6"
				title={hasActiveFilters ? t('tasks.filtered-empty.title') : t('tasks.empty.title')}
				hint={t('tasks.empty.hint')}
				action={
					hasActiveFilters ? (
						<Button size="sm" tone="outline" onClick={resetFilters}>
							{t('tasks.filter.clear')}
						</Button>
					) : (
						<Button size="sm" onClick={() => setCreateIssueOpen(true)}>
							{t('tasks.new-issue')}
						</Button>
					)
				}
			/>
		)
	}

	return (
		<div>
			{groups.map((group) => (
				<section key={group.key} aria-label={group.label ?? t('tasks.title')}>
					{group.label !== null ? (
						<h3 className="sticky top-0 z-10 border-b border-border bg-background/95 px-4 py-1.5 text-xs font-semibold uppercase tracking-wide text-muted-foreground backdrop-blur">
							{group.label} <span className="tnum">({group.rows.length})</span>
						</h3>
					) : null}
					<ul className="divide-y divide-border">
						{group.rows.map((row) => (
							<IssueRow
								key={row.issue.id}
								issue={row.issue}
								depth={row.depth}
								rollup={(row as { rollup?: { done: number; total: number } }).rollup}
								statusesById={statusesById}
								membersById={membersById}
								isPending={pendingEntityIds.has(row.issue.id)}
							/>
						))}
					</ul>
				</section>
			))}
		</div>
	)
}

function groupKey(
	issue: IssueDto,
	groupBy: string,
	statusesById: ReadonlyMap<string, ProjectStatusDto>
): string {
	switch (groupBy) {
		case 'status_category':
			return statusesById.get(issue.statusId)?.category ?? 'unstarted'
		case 'priority':
			return `p${issue.priority}`
		case 'assignee_id':
			return issue.assigneeId ?? 'unassigned'
		case 'project_id':
			return issue.projectId
		case 'cycle_id':
			return issue.cycleId ?? 'no-cycle'
		case 'due_date':
			return issue.dueDate ? issue.dueDate.slice(0, 10) : 'no-due-date'
		default:
			return 'all'
	}
}

function groupLabel(
	key: string,
	groupBy: string,
	_statusesById: ReadonlyMap<string, ProjectStatusDto>,
	membersById: ReadonlyMap<string, WorkspaceMemberSummary>
): string {
	if (groupBy === 'status_category') return t(`tasks.category.${key}` as never)
	if (groupBy === 'priority') return t(`tasks.priority.${key.slice(1)}` as never)
	if (groupBy === 'assignee_id')
		return key === 'unassigned' ? t('tasks.detail.unassigned') : (membersById.get(key)?.displayName ?? key)
	if (groupBy === 'cycle_id') return key === 'no-cycle' ? t('tasks.bulk.no-cycle') : key.slice(0, 8)
	if (groupBy === 'project_id') return key.slice(0, 8)
	return key
}

// Exported for the closed-history section (§8.1) — one row style everywhere.
export function IssueRow({
	issue,
	depth,
	rollup,
	statusesById,
	membersById,
	isPending
}: {
	readonly issue: IssueDto
	readonly depth: number
	readonly rollup?: { readonly done: number; readonly total: number } | undefined
	readonly statusesById: ReadonlyMap<string, ProjectStatusDto>
	readonly membersById: ReadonlyMap<string, WorkspaceMemberSummary>
	readonly isPending: boolean
}) {
	const density = useUiStore((s) => s.density)
	const selectedIssueId = useUiStore((s) => s.selectedIssueId)
	const focusedIssueId = useUiStore((s) => s.focusedIssueId)
	const selectedIssueIds = useUiStore((s) => s.selectedIssueIds)
	const selectIssue = useUiStore((s) => s.selectIssue)
	const toggleMultiSelectIssue = useUiStore((s) => s.toggleMultiSelectIssue)
	const rangeSelectIssue = useUiStore((s) => s.rangeSelectIssue)

	const isFocused = focusedIssueId === issue.id
	const isSelected = selectedIssueId === issue.id
	const isChecked = selectedIssueIds.includes(issue.id)
	const status = statusesById.get(issue.statusId)
	const assignee = issue.assigneeId ? membersById.get(issue.assigneeId) : undefined

	return (
		<li
			data-issue-id={issue.id}
			data-focused={isFocused || undefined}
			className={cn(
				'flex items-center gap-3 px-4 transition-colors',
				density === 'compact' ? 'py-1.5' : 'py-2.5',
				isSelected
					? 'bg-accent/70'
					: isFocused
						? 'bg-accent/40 ring-1 ring-inset ring-ring'
						: 'hover:bg-accent/30'
			)}
			style={depth > 0 ? { paddingLeft: `${1 + depth * 1.5}rem` } : undefined}
		>
			<Checkbox
				checked={isChecked}
				onCheckedChange={() => toggleMultiSelectIssue(issue.id)}
				onClick={(e) => {
					// Shift-click extends the selection across the visible order (§3.4).
					// preventDefault suppresses Radix's internal checked-flip so the
					// range select is not immediately undone by a toggle of the endpoint.
					if (e.shiftKey) {
						e.preventDefault()
						const ordered = [...document.querySelectorAll('[data-issue-id]')]
							.map((el) => el.getAttribute('data-issue-id'))
							.filter((v): v is string => v !== null)
						rangeSelectIssue(issue.id, ordered)
					}
				}}
				aria-label={t('tasks.issue.select', { identifier: issue.identifier, title: issue.title })}
			/>
			<button
				type="button"
				onClick={() => selectIssue(issue.id, true)}
				className="flex min-w-0 flex-1 items-center gap-3 text-left"
			>
				<span className="w-20 shrink-0 font-mono text-xs text-muted-foreground tnum">{issue.identifier}</span>
				<StatusBadge status={status} />
				<span className="min-w-0 flex-1 truncate text-sm font-medium text-foreground">{issue.title}</span>
				{rollup ? (
					<span className="rounded bg-accent px-1.5 py-0.5 text-xs text-muted-foreground tnum">
						{t('tasks.display.subcount', { done: rollup.done, total: rollup.total })}
					</span>
				) : null}
				{isPending ? (
					<span
						className="inline-flex items-center gap-1 text-xs text-warning"
						title={t('tasks.pending-sync')}
					>
						<Clock className="size-3" aria-hidden />
						<span>{t('tasks.pending-sync')}</span>
					</span>
				) : null}
				<PriorityBadge priority={issue.priority} />
				<span className="hidden w-28 truncate text-right text-xs text-muted-foreground sm:inline">
					{assignee?.displayName ?? t('tasks.detail.unassigned')}
				</span>
			</button>
		</li>
	)
}
