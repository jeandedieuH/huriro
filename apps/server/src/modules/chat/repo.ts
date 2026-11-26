import type {
	ChatAttachmentDto,
	ChatChannelDto,
	ChatChannelKind,
	ChatChannelMemberDto,
	ChatLinkPreviewDto,
	ChatMessageDto,
	ChatReactionSummaryDto
} from '@huriro/contracts'
import type { Queryable } from '@huriro/db'

export interface ChannelRecord {
	readonly id: string
	readonly workspaceId: string
	readonly kind: ChatChannelKind
	readonly name: string | null
	readonly topic: string
	readonly dmKey: string | null
	readonly lastMsgSeq: number
	readonly lastRev: number
	readonly createdBy: string
	readonly archivedAt: string | null
	readonly createdAt: string
	readonly updatedAt: string
	readonly version: number
	readonly isMember: boolean
	readonly memberRole: 'member' | 'admin' | null
	readonly lastReadSeq: number
	readonly mentionCount: number
	readonly muted: boolean
	readonly notifyLevel?: 'default' | 'all' | 'mentions' | 'none'
	readonly mutedUntil?: string | null
	readonly canvasPageId?: string | null
	readonly unreadCount: number
	readonly memberCount: number
}

export interface RawMessageRow {
	readonly id: string
	readonly workspaceId: string
	readonly channelId: string
	readonly channelSeq: number | null
	readonly threadSeq: number | null
	readonly rev: number
	readonly authorType: 'user' | 'agent'
	readonly authorId: string
	readonly authorDisplayName: string | null
	readonly threadParentId: string | null
	readonly broadcastToChannel: boolean
	readonly replyToMessageId: string | null
	readonly messageKind: 'text' | 'poll' | 'huddle_session' | 'approval_card' | 'system'
	readonly metadata: unknown
	readonly replyCount: number
	readonly lastReplyAt: string | null
	readonly clientId: string | null
	readonly body: unknown
	readonly bodyText: string
	readonly editedAt: string | null
	readonly deletedAt: string | null
	readonly createdAt: string
	readonly updatedAt: string
	readonly version: number
}

export function toChannelDto(row: ChannelRecord, members?: readonly ChatChannelMemberDto[]): ChatChannelDto {
	const lastMsgSeq = Number(row.lastMsgSeq)
	const lastReadSeq = Number(row.lastReadSeq)
	return {
		id: row.id,
		workspaceId: row.workspaceId,
		kind: row.kind,
		name: row.name,
		topic: row.topic,
		lastMsgSeq,
		lastRev: Number(row.lastRev),
		createdBy: row.createdBy,
		archivedAt: row.archivedAt,
		createdAt: row.createdAt,
		updatedAt: row.updatedAt,
		version: row.version,
		unreadCount: Number(row.unreadCount),
		hasUnread: lastMsgSeq > lastReadSeq,
		mentionCount: Number(row.mentionCount),
		muted: row.muted,
		...(row.notifyLevel !== undefined ? { notifyLevel: row.notifyLevel } : {}),
		...(row.mutedUntil !== undefined ? { mutedUntil: row.mutedUntil } : {}),
		...(row.canvasPageId !== undefined ? { canvasPageId: row.canvasPageId } : {}),
		lastReadSeq,
		isMember: row.isMember,
		memberCount: Number(row.memberCount),
		...(members !== undefined ? { members: [...members] } : {})
	}
}

export async function listVisibleChannelsForUser(
	tx: Queryable,
	args: {
		readonly workspaceId: string
		readonly userId: string
		readonly isGuest: boolean
		readonly bypassAcl: boolean
	}
): Promise<ChannelRecord[]> {
	return tx<ChannelRecord[]>`
		SELECT
			c.id,
			c.workspace_id AS "workspaceId",
			c.kind,
			c.name,
			c.topic,
			c.dm_key AS "dmKey",
			c.canvas_page_id AS "canvasPageId",
			c.last_msg_seq::int AS "lastMsgSeq",
			c.last_rev::int AS "lastRev",
			c.created_by AS "createdBy",
			c.archived_at::text AS "archivedAt",
			c.created_at::text AS "createdAt",
			c.updated_at::text AS "updatedAt",
			c.version,
			(me.principal_id IS NOT NULL) AS "isMember",
			me.role AS "memberRole",
			COALESCE(rs.last_read_seq, 0)::int AS "lastReadSeq",
			COALESCE(rs.mention_count, 0)::int AS "mentionCount",
			COALESCE(rs.muted, false) AS muted,
			COALESCE(rs.notify_level, 'default') AS "notifyLevel",
			rs.muted_until::text AS "mutedUntil",
			LEAST(
				999,
				COALESCE(
					(
						SELECT count(*)::int
						FROM chat_messages m
						WHERE m.workspace_id = c.workspace_id
							AND m.channel_id = c.id
							AND m.channel_seq IS NOT NULL
							AND m.deleted_at IS NULL
							AND m.channel_seq > COALESCE(rs.last_read_seq, 0)
					),
					0
				)
			)::int AS "unreadCount",
			COALESCE(
				(
					SELECT count(*)::int
					FROM chat_channel_members cm
					WHERE cm.workspace_id = c.workspace_id AND cm.channel_id = c.id
				),
				0
			)::int AS "memberCount"
		FROM chat_channels c
		LEFT JOIN chat_channel_members me
			ON me.workspace_id = c.workspace_id
			AND me.channel_id = c.id
			AND me.principal_type = 'user'
			AND me.principal_id = ${args.userId}
		LEFT JOIN chat_read_state rs
			ON rs.workspace_id = c.workspace_id
			AND rs.channel_id = c.id
			AND rs.user_id = ${args.userId}
		WHERE c.workspace_id = ${args.workspaceId}
			AND c.archived_at IS NULL
			AND (
				(c.kind = 'dm' AND me.principal_id IS NOT NULL)
				OR (
					c.kind = 'private'
					AND (
						${args.bypassAcl}
						OR me.principal_id IS NOT NULL
						OR can_read(c.workspace_id, 'channel', c.id, ${args.userId}, 'read')
					)
				)
				OR (
					c.kind = 'public'
					AND (
						${args.isGuest} = false
						OR me.principal_id IS NOT NULL
						OR can_read(c.workspace_id, 'channel', c.id, ${args.userId}, 'read')
					)
				)
			)
		ORDER BY c.kind ASC, COALESCE(c.name, '') ASC, c.created_at ASC
	`
}

