import { t } from '@huriro/i18n'
import { useSyncConflicts, useSyncEngine, useSyncStatus } from '@huriro/sync-client'
import { AlertTriangle, CloudOff, RefreshCw } from 'lucide-react'
import { useEffect, useState } from 'react'
import { Button } from '@/components/ui/button'
import { useUiStore } from '@/stores/ui-store'

/**
 * Contextual sync status / offline / conflict indicator (§9.6, §17.8).
 * Invisible when healthy; surfaces only offline, error, conflict, memory
 * fallback, or slow (> 1.5 s) sync states without ever blocking local reads.
 */
export function SyncStatusBanner() {
	const engine = useSyncEngine()
	const status = useSyncStatus()
	const conflicts = useSyncConflicts()
	const setConflictDialogOpen = useUiStore((s) => s.setConflictDialogOpen)
	const [showSlowSync, setShowSlowSync] = useState(false)

	useEffect(() => {
		if (!status.syncing) {
			setShowSlowSync(false)
			return
		}
		const timer = setTimeout(() => setShowSlowSync(true), 1_500)
		return () => clearTimeout(timer)
	}, [status.syncing])

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

	const needsBanner =
		!status.online ||
		status.pendingCount > 0 ||
		Boolean(status.lastError) ||
		conflicts.length > 0 ||
		status.storageDegraded

	if (!needsBanner) {
		if (!showSlowSync) return null
		return (
			<div
				role="status"
				aria-label={t('sync.syncing')}
				className="h-0.5 w-full overflow-hidden bg-primary/20"
			>
				<div className="h-full w-1/3 animate-pulse bg-primary motion-reduce:animate-none" />
			</div>
		)
	}

	return (
		<div className="flex flex-wrap items-center gap-3 border-b border-border bg-surface-2/60 px-4 py-1 text-xs">
			{!status.online ? (
				<span className="inline-flex items-center gap-1.5 text-muted-foreground">
					<CloudOff className="size-3.5 text-(--warning)" aria-hidden />
					<span className="font-medium text-foreground">{t('sync.offline')}</span>
					<span>· {t('sync.offline.hint')}</span>
				</span>
			) : status.syncing ? (
				<span className="inline-flex items-center gap-1.5 text-muted-foreground">
					<RefreshCw className="size-3.5 animate-spin text-(--info) motion-reduce:animate-none" aria-hidden />
					<span>{t('sync.syncing')}</span>
				</span>
			) : null}

			{status.pendingCount > 0 ? (
				<span className="font-mono text-(--warning) tnum">
					{t('sync.pending', { count: status.pendingCount })}
				</span>
			) : null}

			{status.lastError ? (
				<div className="flex items-center gap-2 text-destructive">
					<span
						role="status"
						title={status.lastError}
						className="inline-flex max-w-md items-center gap-1.5 truncate"
					>
						<AlertTriangle className="size-3.5 shrink-0" aria-hidden />
						<span className="truncate">{status.lastError}</span>
					</span>
					{status.online ? (
						<Button
							size="sm"
							tone="outline"
							className="h-6 px-2 text-xs"
							onClick={() => void engine.flushOutbox({ force: true }).then(() => engine.syncNow())}
						>
							{t('error.retry')}
						</Button>
					) : null}
				</div>
			) : null}

			{status.storageDegraded ? (
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
		</div>
	)
}
