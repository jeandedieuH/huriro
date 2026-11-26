import type {
	AiMailAssistMode,
	AiMailAssistResponse,
	CompleteDraftReviewBody,
	ContactBody,
	ContactDto,
	ContactOrganizationBody,
	ContactOrganizationDto,
	CreateOutboundConversationBody,
	ForwardConversationBody,
	MailBulkTriageBody,
	MailConversationDto,
	MailConversationStatus,
	MailDraftDto,
	MailInboxDto,
	MailInboxSettingsBody,
	MailMacroDto,
	MailRoutingConfigDto,
	MailSlaAnalyticsDto,
	MailSlaPolicyDto,
	MailSplitTabDto,
	MailTagBody,
	MailTagDto,
	MailTemplateDto,
	MailTimelineDto,
	RequestDraftReviewBody,
	SplitConversationBody,
	UpdateConversationBody,
	UpsertMailDraftBody
} from '@huriro/contracts'
import { create } from 'zustand'
import type { TaskApiBridge } from '@/lib/sync-bootstrap'

/** Sidebar buckets that map onto the server's `assignee`/`status` filter. */
export type MailNavView = 'all' | 'unassigned' | 'mine' | 'snoozed' | 'closed'

export function parseInboxSplitTabs(settings: Record<string, unknown> | undefined): MailSplitTabDto[] {
	const raw = settings?.['split_tabs']
	if (!Array.isArray(raw)) return []
	const out: MailSplitTabDto[] = []
	for (const item of raw) {
		if (!item || typeof item !== 'object' || Array.isArray(item)) continue
		const rec = item as Record<string, unknown>
		const id = typeof rec['id'] === 'string' ? rec['id'] : ''
		const name = typeof rec['name'] === 'string' ? rec['name'] : ''
		if (!id || !name) continue
		out.push({
			id,
			name,
			status: typeof rec['status'] === 'string' ? (rec['status'] as MailConversationStatus) : undefined,
			assignee:
				rec['assignee'] === 'me' || rec['assignee'] === 'unassigned' || rec['assignee'] === 'all'
					? rec['assignee']
					: undefined,
			tagId: typeof rec['tagId'] === 'string' ? rec['tagId'] : null
		})
	}
	return out
}

