/**
 * Chat v2 (M11, Â§5.1â€“Â§5.7): synced drafts, scheduling, saved reminders,
 * sidebar organization, pins/bookmarks, statuses, user groups, polls,
 * ACL-safe forwarding and optional LiveKit huddles. Channel mutations keep
 * chat's partitioned-sync rule: no workspace change_log rows; outbox + audit
 * are written in the same tenant transaction as the domain mutation.
 */
import { createHmac, randomUUID } from 'node:crypto'
import type {
	ChatBookmarkBody,
	ChatDraftBody,
	ChatSavedItemBody,
	ChatScheduleMessageBody,
	ChatSidebarSectionBody,
	ChatSidebarSectionItemBody,
	CreatePollBody,
	CreateUserGroupBody,
	CreateWorkspaceEmojiBody,
	ForwardMessageBody,
	StartHuddleBody,
	UpdateChatSavedItemBody,
	UpdateChatSidebarSectionBody,
	UpdateUserStatusBody,
	VotePollBody
} from '@huriro/contracts'
import type { Queryable, Sql } from '@huriro/db'
import { withWorkspace } from '@huriro/db'
import { type ActorContext, generateKeyBetween } from '@huriro/domain'
import { HttpError } from '../../api/error'
import { createDocPage } from '../docs'
import { resolveActor, resolveResourceAcl } from '../tenancy'
import { authorizeChannel } from './policy'
import {
	allocateChannelSeqAndRev,
	auditChatAction,
	emitChatEvent,
	getChannelByIdForUser,
	getRawMessageById
} from './repo'
import { sendMessage } from './service'

export interface HuddleConfig {
	readonly enabled: boolean
	readonly livekitUrl?: string | undefined
	readonly apiKey?: string | undefined
	readonly apiSecret?: string | undefined
}

type Row = Record<string, unknown>

async function requireChannel(
	tx: Queryable,
	actor: ActorContext,
	channelId: string,
	action: 'channel.read' | 'channel.post' | 'channel.manage' = 'channel.read'
) {
	const channel = await getChannelByIdForUser(tx, actor.workspaceId, channelId, actor.principalId)
	if (!channel) throw new HttpError(404, 'not_found', 'Channel not found')
	const acl = await resolveResourceAcl(tx, {
		workspaceId: actor.workspaceId,
		resourceType: 'channel',
		resourceId: channel.id,
		userId: actor.userId
	})
	await authorizeChannel(tx, actor, action, channel, acl)
	return channel
}

async function auditAndEmit(
	tx: Queryable,
	actor: ActorContext,
	args: {
		readonly aggregate: string
		readonly aggregateId: string
		readonly eventType: string
		readonly action: string
		readonly targetType: string
		readonly payload?: Record<string, unknown>
	}
): Promise<void> {
	await emitChatEvent(tx, {
		workspaceId: actor.workspaceId,
		aggregate: args.aggregate,
		aggregateId: args.aggregateId,
		eventType: args.eventType,
		payload: { actorId: actor.principalId, ...args.payload }
	})
	await auditChatAction(tx, {
		workspaceId: actor.workspaceId,
		actorType: actor.kind,
		actorId: actor.principalId,
		action: args.action,
		targetType: args.targetType,
		targetId: args.aggregateId,
		metadata: args.payload ?? {}
	})
}

// ---------- Synced drafts (Â§5.2) ----------
export async function listChatDrafts(tx: Queryable, actor: ActorContext): Promise<Row[]> {
	return tx<Row[]>`
		SELECT id, channel_id AS "channelId", thread_parent_id AS "threadParentId", body,
			body_text AS "bodyText", attachment_file_ids AS "attachmentFileIds",
			created_at::text AS "createdAt", updated_at::text AS "updatedAt"
		FROM chat_drafts
		WHERE workspace_id = ${actor.workspaceId} AND user_id = ${actor.userId}
		ORDER BY updated_at DESC
	`
}

export async function upsertChatDraft(
	tx: Queryable,
	actor: ActorContext,
	channelId: string,
	input: ChatDraftBody
): Promise<Row> {
	await requireChannel(tx, actor, channelId, 'channel.post')
	const threadParentId = input.threadParentId ?? null
	if (threadParentId) {
		const parent = await getRawMessageById(tx, actor.workspaceId, threadParentId)
		if (!parent || parent.channelId !== channelId || parent.threadParentId !== null) {
			throw new HttpError(404, 'not_found', 'Thread parent not found in this channel')
		}
	}
	const empty = input.bodyText.trim().length === 0 && (input.attachmentFileIds ?? []).length === 0
	if (empty) {
		await tx`
			DELETE FROM chat_drafts
			WHERE workspace_id = ${actor.workspaceId}
				AND user_id = ${actor.userId}
				AND channel_id = ${channelId}
				AND COALESCE(thread_parent_id, '00000000-0000-0000-0000-000000000000'::uuid) =
					COALESCE(${threadParentId}::uuid, '00000000-0000-0000-0000-000000000000'::uuid)
		`
		return { deleted: true, channelId, threadParentId }
	}
	const existing = await tx<{ id: string }[]>`
		SELECT id FROM chat_drafts
		WHERE workspace_id = ${actor.workspaceId}
			AND user_id = ${actor.userId}
			AND channel_id = ${channelId}
			AND COALESCE(thread_parent_id, '00000000-0000-0000-0000-000000000000'::uuid) =
				COALESCE(${threadParentId}::uuid, '00000000-0000-0000-0000-000000000000'::uuid)
		LIMIT 1
	`
	const row = existing[0]
		? (
				await tx<Row[]>`
					UPDATE chat_drafts
					SET body = ${tx.json((input.body ?? {}) as never)}, body_text = ${input.bodyText},
						attachment_file_ids = ${input.attachmentFileIds ?? []}::uuid[]
					WHERE workspace_id = ${actor.workspaceId} AND id = ${existing[0].id}
					RETURNING id, channel_id AS "channelId", thread_parent_id AS "threadParentId", body,
						body_text AS "bodyText", attachment_file_ids AS "attachmentFileIds",
						created_at::text AS "createdAt", updated_at::text AS "updatedAt"
				`
			)[0]
		: (
				await tx<Row[]>`
					INSERT INTO chat_drafts (
						workspace_id, channel_id, thread_parent_id, user_id, body, body_text, attachment_file_ids
					) VALUES (
						${actor.workspaceId}, ${channelId}, ${threadParentId}, ${actor.userId},
						${tx.json((input.body ?? {}) as never)}, ${input.bodyText}, ${input.attachmentFileIds ?? []}::uuid[]
					)
					RETURNING id, channel_id AS "channelId", thread_parent_id AS "threadParentId", body,
						body_text AS "bodyText", attachment_file_ids AS "attachmentFileIds",
						created_at::text AS "createdAt", updated_at::text AS "updatedAt"
				`
			)[0]
	if (!row) throw new Error('draft upsert failed')
	return row
}

