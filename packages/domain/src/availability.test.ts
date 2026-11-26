import { describe, expect, test } from 'bun:test'
import {
	type AvailabilityProfileLike,
	type AvailabilityWindowLike,
	buildAvailabilityWarning,
	defaultWorkingHours,
	evaluateNotificationSuppression,
	isValidIanaTimezone,
	localTimeLabel,
	normalizeWorkingHours,
	resolveEffectiveAvailability,
	validateWorkingHours
} from './availability'

const baseProfile: AvailabilityProfileLike = {
	userId: 'u1',
	manualState: 'auto',
	manualStateExpiresAt: null,
	statusEmoji: null,
	statusText: '',
	statusExpiresAt: null,
	dndUntil: null,
	workingHours: {},
	timezone: 'UTC',
	suppressNotificationsOffHours: false,
	allowUrgentOverride: true
}

function profile(overrides: Partial<AvailabilityProfileLike>): AvailabilityProfileLike {
	return { ...baseProfile, ...overrides }
}

function window(overrides: Partial<AvailabilityWindowLike>): AvailabilityWindowLike {
	return {
		id: 'w1',
		kind: 'ooo',
		title: 'Vacation',
		message: '',
		startsAt: '2026-11-26T08:00:00.000Z',
		endsAt: '2026-11-27T08:00:00.000Z',
		delegateUserId: 'u2',
		autoDeclineRouting: true,
		suppressNotifications: true,
		...overrides
	}
}

const weekdaySchedule = normalizeWorkingHours({
	enabled: true,
	timezone: 'UTC',
	days: {
		mon: [{ start: '09:00', end: '17:00' }],
		tue: [{ start: '09:00', end: '17:00' }],
		wed: [{ start: '09:00', end: '17:00' }],
		thu: [{ start: '09:00', end: '17:00' }],
		fri: [{ start: '09:00', end: '17:00' }]
	}
})

describe('working hours normalization', () => {
	test('legacy {} becomes a disabled UTC schedule', () => {
		const schedule = normalizeWorkingHours({})
		expect(schedule.enabled).toBe(false)
		expect(schedule.timezone).toBe('UTC')
		expect(schedule.days.mon).toEqual([])
	})

	test('drops invalid intervals and caps split shifts', () => {
		const schedule = normalizeWorkingHours({
			enabled: true,
			timezone: 'Europe/Berlin',
			days: {
				mon: [
					{ start: '09:00', end: '12:00' },
					{ start: '12:00', end: '12:00' },
					{ start: '13:00', end: '17:00' },
					{ start: '18:00', end: '20:00' },
					{ start: '21:00', end: '22:00' }
				]
			}
		})
		expect(schedule.days.mon).toHaveLength(4)
		expect(schedule.days.mon[0]).toEqual({ start: '09:00', end: '12:00' })
	})

	test('validates IANA timezones and interval shape', () => {
		expect(isValidIanaTimezone('America/New_York')).toBe(true)
		expect(isValidIanaTimezone('Not/AZone')).toBe(false)
		const bad = validateWorkingHours({ enabled: true, timezone: 'Nope/Nope', days: { mon: [] } })
		expect(bad.ok).toBe(false)
		const good = validateWorkingHours({
			enabled: true,
			timezone: 'Europe/Berlin',
			days: { mon: [{ start: '09:00', end: '17:00' }] }
		})
		expect(good.ok).toBe(true)
	})

	test('exposes a local time label', () => {
		expect(localTimeLabel('2026-11-26T15:04:00.000Z', 'UTC')).toBe('15:04')
	})
})

