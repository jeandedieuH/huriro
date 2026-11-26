// Shared inbox wire contract (§14, §16).
import { type Static, Type } from 'typebox'

export const MailProvider = Type.Union([
	Type.Literal('inbound_parse'),
	Type.Literal('gmail'),
	Type.Literal('graph'),
	Type.Literal('imap'),
	Type.Literal('jmap')
])
export type MailProvider = Static<typeof MailProvider>

export const MailAccountStatus = Type.Union([
	Type.Literal('active'),
	Type.Literal('pending_verification'),
	Type.Literal('error'),
	Type.Literal('disconnected')
])
export type MailAccountStatus = Static<typeof MailAccountStatus>

export const MailConversationStatus = Type.Union([
	Type.Literal('open'),
	Type.Literal('pending'),
	Type.Literal('snoozed'),
	Type.Literal('closed'),
	Type.Literal('spam')
])
export type MailConversationStatus = Static<typeof MailConversationStatus>

export const MailAddress = Type.Object({
	email: Type.String(),
	name: Type.Optional(Type.Union([Type.String(), Type.Null()]))
})
export type MailAddress = Static<typeof MailAddress>

export const MailAccountDto = Type.Object({
	id: Type.String({ format: 'uuid' }),
	workspaceId: Type.String({ format: 'uuid' }),
	provider: MailProvider,
	address: Type.String(),
	displayName: Type.Union([Type.String(), Type.Null()]),
	defaultInboxId: Type.Union([Type.String({ format: 'uuid' }), Type.Null()]),
	status: MailAccountStatus,
	statusDetail: Type.Union([Type.String(), Type.Null()]),
	lastSyncedAt: Type.Union([Type.String(), Type.Null()]),
	createdAt: Type.String(),
	updatedAt: Type.String(),
	version: Type.Integer({ minimum: 1 }),
	/** Inbound-parse accounts only: the webhook URL + DNS records to publish. */
	inboundUrl: Type.Optional(Type.Union([Type.String(), Type.Null()])),
	domainRecords: Type.Optional(Type.Array(Type.Record(Type.String(), Type.String())))
})
export type MailAccountDto = Static<typeof MailAccountDto>

export const CreateMailAccountBody = Type.Object({
	provider: MailProvider,
	address: Type.String({ minLength: 3, maxLength: 320 }),
	displayName: Type.Optional(Type.String({ maxLength: 200 })),
	defaultInboxId: Type.Optional(Type.String({ format: 'uuid' })),
	/** IMAP/SMTP connection settings (imap provider). */
	config: Type.Optional(
		Type.Object({
			imapHost: Type.Optional(Type.String()),
			imapPort: Type.Optional(Type.Integer({ minimum: 1, maximum: 65535 })),
			imapTls: Type.Optional(Type.Boolean()),
			imapUser: Type.Optional(Type.String()),
			imapPassword: Type.Optional(Type.String()),
			smtpHost: Type.Optional(Type.String()),
			smtpPort: Type.Optional(Type.Integer({ minimum: 1, maximum: 65535 })),
			smtpUser: Type.Optional(Type.String()),
			smtpPassword: Type.Optional(Type.String())
		})
	)
})
export type CreateMailAccountBody = Static<typeof CreateMailAccountBody>

export const UpdateMailAccountBody = Type.Object({
	displayName: Type.Optional(Type.Union([Type.String(), Type.Null()])),
	defaultInboxId: Type.Optional(Type.Union([Type.String({ format: 'uuid' }), Type.Null()])),
	status: Type.Optional(MailAccountStatus)
})
export type UpdateMailAccountBody = Static<typeof UpdateMailAccountBody>

export const MailIdentityDto = Type.Object({
	id: Type.String({ format: 'uuid' }),
	accountId: Type.String({ format: 'uuid' }),
	address: Type.String(),
	displayName: Type.Union([Type.String(), Type.Null()]),
	isDefault: Type.Boolean(),
	createdAt: Type.String()
})
export type MailIdentityDto = Static<typeof MailIdentityDto>

export const CreateMailIdentityBody = Type.Object({
	accountId: Type.String({ format: 'uuid' }),
	address: Type.String({ minLength: 3, maxLength: 320 }),
	displayName: Type.Optional(Type.String({ maxLength: 200 })),
	signatureText: Type.Optional(Type.String({ maxLength: 4000 })),
	isDefault: Type.Optional(Type.Boolean())
})
export type CreateMailIdentityBody = Static<typeof CreateMailIdentityBody>