export async function deleteChatDraft(
	tx: Queryable,
	actor: ActorContext,
	draftId: string
): Promise<{ deleted: true }> {
	const rows = await tx<{ id: string }[]>`
		DELETE FROM chat_drafts
		WHERE workspace_id = ${actor.workspaceId} AND id = ${draftId} AND user_id = ${actor.userId}
		RETURNING id
	`
	if (rows.length === 0) throw new HttpError(404, 'not_found', 'Draft not found')
	return { deleted: true }
}

// ---------- Scheduled messages (Â§5.2) ----------
export async function scheduleChatMessage(
	tx: Queryable,
	actor: ActorContext,
	channelId: string,
	input: ChatScheduleMessageBody
): Promise<Row> {
	await requireChannel(tx, actor, channelId, 'channel.post')
	const scheduledFor = new Date(input.scheduledFor)
	if (Number.isNaN(scheduledFor.getTime()) || scheduledFor.getTime() <= Date.now()) {
		throw new HttpError(422, 'validation_failed', 'scheduledFor must be a future timestamp')
	}
	const [row] = await tx<Row[]>`
		INSERT INTO chat_scheduled_messages (
			workspace_id, channel_id, thread_parent_id, author_id, body, body_text,
			attachment_file_ids, scheduled_for
		) VALUES (
			${actor.workspaceId}, ${channelId}, ${input.threadParentId ?? null}, ${actor.userId},
			${tx.json((input.body ?? {}) as never)}, ${input.bodyText}, ${input.attachmentFileIds ?? []}::uuid[],
			${scheduledFor.toISOString()}
		)
		RETURNING id, channel_id AS "channelId", thread_parent_id AS "threadParentId", body,
			body_text AS "bodyText", attachment_file_ids AS "attachmentFileIds",
			scheduled_for::text AS "scheduledFor", status, version, created_at::text AS "createdAt"
	`
	if (!row) throw new Error('scheduled message insert failed')
	await auditAndEmit(tx, actor, {
		aggregate: 'chat_scheduled_message',
		aggregateId: String(row['id']),
		eventType: 'chat.scheduled_message.created.v1',
		action: 'chat.scheduled_message.create',
		targetType: 'chat_scheduled_message',
		payload: { channelId, scheduledFor: scheduledFor.toISOString() }
	})
	return row
}

export async function listScheduledChatMessages(tx: Queryable, actor: ActorContext): Promise<Row[]> {
	return tx<Row[]>`
		SELECT id, channel_id AS "channelId", thread_parent_id AS "threadParentId", body_text AS "bodyText",
			attachment_file_ids AS "attachmentFileIds", scheduled_for::text AS "scheduledFor", status,
			sent_message_id AS "sentMessageId", error_detail AS "errorDetail", version,
			created_at::text AS "createdAt", updated_at::text AS "updatedAt"
		FROM chat_scheduled_messages
		WHERE workspace_id = ${actor.workspaceId} AND author_id = ${actor.userId}
		ORDER BY scheduled_for ASC
	`
}

export async function cancelScheduledChatMessage(
	tx: Queryable,
	actor: ActorContext,
	id: string,
	expectedVersion: number
): Promise<Row> {
	const [row] = await tx<Row[]>`
		UPDATE chat_scheduled_messages
		SET status = 'cancelled', version = version + 1
		WHERE workspace_id = ${actor.workspaceId} AND id = ${id}
			AND author_id = ${actor.userId} AND status = 'scheduled' AND version = ${expectedVersion}
		RETURNING id, status, version
	`
	if (!row) throw new HttpError(409, 'conflict', 'Scheduled message was already sent, cancelled, or changed')
	await auditAndEmit(tx, actor, {
		aggregate: 'chat_scheduled_message',
		aggregateId: id,
		eventType: 'chat.scheduled_message.cancelled.v1',
		action: 'chat.scheduled_message.cancel',
		targetType: 'chat_scheduled_message'
	})
	return row
}

/** One due-row worker pass. Sending uses the author's resolved actor so channel ACLs still apply. */
export async function runChatScheduledMessagesOnce(sql: Sql): Promise<number> {
	const due = await sql<
		{ workspaceId: string; id: string }[]
	>`SELECT workspace_id AS "workspaceId", id FROM list_chat_scheduled_messages_due()`
	let sent = 0
	for (const item of due) {
		// All tenant reads/writes happen inside withWorkspace — FORCE RLS denies
		// every row outside a tenant context, so never query chat tables bare.
		try {
			const didSend = await withWorkspace(sql, { workspaceId: item.workspaceId }, async (tx) => {
				const [scheduled] = await tx<Row[]>`
					SELECT id, channel_id AS "channelId", thread_parent_id AS "threadParentId", body,
						body_text AS "bodyText", attachment_file_ids AS "attachmentFileIds",
						author_id AS "authorId"
					FROM chat_scheduled_messages
					WHERE workspace_id = ${item.workspaceId} AND id = ${item.id} AND status = 'scheduled'
					FOR UPDATE
				`
				if (!scheduled) return false
				const authorId = String(scheduled['authorId'])
				const actor = await resolveActor(tx, { workspaceId: item.workspaceId, userId: authorId })
				const result = await sendMessage(tx, actor, String(scheduled['channelId']), {
					bodyText: String(scheduled['bodyText']),
					...(scheduled['threadParentId'] ? { threadParentId: String(scheduled['threadParentId']) } : {}),
					attachmentFileIds: (scheduled['attachmentFileIds'] as string[] | undefined) ?? []
				})
				await tx`
					UPDATE chat_scheduled_messages
					SET status = 'sent', sent_message_id = ${result.data.id}, version = version + 1
					WHERE workspace_id = ${item.workspaceId} AND id = ${item.id} AND status = 'scheduled'
				`
				return true
			})
			if (didSend) sent += 1
		} catch (err) {
			await withWorkspace(
				sql,
				{ workspaceId: item.workspaceId },
				(tx) =>
					tx`
					UPDATE chat_scheduled_messages
					SET status = 'failed', error_detail = ${err instanceof Error ? err.message.slice(0, 500) : 'send failed'}, version = version + 1
					WHERE workspace_id = ${item.workspaceId} AND id = ${item.id} AND status = 'scheduled'
				`
			).catch(() => {})
		}
	}
	return sent
}

// ---------- Saved for later + reminders (Â§5.2) ----------
export async function createSavedItem(
	tx: Queryable,
	actor: ActorContext,
	input: ChatSavedItemBody
): Promise<Row> {
	if (input.messageId) {
		const msg = await getRawMessageById(tx, actor.workspaceId, input.messageId)
		if (!msg) throw new HttpError(404, 'not_found', 'Message not found')
		await requireChannel(tx, actor, msg.channelId, 'channel.read')
	}
	const [row] = await tx<Row[]>`
		INSERT INTO chat_saved_items (workspace_id, user_id, message_id, custom_text, note, remind_at)
		VALUES (${actor.workspaceId}, ${actor.userId}, ${input.messageId ?? null}, ${input.customText ?? ''},
			${input.note ?? ''}, ${input.remindAt ?? null})
		ON CONFLICT (workspace_id, user_id, message_id) WHERE message_id IS NOT NULL
		DO UPDATE SET note = EXCLUDED.note, remind_at = EXCLUDED.remind_at, reminded_at = NULL
		RETURNING id, message_id AS "messageId", custom_text AS "customText", note, status,
			remind_at::text AS "remindAt", version, created_at::text AS "createdAt"
	`
	if (!row) throw new Error('saved item insert failed')
	await auditAndEmit(tx, actor, {
		aggregate: 'chat_saved_item',
		aggregateId: String(row['id']),
		eventType: 'chat.saved_item.created.v1',
		action: 'chat.saved_item.save',
		targetType: 'chat_saved_item'
	})
	return row
}

