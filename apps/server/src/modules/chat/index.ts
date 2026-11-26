import type { Sql } from '@huriro/db'
import { Elysia } from 'elysia'
import type { RealtimePubSub } from '../../realtime/pubsub'
import type { Auth } from '../identity'
import { workspaceDerive } from '../tenancy'
import {
	addSidebarSectionItem,
	cancelScheduledChatMessage,
	closePoll,
	createChannelBookmark,
	createPoll,
	createSavedItem,
	createSidebarSection,
	createUserGroup,
	createWorkspaceEmoji,
	deleteChannelBookmark,
	deleteChatDraft,
	deleteSavedItem,
	deleteSidebarSection,
	deleteWorkspaceEmoji,
	endHuddle,
	ensureChannelCanvas,
	forwardMessage,
	getActiveChannelHuddle,
	getMyWorkspaceProfile,
	getPollResults,
	type HuddleConfig,
	joinHuddle,
	listChannelBookmarks,
	listChannelPolls,
	listChatDrafts,
	listPinnedMessages,
	listSavedItems,
	listScheduledChatMessages,
	listSidebarSections,
	listUserGroups,
	listWorkspaceEmojis,
	pinMessage,
	removeSidebarSectionItem,
	scheduleChatMessage,
	setUserGroupMembers,
	startHuddle,
	unpinMessage,
	updateMyWorkspaceProfile,
	updateSavedItem,
	updateSidebarSection,
	upsertChatDraft,
	votePoll
} from './advanced-chat-service'
import { getChannelSeqAndRev } from './repo'
import {
	AddChannelMemberBody,
	CancelScheduledMessageBody,
	ChannelChangesQuery,
	ChannelIdParam,
	ChannelMemberParam,
	ChatBookmarkBody,
	ChatDraftBody,
	ChatDraftParam,
	ChatEntityParam,
	ChatSavedItemBody,
	ChatScheduleMessageBody,
	ChatSectionItemParam,
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
	MessageIdParam,
	ReactionParam,
	SendMessageBody,
	SetUserGroupMembersBody,
	StartHuddleBody,
	ToggleReactionBody,
	UpdateChannelBody,
	UpdateChannelMuteBody,
	UpdateChatSavedItemBody,
	UpdateChatSidebarSectionBody,
	UpdateMessageBody,
	UpdateUserStatusBody,
	VotePollBody
} from './schema'
import {
	addChannelMember,
	addReaction,
	canUserAccessChannel,
	createChannel,
	createOrGetDm,
	deleteMessage,
	ensureChannelForImport,
	getChannelChanges,
	getChannelDetail,
	getChannelNotificationContext,
	getChatMessageEndpoint,
	importChatMessage,
	incrementChannelMentionCount,
	listChannels,
	listMessages,
	listSubscribedThreads,
	listThread,
	markChannelRead,
	removeChannelMember,
	removeReaction,
	sendMessage,
	updateChannel,
	updateChannelMute,
	updateMessage
} from './service'
import { type ChatUnfurlOptions, processChatLinkPreviewOutboxEvent } from './unfurl'

export { runChatSavedRemindersOnce, runChatScheduledMessagesOnce } from './advanced-chat-service'
export { CHAT_EVENTS } from './events'
export {
	type ChatUnfurlOptions,
	canUserAccessChannel,
	ensureChannelForImport,
	getChannelNotificationContext,
	getChatMessageEndpoint,
	importChatMessage,
	incrementChannelMentionCount,
	listThread,
	processChatLinkPreviewOutboxEvent,
	sendMessage
}