export const MailInboxDto = Type.Object({
	id: Type.String({ format: 'uuid' }),
	workspaceId: Type.String({ format: 'uuid' }),
	name: Type.String(),
	position: Type.String(),
	settings: Type.Record(Type.String(), Type.Unknown()),
	visibility: Type.Union([Type.Literal('shared'), Type.Literal('private')]),
	ownerUserId: Type.Union([Type.String({ format: 'uuid' }), Type.Null()]),
	openCount: Type.Integer({ minimum: 0 }),
	version: Type.Optional(Type.Integer({ minimum: 1 })),
	createdAt: Type.String()
})
export type MailInboxDto = Static<typeof MailInboxDto>

export const CreateMailInboxBody = Type.Object({
	name: Type.String({ minLength: 1, maxLength: 120 }),
	settings: Type.Optional(Type.Record(Type.String(), Type.Unknown())),
	visibility: Type.Optional(Type.Union([Type.Literal('shared'), Type.Literal('private')])),
	ownerUserId: Type.Optional(Type.String({ format: 'uuid' }))
})
export type CreateMailInboxBody = Static<typeof CreateMailInboxBody>

export const MailConversationDto = Type.Object({
	id: Type.String({ format: 'uuid' }),
	workspaceId: Type.String({ format: 'uuid' }),
	inboxId: Type.String({ format: 'uuid' }),
	accountId: Type.String({ format: 'uuid' }),
	subject: Type.String(),
	status: MailConversationStatus,
	assigneeId: Type.Union([Type.String({ format: 'uuid' }), Type.Null()]),
	assigneeName: Type.Optional(Type.Union([Type.String(), Type.Null()])),
	snoozedUntil: Type.Union([Type.String(), Type.Null()]),
	mergedIntoId: Type.Union([Type.String({ format: 'uuid' }), Type.Null()]),
	lastMessageAt: Type.String(),
	firstReplyAt: Type.Union([Type.String(), Type.Null()]),
	customerEmail: Type.Union([Type.String(), Type.Null()]),
	contactId: Type.Union([Type.String({ format: 'uuid' }), Type.Null()]),
	followUpAt: Type.Union([Type.String(), Type.Null()]),
	followUpCondition: Type.Union([Type.Literal('if_no_reply'), Type.Literal('always'), Type.Null()]),
	slaNextDueAt: Type.Union([Type.String(), Type.Null()]),
	slaBreachedAt: Type.Union([Type.String(), Type.Null()]),
	priority: Type.Union([
		Type.Literal('low'),
		Type.Literal('normal'),
		Type.Literal('high'),
		Type.Literal('urgent')
	]),
	tagIds: Type.Optional(Type.Array(Type.String({ format: 'uuid' }))),
	snippet: Type.String(),
	messageCount: Type.Integer({ minimum: 0 }),
	createdAt: Type.String(),
	updatedAt: Type.String(),
	version: Type.Integer({ minimum: 1 })
})
export type MailConversationDto = Static<typeof MailConversationDto>

export const ListConversationsQuery = Type.Object({
	inboxId: Type.Optional(Type.String({ format: 'uuid' })),
	status: Type.Optional(MailConversationStatus),
	assignee: Type.Optional(
		Type.Union([Type.Literal('me'), Type.Literal('unassigned'), Type.String({ format: 'uuid' })])
	),
	tagId: Type.Optional(Type.String({ format: 'uuid' })),
	q: Type.Optional(Type.String({ maxLength: 300 })),
	cursor: Type.Optional(Type.String()),
	limit: Type.Optional(Type.Integer({ minimum: 1, maximum: 100 }))
})
export type ListConversationsQuery = Static<typeof ListConversationsQuery>

export const MailAttachmentMetaDto = Type.Object({
	fileId: Type.Optional(Type.Union([Type.String({ format: 'uuid' }), Type.Null()])),
	name: Type.String(),
	contentType: Type.String(),
	byteSize: Type.Integer({ minimum: 0 }),
	scanStatus: Type.Optional(Type.String())
})
export type MailAttachmentMetaDto = Static<typeof MailAttachmentMetaDto>