export async function listSavedItems(tx: Queryable, actor: ActorContext): Promise<Row[]> {
	return tx<Row[]>`
		SELECT s.id, s.message_id AS "messageId", s.custom_text AS "customText", s.note, s.status,
			s.remind_at::text AS "remindAt", s.completed_at::text AS "completedAt", s.version,
			s.created_at::text AS "createdAt", s.updated_at::text AS "updatedAt",
			m.channel_id AS "channelId", m.body_text AS "messageText"
		FROM chat_saved_items s
		LEFT JOIN chat_messages m ON m.workspace_id = s.workspace_id AND m.id = s.message_id
		WHERE s.workspace_id = ${actor.workspaceId} AND s.user_id = ${actor.userId}
		ORDER BY s.updated_at DESC
	`
}

export async function updateSavedItem(
	tx: Queryable,
	actor: ActorContext,
	id: string,
	input: UpdateChatSavedItemBody
): Promise<Row> {
	const completedAt = input.status === 'completed' ? new Date().toISOString() : null
	const [row] = await tx<Row[]>`
		UPDATE chat_saved_items
		SET status = COALESCE(${input.status ?? null}, status),
			note = COALESCE(${input.note ?? null}, note),
			remind_at = CASE WHEN ${input.remindAt === null} THEN NULL ELSE COALESCE(${input.remindAt ?? null}, remind_at) END,
			reminded_at = CASE WHEN ${input.remindAt !== undefined} THEN NULL ELSE reminded_at END,
			completed_at = COALESCE(${completedAt}, completed_at),
			version = version + 1
		WHERE workspace_id = ${actor.workspaceId} AND id = ${id}
			AND user_id = ${actor.userId} AND version = ${input.version}
		RETURNING id, status, note, remind_at::text AS "remindAt", version
	`
	if (!row) throw new HttpError(409, 'conflict', 'Saved item changed or does not exist')
	await auditAndEmit(tx, actor, {
		aggregate: 'chat_saved_item',
		aggregateId: id,
		eventType: 'chat.saved_item.updated.v1',
		action: 'chat.saved_item.update',
		targetType: 'chat_saved_item'
	})
	return row
}

export async function deleteSavedItem(
	tx: Queryable,
	actor: ActorContext,
	id: string
): Promise<{ deleted: true }> {
	const rows = await tx<{ id: string }[]>`
		DELETE FROM chat_saved_items
		WHERE workspace_id = ${actor.workspaceId} AND id = ${id} AND user_id = ${actor.userId}
		RETURNING id
	`
	if (rows.length === 0) throw new HttpError(404, 'not_found', 'Saved item not found')
	return { deleted: true }
}

export async function runChatSavedRemindersOnce(sql: Sql): Promise<number> {
	const due = await sql<
		{ workspaceId: string; id: string }[]
	>`SELECT workspace_id AS "workspaceId", id FROM list_chat_saved_reminders_due()`
	let reminded = 0
	for (const item of due) {
		reminded += await withWorkspace(sql, { workspaceId: item.workspaceId }, async (tx) => {
			const rows = await tx<Row[]>`
				UPDATE chat_saved_items
				SET reminded_at = now(), version = version + 1
				WHERE workspace_id = ${item.workspaceId} AND id = ${item.id}
					AND remind_at <= now() AND reminded_at IS NULL
				RETURNING user_id AS "userId", COALESCE(custom_text, note, 'Saved item') AS title
			`
			const row = rows[0]
			if (!row) return 0
			await tx`
				INSERT INTO notifications (workspace_id, recipient_user_id, actor_type, actor_id, kind, entity_type, entity_id, title, body, metadata)
				VALUES (${item.workspaceId}, ${String(row['userId'])}, 'system', NULL, 'chat.reminder_due', 'chat_saved_item', ${item.id},
					'Saved item reminder', ${String(row['title']).slice(0, 300)}, '{}'::jsonb)
			`
			return 1
		})
	}
	return reminded
}

// ---------- Sidebar sections, bookmarks and pins (Â§5.3) ----------
export async function listSidebarSections(tx: Queryable, actor: ActorContext): Promise<Row[]> {
	return tx<Row[]>`
		SELECT s.id, s.name, s.position, s.collapsed, s.unread_only AS "unreadOnly", s.version,
			s.created_at::text AS "createdAt", s.updated_at::text AS "updatedAt",
			COALESCE(json_agg(json_build_object('channelId', i.channel_id, 'position', i.position)
				ORDER BY i.position COLLATE "C") FILTER (WHERE i.channel_id IS NOT NULL), '[]'::json) AS items
		FROM chat_sidebar_sections s
		LEFT JOIN chat_sidebar_section_items i
			ON i.workspace_id = s.workspace_id AND i.section_id = s.id
		WHERE s.workspace_id = ${actor.workspaceId} AND s.user_id = ${actor.userId}
		GROUP BY s.id
		ORDER BY s.position COLLATE "C"
	`
}

export async function createSidebarSection(
	tx: Queryable,
	actor: ActorContext,
	input: ChatSidebarSectionBody
): Promise<Row> {
	const position = input.position ?? generateKeyBetween(null, null)
	const [row] = await tx<Row[]>`
		INSERT INTO chat_sidebar_sections (workspace_id, user_id, name, position, collapsed, unread_only)
		VALUES (${actor.workspaceId}, ${actor.userId}, ${input.name.trim()}, ${position},
			${input.collapsed ?? false}, ${input.unreadOnly ?? false})
		RETURNING id, name, position, collapsed, unread_only AS "unreadOnly", version, created_at::text AS "createdAt"
	`
	if (!row) throw new Error('sidebar section insert failed')
	await auditAndEmit(tx, actor, {
		aggregate: 'chat_sidebar_section',
		aggregateId: String(row['id']),
		eventType: 'chat.sidebar_section.created.v1',
		action: 'chat.sidebar_section.create',
		targetType: 'chat_sidebar_section'
	})
	return row
}

