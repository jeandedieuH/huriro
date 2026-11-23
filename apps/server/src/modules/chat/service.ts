/**
 * Chat domain service (§15.1):
 *   - Public & private channels, participant-only 2–8 member DMs
 *   - Per-channel monotonic seq & rev (never written to workspace change_log)
 *   - Trigger-maintained threads, reactions, sanitized bodies, attachments,
 *     SSRF-safe async URL previews, and ACL-checked internal rich links.
 */
import { createHash } from 'node:crypto'
import type {
	AddChannelMemberBody,
	ChannelChangesQuery,
	ChannelChangesResponse,
	ChatChannelDto,
	ChatChannelMemberDto,
	ChatMessageDto,
	ChatRichLinkDto,
	ChatThreadSummaryDto,
	CreateChannelBody,
	CreateDmBody,
	ListMessagesQuery,
	ListMessagesResponse,
	MarkChannelReadBody,
	SendMessageBody,
	ToggleReactionBody,
	UpdateChannelBody,
	UpdateChannelMuteBody,
	UpdateMessageBody
} from '@huriro/contracts'
import { isAcceptableClientId, type Queryable } from '@huriro/db'
import {
	type ActorContext,
	ADMIN_BYPASS_RANK,
	computeDmKey,
	extractChatMentions,
	extractRichLinks,
	extractUrls
} from '@huriro/domain'
import { isSafeUrl, sanitizeHtml } from '@huriro/editor'
import { HttpError } from '../../api/error'
import { chatFeedLatencyMs, chatMessagesTotal } from '../../api/observability'
import { getDocPageBySlugDetail } from '../docs'
import { getFilesByIdsForAttachment } from '../files'
import { getIssueByIdentifier } from '../tasks'
import { grantAcl, resolveResourceAcl } from '../tenancy'
import { CHAT_EVENTS } from './events'
import { authorizeChannel, authorizeCreateChannel } from './policy'
import {
	addReactionRow,
	allocateChannelSeqAndRev,
	allocateThreadSeq,
	attachMessageLinkPreviews,
	auditChatAction,
	type ChannelRecord,
	emitChatEvent,
	filterActiveWorkspaceUserIds,
	filterWorkspacePrincipalPairs,
	findMessageByClientId,
	getChannelByDmKey,
	getChannelByIdForUser,
	getChannelByName,
	getChannelNotificationContextRows,
	getRawMessageById,
	hydrateRawMessages,
	incrementChannelMentionCountRow,
	insertChannelRow,
	insertMessageRow,
	listChannelChangeRows,
	listChannelMembersForChannels,
	listChannelMessageRows,
	listSubscribedThreadParents,
	listThreadReplyRows,
	listVisibleChannelsForUser,
	removeChannelMemberRow,
	removeReactionRow,
	setChannelMutedState,
	softDeleteMessageRow,
	toChannelDto,
	updateChannelRow,
	updateMessageRow,
	upsertChannelMember,
	upsertChannelReadState,
	upsertMessageAttachments,
	upsertPendingLinkPreview,
	upsertThreadReadState
} from './repo'

function sha256Hex(value: string): string {
	return createHash('sha256').update(value).digest('hex')
}

function sanitizeMessageJsonValue(value: unknown): unknown {
	if (typeof value === 'string') {
		return value.includes('<') && value.includes('>') ? sanitizeHtml(value) : value
	}
	if (Array.isArray(value)) {
		return value.map((item) => sanitizeMessageJsonValue(item))
	}
	if (value && typeof value === 'object') {
		const rec = value as Record<string, unknown>
		const next: Record<string, unknown> = {}
		for (const [k, v] of Object.entries(rec)) {
			if (k === 'href' || k === 'src' || k === 'url') {
				if (typeof v === 'string' && !isSafeUrl(v)) {
					continue
				}
			}
			next[k] = sanitizeMessageJsonValue(v)
		}
		return next
	}
	return value
}

function buildDefaultBody(body: unknown, bodyText: string): unknown {
	if (body !== undefined && body !== null && typeof body === 'object') {
		return sanitizeMessageJsonValue(body)
	}
	return {
		type: 'doc',
		content: [
			{
				type: 'paragraph',
				content: bodyText ? [{ type: 'text', text: bodyText }] : []
			}
		]
	}
}