export function chatModule(
	sql: Sql,
	auth: Auth | null,
	pubsub?: RealtimePubSub,
	huddles: HuddleConfig = { enabled: false }
) {
	return new Elysia({ name: 'huriro.chat' })
		.derive(workspaceDerive(sql, auth))
		.get('/chat/channels', ({ inWorkspace }) =>
			inWorkspace(async (tx, actor) => ({ data: await listChannels(tx, actor) }))
		)
		.post('/chat/channels', { body: CreateChannelBody }, async ({ body, inWorkspace, set }) => {
			const data = await inWorkspace((tx, actor) => createChannel(tx, actor, body))
			set.status = 201
			return data
		})
		.post('/chat/dms', { body: CreateDmBody }, async ({ body, inWorkspace, set }) => {
			const result = await inWorkspace((tx, actor) => createOrGetDm(tx, actor, body))
			set.status = result.created ? 201 : 200
			return result.channel
		})
		.get('/chat/channels/:id', { params: ChannelIdParam }, ({ params, inWorkspace }) =>
			inWorkspace((tx, actor) => getChannelDetail(tx, actor, params.id))
		)
		.patch(
			'/chat/channels/:id',
			{ params: ChannelIdParam, body: UpdateChannelBody },
			({ params, body, inWorkspace }) => inWorkspace((tx, actor) => updateChannel(tx, actor, params.id, body))
		)
		.post(
			'/chat/channels/:id/members',
			{ params: ChannelIdParam, body: AddChannelMemberBody },
			async ({ params, body, inWorkspace, set }) => {
				const data = await inWorkspace((tx, actor) => addChannelMember(tx, actor, params.id, body))
				set.status = 201
				return data
			}
		)
		.delete(
			'/chat/channels/:id/members/:principalId',
			{ params: ChannelMemberParam },
			async ({ params, workspaceCtx, inWorkspace }) => {
				const res = await inWorkspace((tx, actor) =>
					removeChannelMember(tx, actor, params.id, params.principalId)
				)
				if (pubsub && res.channelKind === 'private') {
					await pubsub.publishRevoke(workspaceCtx.workspaceId, params.principalId, 'channel_removed')
				}
				return { removed: true, channelId: params.id, principalId: params.principalId }
			}
		)
		.get(
			'/chat/channels/:id/messages',
			{ params: ChannelIdParam, query: ListMessagesQuery },
			({ params, query, inWorkspace }) =>
				inWorkspace((tx, actor) => listMessages(tx, actor, params.id, query))
		)
		.post(
			'/chat/channels/:id/messages',
			{ params: ChannelIdParam, body: SendMessageBody },
			async ({ params, body, workspaceCtx, inWorkspace, set }) => {
				const res = await inWorkspace((tx, actor) => sendMessage(tx, actor, params.id, body))
				set.status = res.deduplicated ? 200 : 201
				if (pubsub && !res.deduplicated) {
					await pubsub.publishChat(workspaceCtx.workspaceId, params.id, res.lastRev, res.lastMsgSeq)
				}
				return res.data
			}
		)
		.get(
			'/chat/channels/:id/changes',
			{ params: ChannelIdParam, query: ChannelChangesQuery },
			({ params, query, inWorkspace }) =>
				inWorkspace((tx, actor) => getChannelChanges(tx, actor, params.id, query))
		)
		.get('/chat/messages/:id/thread', { params: MessageIdParam }, ({ params, inWorkspace }) =>
			inWorkspace((tx, actor) => listThread(tx, actor, params.id))
		)
		.patch(
			'/chat/messages/:id',
			{ params: MessageIdParam, body: UpdateMessageBody },
			async ({ params, body, workspaceCtx, inWorkspace }) => {
				const res = await inWorkspace((tx, actor) => updateMessage(tx, actor, params.id, body))
				if (pubsub) {
					await pubsub.publishChat(workspaceCtx.workspaceId, res.data.channelId, res.lastRev, res.lastMsgSeq)
				}
				return res.data
			}
		)
		.delete(
			'/chat/messages/:id',
			{ params: MessageIdParam },
			async ({ params, workspaceCtx, inWorkspace }) => {
				const res = await inWorkspace((tx, actor) => deleteMessage(tx, actor, params.id))
				if (pubsub) {
					await pubsub.publishChat(workspaceCtx.workspaceId, res.data.channelId, res.lastRev, res.lastMsgSeq)
				}
				return res.data
			}
		)
		.post(
			'/chat/messages/:id/reactions',
			{ params: MessageIdParam, body: ToggleReactionBody },
			async ({ params, body, workspaceCtx, inWorkspace }) => {
				const res = await inWorkspace((tx, actor) => addReaction(tx, actor, params.id, body))
				if (pubsub) {
					await pubsub.publishChat(workspaceCtx.workspaceId, res.data.channelId, res.lastRev, res.lastMsgSeq)
				}
				return res.data
			}
		)
		.delete(
			'/chat/messages/:id/reactions/:emoji',
			{ params: ReactionParam },
			async ({ params, workspaceCtx, inWorkspace }) => {
				const res = await inWorkspace((tx, actor) => removeReaction(tx, actor, params.id, params.emoji))
				if (pubsub) {
					await pubsub.publishChat(workspaceCtx.workspaceId, res.data.channelId, res.lastRev, res.lastMsgSeq)
				}
				return res.data
			}
		)
		.post(
			'/chat/channels/:id/read',
			{ params: ChannelIdParam, body: MarkChannelReadBody },
			({ params, body, inWorkspace }) =>
				inWorkspace((tx, actor) => markChannelRead(tx, actor, params.id, body))
		)
		.patch(
			'/chat/channels/:id/mute',
			{ params: ChannelIdParam, body: UpdateChannelMuteBody },
			({ params, body, inWorkspace }) =>
				inWorkspace((tx, actor) => updateChannelMute(tx, actor, params.id, body))
		)
		.get('/chat/threads', ({ inWorkspace }) =>
			inWorkspace(async (tx, actor) => ({ data: await listSubscribedThreads(tx, actor) }))
		)
		.get('/chat/drafts', ({ inWorkspace }) =>
			inWorkspace(async (tx, actor) => ({ data: await listChatDrafts(tx, actor) }))
		)
		.put(
			'/chat/channels/:id/draft',
			{ params: ChannelIdParam, body: ChatDraftBody },
			({ params, body, inWorkspace }) =>
				inWorkspace((tx, actor) => upsertChatDraft(tx, actor, params.id, body))
		)
		.delete('/chat/drafts/:draftId', { params: ChatDraftParam }, ({ params, inWorkspace }) =>
			inWorkspace((tx, actor) => deleteChatDraft(tx, actor, params.draftId))
		)
		.get('/chat/scheduled', ({ inWorkspace }) =>
			inWorkspace(async (tx, actor) => ({ data: await listScheduledChatMessages(tx, actor) }))
		)
		.post(
			'/chat/channels/:id/scheduled',
			{ params: ChannelIdParam, body: ChatScheduleMessageBody },
			async ({ params, body, inWorkspace, set }) => {
				const data = await inWorkspace((tx, actor) => scheduleChatMessage(tx, actor, params.id, body))
				set.status = 201
				return data
			}
		)
		.post(
			'/chat/scheduled/:id/cancel',
			{ params: ChatEntityParam, body: CancelScheduledMessageBody },
			({ params, body, inWorkspace }) =>
				inWorkspace((tx, actor) => cancelScheduledChatMessage(tx, actor, params.id, body.version))
		)
		.get('/chat/saved', ({ inWorkspace }) =>
			inWorkspace(async (tx, actor) => ({ data: await listSavedItems(tx, actor) }))
		)
		.post('/chat/saved', { body: ChatSavedItemBody }, async ({ body, inWorkspace, set }) => {
			const data = await inWorkspace((tx, actor) => createSavedItem(tx, actor, body))
			set.status = 201
			return data
		})
		.patch(
			'/chat/saved/:id',
			{ params: ChatEntityParam, body: UpdateChatSavedItemBody },
			({ params, body, inWorkspace }) =>
				inWorkspace((tx, actor) => updateSavedItem(tx, actor, params.id, body))
		)
		.delete('/chat/saved/:id', { params: ChatEntityParam }, ({ params, inWorkspace }) =>
			inWorkspace((tx, actor) => deleteSavedItem(tx, actor, params.id))
		)
		.get('/chat/sidebar/sections', ({ inWorkspace }) =>
			inWorkspace(async (tx, actor) => ({ data: await listSidebarSections(tx, actor) }))
		)
		.post('/chat/sidebar/sections', { body: ChatSidebarSectionBody }, async ({ body, inWorkspace, set }) => {
			const data = await inWorkspace((tx, actor) => createSidebarSection(tx, actor, body))
			set.status = 201
			return data
		})
		.patch(
			'/chat/sidebar/sections/:id',
			{ params: ChatEntityParam, body: UpdateChatSidebarSectionBody },
			({ params, body, inWorkspace }) =>
				inWorkspace((tx, actor) => updateSidebarSection(tx, actor, params.id, body))
		)
		.delete('/chat/sidebar/sections/:id', { params: ChatEntityParam }, ({ params, inWorkspace }) =>
			inWorkspace((tx, actor) => deleteSidebarSection(tx, actor, params.id))
		)
		.post(
			'/chat/sidebar/sections/:id/items',
			{ params: ChatEntityParam, body: ChatSidebarSectionItemBody },
			({ params, body, inWorkspace }) =>
				inWorkspace((tx, actor) => addSidebarSectionItem(tx, actor, params.id, body))
		)
		.delete(
			'/chat/sidebar/sections/:id/items/:channelId',
			{ params: ChatSectionItemParam },
			({ params, inWorkspace }) =>
				inWorkspace((tx, actor) => removeSidebarSectionItem(tx, actor, params.id, params.channelId))
		)
		.get('/chat/channels/:id/bookmarks', { params: ChannelIdParam }, ({ params, inWorkspace }) =>
			inWorkspace(async (tx, actor) => ({ data: await listChannelBookmarks(tx, actor, params.id) }))
		)
		.post(
			'/chat/channels/:id/bookmarks',
			{ params: ChannelIdParam, body: ChatBookmarkBody },
			async ({ params, body, inWorkspace, set }) => {
				const data = await inWorkspace((tx, actor) => createChannelBookmark(tx, actor, params.id, body))
				set.status = 201
				return data
			}
		)
		.delete('/chat/bookmarks/:id', { params: ChatEntityParam }, ({ params, inWorkspace }) =>
			inWorkspace((tx, actor) => deleteChannelBookmark(tx, actor, params.id))
		)
		.get('/chat/channels/:id/pins', { params: ChannelIdParam }, ({ params, inWorkspace }) =>
			inWorkspace(async (tx, actor) => ({ data: await listPinnedMessages(tx, actor, params.id) }))
		)
		.post('/chat/messages/:id/pin', { params: MessageIdParam }, ({ params, inWorkspace }) =>
			inWorkspace((tx, actor) => pinMessage(tx, actor, params.id))
		)
		.delete('/chat/messages/:id/pin', { params: MessageIdParam }, ({ params, inWorkspace }) =>
			inWorkspace((tx, actor) => unpinMessage(tx, actor, params.id))
		)
		.get('/chat/me/status', ({ inWorkspace }) => inWorkspace((tx, actor) => getMyWorkspaceProfile(tx, actor)))
		.put('/chat/me/status', { body: UpdateUserStatusBody }, ({ body, inWorkspace }) =>
			inWorkspace((tx, actor) => updateMyWorkspaceProfile(tx, actor, body))
		)
		.get('/chat/user-groups', ({ inWorkspace }) =>
			inWorkspace(async (tx, actor) => ({ data: await listUserGroups(tx, actor) }))
		)
		.post('/chat/user-groups', { body: CreateUserGroupBody }, async ({ body, inWorkspace, set }) => {
			const data = await inWorkspace((tx, actor) => createUserGroup(tx, actor, body))
			set.status = 201
			return data
		})
		.put(
			'/chat/user-groups/:id/members',
			{ params: ChatEntityParam, body: SetUserGroupMembersBody },
			({ params, body, inWorkspace }) =>
				inWorkspace((tx, actor) => setUserGroupMembers(tx, actor, params.id, body.memberIds))
		)
		.get('/chat/emojis', ({ inWorkspace }) =>
			inWorkspace(async (tx, actor) => ({ data: await listWorkspaceEmojis(tx, actor) }))
		)
		.post('/chat/emojis', { body: CreateWorkspaceEmojiBody }, async ({ body, inWorkspace, set }) => {
			const data = await inWorkspace((tx, actor) => createWorkspaceEmoji(tx, actor, body))
			set.status = 201
			return data
		})
		.delete('/chat/emojis/:id', { params: ChatEntityParam }, ({ params, inWorkspace }) =>
			inWorkspace((tx, actor) => deleteWorkspaceEmoji(tx, actor, params.id))
		)
		.get('/chat/channels/:id/polls', { params: ChannelIdParam }, ({ params, inWorkspace }) =>
			inWorkspace(async (tx, actor) => ({ data: await listChannelPolls(tx, actor, params.id) }))
		)
		.post(
			'/chat/channels/:id/polls',
			{ params: ChannelIdParam, body: CreatePollBody },
			async ({ params, body, workspaceCtx, inWorkspace, set }) => {
				const out = await inWorkspace(async (tx, actor) => {
					const data = await createPoll(tx, actor, params.id, body)
					const meta = await getChannelSeqAndRev(tx, actor.workspaceId, params.id)
					return { data, meta }
				})
				if (pubsub && out.meta) {
					await pubsub.publishChat(workspaceCtx.workspaceId, params.id, out.meta.lastRev, out.meta.lastMsgSeq)
				}
				set.status = 201
				return out.data
			}
		)
		.get('/chat/polls/:id', { params: ChatEntityParam }, ({ params, inWorkspace }) =>
			inWorkspace((tx, actor) => getPollResults(tx, actor, params.id))
		)
		.post(
			'/chat/polls/:id/vote',
			{ params: ChatEntityParam, body: VotePollBody },
			async ({ params, body, workspaceCtx, inWorkspace }) => {
				const out = await inWorkspace(async (tx, actor) => {
					const data = await votePoll(tx, actor, params.id, body)
					const chId = String(data['channelId'])
					const meta = await getChannelSeqAndRev(tx, actor.workspaceId, chId)
					return { data, chId, meta }
				})
				if (pubsub && out.meta) {
					await pubsub.publishChat(workspaceCtx.workspaceId, out.chId, out.meta.lastRev, out.meta.lastMsgSeq)
				}
				return out.data
			}
		)
		.post(
			'/chat/polls/:id/close',
			{ params: ChatEntityParam },
			async ({ params, workspaceCtx, inWorkspace }) => {
				const out = await inWorkspace(async (tx, actor) => {
					const data = await closePoll(tx, actor, params.id)
					const chId = String(data['channelId'])
					const meta = await getChannelSeqAndRev(tx, actor.workspaceId, chId)
					return { data, chId, meta }
				})
				if (pubsub && out.meta) {
					await pubsub.publishChat(workspaceCtx.workspaceId, out.chId, out.meta.lastRev, out.meta.lastMsgSeq)
				}
				return out.data
			}
		)
		.post(
			'/chat/messages/:id/forward',
			{ params: MessageIdParam, body: ForwardMessageBody },
			async ({ params, body, workspaceCtx, inWorkspace }) => {
				const out = await inWorkspace(async (tx, actor) => {
					const data = await forwardMessage(tx, actor, params.id, body)
					const meta = await getChannelSeqAndRev(tx, actor.workspaceId, body.targetChannelId)
					return { data, meta }
				})
				if (pubsub && out.meta) {
					await pubsub.publishChat(
						workspaceCtx.workspaceId,
						body.targetChannelId,
						out.meta.lastRev,
						out.meta.lastMsgSeq
					)
				}
				return out.data
			}
		)
		.post(
			'/chat/channels/:id/canvas',
			{ params: ChannelIdParam },
			async ({ params, workspaceCtx, inWorkspace }) => {
				const out = await inWorkspace((tx, actor) => ensureChannelCanvas(tx, actor, params.id))
				if (pubsub && out.cursor !== undefined) {
					await pubsub.publishCursor(workspaceCtx.workspaceId, out.cursor)
				}
				return out.canvas
			}
		)
		.get('/chat/channels/:id/huddle', { params: ChannelIdParam }, ({ params, inWorkspace }) =>
			inWorkspace(async (tx, actor) => ({ huddle: await getActiveChannelHuddle(tx, actor, params.id) }))
		)
		.post('/chat/huddles', { body: StartHuddleBody }, async ({ body, workspaceCtx, inWorkspace, set }) => {
			const out = await inWorkspace(async (tx, actor) => {
				const data = await startHuddle(tx, actor, body, huddles)
				const meta = await getChannelSeqAndRev(tx, actor.workspaceId, body.channelId)
				return { data, meta }
			})
			if (pubsub && out.meta) {
				await pubsub.publishChat(
					workspaceCtx.workspaceId,
					body.channelId,
					out.meta.lastRev,
					out.meta.lastMsgSeq
				)
			}
			set.status = 201
			return out.data
		})
		.post('/chat/huddles/:id/join', { params: ChatEntityParam }, ({ params, inWorkspace }) =>
			inWorkspace((tx, actor) => joinHuddle(tx, actor, params.id, huddles))
		)
		.post(
			'/chat/huddles/:id/end',
			{ params: ChatEntityParam },
			async ({ params, workspaceCtx, inWorkspace }) => {
				const out = await inWorkspace(async (tx, actor) => {
					const data = await endHuddle(tx, actor, params.id)
					const chId = String(data['channelId'])
					const meta = await getChannelSeqAndRev(tx, actor.workspaceId, chId)
					return { data, chId, meta }
				})
				if (pubsub && out.meta) {
					await pubsub.publishChat(workspaceCtx.workspaceId, out.chId, out.meta.lastRev, out.meta.lastMsgSeq)
				}
				return out.data
			}
		)
}
