/**
 * Shared User Availability model (ADR-0035) — pure, injected clock.
 *
 * One deterministic precedence ladder used by server routing/notification
 * suppression and by the web/mobile UI:
 *
 *   1. OOO   — active scheduled window or unexpired manual `ooo`
 *   2. DND   — `dnd_until`, active dnd window, or unexpired manual `dnd`
 *   3. Busy  — active focus window or unexpired manual `busy`
 *   4. Manual available/away override
 *   5. Working hours (only when manual state is `auto`)
 *   6. Live presence (only when manual state is `auto`)
 */
import { isWithinQuietHours } from './chat'

export const WEEKDAYS = ['mon', 'tue', 'wed', 'thu', 'fri', 'sat', 'sun'] as const
export type WeekdayKey = (typeof WEEKDAYS)[number]

export const MANUAL_AVAILABILITY_STATES = ['auto', 'available', 'busy', 'dnd', 'away', 'ooo'] as const
export type ManualAvailabilityState = (typeof MANUAL_AVAILABILITY_STATES)[number]

export const AVAILABILITY_WINDOW_KINDS = ['ooo', 'focus', 'dnd'] as const
export type AvailabilityWindowKind = (typeof AVAILABILITY_WINDOW_KINDS)[number]

export const EFFECTIVE_AVAILABILITY_STATES = [
	'available',
	'busy',
	'dnd',
	'away',
	'off_hours',
	'ooo',
	'offline'
] as const
export type EffectiveAvailabilityState = (typeof EFFECTIVE_AVAILABILITY_STATES)[number]

export const AVAILABILITY_WARNING_KEYS = [
	'availability.warning.ooo',
	'availability.warning.dnd',
	'availability.warning.offHours',
	'availability.warning.offline'
] as const
export type AvailabilityWarningKey = (typeof AVAILABILITY_WARNING_KEYS)[number]

export const MAX_INTERVALS_PER_DAY = 4
export const NEXT_AVAILABLE_HORIZON_DAYS = 14

export interface WorkingHoursInterval {
	readonly start: string
	readonly end: string
}

export interface WorkingHoursSchedule {
	readonly enabled: boolean
	readonly timezone: string
	readonly days: Readonly<Record<WeekdayKey, readonly WorkingHoursInterval[]>>
}

export interface AvailabilityWindowLike {
	readonly id: string
	readonly kind: AvailabilityWindowKind
	readonly title?: string
	readonly message?: string
	readonly startsAt: string
	readonly endsAt: string
	readonly delegateUserId: string | null
	readonly autoDeclineRouting: boolean
	readonly suppressNotifications: boolean
}

export interface AvailabilityProfileLike {
	readonly userId: string
	readonly manualState: ManualAvailabilityState
	readonly manualStateExpiresAt: string | null
	readonly statusEmoji: string | null
	readonly statusText: string
	readonly statusExpiresAt: string | null
	readonly dndUntil: string | null
	readonly workingHours: unknown
	readonly timezone: string
	readonly suppressNotificationsOffHours: boolean
	readonly allowUrgentOverride: boolean
}

export type LivePresenceState = 'online' | 'away' | 'offline'

export interface ResolvedAvailability {
	readonly userId: string
	readonly state: EffectiveAvailabilityState
	readonly manualState: ManualAvailabilityState
	readonly statusEmoji: string | null
	readonly statusText: string
	readonly statusExpiresAt: string | null
	readonly activeWindow: AvailabilityWindowLike | null
	readonly delegateUserId: string | null
	readonly timezone: string
	readonly withinWorkingHours: boolean
	readonly suppressNotificationsOffHours: boolean
	readonly allowUrgentOverride: boolean
	readonly isRoutable: boolean
	readonly isAcceptingNotifications: boolean
	readonly nextAvailableAt: string | null
	readonly localTimeLabel: string | null
	readonly livePresence: LivePresenceState
}

const HHMM = /^([01]\d|2[0-3]):([0-5]\d)$/

export function isValidHHMM(value: string): boolean {
	return HHMM.test(value)
}

function minutesOfHHMM(value: string): number | null {
	const match = HHMM.exec(value)
	if (!match) return null
	return Number(match[1]) * 60 + Number(match[2])
}

export function isValidIanaTimezone(value: string): boolean {
	if (!value || value.length > 80) return false
	try {
		new Intl.DateTimeFormat('en-US', { timeZone: value }).format(0)
		return true
	} catch {
		return false
	}
}