async function resolveRichLinksForViewer(
	tx: Queryable,
	actor: ActorContext,
	messages: ChatMessageDto[]
): Promise<ChatMessageDto[]> {
	if (messages.length === 0) return messages

	const issueCache = new Map<string, ChatRichLinkDto | null>()
	const docCache = new Map<string, ChatRichLinkDto | null>()

	const resolved: ChatMessageDto[] = []
	for (const msg of messages) {
		if (msg.deletedAt !== null || !msg.bodyText) {
			resolved.push(msg)
			continue
		}
		const extracted = extractRichLinks(msg.bodyText)
		if (extracted.length === 0) {
			resolved.push(msg)
			continue
		}
		const richLinks: ChatRichLinkDto[] = []
		for (const token of extracted) {
			if (token.kind === 'issue') {
				if (!issueCache.has(token.ref)) {
					try {
						const issue = await getIssueByIdentifier(tx, actor, token.ref)
						issueCache.set(token.ref, {
							kind: 'issue',
							ref: issue.identifier,
							entityId: issue.id,
							title: issue.title,
							subtitle: issue.priority > 0 ? `P${issue.priority}` : null,
							deepLink: `/tasks/issues/${issue.identifier}`
						})
					} catch {
						// Forbidden/missing issues never leak title or existence metadata.
						issueCache.set(token.ref, null)
					}
				}
				const hit = issueCache.get(token.ref)
				if (hit) richLinks.push(hit)
			} else if (token.kind === 'doc_page') {
				if (!docCache.has(token.ref)) {
					try {
						const doc = await getDocPageBySlugDetail(tx, actor, token.ref)
						docCache.set(token.ref, {
							kind: 'doc_page',
							ref: doc.page.slug,
							entityId: doc.page.id,
							title: doc.page.title,
							subtitle: null,
							deepLink: `/docs/${doc.page.slug}`
						})
					} catch {
						docCache.set(token.ref, null)
					}
				}
				const hit = docCache.get(token.ref)
				if (hit) richLinks.push(hit)
			} else {
				richLinks.push({
					kind: 'conversation',
					ref: token.ref,
					entityId: null,
					title: `Conversation ${token.ref}`,
					subtitle: null,
					deepLink: `/mail/${token.ref}`
				})
			}
		}
		resolved.push({ ...msg, richLinks })
	}
	return resolved
}

async function hydrateMessagesForViewer(
	tx: Queryable,
	actor: ActorContext,
	rawRows: Awaited<ReturnType<typeof listThreadReplyRows>>
): Promise<ChatMessageDto[]> {
	const base = await hydrateRawMessages(tx, actor.workspaceId, actor.principalId, rawRows)
	return resolveRichLinksForViewer(tx, actor, base)
}

async function loadAndAuthorizeChannel(
	tx: Queryable,
	actor: ActorContext,
	channelId: string,
	action: 'channel.read' | 'channel.post' | 'channel.manage'
): Promise<ChannelRecord> {
	const channel = await getChannelByIdForUser(tx, actor.workspaceId, channelId, actor.principalId)
	if (!channel) throw new HttpError(404, 'not_found', 'Channel not found')

	const resourceAcl = await resolveResourceAcl(tx, {
		workspaceId: actor.workspaceId,
		resourceType: 'channel',
		resourceId: channel.id,
		userId: actor.principalId
	})
	await authorizeChannel(tx, actor, action, channel, resourceAcl)
	return channel
}

export async function listChannels(tx: Queryable, actor: ActorContext): Promise<ChatChannelDto[]> {
	if (actor.membership !== 'active') {
		throw new HttpError(403, 'not_workspace_member', 'Active workspace membership is required')
	}
	const bypassAcl =
		actor.roleKey !== 'guest' &&
		(actor.roleRank >= ADMIN_BYPASS_RANK || actor.permissions.has('channel.manage'))
	const rows = await listVisibleChannelsForUser(tx, {
		workspaceId: actor.workspaceId,
		userId: actor.principalId,
		isGuest: actor.roleKey === 'guest',
		bypassAcl
	})
	const dmIds = rows.filter((r) => r.kind === 'dm').map((r) => r.id)
	const dmMembers = await listChannelMembersForChannels(tx, actor.workspaceId, dmIds)
	return rows.map((row) =>
		row.kind === 'dm' ? toChannelDto(row, dmMembers.get(row.id) ?? []) : toChannelDto(row)
	)
}

export async function getChannelDetail(
	tx: Queryable,
	actor: ActorContext,
	channelId: string
): Promise<ChatChannelDto> {
	const channel = await loadAndAuthorizeChannel(tx, actor, channelId, 'channel.read')
	const members = await listChannelMembersForChannels(tx, actor.workspaceId, [channel.id])
	return toChannelDto(channel, members.get(channel.id) ?? [])
}

export async function createChannel(
	tx: Queryable,
	actor: ActorContext,
	input: CreateChannelBody
): Promise<ChatChannelDto> {
	authorizeCreateChannel(actor)
	const kind = input.kind ?? 'public'
	const normalizedName = input.name.trim().toLowerCase()
	const existing = await getChannelByName(tx, actor.workspaceId, normalizedName)
	if (existing) {
		throw new HttpError(409, 'conflict', `Channel "#${normalizedName}" already exists`)
	}

	const created = await insertChannelRow(tx, {
		workspaceId: actor.workspaceId,
		kind,
		name: normalizedName,
		topic: (input.topic ?? '').trim(),
		dmKey: null,
		createdBy: actor.principalId
	})

	await upsertChannelMember(tx, {
		workspaceId: actor.workspaceId,
		channelId: created.id,
		principalType: actor.kind,
		principalId: actor.principalId,
		role: 'admin'
	})

	if (kind === 'private' && actor.kind === 'user') {
		await grantAcl(tx, {
			workspaceId: actor.workspaceId,
			resourceType: 'channel',
			resourceId: created.id,
			principalType: 'user',
			principalId: actor.principalId,
			permission: 'manage',
			grantedBy: actor.principalId
		})
	}

	const extraIds = [...new Set((input.memberIds ?? []).filter((id) => id !== actor.principalId))]
	const validMembers = await filterActiveWorkspaceUserIds(tx, actor.workspaceId, extraIds)
	for (const uid of validMembers) {
		await upsertChannelMember(tx, {
			workspaceId: actor.workspaceId,
			channelId: created.id,
			principalType: 'user',
			principalId: uid,
			role: 'member'
		})
	}

	await emitChatEvent(tx, {
		workspaceId: actor.workspaceId,
		aggregate: 'chat_channel',
		aggregateId: created.id,
		eventType: CHAT_EVENTS.ChannelCreated,
		payload: {
			channelId: created.id,
			kind,
			name: normalizedName,
			actorId: actor.principalId
		}
	})

	await auditChatAction(tx, {
		workspaceId: actor.workspaceId,
		actorType: actor.kind,
		actorId: actor.principalId,
		action: 'chat.channel.create',
		targetType: 'channel',
		targetId: created.id,
		metadata: { kind, name: normalizedName }
	})

	return getChannelDetail(tx, actor, created.id)
}

