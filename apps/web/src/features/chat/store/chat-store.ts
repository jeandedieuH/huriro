import type {
	ChatChannelDto,
	ChatMessageDto,
	ChatThreadSummaryDto,
	CreateChannelBody,
	CreateDmBody,
	SendMessageBody,
	UpdateMessageBody
} from '@huriro/contracts'
import { create } from 'zustand'
import type { TaskApiBridge } from '@/lib/sync-bootstrap'

export type ChatNavView = 'channel' | 'threads' | 'unreads'

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
	createChannelOpen: boolean
	createDmOpen: boolean
	membersDialogOpen: boolean
	loading: boolean
	loadingMessages: boolean
	error: string | null

	loadChannels: (api: TaskApiBridge) => Promise<void>
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
	openThread: (api: TaskApiBridge, parentId: string) => Promise<void>
	closeThread: () => void
	toggleMute: (api: TaskApiBridge, channelId: string, muted: boolean) => Promise<void>
	createChannel: (api: TaskApiBridge, body: CreateChannelBody) => Promise<ChatChannelDto>
	createDm: (api: TaskApiBridge, body: CreateDmBody) => Promise<ChatChannelDto>
	refreshChannelDetail: (api: TaskApiBridge, channelId: string) => Promise<void>
	setCreateChannelOpen: (open: boolean) => void
	setCreateDmOpen: (open: boolean) => void
	setMembersDialogOpen: (open: boolean) => void
	applyPresence: (users: readonly ChatPresenceEntry[]) => void
	applyTyping: (ev: { readonly channelId: string; readonly userId: string; readonly until: number }) => void
	handleChatSignal: (
		api: TaskApiBridge,
		ev: { readonly channelId: string; readonly rev: number; readonly lastMsgSeq: number }
	) => Promise<void>
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

	loadSubscribedThreads: async (api) => {
		try {
			const subscribedThreads = await api.listThreads()
			set({ subscribedThreads })
		} catch {
			// Ignore transient error in preview
		}
	},

	selectChannel: async (api, channelId) => {
		set({ activeChannelId: channelId, activeView: 'channel', loadingMessages: true, error: null })
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
					if (msg.threadParentId === null) {
						topLevel = mergeMessageIntoList(topLevel, msg)
						if (nextThreads[msg.id]) {
							nextThreads[msg.id] = { ...nextThreads[msg.id]!, parent: msg }
						}
					} else if (nextThreads[msg.threadParentId]) {
						const entry = nextThreads[msg.threadParentId]!
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
		} catch {
			// Poll fallback retries automatically
		}
	},

	sendMessage: async (api, channelId, body) => {
		const msg = await api.sendMessage(channelId, body)
		set((s) => {
			if (msg.threadParentId === null) {
				const list = mergeMessageIntoList(s.messagesByChannel[channelId] ?? [], msg)
				return {
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

			const existingThread = s.threadsByParent[msg.threadParentId]
			const updatedTopLevel = (s.messagesByChannel[channelId] ?? []).map((m) =>
				m.id === msg.threadParentId ? { ...m, replyCount: m.replyCount + 1, lastReplyAt: msg.createdAt } : m
			)
			const nextThreads = existingThread
				? {
						...s.threadsByParent,
						[msg.threadParentId]: {
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
				messagesByChannel: { ...s.messagesByChannel, [channelId]: updatedTopLevel },
				threadsByParent: nextThreads
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
			if (updated.threadParentId && nextThreads[updated.threadParentId]) {
				const entry = nextThreads[updated.threadParentId]!
				nextThreads[updated.threadParentId] = {
					...entry,
					replies: entry.replies.map((r) => (r.id === updated.id ? updated : r))
				}
			} else if (nextThreads[updated.id]) {
				nextThreads[updated.id] = { ...nextThreads[updated.id]!, parent: updated }
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
			if (deleted.threadParentId && nextThreads[deleted.threadParentId]) {
				const entry = nextThreads[deleted.threadParentId]!
				nextThreads[deleted.threadParentId] = {
					...entry,
					replies: entry.replies.filter((r) => r.id !== deleted.id)
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
			if (updated.threadParentId && nextThreads[updated.threadParentId]) {
				const entry = nextThreads[updated.threadParentId]!
				nextThreads[updated.threadParentId] = {
					...entry,
					replies: entry.replies.map((r) => (r.id === updated.id ? updated : r))
				}
			} else if (nextThreads[updated.id]) {
				nextThreads[updated.id] = { ...nextThreads[updated.id]!, parent: updated }
			}
			return {
				messagesByChannel: { ...s.messagesByChannel, [updated.channelId]: list },
				threadsByParent: nextThreads
			}
		})
	},

	openThread: async (api, parentId) => {
		set({ activeThreadParentId: parentId })
		const res = await api.listThread(parentId)
		set((s) => ({
			threadsByParent: { ...s.threadsByParent, [parentId]: res }
		}))
	},

	closeThread: () => set({ activeThreadParentId: null }),

	toggleMute: async (api, channelId, muted) => {
		const res = await api.updateChannelMute(channelId, muted)
		set((s) => ({
			channels: s.channels.map((c) => (c.id === channelId ? { ...c, muted: res.muted } : c))
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