export async function getChannelByIdForUser(
	tx: Queryable,
	workspaceId: string,
	channelId: string,
	userId: string
): Promise<ChannelRecord | undefined> {
	const [row] = await tx<ChannelRecord[]>`
		SELECT
			c.id,
			c.workspace_id AS "workspaceId",
			c.kind,
			c.name,
			c.topic,
			c.dm_key AS "dmKey",
			c.canvas_page_id AS "canvasPageId",
			c.last_msg_seq::int AS "lastMsgSeq",
			c.last_rev::int AS "lastRev",
			c.created_by AS "createdBy",
			c.archived_at::text AS "archivedAt",
			c.created_at::text AS "createdAt",
			c.updated_at::text AS "updatedAt",
			c.version,
			(me.principal_id IS NOT NULL) AS "isMember",
			me.role AS "memberRole",
			COALESCE(rs.last_read_seq, 0)::int AS "lastReadSeq",
			COALESCE(rs.mention_count, 0)::int AS "mentionCount",
			COALESCE(rs.muted, false) AS muted,
			COALESCE(rs.notify_level, 'default') AS "notifyLevel",
			rs.muted_until::text AS "mutedUntil",
			LEAST(
				999,
				COALESCE(
					(
						SELECT count(*)::int
						FROM chat_messages m
						WHERE m.workspace_id = c.workspace_id
							AND m.channel_id = c.id
							AND m.channel_seq IS NOT NULL
							AND m.deleted_at IS NULL
							AND m.channel_seq > COALESCE(rs.last_read_seq, 0)
					),
					0
				)
			)::int AS "unreadCount",
			COALESCE(
				(
					SELECT count(*)::int
					FROM chat_channel_members cm
					WHERE cm.workspace_id = c.workspace_id AND cm.channel_id = c.id
				),
				0
			)::int AS "memberCount"
		FROM chat_channels c
		LEFT JOIN chat_channel_members me
			ON me.workspace_id = c.workspace_id
			AND me.channel_id = c.id
			AND me.principal_type = 'user'
			AND me.principal_id = ${userId}
		LEFT JOIN chat_read_state rs
			ON rs.workspace_id = c.workspace_id
			AND rs.channel_id = c.id
			AND rs.user_id = ${userId}
		WHERE c.workspace_id = ${workspaceId} AND c.id = ${channelId}
	`
	return row
}

export async function getChannelByName(
	tx: Queryable,
	workspaceId: string,
	name: string
): Promise<
	{ readonly id: string; readonly kind: ChatChannelKind; readonly archivedAt: string | null } | undefined
> {
	const [row] = await tx<
		{ readonly id: string; readonly kind: ChatChannelKind; readonly archivedAt: string | null }[]
	>`
		SELECT id, kind, archived_at::text AS "archivedAt"
		FROM chat_channels
		WHERE workspace_id = ${workspaceId} AND lower(name) = lower(${name})
	`
	return row
}

export async function getChannelByDmKey(
	tx: Queryable,
	workspaceId: string,
	dmKey: string
): Promise<{ readonly id: string } | undefined> {
	const [row] = await tx<{ readonly id: string }[]>`
		SELECT id
		FROM chat_channels
		WHERE workspace_id = ${workspaceId}
			AND dm_key = ${dmKey}
			AND archived_at IS NULL
	`
	return row
}

export async function insertChannelRow(
	tx: Queryable,
	args: {
		readonly workspaceId: string
		readonly kind: ChatChannelKind
		readonly name: string | null
		readonly topic: string
		readonly dmKey: string | null
		readonly createdBy: string
	}
): Promise<{ readonly id: string }> {
	const [row] = await tx<{ readonly id: string }[]>`
		INSERT INTO chat_channels (workspace_id, kind, name, topic, dm_key, created_by)
		VALUES (${args.workspaceId}, ${args.kind}, ${args.name}, ${args.topic}, ${args.dmKey}, ${args.createdBy})
		RETURNING id
	`
	if (!row) throw new Error('Failed to insert chat channel')
	return row
}

export async function updateChannelRow(
	tx: Queryable,
	args: {
		readonly workspaceId: string
		readonly channelId: string
		readonly expectedVersion: number
		readonly name: string | null
		readonly topic: string
		readonly archivedAt: string | null
	}
): Promise<{ readonly id: string; readonly version: number } | undefined> {
	const [row] = await tx<{ readonly id: string; readonly version: number }[]>`
		UPDATE chat_channels
		SET
			name = ${args.name},
			topic = ${args.topic},
			archived_at = ${args.archivedAt},
			version = version + 1
		WHERE workspace_id = ${args.workspaceId}
			AND id = ${args.channelId}
			AND version = ${args.expectedVersion}
		RETURNING id, version
	`
	return row
}

export async function listChannelMembersForChannels(
	tx: Queryable,
	workspaceId: string,
	channelIds: readonly string[]
): Promise<Map<string, ChatChannelMemberDto[]>> {
	const map = new Map<string, ChatChannelMemberDto[]>()
	if (channelIds.length === 0) return map
	const rows = await tx<
		{
			channelId: string
			principalType: 'user' | 'agent'
			principalId: string
			role: 'member' | 'admin'
			displayName: string | null
			email: string | null
			joinedAt: string
		}[]
	>`
		SELECT
			cm.channel_id AS "channelId",
			cm.principal_type AS "principalType",
			cm.principal_id AS "principalId",
			cm.role,
			COALESCE(u.display_name, ap.name) AS "displayName",
			u.email::text AS email,
			cm.joined_at::text AS "joinedAt"
		FROM chat_channel_members cm
		LEFT JOIN users u
			ON cm.principal_type = 'user' AND u.id = cm.principal_id
		LEFT JOIN agent_principals ap
			ON cm.principal_type = 'agent' AND ap.workspace_id = cm.workspace_id AND ap.id = cm.principal_id
		WHERE cm.workspace_id = ${workspaceId}
			AND cm.channel_id = ANY(${[...channelIds]}::uuid[])
		ORDER BY cm.joined_at ASC
	`
	for (const r of rows) {
		const list = map.get(r.channelId) ?? []
		list.push({
			channelId: r.channelId,
			principalType: r.principalType,
			principalId: r.principalId,
			role: r.role,
			...(r.displayName ? { displayName: r.displayName } : {}),
			...(r.email ? { email: r.email } : {}),
			joinedAt: r.joinedAt
		})
		map.set(r.channelId, list)
	}
	return map
}

