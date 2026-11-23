import type { ChatChannelDto } from '@huriro/contracts'
import { t } from '@huriro/i18n'
import { useSyncEngine } from '@huriro/sync-client'
import { Bell, BellOff, Hash, Lock, Users } from 'lucide-react'
import { useEffect, useMemo } from 'react'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { EmptyState } from '@/components/ui/empty-state'
import { ErrorState } from '@/components/ui/error-state'
import { Skeleton } from '@/components/ui/skeleton'
import { useWorkspace } from '@/lib/workspace'
import { useChatStore } from '../store/chat-store'
import { ChannelMembersDialog } from './channel-members-dialog'
import { CreateChannelDialog } from './create-channel-dialog'
import { CreateDmDialog } from './create-dm-dialog'
import { MessageComposer } from './message-composer'
import { MessageList } from './message-list'
import { ThreadPanel } from './thread-panel'
import { TypingIndicator } from './typing-indicator'

function formatChannelLabel(channel: ChatChannelDto, currentUserId: string): string {
	if (channel.kind === 'dm') {
		const others = (channel.members ?? []).filter((m) => m.principalId !== currentUserId)
		return (
			others.map((m) => m.displayName ?? m.email ?? m.principalId.slice(0, 8)).join(', ') || 'Direct message'
		)
	}
	return channel.name ?? 'channel'
}

