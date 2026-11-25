import { t } from '@huriro/i18n'
import { useSyncConflicts, useSyncEngine, useSyncStatus } from '@huriro/sync-client'
import { AlertTriangle, CheckCircle2, CloudOff, RefreshCw } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { useUiStore } from '@/stores/ui-store'

/**
 * Persistent top sync status / offline / conflict indicator (§9.6, §17.8).
 * Never shows a modal loading blocker — local replica renders immediately.
 */
export function SyncStatusBanner() {
	const engine = useSyncEngine()
	const status = useSyncStatus()
	const conflicts = useSyncConflicts()
	const setConflictDialogOpen = useUiStore((s) => s.setConflictDialogOpen)

	if (status.revokedReason) {
		return (
			<div
				role="alert"
				className="flex items-center justify-between border-b border-destructive/40 bg-destructive/10 px-4 py-1.5 text-xs text-destructive"
			>
				<span className="flex items-center gap-2 font-medium">
					<AlertTriangle className="size-3.5" aria-hidden />
					<span>{t('sync.revoked')}</span>
				</span>
			</div>
		)
	}

	return (
		<div className="flex flex-wrap items-center gap-3 border-b border-border bg-surface-2/60 px-4 py-1 text-xs">
			<span className="inline-flex items-center gap-1.5 text-muted-foreground">
				{!status.online ? (
					<>
						<CloudOff className="size-3.5 text-(--warning)" aria-hidden />
						<span className="font-medium text-foreground">{t('sync.offline')}</span>
					</>
				) : status.syncing ? (
					<>
						<RefreshCw className="size-3.5 animate-spin text-(--info)" aria-hidden />
						<span>{t('sync.syncing')}</span>
					</>
				) : (
					<>
						<CheckCircle2 className="size-3.5 text-(--success)" aria-hidden />
						<span>{t('sync.online')}</span>
					</>
				)}
			</span>

			{status.pendingCount > 0 ? (
				<span className="font-mono text-(--warning) tnum">
					{t('sync.pending', { count: status.pendingCount })}
				</span>
			) : null}

			{status.lastError ? (
				<span
					role="status"
					title={status.lastError}
					className="inline-flex max-w-md items-center gap-1.5 truncate text-destructive"
				>
					<AlertTriangle className="size-3.5 shrink-0" aria-hidden />
					<span className="truncate">{status.lastError}</span>
				</span>
			) : null}

			{status.storageMode === 'memory' ? (
				<span className="text-muted-foreground">{t('sync.memory-fallback')}</span>
			) : null}

			{conflicts.length > 0 ? (
				<div className="flex items-center gap-2 text-destructive">
					<AlertTriangle className="size-3.5" aria-hidden />
					<span className="font-medium">
						{t(conflicts.length === 1 ? 'sync.conflict.banner' : 'sync.conflict.banner.plural', {
							count: conflicts.length
						})}
					</span>
					<Button
						size="sm"
						tone="outline"
						className="h-6 px-2 text-xs"
						onClick={() => setConflictDialogOpen(true)}
					>
						{t('sync.resolve')}
					</Button>
				</div>
			) : null}

			{status.online ? (
				<Button
					size="sm"
					tone="ghost"
					className="ml-auto h-6 px-2 text-xs"
					onClick={() => void engine.flushOutbox({ force: true }).then(() => engine.resyncSnapshot())}
				>
					{t('sync.sync-now')}
				</Button>
			) : null}
		</div>
	)
}
