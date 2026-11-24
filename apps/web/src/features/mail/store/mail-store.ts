import type {
	MailConversationDto,
	MailConversationStatus,
	MailDraftDto,
	MailInboxDto,
	MailTimelineDto,
	UpdateConversationBody,
	UpsertMailDraftBody
} from '@huriro/contracts'
import { create } from 'zustand'
import type { TaskApiBridge } from '@/lib/sync-bootstrap'

/** Sidebar buckets that map onto the server's `assignee`/`status` filter. */
export type MailNavView = 'all' | 'unassigned' | 'mine' | 'snoozed' | 'closed'

export interface MailStoreState {
	inboxes: MailInboxDto[]
	inboxesLoaded: boolean
	conversations: MailConversationDto[]
	nextCursor: string | null
	activeInboxId: string | null
	activeView: MailNavView
	searchQuery: string
	activeConversationId: string | null
	timeline: MailTimelineDto | null
	loading: boolean
	loadingTimeline: boolean
	loadingMore: boolean
	error: string | null
	/** Draft id of the most recently queued send (for the undo window). */
	lastSentDraftId: string | null
	lastSentAt: number | null

	loadInboxes: (api: TaskApiBridge) => Promise<void>
	loadConversations: (api: TaskApiBridge) => Promise<void>
	loadMore: (api: TaskApiBridge) => Promise<void>
	selectConversation: (api: TaskApiBridge, conversationId: string | null) => Promise<void>
	refreshTimeline: (api: TaskApiBridge) => Promise<void>
	setInbox: (api: TaskApiBridge, inboxId: string | null) => Promise<void>
	setView: (api: TaskApiBridge, view: MailNavView) => Promise<void>
	setSearchQuery: (api: TaskApiBridge, q: string) => Promise<void>
	patchConversation: (
		api: TaskApiBridge,
		conversationId: string,
		body: UpdateConversationBody
	) => Promise<void>
	addNote: (api: TaskApiBridge, conversationId: string, bodyText: string) => Promise<void>
	saveReplyDraft: (
		api: TaskApiBridge,
		conversationId: string,
		body: UpsertMailDraftBody
	) => Promise<MailDraftDto>
	sendDraft: (api: TaskApiBridge, draftId: string) => Promise<void>
	undoSend: (api: TaskApiBridge, draftId: string) => Promise<void>
	reset: () => void
}

function viewToAssignee(view: MailNavView): 'me' | 'unassigned' | undefined {
	if (view === 'mine') return 'me'
	if (view === 'unassigned') return 'unassigned'
	return undefined
}

function viewToStatus(view: MailNavView): MailConversationStatus | undefined {
	if (view === 'snoozed') return 'snoozed'
	if (view === 'closed') return 'closed'
	return undefined
}

function upsertConversation(
	list: readonly MailConversationDto[],
	item: MailConversationDto
): MailConversationDto[] {
	const idx = list.findIndex((c) => c.id === item.id)
	if (idx < 0) return [item, ...list]
	return list.map((c, i) => (i === idx ? item : c))
}

export const useMailStore = create<MailStoreState>((set, get) => ({
	inboxes: [],
	inboxesLoaded: false,
	conversations: [],
	nextCursor: null,
	activeInboxId: null,
	activeView: 'all',
	searchQuery: '',
	activeConversationId: null,
	timeline: null,
	loading: false,
	loadingTimeline: false,
	loadingMore: false,
	error: null,
	lastSentDraftId: null,
	lastSentAt: null,

	loadInboxes: async (api) => {
		try {
			const inboxes = await api.listMailInboxes()
			set({ inboxes, inboxesLoaded: true })
		} catch {
			// Inboxes are a secondary navigation aid — failure must not block the list.
			set({ inboxesLoaded: true })
		}
	},

	loadConversations: async (api) => {
		set({ loading: true, error: null })
		try {
			const { activeInboxId, activeView, searchQuery } = get()
			const res = await api.listMailConversations({
				inboxId: activeInboxId ?? undefined,
				status: viewToStatus(activeView),
				assignee: viewToAssignee(activeView),
				q: searchQuery || undefined
			})
			set({ conversations: res.data, nextCursor: res.nextCursor, loading: false })
		} catch (err) {
			set({
				loading: false,
				error: err instanceof Error ? err.message : 'Failed to load mail'
			})
		}
	},

	loadMore: async (api) => {
		const { nextCursor, loadingMore } = get()
		if (!nextCursor || loadingMore) return
		set({ loadingMore: true })
		try {
			const { activeInboxId, activeView, searchQuery } = get()
			const res = await api.listMailConversations({
				inboxId: activeInboxId ?? undefined,
				status: viewToStatus(activeView),
				assignee: viewToAssignee(activeView),
				q: searchQuery || undefined,
				cursor: nextCursor
			})
			set((s) => ({
				conversations: [...s.conversations, ...res.data],
				nextCursor: res.nextCursor,
				loadingMore: false
			}))
		} catch {
			set({ loadingMore: false })
		}
	},

	selectConversation: async (api, conversationId) => {
		set({ activeConversationId: conversationId, timeline: null })
		if (!conversationId) return
		set({ loadingTimeline: true })
		try {
			const timeline = await api.getMailTimeline(conversationId)
			set({ timeline, loadingTimeline: false })
		} catch {
			set({ loadingTimeline: false, error: 'timeline_failed' })
		}
	},

	refreshTimeline: async (api) => {
		const id = get().activeConversationId
		if (!id) return
		const timeline = await api.getMailTimeline(id)
		set({ timeline })
	},

	setInbox: async (api, inboxId) => {
		set({ activeInboxId: inboxId, activeView: 'all', activeConversationId: null, timeline: null })
		await get().loadConversations(api)
	},

	setView: async (api, view) => {
		set({ activeView: view, activeConversationId: null, timeline: null })
		await get().loadConversations(api)
	},

	setSearchQuery: async (api, q) => {
		set({ searchQuery: q })
		await get().loadConversations(api)
	},

	patchConversation: async (api, conversationId, body) => {
		const conv = get().timeline?.conversation
		const updated = await api.updateMailConversation(conversationId, {
			...body,
			...(conv ? { expectedVersion: conv.version } : {})
		})
		set((s) => ({
			conversations: upsertConversation(s.conversations, updated),
			timeline: s.timeline ? { ...s.timeline, conversation: updated } : s.timeline
		}))
	},

	addNote: async (api, conversationId, bodyText) => {
		await api.createMailNote(conversationId, { bodyText })
		await get().refreshTimeline(api)
	},

	saveReplyDraft: async (api, conversationId, body) => {
		const draft = await api.upsertMailDraft(conversationId, body)
		await get().refreshTimeline(api)
		return draft
	},

	sendDraft: async (api, draftId) => {
		await api.sendMailDraft(draftId, {})
		set({ lastSentDraftId: draftId, lastSentAt: Date.now() })
		await get().refreshTimeline(api)
	},

	undoSend: async (api, draftId) => {
		await api.undoMailDraft(draftId)
		set({ lastSentDraftId: null, lastSentAt: null })
		await get().refreshTimeline(api)
	},

	reset: () =>
		set({
			inboxes: [],
			inboxesLoaded: false,
			conversations: [],
			nextCursor: null,
			activeInboxId: null,
			activeView: 'all',
			searchQuery: '',
			activeConversationId: null,
			timeline: null,
			loading: false,
			loadingTimeline: false,
			loadingMore: false,
			error: null,
			lastSentDraftId: null,
			lastSentAt: null
		})
}))
