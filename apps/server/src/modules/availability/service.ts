/**
 * Shared User Availability service (ADR-0035).
 *
 * Durable availability writes follow the standard single-transaction shape:
 * domain row + outbox + audit, then the change-log cursor LAST. Live presence
 * is injected (never persisted) and only refines the resolved state.
 */
import type {
	AvailabilityWindowDto,
	CreateAvailabilityWindowBody,
	ListWorkspaceAvailabilityQuery,
	UpdateAvailabilityWindowBody,
	UpdateMyAvailabilityBody,
	UserAvailabilityDto
} from '@huriro/contracts'
import type { Queryable, Sql } from '@huriro/db'
import { withWorkspace } from '@huriro/db'
import {
	type ActorContext,
	type AvailabilityWindowLike,
	isValidIanaTimezone,
	normalizeWorkingHours,
	type ResolvedAvailability,
	resolveEffectiveAvailability,
	validateWorkingHours
} from '@huriro/domain'
import { appendChanges } from '../../api/changelog'
import { HttpError } from '../../api/error'
import type { PresenceRegistry } from '../../realtime/presence-registry'
import { assertActiveMember } from './policy'
import {
	type AvailabilityProfileRow,
	type AvailabilityWindowRow,
	deleteWindowRow,
	getMemberRole,
	getProfileRow,
	getWindowRow,
	hasOooOverlap,
	insertWindowRow,
	listMemberProfiles,
	listWindows,
	updateWindowRow,
	upsertProfileRow
} from './repo'

type Row = Record<string, unknown>

function nowIso(): string {
	return new Date().toISOString()
}

function codedError(
	err: unknown,
	fallbackStatus: ConstructorParameters<typeof HttpError>[0],
	fallbackCode: ConstructorParameters<typeof HttpError>[1],
	message: string
): never {
	const code = err instanceof Error ? (err as Error & { code?: string }).code : undefined
	if (code === 'stale_version') {
		throw new HttpError(409, 'stale_version', 'Availability changed since it was loaded; refresh and retry')
	}
	if (code === 'not_found') throw new HttpError(404, 'not_found', message)
	throw new HttpError(fallbackStatus, fallbackCode, message)
}

function toWindowDto(row: AvailabilityWindowRow): AvailabilityWindowDto {
	return {
		id: row.id,
		userId: row.userId,
		kind: row.kind,
		title: row.title,
		message: row.message,
		startsAt: row.startsAt,
		endsAt: row.endsAt,
		delegateUserId: row.delegateUserId,
		autoDeclineRouting: row.autoDeclineRouting,
		suppressNotifications: row.suppressNotifications,
		version: row.version,
		createdAt: row.createdAt,
		updatedAt: row.updatedAt
	}
}

function toProfileLike(row: AvailabilityProfileRow): {
	readonly userId: string
	readonly manualState: AvailabilityProfileRow['manualState']
	readonly manualStateExpiresAt: string | null
	readonly statusEmoji: string | null
	readonly statusText: string
	readonly statusExpiresAt: string | null
	readonly dndUntil: string | null
	readonly workingHours: unknown
	readonly timezone: string
	readonly suppressNotificationsOffHours: boolean
	readonly allowUrgentOverride: boolean
} {
	return {
		userId: row.userId,
		manualState: row.manualState,
		manualStateExpiresAt: row.manualStateExpiresAt,
		statusEmoji: row.statusEmoji,
		statusText: row.statusText,
		statusExpiresAt: row.statusExpiresAt,
		dndUntil: row.dndUntil,
		workingHours: row.workingHours,
		timezone: row.timezone,
		suppressNotificationsOffHours: row.suppressNotificationsOffHours,
		allowUrgentOverride: row.allowUrgentOverride
	}
}

function toWindowLike(row: AvailabilityWindowRow): AvailabilityWindowLike {
	return {
		id: row.id,
		kind: row.kind,
		title: row.title,
		message: row.message,
		startsAt: row.startsAt,
		endsAt: row.endsAt,
		delegateUserId: row.delegateUserId,
		autoDeclineRouting: row.autoDeclineRouting,
		suppressNotifications: row.suppressNotifications
	}
}

