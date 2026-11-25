import type { BulkBeforeDto, BulkIssuePatch, CycleDto, LabelDto, ProjectStatusDto } from '@huriro/contracts'
import { t } from '@huriro/i18n'
import { useSyncEngine } from '@huriro/sync-client'
import { Check, ChevronDown, Trash2, X } from 'lucide-react'
import { useCallback, useState } from 'react'
import { Button } from '@/components/ui/button'
import {
	DropdownMenu,
	DropdownMenuContent,
	DropdownMenuItem,
	DropdownMenuLabel,
	DropdownMenuSeparator,
	DropdownMenuTrigger
} from '@/components/ui/dropdown-menu'
import { useWorkspace } from '@/lib/workspace'
import { useUiStore } from '@/stores/ui-store'

/**
 * Floating bulk-action bar (§3.4) — appears whenever the multi-selection is
 * non-empty. Writes go through `POST /issues/bulk` (server validates one
 * transaction across the whole selection); the response carries the `before`
 * snapshot which the undo toast hands back to `POST /issues/bulk/restore`
 * within the server's undo window (surfaced live in the toast label).
 */
export function BulkActionBar({
	statuses,
	labels,
	cycles
}: {
	readonly statuses: readonly ProjectStatusDto[]
	readonly labels: readonly LabelDto[]
	readonly cycles: readonly CycleDto[]
}) {
	const { api } = useWorkspace()
	const engine = useSyncEngine()
	const selectedIssueIds = useUiStore((s) => s.selectedIssueIds)
	const clearMultiSelect = useUiStore((s) => s.clearMultiSelect)
	const pushToast = useUiStore((s) => s.pushToast)
	const [confirmingDelete, setConfirmingDelete] = useState(false)
	const [busy, setBusy] = useState(false)

	const runBulk = useCallback(
		async (patch: BulkIssuePatch, undoable: boolean) => {
			if (busy || selectedIssueIds.length === 0) return
			setBusy(true)
			try {
				const res = await api.bulkUpdateIssues({ issueIds: [...selectedIssueIds], patch })
				const count = res.data.length
				const isDelete = patch.delete === true
				clearMultiSelect()
				setConfirmingDelete(false)
				const title = isDelete ? t('tasks.bulk.deleted', { count }) : t('tasks.bulk.updated', { count })
				if (undoable && res.before.length > 0) {
					const before: readonly BulkBeforeDto[] = res.before
					const undoWindowMs = res.undoWindowMs
					pushToast({
						title,
						durationMs: undoWindowMs,
						actionLabel: t('common.undo'),
						onAction: () => {
							void api
								.bulkRestoreIssues({
									items: before.map((b) => ({
										issueId: b.issueId,
										expectedVersion: b.version,
										fields: b.fields
									}))
								})
								.catch(() => {
									pushToast({ title: t('tasks.bulk.undo-failed'), tone: 'danger' })
								})
						}
					})
				} else {
					pushToast({ title })
				}
				// Server write wins — the replica converges through the change feed;
				// nudge a pull so the bar reflects the mutation without a visible lag.
				void engine.syncNow()
			} catch {
				pushToast({ title: t('tasks.bulk.failed'), tone: 'danger' })
			} finally {
				setBusy(false)
			}
		},
		[api, busy, clearMultiSelect, engine, pushToast, selectedIssueIds]
	)

	if (selectedIssueIds.length === 0) return null

	return (
		<div
			role="toolbar"
			aria-label={t('tasks.bulk.selected', { count: selectedIssueIds.length })}
			className="fixed bottom-4 left-1/2 z-40 flex -translate-x-1/2 items-center gap-1 rounded-full border border-border bg-popover px-3 py-1.5 shadow-lg"
		>
			<span className="px-1 text-xs font-medium text-muted-foreground tnum">
				{t('tasks.bulk.selected', { count: selectedIssueIds.length })}
			</span>
			<DropdownMenu>
				<DropdownMenuTrigger asChild>
					<Button size="sm" tone="ghost" disabled={busy}>
						{t('tasks.bulk.status')} <ChevronDown className="size-3" aria-hidden />
					</Button>
				</DropdownMenuTrigger>
				<DropdownMenuContent>
					{statuses.map((s) => (
						<DropdownMenuItem key={s.id} onSelect={() => void runBulk({ statusId: s.id }, true)}>
							{s.name}
						</DropdownMenuItem>
					))}
				</DropdownMenuContent>
			</DropdownMenu>
			<DropdownMenu>
				<DropdownMenuTrigger asChild>
					<Button size="sm" tone="ghost" disabled={busy}>
						{t('tasks.bulk.priority')} <ChevronDown className="size-3" aria-hidden />
					</Button>
				</DropdownMenuTrigger>
				<DropdownMenuContent>
					{[0, 1, 2, 3, 4].map((p) => (
						<DropdownMenuItem key={p} onSelect={() => void runBulk({ priority: p }, true)}>
							{t(`tasks.priority.${p}` as never)}
						</DropdownMenuItem>
					))}
				</DropdownMenuContent>
			</DropdownMenu>
			<DropdownMenu>
				<DropdownMenuTrigger asChild>
					<Button size="sm" tone="ghost" disabled={busy}>
						{t('tasks.bulk.labels')} <ChevronDown className="size-3" aria-hidden />
					</Button>
				</DropdownMenuTrigger>
				<DropdownMenuContent>
					<DropdownMenuLabel>{t('tasks.bulk.add-label')}</DropdownMenuLabel>
					{labels.map((l) => (
						<DropdownMenuItem
							key={`add-${l.id}`}
							onSelect={() => void runBulk({ addLabelIds: [l.id] }, true)}
						>
							{l.name}
						</DropdownMenuItem>
					))}
					<DropdownMenuSeparator />
					<DropdownMenuLabel>{t('tasks.bulk.remove-label')}</DropdownMenuLabel>
					{labels.map((l) => (
						<DropdownMenuItem
							key={`rm-${l.id}`}
							onSelect={() => void runBulk({ removeLabelIds: [l.id] }, true)}
						>
							{l.name}
						</DropdownMenuItem>
					))}
				</DropdownMenuContent>
			</DropdownMenu>
			{cycles.length > 0 ? (
				<DropdownMenu>
					<DropdownMenuTrigger asChild>
						<Button size="sm" tone="ghost" disabled={busy}>
							{t('tasks.bulk.cycle')} <ChevronDown className="size-3" aria-hidden />
						</Button>
					</DropdownMenuTrigger>
					<DropdownMenuContent>
						<DropdownMenuItem onSelect={() => void runBulk({ cycleId: null }, true)}>
							{t('tasks.bulk.no-cycle')}
						</DropdownMenuItem>
						{cycles.map((c) => (
							<DropdownMenuItem key={c.id} onSelect={() => void runBulk({ cycleId: c.id }, true)}>
								{c.name}
							</DropdownMenuItem>
						))}
					</DropdownMenuContent>
				</DropdownMenu>
			) : null}
			{/* Destructive bulk delete is a two-step confirm inside the bar itself —
			    no modal, the undo toast is the safety net (§3.4). */}
			{confirmingDelete ? (
				<Button
					size="sm"
					tone="destructive"
					disabled={busy}
					onClick={() => void runBulk({ delete: true }, true)}
				>
					<Check className="size-3" aria-hidden /> {t('tasks.bulk.confirm-delete')}
				</Button>
			) : (
				<Button size="sm" tone="ghost" disabled={busy} onClick={() => setConfirmingDelete(true)}>
					<Trash2 className="size-3" aria-hidden /> {t('tasks.bulk.delete')}
				</Button>
			)}
			<Button
				size="sm"
				tone="ghost"
				aria-label={t('common.close')}
				onClick={() => {
					clearMultiSelect()
					setConfirmingDelete(false)
				}}
			>
				<X className="size-3" aria-hidden />
			</Button>
		</div>
	)
}
