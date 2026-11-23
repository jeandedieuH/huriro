import { Type } from 'typebox'

export {
	AddChannelMemberBody,
	ChannelChangesQuery,
	CreateChannelBody,
	CreateDmBody,
	ListMessagesQuery,
	MarkChannelReadBody,
	SendMessageBody,
	ToggleReactionBody,
	UpdateChannelBody,
	UpdateChannelMuteBody,
	UpdateMessageBody
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
