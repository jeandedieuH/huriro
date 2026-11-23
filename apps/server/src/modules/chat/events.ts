export const CHAT_EVENTS = {
	ChannelCreated: 'chat.channel.created.v1',
	ChannelUpdated: 'chat.channel.updated.v1',
	MemberAdded: 'chat.channel.member_added.v1',
	MemberRemoved: 'chat.channel.member_removed.v1',
	MessageCreated: 'chat.message.created.v1',
	MessageUpdated: 'chat.message.updated.v1',
	MessageDeleted: 'chat.message.deleted.v1',
	ReactionChanged: 'chat.reaction.changed.v1'
} as const
