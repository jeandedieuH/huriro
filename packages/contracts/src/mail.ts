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
	openCount: Type.Integer({ minimum: 0 }),
	createdAt: Type.String()
})
export type MailInboxDto = Static<typeof MailInboxDto>

export const CreateMailInboxBody = Type.Object({
	name: Type.String({ minLength: 1, maxLength: 120 }),
	settings: Type.Optional(Type.Record(Type.String(), Type.Unknown()))
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
	body: Type.Optional(Type.Record(Type.String(), Type.Unknown()))
})
export type UpsertMailDraftBody = Static<typeof UpsertMailDraftBody>

export const SendMailDraftBody = Type.Object({
	/** Seconds to hold before real send — the undo window (default: server config). */
	undoSeconds: Type.Optional(Type.Integer({ minimum: 0, maximum: 120 })),
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