export async function upsertChannelMember(
	tx: Queryable,
	args: {
		readonly workspaceId: string
		readonly channelId: string
		readonly principalType: 'user' | 'agent'
		readonly principalId: string
		readonly role: 'member' | 'admin'
	}
): Promise<ChatChannelMemberDto> {
	await tx`
		INSERT INTO chat_channel_members (workspace_id, channel_id, principal_type, principal_id, role)
		VALUES (${args.workspaceId}, ${args.channelId}, ${args.principalType}, ${args.principalId}, ${args.role})
		ON CONFLICT (workspace_id, channel_id, principal_type, principal_id) DO UPDATE
		SET role = EXCLUDED.role
	`
	const map = await listChannelMembersForChannels(tx, args.workspaceId, [args.channelId])
	const found = (map.get(args.channelId) ?? []).find(
		(m) => m.principalType === args.principalType && m.principalId === args.principalId
	)
	if (!found) throw new Error('Failed to load inserted channel member')
	return found
}

export async function removeChannelMemberRow(
	tx: Queryable,
	workspaceId: string,
	channelId: string,
	principalId: string
): Promise<boolean> {
	const deleted = await tx<{ principalId: string }[]>`
		DELETE FROM chat_channel_members
		WHERE workspace_id = ${workspaceId}
			AND channel_id = ${channelId}
			AND principal_id = ${principalId}
		RETURNING principal_id AS "principalId"
	`
	return deleted.length > 0
}

export async function filterActiveWorkspaceUserIds(
	tx: Queryable,
	workspaceId: string,
	userIds: readonly string[]
): Promise<string[]> {
	if (userIds.length === 0) return []
	const rows = await tx<{ userId: string }[]>`
		SELECT m.user_id AS "userId"
		FROM memberships m
		JOIN users u ON u.id = m.user_id AND u.deleted_at IS NULL
		WHERE m.workspace_id = ${workspaceId}
			AND m.status = 'active'
			AND m.user_id = ANY(${[...userIds]}::uuid[])
	`
	return rows.map((r) => r.userId)
}

export async function filterWorkspacePrincipalPairs(
	tx: Queryable,
	workspaceId: string,
	principals: readonly { readonly principalType: 'user' | 'agent'; readonly principalId: string }[]
): Promise<Set<string>> {
	const out = new Set<string>()
	const userIds = principals.filter((p) => p.principalType === 'user').map((p) => p.principalId)
	const agentIds = principals.filter((p) => p.principalType === 'agent').map((p) => p.principalId)
	for (const uid of await filterActiveWorkspaceUserIds(tx, workspaceId, userIds)) {
		out.add(`user:${uid}`)
	}
	if (agentIds.length > 0) {
		const rows = await tx<{ id: string }[]>`
			SELECT id FROM agent_principals
			WHERE workspace_id = ${workspaceId}
				AND revoked_at IS NULL
				AND id = ANY(${agentIds}::uuid[])
		`
		for (const r of rows) out.add(`agent:${r.id}`)
	}
	return out
}

// ---------- Sequence/Rev Allocation & Messages ----------

/**
 * Lock order (§15.1): ALWAYS lock `chat_channels` BEFORE parent `chat_messages`
 * to guarantee deadlock-free concurrent writes under message bursts.
 */
export async function allocateChannelSeqAndRev(
	tx: Queryable,
	workspaceId: string,
	channelId: string,
	incrementMsgSeq: boolean
): Promise<{ readonly lastMsgSeq: number; readonly lastRev: number }> {
	const [row] = await tx<{ lastMsgSeq: number; lastRev: number }[]>`
		UPDATE chat_channels
		SET
			last_msg_seq = last_msg_seq + (CASE WHEN ${incrementMsgSeq} THEN 1 ELSE 0 END),
			last_rev = last_rev + 1
		WHERE workspace_id = ${workspaceId} AND id = ${channelId}
		RETURNING last_msg_seq::int AS "lastMsgSeq", last_rev::int AS "lastRev"
	`
	if (!row) throw new Error('Channel disappeared during sequence allocation')
	return row
}

export async function allocateThreadSeq(
	tx: Queryable,
	workspaceId: string,
	channelId: string,
	threadParentId: string
): Promise<{ readonly threadSeq: number; readonly authorId: string } | undefined> {
	const [row] = await tx<{ threadSeq: number; authorId: string }[]>`
		UPDATE chat_messages
		SET last_thread_seq = last_thread_seq + 1
		WHERE workspace_id = ${workspaceId}
			AND id = ${threadParentId}
			AND channel_id = ${channelId}
			AND thread_parent_id IS NULL
			AND deleted_at IS NULL
		RETURNING last_thread_seq::int AS "threadSeq", author_id AS "authorId"
	`
	return row
}

const MESSAGE_SELECT = `
	m.id,
	m.workspace_id AS "workspaceId",
	m.channel_id AS "channelId",
	m.channel_seq::int AS "channelSeq",
	m.thread_seq::int AS "threadSeq",
	m.rev::int AS rev,
	m.author_type AS "authorType",
	m.author_id AS "authorId",
	COALESCE(u.display_name, ap.name) AS "authorDisplayName",
	m.thread_parent_id AS "threadParentId",
	m.broadcast_to_channel AS "broadcastToChannel",
	m.reply_to_message_id AS "replyToMessageId",
	m.message_kind AS "messageKind",
	m.metadata,
	m.reply_count AS "replyCount",
	m.last_reply_at::text AS "lastReplyAt",
	m.client_id AS "clientId",
	m.body,
	m.body_text AS "bodyText",
	m.edited_at::text AS "editedAt",
	m.deleted_at::text AS "deletedAt",
	m.created_at::text AS "createdAt",
	m.updated_at::text AS "updatedAt",
	m.version
`

