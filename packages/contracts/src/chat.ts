import { type Static, Type } from 'typebox'
import { FileScanStatus } from './files'

export const ChatChannelKind = Type.Union([
	Type.Literal('public'),
	Type.Literal('private'),
	Type.Literal('dm')
])
export type ChatChannelKind = Static<typeof ChatChannelKind>

export const ChatChannelMemberDto = Type.Object({
	channelId: Type.String({ format: 'uuid' }),
	principalType: Type.Union([Type.Literal('user'), Type.Literal('agent')]),
	principalId: Type.String({ format: 'uuid' }),
	role: Type.Union([Type.Literal('member'), Type.Literal('admin')]),
	displayName: Type.Optional(Type.String()),
	email: Type.Optional(Type.String()),
	joinedAt: Type.String()
})
export type ChatChannelMemberDto = Static<typeof ChatChannelMemberDto>

export const ChatChannelDto = Type.Object({
	id: Type.String({ format: 'uuid' }),
	workspaceId: Type.String({ format: 'uuid' }),
	kind: ChatChannelKind,
	name: Type.Union([Type.String(), Type.Null()]),
	topic: Type.String(),
	lastMsgSeq: Type.Integer({ minimum: 0 }),
	lastRev: Type.Integer({ minimum: 0 }),
	createdBy: Type.String({ format: 'uuid' }),
	archivedAt: Type.Union([Type.String(), Type.Null()]),
	createdAt: Type.String(),
	updatedAt: Type.String(),
	version: Type.Integer({ minimum: 1 }),
	unreadCount: Type.Integer({ minimum: 0 }),
	hasUnread: Type.Boolean(),
	mentionCount: Type.Integer({ minimum: 0 }),
	muted: Type.Boolean(),
	lastReadSeq: Type.Integer({ minimum: 0 }),
	isMember: Type.Boolean(),
	memberCount: Type.Integer({ minimum: 0 }),
	members: Type.Optional(Type.Array(ChatChannelMemberDto))
})
export type ChatChannelDto = Static<typeof ChatChannelDto>

export const ChatReactionSummaryDto = Type.Object({
	emoji: Type.String(),
	count: Type.Integer({ minimum: 1 }),
	reactedByMe: Type.Boolean(),
	userIds: Type.Array(Type.String({ format: 'uuid' }))
})
export type ChatReactionSummaryDto = Static<typeof ChatReactionSummaryDto>

export const ChatAttachmentDto = Type.Object({
	fileId: Type.String({ format: 'uuid' }),
	filename: Type.String(),
	contentType: Type.String(),
	byteSize: Type.Integer({ minimum: 0 }),
	scanStatus: FileScanStatus,
	downloadUrl: Type.String()
})
export type ChatAttachmentDto = Static<typeof ChatAttachmentDto>

export const ChatLinkPreviewDto = Type.Object({
	id: Type.String({ format: 'uuid' }),
	url: Type.String(),
	canonicalUrl: Type.Union([Type.String(), Type.Null()]),
	title: Type.String(),
	description: Type.String(),
	siteName: Type.String(),
	imageUrl: Type.Union([Type.String(), Type.Null()]),
	status: Type.Union([
		Type.Literal('pending'),
		Type.Literal('ok'),
		Type.Literal('blocked'),
		Type.Literal('failed')
	])
})
export type ChatLinkPreviewDto = Static<typeof ChatLinkPreviewDto>

export const ChatRichLinkDto = Type.Object({
	kind: Type.Union([Type.Literal('issue'), Type.Literal('doc_page'), Type.Literal('conversation')]),
	ref: Type.String(),
	entityId: Type.Union([Type.String({ format: 'uuid' }), Type.Null()]),
	title: Type.String(),
	subtitle: Type.Union([Type.String(), Type.Null()]),
	deepLink: Type.String()
})
export type ChatRichLinkDto = Static<typeof ChatRichLinkDto>

export const ChatMessageDto = Type.Object({
	id: Type.String({ format: 'uuid' }),
	workspaceId: Type.String({ format: 'uuid' }),
	channelId: Type.String({ format: 'uuid' }),
	channelSeq: Type.Union([Type.Integer({ minimum: 1 }), Type.Null()]),
	threadSeq: Type.Union([Type.Integer({ minimum: 1 }), Type.Null()]),
	rev: Type.Integer({ minimum: 1 }),
	authorType: Type.Union([Type.Literal('user'), Type.Literal('agent')]),
	authorId: Type.String({ format: 'uuid' }),
	authorDisplayName: Type.Optional(Type.String()),
	threadParentId: Type.Union([Type.String({ format: 'uuid' }), Type.Null()]),
	replyCount: Type.Integer({ minimum: 0 }),
	lastReplyAt: Type.Union([Type.String(), Type.Null()]),
	clientId: Type.Union([Type.String(), Type.Null()]),
	body: Type.Unknown(),
	bodyText: Type.String(),
	reactions: Type.Array(ChatReactionSummaryDto),
	attachments: Type.Array(ChatAttachmentDto),
	linkPreviews: Type.Array(ChatLinkPreviewDto),
	richLinks: Type.Array(ChatRichLinkDto),
	editedAt: Type.Union([Type.String(), Type.Null()]),
	deletedAt: Type.Union([Type.String(), Type.Null()]),
	createdAt: Type.String(),
	updatedAt: Type.String(),
	version: Type.Integer({ minimum: 1 })
})
export type ChatMessageDto = Static<typeof ChatMessageDto>

