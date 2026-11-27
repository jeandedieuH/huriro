import type {
	ChatChannelDto,
	ChatMessageDto,
	ChatSavedItemDto,
	UpdateUserStatusBody,
	UserAvailabilityDto,
	UserWorkspaceProfileDto
} from '@huriro/contracts'
import { t } from '@huriro/i18n'
import { generateUuidV7, useSyncEngine } from '@huriro/sync-client'
import { useRouter } from 'expo-router'
import { Avatar, Button, Card, Chip } from 'heroui-native'
import { Bookmark, ExternalLink, Hash, MessageSquare, Trash2 } from 'lucide-react-native'
import { useEffect, useState } from 'react'
import { Pressable, ScrollView, Text, View } from 'react-native'
import { Container } from '../../src/components/app/container'
import { MobileStatusBar } from '../../src/components/chat/mobile-status-bar'
import { NativeChatComposer } from '../../src/components/chat/native-chat-composer'
import { EmptyStateCard } from '../../src/components/common/empty-state-card'
import { FlashList } from '../../src/components/common/flash-list'
import { SyncStatusBanner } from '../../src/components/common/sync-status-banner'
import { useMobileRuntime } from '../../src/lib/runtime-context'
import { useHuriroColors } from '../../src/lib/theme'

export default function ChatTabScreen() {
	const router = useRouter()
	const { runtime } = useMobileRuntime()
	const engine = useSyncEngine()
	const colors = useHuriroColors()
	const [channels, setChannels] = useState<ChatChannelDto[]>([
		{
			id: '0190a0b1-0000-7000-8000-000000000501',
			workspaceId: engine.workspaceId,
			kind: 'public',
			name: 'general',
			topic: 'General workspace updates',
			archivedAt: null,
			createdBy: engine.currentUserId,
			lastMsgSeq: 1,
			lastRev: 1,
			unreadCount: 0,
			hasUnread: false,
			mentionCount: 0,
			lastReadSeq: 1,
			isMember: true,
			memberCount: 1,
			muted: false,
			version: 1,
			createdAt: new Date().toISOString(),
			updatedAt: new Date().toISOString()
		}
	])
	const [activeChannelId, setActiveChannelId] = useState('0190a0b1-0000-7000-8000-000000000501')
	const [messages, setMessages] = useState<ChatMessageDto[]>([])
	const [showSaved, setShowSaved] = useState(false)
	const [savedItems, setSavedItems] = useState<ChatSavedItemDto[]>([])
	const [statusProfile, setStatusProfile] = useState<UserWorkspaceProfileDto | null>(null)
	const [availability, setAvailability] = useState<UserAvailabilityDto | null>(null)

	useEffect(() => {
		if (!runtime || runtime.isPreview) return
		let cancelled = false
		void runtime.api
			.listChannels()
			.then((list) => {
				if (cancelled || list.length === 0) return
				setChannels(list)
				if (list[0]) setActiveChannelId(list[0].id)
			})
			.catch(() => {})
		void runtime.api
			.getMyStatus()
			.then((profile) => {
				if (!cancelled) setStatusProfile(profile)
			})
			.catch(() => {})
		void runtime.api
			.getMyAvailability()
			.then((row) => {
				if (!cancelled) setAvailability(row)
			})
			.catch(() => {})
		void runtime.api
			.listSavedMessages()
			.then((items) => {
				if (!cancelled) setSavedItems(items)
			})
			.catch(() => {})
		return () => {
			cancelled = true
		}
	}, [runtime])

	useEffect(() => {
		if (!runtime || runtime.isPreview || !activeChannelId) return
		let cancelled = false
		void runtime.api
			.listMessages(activeChannelId)
			.then((list) => {
				if (!cancelled) setMessages(list)
			})
			.catch(() => {})
		return () => {
			cancelled = true
		}
	}, [runtime, activeChannelId])

	const activeChannel = channels.find((c) => c.id === activeChannelId) ?? channels[0]

	async function handleSend(text: string, opts?: { readonly broadcastToChannel?: boolean }) {
		if (!activeChannel) return
		if (!runtime || runtime.isPreview) {
			const now = new Date().toISOString()
			const localMsg: ChatMessageDto = {
				id: generateUuidV7(),
				workspaceId: engine.workspaceId,
				channelId: activeChannel.id,
				channelSeq: messages.length + 1,
				threadSeq: null,
				rev: messages.length + 1,
				threadParentId: null,
				broadcastToChannel: Boolean(opts?.broadcastToChannel),
				replyToMessageId: null,
				messageKind: 'text',
				metadata: null,
				replyCount: 0,
				lastReplyAt: null,
				clientId: null,
				authorType: 'user',
				authorId: engine.currentUserId,
				body: text,
				bodyText: text,
				reactions: [],
				attachments: [],
				linkPreviews: [],
				richLinks: [],
				editedAt: null,
				deletedAt: null,
				createdAt: now,
				updatedAt: now,
				version: 1
			}
			setMessages((prev) => [...prev, localMsg])
			return
		}
		const sent = await runtime.api.sendMessage(activeChannel.id, {
			body: text,
			bodyText: text,
			...(opts?.broadcastToChannel !== undefined ? { broadcastToChannel: opts.broadcastToChannel } : {})
		})
		setMessages((prev) => [...prev, sent])
	}

	async function handleUpdateStatus(body: UpdateUserStatusBody) {
		if (!runtime || runtime.isPreview) {
			setStatusProfile((prev) => ({
				statusEmoji: body.statusEmoji !== undefined ? body.statusEmoji : (prev?.statusEmoji ?? null),
				statusText: body.statusText !== undefined ? body.statusText : (prev?.statusText ?? ''),
				statusExpiresAt:
					body.statusExpiresAt !== undefined ? body.statusExpiresAt : (prev?.statusExpiresAt ?? null),
				dndUntil: body.dndUntil !== undefined ? body.dndUntil : (prev?.dndUntil ?? null),
				workingHours: prev?.workingHours ?? {},
				lastSeenAt: new Date().toISOString()
			}))
			return
		}
		const updated = await runtime.api.updateMyStatus(body)
		setStatusProfile(updated)
	}

	async function handleSaveMessage(msg: ChatMessageDto) {
		if (!runtime || runtime.isPreview) {
			const now = new Date().toISOString()
			setSavedItems((prev) => [
				{
					id: generateUuidV7(),
					messageId: msg.id,
					customText: msg.bodyText,
					note: null,
					status: 'saved',
					remindAt: null,
					completedAt: null,
					version: 1,
					createdAt: now,
					updatedAt: now
				},
				...prev
			])
			return
		}
		const saved = await runtime.api.saveMessage({ messageId: msg.id })
		setSavedItems((prev) => [saved, ...prev])
	}

	async function handleUnsave(savedId: string) {
		if (runtime && !runtime.isPreview) {
			await runtime.api.unsaveMessage(savedId)
		}
		setSavedItems((prev) => prev.filter((item) => item.id !== savedId))
	}

	return (
		<Container
			scroll={false}
			header={
				<>
					<SyncStatusBanner />
					<MobileStatusBar
						profile={statusProfile}
						availability={availability}
						onUpdate={handleUpdateStatus}
					/>
					{/* Channel picker + Saved view toggle stays a horizontal scroll */}
					<View className="border-b border-default-soft bg-surface flex-row items-center justify-between pr-3">
						<ScrollView
							horizontal
							showsHorizontalScrollIndicator={false}
							contentContainerClassName="px-4 py-2.5 gap-2"
						>
							<Chip
								size="sm"
								variant={showSaved ? 'primary' : 'soft'}
								color={showSaved ? 'accent' : 'default'}
								onPress={() => setShowSaved((prev) => !prev)}
							>
								<Bookmark size={12} color={showSaved ? colors.accentForeground : colors.muted} />
								<Chip.Label>{t('chat.saved.filter')}</Chip.Label>
							</Chip>
							{channels.map((ch) => {
								const active = !showSaved && ch.id === activeChannel?.id
								return (
									<Chip
										key={ch.id}
										size="sm"
										variant={active ? 'primary' : 'soft'}
										color={active ? 'accent' : 'default'}
										onPress={() => {
											setShowSaved(false)
											setActiveChannelId(ch.id)
										}}
									>
										<Hash size={12} color={active ? colors.accentForeground : colors.muted} />
										<Chip.Label>{ch.name}</Chip.Label>
									</Chip>
								)
							})}
						</ScrollView>
						{activeChannel && !showSaved ? (
							<Button
								isIconOnly
								size="sm"
								variant="secondary"
								onPress={() => router.push(`/chat/${activeChannel.id}` as never)}
								accessibilityLabel={`Open #${activeChannel.name}`}
							>
								<ExternalLink size={14} color={colors.muted} />
							</Button>
						) : null}
					</View>
				</>
			}
			footer={
				showSaved ? undefined : (
					<NativeChatComposer
						channelName={activeChannel?.name ?? 'general'}
						onTyping={() => {
							if (activeChannel) engine.sendTyping(activeChannel.id)
						}}
						onSend={handleSend}
					/>
				)
			}
		>
			{showSaved ? (
				<FlashList
					className="flex-1"
					data={savedItems}
					keyExtractor={(item) => item.id}
					contentContainerClassName="p-4 pb-6"
					renderItem={({ item }) => (
						<Card className="mb-2.5 p-3.5 rounded-2xl border border-default-soft-hover">
							<View className="flex-row items-start justify-between gap-2">
								<View className="flex-1">
									<Text className="text-sm text-foreground">
										{item.customText ?? item.note ?? item.messageId ?? 'Saved item'}
									</Text>
									<Text className="text-[11px] text-muted mt-1">{item.createdAt.slice(0, 16)}</Text>
								</View>
								<Button
									isIconOnly
									size="sm"
									variant="secondary"
									onPress={() => void handleUnsave(item.id)}
									accessibilityLabel="Remove saved item"
								>
									<Trash2 size={14} color={colors.muted} />
								</Button>
							</View>
						</Card>
					)}
					ListEmptyComponent={
						<EmptyStateCard
							icon={<Bookmark size={22} color={colors.muted} />}
							title={t('chat.saved.filter')}
							description={t('chat.saved.empty')}
						/>
					}
				/>
			) : (
				<FlashList
					className="flex-1"
					data={messages}
					keyExtractor={(item) => item.id}
					contentContainerClassName="p-4 pb-6"
					renderItem={({ item }) => (
						<Pressable
							onPress={() => {
								if (activeChannel) router.push(`/chat/${activeChannel.id}` as never)
							}}
							accessibilityRole="button"
						>
							<Card className="mb-2.5 p-3.5 rounded-2xl border border-default-soft-hover">
								<View className="flex-row items-start gap-2.5">
									<Avatar size="sm" variant="soft" color="accent" alt="Member">
										<Avatar.Fallback>U</Avatar.Fallback>
									</Avatar>
									<View className="flex-1">
										<View className="flex-row items-center justify-between">
											<Text className="text-xs font-semibold text-foreground">Workspace Member</Text>
											<Text className="text-[11px] font-mono text-muted">#{item.channelSeq ?? item.rev}</Text>
										</View>
										<Text className="text-sm text-foreground mt-1">{item.bodyText}</Text>
										<View className="flex-row items-center gap-2 mt-2">
											<Chip
												size="sm"
												variant="soft"
												color="default"
												onPress={() => void handleSaveMessage(item)}
											>
												<Bookmark size={11} color={colors.muted} />
												<Chip.Label>{t('chat.saved.save')}</Chip.Label>
											</Chip>
										</View>
									</View>
								</View>
							</Card>
						</Pressable>
					)}
					ListEmptyComponent={
						<EmptyStateCard
							icon={<MessageSquare size={22} color={colors.muted} />}
							title={`#${activeChannel?.name ?? 'general'}`}
							description="Native channel feed — compose below with instant typing presence."
						/>
					}
				/>
			)}
		</Container>
	)
}
