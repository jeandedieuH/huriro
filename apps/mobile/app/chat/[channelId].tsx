import type { ChatMessageDto, ChatPinnedMessageDto } from '@huriro/contracts'
import { t } from '@huriro/i18n'
import { generateUuidV7, useSyncEngine } from '@huriro/sync-client'
import { Stack, useLocalSearchParams } from 'expo-router'
import { Button, Card, Chip } from 'heroui-native'
import { Bookmark, CornerUpRight, Pin, PinOff, X } from 'lucide-react-native'
import { useEffect, useState } from 'react'
import { Text, View } from 'react-native'
import { Container } from '../../src/components/app/container'
import { MobilePinsSheet } from '../../src/components/chat/mobile-pins-sheet'
import { NativeChatComposer } from '../../src/components/chat/native-chat-composer'
import { FlashList } from '../../src/components/common/flash-list'
import { useMobileRuntime } from '../../src/lib/runtime-context'

export default function ChannelDetailScreen() {
	const params = useLocalSearchParams<{ channelId?: string }>()
	const channelId = typeof params['channelId'] === 'string' ? params['channelId'] : 'general'
	const { runtime } = useMobileRuntime()
	const engine = useSyncEngine()
	const [messages, setMessages] = useState<ChatMessageDto[]>([])
	const [pins, setPins] = useState<ChatPinnedMessageDto[]>([])
	const [pinsOpen, setPinsOpen] = useState(false)
	const [highlightedId, setHighlightedId] = useState<string | null>(null)
	const [replyToThreadId, setReplyToThreadId] = useState<string | null>(null)

	useEffect(() => {
		if (!runtime || runtime.isPreview || !channelId) return
		let cancelled = false
		void runtime.api
			.listMessages(channelId)
			.then((list) => {
				if (!cancelled) setMessages(list)
			})
			.catch(() => {})
		void runtime.api
			.listPinnedMessages(channelId)
			.then((list) => {
				if (!cancelled) setPins(list)
			})
			.catch(() => {})
		return () => {
			cancelled = true
		}
	}, [runtime, channelId])

	async function handleSend(text: string, opts?: { readonly broadcastToChannel?: boolean }) {
		if (!runtime || runtime.isPreview) {
			const now = new Date().toISOString()
			const localMsg: ChatMessageDto = {
				id: generateUuidV7(),
				workspaceId: engine.workspaceId,
				channelId,
				channelSeq: messages.length + 1,
				threadSeq: replyToThreadId ? 1 : null,
				rev: messages.length + 1,
				threadParentId: replyToThreadId,
				broadcastToChannel: Boolean(replyToThreadId && opts?.broadcastToChannel),
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
			setReplyToThreadId(null)
			return
		}
		const sent = await runtime.api.sendMessage(channelId, {
			body: text,
			bodyText: text,
			...(replyToThreadId
				? { threadParentId: replyToThreadId, broadcastToChannel: Boolean(opts?.broadcastToChannel) }
				: {})
		})
		setMessages((prev) => [...prev, sent])
		setReplyToThreadId(null)
	}

	async function handleTogglePin(msg: ChatMessageDto) {
		const isPinned = pins.some((p) => p.messageId === msg.id)
		if (isPinned) {
			if (runtime && !runtime.isPreview) await runtime.api.unpinMessage(msg.id)
			setPins((prev) => prev.filter((p) => p.messageId !== msg.id))
			return
		}
		if (runtime && !runtime.isPreview) await runtime.api.pinMessage(msg.id)
		setPins((prev) => [
			{
				messageId: msg.id,
				pinnedBy: engine.currentUserId,
				position: prev.length + 1,
				createdAt: new Date().toISOString(),
				bodyText: msg.bodyText,
				authorId: msg.authorId,
				messageCreatedAt: msg.createdAt
			},
			...prev
		])
	}

	async function handleUnpin(messageId: string) {
		if (runtime && !runtime.isPreview) await runtime.api.unpinMessage(messageId)
		setPins((prev) => prev.filter((p) => p.messageId !== messageId))
	}

	async function handleSave(messageId: string) {
		if (runtime && !runtime.isPreview) {
			await runtime.api.saveMessage({ messageId })
		}
	}

	return (
		<>
			<Stack.Screen
				options={{
					headerShown: true,
					title: `#${channelId}`,
					headerRight: () => (
						<Button
							size="sm"
							variant="secondary"
							onPress={() => setPinsOpen(true)}
							accessibilityLabel={t('chat.pins.title')}
						>
							<Pin size={14} color="#2563eb" />
							<Button.Label>{String(pins.length)}</Button.Label>
						</Button>
					)
				}}
			/>
			<Container
				scroll={false}
				edges={['bottom']}
				footer={
					<View>
						{replyToThreadId ? (
							<View className="flex-row items-center justify-between border-t border-border/60 bg-surface px-3 py-1.5">
								<Text className="text-xs text-muted">Replying in thread</Text>
								<Button
									isIconOnly
									size="sm"
									variant="secondary"
									onPress={() => setReplyToThreadId(null)}
									accessibilityLabel="Cancel thread reply"
								>
									<X size={13} color="#71717a" />
								</Button>
							</View>
						) : null}
						<NativeChatComposer
							channelName={channelId}
							inThread={Boolean(replyToThreadId)}
							onSend={handleSend}
						/>
					</View>
				}
			>
				<FlashList
					className="flex-1"
					data={messages}
					keyExtractor={(m) => m.id}
					contentContainerClassName="p-4 gap-2.5"
					renderItem={({ item }) => {
						const pinned = pins.some((p) => p.messageId === item.id)
						const highlighted = highlightedId === item.id
						return (
							<Card
								className={`p-3.5 rounded-2xl border ${
									highlighted ? 'border-accent bg-accent/10' : 'border-border/60'
								}`}
							>
								<Text className="text-sm text-foreground">{item.bodyText}</Text>
								<View className="flex-row items-center gap-2 mt-2">
									<Chip
										size="sm"
										variant={pinned ? 'primary' : 'soft'}
										color={pinned ? 'accent' : 'default'}
										onPress={() => void handleTogglePin(item)}
									>
										{pinned ? <PinOff size={11} color="#ffffff" /> : <Pin size={11} color="#71717a" />}
										<Chip.Label>{pinned ? 'Unpin' : 'Pin'}</Chip.Label>
									</Chip>
									<Chip size="sm" variant="soft" color="default" onPress={() => void handleSave(item.id)}>
										<Bookmark size={11} color="#71717a" />
										<Chip.Label>{t('chat.saved.save')}</Chip.Label>
									</Chip>
									<Chip size="sm" variant="soft" color="default" onPress={() => setReplyToThreadId(item.id)}>
										<CornerUpRight size={11} color="#71717a" />
										<Chip.Label>Reply</Chip.Label>
									</Chip>
								</View>
							</Card>
						)
					}}
				/>
			</Container>
			<MobilePinsSheet
				visible={pinsOpen}
				pins={pins}
				onClose={() => setPinsOpen(false)}
				onSelectMessage={(id) => {
					setHighlightedId(id)
					setTimeout(() => setHighlightedId((cur) => (cur === id ? null : cur)), 2500)
				}}
				onUnpin={(id) => void handleUnpin(id)}
			/>
		</>
	)
}
