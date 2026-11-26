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
	notifyLevel: Type.Optional(
		Type.Union([Type.Literal('default'), Type.Literal('all'), Type.Literal('mentions'), Type.Literal('none')])
	),
	mutedUntil: Type.Optional(Type.Union([Type.String(), Type.Null()])),
	canvasPageId: Type.Optional(Type.Union([Type.String({ format: 'uuid' }), Type.Null()])),
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
	broadcastToChannel: Type.Boolean(),
	replyToMessageId: Type.Union([Type.String({ format: 'uuid' }), Type.Null()]),
	messageKind: Type.Union([
		Type.Literal('text'),
		Type.Literal('poll'),
		Type.Literal('huddle_session'),
		Type.Literal('approval_card'),
		Type.Literal('system')
	]),
	metadata: Type.Unknown(),
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

export const ChatPinnedMessageDto = Type.Object({
	messageId: Type.String({ format: 'uuid' }),
	pinnedBy: Type.String({ format: 'uuid' }),
	position: Type.Union([Type.Integer(), Type.String()]),
	createdAt: Type.String(),
	bodyText: Type.String(),
	authorId: Type.String({ format: 'uuid' }),
	messageCreatedAt: Type.String()
})
export type ChatPinnedMessageDto = Static<typeof ChatPinnedMessageDto>

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
	broadcastToChannel: Type.Optional(Type.Boolean()),
	replyToMessageId: Type.Optional(Type.String({ format: 'uuid' })),
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
	muted: Type.Boolean(),
	notifyLevel: Type.Optional(
		Type.Union([Type.Literal('default'), Type.Literal('all'), Type.Literal('mentions'), Type.Literal('none')])
	),
	mutedUntil: Type.Optional(Type.Union([Type.String(), Type.Null()]))
})
export type UpdateChannelMuteBody = Static<typeof UpdateChannelMuteBody>

export const ChatDraftBody = Type.Object({
	threadParentId: Type.Optional(Type.String({ format: 'uuid' })),
	body: Type.Optional(Type.Unknown()),
	bodyText: Type.String({ maxLength: 16_000 }),
	attachmentFileIds: Type.Optional(Type.Array(Type.String({ format: 'uuid' }), { maxItems: 10 }))
})
export type ChatDraftBody = Static<typeof ChatDraftBody>

export const ChatScheduleMessageBody = Type.Object({
	threadParentId: Type.Optional(Type.String({ format: 'uuid' })),
	body: Type.Optional(Type.Unknown()),
	bodyText: Type.String({ minLength: 1, maxLength: 16_000 }),
	attachmentFileIds: Type.Optional(Type.Array(Type.String({ format: 'uuid' }), { maxItems: 10 })),
	scheduledFor: Type.String()
})
export type ChatScheduleMessageBody = Static<typeof ChatScheduleMessageBody>

export const ChatSavedItemBody = Type.Object({
	messageId: Type.Optional(Type.String({ format: 'uuid' })),
	customText: Type.Optional(Type.String({ maxLength: 4000 })),
	note: Type.Optional(Type.String({ maxLength: 4000 })),
	remindAt: Type.Optional(Type.Union([Type.String(), Type.Null()]))
})
export type ChatSavedItemBody = Static<typeof ChatSavedItemBody>

export const UpdateChatSavedItemBody = Type.Object({
	status: Type.Optional(
		Type.Union([
			Type.Literal('saved'),
			Type.Literal('in_progress'),
			Type.Literal('archived'),
			Type.Literal('completed')
		])
	),
	note: Type.Optional(Type.String({ maxLength: 4000 })),
	remindAt: Type.Optional(Type.Union([Type.String(), Type.Null()])),
	version: Type.Integer({ minimum: 1 })
})
export type UpdateChatSavedItemBody = Static<typeof UpdateChatSavedItemBody>

export const ChatSidebarSectionBody = Type.Object({
	name: Type.String({ minLength: 1, maxLength: 80 }),
	position: Type.Optional(Type.String({ minLength: 1, maxLength: 120 })),
	collapsed: Type.Optional(Type.Boolean()),
	unreadOnly: Type.Optional(Type.Boolean())
})
export type ChatSidebarSectionBody = Static<typeof ChatSidebarSectionBody>