export async function updateSidebarSection(
	tx: Queryable,
	actor: ActorContext,
	id: string,
	input: UpdateChatSidebarSectionBody
): Promise<Row> {
	const [row] = await tx<Row[]>`
		UPDATE chat_sidebar_sections
		SET name = COALESCE(${input.name ?? null}, name),
			position = COALESCE(${input.position ?? null}, position),
			collapsed = COALESCE(${input.collapsed ?? null}, collapsed),
			unread_only = COALESCE(${input.unreadOnly ?? null}, unread_only),
			version = version + 1
		WHERE workspace_id = ${actor.workspaceId} AND id = ${id}
			AND user_id = ${actor.userId} AND version = ${input.version}
		RETURNING id, name, position, collapsed, unread_only AS "unreadOnly", version
	`
	if (!row) throw new HttpError(409, 'conflict', 'Sidebar section changed or does not exist')
	await auditAndEmit(tx, actor, {
		aggregate: 'chat_sidebar_section',
		aggregateId: id,
		eventType: 'chat.sidebar_section.updated.v1',
		action: 'chat.sidebar_section.update',
		targetType: 'chat_sidebar_section'
	})
	return row
}

export async function deleteSidebarSection(
	tx: Queryable,
	actor: ActorContext,
	id: string
): Promise<{ deleted: true }> {
	const rows = await tx<{ id: string }[]>`
		DELETE FROM chat_sidebar_sections
		WHERE workspace_id = ${actor.workspaceId} AND id = ${id} AND user_id = ${actor.userId}
		RETURNING id
	`
	if (rows.length === 0) throw new HttpError(404, 'not_found', 'Sidebar section not found')
	return { deleted: true }
}

export async function addSidebarSectionItem(
	tx: Queryable,
	actor: ActorContext,
	sectionId: string,
	input: ChatSidebarSectionItemBody
): Promise<Row> {
	const section = await tx<{ id: string }[]>`
		SELECT id FROM chat_sidebar_sections
		WHERE workspace_id = ${actor.workspaceId} AND id = ${sectionId} AND user_id = ${actor.userId}
	`
	if (!section[0]) throw new HttpError(404, 'not_found', 'Sidebar section not found')
	await requireChannel(tx, actor, input.channelId, 'channel.read')
	const position = input.position ?? generateKeyBetween(null, null)
	const [row] = await tx<Row[]>`
		INSERT INTO chat_sidebar_section_items (workspace_id, section_id, channel_id, position)
		VALUES (${actor.workspaceId}, ${sectionId}, ${input.channelId}, ${position})
		ON CONFLICT (workspace_id, section_id, channel_id) DO UPDATE SET position = EXCLUDED.position
		RETURNING section_id AS "sectionId", channel_id AS "channelId", position
	`
	if (!row) throw new Error('sidebar item upsert failed')
	return row
}

export async function removeSidebarSectionItem(
	tx: Queryable,
	actor: ActorContext,
	sectionId: string,
	channelId: string
): Promise<{ deleted: true }> {
	const rows = await tx<{ channelId: string }[]>`
		DELETE FROM chat_sidebar_section_items
		WHERE workspace_id = ${actor.workspaceId} AND section_id = ${sectionId} AND channel_id = ${channelId}
			AND EXISTS (
				SELECT 1 FROM chat_sidebar_sections s
				WHERE s.workspace_id = ${actor.workspaceId} AND s.id = ${sectionId} AND s.user_id = ${actor.userId}
			)
		RETURNING channel_id AS "channelId"
	`
	if (rows.length === 0) throw new HttpError(404, 'not_found', 'Sidebar item not found')
	return { deleted: true }
}

export async function listChannelBookmarks(
	tx: Queryable,
	actor: ActorContext,
	channelId: string
): Promise<Row[]> {
	await requireChannel(tx, actor, channelId, 'channel.read')
	return tx<Row[]>`
		SELECT id, target_type AS "targetType", target_id AS "targetId", title, url, icon, folder,
			position, created_by AS "createdBy", version, created_at::text AS "createdAt", updated_at::text AS "updatedAt"
		FROM chat_channel_bookmarks
		WHERE workspace_id = ${actor.workspaceId} AND channel_id = ${channelId}
		ORDER BY position COLLATE "C"
	`
}

export async function createChannelBookmark(
	tx: Queryable,
	actor: ActorContext,
	channelId: string,
	input: ChatBookmarkBody
): Promise<Row> {
	await requireChannel(tx, actor, channelId, 'channel.post')
	const position = input.position ?? generateKeyBetween(null, null)
	const [row] = await tx<Row[]>`
		INSERT INTO chat_channel_bookmarks (
			workspace_id, channel_id, target_type, target_id, title, url, icon, folder, position, created_by
		) VALUES (
			${actor.workspaceId}, ${channelId}, ${input.targetType}, ${input.targetId ?? null}, ${input.title},
			${input.url ?? null}, ${input.icon ?? null}, ${input.folder ?? null}, ${position}, ${actor.userId}
		)
		RETURNING id, target_type AS "targetType", target_id AS "targetId", title, url, icon, folder,
			position, version, created_at::text AS "createdAt"
	`
	if (!row) throw new Error('bookmark insert failed')
	await auditAndEmit(tx, actor, {
		aggregate: 'chat_channel_bookmark',
		aggregateId: String(row['id']),
		eventType: 'chat.channel_bookmark.created.v1',
		action: 'chat.channel_bookmark.create',
		targetType: 'chat_channel_bookmark',
		payload: { channelId }
	})
	return row
}

export async function deleteChannelBookmark(
	tx: Queryable,
	actor: ActorContext,
	id: string
): Promise<{ deleted: true }> {
	const rows = await tx<{ id: string }[]>`
		DELETE FROM chat_channel_bookmarks
		WHERE workspace_id = ${actor.workspaceId} AND id = ${id}
			AND (created_by = ${actor.userId} OR EXISTS (
				SELECT 1 FROM chat_channels c
				WHERE c.workspace_id = ${actor.workspaceId} AND c.id = chat_channel_bookmarks.channel_id
			))
		RETURNING id
	`
	if (rows.length === 0) throw new HttpError(404, 'not_found', 'Bookmark not found')
	return { deleted: true }
}

export async function pinMessage(tx: Queryable, actor: ActorContext, messageId: string): Promise<Row> {
	const msg = await getRawMessageById(tx, actor.workspaceId, messageId)
	if (!msg || msg.deletedAt) throw new HttpError(404, 'not_found', 'Message not found')
	await requireChannel(tx, actor, msg.channelId, 'channel.post')
	const [row] = await tx<Row[]>`
		INSERT INTO chat_pinned_messages (workspace_id, channel_id, message_id, pinned_by)
		VALUES (${actor.workspaceId}, ${msg.channelId}, ${messageId}, ${actor.userId})
		ON CONFLICT (workspace_id, channel_id, message_id) DO NOTHING
		RETURNING channel_id AS "channelId", message_id AS "messageId", pinned_by AS "pinnedBy", position, created_at::text AS "createdAt"
	`
	const result = row ?? { channelId: msg.channelId, messageId, pinnedBy: actor.userId }
	await auditAndEmit(tx, actor, {
		aggregate: 'chat_channel',
		aggregateId: msg.channelId,
		eventType: 'chat.message.pinned.v1',
		action: 'chat.message.pin',
		targetType: 'chat_message',
		payload: { messageId }
	})
	return result
}