function emptyDays(): Record<WeekdayKey, readonly WorkingHoursInterval[]> {
	return { mon: [], tue: [], wed: [], thu: [], fri: [], sat: [], sun: [] }
}

export function defaultWorkingHours(timezone = 'UTC'): WorkingHoursSchedule {
	return {
		enabled: false,
		timezone: isValidIanaTimezone(timezone) ? timezone : 'UTC',
		days: emptyDays()
	}
}

function normalizeInterval(raw: unknown): WorkingHoursInterval | null {
	if (!raw || typeof raw !== 'object') return null
	const record = raw as Record<string, unknown>
	const start = typeof record['start'] === 'string' ? record['start'] : ''
	const end = typeof record['end'] === 'string' ? record['end'] : ''
	const startMin = minutesOfHHMM(start)
	const endMin = minutesOfHHMM(end)
	if (startMin === null || endMin === null || endMin <= startMin) return null
	return { start, end }
}

function normalizeIntervalList(raw: unknown): readonly WorkingHoursInterval[] {
	if (!Array.isArray(raw)) return []
	const intervals: WorkingHoursInterval[] = []
	for (const candidate of raw) {
		const interval = normalizeInterval(candidate)
		if (interval) intervals.push(interval)
		if (intervals.length >= MAX_INTERVALS_PER_DAY) break
	}
	return intervals.sort((a, b) => (minutesOfHHMM(a.start) ?? 0) - (minutesOfHHMM(b.start) ?? 0))
}

/**
 * Normalizes every historical shape of `working_hours` JSONB:
 * legacy `{}` (pre-M11 rows), a partial schedule, or a fully typed schedule.
 * Invalid intervals/timezones are dropped rather than throwing — reads must
 * never fail because a row predates the typed contract.
 */
export function normalizeWorkingHours(raw: unknown, fallbackTimezone = 'UTC'): WorkingHoursSchedule {
	const fallback = isValidIanaTimezone(fallbackTimezone) ? fallbackTimezone : 'UTC'
	if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return defaultWorkingHours(fallback)
	const record = raw as Record<string, unknown>
	const timezone =
		typeof record['timezone'] === 'string' && isValidIanaTimezone(record['timezone'])
			? record['timezone']
			: fallback
	const daysRecord =
		record['days'] && typeof record['days'] === 'object' && !Array.isArray(record['days'])
			? (record['days'] as Record<string, unknown>)
			: {}
	const days = emptyDays()
	for (const day of WEEKDAYS) {
		days[day] = normalizeIntervalList(daysRecord[day])
	}
	const hasAnyInterval = WEEKDAYS.some((day) => days[day].length > 0)
	return {
		enabled: record['enabled'] === true && hasAnyInterval,
		timezone,
		days
	}
}

export interface WorkingHoursValidation {
	readonly ok: boolean
	readonly errors: readonly string[]
	readonly normalized: WorkingHoursSchedule
}

export function validateWorkingHours(raw: unknown, fallbackTimezone = 'UTC'): WorkingHoursValidation {
	const errors: string[] = []
	if (!raw || typeof raw !== 'object' || Array.isArray(raw)) {
		return {
			ok: false,
			errors: ['working hours must be an object'],
			normalized: defaultWorkingHours(fallbackTimezone)
		}
	}
	const record = raw as Record<string, unknown>
	const timezone = record['timezone']
	if (typeof timezone !== 'string' || !isValidIanaTimezone(timezone)) {
		errors.push('timezone must be a valid IANA timezone')
	}
	const daysRecord = record['days']
	if (
		daysRecord !== undefined &&
		(typeof daysRecord !== 'object' || daysRecord === null || Array.isArray(daysRecord))
	) {
		errors.push('days must be an object')
	} else if (daysRecord && typeof daysRecord === 'object') {
		for (const [key, value] of Object.entries(daysRecord as Record<string, unknown>)) {
			if (!WEEKDAYS.includes(key as WeekdayKey)) {
				errors.push(`unknown weekday ${key}`)
				continue
			}
			if (!Array.isArray(value)) {
				errors.push(`${key} must be an array`)
				continue
			}
			if (value.length > MAX_INTERVALS_PER_DAY) {
				errors.push(`${key} supports at most ${MAX_INTERVALS_PER_DAY} intervals`)
			}
			for (const interval of value) {
				if (!normalizeInterval(interval)) errors.push(`${key} contains an invalid interval`)
			}
		}
	}
	const enabled = record['enabled']
	if (enabled !== undefined && typeof enabled !== 'boolean') errors.push('enabled must be a boolean')
	const normalized = normalizeWorkingHours(raw, fallbackTimezone)
	if (normalized.enabled && !WEEKDAYS.some((day) => normalized.days[day].length > 0)) {
		errors.push('working hours cannot be enabled without at least one interval')
	}
	return { ok: errors.length === 0, errors, normalized }
}

