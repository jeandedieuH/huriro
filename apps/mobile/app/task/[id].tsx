import { t } from '@huriro/i18n'
import { useCollectionItems, useSyncEngine } from '@huriro/sync-client'
import { Stack, useLocalSearchParams } from 'expo-router'
import { Button, Card, Chip } from 'heroui-native'
import { CheckSquare } from 'lucide-react-native'
import { Text, View } from 'react-native'
import { Container } from '../../src/components/app/container'
import { EmptyStateCard } from '../../src/components/common/empty-state-card'

export default function IssueDetailScreen() {
	const params = useLocalSearchParams<{ id?: string }>()
	const id = typeof params['id'] === 'string' ? params['id'] : ''
	const engine = useSyncEngine()
	const issues = useCollectionItems(engine.collections.issues)
	const statuses = useCollectionItems(engine.collections.projectStatuses)
	const issue = issues.find((i) => i.id === id || i.identifier === id)

	const projectStatuses = issue ? statuses.filter((s) => s.projectId === issue.projectId) : []
	const currentStatus = projectStatuses.find((s) => s.id === issue?.statusId)

	async function handleMoveStatus(statusId: string) {
		if (!issue) return
		await engine.updateIssue(issue.id, { statusId })
	}

	return (
		<>
			<Stack.Screen
				options={{ headerShown: true, title: issue?.identifier ?? t('mobile.tasks.detail-fallback') }}
			/>
			<Container>
				{issue ? (
					<>
						<Card className="p-4 rounded-2xl border border-border/60 gap-2">
							<View className="flex-row items-center justify-between">
								<Text className="text-xs font-mono font-semibold text-muted">{issue.identifier}</Text>
								<Chip size="sm" variant="soft" color="accent">
									<Chip.Label>{currentStatus?.name ?? 'Open'}</Chip.Label>
								</Chip>
							</View>
							<Card.Title className="text-lg font-bold">{issue.title}</Card.Title>
							{issue.descriptionText ? (
								<Card.Description className="text-sm mt-1">{issue.descriptionText}</Card.Description>
							) : null}
						</Card>

						{projectStatuses.length > 0 ? (
							<Card className="p-4 rounded-2xl border border-border/60 gap-2.5">
								<Card.Title className="text-sm font-semibold">Move Status</Card.Title>
								<View className="flex-row flex-wrap gap-2">
									{projectStatuses.map((st) => (
										<Button
											key={st.id}
											size="sm"
											variant={st.id === issue.statusId ? 'primary' : 'secondary'}
											onPress={() => void handleMoveStatus(st.id)}
										>
											<Button.Label>{st.name}</Button.Label>
										</Button>
									))}
								</View>
							</Card>
						) : null}
					</>
				) : (
					<EmptyStateCard
						icon={<CheckSquare size={22} color="#71717a" />}
						title={t('mobile.tasks.unavailable-title')}
						description={t('mobile.tasks.unavailable-description', { id })}
					/>
				)}
			</Container>
		</>
	)
}
