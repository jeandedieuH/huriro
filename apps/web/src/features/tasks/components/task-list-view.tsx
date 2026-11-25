import type { IssueDto, ProjectStatusDto } from '@huriro/contracts'
import { t } from '@huriro/i18n'
import { Clock } from 'lucide-react'
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

export function IssueListView({
	issues,
	statusesById,
	membersById,
	pendingEntityIds,
	hasActiveFilters
}: IssueListViewProps) {
	const density = useUiStore((s) => s.density)
	const selectedIssueId = useUiStore((s) => s.selectedIssueId)
	const focusedIssueId = useUiStore((s) => s.focusedIssueId)
	const selectedIssueIds = useUiStore((s) => s.selectedIssueIds)
	const selectIssue = useUiStore((s) => s.selectIssue)
	const toggleMultiSelectIssue = useUiStore((s) => s.toggleMultiSelectIssue)
	const setCreateIssueOpen = useUiStore((s) => s.setCreateIssueOpen)
	const resetFilters = useUiStore((s) => s.resetFilters)

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
		<ul aria-label={t('tasks.title')} className="divide-y divide-border">
			{issues.map((issue) => {
				const isFocused = focusedIssueId === issue.id
				const isSelected = selectedIssueId === issue.id
				const isChecked = selectedIssueIds.includes(issue.id)
				const isPending = pendingEntityIds.has(issue.id)
				const status = statusesById.get(issue.statusId)
				const assignee = issue.assigneeId ? membersById.get(issue.assigneeId) : undefined

				return (
					<li
						key={issue.id}
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
					>
						<Checkbox
							checked={isChecked}
							onCheckedChange={() => toggleMultiSelectIssue(issue.id)}
							aria-label={`Select ${issue.identifier} ${issue.title}`}
						/>
						<button
							type="button"
							onClick={() => selectIssue(issue.id, true)}
							className="flex min-w-0 flex-1 items-center gap-3 text-left"
						>
							<span className="w-20 shrink-0 font-mono text-xs text-muted-foreground tnum">
								{issue.identifier}
							</span>
							<StatusBadge status={status} />
							<span className="min-w-0 flex-1 truncate text-sm font-medium text-foreground">
								{issue.title}
							</span>
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
			})}
		</ul>
	)
}
