/**
 * Availability SQL (ADR-0035). Every statement runs inside `withWorkspace`;
 * the availability module owns `user_workspace_profiles` and
 * `user_availability_windows`.
 */

import type { AvailabilityWindowKind } from '@huriro/contracts'
import type { Queryable } from '@huriro/db'

export interface AvailabilityProfileRow {
	readonly userId: string
	readonly displayName?: string | null
	readonly avatarUrl?: string | null
	readonly statusEmoji: string | null
	readonly statusText: string
	readonly statusExpiresAt: string | null
	readonly dndUntil: string | null
	readonly workingHours: unknown
	readonly lastSeenAt: string | null
	readonly manualState: 'auto' | 'available' | 'busy' | 'dnd' | 'away' | 'ooo'
	readonly manualStateExpiresAt: string | null
	readonly timezone: string
	readonly suppressNotificationsOffHours: boolean
	readonly allowUrgentOverride: boolean
	readonly version: number
	readonly updatedAt: string | null
}

export interface AvailabilityWindowRow {
	readonly id: string
	readonly userId: string
	readonly kind: AvailabilityWindowKind
	readonly title: string
	readonly message: string
	readonly startsAt: string
	readonly endsAt: string
	readonly delegateUserId: string | null
	readonly autoDeclineRouting: boolean
	readonly suppressNotifications: boolean
	readonly version: number
	readonly createdAt: string
	readonly updatedAt: string
}

export async function getProfileRow(
	tx: Queryable,
	workspaceId: string,
	userId: string
): Promise<AvailabilityProfileRow | null> {
	const [row] = await tx<AvailabilityProfileRow[]>`
		SELECT
			p.user_id AS "userId",
			u.display_name AS "displayName",
			u.avatar_url AS "avatarUrl",
			p.status_emoji AS "statusEmoji",
			p.status_text AS "statusText",
			p.status_expires_at::text AS "statusExpiresAt",
			p.dnd_until::text AS "dndUntil",
			p.working_hours AS "workingHours",
			p.last_seen_at::text AS "lastSeenAt",
			p.manual_state AS "manualState",
			p.manual_state_expires_at::text AS "manualStateExpiresAt",
			p.timezone AS timezone,
			p.suppress_notifications_off_hours AS "suppressNotificationsOffHours",
			p.allow_urgent_override AS "allowUrgentOverride",
			p.version,
			p.updated_at::text AS "updatedAt"
		FROM user_workspace_profiles p
		LEFT JOIN users u ON u.id = p.user_id
		WHERE p.workspace_id = ${workspaceId} AND p.user_id = ${userId}
	`
	return row ?? null
}

export async function listMemberProfiles(
	tx: Queryable,
	workspaceId: string,
	actorUserId: string,
	guestScoped: boolean,
	userIds?: readonly string[]
): Promise<AvailabilityProfileRow[]> {
	const ids = userIds && userIds.length > 0 ? [...userIds] : null
	return tx<AvailabilityProfileRow[]>`
		SELECT
			m.user_id AS "userId",
			u.display_name AS "displayName",
			u.avatar_url AS "avatarUrl",
			COALESCE(p.status_emoji, NULL) AS "statusEmoji",
			COALESCE(p.status_text, '') AS "statusText",
			p.status_expires_at::text AS "statusExpiresAt",
			p.dnd_until::text AS "dndUntil",
			COALESCE(p.working_hours, '{}'::jsonb) AS "workingHours",
			p.last_seen_at::text AS "lastSeenAt",
			COALESCE(p.manual_state, 'auto') AS "manualState",
			p.manual_state_expires_at::text AS "manualStateExpiresAt",
			COALESCE(p.timezone, u.timezone, 'UTC') AS timezone,
			COALESCE(p.suppress_notifications_off_hours, false) AS "suppressNotificationsOffHours",
			COALESCE(p.allow_urgent_override, true) AS "allowUrgentOverride",
			COALESCE(p.version, 0) AS version,
			p.updated_at::text AS "updatedAt"
		FROM memberships m
		JOIN users u ON u.id = m.user_id
		LEFT JOIN user_workspace_profiles p
			ON p.workspace_id = m.workspace_id AND p.user_id = m.user_id
		WHERE m.workspace_id = ${workspaceId}
			AND m.status = 'active'
			AND u.deleted_at IS NULL
			${ids ? tx`AND m.user_id = ANY(${ids}::uuid[])` : tx``}
			${
				guestScoped
					? tx`AND (
						m.user_id = ${actorUserId}
						OR EXISTS (
							SELECT 1 FROM acl_entries mine
							JOIN acl_entries theirs
								ON theirs.workspace_id = mine.workspace_id
								AND theirs.resource_type = mine.resource_type
								AND theirs.resource_id = mine.resource_id
								AND theirs.principal_type = 'user'
							WHERE mine.workspace_id = ${workspaceId}
								AND mine.principal_type = 'user'
								AND mine.principal_id = ${actorUserId}
								AND theirs.principal_id = m.user_id
						)
						OR EXISTS (
							SELECT 1 FROM chat_channel_members mine
							JOIN chat_channel_members theirs
								ON theirs.workspace_id = mine.workspace_id
								AND theirs.channel_id = mine.channel_id
								AND theirs.principal_type = 'user'
							WHERE mine.workspace_id = ${workspaceId}
								AND mine.principal_type = 'user'
								AND mine.principal_id = ${actorUserId}
								AND theirs.principal_id = m.user_id
						)
						OR EXISTS (
							SELECT 1 FROM teamspace_members mine
							JOIN teamspace_members theirs
								ON theirs.workspace_id = mine.workspace_id
								AND theirs.teamspace_id = mine.teamspace_id
							WHERE mine.workspace_id = ${workspaceId}
								AND mine.user_id = ${actorUserId}
								AND theirs.user_id = m.user_id
						)
					)`
					: tx``
			}
		ORDER BY u.display_name ASC
	`
}

