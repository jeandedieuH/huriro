import type { DocDatabasePropertyDto, DocDatabaseRowDto } from '@huriro/contracts'
import { t } from '@huriro/i18n'
import { useCollectionItems, useSyncEngine, useSyncScope } from '@huriro/sync-client'
import { Stack, useLocalSearchParams } from 'expo-router'
import { Button, Card, Chip } from 'heroui-native'
import { Plus } from 'lucide-react-native'
import { useMemo, useState } from 'react'
import { Pressable, ScrollView, Text, TextInput, View } from 'react-native'
import { Container } from '../../src/components/app/container'
import { EmptyStateCard } from '../../src/components/common/empty-state-card'
import { FlashList } from '../../src/components/common/flash-list'
import { SyncStatusBanner } from '../../src/components/common/sync-status-banner'

function byPosition<T extends { position: string; id: string }>(items: readonly T[]): T[] {
	return [...items].sort((a, b) => a.position.localeCompare(b.position) || a.id.localeCompare(b.id))
}

function cellText(row: DocDatabaseRowDto, property: DocDatabasePropertyDto): string {
	if (property.propType === 'title') return row.title || t('mobile.databases.untitled')
	const cell = row.cells[property.id]
	if (!cell) return ''
	if (cell.text !== null) return cell.text
	if (cell.number !== null) return String(cell.number)
	if (cell.boolean !== null) return cell.boolean ? 'Yes' : 'No'
	if (cell.dateStart !== null) return cell.dateStart.slice(0, 10)
	if (Array.isArray(cell.json)) {
		return cell.json
			.map((item) => {
				if (typeof item === 'string') return item
				if (typeof item === 'object' && item !== null) {
					const record = item as Record<string, unknown>
					return String(record['name'] ?? record['title'] ?? record['filename'] ?? record['id'] ?? '')
				}
				return ''
			})
			.filter(Boolean)
			.join(', ')
	}
	return ''
}

export default function DatabaseDetailScreen() {
	const params = useLocalSearchParams<{ id?: string }>()
	const databaseId = typeof params['id'] === 'string' ? params['id'] : ''
	const engine = useSyncEngine()
	// Tier-2 hydration keeps the embedded relational replica offline-first.
	const scope = useSyncScope(databaseId ? `db:${databaseId}` : null, { pinned: true })
	const databases = useCollectionItems(engine.collections.docDatabases)
	const allProperties = useCollectionItems(engine.collections.docDatabaseProperties)
	const allViews = useCollectionItems(engine.collections.docDatabaseViews)
	const allRows = useCollectionItems(engine.collections.docDatabaseRows)
	const database = databases.find((item) => item.id === databaseId)
	const properties = useMemo(
		() => byPosition(allProperties.filter((item) => item.databaseId === databaseId)),
		[allProperties, databaseId]
	)
	const views = useMemo(
		() => byPosition(allViews.filter((item) => item.databaseId === databaseId)),
		[allViews, databaseId]
	)
	const rows = useMemo(
		() => byPosition(allRows.filter((item) => item.databaseId === databaseId && item.archivedAt === null)),
		[allRows, databaseId]
	)
	const [activeViewId, setActiveViewId] = useState<string | null>(null)
	const activeView = views.find((view) => view.id === activeViewId) ?? views[0]
	const visibleProperties = properties.filter((property) => {
		const hidden = activeView?.config['hiddenPropertyIds']
		return !Array.isArray(hidden) || !hidden.includes(property.id)
	})
	const summaryProperties = visibleProperties.filter((property) => property.propType !== 'title').slice(0, 4)

	const addRow = () => {
		void engine.createDocDatabaseRow(databaseId, { title: '' })
	}

	return (
		<>
			<Stack.Screen
				options={{ headerShown: true, title: database?.title ?? t('mobile.databases.database') }}
			/>
			<Container
				scroll={false}
				padding="none"
				header={
					<>
						<SyncStatusBanner />
						<View className="gap-3 px-4 pt-3 pb-2">
							<View className="flex-row items-center justify-between gap-2">
								<View className="flex-1">
									<Text className="text-xl font-bold">
										{database?.icon} {database?.title ?? t('mobile.databases.database')}
									</Text>
									<Text className="text-xs text-muted">
										{scope.ready
											? t('mobile.databases.rows-count', { count: rows.length })
											: t('mobile.databases.loading')}
									</Text>
								</View>
								<Button size="sm" variant="primary" onPress={addRow}>
									<Plus size={14} color="white" />
									<Button.Label>{t('mobile.databases.row')}</Button.Label>
								</Button>
							</View>
							<ScrollView horizontal showsHorizontalScrollIndicator={false}>
								<View className="flex-row gap-2">
									{views.map((view) => (
										<Pressable key={view.id} onPress={() => setActiveViewId(view.id)}>
											<Chip
												size="sm"
												variant="soft"
												color={view.id === activeView?.id ? 'accent' : 'default'}
											>
												<Chip.Label>{view.name}</Chip.Label>
											</Chip>
										</Pressable>
									))}
								</View>
							</ScrollView>
						</View>
					</>
				}
			>
				<FlashList
					data={rows}
					keyExtractor={(item) => `${item.id}:${item.version}`}
					contentContainerClassName="p-4 pt-2 pb-8"
					renderItem={({ item }) => (
						<DatabaseRowCard
							row={item}
							properties={summaryProperties}
							onRename={(title) => void engine.updateDocDatabaseRow(databaseId, item.id, { title })}
						/>
					)}
					ListEmptyComponent={
						<EmptyStateCard
							icon={<Plus size={22} color="#71717a" />}
							title={scope.ready ? t('mobile.databases.no-rows') : t('mobile.databases.loading-database')}
							description="Rows created here are queued offline and synchronize through the shared outb
ox."
						/>
					}
				/>
			</Container>
		</>
	)
}

function DatabaseRowCard({
	row,
	properties,
	onRename
}: {
	readonly row: DocDatabaseRowDto
	readonly properties: readonly DocDatabasePropertyDto[]
	readonly onRename: (title: string) => void
}) {
	// The row key includes its version, so this draft remounts after sync merges.
	const [draft, setDraft] = useState(row.title)
	return (
		<Card className="mb-3 rounded-2xl border border-border/60 p-4">
			<TextInput
				value={draft}
				onChangeText={setDraft}
				onEndEditing={() => onRename(draft)}
				placeholder={t('mobile.databases.untitled')}
				className="mb-2 border-border/50 border-b pb-1 font-semibold text-base text-foreground"
			/>
			{properties.map((property) => {
				const value = cellText(row, property)
				if (!value) return null
				return (
					<View key={property.id} className="mt-1 flex-row justify-between gap-3">
						<Text className="flex-1 text-muted text-xs">{property.name}</Text>
						<Text className="flex-2 text-right text-xs" numberOfLines={2}>
							{value}
						</Text>
					</View>
				)
			})}
		</Card>
	)
}