export const MailAuthResultsDto = Type.Object({
	spf: Type.Optional(Type.Union([Type.String(), Type.Null()])),
	dkim: Type.Optional(Type.Union([Type.String(), Type.Null()])),
	dmarc: Type.Optional(Type.Union([Type.String(), Type.Null()]))
})
export type MailAuthResultsDto = Static<typeof MailAuthResultsDto>

export const MailMessageDto = Type.Object({
	id: Type.String({ format: 'uuid' }),
	conversationId: Type.String({ format: 'uuid' }),
	direction: Type.Union([Type.Literal('inbound'), Type.Literal('outbound')]),
	rfcMessageId: Type.Union([Type.String(), Type.Null()]),
	fromAddr: MailAddress,
	toAddrs: Type.Array(MailAddress),
	ccAddrs: Type.Array(MailAddress),
	subject: Type.Union([Type.String(), Type.Null()]),
	snippet: Type.String(),
	sentAt: Type.Union([Type.String(), Type.Null()]),
	receivedAt: Type.String(),
	bodyHtml: Type.Union([Type.String(), Type.Null()]),
	bodyText: Type.Union([Type.String(), Type.Null()]),
	attachments: Type.Array(MailAttachmentMetaDto),
	authResults: Type.Union([MailAuthResultsDto, Type.Null()]),
	sendState: Type.Union([Type.String(), Type.Null()]),
	createdBy: Type.Union([Type.String({ format: 'uuid' }), Type.Null()]),
	createdAt: Type.String()
})
export type MailMessageDto = Static<typeof MailMessageDto>

export const MailConversationEventDto = Type.Object({
	id: Type.String({ format: 'uuid' }),
	kind: Type.String(),
	actorId: Type.Union([Type.String({ format: 'uuid' }), Type.Null()]),
	actorName: Type.Optional(Type.Union([Type.String(), Type.Null()])),
	payload: Type.Record(Type.String(), Type.Unknown()),
	createdAt: Type.String()
})
export type MailConversationEventDto = Static<typeof MailConversationEventDto>

export const MailNoteDto = Type.Object({
	id: Type.String({ format: 'uuid' }),
	conversationId: Type.String({ format: 'uuid' }),
	authorId: Type.String({ format: 'uuid' }),
	authorName: Type.Optional(Type.Union([Type.String(), Type.Null()])),
	body: Type.Record(Type.String(), Type.Unknown()),
	bodyText: Type.String(),
	mentions: Type.Array(Type.String({ format: 'uuid' })),
	createdAt: Type.String()
})
export type MailNoteDto = Static<typeof MailNoteDto>

export const MailDraftDto = Type.Object({
	id: Type.String({ format: 'uuid' }),
	conversationId: Type.String({ format: 'uuid' }),
	identityId: Type.String({ format: 'uuid' }),
	createdBy: Type.String({ format: 'uuid' }),
	body: Type.Record(Type.String(), Type.Unknown()),
	bodyText: Type.String(),
	recipients: Type.Record(Type.String(), Type.Unknown()),
	inReplyToId: Type.Union([Type.String({ format: 'uuid' }), Type.Null()]),
	scheduledSendAt: Type.Union([Type.String(), Type.Null()]),
	status: Type.Union([
		Type.Literal('draft'),
		Type.Literal('sending'),
		Type.Literal('sent'),
		Type.Literal('discarded')
	]),
	lockedBy: Type.Union([Type.String({ format: 'uuid' }), Type.Null()]),
	lockedUntil: Type.Union([Type.String(), Type.Null()]),
	collabEnabled: Type.Boolean(),
	reviewStatus: Type.Union([
		Type.Literal('none'),
		Type.Literal('requested'),
		Type.Literal('approved'),
		Type.Literal('changes_requested')
	]),
	reviewerId: Type.Union([Type.String({ format: 'uuid' }), Type.Null()]),
	reviewedAt: Type.Union([Type.String(), Type.Null()]),
	reviewNote: Type.Union([Type.String(), Type.Null()]),
	metadata: Type.Unknown(),
	version: Type.Integer({ minimum: 1 }),
	createdAt: Type.String(),
	updatedAt: Type.String()
})
export type MailDraftDto = Static<typeof MailDraftDto>

