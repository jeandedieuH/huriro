import { useCollectionItems, useSyncEngine } from '@huriro/sync-client'
import { useRouter } from 'expo-router'
import { Button, Card, Chip, Input, SearchField, TextField } from 'heroui-native'
import { CheckSquare, Plus } from 'lucide-react-native'
import { useMemo, useState } from 'react'
import { View } from 'react-native'
import { Container } from '../../src/components/app/container'
import { EmptyStateCard } from '../../src/components/common/empty-state-card'
import { FlashList } from '../../src/components/common/flash-list'
import { SyncStatusBanner } from '../../src/components/common/sync-status-banner'
import { IssueCard } from '../../src/components/issues/issue-card'

export default function IssuesTabScreen() {
	const router = useRouter()
	const engine = useSyncEngine()
	const issues = useCollectionItems(engine.collections.issues).filter((i) => i.deletedAt === null)
	const projects = useCollectionItems(engine.collections.projects)
	const statuses = useCollectionItems(engine.collections.projectStatuses)

	const [search, setSearch] = useState('')
	const [priorityFilter, setPriorityFilter] = useState<'all' | 'high'>('all')
	const [draftTitle, setDraftTitle] = useState('')
	const [creating, setCreating] = useState(false)

	const statusMap = useMemo(() => new Map(statuses.map((s) => [s.id, s.name])), [statuses])

	const filtered = useMemo(() => {
		const q = search.trim().toLowerCase()
		return issues.filter((item) => {
			if (priorityFilter === 'high' && item.priority > 2) return false
			if (q && !item.title.toLowerCase().includes(q) && !item.identifier.toLowerCase().includes(q)) {
				return false
			}
			return true
		})
	}, [issues, priorityFilter, search])

	async function handleAddIssue() {
		const title = draftTitle.trim()
		const project = projects[0]
		if (!title || !project || creating) return
		setCreating(true)
		try {
			await engine.createIssue({
				projectId: project.id,
				title,
				priority: 2
			})
			setDraftTitle('')
		} finally {
			setCreating(false)
		}
	}

	return (
		<Container
			scroll={false}
			padding="none"
			header={
				<>
					<SyncStatusBanner />
					<View className="px-4 pt-3 gap-2.5">
						<SearchField value={search} onChange={setSearch}>
							<SearchField.Group>
								<SearchField.SearchIcon />
								<SearchField.Input placeholder="Filter issues or identifiers…" />
								<SearchField.ClearButton />
							</SearchField.Group>
						</SearchField>

						<Card className="p-3 rounded-2xl border border-border/60">
							<View className="flex-row items-center gap-2">
								<TextField className="flex-1">
									<Input
										value={draftTitle}
										onChangeText={setDraftTitle}
										placeholder="Quick issue title…"
										onSubmitEditing={() => void handleAddIssue()}
									/>
								</TextField>
								<Button
									size="sm"
									variant="primary"
									isDisabled={!draftTitle.trim() || creating}
									onPress={() => void handleAddIssue()}
								>
									<Plus size={15} color="#ffffff" />
									<Button.Label>Add Issue</Button.Label>
								</Button>
							</View>
						</Card>

						<View className="flex-row items-center gap-2">
							<Chip
								size="sm"
								variant={priorityFilter === 'all' ? 'primary' : 'soft'}
								color={priorityFilter === 'all' ? 'accent' : 'default'}
								onPress={() => setPriorityFilter('all')}
							>
								<Chip.Label>All ({issues.length})</Chip.Label>
							</Chip>
							<Chip
								size="sm"
								variant={priorityFilter === 'high' ? 'primary' : 'soft'}
								color={priorityFilter === 'high' ? 'warning' : 'default'}
								onPress={() => setPriorityFilter('high')}
							>
								<Chip.Label>Urgent & High</Chip.Label>
							</Chip>
						</View>
					</View>
				</>
			}
		>
			<FlashList
				data={filtered}
				keyExtractor={(item) => item.id}
				contentContainerClassName="p-4 pt-3 pb-8"
				renderItem={({ item }) => (
					<IssueCard
						issue={item}
						statusName={statusMap.get(item.statusId)}
						onPress={(issue) => router.push(`/issue/${issue.id}` as never)}
					/>
				)}
				ListEmptyComponent={
					<EmptyStateCard
						icon={<CheckSquare size={22} color="#71717a" />}
						title="No matching issues"
						description="Create one above — offline issues queue safely in SQLite until reconnected."
					/>
				}
			/>
		</Container>
	)
}
