import type { ChatChannelDto, ChatMessageDto } from '@huriro/contracts'
import { generateUuidV7, useSyncEngine } from '@huriro/sync-client'
import { Avatar, Card, Chip } from 'heroui-native'
import { Hash, MessageSquare } from 'lucide-react-native'
import { useEffect, useState } from 'react'
import { ScrollView, Text, View } from 'react-native'
import { Container } from '../../src/components/app/container'
import { NativeChatComposer } from '../../src/components/chat/native-chat-composer'
import { EmptyStateCard } from '../../src/components/common/empty-state-card'
import { FlashList } from '../../src/components/common/flash-list'
import { SyncStatusBanner } from '../../src/components/common/sync-status-banner'
import { useMobileRuntime } from '../../src/lib/runtime-context'

export default function ChatTabScreen() {
	const { runtime } = useMobileRuntime()
	const engine = useSyncEngine()
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

	async function handleSend(text: string) {
		if (!activeChannel) return
		if (!runtime || runtime.isPreview) {
			const localMsg: ChatMessageDto = {
				id: generateUuidV7(),
				workspaceId: engine.workspaceId,
				channelId: activeChannel.id,
				channelSeq: messages.length + 1,
				threadSeq: null,
				rev: messages.length + 1,
				threadParentId: null,
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
				createdAt: new Date().toISOString(),
				updatedAt: new Date().toISOString(),
				version: 1
			}
			setMessages((prev) => [...prev, localMsg])
			return
		}
		const sent = await runtime.api.sendMessage(activeChannel.id, {
			body: text,
			bodyText: text
		})
		setMessages((prev) => [...prev, sent])
	}

	return (
		<Container
			scroll={false}
			header={
				<>
					<SyncStatusBanner />
					{/* Channel picker stays a horizontal scroll — it is not a page wrapper */}
					<View className="border-b border-border/50 bg-surface">
						<ScrollView
							horizontal
							showsHorizontalScrollIndicator={false}
							contentContainerClassName="px-4 py-2.5 gap-2"
						>
							{channels.map((ch) => {
								const active = ch.id === activeChannel?.id
								return (
									<Chip
										key={ch.id}
										size="sm"
										variant={active ? 'primary' : 'soft'}
										color={active ? 'accent' : 'default'}
										onPress={() => setActiveChannelId(ch.id)}
									>
										<Hash size={12} color={active ? '#ffffff' : '#71717a'} />
										<Chip.Label>{ch.name}</Chip.Label>
									</Chip>
								)
							})}
						</ScrollView>
					</View>
				</>
			}
			footer={
				<NativeChatComposer
					channelName={activeChannel?.name ?? 'general'}
					onTyping={() => {
						if (activeChannel) engine.sendTyping(activeChannel.id)
					}}
					onSend={handleSend}
				/>
			}
		>
			<FlashList
				className="flex-1"
				data={messages}
				keyExtractor={(item) => item.id}
				contentContainerClassName="p-4 pb-6"
				renderItem={({ item }) => (
					<Card className="mb-2.5 p-3.5 rounded-2xl border border-border/60">
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
							</View>
						</View>
					</Card>
				)}
				ListEmptyComponent={
					<EmptyStateCard
						icon={<MessageSquare size={22} color="#71717a" />}
						title={`#${activeChannel?.name ?? 'general'}`}
						description="Native channel feed — compose below with instant typing presence."
					/>
				}
			/>
		</Container>
	)
}