export async function findMessageByClientId(
	tx: Queryable,
	workspaceId: string,
	channelId: string,
	authorId: string,
	clientId: string
): Promise<RawMessageRow | undefined> {
	const [row] = await tx<RawMessageRow[]>`
		SELECT ${tx.unsafe(MESSAGE_SELECT)}
		FROM chat_messages m
		LEFT JOIN users u ON m.author_type = 'user' AND u.id = m.author_id
		LEFT JOIN agent_principals ap
			ON m.author_type = 'agent' AND ap.workspace_id = m.workspace_id AND ap.id = m.author_id
		WHERE m.workspace_id = ${workspaceId}
			AND m.channel_id = ${channelId}
			AND m.author_id = ${authorId}
			AND m.client_id = ${clientId}
	`
	return row
}

export async function getRawMessageById(
	tx: Queryable,
	workspaceId: string,
	messageId: string
): Promise<RawMessageRow | undefined> {
	const [row] = await tx<RawMessageRow[]>`
		SELECT ${tx.unsafe(MESSAGE_SELECT)}
		FROM chat_messages m
		LEFT JOIN users u ON m.author_type = 'user' AND u.id = m.author_id
		LEFT JOIN agent_principals ap
			ON m.author_type = 'agent' AND ap.workspace_id = m.workspace_id AND ap.id = m.author_id
		WHERE m.workspace_id = ${workspaceId} AND m.id = ${messageId}
	`
	return row
}

export async function insertMessageRow(
	tx: Queryable,
	args: {
		readonly id?: string | undefined
		readonly workspaceId: string
		readonly channelId: string
		readonly channelSeq: number | null
		readonly threadSeq: number | null
		readonly rev: number
		readonly authorType: 'user' | 'agent'
		readonly authorId: string
		readonly threadParentId: string | null
		readonly broadcastToChannel: boolean
		readonly replyToMessageId: string | null
		readonly messageKind: 'text' | 'poll' | 'huddle_session' | 'approval_card' | 'system'
		readonly metadata: unknown
		readonly clientId: string | null
		readonly body: unknown
		readonly bodyText: string
	}
): Promise<RawMessageRow> {
	const [inserted] = args.id
		? await tx<{ id: string }[]>`
				INSERT INTO chat_messages (
					id, workspace_id, channel_id, channel_seq, thread_seq, rev,
					author_type, author_id, thread_parent_id, broadcast_to_channel, reply_to_message_id,
					message_kind, metadata, client_id, body, body_text
				)
				VALUES (
					${args.id}, ${args.workspaceId}, ${args.channelId}, ${args.channelSeq}, ${args.threadSeq},
					${args.rev}, ${args.authorType}, ${args.authorId}, ${args.threadParentId},
					${args.broadcastToChannel}, ${args.replyToMessageId}, ${args.messageKind},
					${tx.json((args.metadata ?? {}) as never)}, ${args.clientId}, ${tx.json((args.body ?? {}) as never)}, ${args.bodyText}
				)
				RETURNING id
			`
		: await tx<{ id: string }[]>`
				INSERT INTO chat_messages (
					workspace_id, channel_id, channel_seq, thread_seq, rev,
					author_type, author_id, thread_parent_id, broadcast_to_channel, reply_to_message_id,
					message_kind, metadata, client_id, body, body_text
				)
				VALUES (
					${args.workspaceId}, ${args.channelId}, ${args.channelSeq}, ${args.threadSeq},
					${args.rev}, ${args.authorType}, ${args.authorId}, ${args.threadParentId},
					${args.broadcastToChannel}, ${args.replyToMessageId}, ${args.messageKind},
					${tx.json((args.metadata ?? {}) as never)}, ${args.clientId}, ${tx.json((args.body ?? {}) as never)}, ${args.bodyText}
				)
				RETURNING id
			`
	if (!inserted) throw new Error('Failed to insert chat message')
	const row = await getRawMessageById(tx, args.workspaceId, inserted.id)
	if (!row) throw new Error('Inserted chat message disappeared')
	return row
}

export async function updateMessageRow(
	tx: Queryable,
	args: {
		readonly workspaceId: string
		readonly messageId: string
		readonly expectedVersion: number
		readonly nextRev: number
		readonly body: unknown
		readonly bodyText: string
	}
): Promise<RawMessageRow | undefined> {
	const [updated] = await tx<{ id: string }[]>`
		UPDATE chat_messages
		SET
			body = ${tx.json((args.body ?? {}) as never)},
			body_text = ${args.bodyText},
			rev = ${args.nextRev},
			edited_at = now(),
			version = version + 1
		WHERE workspace_id = ${args.workspaceId}
			AND id = ${args.messageId}
			AND version = ${args.expectedVersion}
			AND deleted_at IS NULL
		RETURNING id
	`
	if (!updated) return undefined
	return getRawMessageById(tx, args.workspaceId, updated.id)
}

export async function softDeleteMessageRow(
	tx: Queryable,
	args: {
		readonly workspaceId: string
		readonly messageId: string
		readonly nextRev: number
	}
): Promise<RawMessageRow | undefined> {
	const [updated] = await tx<{ id: string }[]>`
		UPDATE chat_messages
		SET
			body = '{}'::jsonb,
			body_text = '',
			rev = ${args.nextRev},
			deleted_at = COALESCE(deleted_at, now()),
			version = version + 1
		WHERE workspace_id = ${args.workspaceId} AND id = ${args.messageId}
		RETURNING id
	`
	if (!updated) return undefined
	return getRawMessageById(tx, args.workspaceId, updated.id)
}

export async function setMessageRev(
	tx: Queryable,
	workspaceId: string,
	messageId: string,
	rev: number
): Promise<void> {
	await tx`
		UPDATE chat_messages
		SET rev = ${rev}
		WHERE workspace_id = ${workspaceId} AND id = ${messageId}
	`
}

export async function listChannelMessageRows(
	tx: Queryable,
	args: {
		readonly workspaceId: string
		readonly channelId: string
		readonly beforeSeq?: number | undefined
		readonly limit: number
	}
): Promise<{ readonly rows: RawMessageRow[]; readonly hasMore: boolean }> {
	const fetched = await tx<RawMessageRow[]>`
		SELECT ${tx.unsafe(MESSAGE_SELECT)}
		FROM chat_messages m
		LEFT JOIN users u ON m.author_type = 'user' AND u.id = m.author_id
		LEFT JOIN agent_principals ap
			ON m.author_type = 'agent' AND ap.workspace_id = m.workspace_id AND ap.id = m.author_id
		WHERE m.workspace_id = ${args.workspaceId}
			AND m.channel_id = ${args.channelId}
			AND m.channel_seq IS NOT NULL
			AND m.deleted_at IS NULL
			${args.beforeSeq !== undefined ? tx`AND m.channel_seq < ${args.beforeSeq}` : tx``}
		ORDER BY m.channel_seq DESC
		LIMIT ${args.limit + 1}
	`
	const hasMore = fetched.length > args.limit
	const rows = fetched.slice(0, args.limit).reverse()
	return { rows, hasMore }
}

