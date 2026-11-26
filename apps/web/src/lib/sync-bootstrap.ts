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
	AiDocBlockAssistResponse,
	AiMailAssistResponse,
	AiProviderDto,
	AiSettingsResponse,
	AvailabilityWindowDto,
	BillingPortalDto,
	BillingSummaryResponse,
	BookmarkMetadataDto,
	BulkIssuesResponse,
	ChannelChangesResponse,
	ChatCanvasDto,
	ChatChannelBookmarkDto,
	ChatChannelDto,
	ChatChannelMemberDto,
	ChatDraftDto,
	ChatHuddleJoinDto,
	ChatHuddleSessionDto,
	ChatMessageDto,
	ChatPinnedMessageDto,
	ChatPollDto,
	ChatSavedItemDto,
	ChatScheduledMessageDto,
	ChatSidebarSectionDto,
	ChatSidebarSectionItemDto,
	ChatThreadSummaryDto,
	CheckoutSessionDto,
	CollabTicketResponse,
	ContactDto,
	ContactOrganizationDto,
	CreateAvailabilityWindowBody,
	CreateWebhookResponse,
	CycleDailySnapshotDto,
	CycleDto,
	DocCommentDto,
	DocExportHtmlResponse,
	DocExportMarkdownResponse,
	DocPageDetailDto,
	DocPageDto,
	DocPublicShareDto,
	DocSuggestionDto,
	DocSyncedBlockDto,
	DocVerificationDto,
	DocVersionDetailDto,
	DocVersionDto,
	EmailPipelineStatusDto,
	EntityLinkDto,
	EraseAccountResponse,
	FileDto,
	GithubInstallationDto,
	ImportDocDatabaseRowsResultDto,
	ImportDryRunPreviewDto,
	ImportJobDto,
	IssueCommentDto,
	IssueDto,
	IssueGithubLinkDto,
	IssueRelationDto,
	KnowledgeGraphResponse,
	ListMessagesResponse,
	MailAccountDto,
	MailBulkTriageResultDto,
	MailConversationDto,
	MailDraftDto,
	MailIdentityDto,
	MailInboxDto,
	MailMacroDto,
	MailNoteDto,
	MailOutboundResultDto,
	MailRouteResultDto,
	MailRoutingConfigDto,
	MailSlaAnalyticsDto,
	MailSlaPolicyDto,
	MailSplitResultDto,
	MailTagDto,
	MailTemplateDto,
	MailTimelineDto,
	NotificationPreferencesDto,
	PeekCardDto,
	RenderedMailTemplateDto,
	SearchResponse,
	SendTestEmailResponse,
	TeamspaceDto,
	TeamspaceMemberDto,
	TriageSuggestionsDto,
	UpdateAvailabilityWindowBody,
	UserGroupDto,
	UserWorkspaceProfileDto,
	WebhookDeliveryDto,
	WebhookEndpointDto,
	WebPushSubscriptionDto,
	WorkspaceEmojiDto,
	WorkspaceExportDto
} from '@huriro/contracts'
import { t } from '@huriro/i18n'
import { generateUuidV7, HttpSyncTransport, HuriroSyncEngine, type ReplicaStorage } from '@huriro/sync-client'
import { useUiStore } from '@/stores/ui-store'
import type {
	AgentApiKeyDto,
	BootResult,
	BootstrappedWorkspace,
	CreatedApiKeyDto,
	CreateInvitationResponse,
	ListApprovalsResult,
	ResourceAclItemDto,
	TaskApiBridge
} from './api-bridge'
import { PREVIEW_USER_ID } from './api-bridge'
import type { SocialProviderId } from './auth'
import { env } from './env'
import { API_BASE, api } from './http'

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