describe('resolveEffectiveAvailability precedence', () => {
	const now = '2026-11-26T15:00:00.000Z'

	test('OOO window wins and carries the delegate', () => {
		const resolved = resolveEffectiveAvailability({
			profile: profile({ workingHours: weekdaySchedule }),
			windows: [window({})],
			livePresence: 'online',
			nowUtcIso: now
		})
		expect(resolved.state).toBe('ooo')
		expect(resolved.delegateUserId).toBe('u2')
		expect(resolved.isRoutable).toBe(false)
		expect(resolved.isAcceptingNotifications).toBe(false)
		expect(resolved.nextAvailableAt).toBe('2026-11-27T08:00:00.000Z')
	})

	test('manual ooo without a window still wins', () => {
		const resolved = resolveEffectiveAvailability({
			profile: profile({ manualState: 'ooo' }),
			livePresence: 'online',
			nowUtcIso: now
		})
		expect(resolved.state).toBe('ooo')
		expect(resolved.isRoutable).toBe(false)
	})

	test('dnd_until beats focus and presence', () => {
		const resolved = resolveEffectiveAvailability({
			profile: profile({ dndUntil: '2026-11-26T16:00:00.000Z' }),
			windows: [window({ kind: 'focus', startsAt: now, endsAt: '2026-11-26T17:00:00.000Z' })],
			livePresence: 'online',
			nowUtcIso: now
		})
		expect(resolved.state).toBe('dnd')
		expect(resolved.isRoutable).toBe(false)
		expect(resolved.isAcceptingNotifications).toBe(false)
	})

	test('focus window is busy and not routable', () => {
		const resolved = resolveEffectiveAvailability({
			profile: profile({}),
			windows: [
				window({
					kind: 'focus',
					startsAt: '2026-11-26T14:00:00.000Z',
					endsAt: '2026-11-26T17:00:00.000Z'
				})
			],
			livePresence: 'online',
			nowUtcIso: now
		})
		expect(resolved.state).toBe('busy')
		expect(resolved.isRoutable).toBe(false)
	})

	test('unexpired manual available overrides presence and off-hours', () => {
		const resolved = resolveEffectiveAvailability({
			profile: profile({
				manualState: 'available',
				manualStateExpiresAt: '2026-11-26T18:00:00.000Z',
				workingHours: weekdaySchedule,
				timezone: 'UTC'
			}),
			livePresence: 'offline',
			nowUtcIso: '2026-11-26T08:00:00.000Z'
		})
		expect(resolved.state).toBe('available')
		expect(resolved.withinWorkingHours).toBe(false)
	})

	test('expired manual override falls back to working hours', () => {
		const resolved = resolveEffectiveAvailability({
			profile: profile({
				manualState: 'busy',
				manualStateExpiresAt: '2026-11-26T14:00:00.000Z',
				workingHours: weekdaySchedule
			}),
			livePresence: 'online',
			nowUtcIso: now
		})
		expect(resolved.state).toBe('available')
	})

	test('off-hours suppresses routing and computes the next window', () => {
		const resolved = resolveEffectiveAvailability({
			profile: profile({ workingHours: weekdaySchedule }),
			livePresence: 'online',
			nowUtcIso: '2026-11-26T18:00:00.000Z'
		})
		expect(resolved.state).toBe('off_hours')
		expect(resolved.isRoutable).toBe(false)
		expect(resolved.isAcceptingNotifications).toBe(true)
		expect(resolved.nextAvailableAt).toBe('2026-11-27T09:00:00.000Z')
	})

	test('off-hours respects the suppression opt-in', () => {
		const resolved = resolveEffectiveAvailability({
			profile: profile({ workingHours: weekdaySchedule, suppressNotificationsOffHours: true }),
			livePresence: 'online',
			nowUtcIso: '2026-11-26T18:00:00.000Z'
		})
		expect(resolved.isAcceptingNotifications).toBe(false)
	})

	test('split shifts find the next interval', () => {
		const schedule = normalizeWorkingHours({
			enabled: true,
			timezone: 'UTC',
			days: {
				thu: [
					{ start: '09:00', end: '12:00' },
					{ start: '13:00', end: '17:00' }
				]
			}
		})
		const resolved = resolveEffectiveAvailability({
			profile: profile({ workingHours: schedule }),
			livePresence: 'online',
			nowUtcIso: '2026-11-26T12:30:00.000Z'
		})
		expect(resolved.state).toBe('off_hours')
		expect(resolved.nextAvailableAt).toBe('2026-11-26T13:00:00.000Z')
	})

	test('live presence drives auto state', () => {
		const online = resolveEffectiveAvailability({
			profile: profile({}),
			livePresence: 'online',
			nowUtcIso: now
		})
		expect(online.state).toBe('available')
		const away = resolveEffectiveAvailability({ profile: profile({}), livePresence: 'away', nowUtcIso: now })
		expect(away.state).toBe('away')
		const offline = resolveEffectiveAvailability({
			profile: profile({}),
			livePresence: 'offline',
			nowUtcIso: now
		})
		expect(offline.state).toBe('offline')
	})

	test('expired custom status is stripped', () => {
		const resolved = resolveEffectiveAvailability({
			profile: profile({
				statusEmoji: '🌴',
				statusText: 'Vacation',
				statusExpiresAt: '2026-11-26T14:00:00.000Z'
			}),
			livePresence: 'online',
			nowUtcIso: now
		})
		expect(resolved.statusEmoji).toBeNull()
		expect(resolved.statusText).toBe('')
	})

	test('disabled working hours never produce off_hours', () => {
		const resolved = resolveEffectiveAvailability({
			profile: profile({ workingHours: defaultWorkingHours() }),
			livePresence: 'online',
			nowUtcIso: '2026-11-26T03:00:00.000Z'
		})
		expect(resolved.state).toBe('available')
	})
})

