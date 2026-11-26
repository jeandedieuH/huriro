import type {
	ChatBookmarkBody,
	ChatChannelBookmarkDto,
	ChatChannelDto,
	ChatDraftBody,
	ChatDraftDto,
	ChatHuddleSessionDto,
	ChatMessageDto,
	ChatPinnedMessageDto,
	ChatPollDto,
	ChatSavedItemBody,
	ChatSavedItemDto,
	ChatScheduledMessageDto,
	ChatScheduleMessageBody,
	ChatSidebarSectionBody,
	ChatSidebarSectionDto,
	ChatThreadSummaryDto,
	CreateChannelBody,
	CreateDmBody,
	CreatePollBody,
	CreateUserGroupBody,
	CreateWorkspaceEmojiBody,
	ForwardMessageBody,
	SendMessageBody,
	UpdateChatSavedItemBody,
	UpdateChatSidebarSectionBody,
	UpdateMessageBody,
	UpdateUserStatusBody,
	UserGroupDto,
	UserWorkspaceProfileDto,
	WorkspaceEmojiDto
} from '@huriro/contracts'
import { create } from 'zustand'
import type { TaskApiBridge } from '@/lib/sync-bootstrap'

export type ChatNavView = 'channel' | 'threads' | 'unreads' | 'later' | 'drafts' | 'groups'

export interface ChatPresenceEntry {
	readonly userId: string
	readonly status: 'online' | 'away'
	readonly lastSeenAt: number
}

export interface ChatStoreState {
	channels: ChatChannelDto[]
	messagesByChannel: Record<string, ChatMessageDto[]>
	threadsByParent: Record<string, { readonly parent: ChatMessageDto; readonly replies: ChatMessageDto[] }>
	subscribedThreads: ChatThreadSummaryDto[]
	activeChannelId: string | null
	activeThreadParentId: string | null
	activeView: ChatNavView
	presenceByUser: Record<string, ChatPresenceEntry>
	typingByChannel: Record<string, Record<string, number>>
	pinsByChannel: Record<string, ChatPinnedMessageDto[]>
	pinsPanelOpen: boolean
	drafts: ChatDraftDto[]
	scheduledMessages: ChatScheduledMessageDto[]
	savedItems: ChatSavedItemDto[]
	sidebarSections: ChatSidebarSectionDto[]
	bookmarksByChannel: Record<string, ChatChannelBookmarkDto[]>
	myStatus: UserWorkspaceProfileDto | null
	userGroups: UserGroupDto[]
	workspaceEmojis: WorkspaceEmojiDto[]
	pollsByChannel: Record<string, ChatPollDto[]>
	activeHuddleByChannel: Record<string, ChatHuddleSessionDto | null>
	quotingMessage: ChatMessageDto | null
	forwardingMessage: ChatMessageDto | null
	pollDialogOpen: boolean
	bookmarkDialogOpen: boolean
	createChannelOpen: boolean
	createDmOpen: boolean
	membersDialogOpen: boolean
	loading: boolean
	loadingMessages: boolean
	error: string | null

