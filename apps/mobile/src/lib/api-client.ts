import type {
	AvailabilityWindowDto,
	BillingSummaryResponse,
	ChatChannelDto,
	ChatMessageDto,
	ChatPinnedMessageDto,
	ChatSavedItemBody,
	ChatSavedItemDto,
	CompleteDraftReviewBody,
	CreateAvailabilityWindowBody,
	CreateMailNoteBody,
	DocPageDetailDto,
	MailConversationDto,
	MailDraftDto,
	MailIdentityDto,
	MailInboxDto,
	MailMacroDto,
	MailNoteDto,
	MailRouteResultDto,
	MailTagDto,
	MailTemplateDto,
	MailTimelineDto,
	MobilePushPlatform,
	MobilePushTokenDto,
	NotificationPreferencesDto,
	RenderedMailTemplateDto,
	RenderMailTemplateBody,
	RequestDraftReviewBody,
	SendMailDraftBody,
	SendMessageBody,
	UpdateAvailabilityWindowBody,
	UpdateConversationBody,
	UpdateMyAvailabilityBody,
	UpdateNotificationPreferencesBody,
	UpdateUserStatusBody,
	UpsertMailDraftBody,
	UserAvailabilityDto,
	UserWorkspaceProfileDto
} from '@huriro/contracts'
import axios, { type AxiosInstance, type AxiosRequestConfig } from 'axios'

export interface MobileApiClientOptions {
	readonly serverUrl: string
	readonly workspaceId: string
	readonly platform?: 'ios' | 'android' | 'web' | undefined
	readonly getToken: () => string | null
	/** Test seam — injects a custom axios adapter instead of real network I/O. */
	readonly httpAdapter?: AxiosRequestConfig['adapter'] | undefined
}

export class MobileApiError extends Error {
	readonly status: number
	readonly code: string

	constructor(status: number, code: string, message: string) {
		super(message)
		this.name = 'MobileApiError'
		this.status = status
		this.code = code
	}
}

/**
 * Typed mobile API client. Always sends `x-huriro-client: huriro-mobile` +
 * `x-huriro-platform` so the server enforces mobile transport rules (including
 * rejecting mobile billing checkout with 403 `web_only_billing`).
 */
export class HuriroMobileApiClient {
	private readonly workspaceId: string
	private readonly platform: 'ios' | 'android' | 'web'
	private readonly getToken: () => string | null
	private readonly http: AxiosInstance

	constructor(opts: MobileApiClientOptions) {
		this.workspaceId = opts.workspaceId
		this.platform = opts.platform ?? 'ios'
		this.getToken = opts.getToken
		this.http = axios.create({
			baseURL: opts.serverUrl.replace(/\/$/, ''),
			// Mobile auth is bearer-only — never send cookies (fetch `credentials: 'omit'`).
			withCredentials: false,
			// Resolve on any HTTP status (fetch semantics); handlers branch on res.status.
			validateStatus: () => true,
			...(opts.httpAdapter ? { adapter: opts.httpAdapter } : {})
		})
	}

	// `init` keeps a fetch-shaped surface (method/headers/body-string) for the
	// method helpers below; transport is the shared axios instance.
	async request<T>(path: string, init?: RequestInit): Promise<T> {
		const token = this.getToken()
		const headers: Record<string, string> = {
			'content-type': 'application/json',
			'x-huriro-client': 'huriro-mobile',
			'x-huriro-platform': this.platform
		}
		if (this.workspaceId) headers['x-workspace-id'] = this.workspaceId
		if (token) headers['authorization'] = `Bearer ${token}`
		if (init?.headers) {
			const extra = new Headers(init.headers)
			extra.forEach((value, key) => {
				headers[key] = value
			})
		}

		const res = await this.http.request<T>({
			url: path,
			...(init?.method ? { method: init.method } : {}),
			data: init?.body,
			headers
		})
		if (res.status >= 300) {
			let code = 'request_failed'
			let message = `Request failed (${res.status})`
			if (typeof res.data === 'object' && res.data !== null) {
				const errBody = res.data as { code?: string; title?: string; detail?: string }
				if (errBody.code) code = errBody.code
				if (errBody.detail || errBody.title) message = errBody.detail ?? errBody.title ?? message
			}
			throw new MobileApiError(res.status, code, message)
		}
		if (res.status === 204) return undefined as T
		return res.data as T
	}