export async function unpinMessage(
	tx: Queryable,
	actor: ActorContext,
	messageId: string
): Promise<{ deleted: true }> {
	const rows = await tx<{ messageId: string }[]>`
		DELETE FROM chat_pinned_messages
		WHERE workspace_id = ${actor.workspaceId} AND message_id = ${messageId}
		RETURNING message_id AS "messageId"
	`
	if (rows.length === 0) throw new HttpError(404, 'not_found', 'Pinned message not found')
	return { deleted: true }
}

export async function listPinnedMessages(
	tx: Queryable,
	actor: ActorContext,
	channelId: string
): Promise<Row[]> {
	await requireChannel(tx, actor, channelId, 'channel.read')
	return tx<Row[]>`
		SELECT p.message_id AS "messageId", p.pinned_by AS "pinnedBy", p.position, p.created_at::text AS "createdAt",
			m.body_text AS "bodyText", m.author_id AS "authorId", m.created_at::text AS "messageCreatedAt"
		FROM chat_pinned_messages p
		JOIN chat_messages m ON m.workspace_id = p.workspace_id AND m.channel_id = p.channel_id AND m.id = p.message_id
		WHERE p.workspace_id = ${actor.workspaceId} AND p.channel_id = ${channelId} AND m.deleted_at IS NULL
		ORDER BY p.position COLLATE "C"
	`
}

// ---------- Workspace presence/status and user groups (Â§5.4) ----------
export async function getMyWorkspaceProfile(tx: Queryable, actor: ActorContext): Promise<Row> {
	const [row] = await tx<Row[]>`
		SELECT status_emoji AS "statusEmoji", status_text AS "statusText",
			status_expires_at::text AS "statusExpiresAt", dnd_until::text AS "dndUntil",
			working_hours AS "workingHours", last_seen_at::text AS "lastSeenAt",
			updated_at::text AS "updatedAt"
		FROM user_workspace_profiles
		WHERE workspace_id = ${actor.workspaceId} AND user_id = ${actor.userId}
	`
	return (
		row ?? {
			statusEmoji: null,
			statusText: '',
			statusExpiresAt: null,
			dndUntil: null,
			workingHours: {},
			lastSeenAt: null
		}
	)
}

export async function updateMyWorkspaceProfile(
	tx: Queryable,
	actor: ActorContext,
	input: UpdateUserStatusBody
): Promise<Row> {
	await tx`
		INSERT INTO user_workspace_profiles (
			workspace_id, user_id, status_emoji, status_text, status_expires_at, dnd_until, working_hours, last_seen_at
		) VALUES (
			${actor.workspaceId}, ${actor.userId}, ${input.statusEmoji ?? null}, ${input.statusText ?? ''},
			${input.statusExpiresAt ?? null}, ${input.dndUntil ?? null}, ${tx.json((input.workingHours ?? {}) as never)}, now()
		)
		ON CONFLICT (workspace_id, user_id) DO UPDATE SET
			status_emoji = CASE WHEN ${input.statusEmoji !== undefined} THEN EXCLUDED.status_emoji ELSE user_workspace_profiles.status_emoji END,
			status_text = COALESCE(${input.statusText ?? null}, user_workspace_profiles.status_text),
			status_expires_at = CASE WHEN ${input.statusExpiresAt !== undefined} THEN EXCLUDED.status_expires_at ELSE user_workspace_profiles.status_expires_at END,
			dnd_until = CASE WHEN ${input.dndUntil !== undefined} THEN EXCLUDED.dnd_until ELSE user_workspace_profiles.dnd_until END,
			working_hours = COALESCE(${input.workingHours !== undefined ? tx.json((input.workingHours ?? {}) as never) : null}, user_workspace_profiles.working_hours),
			last_seen_at = now()
	`
	await auditAndEmit(tx, actor, {
		aggregate: 'user_workspace_profile',
		aggregateId: actor.userId,
		eventType: 'chat.user_status.updated.v1',
		action: 'chat.user_status.update',
		targetType: 'user_workspace_profile'
	})
	return getMyWorkspaceProfile(tx, actor)
}

export async function listUserGroups(tx: Queryable, actor: ActorContext): Promise<Row[]> {
	return tx<Row[]>`
		SELECT g.id, g.handle, g.name, g.description, g.auto_join_channel_ids AS "autoJoinChannelIds",
			g.version, g.created_at::text AS "createdAt", g.updated_at::text AS "updatedAt",
			COALESCE(json_agg(m.user_id ORDER BY m.created_at) FILTER (WHERE m.user_id IS NOT NULL), '[]'::json) AS "memberIds"
		FROM user_groups g
		LEFT JOIN user_group_members m ON m.workspace_id = g.workspace_id AND m.group_id = g.id
		WHERE g.workspace_id = ${actor.workspaceId}
		GROUP BY g.id
		ORDER BY g.handle
	`
}

export async function createUserGroup(
	tx: Queryable,
	actor: ActorContext,
	input: CreateUserGroupBody
): Promise<Row> {
	const [row] = await tx<Row[]>`
		INSERT INTO user_groups (workspace_id, handle, name, description, auto_join_channel_ids, created_by)
		VALUES (${actor.workspaceId}, ${input.handle}, ${input.name}, ${input.description ?? ''},
			${input.autoJoinChannelIds ?? []}::uuid[], ${actor.userId})
		RETURNING id, handle, name, description, auto_join_channel_ids AS "autoJoinChannelIds", version, created_at::text AS "createdAt"
	`
	if (!row) throw new HttpError(409, 'conflict', 'User group handle already exists')
	for (const memberId of input.memberIds ?? []) {
		await tx`
			INSERT INTO user_group_members (workspace_id, group_id, user_id)
			VALUES (${actor.workspaceId}, ${String(row['id'])}, ${memberId})
			ON CONFLICT DO NOTHING
		`
	}
	await auditAndEmit(tx, actor, {
		aggregate: 'user_group',
		aggregateId: String(row['id']),
		eventType: 'chat.user_group.created.v1',
		action: 'chat.user_group.create',
		targetType: 'user_group'
	})
	return row
}

export async function setUserGroupMembers(
	tx: Queryable,
	actor: ActorContext,
	groupId: string,
	memberIds: readonly string[]
): Promise<{ memberIds: readonly string[] }> {
	const rows = await tx<{ id: string }[]>`
		SELECT id FROM user_groups WHERE workspace_id = ${actor.workspaceId} AND id = ${groupId}
	`
	if (!rows[0]) throw new HttpError(404, 'not_found', 'User group not found')
	await tx`DELETE FROM user_group_members WHERE workspace_id = ${actor.workspaceId} AND group_id = ${groupId}`
	for (const memberId of memberIds) {
		await tx`
			INSERT INTO user_group_members (workspace_id, group_id, user_id)
			VALUES (${actor.workspaceId}, ${groupId}, ${memberId})
		`
	}
	await auditAndEmit(tx, actor, {
		aggregate: 'user_group',
		aggregateId: groupId,
		eventType: 'chat.user_group.members_updated.v1',
		action: 'chat.user_group.members_update',
		targetType: 'user_group',
		payload: { memberCount: memberIds.length }
	})
	return { memberIds }
}