export function buildUserAvailabilityDto(
	profile: AvailabilityProfileRow,
	windows: readonly AvailabilityWindowRow[],
	livePresence: 'online' | 'away' | 'offline',
	atIso: string
): { readonly dto: UserAvailabilityDto; readonly resolved: ResolvedAvailability } {
	const schedule = normalizeWorkingHours(profile.workingHours, profile.timezone)
	const workingHoursDto = {
		enabled: schedule.enabled,
		timezone: schedule.timezone,
		days: {
			mon: [...schedule.days.mon],
			tue: [...schedule.days.tue],
			wed: [...schedule.days.wed],
			thu: [...schedule.days.thu],
			fri: [...schedule.days.fri],
			sat: [...schedule.days.sat],
			sun: [...schedule.days.sun]
		}
	}
	const resolved = resolveEffectiveAvailability({
		profile: toProfileLike(profile),
		windows: windows.map(toWindowLike),
		livePresence,
		nowUtcIso: atIso
	})
	const upcoming = windows.filter((window) => Date.parse(window.endsAt) > Date.parse(atIso))
	const dto: UserAvailabilityDto = {
		id: profile.userId,
		userId: profile.userId,
		displayName: profile.displayName ?? null,
		handle: null,
		avatarUrl: profile.avatarUrl ?? null,
		manualState: profile.manualState,
		manualStateExpiresAt: profile.manualStateExpiresAt,
		effectiveState: resolved.state,
		statusEmoji: resolved.statusEmoji,
		statusText: resolved.statusText,
		statusExpiresAt: resolved.statusExpiresAt,
		dndUntil: profile.dndUntil,
		workingHours: workingHoursDto,
		timezone: profile.timezone || 'UTC',
		suppressNotificationsOffHours: profile.suppressNotificationsOffHours,
		allowUrgentOverride: profile.allowUrgentOverride,
		withinWorkingHours: resolved.withinWorkingHours,
		isRoutable: resolved.isRoutable,
		isAcceptingNotifications: resolved.isAcceptingNotifications,
		nextAvailableAt: resolved.nextAvailableAt,
		localTimeLabel: resolved.localTimeLabel,
		delegateUserId: resolved.delegateUserId,
		lastSeenAt: profile.lastSeenAt,
		version: profile.version,
		updatedAt: profile.updatedAt,
		windows: upcoming.map(toWindowDto)
	}
	return { dto, resolved }
}

function presenceFor(
	presence: PresenceRegistry | undefined,
	workspaceId: string,
	userId: string
): 'online' | 'away' | 'offline' {
	if (!presence) return 'offline'
	return presence.getStatus(workspaceId, userId)
}

async function windowsForUsers(
	tx: Queryable,
	workspaceId: string,
	userIds: readonly string[],
	atIso: string
): Promise<Map<string, AvailabilityWindowRow[]>> {
	const rows = await listWindows(tx, workspaceId, userIds, { all: true, sinceIso: atIso })
	const byUser = new Map<string, AvailabilityWindowRow[]>()
	for (const row of rows) {
		const list = byUser.get(row.userId) ?? []
		list.push(row)
		byUser.set(row.userId, list)
	}
	return byUser
}

async function requireMemberProfile(
	tx: Queryable,
	actor: ActorContext,
	targetUserId: string
): Promise<AvailabilityProfileRow> {
	const rows = await listMemberProfiles(tx, actor.workspaceId, actor.userId, actor.roleKey === 'guest', [
		targetUserId
	])
	const row = rows[0]
	if (!row) throw new HttpError(404, 'not_found', 'Member availability not found or not visible')
	return row
}