/** One interleaved timeline: messages + notes + events + drafts (§14.5). */
export const MailTimelineDto = Type.Object({
	conversation: MailConversationDto,
	messages: Type.Array(MailMessageDto),
	notes: Type.Array(MailNoteDto),
	events: Type.Array(MailConversationEventDto),
	drafts: Type.Array(MailDraftDto),
	linkedTasks: Type.Array(
		Type.Object({
			taskId: Type.String({ format: 'uuid' }),
			identifier: Type.Union([Type.String(), Type.Null()]),
			title: Type.Union([Type.String(), Type.Null()])
		})
	),
	linkedDocs: Type.Array(
		Type.Object({
			pageId: Type.String({ format: 'uuid' }),
			slug: Type.Union([Type.String(), Type.Null()]),
			title: Type.Union([Type.String(), Type.Null()])
		})
	)
})
export type MailTimelineDto = Static<typeof MailTimelineDto>

export const UpdateConversationBody = Type.Object({
	status: Type.Optional(MailConversationStatus),
	assigneeId: Type.Optional(Type.Union([Type.String({ format: 'uuid' }), Type.Null()])),
	snoozedUntil: Type.Optional(Type.Union([Type.String(), Type.Null()])),
	priority: Type.Optional(
		Type.Union([Type.Literal('low'), Type.Literal('normal'), Type.Literal('high'), Type.Literal('urgent')])
	),
	followUpAt: Type.Optional(Type.Union([Type.String(), Type.Null()])),
	followUpCondition: Type.Optional(
		Type.Union([Type.Literal('if_no_reply'), Type.Literal('always'), Type.Null()])
	),
	expectedVersion: Type.Optional(Type.Integer({ minimum: 1 }))
})
export type UpdateConversationBody = Static<typeof UpdateConversationBody>

export const CreateMailNoteBody = Type.Object({
	bodyText: Type.String({ minLength: 1, maxLength: 20000 }),
	body: Type.Optional(Type.Record(Type.String(), Type.Unknown())),
	mentions: Type.Optional(Type.Array(Type.String({ format: 'uuid' }), { maxItems: 50 }))
})
export type CreateMailNoteBody = Static<typeof CreateMailNoteBody>

export const UpsertMailDraftBody = Type.Object({
	identityId: Type.String({ format: 'uuid' }),
	inReplyToId: Type.Optional(Type.Union([Type.String({ format: 'uuid' }), Type.Null()])),
	recipients: Type.Object({
		to: Type.Array(MailAddress, { minItems: 1, maxItems: 50 }),
		cc: Type.Optional(Type.Array(MailAddress, { maxItems: 50 })),
		bcc: Type.Optional(Type.Array(MailAddress, { maxItems: 50 }))
	}),
	bodyText: Type.String({ maxLength: 100000 }),
	body: Type.Optional(Type.Record(Type.String(), Type.Unknown())),
	collabEnabled: Type.Optional(Type.Boolean()),
	scheduledSendAt: Type.Optional(Type.Union([Type.String({ format: 'date-time' }), Type.Null()])),
	attachmentFileIds: Type.Optional(Type.Array(Type.String({ format: 'uuid' }), { maxItems: 25 }))
})
export type UpsertMailDraftBody = Static<typeof UpsertMailDraftBody>

export const SendMailDraftBody = Type.Object({
	/** Seconds to hold before real send — the undo window (default: server config). */
	undoSeconds: Type.Optional(Type.Integer({ minimum: 0, maximum: 120 })),
	scheduledSendAt: Type.Optional(Type.String({ format: 'date-time' })),
	expectedVersion: Type.Optional(Type.Integer({ minimum: 1 }))
})
export type SendMailDraftBody = Static<typeof SendMailDraftBody>

export const LinkConversationBody = Type.Object({
	taskId: Type.Optional(Type.String({ format: 'uuid' })),
	pageId: Type.Optional(Type.String({ format: 'uuid' }))
})
export type LinkConversationBody = Static<typeof LinkConversationBody>

export const ConvertToIssueBody = Type.Object({
	projectId: Type.String({ format: 'uuid' }),
	title: Type.Optional(Type.String({ maxLength: 300 }))
})
export type ConvertToIssueBody = Static<typeof ConvertToIssueBody>

export const MergeConversationsBody = Type.Object({
	sourceConversationId: Type.String({ format: 'uuid' })
})
export type MergeConversationsBody = Static<typeof MergeConversationsBody>