// ---------- Workspace emoji (Â§5.1) ----------
export async function listWorkspaceEmojis(tx: Queryable, actor: ActorContext): Promise<Row[]> {
	return tx<Row[]>`
		SELECT e.id, e.shortcode, e.file_id AS "fileId", e.created_by AS "createdBy", e.created_at::text AS "createdAt",
			f.filename, f.content_type AS "contentType"
		FROM workspace_emojis e
		JOIN files f ON f.workspace_id = e.workspace_id AND f.id = e.file_id
		WHERE e.workspace_id = ${actor.workspaceId}
		ORDER BY e.shortcode
	`
}

export async function createWorkspaceEmoji(
	tx: Queryable,
	actor: ActorContext,
	input: CreateWorkspaceEmojiBody
): Promise<Row> {
	const files = await tx<{ id: string; scanStatus: string }[]>`
		SELECT id, scan_status AS "scanStatus" FROM files
		WHERE workspace_id = ${actor.workspaceId} AND id = ${input.fileId}
	`
	if (!files[0]) throw new HttpError(404, 'not_found', 'Emoji image file not found')
	if (files[0].scanStatus === 'infected' || files[0].scanStatus === 'failed') {
		throw new HttpError(403, 'file_infected', 'Emoji image failed security scan')
	}
	const [row] = await tx<Row[]>`
		INSERT INTO workspace_emojis (workspace_id, shortcode, file_id, created_by)
		VALUES (${actor.workspaceId}, ${input.shortcode}, ${input.fileId}, ${actor.userId})
		RETURNING id, shortcode, file_id AS "fileId", created_at::text AS "createdAt"
	`
	if (!row) throw new HttpError(409, 'conflict', 'Emoji shortcode already exists')
	await auditAndEmit(tx, actor, {
		aggregate: 'workspace_emoji',
		aggregateId: String(row['id']),
		eventType: 'chat.workspace_emoji.created.v1',
		action: 'chat.workspace_emoji.create',
		targetType: 'workspace_emoji',
		payload: { shortcode: input.shortcode }
	})
	return row
}

export async function deleteWorkspaceEmoji(
	tx: Queryable,
	actor: ActorContext,
	id: string
): Promise<{ deleted: true }> {
	const rows = await tx<{ id: string }[]>`
		DELETE FROM workspace_emojis
		WHERE workspace_id = ${actor.workspaceId} AND id = ${id}
		RETURNING id
	`
	if (rows.length === 0) throw new HttpError(404, 'not_found', 'Workspace emoji not found')
	return { deleted: true }
}

// ---------- Polls, forwarding and huddles (Â§5.1, Â§5.5) ----------
export async function createPoll(
	tx: Queryable,
	actor: ActorContext,
	channelId: string,
	input: CreatePollBody
): Promise<Row> {
	const message = await sendMessage(tx, actor, channelId, {
		bodyText: input.question,
		...(input.threadParentId ? { threadParentId: input.threadParentId } : {}),
		...(input.broadcastToChannel !== undefined ? { broadcastToChannel: input.broadcastToChannel } : {})
	})
	const [poll] = await tx<Row[]>`
		WITH updated_message AS (
			UPDATE chat_messages
			SET message_kind = 'poll', metadata = ${tx.json({ pollQuestion: input.question } as never)}
			WHERE workspace_id = ${actor.workspaceId} AND id = ${message.data.id}
			RETURNING id
		)
		INSERT INTO chat_polls (
			workspace_id, channel_id, message_id, question, options, multi_choice, anonymous, closes_at, created_by
		)
		SELECT ${actor.workspaceId}, ${channelId}, id, ${input.question}, ${tx.json(input.options as never)},
			${input.multiChoice ?? false}, ${input.anonymous ?? false}, ${input.closesAt ?? null}, ${actor.userId}
		FROM updated_message
		RETURNING id, channel_id AS "channelId", message_id AS "messageId", question, options,
			multi_choice AS "multiChoice", anonymous, status, closes_at::text AS "closesAt", version,
			created_at::text AS "createdAt"
	`
	if (!poll) throw new Error('poll insert failed')
	const pollMeta = {
		pollId: String(poll['id']),
		pollQuestion: input.question,
		options: input.options,
		multiChoice: input.multiChoice ?? false,
		anonymous: input.anonymous ?? false
	}
	await tx`
		UPDATE chat_messages
		SET metadata = ${tx.json(pollMeta as never)}
		WHERE workspace_id = ${actor.workspaceId} AND id = ${message.data.id}
	`
	await auditAndEmit(tx, actor, {
		aggregate: 'chat_poll',
		aggregateId: String(poll['id']),
		eventType: 'chat.poll.created.v1',
		action: 'chat.poll.create',
		targetType: 'chat_poll',
		payload: { channelId, messageId: message.data.id }
	})
	return { ...poll, message: { ...message.data, messageKind: 'poll', metadata: pollMeta } }
}

export async function listChannelPolls(
	tx: Queryable,
	actor: ActorContext,
	channelId: string
): Promise<Row[]> {
	await requireChannel(tx, actor, channelId, 'channel.read')
	const polls = await tx<Row[]>`
		SELECT id, channel_id AS "channelId", message_id AS "messageId", question, options,
			multi_choice AS "multiChoice", anonymous, status, closes_at::text AS "closesAt",
			created_by AS "createdBy", version, created_at::text AS "createdAt"
		FROM chat_polls
		WHERE workspace_id = ${actor.workspaceId} AND channel_id = ${channelId}
		ORDER BY created_at ASC
	`
	if (polls.length === 0) return []
	const pollIds = polls.map((p) => String(p['id']))
	const votes = await tx<{ pollId: string; optionIds: string[]; userId: string }[]>`
		SELECT poll_id AS "pollId", option_ids AS "optionIds", user_id AS "userId"
		FROM chat_poll_votes
		WHERE workspace_id = ${actor.workspaceId} AND poll_id = ANY(${pollIds}::uuid[])
	`
	return polls.map((poll) => {
		const id = String(poll['id'])
		const pollVotes = votes.filter((v) => v.pollId === id)
		const counts = new Map<string, number>()
		for (const vote of pollVotes) {
			for (const optId of vote.optionIds) counts.set(optId, (counts.get(optId) ?? 0) + 1)
		}
		return {
			...poll,
			totalVotes: pollVotes.length,
			counts: Object.fromEntries(counts),
			voters:
				poll['anonymous'] === true ? [] : pollVotes.map((v) => ({ userId: v.userId, optionIds: v.optionIds }))
		}
	})
}