describe('notification suppression', () => {
	const now = '2026-11-26T15:00:00.000Z'

	test('OOO is a hard boundary even for urgent items', () => {
		expect(
			evaluateNotificationSuppression({
				availability: { state: 'ooo', isAcceptingNotifications: false },
				nowUtcIso: now,
				allowUrgentOverride: true,
				isUrgent: true
			})
		).toBe('skipped_ooo')
	})

	test('urgent approvals bypass DND but not quiet hours', () => {
		expect(
			evaluateNotificationSuppression({
				availability: { state: 'dnd', isAcceptingNotifications: false },
				nowUtcIso: now,
				allowUrgentOverride: true,
				isUrgent: true
			})
		).toBeNull()
		expect(
			evaluateNotificationSuppression({
				availability: { state: 'available', isAcceptingNotifications: true },
				nowUtcIso: now,
				quietHoursStart: '14:00',
				quietHoursEnd: '16:00',
				quietHoursTimezone: 'UTC',
				allowUrgentOverride: true,
				isUrgent: true
			})
		).toBeNull()
	})

	test('quiet hours fallback remains', () => {
		expect(
			evaluateNotificationSuppression({
				availability: { state: 'available', isAcceptingNotifications: true },
				nowUtcIso: now,
				quietHoursStart: '14:00',
				quietHoursEnd: '16:00',
				quietHoursTimezone: 'UTC'
			})
		).toBe('skipped_quiet_hours')
	})

	test('off-hours suppression only when opted in', () => {
		expect(
			evaluateNotificationSuppression({
				availability: { state: 'off_hours', isAcceptingNotifications: false },
				nowUtcIso: now
			})
		).toBe('skipped_off_hours')
		expect(
			evaluateNotificationSuppression({
				availability: { state: 'off_hours', isAcceptingNotifications: true },
				nowUtcIso: now
			})
		).toBeNull()
	})
})

describe('warnings', () => {
	test('builds a delegate warning for OOO', () => {
		const resolved = resolveEffectiveAvailability({
			profile: profile({}),
			windows: [window({})],
			nowUtcIso: '2026-11-26T15:00:00.000Z'
		})
		const warning = buildAvailabilityWarning(resolved, 'Ada')
		expect(warning?.i18nKey).toBe('availability.warning.ooo')
		expect(warning?.delegateUserId).toBe('u2')
	})

	test('returns null for available users', () => {
		const resolved = resolveEffectiveAvailability({
			profile: profile({}),
			livePresence: 'online',
			nowUtcIso: '2026-11-26T15:00:00.000Z'
		})
		expect(buildAvailabilityWarning(resolved, 'Ada')).toBeNull()
	})
})