export async function getMyAvailability(
	tx: Queryable,
	actor: ActorContext,
	presence?: PresenceRegistry
): Promise<UserAvailabilityDto> {
	assertActiveMember(actor)
	const row = await requireMemberProfile(tx, actor, actor.userId)
	const atIso = nowIso()
	const windows =
		(await windowsForUsers(tx, actor.workspaceId, [actor.userId], atIso)).get(actor.userId) ?? []
	return buildUserAvailabilityDto(row, windows, presenceFor(presence, actor.workspaceId, actor.userId), atIso)
		.dto
}

export async function getUserAvailability(
	tx: Queryable,
	actor: ActorContext,
	userId: string,
	presence?: PresenceRegistry
): Promise<UserAvailabilityDto> {
	assertActiveMember(actor)
	const row = await requireMemberProfile(tx, actor, userId)
	const atIso = nowIso()
	const windows = (await windowsForUsers(tx, actor.workspaceId, [userId], atIso)).get(userId) ?? []
	return buildUserAvailabilityDto(row, windows, presenceFor(presence, actor.workspaceId, userId), atIso).dto
}

export async function listWorkspaceAvailability(
	tx: Queryable,
	actor: ActorContext,
	query: ListWorkspaceAvailabilityQuery,
	presence?: PresenceRegistry
): Promise<{ readonly data: UserAvailabilityDto[] }> {
	assertActiveMember(actor)
	const rows = await listMemberProfiles(
		tx,
		actor.workspaceId,
		actor.userId,
		actor.roleKey === 'guest',
		query.userId ? [query.userId] : undefined
	)
	const atIso = nowIso()
	const windows = await windowsForUsers(
		tx,
		actor.workspaceId,
		rows.map((row) => row.userId),
		atIso
	)
	let data = rows.map(
		(row) =>
			buildUserAvailabilityDto(
				row,
				windows.get(row.userId) ?? [],
				presenceFor(presence, actor.workspaceId, row.userId),
				atIso
			).dto
	)
	if (query.state) data = data.filter((row) => row.effectiveState === query.state)
	data.sort((a, b) => (a.displayName ?? a.userId).localeCompare(b.displayName ?? b.userId))
	return { data }
}

/** Sync snapshot projection — same guest visibility as the list endpoint. */
export async function getAvailabilitySnapshot(
	tx: Queryable,
	actor: ActorContext,
	presence?: PresenceRegistry
): Promise<UserAvailabilityDto[]> {
	const { data } = await listWorkspaceAvailability(tx, actor, {}, presence)
	return data
}

/**
 * Server-side resolution for notifications and mail routing. Internal callers
 * get every active member (no guest directory filter) and ephemeral presence.
 */
export async function getUsersAvailabilityMap(
	tx: Queryable,
	workspaceId: string,
	userIds: readonly string[],
	presence?: PresenceRegistry,
	atIso = nowIso()
): Promise<Map<string, ResolvedAvailability>> {
	const map = new Map<string, ResolvedAvailability>()
	if (userIds.length === 0) return map
	const rows = await listMemberProfiles(tx, workspaceId, '', false, userIds)
	const windows = await windowsForUsers(
		tx,
		workspaceId,
		rows.map((row) => row.userId),
		atIso
	)
	for (const row of rows) {
		const { resolved } = buildUserAvailabilityDto(
			row,
			windows.get(row.userId) ?? [],
			presenceFor(presence, workspaceId, row.userId),
			atIso
		)
		map.set(row.userId, resolved)
	}
	return map
}

export async function getEffectiveAvailabilityForUser(
	tx: Queryable,
	workspaceId: string,
	userId: string,
	presence?: PresenceRegistry,
	atIso = nowIso()
): Promise<ResolvedAvailability | null> {
	const map = await getUsersAvailabilityMap(tx, workspaceId, [userId], presence, atIso)
	return map.get(userId) ?? null
}