function createLiveApiBridge(workspaceId: string): TaskApiBridge {
	// `init` keeps a fetch-shaped surface (method/headers/body-string) so bridge
	// call sites stay unchanged; transport is the shared axios client.
	async function apiFetch<T>(path: string, init?: RequestInit): Promise<T> {
		const res = await api.request<T>({
			url: path,
			...(init?.method ? { method: init.method } : {}),
			data: init?.body,
			headers: {
				'content-type': 'application/json',
				'x-workspace-id': workspaceId,
				...(init?.headers as Record<string, string> | undefined)
			}
		})
		if (res.status >= 300) {
			const problemBody = (typeof res.data === 'object' ? res.data : null) as {
				code?: string
				type?: string
				detail?: string
				title?: string
			} | null
			if (
				res.status === 503 &&
				(problemBody?.code === 'read_only_mode' || problemBody?.type?.includes('read_only_mode'))
			) {
				useUiStore.getState().setServerReadOnly(true)
			}
			const err = new Error(
				problemBody?.detail ?? problemBody?.title ?? `Request to ${path} failed (${res.status})`
			) as Error & { status?: number; code?: string }
			err.status = res.status
			if (problemBody?.code) err.code = problemBody.code
			throw err
		}
		return res.data as T
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
		async appendDocPage(pageId, body) {
			return apiFetch<DocPageDetailDto>(`/api/v1/docs/${encodeURIComponent(pageId)}/append`, {
				method: 'POST',
				headers: { 'idempotency-key': generateUuidV7() },
				body: JSON.stringify(body)
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
		async updateChannelMute(channelId, muted, opts) {
			return apiFetch<{
				readonly channelId: string
				readonly muted: boolean
				readonly notifyLevel?: 'default' | 'all' | 'mentions' | 'none'
				readonly mutedUntil?: string | null
			}>(`/api/v1/chat/channels/${encodeURIComponent(channelId)}/mute`, {
				method: 'PATCH',
				body: JSON.stringify({ muted, ...opts })
			})
		},
		async listPinnedMessages(channelId) {
			const res = await apiFetch<{ data: ChatPinnedMessageDto[] }>(
				`/api/v1/chat/channels/${encodeURIComponent(channelId)}/pins`
			)
			return res.data
		},
		async pinMessage(messageId) {
			return apiFetch(`/api/v1/chat/messages/${encodeURIComponent(messageId)}/pin`, { method: 'POST' })
		},
		async unpinMessage(messageId) {
			return apiFetch(`/api/v1/chat/messages/${encodeURIComponent(messageId)}/pin`, { method: 'DELETE' })
		},
		async listThreads() {
			const res = await apiFetch<{ data: ChatThreadSummaryDto[] }>('/api/v1/chat/threads')
			return res.data
		},
		async listChatDrafts() {
			const res = await apiFetch<{ data: ChatDraftDto[] }>('/api/v1/chat/drafts')
			return res.data
		},
		async upsertChatDraft(channelId, body) {
			return apiFetch<
				| ChatDraftDto
				| { readonly deleted: true; readonly channelId: string; readonly threadParentId: string | null }
			>(`/api/v1/chat/channels/${encodeURIComponent(channelId)}/draft`, {
				method: 'PUT',
				body: JSON.stringify(body)
			})
		},
		async deleteChatDraft(draftId) {
			await apiFetch(`/api/v1/chat/drafts/${encodeURIComponent(draftId)}`, { method: 'DELETE' })
		},
		async listScheduledChatMessages() {
			const res = await apiFetch<{ data: ChatScheduledMessageDto[] }>('/api/v1/chat/scheduled')
			return res.data
		},
		async scheduleChatMessage(channelId, body) {
			return apiFetch<ChatScheduledMessageDto>(
				`/api/v1/chat/channels/${encodeURIComponent(channelId)}/scheduled`,
				{ method: 'POST', body: JSON.stringify(body) }
			)
		},
		async cancelScheduledChatMessage(id, version) {
			return apiFetch<{ readonly id: string; readonly status: string; readonly version: number }>(
				`/api/v1/chat/scheduled/${encodeURIComponent(id)}/cancel`,
				{ method: 'POST', body: JSON.stringify({ version }) }
			)
		},
		async listSavedChatItems() {
			const res = await apiFetch<{ data: ChatSavedItemDto[] }>('/api/v1/chat/saved')
			return res.data
		},
		async createSavedChatItem(body) {
			return apiFetch<ChatSavedItemDto>('/api/v1/chat/saved', {
				method: 'POST',
				body: JSON.stringify(body)
			})
		},
		async updateSavedChatItem(id, body) {
			return apiFetch<ChatSavedItemDto>(`/api/v1/chat/saved/${encodeURIComponent(id)}`, {
				method: 'PATCH',
				body: JSON.stringify(body)
			})
		},
		async deleteSavedChatItem(id) {
			await apiFetch(`/api/v1/chat/saved/${encodeURIComponent(id)}`, { method: 'DELETE' })
		},
		async listChatSidebarSections() {
			const res = await apiFetch<{ data: ChatSidebarSectionDto[] }>('/api/v1/chat/sidebar/sections')
			return res.data
		},
		async createChatSidebarSection(body) {
			return apiFetch<ChatSidebarSectionDto>('/api/v1/chat/sidebar/sections', {
				method: 'POST',
				body: JSON.stringify(body)
			})
		},
		async updateChatSidebarSection(id, body) {
			return apiFetch<ChatSidebarSectionDto>(`/api/v1/chat/sidebar/sections/${encodeURIComponent(id)}`, {
				method: 'PATCH',
				body: JSON.stringify(body)
			})
		},
		async deleteChatSidebarSection(id) {
			await apiFetch(`/api/v1/chat/sidebar/sections/${encodeURIComponent(id)}`, { method: 'DELETE' })
		},
		async addChatSidebarSectionItem(sectionId, body) {
			return apiFetch<ChatSidebarSectionItemDto>(
				`/api/v1/chat/sidebar/sections/${encodeURIComponent(sectionId)}/items`,
				{ method: 'POST', body: JSON.stringify(body) }
			)
		},
		async removeChatSidebarSectionItem(sectionId, channelId) {
			await apiFetch(
				`/api/v1/chat/sidebar/sections/${encodeURIComponent(sectionId)}/items/${encodeURIComponent(channelId)}`,
				{ method: 'DELETE' }
			)
		},
		async listChannelBookmarks(channelId) {
			const res = await apiFetch<{ data: ChatChannelBookmarkDto[] }>(
				`/api/v1/chat/channels/${encodeURIComponent(channelId)}/bookmarks`
			)
			return res.data
		},
		async createChannelBookmark(channelId, body) {
			return apiFetch<ChatChannelBookmarkDto>(
				`/api/v1/chat/channels/${encodeURIComponent(channelId)}/bookmarks`,
				{ method: 'POST', body: JSON.stringify(body) }
			)
		},
		async deleteChannelBookmark(id) {
			await apiFetch(`/api/v1/chat/bookmarks/${encodeURIComponent(id)}`, { method: 'DELETE' })
		},
		async getMyChatStatus() {
			return apiFetch<UserWorkspaceProfileDto>('/api/v1/chat/me/status')
		},
		async updateMyChatStatus(body) {
			return apiFetch<UserWorkspaceProfileDto>('/api/v1/chat/me/status', {
				method: 'PUT',
				body: JSON.stringify(body)
			})
		},
		async listAvailabilityWindows() {
			const res = await apiFetch<{ data: AvailabilityWindowDto[] }>('/api/v1/availability/windows')
			return res.data
		},
		async createAvailabilityWindow(body: CreateAvailabilityWindowBody) {
			return apiFetch<AvailabilityWindowDto>('/api/v1/availability/windows', {
				method: 'POST',
				body: JSON.stringify(body)
			})
		},
		async updateAvailabilityWindow(id: string, body: UpdateAvailabilityWindowBody) {
			return apiFetch<AvailabilityWindowDto>(`/api/v1/availability/windows/${encodeURIComponent(id)}`, {
				method: 'PATCH',
				body: JSON.stringify(body)
			})
		},
		async deleteAvailabilityWindow(id: string) {
			await apiFetch(`/api/v1/availability/windows/${encodeURIComponent(id)}`, { method: 'DELETE' })
			return { deleted: true as const }
		},
		async listUserGroups() {
			const res = await apiFetch<{ data: UserGroupDto[] }>('/api/v1/chat/user-groups')
			return res.data
		},
		async createUserGroup(body) {
			return apiFetch<UserGroupDto>('/api/v1/chat/user-groups', {
				method: 'POST',
				body: JSON.stringify(body)
			})
		},
		async setUserGroupMembers(groupId, memberIds) {
			return apiFetch<{ readonly memberIds: readonly string[] }>(
				`/api/v1/chat/user-groups/${encodeURIComponent(groupId)}/members`,
				{ method: 'PUT', body: JSON.stringify({ memberIds }) }
			)
		},
		async listWorkspaceEmojis() {
			const res = await apiFetch<{ data: WorkspaceEmojiDto[] }>('/api/v1/chat/emojis')
			return res.data
		},
		async createWorkspaceEmoji(body) {
			return apiFetch<WorkspaceEmojiDto>('/api/v1/chat/emojis', {
				method: 'POST',
				body: JSON.stringify(body)
			})
		},
		async deleteWorkspaceEmoji(id) {
			await apiFetch(`/api/v1/chat/emojis/${encodeURIComponent(id)}`, { method: 'DELETE' })
		},
		async listChannelPolls(channelId) {
			const res = await apiFetch<{ data: ChatPollDto[] }>(
				`/api/v1/chat/channels/${encodeURIComponent(channelId)}/polls`
			)
			return res.data
		},
		async createChatPoll(channelId, body) {
			return apiFetch<ChatPollDto>(`/api/v1/chat/channels/${encodeURIComponent(channelId)}/polls`, {
				method: 'POST',
				body: JSON.stringify(body)
			})
		},
		async getChatPoll(pollId) {
			return apiFetch<ChatPollDto>(`/api/v1/chat/polls/${encodeURIComponent(pollId)}`)
		},
		async voteChatPoll(pollId, body) {
			return apiFetch(`/api/v1/chat/polls/${encodeURIComponent(pollId)}/vote`, {
				method: 'POST',
				body: JSON.stringify(body)
			})
		},
		async closeChatPoll(pollId) {
			return apiFetch<{ readonly id: string; readonly status: string; readonly version: number }>(
				`/api/v1/chat/polls/${encodeURIComponent(pollId)}/close`,
				{ method: 'POST' }
			)
		},
		async forwardChatMessage(messageId, body) {
			return apiFetch<ChatMessageDto>(`/api/v1/chat/messages/${encodeURIComponent(messageId)}/forward`, {
				method: 'POST',
				body: JSON.stringify(body)
			})
		},
		async ensureChannelCanvas(channelId) {
			return apiFetch<ChatCanvasDto>(`/api/v1/chat/channels/${encodeURIComponent(channelId)}/canvas`, {
				method: 'POST'
			})
		},
		async getActiveChannelHuddle(channelId) {
			const res = await apiFetch<{ huddle: ChatHuddleSessionDto | null }>(
				`/api/v1/chat/channels/${encodeURIComponent(channelId)}/huddle`
			)
			return res.huddle
		},
		async startChatHuddle(channelId) {
			return apiFetch<ChatHuddleSessionDto>('/api/v1/chat/huddles', {
				method: 'POST',
				body: JSON.stringify({ channelId })
			})
		},
		async joinChatHuddle(huddleId) {
			return apiFetch<ChatHuddleJoinDto>(`/api/v1/chat/huddles/${encodeURIComponent(huddleId)}/join`, {
				method: 'POST'
			})
		},
		async endChatHuddle(huddleId) {
			return apiFetch<{ readonly id: string; readonly status: string }>(
				`/api/v1/chat/huddles/${encodeURIComponent(huddleId)}/end`,
				{ method: 'POST' }
			)
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
			const putRes = await api.put(init.uploadUrl, bytes, {
				headers: {
					'content-type': file.type || 'application/octet-stream',
					'x-workspace-id': workspaceId
				}
			})
			if (putRes.status >= 300) {
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
		async getEmailStatus() {
			return apiFetch<EmailPipelineStatusDto>('/api/v1/notifications/email/status')
		},
		async sendTestEmail(to) {
			return apiFetch<SendTestEmailResponse>('/api/v1/notifications/email/test', {
				method: 'POST',
				body: JSON.stringify(to ? { to } : {})
			})
		},
		async createInvitation(body) {
			return apiFetch<CreateInvitationResponse>('/api/v1/invitations', {
				method: 'POST',
				body: JSON.stringify({ workspaceId, email: body.email, role: body.role })
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
			if (filter.tagId) qs.set('tagId', filter.tagId)
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
		async issueMailDraftCollabTicket(draftId) {
			return apiFetch<CollabTicketResponse>(
				`/api/v1/mail/drafts/${encodeURIComponent(draftId)}/collab-ticket`,
				{ method: 'POST' }
			)
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
		async listMailTags(inboxId) {
			const qs = inboxId ? `?inboxId=${encodeURIComponent(inboxId)}` : ''
			return apiFetch<MailTagDto[]>(`/api/v1/mail/tags${qs}`)
		},
		async createMailTag(body) {
			return apiFetch<MailTagDto>('/api/v1/mail/tags', {
				method: 'POST',
				body: JSON.stringify(body)
			})
		},
		async deleteMailTag(id) {
			await apiFetch(`/api/v1/mail/tags/${encodeURIComponent(id)}`, { method: 'DELETE' })
		},
		async listConversationTags(conversationId) {
			return apiFetch<MailTagDto[]>(`/api/v1/mail/conversations/${encodeURIComponent(conversationId)}/tags`)
		},
		async setConversationTags(conversationId, body) {
			return apiFetch<{ readonly tagIds: readonly string[] }>(
				`/api/v1/mail/conversations/${encodeURIComponent(conversationId)}/tags`,
				{ method: 'PUT', body: JSON.stringify(body) }
			)
		},
		async listMailTemplates(filter) {
			const params = new URLSearchParams()
			if (filter?.inboxId) params.set('inboxId', filter.inboxId)
			if (filter?.personal !== undefined) params.set('personal', String(filter.personal))
			const qs = params.toString()
			return apiFetch<MailTemplateDto[]>(`/api/v1/mail/templates${qs ? `?${qs}` : ''}`)
		},
		async upsertMailTemplate(body, id) {
			const path = id ? `/api/v1/mail/templates/${encodeURIComponent(id)}` : '/api/v1/mail/templates'
			return apiFetch<MailTemplateDto>(path, {
				method: id ? 'PATCH' : 'POST',
				body: JSON.stringify(body)
			})
		},
		async deleteMailTemplate(id) {
			await apiFetch(`/api/v1/mail/templates/${encodeURIComponent(id)}`, { method: 'DELETE' })
		},
		async renderMailTemplate(id, body) {
			return apiFetch<RenderedMailTemplateDto>(`/api/v1/mail/templates/${encodeURIComponent(id)}/render`, {
				method: 'POST',
				body: JSON.stringify(body)
			})
		},
		async listMailMacros(inboxId) {
			const qs = inboxId ? `?inboxId=${encodeURIComponent(inboxId)}` : ''
			return apiFetch<MailMacroDto[]>(`/api/v1/mail/macros${qs}`)
		},
		async upsertMailMacro(body, id) {
			const path = id ? `/api/v1/mail/macros/${encodeURIComponent(id)}` : '/api/v1/mail/macros'
			return apiFetch<MailMacroDto>(path, {
				method: id ? 'PATCH' : 'POST',
				body: JSON.stringify(body)
			})
		},
		async deleteMailMacro(id) {
			await apiFetch(`/api/v1/mail/macros/${encodeURIComponent(id)}`, { method: 'DELETE' })
		},
		async applyMailMacro(id, body) {
			return apiFetch<{ readonly appliedCount: number }>(
				`/api/v1/mail/macros/${encodeURIComponent(id)}/apply`,
				{ method: 'POST', body: JSON.stringify(body) }
			)
		},
		async createOutboundConversation(body) {
			return apiFetch<MailOutboundResultDto>('/api/v1/mail/outbound', {
				method: 'POST',
				body: JSON.stringify(body)
			})
		},
		async forwardConversation(conversationId, body) {
			return apiFetch<MailOutboundResultDto>(
				`/api/v1/mail/conversations/${encodeURIComponent(conversationId)}/forward`,
				{ method: 'POST', body: JSON.stringify(body) }
			)
		},
		async splitConversation(conversationId, body) {
			return apiFetch<MailSplitResultDto>(
				`/api/v1/mail/conversations/${encodeURIComponent(conversationId)}/split`,
				{ method: 'POST', body: JSON.stringify(body) }
			)
		},
		async bulkTriageConversations(body) {
			return apiFetch<MailBulkTriageResultDto>('/api/v1/mail/bulk-triage', {
				method: 'POST',
				body: JSON.stringify(body)
			})
		},
		async listContacts(q) {
			const qs = q ? `?q=${encodeURIComponent(q)}` : ''
			return apiFetch<ContactDto[]>(`/api/v1/mail/contacts${qs}`)
		},
		async upsertContact(body, id) {
			const path = id ? `/api/v1/mail/contacts/${encodeURIComponent(id)}` : '/api/v1/mail/contacts'
			return apiFetch<ContactDto>(path, {
				method: id ? 'PATCH' : 'POST',
				body: JSON.stringify(body)
			})
		},
		async listContactOrganizations() {
			return apiFetch<ContactOrganizationDto[]>('/api/v1/mail/contact-organizations')
		},
		async upsertContactOrganization(body, id) {
			const path = id
				? `/api/v1/mail/contact-organizations/${encodeURIComponent(id)}`
				: '/api/v1/mail/contact-organizations'
			return apiFetch<ContactOrganizationDto>(path, {
				method: id ? 'PATCH' : 'POST',
				body: JSON.stringify(body)
			})
		},
		async getMailRoutingConfig(inboxId) {
			return apiFetch<MailRoutingConfigDto>(`/api/v1/mail/inboxes/${encodeURIComponent(inboxId)}/routing`)
		},
		async upsertMailRoutingConfig(inboxId, body) {
			return apiFetch<MailRoutingConfigDto>(`/api/v1/mail/inboxes/${encodeURIComponent(inboxId)}/routing`, {
				method: 'PUT',
				body: JSON.stringify(body)
			})
		},
		async routeConversationRoundRobin(conversationId) {
			return apiFetch<MailRouteResultDto>(
				`/api/v1/mail/conversations/${encodeURIComponent(conversationId)}/route`,
				{ method: 'POST' }
			)
		},
		async listMailSlaPolicies(inboxId) {
			const qs = inboxId ? `?inboxId=${encodeURIComponent(inboxId)}` : ''
			return apiFetch<MailSlaPolicyDto[]>(`/api/v1/mail/sla-policies${qs}`)
		},
		async upsertMailSlaPolicy(body, id) {
			const path = id ? `/api/v1/mail/sla-policies/${encodeURIComponent(id)}` : '/api/v1/mail/sla-policies'
			return apiFetch<MailSlaPolicyDto>(path, {
				method: id ? 'PATCH' : 'POST',
				body: JSON.stringify(body)
			})
		},
		async deleteMailSlaPolicy(id) {
			await apiFetch(`/api/v1/mail/sla-policies/${encodeURIComponent(id)}`, { method: 'DELETE' })
		},
		async getMailSlaAnalytics(inboxId) {
			const qs = inboxId ? `?inboxId=${encodeURIComponent(inboxId)}` : ''
			return apiFetch<MailSlaAnalyticsDto>(`/api/v1/mail/sla-analytics${qs}`)
		},
		async requestMailDraftReview(draftId, body) {
			return apiFetch<MailDraftDto>(`/api/v1/mail/drafts/${encodeURIComponent(draftId)}/review`, {
				method: 'POST',
				body: JSON.stringify(body)
			})
		},
		async completeMailDraftReview(draftId, body) {
			return apiFetch<MailDraftDto>(`/api/v1/mail/drafts/${encodeURIComponent(draftId)}/review/complete`, {
				method: 'POST',
				body: JSON.stringify(body)
			})
		},
		async updateMailInboxSettings(inboxId, body) {
			return apiFetch<MailInboxDto>(`/api/v1/mail/inboxes/${encodeURIComponent(inboxId)}/settings`, {
				method: 'PATCH',
				body: JSON.stringify(body)
			})
		},
		async assistMailWithAi(body) {
			return apiFetch<AiMailAssistResponse>('/api/v1/ai/mail/assist', {
				method: 'POST',
				body: JSON.stringify(body)
			})
		},
		async assistDocBlockWithAi(body) {
			return apiFetch<AiDocBlockAssistResponse>('/api/v1/ai/docs/block-assist', {
				method: 'POST',
				headers: { 'idempotency-key': generateUuidV7() },
				body: JSON.stringify(body)
			})
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
		},
		async listTriageQueue(projectId, state) {
			const suffix = state ? `?state=${encodeURIComponent(state)}` : ''
			const res = await apiFetch<{ data: IssueDto[] }>(
				`/api/v1/projects/${encodeURIComponent(projectId)}/triage${suffix}`
			)
			return res.data
		},
		async triageIssue(issueId, body) {
			return apiFetch<IssueDto>(`/api/v1/issues/${encodeURIComponent(issueId)}/triage`, {
				method: 'POST',
				body: JSON.stringify(body)
			})
		},
		async getTriageSuggestions(issueId) {
			return apiFetch<TriageSuggestionsDto>(
				`/api/v1/issues/${encodeURIComponent(issueId)}/triage-suggestions`
			)
		},
		async bulkUpdateIssues(body) {
			return apiFetch<BulkIssuesResponse>('/api/v1/issues/bulk', {
				method: 'POST',
				headers: { 'idempotency-key': generateUuidV7() },
				body: JSON.stringify(body)
			})
		},
		async bulkRestoreIssues(body) {
			return apiFetch<{ restored: number }>('/api/v1/issues/bulk/restore', {
				method: 'POST',
				headers: { 'idempotency-key': generateUuidV7() },
				body: JSON.stringify(body)
			})
		},
		async queryIssues(body) {
			return apiFetch<{ data: IssueDto[]; nextCursor: string | null; hasMore: boolean }>(
				'/api/v1/issues/query',
				{ method: 'POST', body: JSON.stringify(body) }
			)
		},
		async createCycle(body) {
			return apiFetch<CycleDto>('/api/v1/cycles', {
				method: 'POST',
				headers: { 'idempotency-key': generateUuidV7() },
				body: JSON.stringify(body)
			})
		},
		async listCycleSnapshots(cycleId) {
			const res = await apiFetch<{ data: CycleDailySnapshotDto[] }>(
				`/api/v1/cycles/${encodeURIComponent(cycleId)}/snapshots`
			)
			return res.data
		},
		async listEntityLinks(type, id) {
			const res = await apiFetch<{ data: EntityLinkDto[] }>(
				`/api/v1/graph/links?type=${encodeURIComponent(type)}&id=${encodeURIComponent(id)}`
			)
			return res.data
		},
		async createEntityLink(body) {
			return apiFetch<EntityLinkDto>('/api/v1/graph/links', {
				method: 'POST',
				headers: { 'idempotency-key': generateUuidV7() },
				body: JSON.stringify(body)
			})
		},
		async deleteEntityLink(linkId) {
			await apiFetch<unknown>(`/api/v1/graph/links/${encodeURIComponent(linkId)}`, { method: 'DELETE' })
		},
		async peekEntity(type, id) {
			try {
				return await apiFetch<PeekCardDto>(
					`/api/v1/graph/peek?type=${encodeURIComponent(type)}&id=${encodeURIComponent(id)}`
				)
			} catch (err) {
				// Hidden entities (visibility-scoped) surface as 404 — the peek card
				// renders a privacy-safe "no access" tile instead of an error.
				if ((err as { status?: number }).status === 404) return null
				throw err
			}
		},
		async listTeamspaces() {
			const res = await apiFetch<{ data: TeamspaceDto[] }>('/api/v1/teamspaces')
			return res.data
		},
		async createTeamspace(body) {
			return apiFetch<TeamspaceDto>('/api/v1/teamspaces', {
				method: 'POST',
				headers: { 'idempotency-key': generateUuidV7() },
				body: JSON.stringify(body)
			})
		},
		async updateTeamspace(id, body) {
			return apiFetch<TeamspaceDto>(`/api/v1/teamspaces/${encodeURIComponent(id)}`, {
				method: 'PATCH',
				body: JSON.stringify(body)
			})
		},
		async archiveTeamspace(id, version) {
			const q = version !== undefined ? `?version=${version}` : ''
			await apiFetch(`/api/v1/teamspaces/${encodeURIComponent(id)}${q}`, { method: 'DELETE' })
		},
		async listTeamspaceMembers(id) {
			const res = await apiFetch<{ data: TeamspaceMemberDto[] }>(
				`/api/v1/teamspaces/${encodeURIComponent(id)}/members`
			)
			return res.data
		},
		async addTeamspaceMember(id, body) {
			return apiFetch<TeamspaceMemberDto>(`/api/v1/teamspaces/${encodeURIComponent(id)}/members`, {
				method: 'POST',
				body: JSON.stringify(body)
			})
		},
		async removeTeamspaceMember(id, userId) {
			await apiFetch(`/api/v1/teamspaces/${encodeURIComponent(id)}/members/${encodeURIComponent(userId)}`, {
				method: 'DELETE'
			})
		},
		async listSyncedBlocks() {
			const res = await apiFetch<{ data: DocSyncedBlockDto[] }>('/api/v1/docs/synced-blocks')
			return res.data
		},
		async createSyncedBlock(body) {
			return apiFetch<DocSyncedBlockDto>('/api/v1/docs/synced-blocks', {
				method: 'POST',
				body: JSON.stringify(body)
			})
		},
		async getSyncedBlock(id) {
			return apiFetch<DocSyncedBlockDto>(`/api/v1/docs/synced-blocks/${encodeURIComponent(id)}`)
		},
		async updateSyncedBlock(id, body) {
			return apiFetch<DocSyncedBlockDto>(`/api/v1/docs/synced-blocks/${encodeURIComponent(id)}`, {
				method: 'PATCH',
				body: JSON.stringify(body)
			})
		},
		async issueSyncedBlockCollabTicket(id) {
			return apiFetch<CollabTicketResponse>(
				`/api/v1/docs/synced-blocks/${encodeURIComponent(id)}/collab-ticket`,
				{ method: 'POST' }
			)
		},
		async listDocSuggestions(pageId) {
			const res = await apiFetch<{ data: DocSuggestionDto[] }>(
				`/api/v1/docs/${encodeURIComponent(pageId)}/suggestions`
			)
			return res.data
		},
		async proposeDocSuggestion(pageId, body) {
			return apiFetch<DocSuggestionDto>(`/api/v1/docs/${encodeURIComponent(pageId)}/suggestions`, {
				method: 'POST',
				body: JSON.stringify(body)
			})
		},
		async decideDocSuggestion(pageId, groupId, decision) {
			return apiFetch<DocSuggestionDto>(
				`/api/v1/docs/${encodeURIComponent(pageId)}/suggestions/${encodeURIComponent(groupId)}/decision`,
				{ method: 'POST', body: JSON.stringify({ decision }) }
			)
		},
		async decideAllDocSuggestions(pageId, decision) {
			return apiFetch<{ readonly updatedCount: number }>(
				`/api/v1/docs/${encodeURIComponent(pageId)}/suggestions/decide-all`,
				{ method: 'POST', body: JSON.stringify({ decision }) }
			)
		},
		async getDocVerification(pageId) {
			const res = await apiFetch<{ verification: DocVerificationDto | null }>(
				`/api/v1/docs/${encodeURIComponent(pageId)}/verification`
			)
			return res.verification
		},
		async setDocVerification(pageId, body) {
			return apiFetch<DocVerificationDto>(`/api/v1/docs/${encodeURIComponent(pageId)}/verification`, {
				method: 'PUT',
				body: JSON.stringify(body)
			})
		},
		async clearDocVerification(pageId) {
			await apiFetch(`/api/v1/docs/${encodeURIComponent(pageId)}/verification`, { method: 'DELETE' })
		},
		async getDocPublicShare(pageId) {
			const res = await apiFetch<{ share: DocPublicShareDto | null }>(
				`/api/v1/docs/${encodeURIComponent(pageId)}/public-share`
			)
			return res.share
		},
		async upsertDocPublicShare(pageId, body) {
			return apiFetch<DocPublicShareDto>(`/api/v1/docs/${encodeURIComponent(pageId)}/public-share`, {
				method: 'PUT',
				body: JSON.stringify(body)
			})
		},
		async revokeDocPublicShare(pageId) {
			await apiFetch(`/api/v1/docs/${encodeURIComponent(pageId)}/public-share`, { method: 'DELETE' })
		},
		async exportDocHtml(pageId, print = false) {
			const format = print ? 'pdf-html' : 'html'
			return apiFetch<DocExportHtmlResponse>(
				`/api/v1/docs/${encodeURIComponent(pageId)}/export?format=${format}`
			)
		},
		async exportDocZip(pageId, includeChildren = true) {
			const url = `${API_BASE}/api/v1/docs/${encodeURIComponent(pageId)}/export?format=zip${includeChildren ? '&includeChildren=true' : ''}`
			const res = await fetch(url, {
				method: 'GET',
				credentials: 'include',
				headers: { 'x-workspace-id': workspaceId }
			})
			if (!res.ok) {
				throw new Error(`Export ZIP failed (${res.status})`)
			}
			return res.blob()
		},
		async unfurlBookmark(url) {
			return apiFetch<BookmarkMetadataDto>('/api/v1/docs/bookmarks/unfurl', {
				method: 'POST',
				body: JSON.stringify({ url })
			})
		},
		async triggerDocButton(pageId, body) {
			await apiFetch(`/api/v1/docs/${encodeURIComponent(pageId)}/button-trigger`, {
				method: 'POST',
				body: JSON.stringify(body)
			})
		},
		async importDocDatabaseRows(databaseId, body) {
			return apiFetch<ImportDocDatabaseRowsResultDto>(
				`/api/v1/docs/databases/${encodeURIComponent(databaseId)}/rows/import`,
				{
					method: 'POST',
					headers: { 'idempotency-key': generateUuidV7() },
					body: JSON.stringify(body)
				}
			)
		},
		async exportDocDatabaseRows(databaseId, format, viewId) {
			const suffix = viewId ? `&viewId=${encodeURIComponent(viewId)}` : ''
			const res = await apiFetch<{ format: 'csv' | 'json'; data: string }>(
				`/api/v1/docs/databases/${encodeURIComponent(databaseId)}/rows/export?format=${format}${suffix}`
			)
			return res.data
		},
		async ensureDocDatabaseRowPage(databaseId, rowId) {
			return apiFetch<{ pageId: string; created: boolean }>(
				`/api/v1/docs/databases/${encodeURIComponent(databaseId)}/rows/${encodeURIComponent(rowId)}/page`,
				{
					method: 'POST',
					headers: { 'idempotency-key': generateUuidV7() }
				}
			)
		},
		async getKnowledgeGraph(teamspaceId) {
			const qs = teamspaceId ? `?teamspaceId=${encodeURIComponent(teamspaceId)}` : ''
			return apiFetch<KnowledgeGraphResponse>(`/api/v1/graph/knowledge${qs}`)
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
		const statusRes = await api.get('/api/v1/setup/status')
		if (statusRes.status < 300) {
			const status = statusRes.data as { configured?: boolean; mode?: 'selfhost' | 'cloud' }
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
		const res = await api.get('/api/v1/auth/providers')
		if (res.status < 300) {
			const json = res.data as { providers?: readonly SocialProviderId[] }
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
	readonly onResume?: (() => void) | undefined
	readonly onChatSignal?: ((ev: { channelId: string; rev: number; lastMsgSeq: number }) => void) | undefined
	readonly onPresence?:
		| ((users: readonly { userId: string; status: 'online' | 'away'; lastSeenAt: number }[]) => void)
		| undefined
	readonly onTyping?: ((ev: { channelId: string; userId: string; until: number }) => void) | undefined
}): Promise<BootResult> {
	if (opts?.preferPreview) return createPreviewWorkspace()
	try {
		const res = await api.get('/api/v1/workspaces/current')
		if (res.status === 401) {
			const [setupState, socialProviders] = await Promise.all([fetchSetupState(), fetchSocialProviders()])
			return { kind: 'auth', needsSetup: setupState.needsSetup, socialProviders }
		}
		if (res.status < 300) {
			const payload = res.data as {
				data: { id: string; slug: string; name: string; roleKey: string }[]
			}
			let userId = PREVIEW_USER_ID
			let userEmail = ''
			let userDisplayName = 'User'
			try {
				const sessionRes = await api.get('/api/auth/get-session')
				if (sessionRes.status < 300) {
					const sessionJson = sessionRes.data as {
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

			const bridge = createLiveApiBridge(workspace.id)
			if (userId === PREVIEW_USER_ID) {
				const members = await bridge.listMembers().catch(() => [])
				if (members[0]?.userId) userId = members[0].userId
				if (members[0]?.displayName) userDisplayName = members[0].displayName
			}

			const proto = window.location.protocol === 'https:' ? 'wss:' : 'ws:'
			const wsUrl = env.VITE_WS_URL ?? `${proto}//${window.location.host}/ws`
			const transport = new HttpSyncTransport({ baseUrl: API_BASE, workspaceId: workspace.id })
			const engine = new HuriroSyncEngine({
				workspaceId: workspace.id,
				currentUserId: userId,
				transport,
				wsUrl,
				// Browser signal sockets authenticate with the first-party session
				// cookie during upgrade; single-use realtime tickets are for native/API clients.
				useRealtimeTicket: false,
				onMutationRejected: (error) => {
					useUiStore.getState().pushToast({
						tone: 'danger',
						title: t('sync.mutation-rejected'),
						description: error
					})
				},
				onResume: opts?.onResume,
				onChatSignal: opts?.onChatSignal,
				onPresence: opts?.onPresence,
				onTyping: opts?.onTyping
			})
			await engine.bootstrap()
			return {
				engine,
				api: bridge,
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