export const UpdateChatSidebarSectionBody = Type.Object({
	name: Type.Optional(Type.String({ minLength: 1, maxLength: 80 })),
	position: Type.Optional(Type.String({ minLength: 1, maxLength: 120 })),
	collapsed: Type.Optional(Type.Boolean()),
	unreadOnly: Type.Optional(Type.Boolean()),
	version: Type.Integer({ minimum: 1 })
})
export type UpdateChatSidebarSectionBody = Static<typeof UpdateChatSidebarSectionBody>

export const ChatSidebarSectionItemBody = Type.Object({
	channelId: Type.String({ format: 'uuid' }),
	position: Type.Optional(Type.String({ minLength: 1, maxLength: 120 }))
})
export type ChatSidebarSectionItemBody = Static<typeof ChatSidebarSectionItemBody>

export const ChatBookmarkBody = Type.Object({
	targetType: Type.Union([
		Type.Literal('issue'),
		Type.Literal('saved_view'),
		Type.Literal('doc_page'),
		Type.Literal('mail_inbox'),
		Type.Literal('external_url')
	]),
	targetId: Type.Optional(Type.String({ format: 'uuid' })),
	title: Type.String({ minLength: 1, maxLength: 200 }),
	url: Type.Optional(Type.String({ maxLength: 2048 })),
	icon: Type.Optional(Type.String({ maxLength: 80 })),
	folder: Type.Optional(Type.String({ maxLength: 120 })),
	position: Type.Optional(Type.String({ minLength: 1, maxLength: 120 }))
})
export type ChatBookmarkBody = Static<typeof ChatBookmarkBody>

export const UpdateUserStatusBody = Type.Object({
	statusEmoji: Type.Optional(Type.Union([Type.String({ maxLength: 32 }), Type.Null()])),
	statusText: Type.Optional(Type.String({ maxLength: 200 })),
	statusExpiresAt: Type.Optional(Type.Union([Type.String(), Type.Null()])),
	dndUntil: Type.Optional(Type.Union([Type.String(), Type.Null()])),
	workingHours: Type.Optional(Type.Unknown())
})
export type UpdateUserStatusBody = Static<typeof UpdateUserStatusBody>

export const CreateUserGroupBody = Type.Object({
	handle: Type.String({ pattern: '^[a-z0-9][a-z0-9_-]{1,63}$' }),
	name: Type.String({ minLength: 1, maxLength: 120 }),
	description: Type.Optional(Type.String({ maxLength: 1000 })),
	autoJoinChannelIds: Type.Optional(Type.Array(Type.String({ format: 'uuid' }), { maxItems: 100 })),
	memberIds: Type.Optional(Type.Array(Type.String({ format: 'uuid' }), { maxItems: 500 }))
})
export type CreateUserGroupBody = Static<typeof CreateUserGroupBody>

export const CreatePollBody = Type.Object({
	question: Type.String({ minLength: 1, maxLength: 500 }),
	options: Type.Array(
		Type.Object({
			id: Type.String({ minLength: 1, maxLength: 64 }),
			label: Type.String({ minLength: 1, maxLength: 200 })
		}),
		{ minItems: 2, maxItems: 10 }
	),
	multiChoice: Type.Optional(Type.Boolean()),
	anonymous: Type.Optional(Type.Boolean()),
	closesAt: Type.Optional(Type.Union([Type.String(), Type.Null()])),
	threadParentId: Type.Optional(Type.String({ format: 'uuid' })),
	broadcastToChannel: Type.Optional(Type.Boolean())
})
export type CreatePollBody = Static<typeof CreatePollBody>

export const VotePollBody = Type.Object({
	optionIds: Type.Array(Type.String({ minLength: 1, maxLength: 64 }), { minItems: 1, maxItems: 10 })
})
export type VotePollBody = Static<typeof VotePollBody>

export const CreateWorkspaceEmojiBody = Type.Object({
	shortcode: Type.String({ pattern: '^[a-z0-9][a-z0-9_+-]{0,63}$' }),
	fileId: Type.String({ format: 'uuid' })
})
export type CreateWorkspaceEmojiBody = Static<typeof CreateWorkspaceEmojiBody>

export const StartHuddleBody = Type.Object({
	channelId: Type.String({ format: 'uuid' })
})
export type StartHuddleBody = Static<typeof StartHuddleBody>

export const ForwardMessageBody = Type.Object({
	targetChannelId: Type.String({ format: 'uuid' }),
	bodyText: Type.Optional(Type.String({ maxLength: 4000 }))
})
export type ForwardMessageBody = Static<typeof ForwardMessageBody>

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

