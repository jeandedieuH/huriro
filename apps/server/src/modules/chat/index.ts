import type { Sql } from '@huriro/db'
import { Elysia } from 'elysia'
import type { RealtimePubSub } from '../../realtime/pubsub'
import type { Auth } from '../identity'
import { workspaceDerive } from '../tenancy'
import {
	AddChannelMemberBody,
	ChannelChangesQuery,
	ChannelIdParam,
	ChannelMemberParam,
	CreateChannelBody,
	CreateDmBody,
	ListMessagesQuery,
	MarkChannelReadBody,
	MessageIdParam,
	ReactionParam,
	SendMessageBody,
	ToggleReactionBody,
	UpdateChannelBody,
	UpdateChannelMuteBody,
	UpdateMessageBody
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

export { CHAT_EVENTS } from './events'
export {
	type ChatUnfurlOptions,
	canUserAccessChannel,
	ensureChannelForImport,
	getChannelNotificationContext,
	importChatMessage,
	incrementChannelMentionCount,
	listThread,
	processChatLinkPreviewOutboxEvent
}

export function chatModule(sql: Sql, auth: Auth | null, pubsub?: RealtimePubSub) {
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
}