// ---------- timezone helpers ----------

interface ZonedParts {
	readonly year: number
	readonly month: number
	readonly day: number
	readonly hour: number
	readonly minute: number
	readonly weekday: WeekdayKey
}

const WEEKDAY_BY_INTL: Record<string, WeekdayKey> = {
	Mon: 'mon',
	Tue: 'tue',
	Wed: 'wed',
	Thu: 'thu',
	Fri: 'fri',
	Sat: 'sat',
	Sun: 'sun'
}

function zonedParts(at: Date, timezone: string): ZonedParts {
	const formatter = new Intl.DateTimeFormat('en-US', {
		timeZone: timezone,
		hour12: false,
		weekday: 'short',
		year: 'numeric',
		month: '2-digit',
		day: '2-digit',
		hour: '2-digit',
		minute: '2-digit'
	})
	const parts = formatter.formatToParts(at)
	const get = (type: string) => parts.find((p) => p.type === type)?.value ?? ''
	const hour = Number(get('hour')) % 24
	return {
		year: Number(get('year')),
		month: Number(get('month')),
		day: Number(get('day')),
		hour,
		minute: Number(get('minute')),
		weekday: WEEKDAY_BY_INTL[get('weekday')] ?? 'mon'
	}
}

function timezoneOffsetMs(at: Date, timezone: string): number {
	const p = zonedParts(at, timezone)
	const asUtc = Date.UTC(p.year, p.month - 1, p.day, p.hour, p.minute)
	return asUtc - (at.getTime() - (at.getTime() % 60_000))
}

/** Converts a local wall-clock time in `timezone` to a UTC instant (DST-safe). */
function zonedWallTimeToUtc(
	year: number,
	month: number,
	day: number,
	hour: number,
	minute: number,
	timezone: string
): Date {
	const target = Date.UTC(year, month - 1, day, hour, minute)
	let candidate = target
	for (let i = 0; i < 2; i++) {
		candidate = target - timezoneOffsetMs(new Date(candidate), timezone)
	}
	return new Date(candidate)
}

export function localTimeLabel(nowUtcIso: string, timezone: string): string | null {
	if (!isValidIanaTimezone(timezone)) return null
	const parts = zonedParts(new Date(nowUtcIso), timezone)
	return `${String(parts.hour).padStart(2, '0')}:${String(parts.minute).padStart(2, '0')}`
}

function isWithinWorkingHours(
	schedule: WorkingHoursSchedule,
	now: Date
): { within: boolean; nextStart: Date | null } {
	if (!schedule.enabled) return { within: true, nextStart: null }
	if (!isValidIanaTimezone(schedule.timezone)) return { within: true, nextStart: null }
	const today = zonedParts(now, schedule.timezone)

	for (let offset = 0; offset <= NEXT_AVAILABLE_HORIZON_DAYS; offset++) {
		const probe = new Date(now.getTime() + offset * 24 * 60 * 60 * 1000)
		const local = zonedParts(probe, schedule.timezone)
		const intervals = schedule.days[local.weekday]
		for (const interval of intervals) {
			const startMin = minutesOfHHMM(interval.start)
			const endMin = minutesOfHHMM(interval.end)
			if (startMin === null || endMin === null) continue
			// Use the offset's own calendar date for each interval.
			const start = zonedWallTimeToUtc(
				local.year,
				local.month,
				local.day,
				Math.floor(startMin / 60),
				startMin % 60,
				schedule.timezone
			)
			const end = zonedWallTimeToUtc(
				local.year,
				local.month,
				local.day,
				Math.floor(endMin / 60),
				endMin % 60,
				schedule.timezone
			)
			if (offset === 0 && now >= start && now < end) return { within: true, nextStart: null }
			if (start > now) return { within: false, nextStart: start }
		}
	}
	void today
	return { within: false, nextStart: null }
}

function isExpired(expiresAt: string | null, now: Date): boolean {
	if (!expiresAt) return false
	const at = Date.parse(expiresAt)
	return Number.isFinite(at) && at <= now.getTime()
}