	async listWorkspaces(): Promise<{ readonly id: string; readonly slug: string; readonly name: string }[]> {
		const res = await this.request<{ data: { id: string; slug: string; name: string }[] }>(
			'/api/v1/workspaces/current'
		)
		return res.data
	}

	async listChannels(): Promise<ChatChannelDto[]> {
		const res = await this.request<{ data: ChatChannelDto[] }>('/api/v1/chat/channels')
		return res.data
	}

	async listMessages(channelId: string): Promise<ChatMessageDto[]> {
		const res = await this.request<{ data: ChatMessageDto[]; nextBeforeSeq?: number | null }>(
			`/api/v1/chat/channels/${encodeURIComponent(channelId)}/messages?limit=50`
		)
		return res.data ?? []
	}

	async sendMessage(channelId: string, body: SendMessageBody): Promise<ChatMessageDto> {
		return this.request<ChatMessageDto>(`/api/v1/chat/channels/${encodeURIComponent(channelId)}/messages`, {
			method: 'POST',
			body: JSON.stringify(body)
		})
	}

	async listPinnedMessages(channelId: string): Promise<ChatPinnedMessageDto[]> {
		const res = await this.request<{ data: ChatPinnedMessageDto[] }>(
			`/api/v1/chat/channels/${encodeURIComponent(channelId)}/pins`
		)
		return res.data ?? []
	}

	async pinMessage(messageId: string): Promise<unknown> {
		return this.request(`/api/v1/chat/messages/${encodeURIComponent(messageId)}/pin`, {
			method: 'POST'
		})
	}

	async unpinMessage(messageId: string): Promise<unknown> {
		return this.request(`/api/v1/chat/messages/${encodeURIComponent(messageId)}/pin`, {
			method: 'DELETE'
		})
	}

	async listSavedMessages(): Promise<ChatSavedItemDto[]> {
		const res = await this.request<{ data: ChatSavedItemDto[] }>('/api/v1/chat/saved')
		return res.data ?? []
	}

	async saveMessage(body: ChatSavedItemBody): Promise<ChatSavedItemDto> {
		return this.request<ChatSavedItemDto>('/api/v1/chat/saved', {
			method: 'POST',
			body: JSON.stringify(body)
		})
	}

	async unsaveMessage(savedItemId: string): Promise<unknown> {
		return this.request(`/api/v1/chat/saved/${encodeURIComponent(savedItemId)}`, {
			method: 'DELETE'
		})
	}

	async getMyStatus(): Promise<UserWorkspaceProfileDto> {
		return this.request<UserWorkspaceProfileDto>('/api/v1/chat/me/status')
	}

	async updateMyStatus(body: UpdateUserStatusBody): Promise<UserWorkspaceProfileDto> {
		return this.request<UserWorkspaceProfileDto>('/api/v1/chat/me/status', {
			method: 'PUT',
			body: JSON.stringify(body)
		})
	}

	async getMyAvailability(): Promise<UserAvailabilityDto> {
		return this.request<UserAvailabilityDto>('/api/v1/availability/me')
	}

	async listWorkspaceAvailability(): Promise<UserAvailabilityDto[]> {
		const res = await this.request<{ data: UserAvailabilityDto[] }>('/api/v1/availability')
		return res.data ?? []
	}

	async updateMyAvailability(body: UpdateMyAvailabilityBody): Promise<UserAvailabilityDto> {
		return this.request<UserAvailabilityDto>('/api/v1/availability/me', {
			method: 'PUT',
			body: JSON.stringify(body)
		})
	}

	async listAvailabilityWindows(): Promise<AvailabilityWindowDto[]> {
		const res = await this.request<{ data: AvailabilityWindowDto[] }>('/api/v1/availability/windows')
		return res.data ?? []
	}

	async createAvailabilityWindow(body: CreateAvailabilityWindowBody): Promise<AvailabilityWindowDto> {
		return this.request<AvailabilityWindowDto>('/api/v1/availability/windows', {
			method: 'POST',
			body: JSON.stringify(body)
		})
	}

	async deleteAvailabilityWindow(id: string): Promise<void> {
		await this.request(`/api/v1/availability/windows/${encodeURIComponent(id)}`, { method: 'DELETE' })
	}