// ---------- Chat v2 read DTOs (M11) ----------

export const ChatPinDto = ChatPinnedMessageDto
export type ChatPinDto = ChatPinnedMessageDto

export const ChatSavedItemDto = Type.Object({
	id: Type.String({ format: 'uuid' }),
	messageId: Type.Union([Type.String({ format: 'uuid' }), Type.Null()]),
	customText: Type.Union([Type.String(), Type.Null()]),
	note: Type.Union([Type.String(), Type.Null()]),
	status: Type.String(),
	remindAt: Type.Union([Type.String(), Type.Null()]),
	completedAt: Type.Union([Type.String(), Type.Null()]),
	version: Type.Integer({ minimum: 1 }),
	createdAt: Type.String(),
	updatedAt: Type.String(),
	channelId: Type.Optional(Type.Union([Type.String({ format: 'uuid' }), Type.Null()])),
	messageText: Type.Optional(Type.Union([Type.String(), Type.Null()]))
})
export type ChatSavedItemDto = Static<typeof ChatSavedItemDto>

export const UserWorkspaceProfileDto = Type.Object({
	statusEmoji: Type.Union([Type.String(), Type.Null()]),
	statusText: Type.String(),
	statusExpiresAt: Type.Union([Type.String(), Type.Null()]),
	dndUntil: Type.Union([Type.String(), Type.Null()]),
	workingHours: Type.Record(Type.String(), Type.Unknown()),
	lastSeenAt: Type.Union([Type.String(), Type.Null()]),
	updatedAt: Type.Optional(Type.Union([Type.String(), Type.Null()]))
})
export type UserWorkspaceProfileDto = Static<typeof UserWorkspaceProfileDto>

export const UserGroupDto = Type.Object({
	id: Type.String({ format: 'uuid' }),
	handle: Type.String(),
	name: Type.String(),
	description: Type.Union([Type.String(), Type.Null()]),
	autoJoinChannelIds: Type.Array(Type.String({ format: 'uuid' })),
	memberIds: Type.Array(Type.String({ format: 'uuid' })),
	version: Type.Integer({ minimum: 1 }),
	createdAt: Type.String(),
	updatedAt: Type.String()
})
export type UserGroupDto = Static<typeof UserGroupDto>

export const ChatDraftDto = Type.Object({
	id: Type.String({ format: 'uuid' }),
	channelId: Type.String({ format: 'uuid' }),
	threadParentId: Type.Union([Type.String({ format: 'uuid' }), Type.Null()]),
	body: Type.Unknown(),
	bodyText: Type.String(),
	attachmentFileIds: Type.Array(Type.String({ format: 'uuid' })),
	createdAt: Type.String(),
	updatedAt: Type.Optional(Type.String())
})
export type ChatDraftDto = Static<typeof ChatDraftDto>

export const ChatScheduledMessageDto = Type.Object({
	id: Type.String({ format: 'uuid' }),
	channelId: Type.String({ format: 'uuid' }),
	threadParentId: Type.Union([Type.String({ format: 'uuid' }), Type.Null()]),
	bodyText: Type.String(),
	attachmentFileIds: Type.Array(Type.String({ format: 'uuid' })),
	scheduledFor: Type.String(),
	status: Type.Union([
		Type.Literal('scheduled'),
		Type.Literal('sent'),
		Type.Literal('cancelled'),
		Type.Literal('failed')
	]),
	sentMessageId: Type.Optional(Type.Union([Type.String({ format: 'uuid' }), Type.Null()])),
	errorDetail: Type.Optional(Type.Union([Type.String(), Type.Null()])),
	version: Type.Integer({ minimum: 1 }),
	createdAt: Type.String(),
	updatedAt: Type.Optional(Type.String())
})
export type ChatScheduledMessageDto = Static<typeof ChatScheduledMessageDto>

export const ChatSidebarSectionItemDto = Type.Object({
	channelId: Type.String({ format: 'uuid' }),
	position: Type.String()
})
export type ChatSidebarSectionItemDto = Static<typeof ChatSidebarSectionItemDto>