export async function votePoll(
	tx: Queryable,
	actor: ActorContext,
	pollId: string,
	input: VotePollBody
): Promise<Row> {
	const [poll] = await tx<Row[]>`
		SELECT id, channel_id AS "channelId", message_id AS "messageId", question, options,
			multi_choice AS "multiChoice", status, closes_at::text AS "closesAt"
		FROM chat_polls WHERE workspace_id = ${actor.workspaceId} AND id = ${pollId}
	`
	if (!poll) throw new HttpError(404, 'not_found', 'Poll not found')
	const channelId = String(poll['channelId'])
	await requireChannel(tx, actor, channelId, 'channel.read')
	if (poll['status'] !== 'open') throw new HttpError(409, 'conflict', 'Poll is closed')
	if (poll['closesAt'] && new Date(String(poll['closesAt'])).getTime() <= Date.now()) {
		throw new HttpError(409, 'conflict', 'Poll voting window has closed')
	}
	const options = poll['options'] as { id?: string }[]
	const valid = new Set(options.map((o) => String(o.id)))
	if (input.optionIds.some((id) => !valid.has(id))) {
		throw new HttpError(422, 'validation_failed', 'Vote contains an unknown poll option')
	}
	if (poll['multiChoice'] !== true && input.optionIds.length !== 1) {
		throw new HttpError(422, 'validation_failed', 'This poll accepts exactly one option')
	}
	const [vote] = await tx<Row[]>`
		INSERT INTO chat_poll_votes (workspace_id, poll_id, user_id, option_ids)
		VALUES (${actor.workspaceId}, ${pollId}, ${actor.userId}, ${input.optionIds}::text[])
		ON CONFLICT (workspace_id, poll_id, user_id)
		DO UPDATE SET option_ids = EXCLUDED.option_ids
		RETURNING poll_id AS "pollId", user_id AS "userId", option_ids AS "optionIds", updated_at::text AS "updatedAt"
	`
	if (!vote) throw new Error('poll vote failed')
	const { lastRev } = await allocateChannelSeqAndRev(tx, actor.workspaceId, channelId, false)
	if (poll['messageId']) {
		await tx`
			UPDATE chat_messages SET rev = ${lastRev}
			WHERE workspace_id = ${actor.workspaceId} AND id = ${String(poll['messageId'])}
		`
	}
	await auditAndEmit(tx, actor, {
		aggregate: 'chat_poll',
		aggregateId: pollId,
		eventType: 'chat.poll.voted.v1',
		action: 'chat.poll.vote',
		targetType: 'chat_poll'
	})
	return { ...vote, channelId }
}

export async function closePoll(tx: Queryable, actor: ActorContext, pollId: string): Promise<Row> {
	const [poll] = await tx<Row[]>`
		UPDATE chat_polls
		SET status = 'closed', version = version + 1
		WHERE workspace_id = ${actor.workspaceId} AND id = ${pollId}
			AND created_by = ${actor.userId} AND status = 'open'
		RETURNING id, channel_id AS "channelId", message_id AS "messageId", status, version
	`
	if (!poll) throw new HttpError(409, 'conflict', 'Poll is already closed or not owned by you')
	const channelId = String(poll['channelId'])
	const { lastRev } = await allocateChannelSeqAndRev(tx, actor.workspaceId, channelId, false)
	if (poll['messageId']) {
		await tx`
			UPDATE chat_messages SET rev = ${lastRev}
			WHERE workspace_id = ${actor.workspaceId} AND id = ${String(poll['messageId'])}
		`
	}
	await auditAndEmit(tx, actor, {
		aggregate: 'chat_poll',
		aggregateId: pollId,
		eventType: 'chat.poll.closed.v1',
		action: 'chat.poll.close',
		targetType: 'chat_poll'
	})
	return poll
}

export async function getPollResults(tx: Queryable, actor: ActorContext, pollId: string): Promise<Row> {
	const [poll] = await tx<Row[]>`
		SELECT id, channel_id AS "channelId", question, options, multi_choice AS "multiChoice", anonymous, status,
			closes_at::text AS "closesAt", created_by AS "createdBy", version, created_at::text AS "createdAt"
		FROM chat_polls WHERE workspace_id = ${actor.workspaceId} AND id = ${pollId}
	`
	if (!poll) throw new HttpError(404, 'not_found', 'Poll not found')
	await requireChannel(tx, actor, String(poll['channelId']), 'channel.read')
	const votes = await tx<{ optionIds: string[]; userId: string }[]>`
		SELECT option_ids AS "optionIds", user_id AS "userId"
		FROM chat_poll_votes WHERE workspace_id = ${actor.workspaceId} AND poll_id = ${pollId}
	`
	const counts = new Map<string, number>()
	for (const vote of votes) for (const id of vote.optionIds) counts.set(id, (counts.get(id) ?? 0) + 1)
	return {
		...poll,
		totalVotes: votes.length,
		counts: Object.fromEntries(counts),
		voters: poll['anonymous'] === true ? [] : votes.map((v) => ({ userId: v.userId, optionIds: v.optionIds }))
	}
}

/** ACL-safe forward: private-channel content becomes a detached plaintext snapshot. */
export async function forwardMessage(
	tx: Queryable,
	actor: ActorContext,
	messageId: string,
	input: ForwardMessageBody
): Promise<Row> {
	const source = await getRawMessageById(tx, actor.workspaceId, messageId)
	if (!source || source.deletedAt) throw new HttpError(404, 'not_found', 'Message not found')
	const sourceChannel = await requireChannel(tx, actor, source.channelId, 'channel.read')
	await requireChannel(tx, actor, input.targetChannelId, 'channel.post')
	const prefix = input.bodyText?.trim() ? `${input.bodyText.trim()}\n\n` : ''
	const snapshot = `${prefix}${source.bodyText}`
	const sent = await sendMessage(tx, actor, input.targetChannelId, { bodyText: snapshot })
	await tx`
		UPDATE chat_messages
		SET metadata = ${tx.json({
			forwardedFrom: {
				messageId: source.id,
				channelId: source.channelId,
				channelKind: sourceChannel.kind,
				snapshot: true
			}
		} as never)}
		WHERE workspace_id = ${actor.workspaceId} AND id = ${sent.data.id}
	`
	return { ...sent.data, forwarded: true }
}

function base64url(input: Buffer | string): string {
	return Buffer.from(input).toString('base64url')
}

function signLivekitToken(args: {
	readonly apiKey: string
	readonly apiSecret: string
	readonly identity: string
	readonly name: string
	readonly room: string
	readonly ttlSeconds?: number
}): string {
	const now = Math.floor(Date.now() / 1000)
	const header = base64url(JSON.stringify({ alg: 'HS256', typ: 'JWT' }))
	const payload = base64url(
		JSON.stringify({
			exp: now + (args.ttlSeconds ?? 900),
			nbf: now - 10,
			iss: args.apiKey,
			sub: args.identity,
			name: args.name,
			video: { roomJoin: true, room: args.room, canPublish: true, canSubscribe: true }
		})
	)
	const unsigned = `${header}.${payload}`
	const signature = createHmac('sha256', args.apiSecret).update(unsigned).digest('base64url')
	return `${unsigned}.${signature}`
}