	async updateAvailabilityWindow(
		id: string,
		body: UpdateAvailabilityWindowBody
	): Promise<AvailabilityWindowDto> {
		return this.request<AvailabilityWindowDto>(`/api/v1/availability/windows/${encodeURIComponent(id)}`, {
			method: 'PATCH',
			body: JSON.stringify(body)
		})
	}

	async listMailInboxes(): Promise<MailInboxDto[]> {
		const res = await this.request<{ data: MailInboxDto[] }>('/api/v1/mail/inboxes')
		return res.data ?? []
	}

	async listMailIdentities(accountId?: string): Promise<MailIdentityDto[]> {
		const qs = accountId ? `?accountId=${encodeURIComponent(accountId)}` : ''
		const res = await this.request<{ data: MailIdentityDto[] }>(`/api/v1/mail/identities${qs}`)
		return res.data ?? []
	}

	async listMailConversations(query?: {
		readonly inboxId?: string
		readonly status?: string
		readonly assignee?: string
		readonly q?: string
	}): Promise<{ readonly data: MailConversationDto[]; readonly nextCursor: string | null }> {
		const params = new URLSearchParams()
		if (query?.inboxId) params.set('inboxId', query.inboxId)
		if (query?.status) params.set('status', query.status)
		if (query?.assignee) params.set('assignee', query.assignee)
		if (query?.q) params.set('q', query.q)
		const qs = params.toString()
		return this.request<{ readonly data: MailConversationDto[]; readonly nextCursor: string | null }>(
			`/api/v1/mail/conversations${qs ? `?${qs}` : ''}`
		)
	}

	async getMailTimeline(conversationId: string): Promise<MailTimelineDto> {
		return this.request<MailTimelineDto>(
			`/api/v1/mail/conversations/${encodeURIComponent(conversationId)}/timeline`
		)
	}

	async updateMailConversation(
		conversationId: string,
		body: UpdateConversationBody
	): Promise<MailConversationDto> {
		return this.request<MailConversationDto>(
			`/api/v1/mail/conversations/${encodeURIComponent(conversationId)}`,
			{
				method: 'PATCH',
				body: JSON.stringify(body)
			}
		)
	}

	async createMailNote(conversationId: string, body: CreateMailNoteBody): Promise<MailNoteDto> {
		return this.request<MailNoteDto>(
			`/api/v1/mail/conversations/${encodeURIComponent(conversationId)}/notes`,
			{
				method: 'POST',
				body: JSON.stringify(body)
			}
		)
	}

	async listMailTags(inboxId?: string): Promise<MailTagDto[]> {
		const qs = inboxId ? `?inboxId=${encodeURIComponent(inboxId)}` : ''
		return this.request<MailTagDto[]>(`/api/v1/mail/tags${qs}`)
	}

	async listConversationTags(conversationId: string): Promise<MailTagDto[]> {
		return this.request<MailTagDto[]>(`/api/v1/mail/conversations/${encodeURIComponent(conversationId)}/tags`)
	}

	async setConversationTags(
		conversationId: string,
		tagIds: readonly string[]
	): Promise<{ readonly tagIds: readonly string[] }> {
		return this.request<{ readonly tagIds: readonly string[] }>(
			`/api/v1/mail/conversations/${encodeURIComponent(conversationId)}/tags`,
			{
				method: 'PUT',
				body: JSON.stringify({ tagIds })
			}
		)
	}

	async listMailTemplates(filter?: {
		readonly inboxId?: string
		readonly personal?: boolean
	}): Promise<MailTemplateDto[]> {
		const params = new URLSearchParams()
		if (filter?.inboxId) params.set('inboxId', filter.inboxId)
		if (filter?.personal !== undefined) params.set('personal', String(filter.personal))
		const qs = params.toString()
		return this.request<MailTemplateDto[]>(`/api/v1/mail/templates${qs ? `?${qs}` : ''}`)
	}

	async renderMailTemplate(
		templateId: string,
		body: RenderMailTemplateBody
	): Promise<RenderedMailTemplateDto> {
		return this.request<RenderedMailTemplateDto>(
			`/api/v1/mail/templates/${encodeURIComponent(templateId)}/render`,
			{
				method: 'POST',
				body: JSON.stringify(body)
			}
		)
	}