export async function createOrGetDm(
	tx: Queryable,
	actor: ActorContext,
	input: CreateDmBody
): Promise<{ readonly channel: ChatChannelDto; readonly created: boolean }> {
	authorizeCreateChannel(actor)
	const participantIds = [...new Set([actor.principalId, ...input.memberIds])]
	if (participantIds.length < 2 || participantIds.length > 8) {
		throw new HttpError(422, 'validation_failed', 'Direct messages require between 2 and 8 unique members')
	}
	const validIds = await filterActiveWorkspaceUserIds(tx, actor.workspaceId, participantIds)
	if (validIds.length !== participantIds.length) {
		throw new HttpError(422, 'validation_failed', 'All DM participants must be active workspace members')
	}

	const dmKey = computeDmKey(participantIds)
	const existing = await getChannelByDmKey(tx, actor.workspaceId, dmKey)
	if (existing) {
		return { channel: await getChannelDetail(tx, actor, existing.id), created: false }
	}

	const inserted = await insertChannelRow(tx, {
		workspaceId: actor.workspaceId,
		kind: 'dm',
		name: null,
		topic: '',
		dmKey,
		createdBy: actor.principalId
	})

	for (const uid of participantIds) {
		await upsertChannelMember(tx, {
			workspaceId: actor.workspaceId,
			channelId: inserted.id,
			principalType: 'user',
			principalId: uid,
			role: 'member'
		})
	}

	await emitChatEvent(tx, {
		workspaceId: actor.workspaceId,
		aggregate: 'chat_channel',
		aggregateId: inserted.id,
		eventType: CHAT_EVENTS.ChannelCreated,
		payload: {
			channelId: inserted.id,
			kind: 'dm',
			participantIds,
			actorId: actor.principalId
		}
	})

	return { channel: await getChannelDetail(tx, actor, inserted.id), created: true }
}

export async function updateChannel(
	tx: Queryable,
	actor: ActorContext,
	channelId: string,
	input: UpdateChannelBody
): Promise<ChatChannelDto> {
	const current = await loadAndAuthorizeChannel(tx, actor, channelId, 'channel.manage')
	if (current.kind === 'dm') {
		throw new HttpError(422, 'validation_failed', 'Direct message channels cannot be renamed or archived')
	}
	if (current.version !== input.version) {
		throw new HttpError(409, 'stale_version', 'Channel was modified concurrently', undefined, {
			currentVersion: current.version,
			yourVersion: input.version
		})
	}

	const nextName = input.name !== undefined ? input.name.trim().toLowerCase() : current.name
	if (nextName && nextName !== current.name) {
		const dup = await getChannelByName(tx, actor.workspaceId, nextName)
		if (dup && dup.id !== current.id) {
			throw new HttpError(409, 'conflict', `Channel "#${nextName}" already exists`)
		}
	}

	const nextArchivedAt =
		input.archived === undefined
			? current.archivedAt
			: input.archived
				? (current.archivedAt ?? new Date().toISOString())
				: null

	const updated = await updateChannelRow(tx, {
		workspaceId: actor.workspaceId,
		channelId: current.id,
		expectedVersion: input.version,
		name: nextName,
		topic: input.topic !== undefined ? input.topic.trim() : current.topic,
		archivedAt: nextArchivedAt
	})
	if (!updated) {
		throw new HttpError(409, 'stale_version', 'Channel was modified concurrently')
	}

	await emitChatEvent(tx, {
		workspaceId: actor.workspaceId,
		aggregate: 'chat_channel',
		aggregateId: current.id,
		eventType: CHAT_EVENTS.ChannelUpdated,
		payload: { channelId: current.id, name: nextName, actorId: actor.principalId }
	})

	return getChannelDetail(tx, actor, current.id)
}