export const CreateChannelBody = Type.Object({
	kind: Type.Optional(Type.Union([Type.Literal('public'), Type.Literal('private')])),
	name: Type.String({ minLength: 1, maxLength: 80, pattern: '^[a-z0-9][a-z0-9-_]{0,79}$' }),
	topic: Type.Optional(Type.String({ maxLength: 500 })),
	memberIds: Type.Optional(Type.Array(Type.String({ format: 'uuid' }), { maxItems: 200 }))
})
export type CreateChannelBody = Static<typeof CreateChannelBody>

export const CreateDmBody = Type.Object({
	memberIds: Type.Array(Type.String({ format: 'uuid' }), { minItems: 1, maxItems: 7 })
})
export type CreateDmBody = Static<typeof CreateDmBody>

export const UpdateChannelBody = Type.Object({
	name: Type.Optional(Type.String({ minLength: 1, maxLength: 80, pattern: '^[a-z0-9][a-z0-9-_]{0,79}$' })),
	topic: Type.Optional(Type.String({ maxLength: 500 })),
	archived: Type.Optional(Type.Boolean()),
	version: Type.Integer({ minimum: 1 })
})
export type UpdateChannelBody = Static<typeof UpdateChannelBody>

export const AddChannelMemberBody = Type.Object({
	principalType: Type.Optional(Type.Union([Type.Literal('user'), Type.Literal('agent')])),
	principalId: Type.String({ format: 'uuid' }),
	role: Type.Optional(Type.Union([Type.Literal('member'), Type.Literal('admin')]))
})
export type AddChannelMemberBody = Static<typeof AddChannelMemberBody>

export const SendMessageBody = Type.Object({
	id: Type.Optional(Type.String({ format: 'uuid' })),
	clientId: Type.Optional(Type.String({ minLength: 1, maxLength: 120 })),
	threadParentId: Type.Optional(Type.String({ format: 'uuid' })),
	body: Type.Optional(Type.Unknown()),
	bodyText: Type.String({ minLength: 1, maxLength: 16_000 }),
	attachmentFileIds: Type.Optional(Type.Array(Type.String({ format: 'uuid' }), { maxItems: 10 }))
})
export type SendMessageBody = Static<typeof SendMessageBody>

export const UpdateMessageBody = Type.Object({
	body: Type.Optional(Type.Unknown()),
	bodyText: Type.String({ minLength: 1, maxLength: 16_000 }),
	version: Type.Integer({ minimum: 1 })
})
export type UpdateMessageBody = Static<typeof UpdateMessageBody>

export const ToggleReactionBody = Type.Object({
	emoji: Type.String({ minLength: 1, maxLength: 32 })
})
export type ToggleReactionBody = Static<typeof ToggleReactionBody>

export const ListMessagesQuery = Type.Object({
	beforeSeq: Type.Optional(Type.Integer({ minimum: 1 })),
	limit: Type.Optional(Type.Integer({ minimum: 1, maximum: 100, default: 50 }))
})
export type ListMessagesQuery = Static<typeof ListMessagesQuery>

export const ListMessagesResponse = Type.Object({
	data: Type.Array(ChatMessageDto),
	nextBeforeSeq: Type.Union([Type.Integer({ minimum: 1 }), Type.Null()]),
	hasMore: Type.Boolean(),
	lastMsgSeq: Type.Integer({ minimum: 0 }),
	lastRev: Type.Integer({ minimum: 0 })
})
export type ListMessagesResponse = Static<typeof ListMessagesResponse>

export const ChannelChangesQuery = Type.Object({
	since: Type.Optional(Type.Integer({ minimum: 0, default: 0 })),
	limit: Type.Optional(Type.Integer({ minimum: 1, maximum: 500, default: 200 }))
})
export type ChannelChangesQuery = Static<typeof ChannelChangesQuery>

export const ChannelChangesResponse = Type.Object({
	changes: Type.Array(ChatMessageDto),
	nextRev: Type.Integer({ minimum: 0 }),
	lastMsgSeq: Type.Integer({ minimum: 0 }),
	hasMore: Type.Boolean()
})
export type ChannelChangesResponse = Static<typeof ChannelChangesResponse>

export const MarkChannelReadBody = Type.Object({
	seq: Type.Integer({ minimum: 0 })
})
export type MarkChannelReadBody = Static<typeof MarkChannelReadBody>

export const UpdateChannelMuteBody = Type.Object({
	muted: Type.Boolean()
})
export type UpdateChannelMuteBody = Static<typeof UpdateChannelMuteBody>

export const ChatThreadSummaryDto = Type.Object({
	parentMessage: ChatMessageDto,
	channelId: Type.String({ format: 'uuid' }),
	channelName: Type.Union([Type.String(), Type.Null()]),
	channelKind: ChatChannelKind,
	lastReadThreadSeq: Type.Integer({ minimum: 0 }),
	unreadReplyCount: Type.Integer({ minimum: 0 }),
	latestReplies: Type.Array(ChatMessageDto)
})
export type ChatThreadSummaryDto = Static<typeof ChatThreadSummaryDto>