export const ChatSidebarSectionDto = Type.Object({
	id: Type.String({ format: 'uuid' }),
	name: Type.String(),
	position: Type.String(),
	collapsed: Type.Boolean(),
	unreadOnly: Type.Boolean(),
	version: Type.Integer({ minimum: 1 }),
	createdAt: Type.Optional(Type.String()),
	updatedAt: Type.Optional(Type.String()),
	items: Type.Optional(Type.Array(ChatSidebarSectionItemDto))
})
export type ChatSidebarSectionDto = Static<typeof ChatSidebarSectionDto>

export const ChatChannelBookmarkDto = Type.Object({
	id: Type.String({ format: 'uuid' }),
	targetType: Type.Union([
		Type.Literal('issue'),
		Type.Literal('saved_view'),
		Type.Literal('doc_page'),
		Type.Literal('mail_inbox'),
		Type.Literal('external_url')
	]),
	targetId: Type.Union([Type.String({ format: 'uuid' }), Type.Null()]),
	title: Type.String(),
	url: Type.Union([Type.String(), Type.Null()]),
	icon: Type.Union([Type.String(), Type.Null()]),
	folder: Type.Union([Type.String(), Type.Null()]),
	position: Type.String(),
	createdBy: Type.Optional(Type.Union([Type.String({ format: 'uuid' }), Type.Null()])),
	version: Type.Integer({ minimum: 1 }),
	createdAt: Type.String(),
	updatedAt: Type.Optional(Type.String())
})
export type ChatChannelBookmarkDto = Static<typeof ChatChannelBookmarkDto>

export const WorkspaceEmojiDto = Type.Object({
	id: Type.String({ format: 'uuid' }),
	shortcode: Type.String(),
	fileId: Type.String({ format: 'uuid' }),
	createdBy: Type.Optional(Type.Union([Type.String({ format: 'uuid' }), Type.Null()])),
	createdAt: Type.String(),
	filename: Type.Optional(Type.String()),
	contentType: Type.Optional(Type.String())
})
export type WorkspaceEmojiDto = Static<typeof WorkspaceEmojiDto>

export const ChatPollOptionDto = Type.Object({
	id: Type.String(),
	label: Type.String()
})
export type ChatPollOptionDto = Static<typeof ChatPollOptionDto>

export const ChatPollDto = Type.Object({
	id: Type.String({ format: 'uuid' }),
	channelId: Type.String({ format: 'uuid' }),
	messageId: Type.Optional(Type.String({ format: 'uuid' })),
	question: Type.String(),
	options: Type.Array(ChatPollOptionDto),
	multiChoice: Type.Boolean(),
	anonymous: Type.Boolean(),
	status: Type.Union([Type.Literal('open'), Type.Literal('closed')]),
	closesAt: Type.Union([Type.String(), Type.Null()]),
	createdBy: Type.Optional(Type.Union([Type.String({ format: 'uuid' }), Type.Null()])),
	version: Type.Integer({ minimum: 1 }),
	createdAt: Type.String(),
	totalVotes: Type.Optional(Type.Integer({ minimum: 0 })),
	counts: Type.Optional(Type.Record(Type.String(), Type.Integer({ minimum: 0 }))),
	voters: Type.Optional(
		Type.Array(
			Type.Object({
				userId: Type.String({ format: 'uuid' }),
				optionIds: Type.Array(Type.String())
			})
		)
	),
	message: Type.Optional(ChatMessageDto)
})
export type ChatPollDto = Static<typeof ChatPollDto>

export const ChatHuddleSessionDto = Type.Object({
	id: Type.String({ format: 'uuid' }),
	channelId: Type.Optional(Type.String({ format: 'uuid' })),
	messageId: Type.Optional(Type.String({ format: 'uuid' })),
	roomName: Type.String(),
	status: Type.Union([Type.Literal('active'), Type.Literal('ended')]),
	startedAt: Type.String()
})
export type ChatHuddleSessionDto = Static<typeof ChatHuddleSessionDto>

export const ChatHuddleJoinDto = Type.Object({
	huddleId: Type.String({ format: 'uuid' }),
	roomName: Type.String(),
	livekitUrl: Type.String(),
	token: Type.String(),
	expiresIn: Type.Integer({ minimum: 1 })
})
export type ChatHuddleJoinDto = Static<typeof ChatHuddleJoinDto>

export const ChatCanvasDto = Type.Object({
	pageId: Type.String({ format: 'uuid' }),
	slug: Type.String(),
	title: Type.String()
})
export type ChatCanvasDto = Static<typeof ChatCanvasDto>
