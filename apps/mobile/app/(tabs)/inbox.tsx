import type { MailConversationDto, NotificationDto } from '@huriro/contracts'
import { t } from '@huriro/i18n'
import { useCollectionItems, useSyncEngine } from '@huriro/sync-client'
import { useRouter } from 'expo-router'
import { Card, Chip } from 'heroui-native'
import { BellOff, Mail } from 'lucide-react-native'
import { useEffect, useState } from 'react'
import { Pressable, Text, View } from 'react-native'
import { Container } from '../../src/components/app/container'
import { EmptyStateCard } from '../../src/components/common/empty-state-card'
import { FlashList } from '../../src/components/common/flash-list'
import { SyncStatusBanner } from '../../src/components/common/sync-status-banner'
import { NotificationRow } from '../../src/components/inbox/notification-row'
import { resolvePushHintTarget } from '../../src/lib/push'
import { useMobileRuntime } from '../../src/lib/runtime-context'
import { useHuriroColors } from '../../src/lib/theme'

export default function InboxTabScreen() {
	const router = useRouter()
	const engine = useSyncEngine()
	const { runtime } = useMobileRuntime()
	const colors = useHuriroColors()
	const [tab, setTab] = useState<'activity' | 'mail'>('activity')
	const [filter, setFilter] = useState<'all' | 'unread'>('all')
	const [conversations, setConversations] = useState<MailConversationDto[]>([])

	const allNotifications = useCollectionItems(engine.collections.notifications).filter(
		(n) => n.archivedAt === null
	)
	const notifications =
		filter === 'unread' ? allNotifications.filter((n) => n.readAt === null) : allNotifications

	useEffect(() => {
		if (tab !== 'mail' || !runtime) return
		if (runtime.isPreview) {
			const now = new Date().toISOString()
			setConversations([
				{
					id: '0190a0b1-0000-7000-8000-000000000701',
					workspaceId: engine.workspaceId,
					inboxId: '0190a0b1-0000-7000-8000-000000000702',
					accountId: '0190a0b1-0000-7000-8000-000000000703',
					subject: 'Enterprise SSO onboarding question',
					status: 'open',
					assigneeId: engine.currentUserId,
					assigneeName: 'Owner',
					snoozedUntil: null,
					mergedIntoId: null,
					lastMessageAt: now,
					firstReplyAt: null,
					customerEmail: 'customer@acme.example',
					contactId: null,
					followUpAt: null,
					followUpCondition: null,
					slaNextDueAt: null,
					slaBreachedAt: null,
					priority: 'high',
					tagIds: [],
					snippet: 'Can we test SAML metadata upload on staging today?',
					messageCount: 1,
					createdAt: now,
					updatedAt: now,
					version: 1
				}
			])
			return
		}
		let cancelled = false
		void runtime.api
			.listMailConversations()
			.then((res) => {
				if (!cancelled) setConversations(res.data)
			})
			.catch(() => {})
		return () => {
			cancelled = true
		}
	}, [tab, runtime, engine.workspaceId, engine.currentUserId])

	function handleOpenNotification(item: NotificationDto) {
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
							variant={tab === 'activity' ? 'primary' : 'soft'}
							color={tab === 'activity' ? 'accent' : 'default'}
							onPress={() => setTab('activity')}
						>
							<Chip.Label>{t('mobile.inbox.tab.activity')}</Chip.Label>
						</Chip>
						<Chip
							size="sm"
							variant={tab === 'mail' ? 'primary' : 'soft'}
							color={tab === 'mail' ? 'accent' : 'default'}
							onPress={() => setTab('mail')}
						>
							<Mail size={12} color={tab === 'mail' ? colors.accentForeground : colors.muted} />
							<Chip.Label>{t('mobile.inbox.tab.mail')}</Chip.Label>
						</Chip>
					</View>

					{tab === 'activity' ? (
						<View className="flex-row items-center gap-2 px-4 pt-2 pb-1">
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
					) : null}
				</>
			}
		>
			{tab === 'activity' ? (
				<FlashList
					data={notifications}
					keyExtractor={(item) => item.id}
					contentContainerClassName="p-4 pt-2 pb-8"
					renderItem={({ item }) => <NotificationRow notification={item} onPress={handleOpenNotification} />}
					ListEmptyComponent={
						<EmptyStateCard
							icon={<BellOff size={22} color={colors.muted} />}
							title={t('inbox.empty')}
							description={t('mobile.inbox.activity-description')}
						/>
					}
				/>
			) : (
				<FlashList
					data={conversations}
					keyExtractor={(item) => item.id}
					contentContainerClassName="p-4 pt-2 pb-8"
					renderItem={({ item }) => (
						<Pressable onPress={() => router.push(`/mail/${item.id}` as never)} accessibilityRole="button">
							<Card className="mb-3 p-4 rounded-2xl border border-border/60 gap-1.5">
								<View className="flex-row items-center justify-between gap-2">
									<Text className="text-sm font-semibold text-foreground flex-1" numberOfLines={1}>
										{item.subject}
									</Text>
									<Chip size="sm" variant="soft" color={item.status === 'closed' ? 'default' : 'accent'}>
										<Chip.Label>{item.status}</Chip.Label>
									</Chip>
								</View>
								{item.customerEmail ? <Text className="text-xs text-muted">{item.customerEmail}</Text> : null}
								<Text className="text-xs text-foreground/80" numberOfLines={2}>
									{item.snippet}
								</Text>
								{item.slaBreachedAt ? (
									<Chip size="sm" variant="soft" color="warning">
										<Chip.Label>{t('mail.sla.breached')}</Chip.Label>
									</Chip>
								) : null}
							</Card>
						</Pressable>
					)}
					ListEmptyComponent={
						<EmptyStateCard
							icon={<Mail size={22} color={colors.muted} />}
							title={t('mobile.inbox.tab.mail')}
							description={t('mobile.mail.no-conversations')}
						/>
					}
				/>
			)}
		</Container>
	)
}