export interface MailStoreState {
	inboxes: MailInboxDto[]
	inboxesLoaded: boolean
	conversations: MailConversationDto[]
	nextCursor: string | null
	activeInboxId: string | null
	activeView: MailNavView
	activeTagId: string | null
	activeSplitTabId: string | null
	searchQuery: string
	activeConversationId: string | null
	timeline: MailTimelineDto | null
	tags: MailTagDto[]
	tagsByConversation: Record<string, MailTagDto[]>
	templates: MailTemplateDto[]
	macros: MailMacroDto[]
	contacts: ContactDto[]
	organizations: ContactOrganizationDto[]
	routingConfigByInbox: Record<string, MailRoutingConfigDto>
	slaPolicies: MailSlaPolicyDto[]
	slaAnalytics: MailSlaAnalyticsDto | null
	selectedConversationIds: string[]
	contactSidebarOpen: boolean
	composeOpen: boolean
	forwardOpen: boolean
	aiAssistResult: AiMailAssistResponse | null
	aiAssistLoading: boolean
	aiAssistError: string | null
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
	setActiveTagId: (api: TaskApiBridge, tagId: string | null) => Promise<void>
	setActiveSplitTabId: (api: TaskApiBridge, tabId: string | null) => Promise<void>
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
	updateReplyDraft: (api: TaskApiBridge, draftId: string, body: UpsertMailDraftBody) => Promise<MailDraftDto>
	sendDraft: (api: TaskApiBridge, draftId: string) => Promise<void>
	scheduleDraftSend: (
		api: TaskApiBridge,
		draftId: string,
		scheduledSendAt: string,
		expectedVersion?: number
	) => Promise<void>
	undoSend: (api: TaskApiBridge, draftId: string) => Promise<void>
	loadMailV2Metadata: (api: TaskApiBridge, inboxId?: string | null) => Promise<void>
	loadConversationTags: (api: TaskApiBridge, conversationId: string) => Promise<void>
	createTag: (api: TaskApiBridge, body: MailTagBody) => Promise<MailTagDto>
	deleteTag: (api: TaskApiBridge, id: string) => Promise<void>
	deleteTemplate: (api: TaskApiBridge, id: string) => Promise<void>
	deleteMacro: (api: TaskApiBridge, id: string) => Promise<void>
	deleteSlaPolicy: (api: TaskApiBridge, id: string) => Promise<void>
	setConversationTags: (
		api: TaskApiBridge,
		conversationId: string,
		tagIds: readonly string[]
	) => Promise<void>
	renderTemplate: (
		api: TaskApiBridge,
		templateId: string,
		variables?: Record<string, string>
	) => Promise<string>
	applyMacro: (api: TaskApiBridge, macroId: string, conversationIds: readonly string[]) => Promise<void>
	createOutbound: (api: TaskApiBridge, body: CreateOutboundConversationBody) => Promise<string>
	forwardConversation: (
		api: TaskApiBridge,
		conversationId: string,
		body: ForwardConversationBody
	) => Promise<string>
	splitConversation: (
		api: TaskApiBridge,
		conversationId: string,
		body: SplitConversationBody
	) => Promise<string>
	toggleSelectConversation: (conversationId: string) => void
	clearSelection: () => void
	bulkTriage: (api: TaskApiBridge, body: Omit<MailBulkTriageBody, 'conversationIds'>) => Promise<void>
	upsertContact: (api: TaskApiBridge, body: ContactBody, id?: string) => Promise<ContactDto>
	upsertOrganization: (
		api: TaskApiBridge,
		body: ContactOrganizationBody,
		id?: string
	) => Promise<ContactOrganizationDto>
	updateInboxSettings: (
		api: TaskApiBridge,
		inboxId: string,
		body: MailInboxSettingsBody
	) => Promise<MailInboxDto>
	routeRoundRobin: (api: TaskApiBridge, conversationId: string) => Promise<string | null>
	requestDraftReview: (api: TaskApiBridge, draftId: string, body: RequestDraftReviewBody) => Promise<void>
	completeDraftReview: (api: TaskApiBridge, draftId: string, body: CompleteDraftReviewBody) => Promise<void>
	assistWithAi: (
		api: TaskApiBridge,
		conversationId: string,
		mode: AiMailAssistMode,
		instruction?: string
	) => Promise<AiMailAssistResponse | null>
	clearAiAssist: () => void
	setContactSidebarOpen: (open: boolean) => void
	setComposeOpen: (open: boolean) => void
	setForwardOpen: (open: boolean) => void
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

function resolveConversationQuery(state: MailStoreState) {
	const inbox = state.activeInboxId ? state.inboxes.find((i) => i.id === state.activeInboxId) : undefined
	const splitTabs = inbox
		? parseInboxSplitTabs(inbox.settings)
		: state.inboxes.flatMap((i) => parseInboxSplitTabs(i.settings))
	const splitTab = state.activeSplitTabId
		? splitTabs.find((tab) => tab.id === state.activeSplitTabId)
		: undefined
	const status = splitTab?.status ?? viewToStatus(state.activeView)
	const assignee =
		splitTab?.assignee && splitTab.assignee !== 'all'
			? splitTab.assignee
			: splitTab?.assignee === 'all'
				? undefined
				: viewToAssignee(state.activeView)
	const tagId = state.activeTagId ?? splitTab?.tagId ?? undefined
	return {
		inboxId: state.activeInboxId ?? undefined,
		status,
		assignee,
		tagId,
		q: state.searchQuery || undefined
	}
}

export const useMailStore = create<MailStoreState>((set, get) => ({
	inboxes: [],
	inboxesLoaded: false,
	conversations: [],
	nextCursor: null,
	activeInboxId: null,
	activeView: 'all',
	activeTagId: null,
	activeSplitTabId: null,
	searchQuery: '',
	activeConversationId: null,
	timeline: null,
	tags: [],
	tagsByConversation: {},
	templates: [],
	macros: [],
	contacts: [],
	organizations: [],
	routingConfigByInbox: {},
	slaPolicies: [],
	slaAnalytics: null,
	selectedConversationIds: [],
	contactSidebarOpen: false,
	composeOpen: false,
	forwardOpen: false,
	aiAssistResult: null,
	aiAssistLoading: false,
	aiAssistError: null,
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
			const res = await api.listMailConversations(resolveConversationQuery(get()))
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
			const res = await api.listMailConversations({
				...resolveConversationQuery(get()),
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
		set({
			activeConversationId: conversationId,
			timeline: null,
			aiAssistResult: null,
			aiAssistError: null
		})
		if (!conversationId) return
		set({ loadingTimeline: true })
		try {
			const [timeline, convTags] = await Promise.all([
				api.getMailTimeline(conversationId),
				api.listConversationTags(conversationId).catch(() => [] as MailTagDto[])
			])
			set((s) => ({
				timeline,
				loadingTimeline: false,
				tagsByConversation: { ...s.tagsByConversation, [conversationId]: convTags }
			}))
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
		set({
			activeInboxId: inboxId,
			activeView: 'all',
			activeSplitTabId: null,
			activeConversationId: null,
			timeline: null
		})
		await get().loadConversations(api)
	},

	setView: async (api, view) => {
		set({ activeView: view, activeSplitTabId: null, activeConversationId: null, timeline: null })
		await get().loadConversations(api)
	},

	setActiveTagId: async (api, tagId) => {
		set({ activeTagId: tagId, activeConversationId: null, timeline: null })
		await get().loadConversations(api)
	},

	setActiveSplitTabId: async (api, tabId) => {
		set({ activeSplitTabId: tabId, activeConversationId: null, timeline: null })
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

	updateReplyDraft: async (api, draftId, body) => {
		const draft = await api.updateMailDraft(draftId, body)
		await get().refreshTimeline(api)
		return draft
	},

	sendDraft: async (api, draftId) => {
		await api.sendMailDraft(draftId, {})
		set({ lastSentDraftId: draftId, lastSentAt: Date.now() })
		await get().refreshTimeline(api)
	},

	scheduleDraftSend: async (api, draftId, scheduledSendAt, expectedVersion) => {
		await api.sendMailDraft(draftId, {
			scheduledSendAt,
			...(expectedVersion !== undefined ? { expectedVersion } : {})
		})
		set({ lastSentDraftId: null, lastSentAt: null })
		await get().refreshTimeline(api)
	},

	undoSend: async (api, draftId) => {
		await api.undoMailDraft(draftId)
		set({ lastSentDraftId: null, lastSentAt: null })
		await get().refreshTimeline(api)
	},

	loadMailV2Metadata: async (api, inboxId) => {
		const targetInboxId = inboxId ?? undefined
		try {
			const [tags, templates, macros, contacts, organizations, slaPolicies, slaAnalytics] = await Promise.all(
				[
					api.listMailTags(targetInboxId),
					api.listMailTemplates({ inboxId: targetInboxId }),
					api.listMailMacros(targetInboxId),
					api.listContacts(),
					api.listContactOrganizations(),
					api.listMailSlaPolicies(targetInboxId),
					api.getMailSlaAnalytics(targetInboxId)
				]
			)
			set({ tags, templates, macros, contacts, organizations, slaPolicies, slaAnalytics })
			if (targetInboxId) {
				const routing = await api.getMailRoutingConfig(targetInboxId)
				set((s) => ({
					routingConfigByInbox: { ...s.routingConfigByInbox, [targetInboxId]: routing }
				}))
			}
		} catch {
			// Secondary metadata failures must not block the primary mail list.
		}
	},

	loadConversationTags: async (api, conversationId) => {
		const convTags = await api.listConversationTags(conversationId)
		set((s) => ({
			tagsByConversation: { ...s.tagsByConversation, [conversationId]: convTags }
		}))
	},

	createTag: async (api, body) => {
		const created = await api.createMailTag(body)
		set((s) => ({ tags: [...s.tags, created] }))
		return created
	},

	deleteTag: async (api, id) => {
		await api.deleteMailTag(id)
		set((s) => ({
			tags: s.tags.filter((item) => item.id !== id),
			activeTagId: s.activeTagId === id ? null : s.activeTagId,
			tagsByConversation: Object.fromEntries(
				Object.entries(s.tagsByConversation).map(([cId, list]) => [
					cId,
					list.filter((item) => item.id !== id)
				])
			)
		}))
	},

	deleteTemplate: async (api, id) => {
		await api.deleteMailTemplate(id)
		set((s) => ({ templates: s.templates.filter((item) => item.id !== id) }))
	},

	deleteMacro: async (api, id) => {
		await api.deleteMailMacro(id)
		set((s) => ({ macros: s.macros.filter((item) => item.id !== id) }))
	},

	deleteSlaPolicy: async (api, id) => {
		await api.deleteMailSlaPolicy(id)
		set((s) => ({ slaPolicies: s.slaPolicies.filter((item) => item.id !== id) }))
	},

	setConversationTags: async (api, conversationId, tagIds) => {
		const res = await api.setConversationTags(conversationId, { tagIds: [...tagIds] })
		const allowed = new Set(res.tagIds)
		const resolved = get().tags.filter((tag) => allowed.has(tag.id))
		set((s) => ({
			tagsByConversation: { ...s.tagsByConversation, [conversationId]: resolved },
			conversations: s.conversations.map((c) =>
				c.id === conversationId ? { ...c, tagIds: [...res.tagIds] } : c
			)
		}))
	},

	renderTemplate: async (api, templateId, variables) => {
		const res = await api.renderMailTemplate(templateId, { variables: variables ?? {} })
		return res.bodyText
	},

	applyMacro: async (api, macroId, conversationIds) => {
		await api.applyMailMacro(macroId, { conversationIds: [...conversationIds] })
		await Promise.all([
			get().loadConversations(api),
			...conversationIds.map((id) => get().loadConversationTags(api, id)),
			get().refreshTimeline(api)
		])
	},

	createOutbound: async (api, body) => {
		const res = await api.createOutboundConversation(body)
		await get().loadConversations(api)
		await get().selectConversation(api, res.conversationId)
		return res.conversationId
	},

	forwardConversation: async (api, conversationId, body) => {
		const res = await api.forwardConversation(conversationId, body)
		await get().loadConversations(api)
		await get().selectConversation(api, res.conversationId)
		return res.conversationId
	},

	splitConversation: async (api, conversationId, body) => {
		const res = await api.splitConversation(conversationId, body)
		await get().loadConversations(api)
		await get().selectConversation(api, res.conversationId)
		return res.conversationId
	},

	toggleSelectConversation: (conversationId) => {
		set((s) => {
			const exists = s.selectedConversationIds.includes(conversationId)
			return {
				selectedConversationIds: exists
					? s.selectedConversationIds.filter((id) => id !== conversationId)
					: [...s.selectedConversationIds, conversationId]
			}
		})
	},

	clearSelection: () => {
		set({ selectedConversationIds: [] })
	},

	bulkTriage: async (api, body) => {
		const ids = get().selectedConversationIds
		if (ids.length === 0) return
		await api.bulkTriageConversations({ conversationIds: ids, ...body })
		set({ selectedConversationIds: [] })
		await Promise.all([
			get().loadConversations(api),
			...ids.map((id) => get().loadConversationTags(api, id)),
			get().refreshTimeline(api)
		])
	},

	upsertContact: (api, body, id) => {
		return api.upsertContact(body, id).then((contact) => {
			set((s) => {
				const idx = s.contacts.findIndex((c) => c.id === contact.id)
				return {
					contacts: idx >= 0 ? s.contacts.map((c, i) => (i === idx ? contact : c)) : [contact, ...s.contacts]
				}
			})
			return contact
		})
	},

	upsertOrganization: async (api, body, id) => {
		const org = await api.upsertContactOrganization(body, id)
		set((s) => {
			const idx = s.organizations.findIndex((o) => o.id === org.id)
			return {
				organizations:
					idx >= 0 ? s.organizations.map((o, i) => (i === idx ? org : o)) : [org, ...s.organizations]
			}
		})
		return org
	},

	updateInboxSettings: async (api, inboxId, body) => {
		const updated = await api.updateMailInboxSettings(inboxId, body)
		set((s) => ({
			inboxes: s.inboxes.map((inbox) => (inbox.id === inboxId ? updated : inbox))
		}))
		return updated
	},

	routeRoundRobin: async (api, conversationId) => {
		const res = await api.routeConversationRoundRobin(conversationId)
		await Promise.all([get().loadConversations(api), get().refreshTimeline(api)])
		return res.assignedUserId
	},

	requestDraftReview: async (api, draftId, body) => {
		await api.requestMailDraftReview(draftId, body)
		await get().refreshTimeline(api)
	},

	completeDraftReview: async (api, draftId, body) => {
		await api.completeMailDraftReview(draftId, body)
		await get().refreshTimeline(api)
	},

	assistWithAi: async (api, conversationId, mode, instruction) => {
		set({ aiAssistLoading: true, aiAssistError: null })
		try {
			const res = await api.assistMailWithAi({
				conversationId,
				mode,
				...(instruction?.trim() ? { instruction: instruction.trim() } : {})
			})
			set({ aiAssistResult: res, aiAssistLoading: false })
			return res
		} catch (err) {
			set({
				aiAssistLoading: false,
				aiAssistError: err instanceof Error ? err.message : 'AI assist unavailable'
			})
			return null
		}
	},

	clearAiAssist: () => {
		set({ aiAssistResult: null, aiAssistError: null })
	},

	setContactSidebarOpen: (open) => {
		set({ contactSidebarOpen: open })
	},

	setComposeOpen: (open) => {
		set({ composeOpen: open })
	},

	setForwardOpen: (open) => {
		set({ forwardOpen: open })
	},

	reset: () =>
		set({
			inboxes: [],
			inboxesLoaded: false,
			conversations: [],
			nextCursor: null,
			activeInboxId: null,
			activeView: 'all',
			activeTagId: null,
			activeSplitTabId: null,
			searchQuery: '',
			activeConversationId: null,
			timeline: null,
			tags: [],
			tagsByConversation: {},
			templates: [],
			macros: [],
			contacts: [],
			organizations: [],
			routingConfigByInbox: {},
			slaPolicies: [],
			slaAnalytics: null,
			selectedConversationIds: [],
			contactSidebarOpen: false,
			composeOpen: false,
			forwardOpen: false,
			aiAssistResult: null,
			aiAssistLoading: false,
			aiAssistError: null,
			loading: false,
			loadingTimeline: false,
			loadingMore: false,
			error: null,
			lastSentDraftId: null,
			lastSentAt: null
		})
}))
