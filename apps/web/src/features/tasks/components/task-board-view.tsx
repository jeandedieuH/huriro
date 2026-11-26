import type { IssueDto, ProjectStatusDto } from '@huriro/contracts'
import { t } from '@huriro/i18n'
import { ArrowRightLeft, Clock } from 'lucide-react'
import { useMemo, useState } from 'react'
import { Button } from '@/components/ui/button'
import { Checkbox } from '@/components/ui/checkbox'
import {
	DropdownMenu,
	DropdownMenuContent,
	DropdownMenuItem,
	DropdownMenuLabel,
	DropdownMenuSeparator,
	DropdownMenuTrigger
} from '@/components/ui/dropdown-menu'
import type { WorkspaceMemberSummary } from '@/lib/sync-bootstrap'
import { cn } from '@/lib/utils'
import { type TasksDisplayOptions, useUiStore } from '@/stores/ui-store'
import { PriorityBadge, StatusIcon } from './priority-status-badge'

export interface IssueBoardViewProps {
	readonly statuses: readonly ProjectStatusDto[]
	readonly issues: readonly IssueDto[]
	readonly members: readonly WorkspaceMemberSummary[]
	readonly pendingEntityIds: ReadonlySet<string>
	readonly announcement: string
	readonly onMoveIssue: (
		issueId: string,
		target: { statusId: string; afterIssueId?: string; beforeIssueId?: string }
	) => Promise<void>
	/** Lane-dimension patch for swimlane drops (§3.4) — same contract as the detail panel update. */
	readonly onPatchIssue: (
		issueId: string,
		patch: {
			priority?: number
			assigneeId?: string | null
			assigneeType?: 'user' | 'agent' | null
		}
	) => Promise<void>
}

function comparePos(a: string, b: string): number {
	return a < b ? -1 : a > b ? 1 : 0
}

type SubGroupBy = TasksDisplayOptions['subGroupBy']

/**
 * One swimlane: a lane value test plus the patch that moves an issue INTO the
 * lane. `patch` is applied on drops when the dragged issue fails `test`.
 */
interface BoardLane {
	readonly key: string
	readonly label: string
	readonly test: (issue: IssueDto) => boolean
	readonly patch: { priority?: number; assigneeId?: string | null; assigneeType?: 'user' | 'agent' | null }
}

function buildLanes(
	subGroupBy: Exclude<SubGroupBy, 'none'>,
	issues: readonly IssueDto[],
	members: readonly WorkspaceMemberSummary[]
): BoardLane[] {
	if (subGroupBy === 'priority') {
		// Urgent first — scanning a board is top-down triage (§3.4). Empty lanes
		// stay rendered: they are the drop targets for priority changes.
		return [4, 3, 2, 1, 0].map((p) => ({
			key: `p${p}`,
			label: t(`tasks.priority.${p}` as never),
			test: (issue) => issue.priority === p,
			patch: { priority: p }
		}))
	}
	// assignee_id: one lane per member plus lanes for assignees present in the
	// data but missing from the member list (deactivated users, agents), and a
	// terminal unassigned lane.
	const lanes: BoardLane[] = []
	const seen = new Set<string>()
	for (const m of [...members].sort((a, b) => a.displayName.localeCompare(b.displayName))) {
		seen.add(m.userId)
		lanes.push({
			key: m.userId,
			label: m.displayName,
			test: (issue) => issue.assigneeId === m.userId,
			patch: { assigneeId: m.userId, assigneeType: 'user' }
		})
	}
	for (const issue of issues) {
		if (issue.assigneeId !== null && !seen.has(issue.assigneeId)) {
			seen.add(issue.assigneeId)
			const assigneeId = issue.assigneeId
			lanes.push({
				key: assigneeId,
				label: assigneeId.slice(0, 8),
				test: (row) => row.assigneeId === assigneeId,
				patch: { assigneeId, assigneeType: issue.assigneeType === 'agent' ? 'agent' : 'user' }
			})
		}
	}
	lanes.push({
		key: 'unassigned',
		label: t('tasks.detail.unassigned'),
		test: (issue) => issue.assigneeId === null,
		patch: { assigneeId: null, assigneeType: null }
	})
	return lanes
}

/**
 * Kanban Board view (§9.5, §17.6, WCAG 2.2.2.1):
 * - Columns sorted by status `position`, cards sorted by issue `position` (COLLATE "C").
 * - Supports HTML5 drag-and-drop AND full non-drag alternatives:
 *   keyboard `H`/`L` (column move), `Mod+↑`/`Mod+↓` (reorder), and explicit `"Move to…"` menu.
 * - Live region announces moves for screen readers.
 * - Swimlanes (§3.4): when the display menu picks a sub-grouping, columns stay
 *   the status dimension and rows split horizontally per lane value; dropping
 *   into a lane patches that dimension too.
 */