export async function listWindows(
	tx: Queryable,
	workspaceId: string,
	userIds: readonly string[],
	opts?: {
		readonly activeAt?: string | undefined
		readonly all?: boolean | undefined
		readonly sinceIso?: string | undefined
	}
): Promise<AvailabilityWindowRow[]> {
	const ids = [...userIds]
	if (ids.length === 0) return []
	if (opts?.all) {
		const sinceIso = opts.sinceIso ?? '1970-01-01T00:00:00.000Z'
		return tx<AvailabilityWindowRow[]>`
			SELECT
				id,
				user_id AS "userId",
				kind,
				title,
				message,
				starts_at::text AS "startsAt",
				ends_at::text AS "endsAt",
				delegate_user_id AS "delegateUserId",
				auto_decline_routing AS "autoDeclineRouting",
				suppress_notifications AS "suppressNotifications",
				version,
				created_at::text AS "createdAt",
				updated_at::text AS "updatedAt"
			FROM user_availability_windows
			WHERE workspace_id = ${workspaceId}
				AND user_id = ANY(${ids}::uuid[])
				AND ends_at > ${sinceIso}
			ORDER BY starts_at ASC
		`
	}
	const at = opts?.activeAt ?? new Date().toISOString()
	return tx<AvailabilityWindowRow[]>`
		SELECT
			id,
			user_id AS "userId",
			kind,
			title,
			message,
			starts_at::text AS "startsAt",
			ends_at::text AS "endsAt",
			delegate_user_id AS "delegateUserId",
			auto_decline_routing AS "autoDeclineRouting",
			suppress_notifications AS "suppressNotifications",
			version,
			created_at::text AS "createdAt",
			updated_at::text AS "updatedAt"
		FROM user_availability_windows
		WHERE workspace_id = ${workspaceId}
			AND user_id = ANY(${ids}::uuid[])
			AND starts_at <= ${at}
			AND ends_at > ${at}
		ORDER BY starts_at ASC
	`
}

export async function getWindowRow(
	tx: Queryable,
	workspaceId: string,
	id: string
): Promise<AvailabilityWindowRow | null> {
	const [row] = await tx<AvailabilityWindowRow[]>`
		SELECT
			id,
			user_id AS "userId",
			kind,
			title,
			message,
			starts_at::text AS "startsAt",
			ends_at::text AS "endsAt",
			delegate_user_id AS "delegateUserId",
			auto_decline_routing AS "autoDeclineRouting",
			suppress_notifications AS "suppressNotifications",
			version,
			created_at::text AS "createdAt",
			updated_at::text AS "updatedAt"
		FROM user_availability_windows
		WHERE workspace_id = ${workspaceId} AND id = ${id}
	`
	return row ?? null
}

export async function hasOooOverlap(
	tx: Queryable,
	workspaceId: string,
	userId: string,
	startsAt: string,
	endsAt: string,
	excludeId?: string
): Promise<boolean> {
	const [row] = await tx<{ exists: boolean }[]>`
		SELECT EXISTS (
			SELECT 1
			FROM user_availability_windows
			WHERE workspace_id = ${workspaceId}
				AND user_id = ${userId}
				AND kind = 'ooo'
				AND starts_at < ${endsAt}
				AND ends_at > ${startsAt}
				${excludeId ? tx`AND id <> ${excludeId}` : tx``}
		) AS exists
	`
	return row?.exists === true
}

