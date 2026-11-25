/**
 * API bridge contract shared by `sync-bootstrap` (live/preview wiring) and
 * `preview-workspace` (offline replica bridge, §9.5).
 *
 * Lives in its own module so the lazy `import('./preview-workspace')` in
 * sync-bootstrap stays a one-directional edge — importing these types and
 * preview constants from sync-bootstrap would close a dependency cycle.
 */
import type {
	AddChannelMemberBody,
	AgentApprovalDto,
	AgentPrincipalDto,
	AiProviderDto,
	AiProviderUpsert,
	AiSettingsPatch,
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
	ConvertToIssueBody,
	CreateBillingPortalBody,
	CreateChannelBody,
	CreateCheckoutBody,
	CreateDmBody,
	CreateDocCommentBody,
	CreateGithubInstallationBody,
	CreateIssueGithubLinkBody,
	CreateMailAccountBody,
	CreateMailIdentityBody,
	CreateMailInboxBody,
	CreateMailNoteBody,
	CreateWebhookBody,
	CreateWebhookResponse,
	CreateWebPushSubscriptionBody,
	DocCommentDto,
	DocExportMarkdownResponse,
	DocImportMarkdownBody,
	DocPageDetailDto,
	DocPageDto,
	DocVersionDetailDto,
	DocVersionDto,
	EmailPipelineStatusDto,
	EraseAccountBody,
	EraseAccountResponse,
	FileDto,
	GithubInstallationDto,
	ImportDryRunBody,
	ImportDryRunPreviewDto,
	ImportExecuteBody,
	ImportJobDto,
	IssueCommentDto,
	IssueGithubLinkDto,
	IssueRelationDto,
	LinkConversationBody,
	ListMessagesResponse,
	MailAccountDto,
	MailConversationDto,
	MailConversationStatus,
	MailDraftDto,
	MailIdentityDto,
	MailInboxDto,
	MailNoteDto,
	MailTimelineDto,
	NotificationPreferencesDto,
	RelationKind,
	SearchHitDto,
	SendMailDraftBody,
	SendMessageBody,
	SendTestEmailResponse,
	UpdateChannelBody,
	UpdateConversationBody,
	UpdateDocCommentBody,
	UpdateGithubInstallationBody,
	UpdateMailAccountBody,
	UpdateMessageBody,
	UpdateNotificationPreferencesBody,
	UpdateWebhookBody,
	UpsertMailDraftBody,
	WebhookDeliveryDto,
	WebhookEndpointDto,
	WebPushSubscriptionDto,
	WorkspaceExportDto
} from '@huriro/contracts'
import type { HuriroSyncEngine } from '@huriro/sync-client'
import type { SocialProviderId } from './auth'

export const PREVIEW_WORKSPACE_ID = '0190a0b1-0000-7000-8000-000000000001'
export const PREVIEW_USER_ID = '0190a0b1-0000-7000-8000-000000000002'
export const PREVIEW_PROJECT_ENG_ID = '0190a0b1-0000-7000-8000-000000000010'
export const PREVIEW_PROJECT_SEC_ID = '0190a0b1-0000-7000-8000-000000000011'

export interface WorkspaceMemberSummary {
	readonly userId: string
	readonly displayName: string
	readonly email: string
	readonly role: string
}

export interface ResourceAclItemDto {
	readonly id: string
	readonly principalType: 'user' | 'role' | 'workspace'
	readonly principalId: string | null
	readonly permission: 'read' | 'comment' | 'write' | 'manage'
}

/** API-key DTO as emitted by `agents/api-keys.ts` toDto (raw key only at create). */
export interface AgentApiKeyDto {
	readonly id: string
	readonly name: string
	readonly prefix: string
	readonly agentId: string
	readonly scopes: readonly string[]
	readonly status: 'active' | 'revoked' | 'expired'
	readonly expiresAt: string | null
	readonly lastUsedAt: string | null
	readonly createdAt: string
}

export interface CreatedApiKeyDto extends AgentApiKeyDto {
	readonly key: string
}

export interface CreateApiKeyBody {
	readonly name: string
	readonly scopes: readonly string[]
	readonly expiresInDays?: number | undefined
}

