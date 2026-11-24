import type { NotificationDto } from '@huriro/contracts'
import { t } from '@huriro/i18n'
import { useCollectionItems, useSyncEngine } from '@huriro/sync-client'
import { useRouter } from 'expo-router'
import { Chip } from 'heroui-native'
import { BellOff } from 'lucide-react-native'
import { useState } from 'react'
import { View } from 'react-native'
import { Container } from '../../src/components/app/container'
import { EmptyStateCard } from '../../src/components/common/empty-state-card'
import { FlashList } from '../../src/components/common/flash-list'
import { SyncStatusBanner } from '../../src/components/common/sync-status-banner'
import { NotificationRow } from '../../src/components/inbox/notification-row'
import { resolvePushHintTarget } from '../../src/lib/push'

export default function InboxTabScreen() {
	const router = useRouter()
	const engine = useSyncEngine()
	const [filter, setFilter] = useState<'all' | 'unread'>('all')
	const allNotifications = useCollectionItems(engine.collections.notifications).filter(
		(n) => n.archivedAt === null
	)
	const notifications =
		filter === 'unread' ? allNotifications.filter((n) => n.readAt === null) : allNotifications

	function handleOpen(item: NotificationDto) {
		const target = resolvePushHintTarget({
			entityType: item.entityType,
			entityId: item.entityId
		})
		if (target) router.push(target.href as never)
	}

	return (
		<Container
			scroll={false}
			padding="none"
			header={
				<>
					<SyncStatusBanner />
					<View className="flex-row items-center gap-2 px-4 pt-3 pb-1">
						<Chip
							size="sm"
							variant={filter === 'all' ? 'primary' : 'soft'}
							color={filter === 'all' ? 'accent' : 'default'}
							onPress={() => setFilter('all')}
						>
							<Chip.Label>All ({allNotifications.length})</Chip.Label>
						</Chip>
						<Chip
							size="sm"
							variant={filter === 'unread' ? 'primary' : 'soft'}
							color={filter === 'unread' ? 'accent' : 'default'}
							onPress={() => setFilter('unread')}
						>
							<Chip.Label>Unread ({allNotifications.filter((n) => n.readAt === null).length})</Chip.Label>
						</Chip>
					</View>
				</>
			}
		>
			<FlashList
				data={notifications}
				keyExtractor={(item) => item.id}
				contentContainerClassName="p-4 pt-2 pb-8"
				renderItem={({ item }) => <NotificationRow notification={item} onPress={handleOpen} />}
				ListEmptyComponent={
					<EmptyStateCard
						icon={<BellOff size={22} color="#71717a" />}
						title={t('inbox.empty')}
						description="Activity across issues, docs, chat, and mail will appear here."
					/>
				}
			/>
		</Container>
	)
}