async function emitAvailabilityEvent(
	tx: Queryable,
	actor: ActorContext,
	args: {
		readonly userId: string
		readonly eventType: string
		readonly action: string
		readonly payload: Record<string, unknown>
	}
): Promise<void> {
	await tx`
		INSERT INTO outbox (workspace_id, aggregate, aggregate_id, event_type, payload)
		VALUES (
			${actor.workspaceId}, 'user_availability', ${args.userId}, ${args.eventType},
			${tx.json({ actorId: actor.principalId, userId: args.userId, ...args.payload } as never)}
		)
	`
	await tx`
		INSERT INTO audit_log (workspace_id, actor_type, actor_id, action, target_type, target_id, metadata)
		VALUES (
			${actor.workspaceId}, ${actor.kind}, ${actor.principalId}, ${args.action},
			'user_availability', ${args.userId}, ${tx.json(args.payload as never)}
		)
	`
}

async function appendAvailabilityChange(
	tx: Queryable,
	actor: ActorContext,
	dto: UserAvailabilityDto
): Promise<number> {
	return appendChanges(tx, actor.workspaceId, [
		{
			entityType: 'user_availability',
			entityId: dto.userId,
			action: 'upsert',
			scope: ['visibility:workspace'],
			payload: dto as unknown as Record<string, unknown>,
			actorId: actor.principalId
		}
	])
}

export async function updateMyAvailability(
	tx: Queryable,
	actor: ActorContext,
	input: UpdateMyAvailabilityBody,
	presence?: PresenceRegistry
): Promise<{ readonly data: UserAvailabilityDto; readonly cursor: number }> {
	assertActiveMember(actor)
	const current = await getProfileRow(tx, actor.workspaceId, actor.userId)

	const timezone = input.timezone ?? input.workingHours?.timezone ?? current?.timezone ?? 'UTC'
	if (!isValidIanaTimezone(timezone)) {
		throw new HttpError(422, 'validation_failed', 'timezone must be a valid IANA timezone')
	}

	let workingHours: unknown | undefined
	if (input.workingHours !== undefined) {
		const normalizedInput = { ...input.workingHours, timezone }
		const validation = validateWorkingHours(normalizedInput, timezone)
		if (!validation.ok) {
			throw new HttpError(422, 'validation_failed', `Invalid working hours: ${validation.errors.join('; ')}`)
		}
		workingHours = validation.normalized
	}

	if (
		input.statusExpiresAt !== undefined &&
		input.statusExpiresAt !== null &&
		!Number.isFinite(Date.parse(input.statusExpiresAt))
	) {
		throw new HttpError(422, 'validation_failed', 'statusExpiresAt must be an ISO timestamp')
	}
	if (
		input.manualStateExpiresAt !== undefined &&
		input.manualStateExpiresAt !== null &&
		!Number.isFinite(Date.parse(input.manualStateExpiresAt))
	) {
		throw new HttpError(422, 'validation_failed', 'manualStateExpiresAt must be an ISO timestamp')
	}
	if (
		input.dndUntil !== undefined &&
		input.dndUntil !== null &&
		!Number.isFinite(Date.parse(input.dndUntil))
	) {
		throw new HttpError(422, 'validation_failed', 'dndUntil must be an ISO timestamp')
	}

	let profile: AvailabilityProfileRow
	try {
		profile = await upsertProfileRow(tx, actor.workspaceId, actor.userId, {
			...(input.statusEmoji !== undefined ? { statusEmoji: input.statusEmoji } : {}),
			...(input.statusText !== undefined ? { statusText: input.statusText } : {}),
			...(input.statusExpiresAt !== undefined ? { statusExpiresAt: input.statusExpiresAt } : {}),
			...(input.dndUntil !== undefined ? { dndUntil: input.dndUntil } : {}),
			...(workingHours !== undefined ? { workingHours } : {}),
			...(input.manualState !== undefined
				? {
						manualState: input.manualState,
						manualStateExpiresAt:
							input.manualStateExpiresAt !== undefined
								? input.manualStateExpiresAt
								: input.manualState === 'auto'
									? null
									: (current?.manualStateExpiresAt ?? null)
					}
				: input.manualStateExpiresAt !== undefined
					? { manualStateExpiresAt: input.manualStateExpiresAt }
					: {}),
			timezone,
			...(input.suppressNotificationsOffHours !== undefined
				? { suppressNotificationsOffHours: input.suppressNotificationsOffHours }
				: {}),
			...(input.allowUrgentOverride !== undefined ? { allowUrgentOverride: input.allowUrgentOverride } : {}),
			...(input.expectedVersion !== undefined ? { expectedVersion: input.expectedVersion } : {})
		})
	} catch (err) {
		codedError(err, 409, 'conflict', 'Availability profile not found')
	}

	const atIso = nowIso()
	const windows =
		(await windowsForUsers(tx, actor.workspaceId, [actor.userId], atIso)).get(actor.userId) ?? []
	const { dto } = buildUserAvailabilityDto(
		profile,
		windows,
		presenceFor(presence, actor.workspaceId, actor.userId),
		atIso
	)

	await emitAvailabilityEvent(tx, actor, {
		userId: actor.userId,
		eventType: 'availability.updated.v1',
		action: 'availability.update',
		payload: {
			manualState: dto.manualState,
			manualStateExpiresAt: dto.manualStateExpiresAt,
			statusText: dto.statusText,
			statusEmoji: dto.statusEmoji,
			dndUntil: dto.dndUntil,
			timezone: dto.timezone
		}
	})
	const cursor = await appendAvailabilityChange(tx, actor, dto)
	return { data: dto, cursor }
}

