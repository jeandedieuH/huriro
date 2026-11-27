import { t } from '@huriro/i18n'
import { useSyncEngine, useSyncStatus } from '@huriro/sync-client'
import { Chip } from 'heroui-native'
import { AlertTriangle, RefreshCw, Wifi, WifiOff } from 'lucide-react-native'
import { Pressable, Text, View } from 'react-native'
import { useHuriroColors } from '../../lib/theme'

export function SyncStatusBanner() {
	const engine = useSyncEngine()
	const status = useSyncStatus()
	const colors = useHuriroColors()
	const isHealthy =
		status.online &&
		status.pendingCount === 0 &&
		!status.lastError &&
		status.conflictCount === 0 &&
		!status.revokedReason

	if (isHealthy) return null

	if (status.revokedReason) {
		return (
			<View className="flex-row items-center gap-2 px-4 py-2 bg-danger-soft border-b border-danger/30">
				<AlertTriangle size={14} color={colors.danger} />
				<Text className="text-xs font-medium text-danger flex-1">{t('sync.revoked')}</Text>
			</View>
		)
	}

	const summaryText = !status.online
		? t('mobile.sync.offline', { count: status.pendingCount })
		: status.lastError
			? status.lastError
			: status.conflictCount > 0
				? t(status.conflictCount === 1 ? 'sync.conflict.banner' : 'sync.conflict.banner.plural', {
						count: status.conflictCount
					})
				: t('sync.pending', { count: status.pendingCount })

	return (
		<View className="flex-row items-center justify-between px-4 py-2 bg-surface border-b border-border/50">
			<View className="flex-row items-center gap-2 flex-1 pr-2">
				{!status.online ? (
					<WifiOff size={14} color={colors.warning} />
				) : status.lastError || status.conflictCount > 0 ? (
					<AlertTriangle size={14} color={colors.danger} />
				) : (
					<Wifi size={14} color={colors.success} />
				)}
				<Text className="text-xs font-medium text-foreground flex-1" numberOfLines={1}>
					{summaryText}
				</Text>
			</View>

			<View className="flex-row items-center gap-2">
				{status.pendingCount > 0 ? (
					<Chip
						size="sm"
						variant="soft"
						color="warning"
						onPress={() => {
							if (status.online) void engine.flushOutbox({ force: true }).then(() => engine.syncNow())
						}}
					>
						{status.syncing ? <RefreshCw size={11} color={colors.warning} /> : null}
						<Chip.Label>{`${status.pendingCount} queued`}</Chip.Label>
					</Chip>
				) : null}
				{status.lastError && status.online ? (
					<Chip
						size="sm"
						variant="soft"
						color="danger"
						onPress={() => void engine.flushOutbox({ force: true }).then(() => engine.syncNow())}
					>
						<RefreshCw size={11} color={colors.danger} />
						<Chip.Label>{t('error.retry')}</Chip.Label>
					</Chip>
				) : null}
				{!status.online ? (
					<Pressable
						onPress={() => engine.setOnline(true)}
						accessibilityRole="button"
						className="px-2 py-0.5 rounded bg-accent-soft"
					>
						<Text className="text-[11px] font-semibold text-accent">Reconnect</Text>
					</Pressable>
				) : null}
			</View>
		</View>
	)
}