export async function upsertProfileRow(
	tx: Queryable,
	workspaceId: string,
	userId: string,
	input: {
		readonly statusEmoji?: string | null | undefined
		readonly statusText?: string | undefined
		readonly statusExpiresAt?: string | null | undefined
		readonly dndUntil?: string | null | undefined
		readonly workingHours?: unknown
		readonly manualState?: string | undefined
		readonly manualStateExpiresAt?: string | null | undefined
		readonly timezone?: string | undefined
		readonly suppressNotificationsOffHours?: boolean | undefined
		readonly allowUrgentOverride?: boolean | undefined
		readonly expectedVersion?: number | undefined
	}
): Promise<AvailabilityProfileRow> {
	const current = await getProfileRow(tx, workspaceId, userId)
	const currentVersion = current?.version ?? 0
	if (input.expectedVersion !== undefined && currentVersion !== input.expectedVersion) {
		const err = new Error('stale_version')
		;(err as Error & { code?: string }).code = 'stale_version'
		throw err
	}
	const has = <K extends keyof typeof input>(key: K) => input[key] !== undefined
	await tx`
		INSERT INTO user_workspace_profiles (
			workspace_id, user_id, status_emoji, status_text, status_expires_at, dnd_until,
			working_hours, last_seen_at, manual_state, manual_state_expires_at, timezone,
			suppress_notifications_off_hours, allow_urgent_override, version
		) VALUES (
			${workspaceId}, ${userId},
			${input.statusEmoji ?? null}, ${input.statusText ?? ''},
			${input.statusExpiresAt ?? null}, ${input.dndUntil ?? null},
			${tx.json((input.workingHours ?? {}) as never)}, now(),
			${input.manualState ?? 'auto'}, ${input.manualStateExpiresAt ?? null},
			COALESCE(${input.timezone ?? null}, (SELECT timezone FROM users WHERE id = ${userId}), 'UTC'),
			${input.suppressNotificationsOffHours ?? false},
			${input.allowUrgentOverride ?? true}, 1
		)
		ON CONFLICT (workspace_id, user_id) DO UPDATE SET
			status_emoji = CASE WHEN ${has('statusEmoji')} THEN EXCLUDED.status_emoji ELSE user_workspace_profiles.status_emoji END,
			status_text = CASE WHEN ${has('statusText')} THEN EXCLUDED.status_text ELSE user_workspace_profiles.status_text END,
			status_expires_at = CASE WHEN ${has('statusExpiresAt')} THEN EXCLUDED.status_expires_at ELSE user_workspace_profiles.status_expires_at END,
			dnd_until = CASE WHEN ${has('dndUntil')} THEN EXCLUDED.dnd_until ELSE user_workspace_profiles.dnd_until END,
			working_hours = CASE WHEN ${has('workingHours')} THEN EXCLUDED.working_hours ELSE user_workspace_profiles.working_hours END,
			manual_state = CASE WHEN ${has('manualState')} THEN EXCLUDED.manual_state ELSE user_workspace_profiles.manual_state END,
			manual_state_expires_at = CASE WHEN ${has('manualStateExpiresAt')} THEN EXCLUDED.manual_state_expires_at ELSE user_workspace_profiles.manual_state_expires_at END,
			timezone = CASE WHEN ${has('timezone')} THEN EXCLUDED.timezone ELSE user_workspace_profiles.timezone END,
			suppress_notifications_off_hours = CASE WHEN ${has('suppressNotificationsOffHours')} THEN EXCLUDED.suppress_notifications_off_hours ELSE user_workspace_profiles.suppress_notifications_off_hours END,
			allow_urgent_override = CASE WHEN ${has('allowUrgentOverride')} THEN EXCLUDED.allow_urgent_override ELSE user_workspace_profiles.allow_urgent_override END,
			last_seen_at = now(),
			version = user_workspace_profiles.version + 1
	`
	const row = await getProfileRow(tx, workspaceId, userId)
	if (!row) throw new Error('Failed to read availability profile after upsert')
	return row
}

