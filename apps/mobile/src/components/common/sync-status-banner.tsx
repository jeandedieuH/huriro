import { t } from '@huriro/i18n'
import { useSyncEngine, useSyncStatus } from '@huriro/sync-client'
import { Chip } from 'heroui-native'
import { RefreshCw, Wifi, WifiOff } from 'lucide-react-native'
import { Pressable, Text, View } from 'react-native'

export function SyncStatusBanner() {
	const engine = useSyncEngine()
	const status = useSyncStatus()
	const isOfflineOrQueued = !status.online || status.pendingCount > 0

	return (
		<View className="flex-row items-center justify-between px-4 py-2 bg-surface border-b border-border/50">
			<View className="flex-row items-center gap-2 flex-1">
				{status.online ? <Wifi size={14} color="#16a34a" /> : <WifiOff size={14} color="#d97706" />}
				<Text className="text-xs font-medium text-foreground" numberOfLines={1}>
					{isOfflineOrQueued
						? t('mobile.sync.offline', { count: status.pendingCount })
						: t('mobile.sync.synced', { mode: status.storageMode.toUpperCase() })}
				</Text>
			</View>

			<View className="flex-row items-center gap-2">
				<Chip
					size="sm"
					variant="soft"
					color={isOfflineOrQueued ? 'warning' : 'success'}
					onPress={() => {
						if (status.online) void engine.syncNow()
					}}
				>
					{status.syncing ? <RefreshCw size={11} /> : null}
					<Chip.Label>
						{status.pendingCount > 0 ? `${status.pendingCount} queued` : status.storageMode}
					</Chip.Label>
				</Chip>
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
