import type {
	BillingSummaryResponse,
	ChatChannelDto,
	ChatMessageDto,
	DocPageDetailDto,
	MobilePushPlatform,
	MobilePushTokenDto,
	NotificationPreferencesDto,
	SendMessageBody,
	UpdateNotificationPreferencesBody
} from '@huriro/contracts'

export interface MobileApiClientOptions {
	readonly serverUrl: string
	readonly workspaceId: string
	readonly platform?: 'ios' | 'android' | 'web' | undefined
	readonly getToken: () => string | null
	readonly fetchImpl?: typeof fetch | undefined
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
	private readonly baseUrl: string
	private readonly workspaceId: string
	private readonly platform: 'ios' | 'android' | 'web'
	private readonly getToken: () => string | null
	private readonly fetchImpl: typeof fetch

	constructor(opts: MobileApiClientOptions) {
		this.baseUrl = opts.serverUrl.replace(/\/$/, '')
		this.workspaceId = opts.workspaceId
		this.platform = opts.platform ?? 'ios'
		this.getToken = opts.getToken
		this.fetchImpl = opts.fetchImpl ?? fetch
	}

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

		const res = await this.fetchImpl(`${this.baseUrl}${path}`, {
			...init,
			credentials: 'omit',
			headers
		})
		if (!res.ok) {
			let code = 'request_failed'
			let message = `Request failed (${res.status})`
			try {
				const errBody = (await res.json()) as { code?: string; title?: string; detail?: string }
				if (errBody.code) code = errBody.code
				if (errBody.detail || errBody.title) message = errBody.detail ?? errBody.title ?? message
			} catch {
				// Ignore JSON parse errors on non-JSON failure responses
			}
			throw new MobileApiError(res.status, code, message)
		}
		if (res.status === 204) return undefined as T
		return (await res.json()) as T
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
		const res = await this.request<{ messages: ChatMessageDto[] }>(
			`/api/v1/chat/channels/${encodeURIComponent(channelId)}/messages?limit=50`
		)
		return res.messages
	}

	async sendMessage(channelId: string, body: SendMessageBody): Promise<ChatMessageDto> {
		return this.request<ChatMessageDto>(`/api/v1/chat/channels/${encodeURIComponent(channelId)}/messages`, {
			method: 'POST',
			body: JSON.stringify(body)
		})
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