export async function addChannelMember(
	tx: Queryable,
	actor: ActorContext,
	channelId: string,
	input: AddChannelMemberBody
): Promise<ChatChannelMemberDto> {
	const channel = await loadAndAuthorizeChannel(tx, actor, channelId, 'channel.manage')
	if (channel.kind === 'dm') {
		throw new HttpError(422, 'validation_failed', 'Cannot modify participants of an existing DM')
	}
	if (channel.archivedAt) {
		throw new HttpError(409, 'channel_archived', 'Channel is archived')
	}
	const principalType = input.principalType ?? 'user'
	const valid = await filterWorkspacePrincipalPairs(tx, actor.workspaceId, [
		{ principalType, principalId: input.principalId }
	])
	if (!valid.has(`${principalType}:${input.principalId}`)) {
		throw new HttpError(404, 'not_found', 'Target member does not belong to this workspace')
	}

	const member = await upsertChannelMember(tx, {
		workspaceId: actor.workspaceId,
		channelId: channel.id,
		principalType,
		principalId: input.principalId,
		role: input.role ?? 'member'
	})

	await emitChatEvent(tx, {
		workspaceId: actor.workspaceId,
		aggregate: 'chat_channel',
		aggregateId: channel.id,
		eventType: CHAT_EVENTS.MemberAdded,
		payload: {
			channelId: channel.id,
			principalType,
			principalId: input.principalId,
			actorId: actor.principalId
		}
	})

	await auditChatAction(tx, {
		workspaceId: actor.workspaceId,
		actorType: actor.kind,
		actorId: actor.principalId,
		action: 'chat.member.add',
		targetType: 'channel',
		targetId: channel.id,
		metadata: { principalType, principalId: input.principalId, role: member.role }
	})

	return member
}

export async function removeChannelMember(
	tx: Queryable,
	actor: ActorContext,
	channelId: string,
	principalId: string
): Promise<{ readonly removed: boolean; readonly channelKind: string }> {
	const channel = await loadAndAuthorizeChannel(
		tx,
		actor,
		channelId,
		principalId === actor.principalId ? 'channel.read' : 'channel.manage'
	)
	if (channel.kind === 'dm') {
		throw new HttpError(422, 'validation_failed', 'Cannot remove participants from a DM')
	}

	const removed = await removeChannelMemberRow(tx, actor.workspaceId, channel.id, principalId)
	if (!removed) throw new HttpError(404, 'not_found', 'Channel member not found')

	await emitChatEvent(tx, {
		workspaceId: actor.workspaceId,
		aggregate: 'chat_channel',
		aggregateId: channel.id,
		eventType: CHAT_EVENTS.MemberRemoved,
		payload: { channelId: channel.id, principalId, actorId: actor.principalId }
	})

	await auditChatAction(tx, {
		workspaceId: actor.workspaceId,
		actorType: actor.kind,
		actorId: actor.principalId,
		action: 'chat.member.remove',
		targetType: 'channel',
		targetId: channel.id,
		metadata: { principalId }
	})

	return { removed: true, channelKind: channel.kind }
}

export async function listMessages(
	tx: Queryable,
	actor: ActorContext,
	channelId: string,
	query: ListMessagesQuery
): Promise<ListMessagesResponse> {
	const channel = await loadAndAuthorizeChannel(tx, actor, channelId, 'channel.read')
	const limit = Math.min(Math.max(query.limit ?? 50, 1), 100)
	const { rows, hasMore } = await listChannelMessageRows(tx, {
		workspaceId: actor.workspaceId,
		channelId: channel.id,
		beforeSeq: query.beforeSeq,
		limit
	})
	const data = await hydrateMessagesForViewer(tx, actor, rows)
	const firstSeq = data[0]?.channelSeq ?? null
	return {
		data,
		nextBeforeSeq: hasMore ? firstSeq : null,
		hasMore,
		lastMsgSeq: Number(channel.lastMsgSeq),
		lastRev: Number(channel.lastRev)
	}
}

export async function listThread(
	tx: Queryable,
	actor: ActorContext,
	parentMessageId: string
): Promise<{ readonly parent: ChatMessageDto; readonly replies: ChatMessageDto[] }> {
	const parentRaw = await getRawMessageById(tx, actor.workspaceId, parentMessageId)
	if (!parentRaw) throw new HttpError(404, 'not_found', 'Message not found')
	await loadAndAuthorizeChannel(tx, actor, parentRaw.channelId, 'channel.read')

	const replyRows = await listThreadReplyRows(tx, actor.workspaceId, parentRaw.id)
	const hydrated = await hydrateMessagesForViewer(tx, actor, [parentRaw, ...replyRows])
	const parent = hydrated[0]!
	const replies = hydrated.slice(1)

	const lastThreadSeq = replies.reduce((max, r) => Math.max(max, r.threadSeq ?? 0), 0)
	if (actor.kind === 'user') {
		await upsertThreadReadState(tx, {
			workspaceId: actor.workspaceId,
			channelId: parentRaw.channelId,
			threadParentId: parentRaw.id,
			userId: actor.principalId,
			lastReadThreadSeq: lastThreadSeq
		})
	}

	return { parent, replies }
}