export const RequestDraftReviewBody = Type.Object({
	reviewerId: Type.String({ format: 'uuid' }),
	note: Type.Optional(Type.String({ maxLength: 4000 }))
})
export type RequestDraftReviewBody = Static<typeof RequestDraftReviewBody>

export const CompleteDraftReviewBody = Type.Object({
	decision: Type.Union([Type.Literal('approved'), Type.Literal('changes_requested')]),
	note: Type.Optional(Type.String({ maxLength: 4000 }))
})
export type CompleteDraftReviewBody = Static<typeof CompleteDraftReviewBody>

export const CreateOutboundConversationBody = Type.Object({
	inboxId: Type.String({ format: 'uuid' }),
	identityId: Type.String({ format: 'uuid' }),
	subject: Type.String({ minLength: 1, maxLength: 500 }),
	recipients: Type.Object({
		to: Type.Array(MailAddress, { minItems: 1, maxItems: 50 }),
		cc: Type.Optional(Type.Array(MailAddress, { maxItems: 50 })),
		bcc: Type.Optional(Type.Array(MailAddress, { maxItems: 50 }))
	}),
	bodyText: Type.String({ maxLength: 100000 }),
	body: Type.Optional(Type.Record(Type.String(), Type.Unknown())),
	scheduledSendAt: Type.Optional(Type.Union([Type.String(), Type.Null()])),
	followUpAt: Type.Optional(Type.Union([Type.String(), Type.Null()])),
	followUpCondition: Type.Optional(Type.Union([Type.Literal('if_no_reply'), Type.Literal('always')])),
	collabEnabled: Type.Optional(Type.Boolean()),
	attachmentFileIds: Type.Optional(Type.Array(Type.String({ format: 'uuid' }), { maxItems: 25 })),
	assigneeId: Type.Optional(Type.String({ format: 'uuid' }))
})
export type CreateOutboundConversationBody = Static<typeof CreateOutboundConversationBody>

export const ForwardConversationBody = Type.Object({
	identityId: Type.String({ format: 'uuid' }),
	recipients: Type.Object({
		to: Type.Array(MailAddress, { minItems: 1, maxItems: 50 }),
		cc: Type.Optional(Type.Array(MailAddress, { maxItems: 50 })),
		bcc: Type.Optional(Type.Array(MailAddress, { maxItems: 50 }))
	}),
	bodyText: Type.String({ maxLength: 100000 }),
	includeHistory: Type.Optional(Type.Boolean()),
	scheduledSendAt: Type.Optional(Type.Union([Type.String(), Type.Null()])),
	followUpAt: Type.Optional(Type.Union([Type.String(), Type.Null()])),
	followUpCondition: Type.Optional(Type.Union([Type.Literal('if_no_reply'), Type.Literal('always')])),
	attachmentFileIds: Type.Optional(Type.Array(Type.String({ format: 'uuid' }), { maxItems: 25 }))
})
export type ForwardConversationBody = Static<typeof ForwardConversationBody>

export const SplitConversationBody = Type.Object({
	messageId: Type.String({ format: 'uuid' }),
	subject: Type.Optional(Type.String({ maxLength: 500 }))
})
export type SplitConversationBody = Static<typeof SplitConversationBody>

export const MailTagBody = Type.Object({
	inboxId: Type.Optional(Type.Union([Type.String({ format: 'uuid' }), Type.Null()])),
	name: Type.String({ minLength: 1, maxLength: 80 }),
	color: Type.Optional(Type.String({ maxLength: 40 }))
})
export type MailTagBody = Static<typeof MailTagBody>

export const ConversationTagsBody = Type.Object({
	tagIds: Type.Array(Type.String({ format: 'uuid' }), { maxItems: 50 })
})
export type ConversationTagsBody = Static<typeof ConversationTagsBody>

export const MailTemplateBody = Type.Object({
	inboxId: Type.Optional(Type.Union([Type.String({ format: 'uuid' }), Type.Null()])),
	ownerUserId: Type.Optional(Type.Union([Type.String({ format: 'uuid' }), Type.Null()])),
	name: Type.String({ minLength: 1, maxLength: 160 }),
	shortcut: Type.String({ pattern: '^;[a-z0-9][a-z0-9_-]{0,63}$' }),
	bodyText: Type.String({ minLength: 1, maxLength: 100000 }),
	body: Type.Optional(Type.Record(Type.String(), Type.Unknown())),
	bodyHtml: Type.Optional(Type.String({ maxLength: 200000 })),
	attachmentFileIds: Type.Optional(Type.Array(Type.String({ format: 'uuid' }), { maxItems: 10 })),
	mergeVariables: Type.Optional(Type.Array(Type.String(), { maxItems: 50 }))
})
export type MailTemplateBody = Static<typeof MailTemplateBody>

