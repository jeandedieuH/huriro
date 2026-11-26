import { Type } from 'typebox'

export {
	AddChannelMemberBody,
	ChannelChangesQuery,
	ChatBookmarkBody,
	ChatDraftBody,
	ChatSavedItemBody,
	ChatScheduleMessageBody,
	ChatSidebarSectionBody,
	ChatSidebarSectionItemBody,
	CreateChannelBody,
	CreateDmBody,
	CreatePollBody,
	CreateUserGroupBody,
	CreateWorkspaceEmojiBody,
	ForwardMessageBody,
	ListMessagesQuery,
	MarkChannelReadBody,
	SendMessageBody,
	StartHuddleBody,
	ToggleReactionBody,
	UpdateChannelBody,
	UpdateChannelMuteBody,
	UpdateChatSavedItemBody,
	UpdateChatSidebarSectionBody,
	UpdateMessageBody,
	UpdateUserStatusBody,
	VotePollBody
} from '@huriro/contracts'

export const ChannelIdParam = Type.Object({
	id: Type.String({ format: 'uuid' })
})

export const ChannelMemberParam = Type.Object({
	id: Type.String({ format: 'uuid' }),
	principalId: Type.String({ format: 'uuid' })
})

export const MessageIdParam = Type.Object({
	id: Type.String({ format: 'uuid' })
})

export const ReactionParam = Type.Object({
	id: Type.String({ format: 'uuid' }),
	emoji: Type.String({ minLength: 1, maxLength: 64 })
})

export const ChatDraftParam = Type.Object({
	draftId: Type.String({ format: 'uuid' })
})

export const ChatEntityParam = Type.Object({
	id: Type.String({ format: 'uuid' })
})

export const ChatSectionItemParam = Type.Object({
	id: Type.String({ format: 'uuid' }),
	channelId: Type.String({ format: 'uuid' })
})

export const CancelScheduledMessageBody = Type.Object({
	version: Type.Integer({ minimum: 1 })
})

export const SetUserGroupMembersBody = Type.Object({
	memberIds: Type.Array(Type.String({ format: 'uuid' }), { maxItems: 500 })
})