export function IssueBoardView({
	statuses,
	issues,
	members,
	pendingEntityIds,
	announcement,
	onMoveIssue,
	onPatchIssue
}: IssueBoardViewProps) {
	const subGroupBy = useUiStore((s) => s.tasksDisplay.subGroupBy)

	const [draggedId, setDraggedId] = useState<string | null>(null)
	const [dragOverKey, setDragOverKey] = useState<string | null>(null)

	const sortedStatuses = useMemo(
		() => [...statuses].sort((a, b) => comparePos(a.position, b.position)),
		[statuses]
	)

	const lanes = useMemo<readonly BoardLane[] | null>(() => {
		if (subGroupBy === 'none') return null
		return buildLanes(subGroupBy, issues, members)
	}, [issues, members, subGroupBy])

	const columnIssues = useMemo(() => {
		const byStatus = new Map<string, IssueDto[]>()
		for (const status of sortedStatuses) {
			byStatus.set(
				status.id,
				issues
					.filter((issue) => issue.statusId === status.id)
					.sort((a, b) => comparePos(a.position, b.position))
			)
		}
		return byStatus
	}, [issues, sortedStatuses])

	// Shared drop logic for flat columns and lane cells: positional anchors are
	// column-wide in both cases (lanes are a visual regrouping, positions stay
	// one fractional-index ordering per status column).
	function dropIntoStatus(statusId: string, cellIssues: readonly IssueDto[], beforeIssueId?: string) {
		const droppedId = draggedId
		setDraggedId(null)
		setDragOverKey(null)
		if (!droppedId) return
		if (beforeIssueId !== undefined && droppedId === beforeIssueId) return
		const target: { statusId: string; afterIssueId?: string; beforeIssueId?: string } = { statusId }
		if (beforeIssueId !== undefined) {
			target.beforeIssueId = beforeIssueId
		} else {
			const tail = cellIssues.filter((i) => i.id !== droppedId).at(-1)
			if (tail) target.afterIssueId = tail.id
		}
		void onMoveIssue(droppedId, target)
	}

	function dropIntoLane(
		statusId: string,
		lane: BoardLane,
		cellIssues: readonly IssueDto[],
		beforeIssueId?: string
	) {
		const droppedId = draggedId
		dropIntoStatus(statusId, cellIssues, beforeIssueId)
		if (!droppedId) return
		const issue = issues.find((i) => i.id === droppedId)
		// Lane patch only when the drop actually crosses a lane boundary.
		if (issue && !lane.test(issue)) {
			void onPatchIssue(droppedId, lane.patch)
		}
	}

	return (
		<div className="flex h-full flex-col overflow-hidden">
			<div role="status" aria-live="polite" className="sr-only">
				{announcement}
			</div>

			{lanes === null ? (
				<div className="flex flex-1 gap-4 overflow-x-auto p-4">
					{sortedStatuses.map((status) => {
						const colIssues = columnIssues.get(status.id) ?? []
						return (
							<BoardColumn
								key={status.id}
								status={status}
								columnIssues={colIssues}
								sortedStatuses={sortedStatuses}
								allIssues={issues}
								pendingEntityIds={pendingEntityIds}
								dragOver={dragOverKey === status.id}
								onDragOverCell={() => setDragOverKey(status.id)}
								onDragLeaveCell={() => {
									if (dragOverKey === status.id) setDragOverKey(null)
								}}
								onDragStartCard={setDraggedId}
								onDropCard={(beforeIssueId) => dropIntoStatus(status.id, colIssues, beforeIssueId)}
								onDropColumn={() => dropIntoStatus(status.id, colIssues)}
								onMoveIssue={onMoveIssue}
							/>
						)
					})}
				</div>
			) : (
				<div className="flex-1 overflow-auto p-4">
					<div className="min-w-fit space-y-4">
						{/* Column headers render once at the top; fixed column widths keep
						    every lane row aligned underneath. */}
						<div className="sticky top-0 z-10 flex gap-4 bg-background/95 pb-1 backdrop-blur">
							{sortedStatuses.map((status) => (
								<div key={status.id} className="flex w-72 shrink-0 items-center gap-2 px-1 py-1">
									<StatusIcon category={status.category} />
									<span className="text-sm font-semibold">{status.name}</span>
									<span className="font-mono text-xs text-muted-foreground tnum">
										{(columnIssues.get(status.id) ?? []).length}
									</span>
								</div>
							))}
						</div>

						{lanes.map((lane) => {
							const laneIssueCount = issues.filter(lane.test).length
							return (
								<section key={lane.key} aria-label={lane.label}>
									<h3 className="flex items-center gap-2 px-1 py-1 text-xs font-semibold uppercase tracking-wide text-muted-foreground">
										{lane.label} <span className="tnum">({laneIssueCount})</span>
									</h3>
									<div className="flex gap-4">
										{sortedStatuses.map((status) => {
											const cellKey = `${lane.key}:${status.id}`
											const cellIssues = (columnIssues.get(status.id) ?? []).filter(lane.test)
											return (
												// Labeled <section> (region role) like the flat BoardColumn —
												// a plain div with drag handlers is a static-element interaction.
												<section
													key={status.id}
													aria-label={t('tasks.board.lane-cell', { lane: lane.label, status: status.name })}
													onDragOver={(ev) => {
														ev.preventDefault()
														setDragOverKey(cellKey)
													}}
													onDragLeave={() => {
														if (dragOverKey === cellKey) setDragOverKey(null)
													}}
													onDrop={(ev) => {
														ev.preventDefault()
														dropIntoLane(status.id, lane, cellIssues)
													}}
													className={cn(
														'flex min-h-16 w-72 shrink-0 flex-col gap-2 rounded-lg border border-border bg-surface-2/40 p-2',
														dragOverKey === cellKey && 'border-ring bg-accent/30'
													)}
												>
													{cellIssues.map((issue) => (
														<BoardCard
															key={issue.id}
															issue={issue}
															sortedStatuses={sortedStatuses}
															allIssues={issues}
															isPending={pendingEntityIds.has(issue.id)}
															onDragStart={setDraggedId}
															onDropCard={(beforeId) => dropIntoLane(status.id, lane, cellIssues, beforeId)}
															onMoveIssue={onMoveIssue}
														/>
													))}
												</section>
											)
										})}
									</div>
								</section>
							)
						})}
					</div>
				</div>
			)}
		</div>
	)
}