export const RenderMailTemplateBody = Type.Object({
	variables: Type.Optional(Type.Record(Type.String(), Type.String()))
})
export type RenderMailTemplateBody = Static<typeof RenderMailTemplateBody>

export const MailMacroStep = Type.Object({
	action: Type.Union([
		Type.Literal('set_status'),
		Type.Literal('assign'),
		Type.Literal('add_tag'),
		Type.Literal('remove_tag'),
		Type.Literal('set_follow_up'),
		Type.Literal('insert_template')
	]),
	value: Type.Optional(Type.String()),
	minutes: Type.Optional(Type.Integer({ minimum: 1 }))
})
export type MailMacroStep = Static<typeof MailMacroStep>

export const MailMacroBody = Type.Object({
	inboxId: Type.Optional(Type.Union([Type.String({ format: 'uuid' }), Type.Null()])),
	name: Type.String({ minLength: 1, maxLength: 160 }),
	shortcut: Type.Optional(Type.String({ maxLength: 80 })),
	steps: Type.Array(MailMacroStep, { minItems: 1, maxItems: 20 })
})
export type MailMacroBody = Static<typeof MailMacroBody>

export const ApplyMailMacroBody = Type.Object({
	conversationIds: Type.Array(Type.String({ format: 'uuid' }), { minItems: 1, maxItems: 100 })
})
export type ApplyMailMacroBody = Static<typeof ApplyMailMacroBody>

export const ContactBody = Type.Object({
	organizationId: Type.Optional(Type.Union([Type.String({ format: 'uuid' }), Type.Null()])),
	email: Type.String({ minLength: 3, maxLength: 320 }),
	displayName: Type.Optional(Type.String({ maxLength: 200 })),
	title: Type.Optional(Type.String({ maxLength: 200 })),
	phone: Type.Optional(Type.String({ maxLength: 80 })),
	vipTier: Type.Optional(
		Type.Union([Type.Literal('standard'), Type.Literal('vip'), Type.Literal('strategic')])
	),
	notes: Type.Optional(Type.String({ maxLength: 4000 })),
	metadata: Type.Optional(Type.Record(Type.String(), Type.Unknown()))
})
export type ContactBody = Static<typeof ContactBody>

export const ContactOrganizationBody = Type.Object({
	name: Type.String({ minLength: 1, maxLength: 200 }),
	domain: Type.Optional(Type.Union([Type.String({ maxLength: 253 }), Type.Null()])),
	tier: Type.Optional(Type.Union([Type.Literal('standard'), Type.Literal('vip'), Type.Literal('strategic')])),
	notes: Type.Optional(Type.String({ maxLength: 4000 })),
	metadata: Type.Optional(Type.Record(Type.String(), Type.Unknown()))
})
export type ContactOrganizationBody = Static<typeof ContactOrganizationBody>

export const MailSlaPolicyBody = Type.Object({
	inboxId: Type.Optional(Type.Union([Type.String({ format: 'uuid' }), Type.Null()])),
	tagId: Type.Optional(Type.Union([Type.String({ format: 'uuid' }), Type.Null()])),
	name: Type.String({ minLength: 1, maxLength: 160 }),
	firstReplyMinutes: Type.Optional(Type.Integer({ minimum: 1 })),
	nextReplyMinutes: Type.Optional(Type.Integer({ minimum: 1 })),
	resolutionMinutes: Type.Optional(Type.Integer({ minimum: 1 })),
	businessHours: Type.Optional(Type.Record(Type.String(), Type.Unknown())),
	active: Type.Optional(Type.Boolean())
})
export type MailSlaPolicyBody = Static<typeof MailSlaPolicyBody>