export async function getChannelChanges(
	tx: Queryable,
	actor: ActorContext,
	channelId: string,
	query: ChannelChangesQuery
): Promise<ChannelChangesResponse> {
	const channel = await loadAndAuthorizeChannel(tx, actor, channelId, 'channel.read')
	const since = query.since ?? 0
	const limit = Math.min(Math.max(query.limit ?? 200, 1), 500)
	const { rows, hasMore } = await listChannelChangeRows(tx, {
		workspaceId: actor.workspaceId,
		channelId: channel.id,
		sinceRev: since,
		limit
	})
	const changes = await hydrateMessagesForViewer(tx, actor, rows)
	const maxRevInPage = changes.reduce((acc, c) => Math.max(acc, c.rev), since)
	return {
		changes,
		nextRev: hasMore ? maxRevInPage : Math.max(since, Number(channel.lastRev)),
		lastMsgSeq: Number(channel.lastMsgSeq),
		hasMore
	}
}

export async function sendMessage(
	tx: Queryable,
	actor: ActorContext,
	channelId: string,
	input: SendMessageBody
): Promise<{
	readonly data: ChatMessageDto
	readonly deduplicated: boolean
	readonly lastMsgSeq: number
	readonly lastRev: number
}> {
	const startedAt = performance.now()
	if (input.id !== undefined && !isAcceptableClientId(input.id)) {
		throw new HttpError(422, 'validation_failed', 'message id must be UUIDv4 or UUIDv7')
	}

	const channel = await loadAndAuthorizeChannel(tx, actor, channelId, 'channel.post')
	if (channel.archivedAt) {
		throw new HttpError(409, 'channel_archived', 'Cannot post to an archived channel')
	}

	const bodyText = input.bodyText.trim()
	if (!bodyText) {
		throw new HttpError(422, 'validation_failed', 'Message text cannot be blank')
	}

	if (input.clientId) {
		const dup = await findMessageByClientId(
			tx,
			actor.workspaceId,
			channel.id,
			actor.principalId,
			input.clientId
		)
		if (dup) {
			const [hydrated] = await hydrateMessagesForViewer(tx, actor, [dup])
			return {
				data: hydrated!,
				deduplicated: true,
				lastMsgSeq: Number(channel.lastMsgSeq),
				lastRev: Number(channel.lastRev)
			}
		}
	}

	const attachmentIds = [...new Set(input.attachmentFileIds ?? [])]
	if (attachmentIds.length > 0) {
		const files = await getFilesByIdsForAttachment(tx, actor.workspaceId, attachmentIds)
		if (files.length !== attachmentIds.length) {
			throw new HttpError(404, 'not_found', 'One or more attachment files do not exist')
		}
		for (const file of files) {
			if (file.scanStatus === 'infected' || file.scanStatus === 'failed') {
				throw new HttpError(403, 'file_infected', `Attachment "${file.filename}" failed security scan`)
			}
		}
	}

	// Lock order (§15.1): ALWAYS update/lock `chat_channels` BEFORE parent `chat_messages`.
	const isTopLevel = !input.threadParentId
	const { lastMsgSeq, lastRev } = await allocateChannelSeqAndRev(
		tx,
		actor.workspaceId,
		channel.id,
		isTopLevel
	)

	let channelSeq: number | null = isTopLevel ? lastMsgSeq : null
	let threadSeq: number | null = null
	let threadParentAuthorId: string | null = null
	if (input.threadParentId) {
		const allocated = await allocateThreadSeq(tx, actor.workspaceId, channel.id, input.threadParentId)
		if (!allocated) {
			throw new HttpError(
				404,
				'not_found',
				'Thread parent message not found in this channel (nested replies are not allowed)'
			)
		}
		threadSeq = allocated.threadSeq
		threadParentAuthorId = allocated.authorId
		channelSeq = null
	}

	const inserted = await insertMessageRow(tx, {
		id: input.id,
		workspaceId: actor.workspaceId,
		channelId: channel.id,
		channelSeq,
		threadSeq,
		rev: lastRev,
		authorType: actor.kind,
		authorId: actor.principalId,
		threadParentId: input.threadParentId ?? null,
		clientId: input.clientId ?? null,
		body: buildDefaultBody(input.body, bodyText),
		bodyText
	})

	if (attachmentIds.length > 0) {
		await upsertMessageAttachments(tx, actor.workspaceId, inserted.id, attachmentIds)
	}

	const urls = extractUrls(bodyText)
	const previewIds: string[] = []
	for (const url of urls) {
		const preview = await upsertPendingLinkPreview(tx, actor.workspaceId, url, sha256Hex(url))
		previewIds.push(preview.id)
	}
	if (previewIds.length > 0) {
		await attachMessageLinkPreviews(tx, actor.workspaceId, inserted.id, previewIds)
	}

	if (actor.kind === 'user') {
		if (isTopLevel) {
			await upsertChannelReadState(tx, {
				workspaceId: actor.workspaceId,
				channelId: channel.id,
				userId: actor.principalId,
				seq: lastMsgSeq,
				clearMentions: true
			})
		} else if (input.threadParentId && threadSeq !== null) {
			await upsertThreadReadState(tx, {
				workspaceId: actor.workspaceId,
				channelId: channel.id,
				threadParentId: input.threadParentId,
				userId: actor.principalId,
				lastReadThreadSeq: threadSeq
			})
		}
	}

	const mentions = extractChatMentions(bodyText)
	await emitChatEvent(tx, {
		workspaceId: actor.workspaceId,
		aggregate: 'chat_message',
		aggregateId: inserted.id,
		eventType: CHAT_EVENTS.MessageCreated,
		payload: {
			messageId: inserted.id,
			channelId: channel.id,
			channelKind: channel.kind,
			channelName: channel.name,
			channelSeq,
			threadParentId: input.threadParentId ?? null,
			threadParentAuthorId,
			threadSeq,
			rev: lastRev,
			authorDisplayName: inserted.authorDisplayName ?? null,
			bodyText,
			mentionedHandles: mentions.handles,
			mentionChannel: mentions.mentionChannel,
			mentionHere: mentions.mentionHere,
			previewUrls: urls,
			actorType: actor.kind,
			actorId: actor.principalId
		}
	})

	chatMessagesTotal.inc({ kind: channel.kind })
	chatFeedLatencyMs.observe(performance.now() - startedAt)

	const refreshed = await getRawMessageById(tx, actor.workspaceId, inserted.id)
	const [hydrated] = await hydrateMessagesForViewer(tx, actor, [refreshed ?? inserted])
	return { data: hydrated!, deduplicated: false, lastMsgSeq, lastRev }
}

