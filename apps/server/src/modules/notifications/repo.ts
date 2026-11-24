import type {
	ChatNotificationLevel,
	EmailDigestFrequency,
	MobilePushPlatform,
	MobilePushTokenDto,
	NotificationDeliveryLogDto,
	NotificationDto,
	NotificationKind,
	NotificationPreferencesDto,
	WebPushSubscriptionDto
} from '@huriro/contracts'
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

export async function findCollapsibleUnreadNotification(
	tx: Queryable,
	args: {
		readonly workspaceId: string
		readonly recipientUserId: string
		readonly kind: NotificationKind
		readonly entityType: string
		readonly entityId: string
		readonly withinMinutes?: number
	}
): Promise<NotificationDto | null> {
	const mins = args.withinMinutes ?? 5
	const [row] = await tx<NotificationDto[]>`
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
			AND recipient_user_id = ${args.recipientUserId}
			AND kind = ${args.kind}
			AND entity_type = ${args.entityType}
			AND entity_id = ${args.entityId}
			AND read_at IS NULL
			AND archived_at IS NULL
			AND created_at >= now() - (${mins} || ' minutes')::interval
		ORDER BY created_at DESC
		LIMIT 1
	`
	return row ?? null
}

export async function updateCollapsedNotificationRow(
	tx: Queryable,
	args: {
		readonly workspaceId: string
		readonly id: string
		readonly title: string
		readonly body: string
		readonly metadata: Record<string, unknown>
	}
): Promise<NotificationDto> {
	const [row] = await tx<NotificationDto[]>`
		UPDATE notifications
		SET
			title = ${args.title},
			body = ${args.body},
			metadata = ${tx.json(args.metadata as never)}
		WHERE workspace_id = ${args.workspaceId} AND id = ${args.id}
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
	if (!row) throw new Error('Failed to update collapsed notification')
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

// ---------- Preferences, Delivery Log & Web Push (§15.2) ----------

export function defaultPreferencesDto(workspaceId: string, userId: string): NotificationPreferencesDto {
	return {
		workspaceId,
		userId,
		chatLevel: 'mentions',
		emailDigestFrequency: 'off',
		quietHoursStart: null,
		quietHoursEnd: null,
		timezone: 'UTC',
		webPushEnabled: false,
		mobilePushEnabled: true,
		lastDigestSentAt: null,
		updatedAt: new Date(0).toISOString()
	}
}

export async function getOrDefaultNotificationPreferences(
	tx: Queryable,
	workspaceId: string,
	userId: string
): Promise<NotificationPreferencesDto> {
	const [row] = await tx<NotificationPreferencesDto[]>`
		SELECT
			workspace_id AS "workspaceId",
			user_id AS "userId",
			chat_level AS "chatLevel",
			email_digest_frequency AS "emailDigestFrequency",
			quiet_hours_start AS "quietHoursStart",
			quiet_hours_end AS "quietHoursEnd",
			timezone,
			web_push_enabled AS "webPushEnabled",
			mobile_push_enabled AS "mobilePushEnabled",
			last_digest_sent_at::text AS "lastDigestSentAt",
			updated_at::text AS "updatedAt"
		FROM notification_preferences
		WHERE workspace_id = ${workspaceId} AND user_id = ${userId}
	`
	return row ?? defaultPreferencesDto(workspaceId, userId)
}

export async function getNotificationPreferencesMap(
	tx: Queryable,
	workspaceId: string,
	userIds: readonly string[]
): Promise<Map<string, NotificationPreferencesDto>> {
	const map = new Map<string, NotificationPreferencesDto>()
	if (userIds.length === 0) return map
	const rows = await tx<NotificationPreferencesDto[]>`
		SELECT
			workspace_id AS "workspaceId",
			user_id AS "userId",
			chat_level AS "chatLevel",
			email_digest_frequency AS "emailDigestFrequency",
			quiet_hours_start AS "quietHoursStart",
			quiet_hours_end AS "quietHoursEnd",
			timezone,
			web_push_enabled AS "webPushEnabled",
			mobile_push_enabled AS "mobilePushEnabled",
			last_digest_sent_at::text AS "lastDigestSentAt",
			updated_at::text AS "updatedAt"
		FROM notification_preferences
		WHERE workspace_id = ${workspaceId}
			AND user_id = ANY(${[...userIds]}::uuid[])
	`
	for (const r of rows) map.set(r.userId, r)
	for (const uid of userIds) {
		if (!map.has(uid)) map.set(uid, defaultPreferencesDto(workspaceId, uid))
	}
	return map
}

export async function upsertNotificationPreferences(
	tx: Queryable,
	workspaceId: string,
	userId: string,
	patch: {
		readonly chatLevel?: ChatNotificationLevel | undefined
		readonly emailDigestFrequency?: EmailDigestFrequency | undefined
		readonly quietHoursStart?: string | null | undefined
		readonly quietHoursEnd?: string | null | undefined
		readonly timezone?: string | undefined
		readonly webPushEnabled?: boolean | undefined
		readonly mobilePushEnabled?: boolean | undefined
	}
): Promise<NotificationPreferencesDto> {
	const current = await getOrDefaultNotificationPreferences(tx, workspaceId, userId)
	const nextChatLevel = patch.chatLevel ?? current.chatLevel
	const nextDigest = patch.emailDigestFrequency ?? current.emailDigestFrequency
	const nextStart = patch.quietHoursStart !== undefined ? patch.quietHoursStart : current.quietHoursStart
	const nextEnd = patch.quietHoursEnd !== undefined ? patch.quietHoursEnd : current.quietHoursEnd
	const nextTz = patch.timezone ?? current.timezone
	const nextPush = patch.webPushEnabled ?? current.webPushEnabled
	const nextMobilePush = patch.mobilePushEnabled ?? current.mobilePushEnabled

	const [row] = await tx<NotificationPreferencesDto[]>`
		INSERT INTO notification_preferences (
			workspace_id, user_id, chat_level, email_digest_frequency,
			quiet_hours_start, quiet_hours_end, timezone, web_push_enabled, mobile_push_enabled
		)
		VALUES (
			${workspaceId}, ${userId}, ${nextChatLevel}, ${nextDigest},
			${nextStart}, ${nextEnd}, ${nextTz}, ${nextPush}, ${nextMobilePush}
		)
		ON CONFLICT (workspace_id, user_id) DO UPDATE
		SET
			chat_level = EXCLUDED.chat_level,
			email_digest_frequency = EXCLUDED.email_digest_frequency,
			quiet_hours_start = EXCLUDED.quiet_hours_start,
			quiet_hours_end = EXCLUDED.quiet_hours_end,
			timezone = EXCLUDED.timezone,
			web_push_enabled = EXCLUDED.web_push_enabled,
			mobile_push_enabled = EXCLUDED.mobile_push_enabled
		RETURNING
			workspace_id AS "workspaceId",
			user_id AS "userId",
			chat_level AS "chatLevel",
			email_digest_frequency AS "emailDigestFrequency",
			quiet_hours_start AS "quietHoursStart",
			quiet_hours_end AS "quietHoursEnd",
			timezone,
			web_push_enabled AS "webPushEnabled",
			mobile_push_enabled AS "mobilePushEnabled",
			last_digest_sent_at::text AS "lastDigestSentAt",
			updated_at::text AS "updatedAt"
	`
	if (!row) throw new Error('Failed to save notification preferences')
	return row
}

export async function insertNotificationDeliveryLog(
	tx: Queryable,
	args: {
		readonly workspaceId: string
		readonly notificationId: string | null
		readonly userId: string
		readonly channel: 'in_app' | 'email_digest' | 'web_push' | 'mobile_push'
		readonly status: 'pending' | 'sent' | 'skipped_quiet_hours' | 'failed'
		readonly dedupeKey?: string | null | undefined
		readonly detail?: string | null | undefined
	}
): Promise<NotificationDeliveryLogDto> {
	const [row] = await tx<NotificationDeliveryLogDto[]>`
		INSERT INTO notification_delivery_log (
			workspace_id, notification_id, user_id, channel, status, dedupe_key, detail
		)
		VALUES (
			${args.workspaceId}, ${args.notificationId}, ${args.userId},
			${args.channel}, ${args.status}, ${args.dedupeKey ?? null}, ${args.detail ?? null}
		)
		RETURNING
			id,
			workspace_id AS "workspaceId",
			notification_id AS "notificationId",
			user_id AS "userId",
			channel,
			status,
			dedupe_key AS "dedupeKey",
			detail,
			created_at::text AS "createdAt"
	`
	if (!row) throw new Error('Failed to write notification delivery log')
	return row
}

export async function listNotificationDeliveryLogs(
	tx: Queryable,
	workspaceId: string,
	userId: string,
	limit = 50
): Promise<NotificationDeliveryLogDto[]> {
	return tx<NotificationDeliveryLogDto[]>`
		SELECT
			id,
			workspace_id AS "workspaceId",
			notification_id AS "notificationId",
			user_id AS "userId",
			channel,
			status,
			dedupe_key AS "dedupeKey",
			detail,
			created_at::text AS "createdAt"
		FROM notification_delivery_log
		WHERE workspace_id = ${workspaceId} AND user_id = ${userId}
		ORDER BY created_at DESC
		LIMIT ${limit}
	`
}

export interface WebPushSubscriptionSecretRow {
	readonly id: string
	readonly workspaceId: string
	readonly userId: string
	readonly endpoint: string
	readonly p256dh: string
	readonly authSecret: string
	readonly userAgent: string
	readonly lastUsedAt: string | null
	readonly revokedAt: string | null
	readonly createdAt: string
}

export async function upsertWebPushSubscription(
	tx: Queryable,
	args: {
		readonly workspaceId: string
		readonly userId: string
		readonly endpoint: string
		readonly p256dh: string
		readonly authSecret: string
		readonly userAgent: string
	}
): Promise<WebPushSubscriptionDto> {
	const [row] = await tx<WebPushSubscriptionDto[]>`
		INSERT INTO web_push_subscriptions (
			workspace_id, user_id, endpoint, p256dh, auth_secret, user_agent, revoked_at
		)
		VALUES (
			${args.workspaceId}, ${args.userId}, ${args.endpoint},
			${args.p256dh}, ${args.authSecret}, ${args.userAgent}, NULL
		)
		ON CONFLICT (workspace_id, user_id, endpoint) DO UPDATE
		SET
			p256dh = EXCLUDED.p256dh,
			auth_secret = EXCLUDED.auth_secret,
			user_agent = EXCLUDED.user_agent,
			revoked_at = NULL
		RETURNING
			id,
			workspace_id AS "workspaceId",
			user_id AS "userId",
			endpoint,
			user_agent AS "userAgent",
			last_used_at::text AS "lastUsedAt",
			revoked_at::text AS "revokedAt",
			created_at::text AS "createdAt"
	`
	if (!row) throw new Error('Failed to save web push subscription')
	return row
}

export async function listWebPushSubscriptionsForUser(
	tx: Queryable,
	workspaceId: string,
	userId: string
): Promise<WebPushSubscriptionDto[]> {
	return tx<WebPushSubscriptionDto[]>`
		SELECT
			id,
			workspace_id AS "workspaceId",
			user_id AS "userId",
			endpoint,
			user_agent AS "userAgent",
			last_used_at::text AS "lastUsedAt",
			revoked_at::text AS "revokedAt",
			created_at::text AS "createdAt"
		FROM web_push_subscriptions
		WHERE workspace_id = ${workspaceId}
			AND user_id = ${userId}
			AND revoked_at IS NULL
		ORDER BY created_at DESC
	`
}

export async function listActiveWebPushSubscriptionSecretsForUser(
	tx: Queryable,
	workspaceId: string,
	userId: string
): Promise<WebPushSubscriptionSecretRow[]> {
	return tx<WebPushSubscriptionSecretRow[]>`
		SELECT
			id,
			workspace_id AS "workspaceId",
			user_id AS "userId",
			endpoint,
			p256dh,
			auth_secret AS "authSecret",
			user_agent AS "userAgent",
			last_used_at::text AS "lastUsedAt",
			revoked_at::text AS "revokedAt",
			created_at::text AS "createdAt"
		FROM web_push_subscriptions
		WHERE workspace_id = ${workspaceId}
			AND user_id = ${userId}
			AND revoked_at IS NULL
	`
}

export async function revokeWebPushSubscriptionById(
	tx: Queryable,
	workspaceId: string,
	subscriptionId: string,
	userId?: string
): Promise<boolean> {
	const rows = await tx<{ id: string }[]>`
		UPDATE web_push_subscriptions
		SET revoked_at = COALESCE(revoked_at, now())
		WHERE workspace_id = ${workspaceId}
			AND id = ${subscriptionId}
			${userId ? tx`AND user_id = ${userId}` : tx``}
		RETURNING id
	`
	return rows.length > 0
}

export async function touchWebPushSubscription(
	tx: Queryable,
	workspaceId: string,
	subscriptionId: string
): Promise<void> {
	await tx`
		UPDATE web_push_subscriptions
		SET last_used_at = now()
		WHERE workspace_id = ${workspaceId} AND id = ${subscriptionId}
	`
}

export interface DigestCandidateRow {
	readonly userId: string
	readonly email: string
	readonly displayName: string
	readonly emailDigestFrequency: 'hourly' | 'daily'
	readonly quietHoursStart: string | null
	readonly quietHoursEnd: string | null
	readonly timezone: string
	readonly lastDigestSentAt: string | null
}

export async function listUsersDueForEmailDigest(
	tx: Queryable,
	workspaceId: string
): Promise<DigestCandidateRow[]> {
	return tx<DigestCandidateRow[]>`
		SELECT
			user_id AS "userId",
			email,
			display_name AS "displayName",
			email_digest_frequency AS "emailDigestFrequency",
			quiet_hours_start AS "quietHoursStart",
			quiet_hours_end AS "quietHoursEnd",
			timezone,
			last_digest_sent_at::text AS "lastDigestSentAt"
		FROM list_email_digest_candidates_for_workspace(${workspaceId})
	`
}

export async function listUnreadNotificationsSince(
	tx: Queryable,
	workspaceId: string,
	userId: string,
	sinceIso: string
): Promise<NotificationDto[]> {
	return tx<NotificationDto[]>`
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
		WHERE workspace_id = ${workspaceId}
			AND recipient_user_id = ${userId}
			AND read_at IS NULL
			AND archived_at IS NULL
			AND created_at > ${sinceIso}::timestamptz
		ORDER BY created_at DESC
		LIMIT 50
	`
}

export async function markDigestSent(tx: Queryable, workspaceId: string, userId: string): Promise<void> {
	await tx`
		UPDATE notification_preferences
		SET last_digest_sent_at = now()
		WHERE workspace_id = ${workspaceId} AND user_id = ${userId}
	`
}

// ---------- Mobile push tokens (§18.3) ----------

export async function upsertMobilePushToken(
	tx: Queryable,
	args: {
		readonly workspaceId: string
		readonly userId: string
		readonly token: string
		readonly platform: MobilePushPlatform
		readonly deviceId: string
		readonly deviceName: string
	}
): Promise<MobilePushTokenDto> {
	const [row] = await tx<MobilePushTokenDto[]>`
		INSERT INTO mobile_push_tokens (
			workspace_id, user_id, token, platform, device_id, device_name, revoked_at
		)
		VALUES (
			${args.workspaceId}, ${args.userId}, ${args.token}, ${args.platform},
			${args.deviceId}, ${args.deviceName}, NULL
		)
		ON CONFLICT (workspace_id, user_id, token) DO UPDATE
		SET
			platform = EXCLUDED.platform,
			device_id = EXCLUDED.device_id,
			device_name = EXCLUDED.device_name,
			revoked_at = NULL
		RETURNING
			id,
			workspace_id AS "workspaceId",
			user_id AS "userId",
			token,
			platform,
			device_id AS "deviceId",
			device_name AS "deviceName",
			last_used_at::text AS "lastUsedAt",
			revoked_at::text AS "revokedAt",
			created_at::text AS "createdAt"
	`
	if (!row) throw new Error('Failed to save mobile push token')
	return row
}

export async function listMobilePushTokensForUser(
	tx: Queryable,
	workspaceId: string,
	userId: string
): Promise<MobilePushTokenDto[]> {
	return tx<MobilePushTokenDto[]>`
		SELECT
			id,
			workspace_id AS "workspaceId",
			user_id AS "userId",
			token,
			platform,
			device_id AS "deviceId",
			device_name AS "deviceName",
			last_used_at::text AS "lastUsedAt",
			revoked_at::text AS "revokedAt",
			created_at::text AS "createdAt"
		FROM mobile_push_tokens
		WHERE workspace_id = ${workspaceId}
			AND user_id = ${userId}
			AND revoked_at IS NULL
		ORDER BY created_at DESC
	`
}

export async function revokeMobilePushTokenById(
	tx: Queryable,
	workspaceId: string,
	tokenId: string,
	userId?: string
): Promise<boolean> {
	const rows = await tx<{ id: string }[]>`
		UPDATE mobile_push_tokens
		SET revoked_at = COALESCE(revoked_at, now())
		WHERE workspace_id = ${workspaceId}
			AND id = ${tokenId}
			${userId ? tx`AND user_id = ${userId}` : tx``}
		RETURNING id
	`
	return rows.length > 0
}

export async function touchMobilePushToken(
	tx: Queryable,
	workspaceId: string,
	tokenId: string
): Promise<void> {
	await tx`
		UPDATE mobile_push_tokens
		SET last_used_at = now()
		WHERE workspace_id = ${workspaceId} AND id = ${tokenId}
	`
}