function assertWindowTimestamps(startsAt: string, endsAt: string): void {
	const start = Date.parse(startsAt)
	const end = Date.parse(endsAt)
	if (!Number.isFinite(start) || !Number.isFinite(end)) {
		throw new HttpError(422, 'validation_failed', 'startsAt and endsAt must be ISO timestamps')
	}
	if (end <= start) throw new HttpError(422, 'validation_failed', 'endsAt must be after startsAt')
}

async function assertDelegate(
	tx: Queryable,
	actor: ActorContext,
	delegateUserId: string | null
): Promise<void> {
	if (!delegateUserId) return
	if (delegateUserId === actor.userId) {
		throw new HttpError(422, 'validation_failed', 'A delegate cannot be the user themselves')
	}
	const role = await getMemberRole(tx, actor.workspaceId, delegateUserId)
	if (role === null)
		throw new HttpError(422, 'validation_failed', 'Delegate must be an active workspace member')
	if (role === 'guest') throw new HttpError(422, 'validation_failed', 'Delegate cannot be a guest')
}

export async function listMyAvailabilityWindows(
	tx: Queryable,
	actor: ActorContext
): Promise<AvailabilityWindowDto[]> {
	assertActiveMember(actor)
	const rows = await listWindows(tx, actor.workspaceId, [actor.userId], { all: true })
	return rows.map(toWindowDto)
}

async function upsertProfileForWindowChange(
	tx: Queryable,
	actor: ActorContext
): Promise<AvailabilityProfileRow> {
	return upsertProfileRow(tx, actor.workspaceId, actor.userId, {})
}

