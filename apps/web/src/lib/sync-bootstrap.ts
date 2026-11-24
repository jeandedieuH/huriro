/**
 * Workspace bootstrap & auxiliary HTTP/preview API bridge.
 *
 * Online: attaches `HttpSyncTransport` + `WsSignalClient` to live server endpoints.
 * Standalone preview / unit tests (no authenticated server): seeds an offline-first
 * local preview replica so all M1 workflows operate without blocking spinners (§9.5).
 */
import type {
	AgentApprovalDto,
	AgentPrincipalDto,
	AiProviderDto,
	AiSettingsResponse,
	BillingPortalDto,
	BillingSummaryResponse,
	ChannelChangesResponse,
	ChatChannelDto,
	ChatChannelMemberDto,
	ChatMessageDto,
	ChatThreadSummaryDto,
	CheckoutSessionDto,
	CollabTicketResponse,
	CreateWebhookResponse,
	DocCommentDto,
	DocExportMarkdownResponse,
	DocPageDetailDto,
	DocPageDto,
	DocVersionDetailDto,
	DocVersionDto,
	EraseAccountResponse,
	FileDto,
	GithubInstallationDto,
	ImportDryRunPreviewDto,
	ImportJobDto,
	IssueCommentDto,
	IssueGithubLinkDto,
	IssueRelationDto,
	ListMessagesResponse,
	MailAccountDto,
	MailConversationDto,
	MailDraftDto,
	MailIdentityDto,
	MailInboxDto,
	MailNoteDto,
	MailTimelineDto,
	NotificationPreferencesDto,
	SearchResponse,
	WebhookDeliveryDto,
	WebhookEndpointDto,
	WebPushSubscriptionDto,
	WorkspaceExportDto
} from '@huriro/contracts'
import { generateUuidV7, HttpSyncTransport, HuriroSyncEngine, type ReplicaStorage } from '@huriro/sync-client'
import { useUiStore } from '@/stores/ui-store'
import type {
	AgentApiKeyDto,
	BootResult,
	BootstrappedWorkspace,
	CreatedApiKeyDto,
	ListApprovalsResult,
	ResourceAclItemDto,
	TaskApiBridge
} from './api-bridge'
import { PREVIEW_USER_ID } from './api-bridge'
import type { SocialProviderId } from './auth'
import { env } from './env'

export type {
	AgentApiKeyDto,
	ApprovalStatusFilter,
	AuthRequired,
	BootResult,
	BootstrappedWorkspace,
	CreateApiKeyBody,
	CreatedApiKeyDto,
	ListApprovalsResult,
	OnboardingRequired,
	ResourceAclItemDto,
	TaskApiBridge,
	WorkspaceMemberSummary
} from './api-bridge'
// The bridge contract (TaskApiBridge, boot gates, preview ids) lives in
// ./api-bridge — extracted so the lazy preview-workspace import below stays a
// one-directional edge (§7.2, no-circular). Re-exported so existing
// '@/lib/sync-bootstrap' consumer imports keep working.
export {
	isAuthRequired,
	isOnboardingRequired,
	PREVIEW_PROJECT_ENG_ID,
	PREVIEW_PROJECT_SEC_ID,
	PREVIEW_USER_ID,
	PREVIEW_WORKSPACE_ID
} from './api-bridge'

// Validated client env — unset means same-origin (dev proxy / single ingress).
const API_BASE = env.VITE_API_URL ?? ''

