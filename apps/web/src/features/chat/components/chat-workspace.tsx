import type { ChatChannelDto, ChatMessageDto } from '@huriro/contracts'
import { t } from '@huriro/i18n'
import { useSyncEngine } from '@huriro/sync-client'
import { Bell, BellOff, FileText, FolderInput, Hash, Headphones, Lock, Pin, Users } from 'lucide-react'
import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { EmptyState } from '@/components/ui/empty-state'
import { ErrorState } from '@/components/ui/error-state'
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover'
import { Skeleton } from '@/components/ui/skeleton'
import { navigateToDoc } from '@/lib/navigation'
import type { WorkspaceMemberSummary } from '@/lib/sync-bootstrap'
import { useWorkspace } from '@/lib/workspace'
import { useUiStore } from '@/stores/ui-store'
import { useChatStore } from '../store/chat-store'
import { ChannelBookmarksBar } from './channel-bookmarks-bar'
import { ChannelMembersDialog } from './channel-members-dialog'
import type { AutocompleteMemberEntry } from './composer-autocomplete'
import { CreateChannelDialog } from './create-channel-dialog'
import { CreateDmDialog } from './create-dm-dialog'
import { DraftsScheduledView } from './drafts-scheduled-view'
import { ForwardMessageDialog } from './forward-message-dialog'
import { MessageComposer } from './message-composer'
import { MessageList } from './message-list'
import { PinsPanel } from './pins-panel'
import { PollDialog } from './poll-dialog'
import { SavedItemsView } from './saved-items-view'
import { ThreadPanel } from './thread-panel'
import { TypingIndicator } from './typing-indicator'
import { UserGroupsView } from './user-groups-view'

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
	const pushToast = useUiStore((s) => s.pushToast)

	const channels = useChatStore((s) => s.channels)
	const activeChannelId = useChatStore((s) => s.activeChannelId)
	const pinsPanelOpen = useChatStore((s) => s.pinsPanelOpen)
	const setPinsPanelOpen = useChatStore((s) => s.setPinsPanelOpen)
	const pinsByChannel = useChatStore((s) => s.pinsByChannel)
	const pinMessage = useChatStore((s) => s.pinMessage)
	const unpinMessage = useChatStore((s) => s.unpinMessage)
	const activeThreadParentId = useChatStore((s) => s.activeThreadParentId)
	const activeView = useChatStore((s) => s.activeView)
	const messagesByChannel = useChatStore((s) => s.messagesByChannel)
	const threadsByParent = useChatStore((s) => s.threadsByParent)
	const subscribedThreads = useChatStore((s) => s.subscribedThreads)
	const loading = useChatStore((s) => s.loading)
	const loadingMessages = useChatStore((s) => s.loadingMessages)
	const error = useChatStore((s) => s.error)

	const drafts = useChatStore((s) => s.drafts)
	const scheduledMessages = useChatStore((s) => s.scheduledMessages)
	const savedItems = useChatStore((s) => s.savedItems)
	const sidebarSections = useChatStore((s) => s.sidebarSections)
	const bookmarksByChannel = useChatStore((s) => s.bookmarksByChannel)
	const userGroups = useChatStore((s) => s.userGroups)
	const workspaceEmojis = useChatStore((s) => s.workspaceEmojis)
	const pollsByChannel = useChatStore((s) => s.pollsByChannel)
	const activeHuddleByChannel = useChatStore((s) => s.activeHuddleByChannel)
	const quotingMessage = useChatStore((s) => s.quotingMessage)
	const forwardingMessage = useChatStore((s) => s.forwardingMessage)
	const pollDialogOpen = useChatStore((s) => s.pollDialogOpen)

	const [jumpedMessageId, setJumpedMessageId] = useState<string | null>(null)
	const [workspaceMembers, setWorkspaceMembers] = useState<WorkspaceMemberSummary[]>([])
	const [openingCanvas, setOpeningCanvas] = useState(false)
	const jumpTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null)

	useEffect(() => {
		return () => {
			if (jumpTimerRef.current) clearTimeout(jumpTimerRef.current)
		}
	}, [])

	const handleJumpToMessage = useCallback((messageId: string) => {
		setJumpedMessageId(messageId)
		if (jumpTimerRef.current) clearTimeout(jumpTimerRef.current)
		jumpTimerRef.current = setTimeout(() => {
			setJumpedMessageId(null)
		}, 2500)
	}, [])

	const loadChannels = useChatStore((s) => s.loadChannels)
	const loadChatV2Metadata = useChatStore((s) => s.loadChatV2Metadata)
	const selectChannel = useChatStore((s) => s.selectChannel)
	const loadSubscribedThreads = useChatStore((s) => s.loadSubscribedThreads)
	const sendMessage = useChatStore((s) => s.sendMessage)
	const editMessage = useChatStore((s) => s.editMessage)
	const deleteMessage = useChatStore((s) => s.deleteMessage)
	const toggleReaction = useChatStore((s) => s.toggleReaction)
	const openThread = useChatStore((s) => s.openThread)
	const closeThread = useChatStore((s) => s.closeThread)
	const toggleMute = useChatStore((s) => s.toggleMute)
	const refreshChannelDetail = useChatStore((s) => s.refreshChannelDetail)
	const setMembersDialogOpen = useChatStore((s) => s.setMembersDialogOpen)
	const saveDraft = useChatStore((s) => s.saveDraft)
	const discardDraft = useChatStore((s) => s.discardDraft)
	const scheduleMessage = useChatStore((s) => s.scheduleMessage)
	const cancelScheduledMessage = useChatStore((s) => s.cancelScheduledMessage)
	const saveItem = useChatStore((s) => s.saveItem)
	const updateSavedItem = useChatStore((s) => s.updateSavedItem)
	const removeSavedItem = useChatStore((s) => s.removeSavedItem)
	const addChannelToSection = useChatStore((s) => s.addChannelToSection)
	const removeChannelFromSection = useChatStore((s) => s.removeChannelFromSection)
	const loadBookmarks = useChatStore((s) => s.loadBookmarks)
	const addBookmark = useChatStore((s) => s.addBookmark)
	const removeBookmark = useChatStore((s) => s.removeBookmark)
	const updateMyStatus = useChatStore((s) => s.updateMyStatus)
	const createUserGroup = useChatStore((s) => s.createUserGroup)
	const setUserGroupMembers = useChatStore((s) => s.setUserGroupMembers)
	const createWorkspaceEmoji = useChatStore((s) => s.createWorkspaceEmoji)
	const deleteWorkspaceEmoji = useChatStore((s) => s.deleteWorkspaceEmoji)
	const loadPolls = useChatStore((s) => s.loadPolls)
	const createPoll = useChatStore((s) => s.createPoll)
	const votePoll = useChatStore((s) => s.votePoll)
	const closePoll = useChatStore((s) => s.closePoll)
	const forwardMessage = useChatStore((s) => s.forwardMessage)
	const loadActiveHuddle = useChatStore((s) => s.loadActiveHuddle)
	const startHuddle = useChatStore((s) => s.startHuddle)
	const endHuddle = useChatStore((s) => s.endHuddle)
	const markUnreadFromMessage = useChatStore((s) => s.markUnreadFromMessage)
	const setQuotingMessage = useChatStore((s) => s.setQuotingMessage)
	const setForwardingMessage = useChatStore((s) => s.setForwardingMessage)
	const setPollDialogOpen = useChatStore((s) => s.setPollDialogOpen)

	useEffect(() => {
		if (channels.length === 0) {
			void loadChannels(api)
		}
		void loadChatV2Metadata(api)
		void api
			.listMembers()
			.then(setWorkspaceMembers)
			.catch(() => {})
	}, [api, channels.length, loadChannels, loadChatV2Metadata])

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

	useEffect(() => {
		if (!activeChannelId) return
		void Promise.all([
			loadBookmarks(api, activeChannelId),
			loadPolls(api, activeChannelId),
			loadActiveHuddle(api, activeChannelId)
		]).catch(() => {})
	}, [activeChannelId, api, loadActiveHuddle, loadBookmarks, loadPolls])

	// Global channel switching (Alt+ArrowUp/Down) and Escape to close panels.
	useEffect(() => {
		function onKeyDown(ev: KeyboardEvent) {
			if (ev.altKey && (ev.key === 'ArrowUp' || ev.key === 'ArrowDown') && channels.length > 1) {
				ev.preventDefault()
				const idx = channels.findIndex((c) => c.id === activeChannelId)
				const delta = ev.key === 'ArrowUp' ? -1 : 1
				const nextIdx = idx < 0 ? 0 : (idx + delta + channels.length) % channels.length
				const nextChannel = channels[nextIdx]
				if (nextChannel) void selectChannel(api, nextChannel.id)
				return
			}
			if (ev.key === 'Escape') {
				if (activeThreadParentId) {
					closeThread()
				} else if (pinsPanelOpen) {
					setPinsPanelOpen(false)
				}
			}
		}
		window.addEventListener('keydown', onKeyDown)
		return () => window.removeEventListener('keydown', onKeyDown)
	}, [
		activeChannelId,
		activeThreadParentId,
		api,
		channels,
		closeThread,
		pinsPanelOpen,
		selectChannel,
		setPinsPanelOpen
	])

	const activeChannel = useMemo(
		() => channels.find((c) => c.id === activeChannelId) ?? null,
		[activeChannelId, channels]
	)

	const memberNamesById = useMemo(() => {
		const map = new Map<string, string>()
		for (const m of workspaceMembers) {
			if (m.displayName) map.set(m.userId, m.displayName)
		}
		for (const c of channels) {
			for (const m of c.members ?? []) {
				if (m.displayName) map.set(m.principalId, m.displayName)
			}
		}
		return map
	}, [channels, workspaceMembers])

	const autocompleteMembers = useMemo<AutocompleteMemberEntry[]>(() => {
		const byId = new Map<string, AutocompleteMemberEntry>()
		for (const m of workspaceMembers) {
			byId.set(m.userId, {
				principalId: m.userId,
				displayName: m.displayName,
				email: m.email
			})
		}
		for (const m of activeChannel?.members ?? []) {
			if (!byId.has(m.principalId)) {
				byId.set(m.principalId, {
					principalId: m.principalId,
					displayName: m.displayName,
					email: m.email
				})
			}
		}
		return [...byId.values()]
	}, [activeChannel?.members, workspaceMembers])

	const activeThread = activeThreadParentId ? threadsByParent[activeThreadParentId] : undefined

	const createTaskFromText = useCallback(
		async (titleText: string, descriptionText: string) => {
			const projectId =
				useUiStore.getState().activeProjectId ?? engine.collections.projects.toArray[0]?.id ?? null
			if (!projectId) {
				pushToast({ title: t('chat.message.create-issue'), tone: 'warning' })
				return null
			}
			const created = await engine.createIssue({
				projectId,
				title: titleText.trim().slice(0, 140) || 'Follow-up task',
				descriptionText,
				sourceKind: 'chat'
			})
			pushToast({
				title: t('chat.message.issue-created', { key: created.identifier }),
				tone: 'success'
			})
			return created
		},
		[engine, pushToast]
	)

	const handleCreateIssueFromMessage = useCallback(
		async (msg: ChatMessageDto) => {
			const created = await createTaskFromText(msg.bodyText, msg.bodyText)
			if (!created || !activeChannel) return
			await sendMessage(api, activeChannel.id, {
				bodyText: `${t('chat.message.issue-created', { key: created.identifier })}: ${created.title}`,
				threadParentId: msg.id
			})
		},
		[activeChannel, api, createTaskFromText, sendMessage]
	)

	const handleCopyPermalink = useCallback(
		async (msg: ChatMessageDto) => {
			const url = `${window.location.origin}/chat?channel=${encodeURIComponent(msg.channelId)}&message=${encodeURIComponent(msg.id)}`
			try {
				await navigator.clipboard?.writeText(url)
			} catch {
				// Ignore clipboard permission restrictions in headless/test environments.
			}
			pushToast({ title: t('chat.message.copy-link'), tone: 'success' })
		},
		[pushToast]
	)

	const handleSaveMessage = useCallback(
		async (msg: ChatMessageDto) => {
			await saveItem(api, { messageId: msg.id })
			pushToast({ title: t('chat.saved.title'), tone: 'success' })
		},
		[api, pushToast, saveItem]
	)

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

	if (activeView === 'later') {
		return (
			<>
				<SavedItemsView
					items={savedItems}
					channels={channels}
					onSaveItem={async (body) => {
						await saveItem(api, body)
					}}
					onUpdateItem={(id, body) => updateSavedItem(api, id, body)}
					onRemoveItem={(id) => removeSavedItem(api, id)}
					onJumpToMessage={async (channelId, messageId) => {
						await selectChannel(api, channelId)
						handleJumpToMessage(messageId)
					}}
				/>
				<CreateChannelDialog api={api} />
				<CreateDmDialog api={api} currentUserId={currentUserId} />
			</>
		)
	}

	if (activeView === 'drafts') {
		return (
			<>
				<DraftsScheduledView
					drafts={drafts}
					scheduledMessages={scheduledMessages}
					channels={channels}
					currentUserId={currentUserId}
					onResumeDraft={async (channelId, threadParentId) => {
						await selectChannel(api, channelId)
						if (threadParentId) {
							await openThread(api, threadParentId)
						}
					}}
					onDiscardDraft={(draftId) => discardDraft(api, draftId)}
					onCancelScheduled={(id, version) => cancelScheduledMessage(api, id, version)}
				/>
				<CreateChannelDialog api={api} />
				<CreateDmDialog api={api} currentUserId={currentUserId} />
			</>
		)
	}

	if (activeView === 'groups') {
		return (
			<>
				<UserGroupsView
					userGroups={userGroups}
					workspaceEmojis={workspaceEmojis}
					members={workspaceMembers}
					onCreateGroup={async (body) => {
						await createUserGroup(api, body)
					}}
					onSetGroupMembers={(groupId, memberIds) => setUserGroupMembers(api, groupId, memberIds)}
					onCreateEmoji={async (shortcode, file) => {
						const uploaded = await api.uploadFile(file)
						await createWorkspaceEmoji(api, { shortcode, fileId: uploaded.id })
					}}
					onDeleteEmoji={(id) => deleteWorkspaceEmoji(api, id)}
				/>
				<CreateChannelDialog api={api} />
				<CreateDmDialog api={api} currentUserId={currentUserId} />
			</>
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
	const channelPolls = pollsByChannel[activeChannel.id] ?? []
	const pollsById = new Map(channelPolls.map((p) => [p.id, p]))
	const channelBookmarks = bookmarksByChannel[activeChannel.id] ?? []
	const channelPins = pinsByChannel[activeChannel.id] ?? []
	const activeHuddle = activeHuddleByChannel[activeChannel.id] ?? null
	const huddleActive = activeHuddle?.status === 'active'
	const channelDraftText =
		drafts.find((d) => d.channelId === activeChannel.id && !d.threadParentId)?.bodyText ?? ''
	const threadDraftText = activeThread
		? (drafts.find((d) => d.channelId === activeChannel.id && d.threadParentId === activeThread.parent.id)
				?.bodyText ?? '')
		: ''
	const currentNotifyLevel = activeChannel.notifyLevel ?? 'default'

	async function handleChannelSend(bodyText: string, attachmentFileIds: string[]) {
		if (!activeChannel) return
		const trimmed = bodyText.trim()
		if (trimmed === '/poll') {
			setPollDialogOpen(true)
			return
		}
		if (trimmed.startsWith('/remind ')) {
			const noteText = trimmed.slice('/remind '.length).trim()
			if (noteText) {
				await saveItem(api, { customText: noteText })
				pushToast({ title: t('chat.saved.title'), tone: 'success' })
			}
			return
		}
		if (trimmed.startsWith('/status ')) {
			const nextStatus = trimmed.slice('/status '.length).trim()
			await updateMyStatus(api, { statusText: nextStatus })
			pushToast({ title: t('chat.status.title'), tone: 'success' })
			return
		}
		if (trimmed.startsWith('/topic ')) {
			const topicText = trimmed.slice('/topic '.length).trim()
			if (topicText) {
				await api.updateChannel(activeChannel.id, {
					topic: topicText,
					version: activeChannel.version
				})
				await refreshChannelDetail(api, activeChannel.id)
			}
			return
		}
		if (trimmed.startsWith('/issue ')) {
			const titleText = trimmed.slice('/issue '.length).trim()
			if (titleText) {
				await createTaskFromText(titleText, titleText)
			}
			return
		}
		if (trimmed === '/mute') {
			await toggleMute(api, activeChannel.id, !activeChannel.muted)
			return
		}

		await sendMessage(api, activeChannel.id, {
			bodyText,
			...(attachmentFileIds.length > 0 ? { attachmentFileIds } : {}),
			...(quotingMessage ? { replyToMessageId: quotingMessage.id } : {})
		})
		if (quotingMessage) setQuotingMessage(null)
	}

	async function handleOpenCanvas() {
		if (!activeChannel || openingCanvas) return
		setOpeningCanvas(true)
		try {
			const canvas = await api.ensureChannelCanvas(activeChannel.id)
			navigateToDoc(canvas.slug)
		} finally {
			setOpeningCanvas(false)
		}
	}

	return (
		<div className="flex h-full min-h-0">
			<div className="flex min-w-0 flex-1 flex-col">
				<header className="flex items-center justify-between gap-2 border-b border-border bg-card px-4 py-2.5">
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

					<div className="flex shrink-0 items-center gap-1.5">
						<Button
							size="sm"
							tone="outline"
							type="button"
							loading={openingCanvas}
							onClick={() => void handleOpenCanvas()}
						>
							<FileText className="size-3.5" aria-hidden />
							<span>{t('chat.header.canvas')}</span>
						</Button>

						<div className="flex items-center gap-1">
							<Button
								size="sm"
								tone={huddleActive ? 'secondary' : 'outline'}
								type="button"
								onClick={async () => {
									if (huddleActive && activeHuddle) {
										const joined = await api.joinChatHuddle(activeHuddle.id)
										pushToast({ title: t('chat.huddle.join'), description: joined.roomName, tone: 'success' })
									} else {
										const started = await startHuddle(api, activeChannel.id)
										pushToast({
											title: t('chat.huddle.started'),
											description: started.roomName,
											tone: 'success'
										})
									}
								}}
							>
								<Headphones className="size-3.5" aria-hidden />
								<span>{huddleActive ? t('chat.header.huddle-active') : t('chat.header.huddle')}</span>
							</Button>
							{huddleActive && activeHuddle ? (
								<Button
									size="sm"
									tone="ghost"
									type="button"
									onClick={() => void endHuddle(api, activeChannel.id, activeHuddle.id)}
								>
									{t('chat.header.huddle-end')}
								</Button>
							) : null}
						</div>

						<Button
							size="sm"
							tone="ghost"
							type="button"
							aria-label={t('chat.pins.title')}
							onClick={() => setPinsPanelOpen(!pinsPanelOpen)}
						>
							<Pin className="size-4 text-muted-foreground" aria-hidden />
							{channelPins.length > 0 ? <Badge tone="secondary">{channelPins.length}</Badge> : null}
						</Button>

						<Button size="sm" tone="outline" type="button" onClick={() => setMembersDialogOpen(true)}>
							<Users className="size-3.5" aria-hidden />
							<span>{t('chat.header.members', { count: activeChannel.memberCount })}</span>
						</Button>

						{sidebarSections.length > 0 ? (
							<Popover>
								<PopoverTrigger asChild>
									<Button size="icon" tone="ghost" type="button" aria-label={t('chat.header.add-to-section')}>
										<FolderInput className="size-4 text-muted-foreground" aria-hidden />
									</Button>
								</PopoverTrigger>
								<PopoverContent align="end" className="w-56 space-y-1.5">
									<p className="text-xs font-semibold text-foreground">{t('chat.header.add-to-section')}</p>
									{sidebarSections.map((sec) => {
										const inSection = (sec.items ?? []).some((i) => i.channelId === activeChannel.id)
										return (
											<button
												key={sec.id}
												type="button"
												onClick={() =>
													inSection
														? void removeChannelFromSection(api, sec.id, activeChannel.id)
														: void addChannelToSection(api, sec.id, activeChannel.id)
												}
												className={`flex w-full items-center justify-between rounded-md px-2 py-1 text-left text-xs hover:bg-accent ${
													inSection ? 'bg-primary/10 font-medium text-primary' : 'text-foreground'
												}`}
											>
												<span className="truncate">{sec.name}</span>
												{inSection ? <span>✓</span> : null}
											</button>
										)
									})}
								</PopoverContent>
							</Popover>
						) : null}

						<Popover>
							<PopoverTrigger asChild>
								<Button
									size="icon"
									tone="ghost"
									type="button"
									aria-label={activeChannel.muted ? t('chat.header.unmute') : t('chat.header.notifications')}
								>
									{activeChannel.muted ? (
										<BellOff className="size-4 text-muted-foreground" aria-hidden />
									) : (
										<Bell className="size-4 text-muted-foreground" aria-hidden />
									)}
								</Button>
							</PopoverTrigger>
							<PopoverContent align="end" className="w-56 space-y-1.5">
								<p className="text-xs font-semibold text-foreground">{t('chat.header.notifications')}</p>
								{(
									[
										['default', t('chat.header.notify.default')],
										['all', t('chat.header.notify.all')],
										['mentions', t('chat.header.notify.mentions')],
										['none', t('chat.header.notify.none')]
									] as const
								).map(([level, textLabel]) => (
									<button
										key={level}
										type="button"
										onClick={() =>
											void toggleMute(api, activeChannel.id, level === 'none', { notifyLevel: level })
										}
										className={`flex w-full items-center justify-between rounded-md px-2 py-1 text-left text-xs hover:bg-accent ${
											!activeChannel.muted && currentNotifyLevel === level
												? 'bg-primary/10 font-medium text-primary'
												: 'text-foreground'
										}`}
									>
										<span>{textLabel}</span>
										{!activeChannel.muted && currentNotifyLevel === level ? <span>✓</span> : null}
									</button>
								))}
								<div className="border-t border-border pt-1.5">
									<Button
										size="sm"
										tone="outline"
										type="button"
										className="w-full"
										onClick={() =>
											void toggleMute(api, activeChannel.id, !activeChannel.muted, {
												notifyLevel: activeChannel.muted ? 'default' : 'none'
											})
										}
									>
										{activeChannel.muted ? t('chat.header.unmute') : t('chat.header.mute-forever')}
									</Button>
								</div>
							</PopoverContent>
						</Popover>
					</div>
				</header>

				<ChannelBookmarksBar
					bookmarks={channelBookmarks}
					onAddBookmark={async (body) => {
						await addBookmark(api, activeChannel.id, body)
					}}
					onRemoveBookmark={(id) => removeBookmark(api, activeChannel.id, id)}
				/>

				{loadingMessages ? (
					<div className="flex-1 space-y-3 p-4">
						<Skeleton className="h-12 w-3/4" />
						<Skeleton className="h-12 w-2/3" />
					</div>
				) : (
					<MessageList
						messages={messages}
						currentUserId={currentUserId}
						highlightedMessageId={jumpedMessageId ?? highlightedMessageId}
						memberNamesById={memberNamesById}
						workspaceEmojis={workspaceEmojis}
						pollsById={pollsById}
						activeHuddleId={activeHuddle?.id ?? null}
						onReply={(parentId) => void openThread(api, parentId)}
						onEdit={async (messageId, bodyText, version) => {
							await editMessage(api, messageId, { bodyText, version })
						}}
						onDelete={(messageId) => deleteMessage(api, messageId)}
						onToggleReaction={(messageId, emoji, reacted) => toggleReaction(api, messageId, emoji, reacted)}
						onPin={(messageId) => pinMessage(api, activeChannel.id, messageId)}
						onQuote={(msg) => setQuotingMessage(msg)}
						onSave={handleSaveMessage}
						onForward={(msg) => setForwardingMessage(msg)}
						onCreateIssue={handleCreateIssueFromMessage}
						onMarkUnreadFromHere={(seq) => markUnreadFromMessage(activeChannel.id, seq)}
						onCopyLink={handleCopyPermalink}
						onVotePoll={(pollId, optionIds) => votePoll(api, activeChannel.id, pollId, optionIds)}
						onClosePoll={(pollId) => closePoll(api, activeChannel.id, pollId)}
						onJoinHuddle={async (huddleId) => {
							const joined = await api.joinChatHuddle(huddleId)
							pushToast({ title: t('chat.huddle.join'), description: joined.roomName, tone: 'success' })
						}}
						onEndHuddle={(huddleId) => endHuddle(api, activeChannel.id, huddleId)}
						onClickChannel={(channelName) => {
							const target = channels.find((c) => c.name === channelName)
							if (target) void selectChannel(api, target.id)
						}}
					/>
				)}

				<div className="border-t border-border bg-background px-4 pb-3 pt-1">
					<TypingIndicator
						channelId={activeChannel.id}
						currentUserId={currentUserId}
						memberNamesById={memberNamesById}
					/>
					<MessageComposer
						channelKey={activeChannel.id}
						initialDraftText={channelDraftText}
						quotingMessage={quotingMessage}
						onCancelQuote={() => setQuotingMessage(null)}
						channels={channels}
						members={autocompleteMembers}
						userGroups={userGroups}
						workspaceEmojis={workspaceEmojis}
						placeholder={t('chat.composer.placeholder', {
							target: activeChannel.kind === 'dm' ? label : `#${label}`
						})}
						disabled={Boolean(activeChannel.archivedAt)}
						onDraftChange={(txt) => saveDraft(api, activeChannel.id, { bodyText: txt })}
						onOpenPollDialog={() => setPollDialogOpen(true)}
						onSchedule={async (scheduledFor, bodyText, attachmentFileIds) => {
							await scheduleMessage(api, activeChannel.id, {
								scheduledFor,
								bodyText,
								...(attachmentFileIds.length > 0 ? { attachmentFileIds } : {})
							})
							pushToast({ title: t('chat.schedule.title'), tone: 'success' })
						}}
						onUploadFile={(file) => api.uploadFile(file)}
						onTyping={() => engine.sendTyping(activeChannel.id)}
						onSend={handleChannelSend}
					/>
				</div>
			</div>

			{pinsPanelOpen ? (
				<PinsPanel
					pins={channelPins}
					displayNameFor={(userId) => memberNamesById.get(userId) ?? userId}
					onJumpToMessage={handleJumpToMessage}
					onUnpin={async (messageId) => {
						await unpinMessage(api, activeChannel.id, messageId)
					}}
					onClose={() => setPinsPanelOpen(false)}
				/>
			) : null}

			{activeThread ? (
				<ThreadPanel
					parent={activeThread.parent}
					replies={activeThread.replies}
					currentUserId={currentUserId}
					memberNamesById={memberNamesById}
					workspaceEmojis={workspaceEmojis}
					channels={channels}
					members={autocompleteMembers}
					userGroups={userGroups}
					initialDraftText={threadDraftText}
					onDraftChange={(txt) =>
						saveDraft(api, activeChannel.id, {
							bodyText: txt,
							threadParentId: activeThread.parent.id
						})
					}
					onClose={closeThread}
					onUploadFile={(file) => api.uploadFile(file)}
					onSendReply={async (bodyText, attachmentFileIds, broadcastToChannel) => {
						await sendMessage(api, activeChannel.id, {
							bodyText,
							threadParentId: activeThread.parent.id,
							...(broadcastToChannel ? { broadcastToChannel: true } : {}),
							...(attachmentFileIds.length > 0 ? { attachmentFileIds } : {})
						})
					}}
					onEdit={async (messageId, bodyText, version) => {
						await editMessage(api, messageId, { bodyText, version })
					}}
					onDelete={(messageId) => deleteMessage(api, messageId)}
					onToggleReaction={(messageId, emoji, reacted) => toggleReaction(api, messageId, emoji, reacted)}
					onSave={handleSaveMessage}
					onForward={(msg) => setForwardingMessage(msg)}
					onCreateIssue={handleCreateIssueFromMessage}
					onCopyLink={handleCopyPermalink}
				/>
			) : null}

			<PollDialog
				open={pollDialogOpen}
				onOpenChange={setPollDialogOpen}
				onCreatePoll={async (body) => {
					await createPoll(api, activeChannel.id, body)
				}}
			/>

			<ForwardMessageDialog
				open={Boolean(forwardingMessage)}
				message={forwardingMessage}
				channels={channels}
				currentUserId={currentUserId}
				onOpenChange={(open) => {
					if (!open) setForwardingMessage(null)
				}}
				onForward={async (targetChannelId, note) => {
					if (!forwardingMessage) return
					await forwardMessage(api, forwardingMessage.id, {
						targetChannelId,
						...(note ? { bodyText: note } : {})
					})
					setForwardingMessage(null)
					pushToast({ title: t('chat.forward.title'), tone: 'success' })
				}}
			/>

			<CreateChannelDialog api={api} />
			<CreateDmDialog api={api} currentUserId={currentUserId} />
			<ChannelMembersDialog api={api} channel={activeChannel} />
		</div>
	)
}