export async function createAvailabilityWindow(
	tx: Queryable,
	actor: ActorContext,
	input: CreateAvailabilityWindowBody
): Promise<{ readonly data: AvailabilityWindowDto; readonly cursor: number }> {
	assertActiveMember(actor)
	const kind = input.kind ?? 'ooo'
	const startsAt = input.startsAt
	const endsAt = input.endsAt
	assertWindowTimestamps(startsAt, endsAt)
	const delegateUserId = input.delegateUserId ?? null
	await assertDelegate(tx, actor, delegateUserId)
	if (kind === 'ooo' && (await hasOooOverlap(tx, actor.workspaceId, actor.userId, startsAt, endsAt))) {
		throw new HttpError(409, 'conflict', 'An out-of-office window already overlaps these dates')
	}
	const row = await insertWindowRow(tx, actor.workspaceId, actor.userId, {
		kind,
		title: input.title ?? '',
		message: input.message ?? '',
		startsAt,
		endsAt,
		delegateUserId,
		autoDeclineRouting: input.autoDeclineRouting ?? true,
		suppressNotifications: input.suppressNotifications ?? true
	})
	const profile = await upsertProfileForWindowChange(tx, actor)
	const atIso = nowIso()
	const windows =
		(await windowsForUsers(tx, actor.workspaceId, [actor.userId], atIso)).get(actor.userId) ?? []
	const { dto } = buildUserAvailabilityDto(profile, windows, 'offline', atIso)
	await emitAvailabilityEvent(tx, actor, {
		userId: actor.userId,
		eventType: 'availability.window.created.v1',
		action: 'availability.window.create',
		payload: { windowId: row.id, kind: row.kind, startsAt: row.startsAt, endsAt: row.endsAt, delegateUserId }
	})
	const cursor = await appendAvailabilityChange(tx, actor, dto)
	return { data: toWindowDto(row), cursor }
}

export async function updateAvailabilityWindow(
	tx: Queryable,
	actor: ActorContext,
	windowId: string,
	input: UpdateAvailabilityWindowBody
): Promise<{ readonly data: AvailabilityWindowDto; readonly cursor: number }> {
	assertActiveMember(actor)
	const current = await getWindowRow(tx, actor.workspaceId, windowId)
	if (!current) throw new HttpError(404, 'not_found', 'Availability window not found')
	if (current.userId !== actor.userId) {
		throw new HttpError(403, 'insufficient_role', 'Only the owner may edit their availability windows')
	}
	const startsAt = input.startsAt ?? current.startsAt
	const endsAt = input.endsAt ?? current.endsAt
	assertWindowTimestamps(startsAt, endsAt)
	if (input.delegateUserId !== undefined) await assertDelegate(tx, actor, input.delegateUserId)
	const kind = input.kind ?? current.kind
	if (
		kind === 'ooo' &&
		(await hasOooOverlap(tx, actor.workspaceId, actor.userId, startsAt, endsAt, windowId))
	) {
		throw new HttpError(409, 'conflict', 'An out-of-office window already overlaps these dates')
	}
	let row: AvailabilityWindowRow
	try {
		row = await updateWindowRow(tx, actor.workspaceId, windowId, {
			...(input.kind !== undefined ? { kind: input.kind } : {}),
			...(input.title !== undefined ? { title: input.title } : {}),
			...(input.message !== undefined ? { message: input.message } : {}),
			...(input.startsAt !== undefined ? { startsAt: input.startsAt } : {}),
			...(input.endsAt !== undefined ? { endsAt: input.endsAt } : {}),
			...(input.delegateUserId !== undefined ? { delegateUserId: input.delegateUserId } : {}),
			...(input.autoDeclineRouting !== undefined ? { autoDeclineRouting: input.autoDeclineRouting } : {}),
			...(input.suppressNotifications !== undefined
				? { suppressNotifications: input.suppressNotifications }
				: {}),
			...(input.version !== undefined ? { expectedVersion: input.version } : {})
		})
	} catch (err) {
		codedError(err, 409, 'conflict', 'Availability window not found')
	}
	const profile = await upsertProfileForWindowChange(tx, actor)
	const atIso = nowIso()
	const windows =
		(await windowsForUsers(tx, actor.workspaceId, [actor.userId], atIso)).get(actor.userId) ?? []
	const { dto } = buildUserAvailabilityDto(profile, windows, 'offline', atIso)
	await emitAvailabilityEvent(tx, actor, {
		userId: actor.userId,
		eventType: 'availability.window.updated.v1',
		action: 'availability.window.update',
		payload: {
			windowId: row.id,
			kind: row.kind,
			startsAt: row.startsAt,
			endsAt: row.endsAt,
			delegateUserId: row.delegateUserId
		}
	})
	const cursor = await appendAvailabilityChange(tx, actor, dto)
	return { data: toWindowDto(row), cursor }
}