function isActiveWindow(window: AvailabilityWindowLike, now: Date): boolean {
	const start = Date.parse(window.startsAt)
	const end = Date.parse(window.endsAt)
	return Number.isFinite(start) && Number.isFinite(end) && start <= now.getTime() && end > now.getTime()
}

export interface ResolveAvailabilityInput {
	readonly profile: AvailabilityProfileLike
	readonly windows?: readonly AvailabilityWindowLike[]
	readonly livePresence?: LivePresenceState
	readonly nowUtcIso: string
}

export function resolveEffectiveAvailability(input: ResolveAvailabilityInput): ResolvedAvailability {
	const now = new Date(input.nowUtcIso)
	const manualUnexpired =
		input.profile.manualState !== 'auto' && !isExpired(input.profile.manualStateExpiresAt, now)
	const activeWindows = (input.windows ?? []).filter((window) => isActiveWindow(window, now))
	const statusActive = !isExpired(input.profile.statusExpiresAt, now)
	const customStatusEmoji = statusActive ? input.profile.statusEmoji : null
	const customStatusText = statusActive ? input.profile.statusText : ''
	const livePresence = input.livePresence ?? 'offline'
	const schedule = normalizeWorkingHours(input.profile.workingHours, input.profile.timezone)
	const working = isWithinWorkingHours(schedule, now)

	const base = {
		userId: input.profile.userId,
		manualState: input.profile.manualState,
		statusEmoji: customStatusEmoji,
		statusText: customStatusText,
		statusExpiresAt: statusActive ? input.profile.statusExpiresAt : null,
		timezone: input.profile.timezone,
		withinWorkingHours: working.within,
		localTimeLabel: localTimeLabel(input.nowUtcIso, input.profile.timezone),
		livePresence,
		allowUrgentOverride: input.profile.allowUrgentOverride,
		suppressNotificationsOffHours: input.profile.suppressNotificationsOffHours
	} as const

	// 1. OOO
	const oooWindow = activeWindows.find((window) => window.kind === 'ooo') ?? null
	if (oooWindow || (manualUnexpired && input.profile.manualState === 'ooo')) {
		return {
			...base,
			state: 'ooo',
			activeWindow: oooWindow,
			delegateUserId: oooWindow?.delegateUserId ?? null,
			isRoutable: oooWindow ? !oooWindow.autoDeclineRouting : false,
			isAcceptingNotifications: oooWindow ? !oooWindow.suppressNotifications : false,
			nextAvailableAt: oooWindow?.endsAt ?? null
		}
	}

	// 2. DND
	const dndWindow = activeWindows.find((window) => window.kind === 'dnd') ?? null
	const dndUntilActive = input.profile.dndUntil !== null && !isExpired(input.profile.dndUntil, now)
	if (dndWindow || dndUntilActive || (manualUnexpired && input.profile.manualState === 'dnd')) {
		return {
			...base,
			state: 'dnd',
			activeWindow: dndWindow,
			delegateUserId: null,
			isRoutable: false,
			isAcceptingNotifications: false,
			nextAvailableAt: dndWindow?.endsAt ?? (dndUntilActive ? input.profile.dndUntil : null)
		}
	}

	// 3. Busy (focus window or manual busy)
	const focusWindow = activeWindows.find((window) => window.kind === 'focus') ?? null
	if (focusWindow || (manualUnexpired && input.profile.manualState === 'busy')) {
		return {
			...base,
			state: 'busy',
			activeWindow: focusWindow,
			delegateUserId: null,
			isRoutable: !focusWindow,
			isAcceptingNotifications: focusWindow ? !focusWindow.suppressNotifications : true,
			nextAvailableAt: focusWindow?.endsAt ?? null
		}
	}

	// 4. Manual available/away override
	if (manualUnexpired && input.profile.manualState === 'available') {
		return {
			...base,
			state: 'available',
			activeWindow: null,
			delegateUserId: null,
			isRoutable: true,
			isAcceptingNotifications: true,
			nextAvailableAt: working.nextStart?.toISOString() ?? null
		}
	}
	if (manualUnexpired && input.profile.manualState === 'away') {
		return {
			...base,
			state: 'away',
			activeWindow: null,
			delegateUserId: null,
			isRoutable: false,
			isAcceptingNotifications: true,
			nextAvailableAt: working.nextStart?.toISOString() ?? null
		}
	}

	// 5. Working hours (auto only)
	if (!working.within) {
		return {
			...base,
			state: 'off_hours',
			activeWindow: null,
			delegateUserId: null,
			isRoutable: false,
			isAcceptingNotifications: !input.profile.suppressNotificationsOffHours,
			nextAvailableAt: working.nextStart?.toISOString() ?? null
		}
	}

	// 6. Live presence (auto only)
	if (livePresence === 'online') {
		return {
			...base,
			state: 'available',
			activeWindow: null,
			delegateUserId: null,
			isRoutable: true,
			isAcceptingNotifications: true,
			nextAvailableAt: null
		}
	}
	if (livePresence === 'away') {
		return {
			...base,
			state: 'away',
			activeWindow: null,
			delegateUserId: null,
			isRoutable: false,
			isAcceptingNotifications: true,
			nextAvailableAt: null
		}
	}
	return {
		...base,
		state: 'offline',
		activeWindow: null,
		delegateUserId: null,
		isRoutable: false,
		isAcceptingNotifications: true,
		nextAvailableAt: working.nextStart?.toISOString() ?? null
	}
}

