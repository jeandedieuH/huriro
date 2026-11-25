import type { IssueDto, ProjectStatusDto } from '@huriro/contracts'
import { t } from '@huriro/i18n'
import { isTier2Issue, useSyncScope } from '@huriro/sync-client'
import { ChevronDown, ChevronRight, History } from 'lucide-react'
import { useMemo, useState } from 'react'
import { Button } from '@/components/ui/button'
import type { WorkspaceMemberSummary } from '@/lib/sync-bootstrap'
import { useUiStore } from '@/stores/ui-store'
import { IssueRow } from './task-list-view'

export interface ClosedHistorySectionProps {
	readonly projectId: string
	/** All replica issues — the tier-2 filter runs inside so hydration updates re-render reactively. */
	readonly issues: readonly IssueDto[]
	readonly statusesById: ReadonlyMap<string, ProjectStatusDto>
	readonly membersById: ReadonlyMap<string, WorkspaceMemberSummary>
	readonly pendingEntityIds: ReadonlySet<string>
}

/**
 * "Closed issues" history group (§8.1, ADR-0031): collapsed by default so the
 * tier-2 scope costs nothing; expanding it subscribes `issue_hist:<projectId>`
 * for the lifetime of the expansion (collapsing releases the ref and lets the
 * LRU reclaim the rows). Rows render in the exact list-row style of the main
 * list — history is a flat, append-only archive, so no grouping/sort menus.
 */
export function ClosedHistorySection({
	projectId,
	issues,
	statusesById,
	membersById,
	pendingEntityIds
}: ClosedHistorySectionProps) {
	const [expanded, setExpanded] = useState(false)
	// Bumping the nonce remounts the expanded body, which is the scoped-sync
	// error-recovery path: unmount releases, remount re-subscribes fresh.
	const [retryNonce, setRetryNonce] = useState(0)

	const rows = useMemo(() => {
		const nowMs = Date.now()
		return issues
			.filter((i) => i.projectId === projectId && isTier2Issue(i, nowMs))
			.sort((a, b) => Date.parse(b.closedAt ?? '') - Date.parse(a.closedAt ?? ''))
	}, [issues, projectId])

	return (
		<section aria-label={t('tasks.history.show-closed')} className="border-t border-border">
			<button
				type="button"
				aria-expanded={expanded}
				onClick={() => setExpanded((v) => !v)}
				className="flex w-full items-center gap-2 px-4 py-2 text-xs font-semibold uppercase tracking-wide text-muted-foreground hover:bg-accent/30"
			>
				{expanded ? (
					<ChevronDown className="size-3.5" aria-hidden />
				) : (
					<ChevronRight className="size-3.5" aria-hidden />
				)}
				<History className="size-3.5" aria-hidden />
				<span>{expanded ? t('tasks.history.hide-closed') : t('tasks.history.show-closed')}</span>
				{expanded && rows.length > 0 ? <span className="tnum">({rows.length})</span> : null}
			</button>

			{expanded ? (
				<ExpandedHistory
					key={retryNonce}
					projectId={projectId}
					rows={rows}
					statusesById={statusesById}
					membersById={membersById}
					pendingEntityIds={pendingEntityIds}
					onRetry={() => setRetryNonce((n) => n + 1)}
				/>
			) : null}
		</section>
	)
}

function ExpandedHistory({
	projectId,
	rows,
	statusesById,
	membersById,
	pendingEntityIds,
	onRetry
}: {
	readonly projectId: string
	readonly rows: readonly IssueDto[]
	readonly statusesById: ReadonlyMap<string, ProjectStatusDto>
	readonly membersById: ReadonlyMap<string, WorkspaceMemberSummary>
	readonly pendingEntityIds: ReadonlySet<string>
	readonly onRetry: () => void
}) {
	const density = useUiStore((s) => s.density)
	// Mounting subscribes, unmounting releases — the hook owns the ref pairing.
	const { state } = useSyncScope(`issue_hist:${projectId}`)

	const hydrating = state === 'hydrating' || state === 'stale'
	const errored = state === 'error'

	if (hydrating) {
		// Quota-bounded hydration can page for a while on large archives —
		// skeleton rows beat a spinner because they hint at the row shape.
		return (
			<div className="px-4 py-2" role="status" aria-label={t('tasks.history.loading')}>
				{[0, 1, 2].map((n) => (
					<div key={n} className="flex items-center gap-3 py-2">
						<div className="h-3 w-16 animate-pulse rounded bg-accent/60" />
						<div className="h-3 flex-1 animate-pulse rounded bg-accent/40" />
					</div>
				))}
				<p className="pt-1 text-xs text-muted-foreground">{t('tasks.history.loading')}</p>
			</div>
		)
	}

	if (errored) {
		return (
			<div className="flex items-center gap-3 px-4 py-3 text-xs text-muted-foreground">
				<span>{t('tasks.history.error')}</span>
				<Button size="sm" tone="ghost" className="h-6 px-2 text-xs" onClick={onRetry}>
					{t('tasks.history.retry')}
				</Button>
			</div>
		)
	}

	if (rows.length === 0) {
		return (
			<p className={`px-4 text-xs text-muted-foreground ${density === 'compact' ? 'py-1.5' : 'py-2.5'}`}>
				{t('tasks.history.empty')}
			</p>
		)
	}

	return (
		<ul className="divide-y divide-border opacity-80">
			{rows.map((issue) => (
				<IssueRow
					key={issue.id}
					issue={issue}
					depth={0}
					statusesById={statusesById}
					membersById={membersById}
					isPending={pendingEntityIds.has(issue.id)}
				/>
			))}
		</ul>
	)
}