	loadChannels: (api: TaskApiBridge) => Promise<void>
	loadChatV2Metadata: (api: TaskApiBridge) => Promise<void>
	loadSubscribedThreads: (api: TaskApiBridge) => Promise<void>
	selectChannel: (api: TaskApiBridge, channelId: string) => Promise<void>
	setActiveView: (view: ChatNavView) => void
	syncChannelDelta: (api: TaskApiBridge, channelId: string) => Promise<void>
	sendMessage: (api: TaskApiBridge, channelId: string, body: SendMessageBody) => Promise<ChatMessageDto>
	editMessage: (api: TaskApiBridge, messageId: string, body: UpdateMessageBody) => Promise<ChatMessageDto>
	deleteMessage: (api: TaskApiBridge, messageId: string) => Promise<void>
	toggleReaction: (
		api: TaskApiBridge,
		messageId: string,
		emoji: string,
		currentlyReacted: boolean
	) => Promise<void>
	loadPins: (api: TaskApiBridge, channelId: string) => Promise<void>
	pinMessage: (api: TaskApiBridge, channelId: string, messageId: string) => Promise<void>
	unpinMessage: (api: TaskApiBridge, channelId: string, messageId: string) => Promise<void>
	setPinsPanelOpen: (open: boolean) => void
	saveDraft: (api: TaskApiBridge, channelId: string, body: ChatDraftBody) => Promise<void>
	discardDraft: (api: TaskApiBridge, draftId: string) => Promise<void>
	scheduleMessage: (
		api: TaskApiBridge,
		channelId: string,
		body: ChatScheduleMessageBody
	) => Promise<ChatScheduledMessageDto>
	cancelScheduledMessage: (api: TaskApiBridge, id: string, version: number) => Promise<void>
	loadSavedItems: (api: TaskApiBridge) => Promise<void>
	saveItem: (api: TaskApiBridge, body: ChatSavedItemBody) => Promise<ChatSavedItemDto>
	updateSavedItem: (api: TaskApiBridge, id: string, body: UpdateChatSavedItemBody) => Promise<void>
	removeSavedItem: (api: TaskApiBridge, id: string) => Promise<void>
	createSidebarSection: (api: TaskApiBridge, body: ChatSidebarSectionBody) => Promise<ChatSidebarSectionDto>
	updateSidebarSection: (api: TaskApiBridge, id: string, body: UpdateChatSidebarSectionBody) => Promise<void>
	deleteSidebarSection: (api: TaskApiBridge, id: string) => Promise<void>
	addChannelToSection: (api: TaskApiBridge, sectionId: string, channelId: string) => Promise<void>
	removeChannelFromSection: (api: TaskApiBridge, sectionId: string, channelId: string) => Promise<void>
	loadBookmarks: (api: TaskApiBridge, channelId: string) => Promise<void>
	addBookmark: (
		api: TaskApiBridge,
		channelId: string,
		body: ChatBookmarkBody
	) => Promise<ChatChannelBookmarkDto>
	removeBookmark: (api: TaskApiBridge, channelId: string, id: string) => Promise<void>
	updateMyStatus: (api: TaskApiBridge, body: UpdateUserStatusBody) => Promise<UserWorkspaceProfileDto>
	createUserGroup: (api: TaskApiBridge, body: CreateUserGroupBody) => Promise<UserGroupDto>
	setUserGroupMembers: (api: TaskApiBridge, groupId: string, memberIds: readonly string[]) => Promise<void>
	createWorkspaceEmoji: (api: TaskApiBridge, body: CreateWorkspaceEmojiBody) => Promise<WorkspaceEmojiDto>
	deleteWorkspaceEmoji: (api: TaskApiBridge, id: string) => Promise<void>
	loadPolls: (api: TaskApiBridge, channelId: string) => Promise<void>
	createPoll: (api: TaskApiBridge, channelId: string, body: CreatePollBody) => Promise<ChatPollDto>
	votePoll: (
		api: TaskApiBridge,
		channelId: string,
		pollId: string,
		optionIds: readonly string[]
	) => Promise<void>
	closePoll: (api: TaskApiBridge, channelId: string, pollId: string) => Promise<void>
	forwardMessage: (api: TaskApiBridge, messageId: string, body: ForwardMessageBody) => Promise<ChatMessageDto>
	loadActiveHuddle: (api: TaskApiBridge, channelId: string) => Promise<void>
	startHuddle: (api: TaskApiBridge, channelId: string) => Promise<ChatHuddleSessionDto>
	endHuddle: (api: TaskApiBridge, channelId: string, huddleId: string) => Promise<void>
	markUnreadFromMessage: (channelId: string, channelSeq: number) => void
	openThread: (api: TaskApiBridge, parentId: string) => Promise<void>
	closeThread: () => void
	toggleMute: (
		api: TaskApiBridge,
		channelId: string,
		muted: boolean,
		opts?: {
			readonly notifyLevel?: 'default' | 'all' | 'mentions' | 'none'
			readonly mutedUntil?: string | null
		}
	) => Promise<void>
	createChannel: (api: TaskApiBridge, body: CreateChannelBody) => Promise<ChatChannelDto>
	createDm: (api: TaskApiBridge, body: CreateDmBody) => Promise<ChatChannelDto>
	refreshChannelDetail: (api: TaskApiBridge, channelId: string) => Promise<void>
	setQuotingMessage: (msg: ChatMessageDto | null) => void
	setForwardingMessage: (msg: ChatMessageDto | null) => void
	setPollDialogOpen: (open: boolean) => void
	setBookmarkDialogOpen: (open: boolean) => void
	setCreateChannelOpen: (open: boolean) => void
	setCreateDmOpen: (open: boolean) => void
	setMembersDialogOpen: (open: boolean) => void
	applyPresence: (users: readonly ChatPresenceEntry[]) => void
	applyTyping: (ev: { readonly channelId: string; readonly userId: string; readonly until: number }) => void
	handleChatSignal: (
		api: TaskApiBridge,
		ev: { readonly channelId: string; readonly rev: number; readonly lastMsgSeq: number }
	) => Promise<void>
	handleResume: (api: TaskApiBridge) => Promise<void>
	reset: () => void
}