interface BoardColumnProps {
	readonly status: ProjectStatusDto
	readonly columnIssues: readonly IssueDto[]
	readonly sortedStatuses: readonly ProjectStatusDto[]
	readonly allIssues: readonly IssueDto[]
	readonly pendingEntityIds: ReadonlySet<string>
	readonly dragOver: boolean
	readonly onDragOverCell: () => void
	readonly onDragLeaveCell: () => void
	readonly onDragStartCard: (id: string) => void
	readonly onDropCard: (beforeIssueId: string) => void
	readonly onDropColumn: () => void
	readonly onMoveIssue: IssueBoardViewProps['onMoveIssue']
}

function BoardColumn({
	status,
	columnIssues,
	sortedStatuses,
	allIssues,
	pendingEntityIds,
	dragOver,
	onDragOverCell,
	onDragLeaveCell,
	onDragStartCard,
	onDropCard,
	onDropColumn,
	onMoveIssue
}: BoardColumnProps) {
	return (
		<section
			aria-label={status.name}
			onDragOver={(ev) => {
				ev.preventDefault()
				onDragOverCell()
			}}
			onDragLeave={onDragLeaveCell}
			onDrop={(ev) => {
				ev.preventDefault()
				onDropColumn()
			}}
			className={cn(
				'flex w-72 shrink-0 flex-col rounded-lg border border-border bg-surface-2/60',
				dragOver && 'border-ring bg-accent/30'
			)}
		>
			<header className="flex items-center justify-between border-b border-border px-3 py-2">
				<div className="flex items-center gap-2">
					<StatusIcon category={status.category} />
					<h3 className="text-sm font-semibold">{status.name}</h3>
				</div>
				<span className="font-mono text-xs text-muted-foreground tnum">{columnIssues.length}</span>
			</header>

			<div className="flex flex-1 flex-col gap-2 overflow-y-auto p-2">
				{columnIssues.map((issue) => (
					<BoardCard
						key={issue.id}
						issue={issue}
						sortedStatuses={sortedStatuses}
						allIssues={allIssues}
						isPending={pendingEntityIds.has(issue.id)}
						onDragStart={onDragStartCard}
						onDropCard={onDropCard}
						onMoveIssue={onMoveIssue}
					/>
				))}
			</div>
		</section>
	)
}

interface BoardCardProps {
	readonly issue: IssueDto
	readonly sortedStatuses: readonly ProjectStatusDto[]
	readonly allIssues: readonly IssueDto[]
	readonly isPending: boolean
	readonly onDragStart: (id: string) => void
	readonly onDropCard: (beforeIssueId: string) => void
	readonly onMoveIssue: IssueBoardViewProps['onMoveIssue']
}