export const MailRoutingConfigBody = Type.Object({
	enabled: Type.Boolean(),
	maxOpenCap: Type.Optional(Type.Integer({ minimum: 1, maximum: 500 })),
	requireOnline: Type.Optional(Type.Boolean()),
	respectDnd: Type.Optional(Type.Boolean()),
	respectWorkingHours: Type.Optional(Type.Boolean()),
	respectOoo: Type.Optional(Type.Boolean()),
	useOooDelegate: Type.Optional(Type.Boolean())
})
export type MailRoutingConfigBody = Static<typeof MailRoutingConfigBody>

export const MailBulkTriageBody = Type.Object({
	conversationIds: Type.Array(Type.String({ format: 'uuid' }), { minItems: 1, maxItems: 100 }),
	status: Type.Optional(MailConversationStatus),
	assigneeId: Type.Optional(Type.Union([Type.String({ format: 'uuid' }), Type.Null()])),
	addTagIds: Type.Optional(Type.Array(Type.String({ format: 'uuid' }), { maxItems: 20 })),
	removeTagIds: Type.Optional(Type.Array(Type.String({ format: 'uuid' }), { maxItems: 20 }))
})
export type MailBulkTriageBody = Static<typeof MailBulkTriageBody>

export const MailInboxSettingsBody = Type.Object({
	settings: Type.Record(Type.String(), Type.Unknown()),
	expectedVersion: Type.Integer({ minimum: 1 })
})
export type MailInboxSettingsBody = Static<typeof MailInboxSettingsBody>

export const MailParam = Type.Object({ id: Type.String({ format: 'uuid' }) })
export const MailAttachmentParam = Type.Object({
	id: Type.String({ format: 'uuid' }),
	ix: Type.Integer({ minimum: 0 })
})
export const MailDomainVerifyResponse = Type.Object({
	verified: Type.Boolean(),
	missingRecords: Type.Array(Type.String())
})
export type MailDomainVerifyResponse = Static<typeof MailDomainVerifyResponse>

// ---------- Mail v2 read DTOs (M11) ----------

export const ContactTier = Type.Union([
	Type.Literal('standard'),
	Type.Literal('vip'),
	Type.Literal('strategic')
])
export type ContactTier = Static<typeof ContactTier>

export const ContactOrganizationDto = Type.Object({
	id: Type.String({ format: 'uuid' }),
	name: Type.String(),
	domain: Type.Union([Type.String(), Type.Null()]),
	tier: ContactTier,
	notes: Type.Union([Type.String(), Type.Null()]),
	metadata: Type.Record(Type.String(), Type.Unknown()),
	version: Type.Integer({ minimum: 1 }),
	createdAt: Type.String(),
	updatedAt: Type.String()
})
export type ContactOrganizationDto = Static<typeof ContactOrganizationDto>

export const ContactDto = Type.Object({
	id: Type.String({ format: 'uuid' }),
	email: Type.String(),
	displayName: Type.Union([Type.String(), Type.Null()]),
	title: Type.Union([Type.String(), Type.Null()]),
	phone: Type.Union([Type.String(), Type.Null()]),
	vipTier: ContactTier,
	notes: Type.Union([Type.String(), Type.Null()]),
	metadata: Type.Record(Type.String(), Type.Unknown()),
	organizationId: Type.Union([Type.String({ format: 'uuid' }), Type.Null()]),
	organizationName: Type.Optional(Type.Union([Type.String(), Type.Null()])),
	version: Type.Integer({ minimum: 1 }),
	createdAt: Type.String(),
	updatedAt: Type.String()
})
export type ContactDto = Static<typeof ContactDto>

export const MailTagDto = Type.Object({
	id: Type.String({ format: 'uuid' }),
	inboxId: Type.Union([Type.String({ format: 'uuid' }), Type.Null()]),
	name: Type.String(),
	color: Type.String(),
	version: Type.Optional(Type.Integer({ minimum: 1 })),
	createdAt: Type.Optional(Type.String()),
	updatedAt: Type.Optional(Type.Union([Type.String(), Type.Null()]))
})
export type MailTagDto = Static<typeof MailTagDto>