export async function listThreadReplyRows(
	tx: Queryable,
	workspaceId: string,
	threadParentId: string
): Promise<RawMessageRow[]> {
	return tx<RawMessageRow[]>`
		SELECT ${tx.unsafe(MESSAGE_SELECT)}
		FROM chat_messages m
		LEFT JOIN users u ON m.author_type = 'user' AND u.id = m.author_id
		LEFT JOIN agent_principals ap
			ON m.author_type = 'agent' AND ap.workspace_id = m.workspace_id AND ap.id = m.author_id
		WHERE m.workspace_id = ${workspaceId}
			AND m.thread_parent_id = ${threadParentId}
			AND m.deleted_at IS NULL
		ORDER BY m.thread_seq ASC
	`
}

export async function listChannelChangeRows(
	tx: Queryable,
	args: {
		readonly workspaceId: string
		readonly channelId: string
		readonly sinceRev: number
		readonly limit: number
	}
): Promise<{ readonly rows: RawMessageRow[]; readonly hasMore: boolean }> {
	const fetched = await tx<RawMessageRow[]>`
		SELECT ${tx.unsafe(MESSAGE_SELECT)}
		FROM chat_messages m
		LEFT JOIN users u ON m.author_type = 'user' AND u.id = m.author_id
		LEFT JOIN agent_principals ap
			ON m.author_type = 'agent' AND ap.workspace_id = m.workspace_id AND ap.id = m.author_id
		WHERE m.workspace_id = ${args.workspaceId}
			AND m.channel_id = ${args.channelId}
			AND m.rev > ${args.sinceRev}
		ORDER BY m.rev ASC
		LIMIT ${args.limit + 1}
	`
	const hasMore = fetched.length > args.limit
	return { rows: fetched.slice(0, args.limit), hasMore }
}

export async function addReactionRow(
	tx: Queryable,
	workspaceId: string,
	messageId: string,
	userId: string,
	emoji: string
): Promise<boolean> {
	const inserted = await tx<{ emoji: string }[]>`
		INSERT INTO chat_message_reactions (workspace_id, message_id, user_id, emoji)
		VALUES (${workspaceId}, ${messageId}, ${userId}, ${emoji})
		ON CONFLICT (workspace_id, message_id, user_id, emoji) DO NOTHING
		RETURNING emoji
	`
	return inserted.length > 0
}

export async function removeReactionRow(
	tx: Queryable,
	workspaceId: string,
	messageId: string,
	userId: string,
	emoji: string
): Promise<boolean> {
	const deleted = await tx<{ emoji: string }[]>`
		DELETE FROM chat_message_reactions
		WHERE workspace_id = ${workspaceId}
			AND message_id = ${messageId}
			AND user_id = ${userId}
			AND emoji = ${emoji}
		RETURNING emoji
	`
	return deleted.length > 0
}

export async function upsertMessageAttachments(
	tx: Queryable,
	workspaceId: string,
	messageId: string,
	fileIds: readonly string[]
): Promise<void> {
	for (let i = 0; i < fileIds.length; i++) {
		const fileId = fileIds[i]!
		await tx`
			INSERT INTO chat_message_attachments (workspace_id, message_id, file_id, position)
			VALUES (${workspaceId}, ${messageId}, ${fileId}, ${i})
			ON CONFLICT (workspace_id, message_id, file_id) DO NOTHING
		`
	}
}

export async function upsertPendingLinkPreview(
	tx: Queryable,
	workspaceId: string,
	url: string,
	urlHash: string
): Promise<{ readonly id: string; readonly needsFetch: boolean }> {
	const [existing] = await tx<
		{ readonly id: string; readonly status: string; readonly expiresAt: string | null }[]
	>`
		SELECT id, status, expires_at::text AS "expiresAt"
		FROM chat_link_previews
		WHERE workspace_id = ${workspaceId} AND url_hash = ${urlHash}
	`
	if (existing) {
		const expired = existing.expiresAt !== null && new Date(existing.expiresAt).getTime() <= Date.now()
		return { id: existing.id, needsFetch: existing.status === 'pending' || expired }
	}
	const [inserted] = await tx<{ readonly id: string }[]>`
		INSERT INTO chat_link_previews (workspace_id, url, url_hash, status)
		VALUES (${workspaceId}, ${url}, ${urlHash}, 'pending')
		ON CONFLICT (workspace_id, url_hash) DO UPDATE SET url = EXCLUDED.url
		RETURNING id
	`
	if (!inserted) throw new Error('Failed to upsert link preview')
	return { id: inserted.id, needsFetch: true }
}

export async function attachMessageLinkPreviews(
	tx: Queryable,
	workspaceId: string,
	messageId: string,
	previewIds: readonly string[]
): Promise<void> {
	for (let i = 0; i < previewIds.length; i++) {
		const previewId = previewIds[i]!
		await tx`
			INSERT INTO chat_message_link_previews (workspace_id, message_id, preview_id, position)
			VALUES (${workspaceId}, ${messageId}, ${previewId}, ${i})
			ON CONFLICT (workspace_id, message_id, preview_id) DO NOTHING
		`
	}
}

export async function getLinkPreviewByUrlHash(
	tx: Queryable,
	workspaceId: string,
	urlHash: string
): Promise<
	| {
			readonly id: string
			readonly url: string
			readonly status: string
			readonly expiresAt: string | null
	  }
	| undefined
> {
	const [row] = await tx<
		{
			readonly id: string
			readonly url: string
			readonly status: string
			readonly expiresAt: string | null
		}[]
	>`
		SELECT id, url, status, expires_at::text AS "expiresAt"
		FROM chat_link_previews
		WHERE workspace_id = ${workspaceId} AND url_hash = ${urlHash}
	`
	return row
}