export async function updateMessage(
	tx: Queryable,
	actor: ActorContext,
	messageId: string,
	input: UpdateMessageBody
): Promise<{ readonly data: ChatMessageDto; readonly lastMsgSeq: number; readonly lastRev: number }> {
	const existing = await getRawMessageById(tx, actor.workspaceId, messageId)
	if (!existing || existing.deletedAt !== null) {
		throw new HttpError(404, 'not_found', 'Message not found')
	}

	const channel = await loadAndAuthorizeChannel(tx, actor, existing.channelId, 'channel.post')
	if (channel.archivedAt) {
		throw new HttpError(409, 'channel_archived', 'Cannot edit messages in an archived channel')
	}
	if (existing.authorId !== actor.principalId) {
		throw new HttpError(403, 'insufficient_role', 'Only the message author can edit this message')
	}
	if (existing.version !== input.version) {
		throw new HttpError(409, 'stale_version', 'Message was modified concurrently', undefined, {
			currentVersion: existing.version,
			yourVersion: input.version
		})
	}

	const bodyText = input.bodyText.trim()
	if (!bodyText) {
		throw new HttpError(422, 'validation_failed', 'Message text cannot be blank')
	}

	const { lastMsgSeq, lastRev } = await allocateChannelSeqAndRev(tx, actor.workspaceId, channel.id, false)
	const updated = await updateMessageRow(tx, {
		workspaceId: actor.workspaceId,
		messageId: existing.id,
		expectedVersion: input.version,
		nextRev: lastRev,
		body: buildDefaultBody(input.body ?? existing.body, bodyText),
		bodyText
	})
	if (!updated) {
		throw new HttpError(409, 'stale_version', 'Message was modified concurrently')
	}

	const urls = extractUrls(bodyText)
	const previewIds: string[] = []
	for (const url of urls) {
		const preview = await upsertPendingLinkPreview(tx, actor.workspaceId, url, sha256Hex(url))
		previewIds.push(preview.id)
	}
	if (previewIds.length > 0) {
		await attachMessageLinkPreviews(tx, actor.workspaceId, updated.id, previewIds)
	}

	await emitChatEvent(tx, {
		workspaceId: actor.workspaceId,
		aggregate: 'chat_message',
		aggregateId: updated.id,
		eventType: CHAT_EVENTS.MessageUpdated,
		payload: {
			messageId: updated.id,
			channelId: channel.id,
			channelKind: channel.kind,
			channelName: channel.name,
			threadParentId: updated.threadParentId,
			rev: lastRev,
			authorDisplayName: updated.authorDisplayName ?? null,
			bodyText,
			previewUrls: urls,
			actorId: actor.principalId
		}
	})

	const refreshed = await getRawMessageById(tx, actor.workspaceId, updated.id)
	const [hydrated] = await hydrateMessagesForViewer(tx, actor, [refreshed ?? updated])
	return { data: hydrated!, lastMsgSeq, lastRev }
}