export async function deleteAvailabilityWindow(
	tx: Queryable,
	actor: ActorContext,
	windowId: string
): Promise<{ readonly deleted: true; readonly id: string; readonly cursor: number }> {
	assertActiveMember(actor)
	const current = await getWindowRow(tx, actor.workspaceId, windowId)
	if (!current) throw new HttpError(404, 'not_found', 'Availability window not found')
	if (current.userId !== actor.userId) {
		throw new HttpError(403, 'insufficient_role', 'Only the owner may delete their availability windows')
	}
	await deleteWindowRow(tx, actor.workspaceId, windowId)
	const profile = await upsertProfileForWindowChange(tx, actor)
	const atIso = nowIso()
	const windows =
		(await windowsForUsers(tx, actor.workspaceId, [actor.userId], atIso)).get(actor.userId) ?? []
	const { dto } = buildUserAvailabilityDto(profile, windows, 'offline', atIso)
	await emitAvailabilityEvent(tx, actor, {
		userId: actor.userId,
		eventType: 'availability.window.deleted.v1',
		action: 'availability.window.delete',
		payload: { windowId }
	})
	const cursor = await appendAvailabilityChange(tx, actor, dto)
	return { deleted: true, id: windowId, cursor }
}

// ---------- Worker sweep ----------

export interface AvailabilitySweepResult {
	readonly expired: number
	readonly started: number
	readonly ended: number
}

/**
 * One worker pass (pg-boss `availability-sweep`, every minute):
 * - clear expired status/DND/manual overrides (idempotent UPDATE ... RETURNING)
 * - emit the first OOO/start + end outbox events exactly once per window
 * - write change-log rows so clients refresh via opaque cursor signals
 */