export async function startHuddle(
	tx: Queryable,
	actor: ActorContext,
	input: StartHuddleBody,
	config: HuddleConfig
): Promise<Row> {
	if (!config.enabled) throw new HttpError(404, 'not_found', 'Huddles are not enabled on this instance')
	await requireChannel(tx, actor, input.channelId, 'channel.post')
	const existing = await tx<Row[]>`
		SELECT id, room_name AS "roomName", status, started_at::text AS "startedAt"
		FROM chat_huddle_sessions
		WHERE workspace_id = ${actor.workspaceId} AND channel_id = ${input.channelId} AND status = 'active'
		ORDER BY started_at DESC LIMIT 1
	`
	if (existing[0]) return existing[0]
	const roomName = `huriro_${actor.workspaceId.replaceAll('-', '')}_${randomUUID().replaceAll('-', '')}`
	const message = await sendMessage(tx, actor, input.channelId, { bodyText: 'Huddle started' })
	const [row] = await tx<Row[]>`
		WITH updated_message AS (
			UPDATE chat_messages SET message_kind = 'huddle_session'
			WHERE workspace_id = ${actor.workspaceId} AND id = ${message.data.id}
			RETURNING id
		)
		INSERT INTO chat_huddle_sessions (workspace_id, channel_id, message_id, room_name, started_by)
		SELECT ${actor.workspaceId}, ${input.channelId}, id, ${roomName}, ${actor.userId}
		FROM updated_message
		RETURNING id, channel_id AS "channelId", message_id AS "messageId", room_name AS "roomName",
			status, started_at::text AS "startedAt"
	`
	if (!row) throw new Error('huddle insert failed')
	await tx`
		UPDATE chat_messages
		SET metadata = ${tx.json({ huddleId: row['id'], roomName, status: 'active' } as never)}
		WHERE workspace_id = ${actor.workspaceId} AND id = ${message.data.id}
	`
	await auditAndEmit(tx, actor, {
		aggregate: 'chat_huddle',
		aggregateId: String(row['id']),
		eventType: 'chat.huddle.started.v1',
		action: 'chat.huddle.start',
		targetType: 'chat_huddle_session',
		payload: { channelId: input.channelId }
	})
	return row
}

export async function getActiveChannelHuddle(
	tx: Queryable,
	actor: ActorContext,
	channelId: string
): Promise<Row | null> {
	await requireChannel(tx, actor, channelId, 'channel.read')
	const [row] = await tx<Row[]>`
		SELECT id, channel_id AS "channelId", message_id AS "messageId", room_name AS "roomName",
			status, started_at::text AS "startedAt"
		FROM chat_huddle_sessions
		WHERE workspace_id = ${actor.workspaceId} AND channel_id = ${channelId} AND status = 'active'
		ORDER BY started_at DESC
		LIMIT 1
	`
	return row ?? null
}

export async function ensureChannelCanvas(
	tx: Queryable,
	actor: ActorContext,
	channelId: string
): Promise<{
	readonly canvas: { readonly pageId: string; readonly slug: string; readonly title: string }
	readonly cursor?: number
}> {
	const channel = await requireChannel(tx, actor, channelId, 'channel.read')
	const existing = await tx<{ pageId: string; slug: string; title: string }[]>`
		SELECT d.id AS "pageId", d.slug, d.title
		FROM chat_channels c
		JOIN doc_pages d ON d.workspace_id = c.workspace_id AND d.id = c.canvas_page_id
		WHERE c.workspace_id = ${actor.workspaceId} AND c.id = ${channelId} AND d.archived_at IS NULL
		LIMIT 1
	`
	if (existing[0]) {
		return { canvas: existing[0] }
	}
	await requireChannel(tx, actor, channelId, 'channel.post')
	const label = channel.name ? `#${channel.name}` : 'Channel'
	const created = await createDocPage(tx, actor, {
		title: `${label} Canvas`,
		slug: `canvas-${channelId.slice(0, 8)}`,
		visibility: 'workspace',
		markdown: `# ${label} Canvas\n\nShared channel notes, decisions, and runbooks.`
	})
	await tx`
		UPDATE chat_channels
		SET canvas_page_id = ${created.data.id}
		WHERE workspace_id = ${actor.workspaceId} AND id = ${channelId}
	`
	await auditAndEmit(tx, actor, {
		aggregate: 'chat_channel',
		aggregateId: channelId,
		eventType: 'chat.channel_canvas.created.v1',
		action: 'chat.channel_canvas.create',
		targetType: 'doc_page',
		payload: { channelId, pageId: created.data.id }
	})
	return {
		canvas: {
			pageId: created.data.id,
			slug: created.data.slug,
			title: created.data.title
		},
		cursor: created.cursor
	}
}

export async function joinHuddle(
	tx: Queryable,
	actor: ActorContext,
	huddleId: string,
	config: HuddleConfig
): Promise<Row> {
	if (!config.enabled) throw new HttpError(404, 'not_found', 'Huddles are not enabled on this instance')
	if (!config.apiKey || !config.apiSecret || !config.livekitUrl) {
		throw new HttpError(503, 'internal', 'LiveKit huddles are not configured')
	}
	const [row] = await tx<Row[]>`
		SELECT id, channel_id AS "channelId", room_name AS "roomName", status
		FROM chat_huddle_sessions
		WHERE workspace_id = ${actor.workspaceId} AND id = ${huddleId}
	`
	if (row?.['status'] !== 'active') throw new HttpError(404, 'not_found', 'Active huddle not found')
	await requireChannel(tx, actor, String(row['channelId']), 'channel.read')
	const token = signLivekitToken({
		apiKey: config.apiKey,
		apiSecret: config.apiSecret,
		identity: actor.userId,
		name: actor.userId,
		room: String(row['roomName'])
	})
	return { huddleId, roomName: row['roomName'], livekitUrl: config.livekitUrl, token, expiresIn: 900 }
}

export async function endHuddle(tx: Queryable, actor: ActorContext, huddleId: string): Promise<Row> {
	const [row] = await tx<Row[]>`
		UPDATE chat_huddle_sessions
		SET status = 'ended', ended_by = ${actor.userId}, ended_at = now(), version = version + 1
		WHERE workspace_id = ${actor.workspaceId} AND id = ${huddleId}
			AND status = 'active' AND started_by = ${actor.userId}
		RETURNING id, channel_id AS "channelId", message_id AS "messageId", status, ended_at::text AS "endedAt"
	`
	if (!row) throw new HttpError(409, 'conflict', 'Huddle is already ended or not owned by you')
	const channelId = String(row['channelId'])
	const { lastRev } = await allocateChannelSeqAndRev(tx, actor.workspaceId, channelId, false)
	if (row['messageId']) {
		await tx`
			UPDATE chat_messages
			SET metadata = ${tx.json({ huddleId, status: 'ended' } as never)}, rev = ${lastRev}
			WHERE workspace_id = ${actor.workspaceId} AND id = ${String(row['messageId'])}
		`
	}
	await auditAndEmit(tx, actor, {
		aggregate: 'chat_huddle',
		aggregateId: huddleId,
		eventType: 'chat.huddle.ended.v1',
		action: 'chat.huddle.end',
		targetType: 'chat_huddle_session'
	})
	return row
}