export type ApprovalStatusFilter =
	| 'pending'
	| 'approved'
	| 'denied'
	| 'expired'
	| 'executing'
	| 'executed'
	| 'failed'

export interface ListApprovalsResult {
	readonly data: readonly AgentApprovalDto[]
	readonly nextCursor: string | null
	readonly hasMore: boolean
}

export interface TaskApiBridge {
	listMembers(): Promise<WorkspaceMemberSummary[]>
	listComments(issueId: string): Promise<IssueCommentDto[]>
	createComment(issueId: string, bodyText: string): Promise<IssueCommentDto>
	listRelations(issueId: string): Promise<IssueRelationDto[]>
	createRelation(issueId: string, targetIssueId: string, kind: RelationKind): Promise<IssueRelationDto>
	searchIssues(query: string): Promise<SearchHitDto[]>
	markAllNotificationsRead(): Promise<void>
	archiveNotification(notificationId: string): Promise<void>
	importDryRun(body: ImportDryRunBody): Promise<ImportDryRunPreviewDto>
	importExecute(body: ImportExecuteBody): Promise<ImportJobDto>
	// Docs & ACLs
	getDocBySlug(slug: string): Promise<DocPageDetailDto>
	getDocDetail(pageId: string): Promise<DocPageDetailDto>
	issueCollabTicket(pageId: string): Promise<CollabTicketResponse>
	setDocFavorite(pageId: string, favorite: boolean): Promise<DocPageDto>
	splitDocPage(pageId: string, title: string, headingBlockId?: string, markdown?: string): Promise<DocPageDto>
	exportDocMarkdown(pageId: string): Promise<DocExportMarkdownResponse>
	importDocMarkdown(body: DocImportMarkdownBody): Promise<DocPageDto>
	listDocVersions(pageId: string): Promise<DocVersionDto[]>
	createDocVersion(pageId: string, label: string): Promise<DocVersionDto>
	getDocVersionDetail(pageId: string, versionId: string): Promise<DocVersionDetailDto>
	restoreDocVersion(
		pageId: string,
		versionId: string,
		label?: string
	): Promise<{ readonly detail: DocPageDetailDto; readonly checkpointVersion: DocVersionDto }>
	createDocComment(pageId: string, body: CreateDocCommentBody): Promise<DocCommentDto>
	updateDocComment(pageId: string, commentId: string, body: UpdateDocCommentBody): Promise<DocCommentDto>
	resolveDocComment(pageId: string, commentId: string, resolved: boolean): Promise<DocCommentDto>
	deleteDocComment(pageId: string, commentId: string): Promise<void>
	listResourceAcls(resourceType: 'project' | 'doc_page', resourceId: string): Promise<ResourceAclItemDto[]>
	grantResourceAcl(input: {
		readonly resourceType: 'project' | 'doc_page'
		readonly resourceId: string
		readonly principalType: 'user' | 'role' | 'workspace'
		readonly principalId: string | null
		readonly permission: 'read' | 'comment' | 'write' | 'manage'
	}): Promise<ResourceAclItemDto>
	revokeResourceAcl(aclId: string): Promise<void>
	// M4 Chat, Files, Notification Preferences, Web Push, Webhooks & GitHub Sync
	listChannels(): Promise<ChatChannelDto[]>
	getChannel(channelId: string): Promise<ChatChannelDto>
	createChannel(body: CreateChannelBody): Promise<ChatChannelDto>
	createOrGetDm(body: CreateDmBody): Promise<ChatChannelDto>
	updateChannel(channelId: string, body: UpdateChannelBody): Promise<ChatChannelDto>
	addChannelMember(channelId: string, body: AddChannelMemberBody): Promise<ChatChannelMemberDto>
	removeChannelMember(channelId: string, principalId: string): Promise<void>
	listMessages(channelId: string, beforeSeq?: number): Promise<ListMessagesResponse>
	listChannelChanges(channelId: string, sinceRev: number): Promise<ChannelChangesResponse>
	sendMessage(channelId: string, body: SendMessageBody): Promise<ChatMessageDto>
	updateMessage(messageId: string, body: UpdateMessageBody): Promise<ChatMessageDto>
	deleteMessage(messageId: string): Promise<ChatMessageDto>
	listThread(
		parentMessageId: string
	): Promise<{ readonly parent: ChatMessageDto; readonly replies: ChatMessageDto[] }>
	addReaction(messageId: string, emoji: string): Promise<ChatMessageDto>
	removeReaction(messageId: string, emoji: string): Promise<ChatMessageDto>
	markChannelRead(
		channelId: string,
		seq: number
	): Promise<{ readonly channelId: string; readonly lastReadSeq: number; readonly unreadCount: number }>
	updateChannelMute(
		channelId: string,
		muted: boolean
	): Promise<{ readonly channelId: string; readonly muted: boolean }>
	listThreads(): Promise<ChatThreadSummaryDto[]>
	uploadFile(file: File): Promise<FileDto>
	getNotificationPreferences(): Promise<NotificationPreferencesDto>
	updateNotificationPreferences(body: UpdateNotificationPreferencesBody): Promise<NotificationPreferencesDto>
	getEmailStatus(): Promise<EmailPipelineStatusDto>
	sendTestEmail(to?: string): Promise<SendTestEmailResponse>
	createInvitation(body: {
		readonly email: string
		readonly role: 'admin' | 'member' | 'guest'
	}): Promise<CreateInvitationResponse>
	getVapidPublicKey(): Promise<string | null>
	listWebPushSubscriptions(): Promise<WebPushSubscriptionDto[]>
	registerWebPushSubscription(body: CreateWebPushSubscriptionBody): Promise<WebPushSubscriptionDto>
	deleteWebPushSubscription(id: string): Promise<void>
	listWebhooks(): Promise<WebhookEndpointDto[]>
	createWebhook(body: CreateWebhookBody): Promise<CreateWebhookResponse>
	updateWebhook(
		id: string,
		body: UpdateWebhookBody
	): Promise<{ readonly endpoint: WebhookEndpointDto; readonly signingSecret?: string | undefined }>
	deleteWebhook(id: string): Promise<void>
	listWebhookDeliveries(endpointId: string): Promise<WebhookDeliveryDto[]>
	replayWebhookDelivery(deliveryId: string): Promise<WebhookDeliveryDto>
	listGithubInstallations(): Promise<GithubInstallationDto[]>
	createGithubInstallation(body: CreateGithubInstallationBody): Promise<GithubInstallationDto>
	updateGithubInstallation(id: string, body: UpdateGithubInstallationBody): Promise<GithubInstallationDto>
	deleteGithubInstallation(id: string): Promise<void>
	listIssueGithubLinks(issueId: string): Promise<IssueGithubLinkDto[]>
	createIssueGithubLink(body: CreateIssueGithubLinkBody): Promise<IssueGithubLinkDto>
	deleteIssueGithubLink(id: string): Promise<void>
	retryIssueGithubPush(linkId: string): Promise<IssueGithubLinkDto>
	// M3: connected apps, agent management, API keys, approvals, AI settings
	listConnectedApps(): Promise<AgentPrincipalDto[]>
	revokeConnectedApp(agentId: string): Promise<void>
	listAgents(): Promise<AgentPrincipalDto[]>
	updateAgent(
		id: string,
		body: { readonly name?: string | undefined; readonly status?: 'active' | 'suspended' | undefined }
	): Promise<AgentPrincipalDto>
	revokeAgent(id: string): Promise<void>
	listApiKeys(): Promise<AgentApiKeyDto[]>
	createApiKey(body: CreateApiKeyBody): Promise<CreatedApiKeyDto>
	revokeApiKey(id: string): Promise<void>
	listApprovals(status?: ApprovalStatusFilter): Promise<ListApprovalsResult>
	decideApproval(
		id: string,
		body: { readonly decision: 'approve' | 'deny'; readonly reason?: string }
	): Promise<AgentApprovalDto>
	getAiSettings(): Promise<AiSettingsResponse>
	updateAiSettings(body: AiSettingsPatch): Promise<AiSettingsResponse>
	upsertAiProvider(body: AiProviderUpsert): Promise<AiProviderDto>
	// M5: shared inbox mail
	listMailAccounts(): Promise<MailAccountDto[]>
	createMailAccount(body: CreateMailAccountBody): Promise<MailAccountDto>
	updateMailAccount(id: string, body: UpdateMailAccountBody): Promise<MailAccountDto>
	verifyMailAccountDomain(
		id: string
	): Promise<{ readonly verified: boolean; readonly missingRecords: readonly string[] }>
	syncMailAccount(id: string): Promise<void>
	listMailIdentities(accountId?: string): Promise<MailIdentityDto[]>
	createMailIdentity(body: CreateMailIdentityBody): Promise<MailIdentityDto>
	listMailInboxes(): Promise<MailInboxDto[]>
	createMailInbox(body: CreateMailInboxBody): Promise<MailInboxDto>
	listMailConversations(filter: {
		readonly inboxId?: string | undefined
		readonly status?: MailConversationStatus | undefined
		readonly assignee?: 'me' | 'unassigned' | string | undefined
		readonly q?: string | undefined
		readonly cursor?: string | undefined
	}): Promise<{ readonly data: MailConversationDto[]; readonly nextCursor: string | null }>
	getMailTimeline(id: string): Promise<MailTimelineDto>
	updateMailConversation(id: string, body: UpdateConversationBody): Promise<MailConversationDto>
	createMailNote(conversationId: string, body: CreateMailNoteBody): Promise<MailNoteDto>
	linkMailConversation(id: string, body: LinkConversationBody): Promise<void>
	unlinkMailTask(id: string, taskId: string): Promise<void>
	unlinkMailDoc(id: string, pageId: string): Promise<void>
	convertMailToIssue(
		id: string,
		body: ConvertToIssueBody
	): Promise<{ readonly issueId: string; readonly identifier: string }>
	upsertMailDraft(conversationId: string, body: UpsertMailDraftBody): Promise<MailDraftDto>
	updateMailDraft(draftId: string, body: UpsertMailDraftBody): Promise<MailDraftDto>
	sendMailDraft(draftId: string, body: SendMailDraftBody): Promise<MailDraftDto>
	undoMailDraft(draftId: string): Promise<MailDraftDto>
	discardMailDraft(draftId: string): Promise<void>
	getBillingSubscription(): Promise<BillingSummaryResponse>
	createBillingCheckout(body: CreateCheckoutBody): Promise<CheckoutSessionDto>
	createBillingPortal(body: CreateBillingPortalBody): Promise<BillingPortalDto>
	listWorkspaceExports(): Promise<WorkspaceExportDto[]>
	createWorkspaceExport(): Promise<WorkspaceExportDto>
	getWorkspaceExportDownloadUrl(exportId: string): string
	eraseMyAccount(body: EraseAccountBody): Promise<EraseAccountResponse>
}