	async listMailMacros(inboxId?: string): Promise<MailMacroDto[]> {
		const qs = inboxId ? `?inboxId=${encodeURIComponent(inboxId)}` : ''
		return this.request<MailMacroDto[]>(`/api/v1/mail/macros${qs}`)
	}

	async applyMailMacro(
		macroId: string,
		conversationIds: readonly string[]
	): Promise<{ readonly appliedCount: number }> {
		return this.request<{ readonly appliedCount: number }>(
			`/api/v1/mail/macros/${encodeURIComponent(macroId)}/apply`,
			{
				method: 'POST',
				body: JSON.stringify({ conversationIds })
			}
		)
	}

	async upsertMailDraft(conversationId: string, body: UpsertMailDraftBody): Promise<MailDraftDto> {
		return this.request<MailDraftDto>(
			`/api/v1/mail/conversations/${encodeURIComponent(conversationId)}/drafts`,
			{
				method: 'POST',
				body: JSON.stringify(body)
			}
		)
	}

	async sendMailDraft(draftId: string, body?: SendMailDraftBody): Promise<MailDraftDto> {
		return this.request<MailDraftDto>(`/api/v1/mail/drafts/${encodeURIComponent(draftId)}/send`, {
			method: 'POST',
			body: JSON.stringify(body ?? {})
		})
	}

	async undoMailDraft(draftId: string): Promise<MailDraftDto> {
		return this.request<MailDraftDto>(`/api/v1/mail/drafts/${encodeURIComponent(draftId)}/undo`, {
			method: 'POST'
		})
	}

	async requestMailDraftReview(draftId: string, body: RequestDraftReviewBody): Promise<MailDraftDto> {
		return this.request<MailDraftDto>(`/api/v1/mail/drafts/${encodeURIComponent(draftId)}/review`, {
			method: 'POST',
			body: JSON.stringify(body)
		})
	}

	async completeMailDraftReview(draftId: string, body: CompleteDraftReviewBody): Promise<MailDraftDto> {
		return this.request<MailDraftDto>(`/api/v1/mail/drafts/${encodeURIComponent(draftId)}/review/complete`, {
			method: 'POST',
			body: JSON.stringify(body)
		})
	}

	async routeConversationRoundRobin(conversationId: string): Promise<MailRouteResultDto> {
		return this.request<MailRouteResultDto>(
			`/api/v1/mail/conversations/${encodeURIComponent(conversationId)}/route`,
			{ method: 'POST' }
		)
	}

	async getDocBySlug(slug: string): Promise<DocPageDetailDto> {
		return this.request<DocPageDetailDto>(`/api/v1/docs/by-slug/${encodeURIComponent(slug)}`)
	}

	async getNotificationPreferences(): Promise<NotificationPreferencesDto> {
		return this.request<NotificationPreferencesDto>('/api/v1/notifications/preferences')
	}

	async updateNotificationPreferences(
		body: UpdateNotificationPreferencesBody
	): Promise<NotificationPreferencesDto> {
		return this.request<NotificationPreferencesDto>('/api/v1/notifications/preferences', {
			method: 'PATCH',
			body: JSON.stringify(body)
		})
	}

	async registerMobilePushToken(args: {
		readonly token: string
		readonly platform: MobilePushPlatform
		readonly deviceId: string
		readonly deviceName?: string
	}): Promise<MobilePushTokenDto> {
		return this.request<MobilePushTokenDto>('/api/v1/notifications/push/mobile-tokens', {
			method: 'POST',
			body: JSON.stringify(args)
		})
	}

	async revokeMobilePushToken(id: string): Promise<void> {
		await this.request(`/api/v1/notifications/push/mobile-tokens/${encodeURIComponent(id)}`, {
			method: 'DELETE'
		})
	}

	/** Read-only workspace billing summary — checkout is strictly web-only. */
	async getBillingSummaryReadOnly(): Promise<BillingSummaryResponse | null> {
		try {
			return await this.request<BillingSummaryResponse>('/api/v1/billing/subscription')
		} catch (err) {
			if (err instanceof MobileApiError && (err.status === 404 || err.status === 403)) {
				return null
			}
			throw err
		}
	}
}