export async function deleteMessage(
	tx: Queryable,
	actor: ActorContext,
	messageId: string
): Promise<{ readonly data: ChatMessageDto; readonly lastMsgSeq: number; readonly lastRev: number }> {
	const existing = await getRawMessageById(tx, actor.workspaceId, messageId)
	if (!existing) throw new HttpError(404, 'not_found', 'Message not found')

	const action = existing.authorId === actor.principalId ? 'channel.post' : 'channel.manage'
	const channel = await loadAndAuthorizeChannel(tx, actor, existing.channelId, action)
	if (channel.archivedAt) {
		throw new HttpError(409, 'channel_archived', 'Cannot delete messages in an archived channel')
	}

	const { lastMsgSeq, lastRev } = await allocateChannelSeqAndRev(tx, actor.workspaceId, channel.id, false)
	const deleted = await softDeleteMessageRow(tx, {
		workspaceId: actor.workspaceId,
		messageId: existing.id,
		nextRev: lastRev
	})
	if (!deleted) throw new HttpError(404, 'not_found', 'Message not found')

	await emitChatEvent(tx, {
		workspaceId: actor.workspaceId,
		aggregate: 'chat_message',
		aggregateId: existing.id,
		eventType: CHAT_EVENTS.MessageDeleted,
		payload: {
			messageId: existing.id,
			channelId: channel.id,
			rev: lastRev,
			actorId: actor.principalId
		}
	})

	await auditChatAction(tx, {
		workspaceId: actor.workspaceId,
		actorType: actor.kind,
		actorId: actor.principalId,
		action: 'chat.message.delete',
		targetType: 'chat_message',
		targetId: existing.id,
		metadata: { channelId: channel.id }
	})

	const [hydrated] = await hydrateMessagesForViewer(tx, actor, [deleted])
	return { data: hydrated!, lastMsgSeq, lastRev }
}

export async function addReaction(
	tx: Queryable,
	actor: ActorContext,
	messageId: string,
	input: ToggleReactionBody
): Promise<{ readonly data: ChatMessageDto; readonly lastMsgSeq: number; readonly lastRev: number }> {
	const existing = await getRawMessageById(tx, actor.workspaceId, messageId)
	if (!existing || existing.deletedAt !== null) {
		throw new HttpError(404, 'not_found', 'Message not found')
	}
	const channel = await loadAndAuthorizeChannel(tx, actor, existing.channelId, 'channel.post')
	if (channel.archivedAt) {
		throw new HttpError(409, 'channel_archived', 'Channel is archived')
	}

	const emoji = input.emoji.trim()
	if (!emoji) throw new HttpError(422, 'validation_failed', 'Emoji cannot be blank')

	await addReactionRow(tx, actor.workspaceId, existing.id, actor.principalId, emoji)
	const { lastMsgSeq, lastRev } = await allocateChannelSeqAndRev(tx, actor.workspaceId, channel.id, false)
	const [bumped] = await tx<{ rev: number }[]>`
		UPDATE chat_messages SET rev = ${lastRev}
		WHERE workspace_id = ${actor.workspaceId} AND id = ${existing.id}
		RETURNING rev::int AS rev
	`
	if (bumped) {
		await emitChatEvent(tx, {
			workspaceId: actor.workspaceId,
			aggregate: 'chat_message',
			aggregateId: existing.id,
			eventType: CHAT_EVENTS.ReactionChanged,
			payload: {
				messageId: existing.id,
				channelId: channel.id,
				emoji,
				added: true,
				rev: lastRev,
				actorId: actor.principalId
			}
		})
	}

	const refreshed = await getRawMessageById(tx, actor.workspaceId, existing.id)
	const [hydrated] = await hydrateMessagesForViewer(tx, actor, [refreshed ?? existing])
	return { data: hydrated!, lastMsgSeq, lastRev }
}

export async function removeReaction(
	tx: Queryable,
	actor: ActorContext,
	messageId: string,
	rawEmoji: string
): Promise<{ readonly data: ChatMessageDto; readonly lastMsgSeq: number; readonly lastRev: number }> {
	const existing = await getRawMessageById(tx, actor.workspaceId, messageId)
	if (!existing || existing.deletedAt !== null) {
		throw new HttpError(404, 'not_found', 'Message not found')
	}
	const channel = await loadAndAuthorizeChannel(tx, actor, existing.channelId, 'channel.post')
	const emoji = decodeURIComponent(rawEmoji).trim()

	await removeReactionRow(tx, actor.workspaceId, existing.id, actor.principalId, emoji)
	const { lastMsgSeq, lastRev } = await allocateChannelSeqAndRev(tx, actor.workspaceId, channel.id, false)
	await tx`
		UPDATE chat_messages SET rev = ${lastRev}
		WHERE workspace_id = ${actor.workspaceId} AND id = ${existing.id}
	`
	await emitChatEvent(tx, {
		workspaceId: actor.workspaceId,
		aggregate: 'chat_message',
		aggregateId: existing.id,
		eventType: CHAT_EVENTS.ReactionChanged,
		payload: {
			messageId: existing.id,
			channelId: channel.id,
			emoji,
			added: false,
			rev: lastRev,
			actorId: actor.principalId
		}
	})

	const refreshed = await getRawMessageById(tx, actor.workspaceId, existing.id)
	const [hydrated] = await hydrateMessagesForViewer(tx, actor, [refreshed ?? existing])
	return { data: hydrated!, lastMsgSeq, lastRev }
}

export async function markChannelRead(
	tx: Queryable,
	actor: ActorContext,
	channelId: string,
	input: MarkChannelReadBody
): Promise<{ readonly channelId: string; readonly lastReadSeq: number; readonly unreadCount: number }> {
	const channel = await loadAndAuthorizeChannel(tx, actor, channelId, 'channel.read')
	const targetSeq = Math.min(input.seq, Number(channel.lastMsgSeq))
	const res = await upsertChannelReadState(tx, {
		workspaceId: actor.workspaceId,
		channelId: channel.id,
		userId: actor.principalId,
		seq: targetSeq,
		clearMentions: targetSeq >= Number(channel.lastMsgSeq)
	})
	const updatedChannel = await getChannelByIdForUser(tx, actor.workspaceId, channel.id, actor.principalId)
	return {
		channelId: channel.id,
		lastReadSeq: res.lastReadSeq,
		unreadCount: Number(updatedChannel?.unreadCount ?? 0)
	}
}