export async function insertWindowRow(
	tx: Queryable,
	workspaceId: string,
	userId: string,
	input: {
		readonly kind: AvailabilityWindowKind
		readonly title: string
		readonly message: string
		readonly startsAt: string
		readonly endsAt: string
		readonly delegateUserId: string | null
		readonly autoDeclineRouting: boolean
		readonly suppressNotifications: boolean
	}
): Promise<AvailabilityWindowRow> {
	const [row] = await tx<AvailabilityWindowRow[]>`
		INSERT INTO user_availability_windows (
			workspace_id, user_id, kind, title, message, starts_at, ends_at,
			delegate_user_id, auto_decline_routing, suppress_notifications
		) VALUES (
			${workspaceId}, ${userId}, ${input.kind}, ${input.title}, ${input.message},
			${input.startsAt}, ${input.endsAt}, ${input.delegateUserId},
			${input.autoDeclineRouting}, ${input.suppressNotifications}
		)
		RETURNING
			id,
			user_id AS "userId",
			kind,
			title,
			message,
			starts_at::text AS "startsAt",
			ends_at::text AS "endsAt",
			delegate_user_id AS "delegateUserId",
			auto_decline_routing AS "autoDeclineRouting",
			suppress_notifications AS "suppressNotifications",
			version,
			created_at::text AS "createdAt",
			updated_at::text AS "updatedAt"
	`
	if (!row) throw new Error('Failed to insert availability window')
	return row
}

export async function updateWindowRow(
	tx: Queryable,
	workspaceId: string,
	id: string,
	patch: {
		readonly kind?: AvailabilityWindowKind | undefined
		readonly title?: string | undefined
		readonly message?: string | undefined
		readonly startsAt?: string | undefined
		readonly endsAt?: string | undefined
		readonly delegateUserId?: string | null | undefined
		readonly autoDeclineRouting?: boolean | undefined
		readonly suppressNotifications?: boolean | undefined
		readonly expectedVersion?: number | undefined
	}
): Promise<AvailabilityWindowRow> {
	const current = await getWindowRow(tx, workspaceId, id)
	if (!current) {
		const err = new Error('not_found')
		;(err as Error & { code?: string }).code = 'not_found'
		throw err
	}
	if (patch.expectedVersion !== undefined && current.version !== patch.expectedVersion) {
		const err = new Error('stale_version')
		;(err as Error & { code?: string }).code = 'stale_version'
		throw err
	}
	const has = <K extends keyof typeof patch>(key: K) => patch[key] !== undefined
	const [row] = await tx<AvailabilityWindowRow[]>`
		UPDATE user_availability_windows SET
			kind = CASE WHEN ${has('kind')} THEN ${patch.kind ?? current.kind} ELSE kind END,
			title = CASE WHEN ${has('title')} THEN ${patch.title ?? current.title} ELSE title END,
			message = CASE WHEN ${has('message')} THEN ${patch.message ?? current.message} ELSE message END,
			starts_at = CASE WHEN ${has('startsAt')} THEN ${patch.startsAt ?? current.startsAt} ELSE starts_at END,
			ends_at = CASE WHEN ${has('endsAt')} THEN ${patch.endsAt ?? current.endsAt} ELSE ends_at END,
			delegate_user_id = CASE WHEN ${has('delegateUserId')} THEN ${patch.delegateUserId ?? null} ELSE delegate_user_id END,
			auto_decline_routing = CASE WHEN ${has('autoDeclineRouting')} THEN ${patch.autoDeclineRouting ?? current.autoDeclineRouting} ELSE auto_decline_routing END,
			suppress_notifications = CASE WHEN ${has('suppressNotifications')} THEN ${patch.suppressNotifications ?? current.suppressNotifications} ELSE suppress_notifications END,
			version = version + 1
		WHERE workspace_id = ${workspaceId} AND id = ${id}
		RETURNING
			id,
			user_id AS "userId",
			kind,
			title,
			message,
			starts_at::text AS "startsAt",
			ends_at::text AS "endsAt",
			delegate_user_id AS "delegateUserId",
			auto_decline_routing AS "autoDeclineRouting",
			suppress_notifications AS "suppressNotifications",
			version,
			created_at::text AS "createdAt",
			updated_at::text AS "updatedAt"
	`
	if (!row) throw new Error('Failed to update availability window')
	return row
}

export async function deleteWindowRow(tx: Queryable, workspaceId: string, id: string): Promise<void> {
	const rows = await tx<{ id: string }[]>`
		DELETE FROM user_availability_windows
		WHERE workspace_id = ${workspaceId} AND id = ${id}
		RETURNING id
	`
	if (rows.length === 0) {
		const err = new Error('not_found')
		;(err as Error & { code?: string }).code = 'not_found'
		throw err
	}
}

export async function getMemberRole(
	tx: Queryable,
	workspaceId: string,
	userId: string
): Promise<string | null> {
	const [row] = await tx<{ key: string }[]>`
		SELECT r.key
		FROM memberships m
		JOIN roles r ON r.workspace_id = m.workspace_id AND r.id = m.role_id
		WHERE m.workspace_id = ${workspaceId} AND m.user_id = ${userId} AND m.status = 'active'
	`
	return row?.key ?? null
}