function createLiveApiBridge(workspaceId: string): TaskApiBridge {
	async function apiFetch<T>(path: string, init?: RequestInit): Promise<T> {
		const res = await fetch(`${API_BASE}${path}`, {
			credentials: 'include',
			...init,
			headers: {
				'content-type': 'application/json',
				'x-workspace-id': workspaceId,
				'x-huriro-client': 'huriro-web',
				...init?.headers
			}
		})
		if (!res.ok) {
			let problemBody: { code?: string; type?: string; detail?: string; title?: string } | null = null
			try {
				problemBody = (await res.json()) as { code?: string; type?: string; detail?: string; title?: string }
			} catch {
				problemBody = null
			}
			if (
				res.status === 503 &&
				(problemBody?.code === 'read_only_mode' || problemBody?.type?.includes('read_only_mode'))
			) {
				useUiStore.getState().setServerReadOnly(true)
			}
			throw new Error(
				problemBody?.detail ?? problemBody?.title ?? `Request to ${path} failed (${res.status})`
			)
		}
		return (await res.json()) as T
	}

	return {
		async listMembers() {
			const res = await apiFetch<{
				data: { userId: string; displayName: string; email: string; roleKey: string }[]
			}>('/api/v1/members')
			return res.data.map((m) => ({
				userId: m.userId,
				displayName: m.displayName,
				email: m.email,
				role: m.roleKey
			}))
		},
		async listComments(issueId) {
			const data = await apiFetch<{ comments: IssueCommentDto[] }>(
				`/api/v1/issues/${encodeURIComponent(issueId)}`
			)
			return data.comments
		},
		async createComment(issueId, bodyText) {
			return apiFetch<IssueCommentDto>(`/api/v1/issues/${encodeURIComponent(issueId)}/comments`, {
				method: 'POST',
				headers: { 'idempotency-key': generateUuidV7() },
				body: JSON.stringify({ body: bodyText, bodyText })
			})
		},
		async listRelations(issueId) {
			const data = await apiFetch<{ relations: IssueRelationDto[] }>(
				`/api/v1/issues/${encodeURIComponent(issueId)}`
			)
			return data.relations
		},
		async createRelation(issueId, targetIssueId, kind) {
			return apiFetch<IssueRelationDto>(`/api/v1/issues/${encodeURIComponent(issueId)}/relations`, {
				method: 'POST',
				headers: { 'idempotency-key': generateUuidV7() },
				body: JSON.stringify({ targetIssueId, kind })
			})
		},
		async searchIssues(query) {
			const data = await apiFetch<SearchResponse>(`/api/v1/search?q=${encodeURIComponent(query)}`)
			return data.hits
		},
		async markAllNotificationsRead() {
			await apiFetch('/api/v1/notifications/read-all', {
				method: 'POST',
				headers: { 'idempotency-key': generateUuidV7() }
			})
		},
		async archiveNotification(notificationId) {
			await apiFetch(`/api/v1/notifications/${encodeURIComponent(notificationId)}/archive`, {
				method: 'POST',
				headers: { 'idempotency-key': generateUuidV7() }
			})
		},
		async importDryRun(body) {
			return apiFetch<ImportDryRunPreviewDto>('/api/v1/imports/dry-run', {
				method: 'POST',
				body: JSON.stringify(body)
			})
		},
		async importExecute(body) {
			return apiFetch<ImportJobDto>('/api/v1/imports/execute', {
				method: 'POST',
				headers: { 'idempotency-key': generateUuidV7() },
				body: JSON.stringify(body)
			})
		},
		async getDocBySlug(slug) {
			return apiFetch<DocPageDetailDto>(`/api/v1/docs/by-slug/${encodeURIComponent(slug)}`)
		},
		async getDocDetail(pageId) {
			return apiFetch<DocPageDetailDto>(`/api/v1/docs/${encodeURIComponent(pageId)}`)
		},
		async issueCollabTicket(pageId) {
			return apiFetch<CollabTicketResponse>(`/api/v1/docs/${encodeURIComponent(pageId)}/collab-ticket`, {
				method: 'POST',
				headers: { 'idempotency-key': generateUuidV7() }
			})
		},
		async setDocFavorite(pageId, favorite) {
			const res = await apiFetch<{ data: DocPageDto }>(
				`/api/v1/docs/${encodeURIComponent(pageId)}/favorite`,
				{
					method: favorite ? 'POST' : 'DELETE',
					headers: { 'idempotency-key': generateUuidV7() }
				}
			)
			return res.data
		},
		async splitDocPage(pageId, title, headingBlockId, markdown) {
			return apiFetch<DocPageDto>(`/api/v1/docs/${encodeURIComponent(pageId)}/split`, {
				method: 'POST',
				headers: { 'idempotency-key': generateUuidV7() },
				body: JSON.stringify({
					title,
					...(headingBlockId ? { headingBlockId } : {}),
					...(markdown ? { markdown } : {})
				})
			})
		},
		async exportDocMarkdown(pageId) {
			return apiFetch<DocExportMarkdownResponse>(
				`/api/v1/docs/${encodeURIComponent(pageId)}/export?format=markdown`
			)
		},
		async importDocMarkdown(body) {
			return apiFetch<DocPageDto>('/api/v1/docs/import/markdown', {
				method: 'POST',
				headers: { 'idempotency-key': generateUuidV7() },
				body: JSON.stringify(body)
			})
		},
		async listDocVersions(pageId) {
			const res = await apiFetch<{ data: DocVersionDto[] }>(
				`/api/v1/docs/${encodeURIComponent(pageId)}/versions`
			)
			return res.data
		},
		async createDocVersion(pageId, label) {
			return apiFetch<DocVersionDto>(`/api/v1/docs/${encodeURIComponent(pageId)}/versions`, {
				method: 'POST',
				headers: { 'idempotency-key': generateUuidV7() },
				body: JSON.stringify({ label })
			})
		},
		async getDocVersionDetail(pageId, versionId) {
			return apiFetch<DocVersionDetailDto>(
				`/api/v1/docs/${encodeURIComponent(pageId)}/versions/${encodeURIComponent(versionId)}`
			)
		},
		async restoreDocVersion(pageId, versionId, label) {
			return apiFetch<{ readonly detail: DocPageDetailDto; readonly checkpointVersion: DocVersionDto }>(
				`/api/v1/docs/${encodeURIComponent(pageId)}/versions/${encodeURIComponent(versionId)}/restore`,
				{
					method: 'POST',
					headers: { 'idempotency-key': generateUuidV7() },
					body: JSON.stringify(label ? { label } : {})
				}
			)
		},
		async createDocComment(pageId, body) {
			return apiFetch<DocCommentDto>(`/api/v1/docs/${encodeURIComponent(pageId)}/comments`, {
				method: 'POST',
				headers: { 'idempotency-key': generateUuidV7() },
				body: JSON.stringify(body)
			})
		},
		async updateDocComment(pageId, commentId, body) {
			return apiFetch<DocCommentDto>(
				`/api/v1/docs/${encodeURIComponent(pageId)}/comments/${encodeURIComponent(commentId)}`,
				{ method: 'PATCH', body: JSON.stringify(body) }
			)
		},
		async resolveDocComment(pageId, commentId, resolved) {
			return apiFetch<DocCommentDto>(
				`/api/v1/docs/${encodeURIComponent(pageId)}/comments/${encodeURIComponent(commentId)}/resolve`,
				{ method: 'POST', body: JSON.stringify({ resolved }) }
			)
		},
		async deleteDocComment(pageId, commentId) {
			await apiFetch(`/api/v1/docs/${encodeURIComponent(pageId)}/comments/${encodeURIComponent(commentId)}`, {
				method: 'DELETE'
			})
		},
		async listResourceAcls(resourceType, resourceId) {
			const res = await apiFetch<{ data: ResourceAclItemDto[] }>(
				`/api/v1/acl?resourceType=${encodeURIComponent(resourceType)}&resourceId=${encodeURIComponent(resourceId)}`
			)
			return res.data
		},
		async grantResourceAcl(input) {
			return apiFetch<ResourceAclItemDto>('/api/v1/acl', {
				method: 'POST',
				headers: { 'idempotency-key': generateUuidV7() },
				body: JSON.stringify(input)
			})
		},
		async revokeResourceAcl(aclId) {
			await apiFetch(`/api/v1/acl/${encodeURIComponent(aclId)}`, { method: 'DELETE' })
		},
		async listChannels() {
			const res = await apiFetch<{ data: ChatChannelDto[] }>('/api/v1/chat/channels')
			return res.data
		},
		async getChannel(channelId) {
			return apiFetch<ChatChannelDto>(`/api/v1/chat/channels/${encodeURIComponent(channelId)}`)
		},
		async createChannel(body) {
			return apiFetch<ChatChannelDto>('/api/v1/chat/channels', {
				method: 'POST',
				body: JSON.stringify(body)
			})
		},
		async createOrGetDm(body) {
			return apiFetch<ChatChannelDto>('/api/v1/chat/dms', {
				method: 'POST',
				body: JSON.stringify(body)
			})
		},
		async updateChannel(channelId, body) {
			return apiFetch<ChatChannelDto>(`/api/v1/chat/channels/${encodeURIComponent(channelId)}`, {
				method: 'PATCH',
				body: JSON.stringify(body)
			})
		},
		async addChannelMember(channelId, body) {
			return apiFetch<ChatChannelMemberDto>(
				`/api/v1/chat/channels/${encodeURIComponent(channelId)}/members`,
				{ method: 'POST', body: JSON.stringify(body) }
			)
		},
		async removeChannelMember(channelId, principalId) {
			await apiFetch(
				`/api/v1/chat/channels/${encodeURIComponent(channelId)}/members/${encodeURIComponent(principalId)}`,
				{ method: 'DELETE' }
			)
		},
		async listMessages(channelId, beforeSeq) {
			const qs = beforeSeq !== undefined ? `?beforeSeq=${beforeSeq}` : ''
			return apiFetch<ListMessagesResponse>(
				`/api/v1/chat/channels/${encodeURIComponent(channelId)}/messages${qs}`
			)
		},
		async listChannelChanges(channelId, sinceRev) {
			return apiFetch<ChannelChangesResponse>(
				`/api/v1/chat/channels/${encodeURIComponent(channelId)}/changes?since=${sinceRev}`
			)
		},
		async sendMessage(channelId, body) {
			return apiFetch<ChatMessageDto>(`/api/v1/chat/channels/${encodeURIComponent(channelId)}/messages`, {
				method: 'POST',
				body: JSON.stringify(body)
			})
		},
		async updateMessage(messageId, body) {
			return apiFetch<ChatMessageDto>(`/api/v1/chat/messages/${encodeURIComponent(messageId)}`, {
				method: 'PATCH',
				body: JSON.stringify(body)
			})
		},
		async deleteMessage(messageId) {
			return apiFetch<ChatMessageDto>(`/api/v1/chat/messages/${encodeURIComponent(messageId)}`, {
				method: 'DELETE'
			})
		},
		async listThread(parentMessageId) {
			return apiFetch<{ readonly parent: ChatMessageDto; readonly replies: ChatMessageDto[] }>(
				`/api/v1/chat/messages/${encodeURIComponent(parentMessageId)}/thread`
			)
		},
		async addReaction(messageId, emoji) {
			return apiFetch<ChatMessageDto>(`/api/v1/chat/messages/${encodeURIComponent(messageId)}/reactions`, {
				method: 'POST',
				body: JSON.stringify({ emoji })
			})
		},
		async removeReaction(messageId, emoji) {
			return apiFetch<ChatMessageDto>(
				`/api/v1/chat/messages/${encodeURIComponent(messageId)}/reactions/${encodeURIComponent(emoji)}`,
				{ method: 'DELETE' }
			)
		},
		async markChannelRead(channelId, seq) {
			return apiFetch<{
				readonly channelId: string
				readonly lastReadSeq: number
				readonly unreadCount: number
			}>(`/api/v1/chat/channels/${encodeURIComponent(channelId)}/read`, {
				method: 'POST',
				body: JSON.stringify({ seq })
			})
		},
		async updateChannelMute(channelId, muted) {
			return apiFetch<{ readonly channelId: string; readonly muted: boolean }>(
				`/api/v1/chat/channels/${encodeURIComponent(channelId)}/mute`,
				{ method: 'PATCH', body: JSON.stringify({ muted }) }
			)
		},
		async listThreads() {
			const res = await apiFetch<{ data: ChatThreadSummaryDto[] }>('/api/v1/chat/threads')
			return res.data
		},
		async uploadFile(file) {
			const init = await apiFetch<{ file: FileDto; uploadUrl: string }>('/api/v1/files/uploads', {
				method: 'POST',
				body: JSON.stringify({
					filename: file.name,
					contentType: file.type || 'application/octet-stream',
					byteSize: file.size
				})
			})
			const bytes = await file.arrayBuffer()
			const putRes = await fetch(`${API_BASE}${init.uploadUrl}`, {
				method: 'PUT',
				credentials: 'include',
				headers: {
					'content-type': file.type || 'application/octet-stream',
					'x-workspace-id': workspaceId,
					'x-huriro-client': 'huriro-web'
				},
				body: bytes
			})
			if (!putRes.ok) {
				throw new Error(`Upload content failed (${putRes.status})`)
			}
			return apiFetch<FileDto>(`/api/v1/files/${encodeURIComponent(init.file.id)}/finalize`, {
				method: 'POST'
			})
		},
		async getNotificationPreferences() {
			return apiFetch<NotificationPreferencesDto>('/api/v1/notifications/preferences')
		},
		async updateNotificationPreferences(body) {
			return apiFetch<NotificationPreferencesDto>('/api/v1/notifications/preferences', {
				method: 'PATCH',
				body: JSON.stringify(body)
			})
		},
		async getVapidPublicKey() {
			const res = await apiFetch<{ publicKey: string | null }>('/api/v1/notifications/push/vapid-key')
			return res.publicKey
		},
		async listWebPushSubscriptions() {
			return apiFetch<WebPushSubscriptionDto[]>('/api/v1/notifications/push/subscriptions')
		},
		async registerWebPushSubscription(body) {
			return apiFetch<WebPushSubscriptionDto>('/api/v1/notifications/push/subscriptions', {
				method: 'POST',
				body: JSON.stringify(body)
			})
		},
		async deleteWebPushSubscription(id) {
			await apiFetch(`/api/v1/notifications/push/subscriptions/${encodeURIComponent(id)}`, {
				method: 'DELETE'
			})
		},
		async listWebhooks() {
			const res = await apiFetch<{ data: WebhookEndpointDto[] }>('/api/v1/webhooks')
			return res.data
		},
		async createWebhook(body) {
			return apiFetch<CreateWebhookResponse>('/api/v1/webhooks', {
				method: 'POST',
				body: JSON.stringify(body)
			})
		},
		async updateWebhook(id, body) {
			return apiFetch<{ readonly endpoint: WebhookEndpointDto; readonly signingSecret?: string | undefined }>(
				`/api/v1/webhooks/${encodeURIComponent(id)}`,
				{ method: 'PATCH', body: JSON.stringify(body) }
			)
		},
		async deleteWebhook(id) {
			await apiFetch(`/api/v1/webhooks/${encodeURIComponent(id)}`, { method: 'DELETE' })
		},
		async listWebhookDeliveries(endpointId) {
			const res = await apiFetch<{ data: WebhookDeliveryDto[] }>(
				`/api/v1/webhooks/${encodeURIComponent(endpointId)}/deliveries`
			)
			return res.data
		},
		async replayWebhookDelivery(deliveryId) {
			return apiFetch<WebhookDeliveryDto>(
				`/api/v1/webhooks/deliveries/${encodeURIComponent(deliveryId)}/replay`,
				{ method: 'POST' }
			)
		},
		async listGithubInstallations() {
			const res = await apiFetch<{ data: GithubInstallationDto[] }>(
				'/api/v1/integrations/github/installations'
			)
			return res.data
		},
		async createGithubInstallation(body) {
			return apiFetch<GithubInstallationDto>('/api/v1/integrations/github/installations', {
				method: 'POST',
				body: JSON.stringify(body)
			})
		},
		async updateGithubInstallation(id, body) {
			return apiFetch<GithubInstallationDto>(
				`/api/v1/integrations/github/installations/${encodeURIComponent(id)}`,
				{ method: 'PATCH', body: JSON.stringify(body) }
			)
		},
		async deleteGithubInstallation(id) {
			await apiFetch(`/api/v1/integrations/github/installations/${encodeURIComponent(id)}`, {
				method: 'DELETE'
			})
		},
		async listIssueGithubLinks(issueId) {
			const res = await apiFetch<{ data: IssueGithubLinkDto[] }>(
				`/api/v1/issues/${encodeURIComponent(issueId)}/github-links`
			)
			return res.data
		},
		async createIssueGithubLink(body) {
			return apiFetch<IssueGithubLinkDto>('/api/v1/integrations/github/links', {
				method: 'POST',
				body: JSON.stringify(body)
			})
		},
		async deleteIssueGithubLink(id) {
			await apiFetch(`/api/v1/integrations/github/links/${encodeURIComponent(id)}`, { method: 'DELETE' })
		},
		async retryIssueGithubPush(linkId) {
			return apiFetch<IssueGithubLinkDto>(
				`/api/v1/integrations/github/links/${encodeURIComponent(linkId)}/retry`,
				{ method: 'POST' }
			)
		},
		// ── M3: agents, API keys, approvals, AI settings ─────────────────
		async listConnectedApps() {
			const res = await apiFetch<{ data: AgentPrincipalDto[] }>('/api/v1/me/connected-apps')
			return res.data
		},
		async revokeConnectedApp(agentId) {
			await apiFetch(`/api/v1/me/connected-apps/${encodeURIComponent(agentId)}`, { method: 'DELETE' })
		},
		async listAgents() {
			const res = await apiFetch<{ data: AgentPrincipalDto[] }>('/api/v1/agents')
			return res.data
		},
		async updateAgent(id, body) {
			const res = await apiFetch<{ data: AgentPrincipalDto }>(`/api/v1/agents/${encodeURIComponent(id)}`, {
				method: 'PATCH',
				body: JSON.stringify(body)
			})
			return res.data
		},
		async revokeAgent(id) {
			await apiFetch(`/api/v1/agents/${encodeURIComponent(id)}`, { method: 'DELETE' })
		},
		async listApiKeys() {
			const res = await apiFetch<{ data: AgentApiKeyDto[] }>('/api/v1/agents/api-keys')
			return res.data
		},
		async createApiKey(body) {
			const res = await apiFetch<{ data: CreatedApiKeyDto }>('/api/v1/agents/api-keys', {
				method: 'POST',
				body: JSON.stringify(body)
			})
			return res.data
		},
		async revokeApiKey(id) {
			await apiFetch(`/api/v1/agents/api-keys/${encodeURIComponent(id)}`, { method: 'DELETE' })
		},
		async listApprovals(status) {
			const query = status ? `?status=${encodeURIComponent(status)}` : ''
			return apiFetch<ListApprovalsResult>(`/api/v1/approvals${query}`)
		},
		async decideApproval(id, body) {
			const res = await apiFetch<{ data: AgentApprovalDto }>(
				`/api/v1/approvals/${encodeURIComponent(id)}/decide`,
				{ method: 'POST', body: JSON.stringify(body) }
			)
			return res.data
		},
		async getAiSettings() {
			return apiFetch<AiSettingsResponse>('/api/v1/ai/settings')
		},
		async updateAiSettings(body) {
			return apiFetch<AiSettingsResponse>('/api/v1/ai/settings', {
				method: 'PATCH',
				body: JSON.stringify(body)
			})
		},
		async upsertAiProvider(body) {
			const res = await apiFetch<{ data: AiProviderDto }>('/api/v1/ai/providers', {
				method: 'PUT',
				body: JSON.stringify(body)
			})
			return res.data
		},
		// M5: shared inbox mail
		async listMailAccounts() {
			const res = await apiFetch<{ data: MailAccountDto[] }>('/api/v1/mail/accounts')
			return res.data
		},
		async createMailAccount(body) {
			return apiFetch<MailAccountDto>('/api/v1/mail/accounts', {
				method: 'POST',
				body: JSON.stringify(body)
			})
		},
		async updateMailAccount(id, body) {
			return apiFetch<MailAccountDto>(`/api/v1/mail/accounts/${encodeURIComponent(id)}`, {
				method: 'PATCH',
				body: JSON.stringify(body)
			})
		},
		async verifyMailAccountDomain(id) {
			return apiFetch<{ verified: boolean; missingRecords: string[] }>(
				`/api/v1/mail/accounts/${encodeURIComponent(id)}/verify-domain`,
				{ method: 'POST' }
			)
		},
		async syncMailAccount(id) {
			await apiFetch(`/api/v1/mail/accounts/${encodeURIComponent(id)}/sync`, {
				method: 'POST',
				body: JSON.stringify({})
			})
		},
		async listMailIdentities(accountId) {
			const q = accountId ? `?accountId=${encodeURIComponent(accountId)}` : ''
			const res = await apiFetch<{ data: MailIdentityDto[] }>(`/api/v1/mail/identities${q}`)
			return res.data
		},
		async createMailIdentity(body) {
			return apiFetch<MailIdentityDto>('/api/v1/mail/identities', {
				method: 'POST',
				body: JSON.stringify(body)
			})
		},
		async listMailInboxes() {
			const res = await apiFetch<{ data: MailInboxDto[] }>('/api/v1/mail/inboxes')
			return res.data
		},
		async createMailInbox(body) {
			return apiFetch<MailInboxDto>('/api/v1/mail/inboxes', {
				method: 'POST',
				body: JSON.stringify(body)
			})
		},
		async listMailConversations(filter) {
			const qs = new URLSearchParams()
			if (filter.inboxId) qs.set('inboxId', filter.inboxId)
			if (filter.status) qs.set('status', filter.status)
			if (filter.assignee) qs.set('assignee', filter.assignee)
			if (filter.q) qs.set('q', filter.q)
			if (filter.cursor) qs.set('cursor', filter.cursor)
			const suffix = qs.size > 0 ? `?${qs.toString()}` : ''
			return apiFetch<{ data: MailConversationDto[]; nextCursor: string | null }>(
				`/api/v1/mail/conversations${suffix}`
			)
		},
		async getMailTimeline(id) {
			return apiFetch<MailTimelineDto>(`/api/v1/mail/conversations/${encodeURIComponent(id)}/timeline`)
		},
		async updateMailConversation(id, body) {
			return apiFetch<MailConversationDto>(`/api/v1/mail/conversations/${encodeURIComponent(id)}`, {
				method: 'PATCH',
				body: JSON.stringify(body)
			})
		},
		async createMailNote(conversationId, body) {
			return apiFetch<MailNoteDto>(`/api/v1/mail/conversations/${encodeURIComponent(conversationId)}/notes`, {
				method: 'POST',
				body: JSON.stringify(body)
			})
		},
		async linkMailConversation(id, body) {
			await apiFetch(`/api/v1/mail/conversations/${encodeURIComponent(id)}/links`, {
				method: 'POST',
				body: JSON.stringify(body)
			})
		},
		async unlinkMailTask(id, taskId) {
			await apiFetch(
				`/api/v1/mail/conversations/${encodeURIComponent(id)}/links/tasks/${encodeURIComponent(taskId)}`,
				{ method: 'DELETE' }
			)
		},
		async unlinkMailDoc(id, pageId) {
			await apiFetch(
				`/api/v1/mail/conversations/${encodeURIComponent(id)}/links/docs/${encodeURIComponent(pageId)}`,
				{ method: 'DELETE' }
			)
		},
		async convertMailToIssue(id, body) {
			return apiFetch<{ issueId: string; identifier: string }>(
				`/api/v1/mail/conversations/${encodeURIComponent(id)}/convert-to-issue`,
				{ method: 'POST', body: JSON.stringify(body) }
			)
		},
		async upsertMailDraft(conversationId, body) {
			return apiFetch<MailDraftDto>(
				`/api/v1/mail/conversations/${encodeURIComponent(conversationId)}/drafts`,
				{
					method: 'POST',
					body: JSON.stringify(body)
				}
			)
		},
		async updateMailDraft(draftId, body) {
			return apiFetch<MailDraftDto>(`/api/v1/mail/drafts/${encodeURIComponent(draftId)}`, {
				method: 'PATCH',
				body: JSON.stringify(body)
			})
		},
		async sendMailDraft(draftId, body) {
			return apiFetch<MailDraftDto>(`/api/v1/mail/drafts/${encodeURIComponent(draftId)}/send`, {
				method: 'POST',
				body: JSON.stringify(body)
			})
		},
		async undoMailDraft(draftId) {
			return apiFetch<MailDraftDto>(`/api/v1/mail/drafts/${encodeURIComponent(draftId)}/undo`, {
				method: 'POST'
			})
		},
		async discardMailDraft(draftId) {
			await apiFetch(`/api/v1/mail/drafts/${encodeURIComponent(draftId)}`, { method: 'DELETE' })
		},
		async getBillingSubscription() {
			return apiFetch<BillingSummaryResponse>('/api/v1/billing/subscription')
		},
		async createBillingCheckout(body) {
			return apiFetch<CheckoutSessionDto>('/api/v1/billing/checkout', {
				method: 'POST',
				headers: { 'idempotency-key': generateUuidV7() },
				body: JSON.stringify(body)
			})
		},
		async createBillingPortal(body) {
			return apiFetch<BillingPortalDto>('/api/v1/billing/portal', {
				method: 'POST',
				body: JSON.stringify(body)
			})
		},
		async listWorkspaceExports() {
			const res = await apiFetch<{ data: WorkspaceExportDto[] }>('/api/v1/governance/exports')
			return res.data
		},
		async createWorkspaceExport() {
			return apiFetch<WorkspaceExportDto>('/api/v1/governance/exports', {
				method: 'POST',
				headers: { 'idempotency-key': generateUuidV7() }
			})
		},
		getWorkspaceExportDownloadUrl(exportId) {
			return `${API_BASE}/api/v1/governance/exports/${encodeURIComponent(exportId)}/download`
		},
		async eraseMyAccount(body) {
			return apiFetch<EraseAccountResponse>('/api/v1/governance/erase-me', {
				method: 'POST',
				body: JSON.stringify(body)
			})
		}
	}
}