function BoardCard({
	issue,
	sortedStatuses,
	allIssues,
	isPending,
	onDragStart,
	onDropCard,
	onMoveIssue
}: BoardCardProps) {
	const focusedIssueId = useUiStore((s) => s.focusedIssueId)
	const selectedIssueId = useUiStore((s) => s.selectedIssueId)
	const selectedIssueIds = useUiStore((s) => s.selectedIssueIds)
	const selectIssue = useUiStore((s) => s.selectIssue)
	const setFocusedIssueId = useUiStore((s) => s.setFocusedIssueId)
	const toggleMultiSelectIssue = useUiStore((s) => s.toggleMultiSelectIssue)
	const rangeSelectIssue = useUiStore((s) => s.rangeSelectIssue)

	const isFocused = focusedIssueId === issue.id
	const isSelected = selectedIssueId === issue.id
	const isChecked = selectedIssueIds.includes(issue.id)
	// Hover-reveal parity with the mail/task list pattern: checkboxes stay
	// visible while any selection is active so the bulk-selection state of the
	// board is scannable without scrubbing every card.
	const revealCheckbox = isChecked || selectedIssueIds.length > 0

	return (
		<article
			draggable
			data-issue-id={issue.id}
			data-focused={isFocused || undefined}
			onDragStart={(ev) => {
				onDragStart(issue.id)
				ev.dataTransfer.setData('text/plain', issue.id)
				ev.dataTransfer.effectAllowed = 'move'
			}}
			onDragOver={(ev) => {
				ev.preventDefault()
			}}
			onDrop={(ev) => {
				ev.stopPropagation()
				ev.preventDefault()
				onDropCard(issue.id)
			}}
			onFocus={() => setFocusedIssueId(issue.id)}
			className={cn(
				'group rounded-md border border-border bg-card p-3 shadow-(--shadow-1) transition-shadow',
				isSelected && 'border-primary',
				isFocused && 'ring-2 ring-ring'
			)}
		>
			<div className="flex items-center justify-between gap-2">
				<span className="flex min-w-0 items-center gap-1.5">
					<Checkbox
						checked={isChecked}
						onCheckedChange={() => toggleMultiSelectIssue(issue.id)}
						onMouseDown={(e) => {
							// Never let the checkbox steal DOM focus: the click would
							// otherwise re-anchor `focusedIssueId` onto the shift-clicked
							// card before the range handler reads it (focus moves on
							// mousedown, before click), collapsing the range to the target.
							e.preventDefault()
						}}
						onClick={(e) => {
							// Shift-click extends the selection across the flattened board
							// order (column-major DOM order — the same visible order the list
							// view uses). preventDefault suppresses Radix's internal toggle
							// so the range select is not immediately undone by a toggle of
							// the endpoint.
							if (e.shiftKey) {
								e.preventDefault()
								const ordered = [...document.querySelectorAll('[data-issue-id]')]
									.map((el) => el.getAttribute('data-issue-id'))
									.filter((v): v is string => v !== null)
								rangeSelectIssue(issue.id, ordered)
							}
						}}
						aria-label={t('tasks.issue.select', { identifier: issue.identifier, title: issue.title })}
						className={cn(
							'transition-opacity',
							!revealCheckbox && 'opacity-0 group-hover:opacity-100 group-focus-within:opacity-100'
						)}
					/>
					<span className="font-mono text-xs text-muted-foreground tnum">{issue.identifier}</span>
				</span>
				<div className="flex items-center gap-1">
					{isPending ? <Clock className="size-3 text-warning" aria-label={t('tasks.pending-sync')} /> : null}
					<DropdownMenu>
						<DropdownMenuTrigger asChild>
							<Button
								size="icon"
								tone="ghost"
								className="size-6"
								aria-label={`${t('tasks.move-to')} (${issue.identifier})`}
							>
								<ArrowRightLeft className="size-3.5" aria-hidden />
							</Button>
						</DropdownMenuTrigger>
						<DropdownMenuContent align="end">
							<DropdownMenuLabel>{t('tasks.move-to')}</DropdownMenuLabel>
							<DropdownMenuSeparator />
							{sortedStatuses.map((targetStatus) => (
								<DropdownMenuItem
									key={targetStatus.id}
									disabled={targetStatus.id === issue.statusId}
									onSelect={() => {
										const colTail = allIssues
											.filter((i) => i.statusId === targetStatus.id && i.id !== issue.id)
											.sort((a, b) => comparePos(a.position, b.position))
											.at(-1)
										void onMoveIssue(issue.id, {
											statusId: targetStatus.id,
											...(colTail ? { afterIssueId: colTail.id } : {})
										})
									}}
								>
									<StatusIcon category={targetStatus.category} />
									<span>{targetStatus.name}</span>
								</DropdownMenuItem>
							))}
						</DropdownMenuContent>
					</DropdownMenu>
				</div>
			</div>

			<button
				type="button"
				onClick={() => selectIssue(issue.id, true)}
				className="mt-1.5 block w-full text-left text-sm font-medium text-foreground hover:text-primary"
			>
				{issue.title}
			</button>

			<div className="mt-2.5 flex items-center justify-between">
				<PriorityBadge priority={issue.priority} />
			</div>
		</article>
	)
}
