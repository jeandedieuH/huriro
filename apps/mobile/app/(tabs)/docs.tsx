import { useCollectionItems, useSyncEngine } from '@huriro/sync-client'
import { useRouter } from 'expo-router'
import { Card, Chip, SearchField } from 'heroui-native'
import { ChevronRight, FileText, Star } from 'lucide-react-native'
import { useMemo, useState } from 'react'
import { Pressable, Text, View } from 'react-native'
import { Container } from '../../src/components/app/container'
import { EmptyStateCard } from '../../src/components/common/empty-state-card'
import { FlashList } from '../../src/components/common/flash-list'
import { SyncStatusBanner } from '../../src/components/common/sync-status-banner'
import { useHuriroColors } from '../../src/lib/theme'

export default function DocsTabScreen() {
	const router = useRouter()
	const engine = useSyncEngine()
	const colors = useHuriroColors()
	const pages = useCollectionItems(engine.collections.docPages).filter((d) => d.archivedAt === null)
	const [query, setQuery] = useState('')

	const filtered = useMemo(() => {
		const q = query.trim().toLowerCase()
		if (!q) return pages
		return pages.filter((p) => p.title.toLowerCase().includes(q) || p.slug.toLowerCase().includes(q))
	}, [pages, query])

	return (
		<Container
			scroll={false}
			padding="none"
			header={
				<>
					<SyncStatusBanner />
					<View className="px-4 pt-3">
						<SearchField value={query} onChange={setQuery}>
							<SearchField.Group>
								<SearchField.SearchIcon />
								<SearchField.Input placeholder="Search workspace docs…" />
								<SearchField.ClearButton />
							</SearchField.Group>
						</SearchField>
						<Pressable
							onPress={() => router.push('/databases' as never)}
							accessibilityRole="button"
							className="mt-2 self-start rounded-full bg-accent px-3 py-1.5"
						>
							<Text className="font-medium text-accent-foreground text-xs">Databases</Text>
						</Pressable>
					</View>
				</>
			}
		>
			<FlashList
				data={filtered}
				keyExtractor={(item) => item.id}
				contentContainerClassName="p-4 pt-3 pb-8"
				renderItem={({ item }) => (
					<Pressable onPress={() => router.push(`/doc/${item.slug}` as never)} accessibilityRole="button">
						<Card className="mb-3 p-4 rounded-2xl border border-border/60">
							<View className="flex-row items-center justify-between gap-2">
								<View className="flex-row items-center gap-2 flex-1">
									<FileText size={16} color={colors.accent} />
									<Card.Title className="text-sm font-semibold flex-1" numberOfLines={1}>
										{item.title}
									</Card.Title>
								</View>
								<View className="flex-row items-center gap-1.5">
									{item.isFavorite ? <Star size={14} color={colors.warning} /> : null}
									<ChevronRight size={15} color={colors.muted} />
								</View>
							</View>

							<View className="flex-row items-center justify-between mt-2">
								<Text className="text-xs font-mono text-muted">/{item.slug}</Text>
								<Chip size="sm" variant="soft" color="default">
									<Chip.Label>{item.byteSize} B</Chip.Label>
								</Chip>
							</View>
						</Card>
					</Pressable>
				)}
				ListEmptyComponent={
					<EmptyStateCard
						icon={<FileText size={22} color={colors.muted} />}
						title="No documents matched"
						description="Documents synced into SQLite appear here for offline reading and light edits."
					/>
				}
			/>
		</Container>
	)
}