// ---------- Notification suppression ----------

export type NotificationSuppressionReason =
	| 'skipped_ooo'
	| 'skipped_dnd'
	| 'skipped_off_hours'
	| 'skipped_quiet_hours'

export interface NotificationSuppressionInput {
	readonly availability: Pick<ResolvedAvailability, 'state' | 'isAcceptingNotifications'>
	readonly nowUtcIso: string
	readonly quietHoursStart?: string | null | undefined
	readonly quietHoursEnd?: string | null | undefined
	readonly quietHoursTimezone?: string | null | undefined
	readonly allowUrgentOverride?: boolean
	/** True for approvals and direct urgent mentions. */
	readonly isUrgent?: boolean
}

export function evaluateNotificationSuppression(
	input: NotificationSuppressionInput
): NotificationSuppressionReason | null {
	const urgentOverride = input.isUrgent === true && input.allowUrgentOverride === true
	const { availability } = input
	// OOO is a hard boundary: even urgent items wait for the delegate/window end
	// when the user explicitly asked OOO to suppress notifications.
	if (availability.state === 'ooo' && !availability.isAcceptingNotifications) return 'skipped_ooo'
	if (availability.state === 'dnd' && !urgentOverride) return 'skipped_dnd'
	if (availability.state === 'off_hours' && !availability.isAcceptingNotifications && !urgentOverride) {
		return 'skipped_off_hours'
	}
	const quiet = isWithinQuietHours(
		input.nowUtcIso,
		input.quietHoursStart,
		input.quietHoursEnd,
		input.quietHoursTimezone || 'UTC'
	)
	if (quiet && !urgentOverride) return 'skipped_quiet_hours'
	return null
}

// ---------- Cross-platform warnings ----------

export interface AvailabilityWarning {
	readonly severity: 'info' | 'warning'
	readonly i18nKey: AvailabilityWarningKey
	readonly params: Readonly<Record<string, string | number>>
	readonly delegateUserId: string | null
}

export function buildAvailabilityWarning(
	effective: Pick<
		ResolvedAvailability,
		'state' | 'statusText' | 'nextAvailableAt' | 'delegateUserId' | 'activeWindow'
	>,
	displayName: string
): AvailabilityWarning | null {
	if (effective.state === 'ooo') {
		return {
			severity: 'warning',
			i18nKey: 'availability.warning.ooo',
			params: {
				name: displayName,
				title: effective.activeWindow?.title ?? effective.statusText,
				until: effective.nextAvailableAt ?? ''
			},
			delegateUserId: effective.delegateUserId
		}
	}
	if (effective.state === 'dnd') {
		return {
			severity: 'warning',
			i18nKey: 'availability.warning.dnd',
			params: { name: displayName, until: effective.nextAvailableAt ?? '' },
			delegateUserId: null
		}
	}
	if (effective.state === 'off_hours') {
		return {
			severity: 'info',
			i18nKey: 'availability.warning.offHours',
			params: { name: displayName, next: effective.nextAvailableAt ?? '' },
			delegateUserId: null
		}
	}
	if (effective.state === 'offline') {
		return {
			severity: 'info',
			i18nKey: 'availability.warning.offline',
			params: { name: displayName },
			delegateUserId: null
		}
	}
	return null
}

/** Convenience predicate for mail routing / assignment candidates. */
export function isAvailabilityRoutable(effective: Pick<ResolvedAvailability, 'isRoutable'>): boolean {
	return effective.isRoutable
}