export async function updateChannelMute(
	tx: Queryable,
	actor: ActorContext,
	channelId: string,
	input: UpdateChannelMuteBody
): Promise<{ readonly channelId: string; readonly muted: boolean }> {
	const channel = await loadAndAuthorizeChannel(tx, actor, channelId, 'channel.read')
	const res = await setChannelMutedState(tx, actor.workspaceId, channel.id, actor.principalId, input.muted)
	return { channelId: channel.id, muted: res.muted }
}

export async function listSubscribedThreads(
	tx: Queryable,
	actor: ActorContext
): Promise<ChatThreadSummaryDto[]> {
	if (actor.membership !== 'active') {
		throw new HttpError(403, 'not_workspace_member', 'Active workspace membership is required')
	}
	const bypassAcl =
		actor.roleKey !== 'guest' &&
		(actor.roleRank >= ADMIN_BYPASS_RANK || actor.permissions.has('channel.manage'))
	const entries = await listSubscribedThreadParents(
		tx,
		actor.workspaceId,
		actor.principalId,
		actor.roleKey === 'guest',
		bypassAcl
	)
	if (entries.length === 0) return []

	const hydratedParents = await hydrateMessagesForViewer(
		tx,
		actor,
		entries.map((e) => e.parent)
	)

	const out: ChatThreadSummaryDto[] = []
	for (let i = 0; i < entries.length; i++) {
		const entry = entries[i]!
		const parentMessage = hydratedParents[i]!
		const allReplies = await listThreadReplyRows(tx, actor.workspaceId, parentMessage.id)
		const tailRows = allReplies.slice(-3)
		const latestReplies = await hydrateMessagesForViewer(tx, actor, tailRows)
		const unreadReplyCount = allReplies.filter((r) => (r.threadSeq ?? 0) > entry.lastReadThreadSeq).length
		out.push({
			parentMessage,
			channelId: entry.channelId,
			channelName: entry.channelName,
			channelKind: entry.channelKind,
			lastReadThreadSeq: entry.lastReadThreadSeq,
			unreadReplyCount,
			latestReplies
		})
	}
	return out
}

// ---------- Cross-Module Helpers (Realtime, Notifications, Imports) ----------

export async function canUserAccessChannel(
	tx: Queryable,
	actor: ActorContext,
	channelId: string
): Promise<boolean> {
	try {
		await loadAndAuthorizeChannel(tx, actor, channelId, 'channel.read')
		return true
	} catch {
		return false
	}
}

export async function getChannelNotificationContext(
	tx: Queryable,
	workspaceId: string,
	channelId: string,
	threadParentId?: string | null
) {
	return getChannelNotificationContextRows(tx, workspaceId, channelId, threadParentId)
}

export async function incrementChannelMentionCount(
	tx: Queryable,
	workspaceId: string,
	channelId: string,
	userId: string
): Promise<void> {
	await incrementChannelMentionCountRow(tx, workspaceId, channelId, userId)
}

export async function ensureChannelForImport(
	tx: Queryable,
	actor: ActorContext,
	input: {
		readonly name: string
		readonly kind: 'public' | 'private'
		readonly topic?: string
	}
): Promise<ChatChannelDto> {
	const normalizedName = input.name.trim().toLowerCase()
	const existing = await getChannelByName(tx, actor.workspaceId, normalizedName)
	if (existing) {
		return getChannelDetail(tx, actor, existing.id)
	}
	return createChannel(tx, actor, {
		kind: input.kind,
		name: normalizedName,
		topic: input.topic ?? ''
	})
}

export async function importChatMessage(
	tx: Queryable,
	actor: ActorContext,
	input: {
		readonly channelId: string
		readonly authorId: string
		readonly bodyText: string
		readonly threadParentId?: string | undefined
		readonly reactions?: readonly { readonly emoji: string; readonly userIds: readonly string[] }[]
	}
): Promise<ChatMessageDto> {
	const msgActor: ActorContext =
		input.authorId === actor.principalId
			? actor
			: {
					...actor,
					principalId: input.authorId
				}
	const sent = await sendMessage(tx, msgActor, input.channelId, {
		bodyText: input.bodyText,
		...(input.threadParentId ? { threadParentId: input.threadParentId } : {})
	})
	if (input.reactions && input.reactions.length > 0) {
		for (const reaction of input.reactions) {
			for (const uid of reaction.userIds) {
				await addReactionRow(tx, actor.workspaceId, sent.data.id, uid, reaction.emoji)
			}
		}
		const refreshed = await getRawMessageById(tx, actor.workspaceId, sent.data.id)
		if (!refreshed) return sent.data
		const [hydrated] = await hydrateMessagesForViewer(tx, actor, [refreshed])
		return hydrated ?? sent.data
	}
	return sent.data
}