export async function updateLinkPreviewResult(
	tx: Queryable,
	args: {
		readonly workspaceId: string
		readonly previewId: string
		readonly status: 'ok' | 'blocked' | 'failed'
		readonly canonicalUrl: string | null
		readonly title: string
		readonly description: string
		readonly siteName: string
		readonly imageUrl: string | null
		readonly errorDetail: string | null
		readonly ttlHours: number
	}
): Promise<void> {
	await tx`
		UPDATE chat_link_previews
		SET
			status = ${args.status},
			canonical_url = ${args.canonicalUrl},
			title = ${args.title},
			description = ${args.description},
			site_name = ${args.siteName},
			image_url = ${args.imageUrl},
			error_detail = ${args.errorDetail},
			fetched_at = now(),
			expires_at = now() + (${args.ttlHours} || ' hours')::interval
		WHERE workspace_id = ${args.workspaceId} AND id = ${args.previewId}
	`
}

export async function findChannelsAndMessagesForPreview(
	tx: Queryable,
	workspaceId: string,
	previewId: string
): Promise<{ readonly messageId: string; readonly channelId: string }[]> {
	return tx<{ messageId: string; channelId: string }[]>`
		SELECT mlp.message_id AS "messageId", m.channel_id AS "channelId"
		FROM chat_message_link_previews mlp
		JOIN chat_messages m
			ON m.workspace_id = mlp.workspace_id AND m.id = mlp.message_id
		WHERE mlp.workspace_id = ${workspaceId} AND mlp.preview_id = ${previewId}
	`
}

export async function hydrateRawMessages(
	tx: Queryable,
	workspaceId: string,
	viewerUserId: string,
	rows: readonly RawMessageRow[]
): Promise<ChatMessageDto[]> {
	if (rows.length === 0) return []
	const messageIds = rows.map((r) => r.id)

	const [reactionRows, attachmentRows, previewRows] = await Promise.all([
		tx<{ messageId: string; emoji: string; userId: string }[]>`
			SELECT message_id AS "messageId", emoji, user_id AS "userId"
			FROM chat_message_reactions
			WHERE workspace_id = ${workspaceId}
				AND message_id = ANY(${messageIds}::uuid[])
			ORDER BY created_at ASC
		`,
		tx<
			{
				messageId: string
				fileId: string
				filename: string
				contentType: string
				byteSize: number
				scanStatus: 'pending' | 'clean' | 'infected' | 'failed' | 'unscanned'
			}[]
		>`
			SELECT
				a.message_id AS "messageId",
				f.id AS "fileId",
				f.filename,
				f.content_type AS "contentType",
				f.byte_size AS "byteSize",
				f.scan_status AS "scanStatus"
			FROM chat_message_attachments a
			JOIN files f ON f.workspace_id = a.workspace_id AND f.id = a.file_id
			WHERE a.workspace_id = ${workspaceId}
				AND a.message_id = ANY(${messageIds}::uuid[])
			ORDER BY a.position ASC
		`,
		tx<
			{
				messageId: string
				id: string
				url: string
				canonicalUrl: string | null
				title: string
				description: string
				siteName: string
				imageUrl: string | null
				status: 'pending' | 'ok' | 'blocked' | 'failed'
			}[]
		>`
			SELECT
				mlp.message_id AS "messageId",
				lp.id,
				lp.url,
				lp.canonical_url AS "canonicalUrl",
				lp.title,
				lp.description,
				lp.site_name AS "siteName",
				lp.image_url AS "imageUrl",
				lp.status
			FROM chat_message_link_previews mlp
			JOIN chat_link_previews lp
				ON lp.workspace_id = mlp.workspace_id AND lp.id = mlp.preview_id
			WHERE mlp.workspace_id = ${workspaceId}
				AND mlp.message_id = ANY(${messageIds}::uuid[])
			ORDER BY mlp.position ASC
		`
	])

	const reactionsByMsg = new Map<string, ChatReactionSummaryDto[]>()
	const groupedEmoji = new Map<string, Map<string, string[]>>()
	for (const r of reactionRows) {
		let emojiMap = groupedEmoji.get(r.messageId)
		if (!emojiMap) {
			emojiMap = new Map()
			groupedEmoji.set(r.messageId, emojiMap)
		}
		const users = emojiMap.get(r.emoji) ?? []
		users.push(r.userId)
		emojiMap.set(r.emoji, users)
	}
	for (const [msgId, emojiMap] of groupedEmoji) {
		const summaries: ChatReactionSummaryDto[] = []
		for (const [emoji, userIds] of emojiMap) {
			summaries.push({
				emoji,
				count: userIds.length,
				reactedByMe: userIds.includes(viewerUserId),
				userIds
			})
		}
		reactionsByMsg.set(msgId, summaries)
	}

	const attachmentsByMsg = new Map<string, ChatAttachmentDto[]>()
	for (const a of attachmentRows) {
		const list = attachmentsByMsg.get(a.messageId) ?? []
		list.push({
			fileId: a.fileId,
			filename: a.filename,
			contentType: a.contentType,
			byteSize: a.byteSize,
			scanStatus: a.scanStatus,
			downloadUrl: `/api/v1/files/${a.fileId}/download`
		})
		attachmentsByMsg.set(a.messageId, list)
	}

	const previewsByMsg = new Map<string, ChatLinkPreviewDto[]>()
	for (const p of previewRows) {
		const list = previewsByMsg.get(p.messageId) ?? []
		list.push({
			id: p.id,
			url: p.url,
			canonicalUrl: p.canonicalUrl,
			title: p.title,
			description: p.description,
			siteName: p.siteName,
			imageUrl: p.imageUrl,
			status: p.status
		})
		previewsByMsg.set(p.messageId, list)
	}

	return rows.map((r) => ({
		id: r.id,
		workspaceId: r.workspaceId,
		channelId: r.channelId,
		channelSeq: r.channelSeq === null ? null : Number(r.channelSeq),
		threadSeq: r.threadSeq === null ? null : Number(r.threadSeq),
		rev: Number(r.rev),
		authorType: r.authorType,
		authorId: r.authorId,
		...(r.authorDisplayName ? { authorDisplayName: r.authorDisplayName } : {}),
		threadParentId: r.threadParentId,
		broadcastToChannel: r.broadcastToChannel,
		replyToMessageId: r.replyToMessageId,
		messageKind: r.messageKind,
		metadata: r.metadata,
		replyCount: Number(r.replyCount),
		lastReplyAt: r.lastReplyAt,
		clientId: r.clientId,
		body: r.body,
		bodyText: r.bodyText,
		reactions: reactionsByMsg.get(r.id) ?? [],
		attachments: attachmentsByMsg.get(r.id) ?? [],
		linkPreviews: previewsByMsg.get(r.id) ?? [],
		richLinks: [],
		editedAt: r.editedAt,
		deletedAt: r.deletedAt,
		createdAt: r.createdAt,
		updatedAt: r.updatedAt,
		version: r.version
	}))
}