export async function runAvailabilitySweepOnce(
	sql: Sql,
	pubsub?: { publishCursor(workspaceId: string, cursor: number): Promise<void> }
): Promise<AvailabilitySweepResult> {
	let expired = 0
	let started = 0
	let ended = 0
	const cursors = new Map<string, number>()

	const due = await sql<{ workspaceId: string; userId: string }[]>`
		SELECT workspace_id AS "workspaceId", user_id AS "userId"
		FROM list_availability_expirations_due()
	`
	for (const item of due) {
		try {
			const cursor = await withWorkspace(sql, { workspaceId: item.workspaceId }, async (tx) => {
				const rows = await tx<{ userId: string }[]>`
					UPDATE user_workspace_profiles SET
						status_emoji = CASE WHEN status_expires_at IS NOT NULL AND status_expires_at <= now() THEN NULL ELSE status_emoji END,
						status_text = CASE WHEN status_expires_at IS NOT NULL AND status_expires_at <= now() THEN '' ELSE status_text END,
						status_expires_at = CASE WHEN status_expires_at IS NOT NULL AND status_expires_at <= now() THEN NULL ELSE status_expires_at END,
						dnd_until = CASE WHEN dnd_until IS NOT NULL AND dnd_until <= now() THEN NULL ELSE dnd_until END,
						manual_state = CASE WHEN manual_state_expires_at IS NOT NULL AND manual_state_expires_at <= now() THEN 'auto' ELSE manual_state END,
						manual_state_expires_at = CASE WHEN manual_state_expires_at IS NOT NULL AND manual_state_expires_at <= now() THEN NULL ELSE manual_state_expires_at END,
						version = version + 1
					WHERE workspace_id = ${item.workspaceId} AND user_id = ${item.userId}
					RETURNING user_id AS "userId"
				`
				if (rows.length === 0) return null
				const profile = await getProfileRow(tx, item.workspaceId, item.userId)
				if (!profile) return null
				const atIso = nowIso()
				const windowRows = await listWindows(tx, item.workspaceId, [item.userId], {
					all: true,
					sinceIso: atIso
				})
				const { dto } = buildUserAvailabilityDto(profile, windowRows, 'offline', atIso)
				await tx`
					INSERT INTO outbox (workspace_id, aggregate, aggregate_id, event_type, payload)
					VALUES (
						${item.workspaceId}, 'user_availability', ${item.userId},
						'availability.expired.v1',
						${tx.json({ userId: item.userId, effectiveState: dto.effectiveState } as never)}
					)
				`
				return appendChanges(tx, item.workspaceId, [
					{
						entityType: 'user_availability',
						entityId: item.userId,
						action: 'upsert',
						scope: ['visibility:workspace'],
						payload: dto as unknown as Record<string, unknown>,
						actorId: null
					}
				])
			})
			if (cursor !== null && cursor !== undefined) {
				expired += 1
				cursors.set(item.workspaceId, Math.max(cursors.get(item.workspaceId) ?? 0, cursor))
			}
		} catch {
			// One bad tenant row must not stop the sweep for everyone else.
		}
	}

	const transitions = await sql<{ workspaceId: string; id: string; transition: 'started' | 'ended' }[]>`
		SELECT workspace_id AS "workspaceId", id, transition
		FROM list_availability_window_transitions_due()
	`
	for (const transition of transitions) {
		try {
			const cursor = await withWorkspace(sql, { workspaceId: transition.workspaceId }, async (tx) => {
				const marker =
					transition.transition === 'started' ? 'started_event_emitted_at' : 'ended_event_emitted_at'
				const updated = await tx<Row[]>`
					UPDATE user_availability_windows
					SET ${tx.unsafe(marker)} = now()
					WHERE workspace_id = ${transition.workspaceId}
						AND id = ${transition.id}
						AND ${tx.unsafe(marker)} IS NULL
					RETURNING user_id AS "userId", kind, title, starts_at::text AS "startsAt", ends_at::text AS "endsAt",
						delegate_user_id AS "delegateUserId"
				`
				const row = updated[0]
				if (!row) return null
				const userId = String(row['userId'])
				const profile = await getProfileRow(tx, transition.workspaceId, userId)
				if (!profile) return null
				await upsertProfileRow(tx, transition.workspaceId, userId, {})
				const atIso = nowIso()
				const windowRows = await listWindows(tx, transition.workspaceId, [userId], {
					all: true,
					sinceIso: atIso
				})
				const refreshed = (await getProfileRow(tx, transition.workspaceId, userId)) ?? profile
				const { dto } = buildUserAvailabilityDto(refreshed, windowRows, 'offline', atIso)
				const kind = String(row['kind'])
				const eventType =
					kind === 'ooo'
						? transition.transition === 'started'
							? 'availability.ooo.started.v1'
							: 'availability.ooo.ended.v1'
						: transition.transition === 'started'
							? 'availability.window.started.v1'
							: 'availability.window.ended.v1'
				await tx`
					INSERT INTO outbox (workspace_id, aggregate, aggregate_id, event_type, payload)
					VALUES (
						${transition.workspaceId}, 'user_availability', ${userId}, ${eventType},
						${tx.json({
							userId,
							windowId: transition.id,
							kind,
							title: row['title'] ?? '',
							startsAt: row['startsAt'],
							endsAt: row['endsAt'],
							delegateUserId: row['delegateUserId'] ?? null
						} as never)}
					)
				`
				return appendChanges(tx, transition.workspaceId, [
					{
						entityType: 'user_availability',
						entityId: userId,
						action: 'upsert',
						scope: ['visibility:workspace'],
						payload: dto as unknown as Record<string, unknown>,
						actorId: null
					}
				])
			})
			if (cursor !== null && cursor !== undefined) {
				if (transition.transition === 'started') started += 1
				else ended += 1
				cursors.set(transition.workspaceId, Math.max(cursors.get(transition.workspaceId) ?? 0, cursor))
			}
		} catch {
			// Idempotent per-window marker: the next pass retries safely.
		}
	}

	if (pubsub) {
		for (const [workspaceId, cursor] of cursors) {
			await pubsub.publishCursor(workspaceId, cursor).catch(() => {})
		}
	}
	return { expired, started, ended }
}