export function ChatWorkspace({
	requestedChannelId,
	highlightedMessageId
}: {
	readonly requestedChannelId?: string | undefined
	readonly highlightedMessageId?: string | undefined
}) {
	const { api, currentUserId } = useWorkspace()
	const engine = useSyncEngine()

	const channels = useChatStore((s) => s.channels)
	const activeChannelId = useChatStore((s) => s.activeChannelId)
	const activeThreadParentId = useChatStore((s) => s.activeThreadParentId)
	const activeView = useChatStore((s) => s.activeView)
	const messagesByChannel = useChatStore((s) => s.messagesByChannel)
	const threadsByParent = useChatStore((s) => s.threadsByParent)
	const subscribedThreads = useChatStore((s) => s.subscribedThreads)
	const loading = useChatStore((s) => s.loading)
	const loadingMessages = useChatStore((s) => s.loadingMessages)
	const error = useChatStore((s) => s.error)

	const loadChannels = useChatStore((s) => s.loadChannels)
	const selectChannel = useChatStore((s) => s.selectChannel)
	const loadSubscribedThreads = useChatStore((s) => s.loadSubscribedThreads)
	const sendMessage = useChatStore((s) => s.sendMessage)
	const editMessage = useChatStore((s) => s.editMessage)
	const deleteMessage = useChatStore((s) => s.deleteMessage)
	const toggleReaction = useChatStore((s) => s.toggleReaction)
	const openThread = useChatStore((s) => s.openThread)
	const closeThread = useChatStore((s) => s.closeThread)
	const toggleMute = useChatStore((s) => s.toggleMute)
	const setMembersDialogOpen = useChatStore((s) => s.setMembersDialogOpen)

	useEffect(() => {
		if (channels.length === 0) {
			void loadChannels(api)
		}
	}, [api, channels.length, loadChannels])

	useEffect(() => {
		if (requestedChannelId && requestedChannelId !== activeChannelId) {
			void selectChannel(api, requestedChannelId)
		}
	}, [activeChannelId, api, requestedChannelId, selectChannel])

	useEffect(() => {
		if (activeView === 'threads') {
			void loadSubscribedThreads(api)
		}
	}, [activeView, api, loadSubscribedThreads])

	const activeChannel = useMemo(
		() => channels.find((c) => c.id === activeChannelId) ?? null,
		[activeChannelId, channels]
	)

	const memberNamesById = useMemo(() => {
		const map = new Map<string, string>()
		for (const c of channels) {
			for (const m of c.members ?? []) {
				if (m.displayName) map.set(m.principalId, m.displayName)
			}
		}
		return map
	}, [channels])

	const activeThread = activeThreadParentId ? threadsByParent[activeThreadParentId] : undefined

	if (loading && channels.length === 0) {
		return (
			<div className="space-y-3 p-6">
				<Skeleton className="h-8 w-64" />
				<Skeleton className="h-64 w-full" />
			</div>
		)
	}

	if (error && channels.length === 0) {
		return (
			<ErrorState
				className="m-6"
				title={t('nav.chat')}
				message={error}
				action={
					<Button size="sm" tone="outline" type="button" onClick={() => void loadChannels(api)}>
						{t('error.retry')}
					</Button>
				}
			/>
		)
	}

	if (activeView === 'threads') {
		return (
			<div className="flex h-full">
				<div className="flex-1 space-y-3 overflow-y-auto p-6">
					<h1 className="text-lg font-semibold">{t('chat.sidebar.threads')}</h1>
					{subscribedThreads.length === 0 ? (
						<EmptyState title={t('chat.thread.empty')} />
					) : (
						subscribedThreads.map((th) => (
							<button
								key={th.parentMessage.id}
								type="button"
								onClick={() => {
									void selectChannel(api, th.channelId).then(() => openThread(api, th.parentMessage.id))
								}}
								className="block w-full rounded-lg border border-border bg-card p-3 text-left hover:bg-accent/30"
							>
								<div className="flex items-center justify-between text-xs text-muted-foreground">
									<span>#{th.channelName ?? 'dm'}</span>
									<span>{t('chat.message.replies-count', { count: th.parentMessage.replyCount })}</span>
								</div>
								<p className="mt-1 text-sm font-medium text-foreground">{th.parentMessage.bodyText}</p>
							</button>
						))
					)}
				</div>
				<CreateChannelDialog api={api} />
				<CreateDmDialog api={api} currentUserId={currentUserId} />
			</div>
		)
	}

	if (activeView === 'unreads') {
		const unreadChannels = channels.filter((c) => c.unreadCount > 0 || c.hasUnread)
		return (
			<div className="flex-1 space-y-3 overflow-y-auto p-6">
				<h1 className="text-lg font-semibold">{t('chat.sidebar.unreads')}</h1>
				{unreadChannels.length === 0 ? (
					<EmptyState title={t('chat.empty.select-channel')} />
				) : (
					unreadChannels.map((ch) => (
						<button
							key={ch.id}
							type="button"
							onClick={() => void selectChannel(api, ch.id)}
							className="flex w-full items-center justify-between rounded-lg border border-border bg-card p-3 text-left hover:bg-accent/30"
						>
							<span className="text-sm font-medium">{formatChannelLabel(ch, currentUserId)}</span>
							<Badge tone="default">{ch.unreadCount}</Badge>
						</button>
					))
				)}
				<CreateChannelDialog api={api} />
				<CreateDmDialog api={api} currentUserId={currentUserId} />
			</div>
		)
	}

	if (!activeChannel) {
		return (
			<div className="flex h-full items-center justify-center p-6">
				<EmptyState title={t('chat.empty.select-channel')} hint={t('chat.empty.hint')} />
				<CreateChannelDialog api={api} />
				<CreateDmDialog api={api} currentUserId={currentUserId} />
			</div>
		)
	}

	const label = formatChannelLabel(activeChannel, currentUserId)
	const messages = messagesByChannel[activeChannel.id] ?? []

	return (
		<div className="flex h-full min-h-0">
			<div className="flex min-w-0 flex-1 flex-col">
				<header className="flex items-center justify-between border-b border-border bg-card px-4 py-2.5">
					<div className="flex min-w-0 items-center gap-2">
						{activeChannel.kind === 'private' ? (
							<Lock className="size-4 shrink-0 text-muted-foreground" aria-hidden />
						) : activeChannel.kind === 'dm' ? (
							<Users className="size-4 shrink-0 text-muted-foreground" aria-hidden />
						) : (
							<Hash className="size-4 shrink-0 text-muted-foreground" aria-hidden />
						)}
						<h1 className="truncate text-sm font-semibold text-foreground">{label}</h1>
						{activeChannel.topic ? (
							<span className="hidden truncate text-xs text-muted-foreground sm:inline">
								— {activeChannel.topic}
							</span>
						) : null}
						{activeChannel.archivedAt ? <Badge tone="secondary">{t('chat.header.archived')}</Badge> : null}
					</div>

					<div className="flex items-center gap-1.5">
						<Button size="sm" tone="outline" type="button" onClick={() => setMembersDialogOpen(true)}>
							<Users className="size-3.5" aria-hidden />
							<span>{t('chat.header.members', { count: activeChannel.memberCount })}</span>
						</Button>
						<Button
							size="icon"
							tone="ghost"
							type="button"
							aria-label={activeChannel.muted ? t('chat.header.unmute') : t('chat.header.mute')}
							onClick={() => void toggleMute(api, activeChannel.id, !activeChannel.muted)}
						>
							{activeChannel.muted ? (
								<BellOff className="size-4 text-muted-foreground" aria-hidden />
							) : (
								<Bell className="size-4 text-muted-foreground" aria-hidden />
							)}
						</Button>
					</div>
				</header>

				{loadingMessages ? (
					<div className="flex-1 space-y-3 p-4">
						<Skeleton className="h-12 w-3/4" />
						<Skeleton className="h-12 w-2/3" />
					</div>
				) : (
					<MessageList
						messages={messages}
						currentUserId={currentUserId}
						highlightedMessageId={highlightedMessageId}
						onReply={(parentId) => void openThread(api, parentId)}
						onEdit={async (messageId, bodyText, version) => {
							await editMessage(api, messageId, { bodyText, version })
						}}
						onDelete={(messageId) => deleteMessage(api, messageId)}
						onToggleReaction={(messageId, emoji, reacted) => toggleReaction(api, messageId, emoji, reacted)}
					/>
				)}

				<div className="border-t border-border bg-background px-4 pb-3 pt-1">
					<TypingIndicator
						channelId={activeChannel.id}
						currentUserId={currentUserId}
						memberNamesById={memberNamesById}
					/>
					<MessageComposer
						placeholder={t('chat.composer.placeholder', {
							target: activeChannel.kind === 'dm' ? label : `#${label}`
						})}
						disabled={Boolean(activeChannel.archivedAt)}
						onUploadFile={(file) => api.uploadFile(file)}
						onTyping={() => engine.sendTyping(activeChannel.id)}
						onSend={async (bodyText, attachmentFileIds) => {
							await sendMessage(api, activeChannel.id, {
								bodyText,
								...(attachmentFileIds.length > 0 ? { attachmentFileIds } : {})
							})
						}}
					/>
				</div>
			</div>

			{activeThread ? (
				<ThreadPanel
					parent={activeThread.parent}
					replies={activeThread.replies}
					currentUserId={currentUserId}
					onClose={closeThread}
					onUploadFile={(file) => api.uploadFile(file)}
					onSendReply={async (bodyText, attachmentFileIds) => {
						await sendMessage(api, activeChannel.id, {
							bodyText,
							threadParentId: activeThread.parent.id,
							...(attachmentFileIds.length > 0 ? { attachmentFileIds } : {})
						})
					}}
					onEdit={async (messageId, bodyText, version) => {
						await editMessage(api, messageId, { bodyText, version })
					}}
					onDelete={(messageId) => deleteMessage(api, messageId)}
					onToggleReaction={(messageId, emoji, reacted) => toggleReaction(api, messageId, emoji, reacted)}
				/>
			) : null}

			<CreateChannelDialog api={api} />
			<CreateDmDialog api={api} currentUserId={currentUserId} />
			<ChannelMembersDialog api={api} channel={activeChannel} />
		</div>
	)
}
