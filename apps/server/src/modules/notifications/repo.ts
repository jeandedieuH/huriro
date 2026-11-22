import type { NotificationDto, NotificationKind } from '@huriro/contracts'
import type { Queryable } from '@huriro/db'

export async function claimNotificationOutboxEvent(
	tx: Queryable,
	consumer: string,
	eventId: string
): Promise<boolean> {
	const rows = await tx<{ eventId: string }[]>`
		INSERT INTO processed_events (consumer, event_id)
		VALUES (${consumer}, ${eventId})
		ON CONFLICT (consumer, event_id) DO NOTHING
		RETURNING event_id AS "eventId"
	`
	return rows.length > 0
}

export async function insertNotificationRow(
	tx: Queryable,
	args: {
		readonly workspaceId: string
		readonly recipientUserId: string
		readonly actorType: 'user' | 'agent' | 'system'
		readonly actorId: string | null
		readonly kind: NotificationKind
		readonly entityType: string
		readonly entityId: string
		readonly title: string
		readonly body: string
		readonly metadata: Record<string, unknown>
	}
): Promise<NotificationDto> {
	const [row] = await tx<NotificationDto[]>`
		INSERT INTO notifications (
			workspace_id, recipient_user_id, actor_type, actor_id,
			kind, entity_type, entity_id, title, body, metadata
		)
		VALUES (
			${args.workspaceId},
			${args.recipientUserId},
			${args.actorType},
			${args.actorId},
			${args.kind},
			${args.entityType},
			${args.entityId},
			${args.title},
			${args.body},
			${tx.json(args.metadata as never)}
		)
		RETURNING
			id,
			workspace_id AS "workspaceId",
			recipient_user_id AS "recipientUserId",
			actor_type AS "actorType",
			actor_id AS "actorId",
			kind,
			entity_type AS "entityType",
			entity_id AS "entityId",
			title,
			body,
			metadata,
			read_at::text AS "readAt",
			archived_at::text AS "archivedAt",
			created_at::text AS "createdAt"
	`
	if (!row) throw new Error('Failed to insert notification')
	return row
}

export async function resolveWorkspaceUserIdsByHandles(
	tx: Queryable,
	workspaceId: string,
	handles: readonly string[]
): Promise<string[]> {
	if (handles.length === 0) return []
	const lower = handles.map((h) => h.toLowerCase())
	const rows = await tx<{ userId: string }[]>`
		SELECT DISTINCT m.user_id AS "userId"
		FROM memberships m
		JOIN users u ON u.id = m.user_id AND u.deleted_at IS NULL
		WHERE m.workspace_id = ${workspaceId}
			AND m.status = 'active'
			AND (
				lower(u.email::text) = ANY(${lower}::text[])
				OR lower(split_part(u.email::text, '@', 1)) = ANY(${lower}::text[])
				OR lower(replace(u.display_name, ' ', '')) = ANY(${lower}::text[])
			)
	`
	return rows.map((r) => r.userId)
}

export async function listNotificationsForUser(
	tx: Queryable,
	args: {
		readonly workspaceId: string
		readonly userId: string
		readonly unreadOnly: boolean
		readonly cursorPos?: { readonly createdAt: string; readonly id: string } | undefined
		readonly limit: number
	}
): Promise<{ readonly items: NotificationDto[]; readonly unreadCount: number; readonly hasMore: boolean }> {
	const [countRow] = await tx<{ n: number }[]>`
		SELECT count(*)::int AS n
		FROM notifications
		WHERE workspace_id = ${args.workspaceId}
			AND recipient_user_id = ${args.userId}
			AND read_at IS NULL
			AND archived_at IS NULL
	`
	const rows = await tx<NotificationDto[]>`
		SELECT
			id,
			workspace_id AS "workspaceId",
			recipient_user_id AS "recipientUserId",
			actor_type AS "actorType",
			actor_id AS "actorId",
			kind,
			entity_type AS "entityType",
			entity_id AS "entityId",
			title,
			body,
			metadata,
			read_at::text AS "readAt",
			archived_at::text AS "archivedAt",
			created_at::text AS "createdAt"
		FROM notifications
		WHERE workspace_id = ${args.workspaceId}
			AND recipient_user_id = ${args.userId}
			AND archived_at IS NULL
			${args.unreadOnly ? tx`AND read_at IS NULL` : tx``}
			${
				args.cursorPos
					? tx`AND (created_at, id) < (${args.cursorPos.createdAt}::timestamptz, ${args.cursorPos.id}::uuid)`
					: tx``
			}
		ORDER BY created_at DESC, id DESC
		LIMIT ${args.limit + 1}
	`
	const hasMore = rows.length > args.limit
	return {
		items: hasMore ? rows.slice(0, args.limit) : rows,
		unreadCount: countRow?.n ?? 0,
		hasMore
	}
}

export async function markNotificationReadRow(
	tx: Queryable,
	workspaceId: string,
	userId: string,
	notificationId: string
): Promise<NotificationDto | null> {
	const [row] = await tx<NotificationDto[]>`
		UPDATE notifications
		SET read_at = COALESCE(read_at, now())
		WHERE workspace_id = ${workspaceId}
			AND recipient_user_id = ${userId}
			AND id = ${notificationId}
		RETURNING
			id, workspace_id AS "workspaceId", recipient_user_id AS "recipientUserId",
			actor_type AS "actorType", actor_id AS "actorId", kind,
			entity_type AS "entityType", entity_id AS "entityId", title, body, metadata,
			read_at::text AS "readAt", archived_at::text AS "archivedAt", created_at::text AS "createdAt"
	`
	return row ?? null
}

export async function markAllNotificationsReadRows(
	tx: Queryable,
	workspaceId: string,
	userId: string
): Promise<NotificationDto[]> {
	return tx<NotificationDto[]>`
		UPDATE notifications
		SET read_at = now()
		WHERE workspace_id = ${workspaceId}
			AND recipient_user_id = ${userId}
			AND read_at IS NULL
			AND archived_at IS NULL
		RETURNING
			id, workspace_id AS "workspaceId", recipient_user_id AS "recipientUserId",
			actor_type AS "actorType", actor_id AS "actorId", kind,
			entity_type AS "entityType", entity_id AS "entityId", title, body, metadata,
			read_at::text AS "readAt", archived_at::text AS "archivedAt", created_at::text AS "createdAt"
	`
}

export async function archiveNotificationRow(
	tx: Queryable,
	workspaceId: string,
	userId: string,
	notificationId: string
): Promise<NotificationDto | null> {
	const [row] = await tx<NotificationDto[]>`
		UPDATE notifications
		SET archived_at = COALESCE(archived_at, now())
		WHERE workspace_id = ${workspaceId}
			AND recipient_user_id = ${userId}
			AND id = ${notificationId}
		RETURNING
			id, workspace_id AS "workspaceId", recipient_user_id AS "recipientUserId",
			actor_type AS "actorType", actor_id AS "actorId", kind,
			entity_type AS "entityType", entity_id AS "entityId", title, body, metadata,
			read_at::text AS "readAt", archived_at::text AS "archivedAt", created_at::text AS "createdAt"
	`
	return row ?? null
}
