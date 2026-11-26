import type { IssueDto, SavedViewDto } from '@huriro/contracts'
import { evaluateFilter, type FilterExpr } from '@huriro/domain'
import { t } from '@huriro/i18n'
import { useCollectionItems } from '@huriro/sync-client'
import { CircleDot } from 'lucide-react'
import { useMemo } from 'react'
import { Badge } from '@/components/ui/badge'
import { useWorkspace } from '@/lib/workspace'

export interface IssueSavedViewEmbedProps {
	readonly savedViewId: string
	readonly compact?: boolean | undefined
}

function compareIssues(a: IssueDto, b: IssueDto, view: SavedViewDto): number {
	const sortBy = view.displayOptions.sortBy ?? 'position'
	const direction = view.displayOptions.sortDirection === 'desc' ? -1 : 1
	const value = (issue: IssueDto): string | number => {
		if (sortBy === 'priority') return issue.priority
		if (sortBy === 'dueDate') return issue.dueDate ?? '9999-12-31'
		if (sortBy === 'createdAt') return issue.createdAt
		if (sortBy === 'updatedAt') return issue.updatedAt
		if (sortBy === 'title') return issue.title
		return issue.position
	}
	const av = value(a)
	const bv = value(b)
	if (av < bv) return -1 * direction
	if (av > bv) return 1 * direction
	return a.identifier.localeCompare(b.identifier)
}

/** Read-only live embed for Huriro issue saved views. It evaluates the same
 * domain FilterExpr locally as the tasks workspace, so embeds stay correct offline. */
export function IssueSavedViewEmbed({ savedViewId, compact = false }: IssueSavedViewEmbedProps) {
	const { engine, currentUserId } = useWorkspace()
	const savedViews = useCollectionItems(engine.collections.savedViews)
	const issues = useCollectionItems(engine.collections.issues)
	const statuses = useCollectionItems(engine.collections.projectStatuses)
	const view = savedViews.find((item) => item.id === savedViewId)
	const statusById = useMemo(() => new Map(statuses.map((status) => [status.id, status])), [statuses])

	const visibleIssues = useMemo(() => {
		if (!view) return []
		const statusCategoryOf = (statusId: string) => statusById.get(statusId)?.category
		const ctx = { now: new Date(), statusCategoryOf }
		return issues
			.filter((issue) => {
				if (issue.deletedAt !== null) return false
				if (view.projectId && issue.projectId !== view.projectId) return false
				if (view.filterExpr) {
					try {
						return evaluateFilter(view.filterExpr as FilterExpr, issue as never, ctx)
					} catch {
						return true
					}
				}
				const filters = view.filters
				if (filters.statusIds?.length && !filters.statusIds.includes(issue.statusId)) return false
				if (filters.priorities?.length && !filters.priorities.includes(issue.priority)) return false
				if (
					filters.assigneeIds?.length &&
					(!issue.assigneeId || !filters.assigneeIds.includes(issue.assigneeId))
				)
					return false
				if (filters.labelIds?.length && !filters.labelIds.some((id) => issue.labelIds.includes(id)))
					return false
				if (filters.cycleId !== undefined && issue.cycleId !== filters.cycleId) return false
				if (filters.mine && issue.assigneeId !== currentUserId) return false
				if (filters.search && !issue.title.toLowerCase().includes(filters.search.toLowerCase())) return false
				return true
			})
			.sort((a, b) => compareIssues(a, b, view))
	}, [currentUserId, issues, statusById, view])

	if (!view) {
		return (
			<div className="rounded-lg border border-border/70 border-dashed p-4 text-muted-foreground text-sm">
				{t('databases.linked.issue-view-missing')}
			</div>
		)
	}

	return (
		<section aria-label={view.name} className="overflow-hidden rounded-xl border border-border/80 bg-card">
			<header className="flex items-center justify-between gap-2 border-border/70 border-b px-3 py-2">
				<div className="flex min-w-0 items-center gap-2">
					<CircleDot className="size-4 text-primary" aria-hidden />
					<h3 className="truncate font-medium text-sm">{view.name}</h3>
				</div>
				<Badge tone="secondary">{visibleIssues.length}</Badge>
			</header>
			{visibleIssues.length === 0 ? (
				<p className="p-4 text-muted-foreground text-sm">{t('databases.linked.issue-view-empty')}</p>
			) : (
				<ul className="divide-y divide-border/60">
					{visibleIssues.slice(0, compact ? 8 : 25).map((issue) => {
						const status = statusById.get(issue.statusId)
						return (
							<li key={issue.id} className="flex items-center gap-3 px-3 py-2 text-sm">
								<span className="w-20 shrink-0 font-mono text-muted-foreground text-xs">
									{issue.identifier}
								</span>
								<span className="min-w-0 flex-1 truncate">{issue.title}</span>
								{status ? <Badge tone="outline">{status.name}</Badge> : null}
								{issue.dueDate ? (
									<span className="hidden text-muted-foreground text-xs sm:inline">{issue.dueDate}</span>
								) : null}
							</li>
						)
					})}
				</ul>
			)}
		</section>
	)
}