export interface CreateInvitationResponse {
	readonly id: string
	readonly token: string
	/** true when an existing pending invite was renewed (token rotated) instead of freshly created. */
	readonly resent: boolean
	/** Delivery outcome of the invitation email: sent, skipped because no provider is
	 * configured, or attempted but failed (detail is in server logs, never on the wire). */
	readonly emailStatus: 'sent' | 'not_configured' | 'failed'
	readonly emailProvider: string
}

export interface BootstrappedWorkspace {
	readonly engine: HuriroSyncEngine
	readonly api: TaskApiBridge
	readonly workspaceName: string
	readonly currentUserId: string
	readonly userDisplayName: string
	readonly isPreview: boolean
	readonly mode: 'selfhost' | 'cloud'
}

/** Gate rendered instead of a workspace when the api requires a session first. */
export interface AuthRequired {
	readonly kind: 'auth'
	readonly needsSetup: boolean
	readonly socialProviders: readonly SocialProviderId[]
}

/** Gate rendered when a signed-in user does not belong to any workspace yet. */
export interface OnboardingRequired {
	readonly kind: 'onboarding'
	readonly needsSetup: boolean
	readonly user: {
		readonly id: string
		readonly email: string
		readonly name: string
	}
}

export type BootResult = BootstrappedWorkspace | AuthRequired | OnboardingRequired

export function isAuthRequired(result: BootResult): result is AuthRequired {
	return (result as AuthRequired).kind === 'auth'
}

export function isOnboardingRequired(result: BootResult): result is OnboardingRequired {
	return (result as OnboardingRequired).kind === 'onboarding'
}