export const MailTemplateDto = Type.Object({
	id: Type.String({ format: 'uuid' }),
	inboxId: Type.Union([Type.String({ format: 'uuid' }), Type.Null()]),
	ownerUserId: Type.Union([Type.String({ format: 'uuid' }), Type.Null()]),
	name: Type.String(),
	shortcut: Type.String(),
	bodyText: Type.String(),
	body: Type.Record(Type.String(), Type.Unknown()),
	bodyHtml: Type.Union([Type.String(), Type.Null()]),
	attachmentFileIds: Type.Array(Type.String({ format: 'uuid' })),
	mergeVariables: Type.Array(Type.String()),
	version: Type.Integer({ minimum: 1 }),
	createdAt: Type.String(),
	updatedAt: Type.String()
})
export type MailTemplateDto = Static<typeof MailTemplateDto>

export const RenderedMailTemplateDto = Type.Object({
	bodyText: Type.String(),
	shortcut: Type.String()
})
export type RenderedMailTemplateDto = Static<typeof RenderedMailTemplateDto>

export const MailMacroDto = Type.Object({
	id: Type.String({ format: 'uuid' }),
	inboxId: Type.Union([Type.String({ format: 'uuid' }), Type.Null()]),
	name: Type.String(),
	shortcut: Type.Union([Type.String(), Type.Null()]),
	steps: Type.Array(MailMacroStep),
	version: Type.Integer({ minimum: 1 }),
	createdAt: Type.String(),
	updatedAt: Type.String()
})
export type MailMacroDto = Static<typeof MailMacroDto>

export const MailRoutingConfigDto = Type.Object({
	enabled: Type.Boolean(),
	maxOpenCap: Type.Integer({ minimum: 1 }),
	requireOnline: Type.Boolean(),
	respectDnd: Type.Boolean(),
	respectWorkingHours: Type.Boolean(),
	respectOoo: Type.Boolean(),
	useOooDelegate: Type.Boolean()
})
export type MailRoutingConfigDto = Static<typeof MailRoutingConfigDto>

export const MailSlaPolicyDto = Type.Object({
	id: Type.String({ format: 'uuid' }),
	inboxId: Type.Union([Type.String({ format: 'uuid' }), Type.Null()]),
	tagId: Type.Union([Type.String({ format: 'uuid' }), Type.Null()]),
	name: Type.String(),
	firstReplyMinutes: Type.Union([Type.Integer({ minimum: 1 }), Type.Null()]),
	nextReplyMinutes: Type.Union([Type.Integer({ minimum: 1 }), Type.Null()]),
	resolutionMinutes: Type.Union([Type.Integer({ minimum: 1 }), Type.Null()]),
	businessHours: Type.Record(Type.String(), Type.Unknown()),
	active: Type.Boolean(),
	version: Type.Integer({ minimum: 1 }),
	createdAt: Type.String(),
	updatedAt: Type.String()
})
export type MailSlaPolicyDto = Static<typeof MailSlaPolicyDto>

export const MailSlaAnalyticsDto = Type.Object({
	conversationCount: Type.Integer({ minimum: 0 }),
	repliedCount: Type.Integer({ minimum: 0 }),
	avgFirstReplyMinutes: Type.Union([Type.Number(), Type.Null()]),
	avgResolutionMinutes: Type.Union([Type.Number(), Type.Null()]),
	breachedCount: Type.Integer({ minimum: 0 })
})
export type MailSlaAnalyticsDto = Static<typeof MailSlaAnalyticsDto>

export const MailOutboundResultDto = Type.Object({
	conversationId: Type.String({ format: 'uuid' }),
	draft: MailDraftDto
})
export type MailOutboundResultDto = Static<typeof MailOutboundResultDto>

export const MailBulkTriageResultDto = Type.Object({
	updatedCount: Type.Integer({ minimum: 0 })
})
export type MailBulkTriageResultDto = Static<typeof MailBulkTriageResultDto>

export const MailSplitResultDto = Type.Object({
	conversationId: Type.String({ format: 'uuid' })
})
export type MailSplitResultDto = Static<typeof MailSplitResultDto>

export const MailRouteResultDto = Type.Object({
	assignedUserId: Type.Union([Type.String({ format: 'uuid' }), Type.Null()])
})
export type MailRouteResultDto = Static<typeof MailRouteResultDto>

/** Custom split-inbox tab persisted in `mail_inboxes.settings.split_tabs`. */
export interface MailSplitTabDto {
	readonly id: string
	readonly name: string
	readonly status?: MailConversationStatus | undefined
	readonly assignee?: 'all' | 'me' | 'unassigned' | undefined
	readonly tagId?: string | null | undefined
}