// ---------- Read State, Mutes, Threads & Outbox ----------

export async function upsertChannelReadState(
	tx: Queryable,
	args: {
		readonly workspaceId: string
		readonly channelId: string
		readonly userId: string
		readonly seq: number
		readonly clearMentions: boolean
	}
): Promise<{ readonly lastReadSeq: number; readonly mentionCount: number; readonly muted: boolean }> {
	const [row] = await tx<{ lastReadSeq: number; mentionCount: number; muted: boolean }[]>`
		INSERT INTO chat_read_state (workspace_id, channel_id, user_id, last_read_seq, mention_count)
		VALUES (${args.workspaceId}, ${args.channelId}, ${args.userId}, ${args.seq}, 0)
		ON CONFLICT (workspace_id, channel_id, user_id) DO UPDATE
		SET
			last_read_seq = GREATEST(chat_read_state.last_read_seq, EXCLUDED.last_read_seq),
			mention_count = CASE WHEN ${args.clearMentions} THEN 0 ELSE chat_read_state.mention_count END
		RETURNING last_read_seq::int AS "lastReadSeq", mention_count AS "mentionCount", muted
	`
	if (!row) throw new Error('Failed to update chat read state')
	return row
}

export async function setChannelMutedState(
	tx: Queryable,
	workspaceId: string,
	channelId: string,
	userId: string,
	opts: {
		readonly muted: boolean
		readonly notifyLevel?: 'default' | 'all' | 'mentions' | 'none' | undefined
		readonly mutedUntil?: string | null | undefined
	}
): Promise<{
	readonly muted: boolean
	readonly notifyLevel: 'default' | 'all' | 'mentions' | 'none'
	readonly mutedUntil: string | null
}> {
	const notifyLevel = opts.notifyLevel ?? 'default'
	const mutedUntil = opts.mutedUntil ?? null
	const [row] = await tx<
		{
			muted: boolean
			notifyLevel: 'default' | 'all' | 'mentions' | 'none'
			mutedUntil: string | null
		}[]
	>`
		INSERT INTO chat_read_state (
			workspace_id, channel_id, user_id, last_read_seq, mention_count, muted, notify_level, muted_until
		)
		VALUES (${workspaceId}, ${channelId}, ${userId}, 0, 0, ${opts.muted}, ${notifyLevel}, ${mutedUntil})
		ON CONFLICT (workspace_id, channel_id, user_id) DO UPDATE
		SET
			muted = EXCLUDED.muted,
			notify_level = CASE WHEN ${opts.notifyLevel !== undefined} THEN EXCLUDED.notify_level ELSE chat_read_state.notify_level END,
			muted_until = CASE WHEN ${opts.mutedUntil !== undefined} THEN EXCLUDED.muted_until ELSE chat_read_state.muted_until END
		RETURNING muted, notify_level AS "notifyLevel", muted_until::text AS "mutedUntil"
	`
	if (!row) throw new Error('Failed to update channel mute state')
	return row
}

export async function getChannelSeqAndRev(
	tx: Queryable,
	workspaceId: string,
	channelId: string
): Promise<{ readonly lastMsgSeq: number; readonly lastRev: number } | undefined> {
	const [row] = await tx<{ lastMsgSeq: number; lastRev: number }[]>`
		SELECT last_msg_seq::int AS "lastMsgSeq", last_rev::int AS "lastRev"
		FROM chat_channels
		WHERE workspace_id = ${workspaceId} AND id = ${channelId}
	`
	return row
}

export async function incrementChannelMentionCountRow(
	tx: Queryable,
	workspaceId: string,
	channelId: string,
	userId: string
): Promise<void> {
	await tx`
		INSERT INTO chat_read_state (workspace_id, channel_id, user_id, last_read_seq, mention_count)
		VALUES (${workspaceId}, ${channelId}, ${userId}, 0, 1)
		ON CONFLICT (workspace_id, channel_id, user_id) DO UPDATE
		SET mention_count = chat_read_state.mention_count + 1
	`
}

export async function upsertThreadReadState(
	tx: Queryable,
	args: {
		readonly workspaceId: string
		readonly channelId: string
		readonly threadParentId: string
		readonly userId: string
		readonly lastReadThreadSeq: number
	}
): Promise<void> {
	await tx`
		INSERT INTO chat_thread_read_state (
			workspace_id, channel_id, thread_parent_id, user_id, last_read_thread_seq, subscribed
		)
		VALUES (
			${args.workspaceId}, ${args.channelId}, ${args.threadParentId}, ${args.userId},
			${args.lastReadThreadSeq}, true
		)
		ON CONFLICT (workspace_id, thread_parent_id, user_id) DO UPDATE
		SET last_read_thread_seq = GREATEST(
			chat_thread_read_state.last_read_thread_seq,
			EXCLUDED.last_read_thread_seq
		)
	`
}

export async function listSubscribedThreadParents(
	tx: Queryable,
	workspaceId: string,
	userId: string,
	isGuest: boolean,
	bypassAcl: boolean
): Promise<
	{
		readonly parent: RawMessageRow
		readonly channelId: string
		readonly channelName: string | null
		readonly channelKind: ChatChannelKind
		readonly lastReadThreadSeq: number
	}[]