/**
 * Lazy-load offline preview seeding + TipTap/Yjs converters only when offline
 * preview mode is activated (§9.5), keeping the entry shell under budget (§21.4).
 */
export async function createPreviewWorkspace(
	storage?: ReplicaStorage,
	opts?: { readonly mode?: 'selfhost' | 'cloud' }
): Promise<BootstrappedWorkspace> {
	const mod = await import('./preview-workspace')
	return mod.createPreviewWorkspace(storage, opts)
}

interface SetupState {
	readonly needsSetup: boolean
	readonly mode: 'selfhost' | 'cloud'
}

async function fetchSetupState(): Promise<SetupState> {
	try {
		const statusRes = await fetch(`${API_BASE}/api/v1/setup/status`, {
			credentials: 'include'
		})
		if (statusRes.ok) {
			const status = (await statusRes.json()) as { configured?: boolean; mode?: 'selfhost' | 'cloud' }
			return {
				needsSetup: status.configured === false,
				mode: status.mode === 'cloud' ? 'cloud' : 'selfhost'
			}
		}
	} catch {
		// Status probe failed — sign-in remains the safer fallback.
	}
	return { needsSetup: false, mode: 'selfhost' }
}

async function fetchSocialProviders(): Promise<readonly SocialProviderId[]> {
	try {
		const res = await fetch(`${API_BASE}/api/v1/auth/providers`, {
			credentials: 'include'
		})
		if (res.ok) {
			const json = (await res.json()) as { providers?: readonly SocialProviderId[] }
			return Array.isArray(json.providers) ? json.providers : []
		}
	} catch {
		// Discovery failure falls back cleanly to email/password only.
	}
	return []
}

