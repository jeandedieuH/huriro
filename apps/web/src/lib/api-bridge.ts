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
	AddTeamspaceMemberBody,
	AgentApprovalDto,
	AgentPrincipalDto,
	AiDocBlockAssistRequest,
	AiDocBlockAssistResponse,
	AiMailAssistRequest,
	AiMailAssistResponse,
	AiProviderDto,
	AiProviderUpsert,
	AiSettingsPatch,
	AiSettingsResponse,
	ApplyMailMacroBody,
	AvailabilityWindowDto,
	BillingPortalDto,
	BillingSummaryResponse,
	BookmarkMetadataDto,
	BulkIssuesBody,
	BulkIssuesResponse,
	BulkRestoreBody,
	ChannelChangesResponse,
	ChatBookmarkBody,
	ChatCanvasDto,
	ChatChannelBookmarkDto,
	ChatChannelDto,
	ChatChannelMemberDto,
	ChatDraftBody,
	ChatDraftDto,
	ChatHuddleJoinDto,
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
	ChatSidebarSectionItemDto,
	ChatThreadSummaryDto,
	CheckoutSessionDto,
	CollabTicketResponse,
	CompleteDraftReviewBody,
	ContactBody,
	ContactDto,
	ContactOrganizationBody,
	ContactOrganizationDto,
	ConversationTagsBody,
	ConvertToIssueBody,
	CreateAvailabilityWindowBody,
	CreateBillingPortalBody,
	CreateChannelBody,
	CreateCheckoutBody,
	CreateCycleBody,
	CreateDmBody,
	CreateDocCommentBody,
	CreateEntityLinkBody,
	CreateGithubInstallationBody,
	CreateIssueGithubLinkBody,
	CreateMailAccountBody,
	CreateMailIdentityBody,
	CreateMailInboxBody,
	CreateMailNoteBody,
	CreateOutboundConversationBody,
	CreatePollBody,
	CreateSyncedBlockBody,
	CreateTeamspaceBody,
	CreateUserGroupBody,
	CreateWebhookBody,
	CreateWebhookResponse,
	CreateWebPushSubscriptionBody,
	CreateWorkspaceEmojiBody,
	CycleDailySnapshotDto,
	CycleDto,
	DocAppendBody,
	DocButtonTriggerBody,
	DocCommentDto,
	DocExportHtmlResponse,
	DocExportMarkdownResponse,
	DocImportMarkdownBody,
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
	EntityType,
	EraseAccountBody,
	EraseAccountResponse,
	FileDto,
	ForwardConversationBody,
	ForwardMessageBody,
	GithubInstallationDto,
	ImportDocDatabaseRowsBody,
	ImportDocDatabaseRowsResultDto,
	ImportDryRunBody,
	ImportDryRunPreviewDto,
	ImportExecuteBody,
	ImportJobDto,
	IssueCommentDto,
	IssueDto,
	IssueGithubLinkDto,
	IssueRelationDto,
	KnowledgeGraphResponse,
	LinkConversationBody,
	ListMessagesResponse,
	MailAccountDto,
	MailBulkTriageBody,
	MailBulkTriageResultDto,
	MailConversationDto,
	MailConversationStatus,
	MailDraftDto,
	MailIdentityDto,
	MailInboxDto,
	MailInboxSettingsBody,
	MailMacroBody,
	MailMacroDto,
	MailNoteDto,
	MailOutboundResultDto,
	MailRouteResultDto,
	MailRoutingConfigBody,
	MailRoutingConfigDto,
	MailSlaAnalyticsDto,
	MailSlaPolicyBody,
	MailSlaPolicyDto,
	MailSplitResultDto,
	MailTagBody,
	MailTagDto,
	MailTemplateBody,
	MailTemplateDto,
	MailTimelineDto,
	NotificationPreferencesDto,
	PeekCardDto,
	ProposeDocSuggestionBody,
	QueryIssuesBody,
	RelationKind,
	RenderedMailTemplateDto,
	RenderMailTemplateBody,
	RequestDraftReviewBody,
	SearchHitDto,
	SendMailDraftBody,
	SendMessageBody,
	SendTestEmailResponse,
	SetDocVerificationBody,
	SplitConversationBody,
	TeamspaceDto,
	TeamspaceMemberDto,
	TriageActionBody,
	TriageSuggestionsDto,
	UpdateAvailabilityWindowBody,
	UpdateChannelBody,
	UpdateChatSavedItemBody,
	UpdateChatSidebarSectionBody,
	UpdateConversationBody,
	UpdateDocCommentBody,
	UpdateGithubInstallationBody,
	UpdateMailAccountBody,
	UpdateMessageBody,
	UpdateMyAvailabilityBody,
	UpdateNotificationPreferencesBody,
	UpdateSyncedBlockBody,
	UpdateTeamspaceBody,
	UpdateUserStatusBody,
	UpdateWebhookBody,
	UpsertDocPublicShareBody,
	UpsertMailDraftBody,
	UserAvailabilityDto,
	UserGroupDto,
	UserWorkspaceProfileDto,
	VotePollBody,
	WebhookDeliveryDto,
	WebhookEndpointDto,
	WebPushSubscriptionDto,
	WorkspaceEmojiDto,
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
	appendDocPage(pageId: string, body: DocAppendBody): Promise<DocPageDetailDto>
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
	listResourceAcls(
		resourceType: 'project' | 'doc_page' | 'teamspace',
		resourceId: string
	): Promise<ResourceAclItemDto[]>
	grantResourceAcl(input: {
		readonly resourceType: 'project' | 'doc_page' | 'teamspace'
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
		muted: boolean,
		opts?: {
			readonly notifyLevel?: 'default' | 'all' | 'mentions' | 'none'
			readonly mutedUntil?: string | null
		}
	): Promise<{
		readonly channelId: string
		readonly muted: boolean
		readonly notifyLevel?: 'default' | 'all' | 'mentions' | 'none'
		readonly mutedUntil?: string | null
	}>
	listThreads(): Promise<ChatThreadSummaryDto[]>
	listPinnedMessages(channelId: string): Promise<ChatPinnedMessageDto[]>
	pinMessage(messageId: string): Promise<unknown>
	unpinMessage(messageId: string): Promise<unknown>
	// M11 Chat v2 (drafts, scheduled, saved, sidebar sections, bookmarks, status, groups, emoji, polls, forward, canvas, huddles)
	listChatDrafts(): Promise<ChatDraftDto[]>
	upsertChatDraft(
		channelId: string,
		body: ChatDraftBody
	): Promise<
		| ChatDraftDto
		| { readonly deleted: true; readonly channelId: string; readonly threadParentId: string | null }
	>
	deleteChatDraft(draftId: string): Promise<void>
	listScheduledChatMessages(): Promise<ChatScheduledMessageDto[]>
	scheduleChatMessage(channelId: string, body: ChatScheduleMessageBody): Promise<ChatScheduledMessageDto>
	cancelScheduledChatMessage(
		id: string,
		version: number
	): Promise<{ readonly id: string; readonly status: string; readonly version: number }>
	listSavedChatItems(): Promise<ChatSavedItemDto[]>
	createSavedChatItem(body: ChatSavedItemBody): Promise<ChatSavedItemDto>
	updateSavedChatItem(id: string, body: UpdateChatSavedItemBody): Promise<ChatSavedItemDto>
	deleteSavedChatItem(id: string): Promise<void>
	listChatSidebarSections(): Promise<ChatSidebarSectionDto[]>
	createChatSidebarSection(body: ChatSidebarSectionBody): Promise<ChatSidebarSectionDto>
	updateChatSidebarSection(id: string, body: UpdateChatSidebarSectionBody): Promise<ChatSidebarSectionDto>
	deleteChatSidebarSection(id: string): Promise<void>
	addChatSidebarSectionItem(
		sectionId: string,
		body: { readonly channelId: string; readonly position?: string }
	): Promise<ChatSidebarSectionItemDto>
	removeChatSidebarSectionItem(sectionId: string, channelId: string): Promise<void>
	listChannelBookmarks(channelId: string): Promise<ChatChannelBookmarkDto[]>
	createChannelBookmark(channelId: string, body: ChatBookmarkBody): Promise<ChatChannelBookmarkDto>
	deleteChannelBookmark(id: string): Promise<void>
	getMyChatStatus(): Promise<UserWorkspaceProfileDto>
	updateMyChatStatus(body: UpdateUserStatusBody): Promise<UserWorkspaceProfileDto>
	listWorkspaceAvailability(): Promise<UserAvailabilityDto[]>
	getMyAvailability(): Promise<UserAvailabilityDto>
	updateMyAvailability(body: UpdateMyAvailabilityBody): Promise<UserAvailabilityDto>
	listAvailabilityWindows(): Promise<AvailabilityWindowDto[]>
	createAvailabilityWindow(body: CreateAvailabilityWindowBody): Promise<AvailabilityWindowDto>
	updateAvailabilityWindow(id: string, body: UpdateAvailabilityWindowBody): Promise<AvailabilityWindowDto>
	deleteAvailabilityWindow(id: string): Promise<{ readonly deleted: true }>
	listUserGroups(): Promise<UserGroupDto[]>
	createUserGroup(body: CreateUserGroupBody): Promise<UserGroupDto>
	setUserGroupMembers(
		groupId: string,
		memberIds: readonly string[]
	): Promise<{ readonly memberIds: readonly string[] }>
	listWorkspaceEmojis(): Promise<WorkspaceEmojiDto[]>
	createWorkspaceEmoji(body: CreateWorkspaceEmojiBody): Promise<WorkspaceEmojiDto>
	deleteWorkspaceEmoji(id: string): Promise<void>
	listChannelPolls(channelId: string): Promise<ChatPollDto[]>
	createChatPoll(channelId: string, body: CreatePollBody): Promise<ChatPollDto>
	getChatPoll(pollId: string): Promise<ChatPollDto>
	voteChatPoll(pollId: string, body: VotePollBody): Promise<unknown>
	closeChatPoll(
		pollId: string
	): Promise<{ readonly id: string; readonly status: string; readonly version: number }>
	forwardChatMessage(messageId: string, body: ForwardMessageBody): Promise<ChatMessageDto>
	ensureChannelCanvas(channelId: string): Promise<ChatCanvasDto>
	getActiveChannelHuddle(channelId: string): Promise<ChatHuddleSessionDto | null>
	startChatHuddle(channelId: string): Promise<ChatHuddleSessionDto>
	joinChatHuddle(huddleId: string): Promise<ChatHuddleJoinDto>
	endChatHuddle(huddleId: string): Promise<{ readonly id: string; readonly status: string }>
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
		readonly tagId?: string | undefined
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
	issueMailDraftCollabTicket(draftId: string): Promise<CollabTicketResponse>
	sendMailDraft(draftId: string, body: SendMailDraftBody): Promise<MailDraftDto>
	undoMailDraft(draftId: string): Promise<MailDraftDto>
	discardMailDraft(draftId: string): Promise<void>
	// M11: Mail v2 parity
	listMailTags(inboxId?: string): Promise<MailTagDto[]>
	createMailTag(body: MailTagBody): Promise<MailTagDto>
	deleteMailTag(id: string): Promise<void>
	listConversationTags(conversationId: string): Promise<MailTagDto[]>
	setConversationTags(
		conversationId: string,
		body: ConversationTagsBody
	): Promise<{ readonly tagIds: readonly string[] }>
	listMailTemplates(filter?: {
		readonly inboxId?: string | undefined
		readonly personal?: boolean | undefined
	}): Promise<MailTemplateDto[]>
	upsertMailTemplate(body: MailTemplateBody, id?: string): Promise<MailTemplateDto>
	deleteMailTemplate(id: string): Promise<void>
	renderMailTemplate(id: string, body: RenderMailTemplateBody): Promise<RenderedMailTemplateDto>
	listMailMacros(inboxId?: string): Promise<MailMacroDto[]>
	upsertMailMacro(body: MailMacroBody, id?: string): Promise<MailMacroDto>
	deleteMailMacro(id: string): Promise<void>
	applyMailMacro(id: string, body: ApplyMailMacroBody): Promise<{ readonly appliedCount: number }>
	createOutboundConversation(body: CreateOutboundConversationBody): Promise<MailOutboundResultDto>
	forwardConversation(conversationId: string, body: ForwardConversationBody): Promise<MailOutboundResultDto>
	splitConversation(conversationId: string, body: SplitConversationBody): Promise<MailSplitResultDto>
	bulkTriageConversations(body: MailBulkTriageBody): Promise<MailBulkTriageResultDto>
	listContacts(q?: string): Promise<ContactDto[]>
	upsertContact(body: ContactBody, id?: string): Promise<ContactDto>
	listContactOrganizations(): Promise<ContactOrganizationDto[]>
	upsertContactOrganization(body: ContactOrganizationBody, id?: string): Promise<ContactOrganizationDto>
	getMailRoutingConfig(inboxId: string): Promise<MailRoutingConfigDto>
	upsertMailRoutingConfig(inboxId: string, body: MailRoutingConfigBody): Promise<MailRoutingConfigDto>
	routeConversationRoundRobin(conversationId: string): Promise<MailRouteResultDto>
	listMailSlaPolicies(inboxId?: string): Promise<MailSlaPolicyDto[]>
	upsertMailSlaPolicy(body: MailSlaPolicyBody, id?: string): Promise<MailSlaPolicyDto>
	deleteMailSlaPolicy(id: string): Promise<void>
	getMailSlaAnalytics(inboxId?: string): Promise<MailSlaAnalyticsDto>
	requestMailDraftReview(draftId: string, body: RequestDraftReviewBody): Promise<MailDraftDto>
	completeMailDraftReview(draftId: string, body: CompleteDraftReviewBody): Promise<MailDraftDto>
	updateMailInboxSettings(inboxId: string, body: MailInboxSettingsBody): Promise<MailInboxDto>
	assistMailWithAi(body: AiMailAssistRequest): Promise<AiMailAssistResponse>
	assistDocBlockWithAi(body: AiDocBlockAssistRequest): Promise<AiDocBlockAssistResponse>
	getBillingSubscription(): Promise<BillingSummaryResponse>
	createBillingCheckout(body: CreateCheckoutBody): Promise<CheckoutSessionDto>
	createBillingPortal(body: CreateBillingPortalBody): Promise<BillingPortalDto>
	listWorkspaceExports(): Promise<WorkspaceExportDto[]>
	createWorkspaceExport(): Promise<WorkspaceExportDto>
	getWorkspaceExportDownloadUrl(exportId: string): string
	eraseMyAccount(body: EraseAccountBody): Promise<EraseAccountResponse>
	// M7: triage queue, bulk actions + undo, compound queries, cycles, entity graph
	listTriageQueue(projectId: string, state?: 'pending' | 'snoozed' | 'resolved'): Promise<IssueDto[]>
	triageIssue(issueId: string, body: TriageActionBody): Promise<IssueDto>
	getTriageSuggestions(issueId: string): Promise<TriageSuggestionsDto>
	bulkUpdateIssues(body: BulkIssuesBody): Promise<BulkIssuesResponse>
	bulkRestoreIssues(body: BulkRestoreBody): Promise<{ readonly restored: number }>
	queryIssues(body: QueryIssuesBody): Promise<{
		readonly data: IssueDto[]
		readonly nextCursor: string | null
		readonly hasMore: boolean
	}>
	createCycle(body: CreateCycleBody): Promise<CycleDto>
	listCycleSnapshots(cycleId: string): Promise<CycleDailySnapshotDto[]>
	listEntityLinks(type: EntityType, id: string): Promise<EntityLinkDto[]>
	createEntityLink(body: CreateEntityLinkBody): Promise<EntityLinkDto>
	deleteEntityLink(linkId: string): Promise<void>
	peekEntity(type: EntityType, id: string): Promise<PeekCardDto | null>
	// M9: teamspaces, synced blocks, suggestions, verification, publishing, rich exports, bookmarks, buttons & graph
	listTeamspaces(): Promise<TeamspaceDto[]>
	createTeamspace(body: CreateTeamspaceBody): Promise<TeamspaceDto>
	updateTeamspace(id: string, body: UpdateTeamspaceBody): Promise<TeamspaceDto>
	archiveTeamspace(id: string, version?: number): Promise<void>
	listTeamspaceMembers(id: string): Promise<TeamspaceMemberDto[]>
	addTeamspaceMember(id: string, body: AddTeamspaceMemberBody): Promise<TeamspaceMemberDto>
	removeTeamspaceMember(id: string, userId: string): Promise<void>
	listSyncedBlocks(): Promise<DocSyncedBlockDto[]>
	createSyncedBlock(body: CreateSyncedBlockBody): Promise<DocSyncedBlockDto>
	getSyncedBlock(id: string): Promise<DocSyncedBlockDto>
	updateSyncedBlock(id: string, body: UpdateSyncedBlockBody): Promise<DocSyncedBlockDto>
	issueSyncedBlockCollabTicket(id: string): Promise<CollabTicketResponse>
	listDocSuggestions(pageId: string): Promise<DocSuggestionDto[]>
	proposeDocSuggestion(pageId: string, body: ProposeDocSuggestionBody): Promise<DocSuggestionDto>
	decideDocSuggestion(
		pageId: string,
		groupId: string,
		decision: 'accept' | 'reject'
	): Promise<DocSuggestionDto>
	decideAllDocSuggestions(
		pageId: string,
		decision: 'accept' | 'reject'
	): Promise<{ readonly updatedCount: number }>
	getDocVerification(pageId: string): Promise<DocVerificationDto | null>
	setDocVerification(pageId: string, body: SetDocVerificationBody): Promise<DocVerificationDto>
	clearDocVerification(pageId: string): Promise<void>
	getDocPublicShare(pageId: string): Promise<DocPublicShareDto | null>
	upsertDocPublicShare(pageId: string, body: UpsertDocPublicShareBody): Promise<DocPublicShareDto>
	revokeDocPublicShare(pageId: string): Promise<void>
	exportDocHtml(pageId: string, print?: boolean): Promise<DocExportHtmlResponse>
	exportDocZip(pageId: string, includeChildren?: boolean): Promise<Blob>
	unfurlBookmark(url: string): Promise<BookmarkMetadataDto>
	triggerDocButton(pageId: string, body: DocButtonTriggerBody): Promise<void>
	getKnowledgeGraph(teamspaceId?: string): Promise<KnowledgeGraphResponse>
	// M10: structured document database import/export + row-page allocation. Row/property CRUD goes through HuriroSyncEngine.
	importDocDatabaseRows(
		databaseId: string,
		body: ImportDocDatabaseRowsBody
	): Promise<ImportDocDatabaseRowsResultDto>
	exportDocDatabaseRows(databaseId: string, format: 'csv' | 'json', viewId?: string): Promise<string>
	ensureDocDatabaseRowPage(
		databaseId: string,
		rowId: string
	): Promise<{ readonly pageId: string; readonly created: boolean }>
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