> {
	const rows = await tx<
		(RawMessageRow & {
			readonly channelName: string | null
			readonly channelKind: ChatChannelKind
			readonly lastReadThreadSeq: number
		})[]
	>`
		SELECT
			${tx.unsafe(MESSAGE_SELECT)},
			c.name AS "channelName",
			c.kind AS "channelKind",
			COALESCE(trs.last_read_thread_seq, 0)::int AS "lastReadThreadSeq"
		FROM chat_thread_read_state trs
		JOIN chat_messages m
			ON m.workspace_id = trs.workspace_id AND m.id = trs.thread_parent_id AND m.deleted_at IS NULL
		JOIN chat_channels c
			ON c.workspace_id = m.workspace_id AND c.id = m.channel_id AND c.archived_at IS NULL
		LEFT JOIN users u ON m.author_type = 'user' AND u.id = m.author_id
		LEFT JOIN agent_principals ap
			ON m.author_type = 'agent' AND ap.workspace_id = m.workspace_id AND ap.id = m.author_id
		LEFT JOIN chat_channel_members me
			ON me.workspace_id = c.workspace_id
			AND me.channel_id = c.id
			AND me.principal_type = 'user'
			AND me.principal_id = ${userId}
		WHERE trs.workspace_id = ${workspaceId}
			AND trs.user_id = ${userId}
			AND trs.subscribed = true
			AND m.reply_count > 0
			AND (
				(c.kind = 'dm' AND me.principal_id IS NOT NULL)
				OR (
					c.kind = 'private'
					AND (
						${bypassAcl}
						OR me.principal_id IS NOT NULL
						OR can_read(c.workspace_id, 'channel', c.id, ${userId}, 'read')
					)
				)
				OR (
					c.kind = 'public'
					AND (
						${isGuest} = false
						OR me.principal_id IS NOT NULL
						OR can_read(c.workspace_id, 'channel', c.id, ${userId}, 'read')
					)
				)
			)
		ORDER BY m.last_reply_at DESC NULLS LAST, m.created_at DESC
		LIMIT 50
	`
	return rows.map((r) => ({
		parent: r,
		channelId: r.channelId,
		channelName: r.channelName,
		channelKind: r.channelKind,
		lastReadThreadSeq: Number(r.lastReadThreadSeq)
	}))
}

export async function getChannelNotificationContextRows(
	tx: Queryable,
	workspaceId: string,
	channelId: string,
	threadParentId?: string | null
): Promise<{
	readonly channelKind: ChatChannelKind
	readonly channelName: string | null
	readonly candidateUserIds: string[]
	readonly mutedUserIds: string[]
	readonly threadSubscriberIds: string[]
	readonly threadParentAuthorId: string | null
} | null> {
	const [channel] = await tx<{ kind: ChatChannelKind; name: string | null }[]>`
		SELECT kind, name FROM chat_channels
		WHERE workspace_id = ${workspaceId} AND id = ${channelId} AND archived_at IS NULL
	`
	if (!channel) return null

	let candidateUserIds: string[]
	if (channel.kind === 'public') {
		const members = await tx<{ userId: string }[]>`
			SELECT m.user_id AS "userId"
			FROM memberships m
			JOIN roles r ON r.workspace_id = m.workspace_id AND r.id = m.role_id
			WHERE m.workspace_id = ${workspaceId}
				AND m.status = 'active'
				AND (
					r.key <> 'guest'
					OR EXISTS (
						SELECT 1 FROM chat_channel_members cm
						WHERE cm.workspace_id = ${workspaceId}
							AND cm.channel_id = ${channelId}
							AND cm.principal_type = 'user'
							AND cm.principal_id = m.user_id
					)
					OR can_read(${workspaceId}, 'channel', ${channelId}, m.user_id, 'read')
				)
		`
		candidateUserIds = members.map((r) => r.userId)
	} else {
		const members = await tx<{ userId: string }[]>`
			SELECT cm.principal_id AS "userId"
			FROM chat_channel_members cm
			JOIN memberships m
				ON m.workspace_id = cm.workspace_id AND m.user_id = cm.principal_id AND m.status = 'active'
			WHERE cm.workspace_id = ${workspaceId}
				AND cm.channel_id = ${channelId}
				AND cm.principal_type = 'user'
		`
		candidateUserIds = members.map((r) => r.userId)
	}

	const mutedRows = await tx<{ userId: string }[]>`
		SELECT user_id AS "userId"
		FROM chat_read_state
		WHERE workspace_id = ${workspaceId}
			AND channel_id = ${channelId}
			AND muted = true
	`

	let threadSubscriberIds: string[] = []
	let threadParentAuthorId: string | null = null
	if (threadParentId) {
		const [parent] = await tx<{ authorType: string; authorId: string }[]>`
			SELECT author_type AS "authorType", author_id AS "authorId"
			FROM chat_messages
			WHERE workspace_id = ${workspaceId} AND id = ${threadParentId}
		`
		if (parent?.authorType === 'user') threadParentAuthorId = parent.authorId
		const subs = await tx<{ userId: string }[]>`
			SELECT user_id AS "userId"
			FROM chat_thread_read_state
			WHERE workspace_id = ${workspaceId}
				AND thread_parent_id = ${threadParentId}
				AND subscribed = true
		`
		threadSubscriberIds = subs.map((r) => r.userId)
	}

	return {
		channelKind: channel.kind,
		channelName: channel.name,
		candidateUserIds,
		mutedUserIds: mutedRows.map((r) => r.userId),
		threadSubscriberIds,
		threadParentAuthorId
	}
}

export async function emitChatEvent(
	tx: Queryable,
	args: {
		readonly workspaceId: string
		readonly aggregate: string
		readonly aggregateId: string
		readonly eventType: string
		readonly payload: Record<string, unknown>
	}
): Promise<void> {
	await tx`
		INSERT INTO outbox (workspace_id, aggregate, aggregate_id, event_type, payload)
		VALUES (${args.workspaceId}, ${args.aggregate}, ${args.aggregateId}, ${args.eventType}, ${tx.json(args.payload as never)})
	`
}

export async function auditChatAction(
	tx: Queryable,
	args: {
		readonly workspaceId: string
		readonly actorType: 'user' | 'agent' | 'system'
		readonly actorId: string
		readonly action: string
		readonly targetType: string
		readonly targetId: string
		readonly metadata?: Record<string, unknown>
	}
): Promise<void> {
	await tx`
		INSERT INTO audit_log (workspace_id, actor_type, actor_id, action, target_type, target_id, metadata)
		VALUES (
			${args.workspaceId},
			${args.actorType},
			${args.actorId},
			${args.action},
			${args.targetType},
			${args.targetId},
			${tx.json((args.metadata ?? {}) as never)}
		)
	`
}