/**
 * Connect to live `/api/v1/workspaces/current` if authenticated. A 401 means
 * the api is reachable but has no session for us → hand the shell an auth
 * gate (first-run setup vs sign-in decided by setup/status + enabled OAuth
 * providers). A 200 with zero workspaces lands on onboarding instead of falling
 * into offline preview. Any network failure falls back to the offline-first
 * preview workspace without blocking.
 */
export async function bootstrapWorkspace(opts?: {
	readonly preferPreview?: boolean
	readonly onChatSignal?: ((ev: { channelId: string; rev: number; lastMsgSeq: number }) => void) | undefined
	readonly onPresence?:
		| ((users: readonly { userId: string; status: 'online' | 'away'; lastSeenAt: number }[]) => void)
		| undefined
	readonly onTyping?: ((ev: { channelId: string; userId: string; until: number }) => void) | undefined
}): Promise<BootResult> {
	if (opts?.preferPreview) return createPreviewWorkspace()
	try {
		const res = await fetch(`${API_BASE}/api/v1/workspaces/current`, {
			credentials: 'include',
			headers: { 'x-huriro-client': 'huriro-web' }
		})
		if (res.status === 401) {
			const [setupState, socialProviders] = await Promise.all([fetchSetupState(), fetchSocialProviders()])
			return { kind: 'auth', needsSetup: setupState.needsSetup, socialProviders }
		}
		if (res.ok) {
			const payload = (await res.json()) as {
				data: { id: string; slug: string; name: string; roleKey: string }[]
			}
			let userId = PREVIEW_USER_ID
			let userEmail = ''
			let userDisplayName = 'User'
			try {
				const sessionRes = await fetch(`${API_BASE}/api/auth/get-session`, {
					credentials: 'include'
				})
				if (sessionRes.ok) {
					const sessionJson = (await sessionRes.json()) as {
						user?: { id?: string; email?: string; name?: string }
					}
					if (sessionJson.user?.id) userId = sessionJson.user.id
					if (sessionJson.user?.email) userEmail = sessionJson.user.email
					if (sessionJson.user?.name) userDisplayName = sessionJson.user.name
				}
			} catch {
				// Keep fallbacks
			}

			const setupState = await fetchSetupState()
			const workspace = payload.data[0]
			if (!workspace) {
				return {
					kind: 'onboarding',
					needsSetup: setupState.needsSetup,
					user: { id: userId, email: userEmail, name: userDisplayName }
				}
			}

			const api = createLiveApiBridge(workspace.id)
			if (userId === PREVIEW_USER_ID) {
				const members = await api.listMembers().catch(() => [])
				if (members[0]?.userId) userId = members[0].userId
				if (members[0]?.displayName) userDisplayName = members[0].displayName
			}

			const proto = window.location.protocol === 'https:' ? 'wss:' : 'ws:'
			const wsUrl = env.VITE_WS_URL ?? `${proto}//${window.location.host}/ws`
			const transport = new HttpSyncTransport({ workspaceId: workspace.id })
			const engine = new HuriroSyncEngine({
				workspaceId: workspace.id,
				currentUserId: userId,
				transport,
				wsUrl,
				useRealtimeTicket: true,
				onChatSignal: opts?.onChatSignal,
				onPresence: opts?.onPresence,
				onTyping: opts?.onTyping
			})
			await engine.bootstrap()
			return {
				engine,
				api,
				workspaceName: workspace.name,
				currentUserId: userId,
				userDisplayName,
				isPreview: false,
				mode: setupState.mode
			}
		}
	} catch {
		// Fall through to offline preview mode when backend is not running.
	}

	return createPreviewWorkspace()
}