function mergeMessageIntoList(list: readonly ChatMessageDto[], msg: ChatMessageDto): ChatMessageDto[] {
	const idx = list.findIndex((m) => m.id === msg.id)
	if (msg.deletedAt !== null) {
		return idx >= 0 ? list.filter((m) => m.id !== msg.id) : [...list]
	}
	if (idx >= 0) {
		return list.map((m, i) => (i === idx ? msg : m))
	}
	return [...list, msg].sort((a, b) => (a.channelSeq ?? 0) - (b.channelSeq ?? 0))
}

export const useChatStore = create<ChatStoreState>((set, get) => ({
	channels: [],
	messagesByChannel: {},
	threadsByParent: {},
	subscribedThreads: [],
	activeChannelId: null,
	activeThreadParentId: null,
	activeView: 'channel',
	presenceByUser: {},
	typingByChannel: {},
	pinsByChannel: {},
	pinsPanelOpen: false,
	drafts: [],
	scheduledMessages: [],
	savedItems: [],
	sidebarSections: [],
	bookmarksByChannel: {},
	myStatus: null,
	userGroups: [],
	workspaceEmojis: [],
	pollsByChannel: {},
	activeHuddleByChannel: {},
	quotingMessage: null,
	forwardingMessage: null,
	pollDialogOpen: false,
	bookmarkDialogOpen: false,
	createChannelOpen: false,
	createDmOpen: false,
	membersDialogOpen: false,
	loading: false,
	loadingMessages: false,
	error: null,

	loadChannels: async (api) => {
		set({ loading: true, error: null })
		try {
			const channels = await api.listChannels()
			const currentActive = get().activeChannelId
			const stillExists = currentActive ? channels.some((c) => c.id === currentActive) : false
			const nextActive = stillExists ? currentActive : (channels[0]?.id ?? null)
			set({ channels, activeChannelId: nextActive, loading: false })
			void get().loadChatV2Metadata(api)
			if (nextActive && !get().messagesByChannel[nextActive]) {
				await get().selectChannel(api, nextActive)
			}
		} catch (err) {
			set({
				loading: false,
				error: err instanceof Error ? err.message : 'Failed to load chat channels'
			})
		}
	},

	loadChatV2Metadata: async (api) => {
		const [drafts, scheduled, saved, sections, status, groups, emojis] = await Promise.allSettled([
			api.listChatDrafts(),
			api.listScheduledChatMessages(),
			api.listSavedChatItems(),
			api.listChatSidebarSections(),
			api.getMyChatStatus(),
			api.listUserGroups(),
			api.listWorkspaceEmojis()
		])
		set({
			...(drafts.status === 'fulfilled' ? { drafts: drafts.value } : {}),
			...(scheduled.status === 'fulfilled' ? { scheduledMessages: scheduled.value } : {}),
			...(saved.status === 'fulfilled' ? { savedItems: saved.value } : {}),
			...(sections.status === 'fulfilled' ? { sidebarSections: sections.value } : {}),
			...(status.status === 'fulfilled' ? { myStatus: status.value } : {}),
			...(groups.status === 'fulfilled' ? { userGroups: groups.value } : {}),
			...(emojis.status === 'fulfilled' ? { workspaceEmojis: emojis.value } : {})
		})
	},

	loadSubscribedThreads: async (api) => {
		try {
			const subscribedThreads = await api.listThreads()
			set({ subscribedThreads })
		} catch {
			// Ignore transient error in preview
		}
	},

	selectChannel: async (api, channelId) => {
		void get().loadPins(api, channelId)
		void get().loadBookmarks(api, channelId)
		void get().loadPolls(api, channelId)
		void get().loadActiveHuddle(api, channelId)
		set({
			activeChannelId: channelId,
			activeView: 'channel',
			loadingMessages: true,
			error: null,
			quotingMessage: null
		})
		try {
			const [detail, res] = await Promise.all([api.getChannel(channelId), api.listMessages(channelId)])
			set((s) => ({
				channels: s.channels.map((c) => (c.id === channelId ? detail : c)),
				messagesByChannel: { ...s.messagesByChannel, [channelId]: res.data },
				loadingMessages: false
			}))
			if (detail.lastMsgSeq > detail.lastReadSeq) {
				const readRes = await api.markChannelRead(channelId, detail.lastMsgSeq).catch(() => null)
				if (readRes) {
					set((s) => ({
						channels: s.channels.map((c) =>
							c.id === channelId
								? {
										...c,
										lastReadSeq: readRes.lastReadSeq,
										unreadCount: readRes.unreadCount,
										hasUnread: readRes.unreadCount > 0,
										mentionCount: 0
									}
								: c
						)
					}))
				}
			}
		} catch (err) {
			set({
				loadingMessages: false,
				error: err instanceof Error ? err.message : 'Failed to load channel messages'
			})
		}
	},

	setActiveView: (activeView) => set({ activeView }),

	syncChannelDelta: async (api, channelId) => {
		const channel = get().channels.find((c) => c.id === channelId)
		const since = channel?.lastRev ?? 0
		try {
			const delta = await api.listChannelChanges(channelId, since)
			if (delta.changes.length === 0) return
			set((s) => {
				let topLevel = s.messagesByChannel[channelId] ?? []
				const nextThreads = { ...s.threadsByParent }

				for (const msg of delta.changes) {
					if (msg.threadParentId === null || msg.broadcastToChannel) {
						topLevel = mergeMessageIntoList(topLevel, msg)
						const thread = nextThreads[msg.id]
						if (thread) {
							nextThreads[msg.id] = { ...thread, parent: msg }
						}
					}
					if (msg.threadParentId !== null) {
						const entry = nextThreads[msg.threadParentId]
						if (!entry) continue
						const replies =
							msg.deletedAt !== null
								? entry.replies.filter((r) => r.id !== msg.id)
								: entry.replies.some((r) => r.id === msg.id)
									? entry.replies.map((r) => (r.id === msg.id ? msg : r))
									: [...entry.replies, msg]
						nextThreads[msg.threadParentId] = { ...entry, replies }
					}
				}

				return {
					messagesByChannel: { ...s.messagesByChannel, [channelId]: topLevel },
					threadsByParent: nextThreads,
					channels: s.channels.map((c) =>
						c.id === channelId
							? {
									...c,
									lastRev: delta.nextRev,
									lastMsgSeq: delta.lastMsgSeq,
									hasUnread: s.activeChannelId === channelId ? false : delta.lastMsgSeq > c.lastReadSeq
								}
							: c
					)
				}
			})
			void get().loadPolls(api, channelId)
		} catch {
			// Poll fallback retries automatically
		}
	},

	sendMessage: async (api, channelId, body) => {
		const msg = await api.sendMessage(channelId, body)
		set((s) => {
			const threadParentId = msg.threadParentId
			const isBroadcast = threadParentId !== null && msg.broadcastToChannel

			if (threadParentId === null) {
				const list = mergeMessageIntoList(s.messagesByChannel[channelId] ?? [], msg)
				return {
					quotingMessage: null,
					messagesByChannel: { ...s.messagesByChannel, [channelId]: list },
					channels: s.channels.map((c) =>
						c.id === channelId
							? {
									...c,
									lastMsgSeq: Math.max(c.lastMsgSeq, msg.channelSeq ?? c.lastMsgSeq),
									lastRev: Math.max(c.lastRev, msg.rev),
									lastReadSeq: Math.max(c.lastReadSeq, msg.channelSeq ?? c.lastReadSeq),
									unreadCount: 0,
									hasUnread: false
								}
							: c
					)
				}
			}

			const existingThread = s.threadsByParent[threadParentId]
			let updatedTopLevel = (s.messagesByChannel[channelId] ?? []).map((m) =>
				m.id === threadParentId ? { ...m, replyCount: m.replyCount + 1, lastReplyAt: msg.createdAt } : m
			)
			if (isBroadcast) {
				updatedTopLevel = mergeMessageIntoList(updatedTopLevel, msg)
			}
			const nextThreads = existingThread
				? {
						...s.threadsByParent,
						[threadParentId]: {
							parent: {
								...existingThread.parent,
								replyCount: existingThread.parent.replyCount + 1,
								lastReplyAt: msg.createdAt
							},
							replies: existingThread.replies.some((r) => r.id === msg.id)
								? existingThread.replies
								: [...existingThread.replies, msg]
						}
					}
				: s.threadsByParent

			return {
				quotingMessage: null,
				messagesByChannel: { ...s.messagesByChannel, [channelId]: updatedTopLevel },
				threadsByParent: nextThreads,
				...(isBroadcast
					? {
							channels: s.channels.map((c) =>
								c.id === channelId
									? {
											...c,
											lastMsgSeq: Math.max(c.lastMsgSeq, msg.channelSeq ?? c.lastMsgSeq),
											lastRev: Math.max(c.lastRev, msg.rev),
											lastReadSeq: Math.max(c.lastReadSeq, msg.channelSeq ?? c.lastReadSeq)
										}
									: c
							)
						}
					: {})
			}
		})
		return msg
	},

	editMessage: async (api, messageId, body) => {
		const updated = await api.updateMessage(messageId, body)
		set((s) => {
			const list = (s.messagesByChannel[updated.channelId] ?? []).map((m) =>
				m.id === updated.id ? updated : m
			)
			const nextThreads = { ...s.threadsByParent }
			const parentId = updated.threadParentId
			const parentEntry = parentId ? nextThreads[parentId] : undefined
			if (parentId && parentEntry) {
				nextThreads[parentId] = {
					...parentEntry,
					replies: parentEntry.replies.map((r) => (r.id === updated.id ? updated : r))
				}
			} else {
				const thread = nextThreads[updated.id]
				if (thread) {
					nextThreads[updated.id] = { ...thread, parent: updated }
				}
			}
			return {
				messagesByChannel: { ...s.messagesByChannel, [updated.channelId]: list },
				threadsByParent: nextThreads
			}
		})
		return updated
	},

	deleteMessage: async (api, messageId) => {
		const deleted = await api.deleteMessage(messageId)
		set((s) => {
			const list = (s.messagesByChannel[deleted.channelId] ?? []).filter((m) => m.id !== deleted.id)
			const nextThreads = { ...s.threadsByParent }
			const parentId = deleted.threadParentId
			const parentEntry = parentId ? nextThreads[parentId] : undefined
			if (parentId && parentEntry) {
				nextThreads[parentId] = {
					...parentEntry,
					replies: parentEntry.replies.filter((r) => r.id !== deleted.id)
				}
			}
			return {
				messagesByChannel: { ...s.messagesByChannel, [deleted.channelId]: list },
				threadsByParent: nextThreads
			}
		})
	},

	toggleReaction: async (api, messageId, emoji, currentlyReacted) => {
		const updated = currentlyReacted
			? await api.removeReaction(messageId, emoji)
			: await api.addReaction(messageId, emoji)
		set((s) => {
			const list = (s.messagesByChannel[updated.channelId] ?? []).map((m) =>
				m.id === updated.id ? updated : m
			)
			const nextThreads = { ...s.threadsByParent }
			const parentId = updated.threadParentId
			const parentEntry = parentId ? nextThreads[parentId] : undefined
			if (parentId && parentEntry) {
				nextThreads[parentId] = {
					...parentEntry,
					replies: parentEntry.replies.map((r) => (r.id === updated.id ? updated : r))
				}
			} else {
				const thread = nextThreads[updated.id]
				if (thread) {
					nextThreads[updated.id] = { ...thread, parent: updated }
				}
			}
			return {
				messagesByChannel: { ...s.messagesByChannel, [updated.channelId]: list },
				threadsByParent: nextThreads
			}
		})
	},

	loadPins: async (api, channelId) => {
		try {
			const pins = await api.listPinnedMessages(channelId)
			set((state) => ({ pinsByChannel: { ...state.pinsByChannel, [channelId]: pins } }))
		} catch {
			// Pins are best-effort
		}
	},
	pinMessage: async (api, channelId, messageId) => {
		await api.pinMessage(messageId)
		await get().loadPins(api, channelId)
	},
	unpinMessage: async (api, channelId, messageId) => {
		await api.unpinMessage(messageId)
		set((state) => ({
			pinsByChannel: {
				...state.pinsByChannel,
				[channelId]: (state.pinsByChannel[channelId] ?? []).filter((pin) => pin.messageId !== messageId)
			}
		}))
	},
	setPinsPanelOpen: (open) => {
		set({ pinsPanelOpen: open })
	},

	saveDraft: async (api, channelId, body) => {
		const res = await api.upsertChatDraft(channelId, body)
		set((s) => {
			const targetThread = body.threadParentId ?? null
			const filtered = s.drafts.filter(
				(d) => !(d.channelId === channelId && (d.threadParentId ?? null) === targetThread)
			)
			if ('deleted' in res && res.deleted) {
				return { drafts: filtered }
			}
			return { drafts: [res as ChatDraftDto, ...filtered] }
		})
	},
	discardDraft: async (api, draftId) => {
		await api.deleteChatDraft(draftId)
		set((s) => ({ drafts: s.drafts.filter((d) => d.id !== draftId) }))
	},
	scheduleMessage: async (api, channelId, body) => {
		const created = await api.scheduleChatMessage(channelId, body)
		set((s) => ({ scheduledMessages: [...s.scheduledMessages, created] }))
		return created
	},
	cancelScheduledMessage: async (api, id, version) => {
		const updated = await api.cancelScheduledChatMessage(id, version)
		set((s) => ({
			scheduledMessages: s.scheduledMessages.map((item) =>
				item.id === id
					? { ...item, status: updated.status as ChatScheduledMessageDto['status'], version: updated.version }
					: item
			)
		}))
	},

	loadSavedItems: async (api) => {
		const savedItems = await api.listSavedChatItems()
		set({ savedItems })
	},
	saveItem: async (api, body) => {
		const created = await api.createSavedChatItem(body)
		set((s) => ({ savedItems: [created, ...s.savedItems.filter((item) => item.id !== created.id)] }))
		return created
	},
	updateSavedItem: async (api, id, body) => {
		const updated = await api.updateSavedChatItem(id, body)
		set((s) => ({
			savedItems: s.savedItems.map((item) => (item.id === id ? { ...item, ...updated } : item))
		}))
	},
	removeSavedItem: async (api, id) => {
		await api.deleteSavedChatItem(id)
		set((s) => ({ savedItems: s.savedItems.filter((item) => item.id !== id) }))
	},

	createSidebarSection: async (api, body) => {
		const created = await api.createChatSidebarSection(body)
		const withItems: ChatSidebarSectionDto = { ...created, items: created.items ?? [] }
		set((s) => ({ sidebarSections: [...s.sidebarSections, withItems] }))
		return withItems
	},
	updateSidebarSection: async (api, id, body) => {
		const updated = await api.updateChatSidebarSection(id, body)
		set((s) => ({
			sidebarSections: s.sidebarSections.map((sec) => (sec.id === id ? { ...sec, ...updated } : sec))
		}))
	},
	deleteSidebarSection: async (api, id) => {
		await api.deleteChatSidebarSection(id)
		set((s) => ({ sidebarSections: s.sidebarSections.filter((sec) => sec.id !== id) }))
	},
	addChannelToSection: async (api, sectionId, channelId) => {
		const item = await api.addChatSidebarSectionItem(sectionId, { channelId })
		set((s) => ({
			sidebarSections: s.sidebarSections.map((sec) => {
				if (sec.id !== sectionId) return sec
				const rest = (sec.items ?? []).filter((i) => i.channelId !== channelId)
				return { ...sec, items: [...rest, item] }
			})
		}))
	},
	removeChannelFromSection: async (api, sectionId, channelId) => {
		await api.removeChatSidebarSectionItem(sectionId, channelId)
		set((s) => ({
			sidebarSections: s.sidebarSections.map((sec) =>
				sec.id === sectionId
					? { ...sec, items: (sec.items ?? []).filter((i) => i.channelId !== channelId) }
					: sec
			)
		}))
	},

	loadBookmarks: async (api, channelId) => {
		try {
			const items = await api.listChannelBookmarks(channelId)
			set((s) => ({ bookmarksByChannel: { ...s.bookmarksByChannel, [channelId]: items } }))
		} catch {
			// Best-effort per channel
		}
	},
	addBookmark: async (api, channelId, body) => {
		const created = await api.createChannelBookmark(channelId, body)
		set((s) => ({
			bookmarksByChannel: {
				...s.bookmarksByChannel,
				[channelId]: [...(s.bookmarksByChannel[channelId] ?? []), created]
			}
		}))
		return created
	},
	removeBookmark: async (api, channelId, id) => {
		await api.deleteChannelBookmark(id)
		set((s) => ({
			bookmarksByChannel: {
				...s.bookmarksByChannel,
				[channelId]: (s.bookmarksByChannel[channelId] ?? []).filter((b) => b.id !== id)
			}
		}))
	},

	updateMyStatus: async (api, body) => {
		const updated = await api.updateMyChatStatus(body)
		set({ myStatus: updated })
		return updated
	},

	createUserGroup: async (api, body) => {
		const created = await api.createUserGroup(body)
		const normalized: UserGroupDto = { ...created, memberIds: created.memberIds ?? body.memberIds ?? [] }
		set((s) => ({ userGroups: [...s.userGroups, normalized] }))
		return normalized
	},
	setUserGroupMembers: async (api, groupId, memberIds) => {
		const res = await api.setUserGroupMembers(groupId, memberIds)
		set((s) => ({
			userGroups: s.userGroups.map((g) => (g.id === groupId ? { ...g, memberIds: [...res.memberIds] } : g))
		}))
	},

	createWorkspaceEmoji: async (api, body) => {
		const created = await api.createWorkspaceEmoji(body)
		set((s) => ({ workspaceEmojis: [...s.workspaceEmojis, created] }))
		return created
	},
	deleteWorkspaceEmoji: async (api, id) => {
		await api.deleteWorkspaceEmoji(id)
		set((s) => ({ workspaceEmojis: s.workspaceEmojis.filter((e) => e.id !== id) }))
	},

	loadPolls: async (api, channelId) => {
		try {
			const polls = await api.listChannelPolls(channelId)
			set((s) => ({ pollsByChannel: { ...s.pollsByChannel, [channelId]: polls } }))
		} catch {
			// Best-effort
		}
	},
	createPoll: async (api, channelId, body) => {
		const created = await api.createChatPoll(channelId, body)
		set((s) => {
			const nextPolls = [
				...(s.pollsByChannel[channelId] ?? []),
				{
					...created,
					totalVotes: created.totalVotes ?? 0,
					counts: created.counts ?? {},
					voters: created.voters ?? []
				}
			]
			const msg = created.message
			if (!msg) {
				return { pollsByChannel: { ...s.pollsByChannel, [channelId]: nextPolls } }
			}
			const list =
				msg.threadParentId === null || msg.broadcastToChannel
					? mergeMessageIntoList(s.messagesByChannel[channelId] ?? [], msg)
					: (s.messagesByChannel[channelId] ?? [])
			return {
				pollsByChannel: { ...s.pollsByChannel, [channelId]: nextPolls },
				messagesByChannel: { ...s.messagesByChannel, [channelId]: list }
			}
		})
		return created
	},
	votePoll: async (api, channelId, pollId, optionIds) => {
		await api.voteChatPoll(pollId, { optionIds: [...optionIds] })
		const fresh = await api.getChatPoll(pollId)
		set((s) => ({
			pollsByChannel: {
				...s.pollsByChannel,
				[channelId]: (s.pollsByChannel[channelId] ?? []).map((p) => (p.id === pollId ? fresh : p))
			}
		}))
	},
	closePoll: async (api, channelId, pollId) => {
		await api.closeChatPoll(pollId)
		set((s) => ({
			pollsByChannel: {
				...s.pollsByChannel,
				[channelId]: (s.pollsByChannel[channelId] ?? []).map((p) =>
					p.id === pollId ? { ...p, status: 'closed' } : p
				)
			}
		}))
	},

	forwardMessage: async (api, messageId, body) => {
		const sent = await api.forwardChatMessage(messageId, body)
		set((s) => {
			const target = body.targetChannelId
			const existing = s.messagesByChannel[target]
			return {
				forwardingMessage: null,
				...(existing
					? { messagesByChannel: { ...s.messagesByChannel, [target]: mergeMessageIntoList(existing, sent) } }
					: {})
			}
		})
		return sent
	},

	loadActiveHuddle: async (api, channelId) => {
		try {
			const huddle = await api.getActiveChannelHuddle(channelId)
			set((s) => ({ activeHuddleByChannel: { ...s.activeHuddleByChannel, [channelId]: huddle } }))
		} catch {
			// Huddles might be disabled
		}
	},
	startHuddle: async (api, channelId) => {
		const huddle = await api.startChatHuddle(channelId)
		set((s) => ({ activeHuddleByChannel: { ...s.activeHuddleByChannel, [channelId]: huddle } }))
		await get().syncChannelDelta(api, channelId)
		return huddle
	},
	endHuddle: async (api, channelId, huddleId) => {
		await api.endChatHuddle(huddleId)
		set((s) => ({ activeHuddleByChannel: { ...s.activeHuddleByChannel, [channelId]: null } }))
		await get().syncChannelDelta(api, channelId)
	},

	markUnreadFromMessage: (channelId, channelSeq) => {
		const nextLastRead = Math.max(0, channelSeq - 1)
		set((s) => ({
			channels: s.channels.map((c) => {
				if (c.id !== channelId) return c
				const unreadCount = Math.max(1, c.lastMsgSeq - nextLastRead)
				return { ...c, lastReadSeq: nextLastRead, unreadCount, hasUnread: true }
			})
		}))
	},

	openThread: async (api, parentId) => {
		set({ activeThreadParentId: parentId })
		const res = await api.listThread(parentId)
		set((s) => ({
			threadsByParent: { ...s.threadsByParent, [parentId]: res }
		}))
	},

	closeThread: () => set({ activeThreadParentId: null }),

	toggleMute: async (api, channelId, muted, opts) => {
		const res = await api.updateChannelMute(channelId, muted, opts)
		set((s) => ({
			channels: s.channels.map((c) =>
				c.id === channelId
					? {
							...c,
							muted: res.muted,
							...(res.notifyLevel !== undefined ? { notifyLevel: res.notifyLevel } : {}),
							...(res.mutedUntil !== undefined ? { mutedUntil: res.mutedUntil } : {})
						}
					: c
			)
		}))
	},

	createChannel: async (api, body) => {
		const created = await api.createChannel(body)
		set((s) => ({
			channels: [...s.channels, created],
			createChannelOpen: false
		}))
		await get().selectChannel(api, created.id)
		return created
	},

	createDm: async (api, body) => {
		const dm = await api.createOrGetDm(body)
		set((s) => {
			const exists = s.channels.some((c) => c.id === dm.id)
			return {
				channels: exists ? s.channels.map((c) => (c.id === dm.id ? dm : c)) : [...s.channels, dm],
				createDmOpen: false
			}
		})
		await get().selectChannel(api, dm.id)
		return dm
	},

	refreshChannelDetail: async (api, channelId) => {
		const detail = await api.getChannel(channelId)
		set((s) => ({
			channels: s.channels.map((c) => (c.id === channelId ? detail : c))
		}))
	},

	setQuotingMessage: (quotingMessage) => set({ quotingMessage }),
	setForwardingMessage: (forwardingMessage) => set({ forwardingMessage }),
	setPollDialogOpen: (pollDialogOpen) => set({ pollDialogOpen }),
	setBookmarkDialogOpen: (bookmarkDialogOpen) => set({ bookmarkDialogOpen }),
	setCreateChannelOpen: (createChannelOpen) => set({ createChannelOpen }),
	setCreateDmOpen: (createDmOpen) => set({ createDmOpen }),
	setMembersDialogOpen: (membersDialogOpen) => set({ membersDialogOpen }),

	applyPresence: (users) => {
		const map: Record<string, ChatPresenceEntry> = {}
		for (const u of users) map[u.userId] = u
		set({ presenceByUser: map })
	},

	applyTyping: (ev) =>
		set((s) => ({
			typingByChannel: {
				...s.typingByChannel,
				[ev.channelId]: {
					...(s.typingByChannel[ev.channelId] ?? {}),
					[ev.userId]: ev.until
				}
			}
		})),

	handleChatSignal: async (api, ev) => {
		const state = get()
		if (state.activeChannelId === ev.channelId) {
			await state.syncChannelDelta(api, ev.channelId)
			await api.markChannelRead(ev.channelId, ev.lastMsgSeq).catch(() => {})
			return
		}
		const channels = await api.listChannels().catch(() => null)
		if (channels) set({ channels })
	},

	handleResume: async (api) => {
		const state = get()
		if (state.channels.length === 0 && !state.activeChannelId) return
		const activeId = state.activeChannelId
		if (activeId) {
			await state.syncChannelDelta(api, activeId)
		}
		const channels = await api.listChannels().catch(() => null)
		if (!channels) return
		set({ channels })
		if (activeId && get().activeChannelId === activeId) {
			const active = channels.find((c) => c.id === activeId)
			if (active && active.lastMsgSeq > active.lastReadSeq) {
				const readRes = await api.markChannelRead(activeId, active.lastMsgSeq).catch(() => null)
				if (readRes) {
					set((s) => ({
						channels: s.channels.map((c) =>
							c.id === activeId
								? {
										...c,
										lastReadSeq: readRes.lastReadSeq,
										unreadCount: readRes.unreadCount,
										hasUnread: readRes.unreadCount > 0,
										mentionCount: 0
									}
								: c
						)
					}))
				}
			}
		}
	},

	reset: () =>
		set({
			channels: [],
			messagesByChannel: {},
			threadsByParent: {},
			subscribedThreads: [],
			activeChannelId: null,
			activeThreadParentId: null,
			activeView: 'channel',
			presenceByUser: {},
			typingByChannel: {},
			pinsByChannel: {},
			pinsPanelOpen: false,
			drafts: [],
			scheduledMessages: [],
			savedItems: [],
			sidebarSections: [],
			bookmarksByChannel: {},
			myStatus: null,
			userGroups: [],
			workspaceEmojis: [],
			pollsByChannel: {},
			activeHuddleByChannel: {},
			quotingMessage: null,
			forwardingMessage: null,
			pollDialogOpen: false,
			bookmarkDialogOpen: false,
			createChannelOpen: false,
			createDmOpen: false,
			membersDialogOpen: false,
			loading: false,
			loadingMessages: false,
			error: null
		})
}))

export function selectTotalChatUnread(state: ChatStoreState): number {
	return state.channels.reduce((sum, ch) => (ch.muted ? sum : sum + ch.unreadCount), 0)
}
