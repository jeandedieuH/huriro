import { t } from '@huriro/i18n'
import { useCollectionItems, useSyncEngine } from '@huriro/sync-client'
import { useRouter } from 'expo-router'
import { Card, Chip } from 'heroui-native'
import { ChevronRight, Database } from 'lucide-react-native'
import { useMemo } from 'react'
import { Pressable, Text, View } from 'react-native'
import { Container } from '../../src/components/app/container'
import { EmptyStateCard } from '../../src/components/common/empty-state-card'
import { FlashList } from '../../src/components/common/flash-list'
import { SyncStatusBanner } from '../../src/components/common/sync-status-banner'
import { useHuriroColors } from '../../src/lib/theme'

export default function DatabasesIndexScreen() {
	const router = useRouter()
	const engine = useSyncEngine()
	const colors = useHuriroColors()
	const databases = useCollectionItems(engine.collections.docDatabases)
	const rows = useCollectionItems(engine.collections.docDatabaseRows)
	const rowCounts = useMemo(() => {
		const counts = new Map<string, number>()
		for (const row of rows) {
			if (row.archivedAt === null) counts.set(row.databaseId, (counts.get(row.databaseId) ?? 0) + 1)
		}
		return counts
	}, [rows])
	const visible = databases.filter((database) => !database.isInline)

	return (
		<Container
			scroll={false}
			padding="none"
			header={
				<>
					<SyncStatusBanner />
					<View className="px-4 pt-3 pb-1">
						<Text className="text-xl font-bold text-foreground">{t('mobile.databases.title')}</Text>
						<Text className="text-xs text-muted">{t('mobile.databases.subtitle')}</Text>
					</View>
				</>
			}
		>
			<FlashList
				data={visible}
				keyExtractor={(item) => item.id}
				contentContainerClassName="p-4 pt-2 pb-8"
				renderItem={({ item }) => (
					<Pressable onPress={() => router.push(`/databases/${item.id}` as never)} accessibilityRole="button">
						<Card className="mb-3 rounded-2xl border border-border/60 p-4">
							<View className="flex-row items-center justify-between gap-2">
								<View className="flex-1 flex-row items-center gap-2">
									<Database size={16} color={colors.accent} />
									<Card.Title className="flex-1 text-sm font-semibold" numberOfLines={1}>
										{item.icon} {item.title}
									</Card.Title>
								</View>
								<ChevronRight size={15} color={colors.muted} />
							</View>
							<View className="mt-2 flex-row items-center justify-between">
								<Text className="text-xs text-muted">
									{item.isInline ? t('mobile.databases.inline') : t('mobile.databases.full-page')}
								</Text>
								<Chip size="sm" variant="soft" color="default">
									<Chip.Label>
										{t('mobile.databases.rows-count', { count: rowCounts.get(item.id) ?? 0 })}
									</Chip.Label>
								</Chip>
							</View>
						</Card>
					</Pressable>
				)}
				ListEmptyComponent={
					<EmptyStateCard
						icon={<Database size={22} color={colors.muted} />}
						title={t('mobile.databases.empty-title')}
						description={t('mobile.databases.empty-description')}
					/>
				}
			/>
		</Container>
	)
}
