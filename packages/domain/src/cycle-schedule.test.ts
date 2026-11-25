import { describe, expect, test } from 'bun:test'
import {
	alignToWeekday,
	type CyclePolicy,
	isCycleDueToActivate,
	isCycleDueToComplete,
	nextCycleWindow,
	windowsToPreCreate
} from './cycle-schedule'

const MON: CyclePolicy = { durationDays: 14, cooldownDays: 0, startWeekday: 1, rolloverMode: 'next_cycle' }

describe('alignToWeekday', () => {
	test('forward: already on the weekday stays put', () => {
		// 2026-02-23 is a Monday.
		expect(alignToWeekday('2026-02-23', 1, 'forward')).toBe('2026-02-23')
	})

	test('forward: rolls into the next week when the weekday just passed', () => {
		// Tuesday 2026-02-24 → next Monday is 2026-03-02 (6 days ahead).
		expect(alignToWeekday('2026-02-24', 1, 'forward')).toBe('2026-03-02')
	})

	test('forward: same week when the weekday is still ahead', () => {
		// Monday → Friday of the same week.
		expect(alignToWeekday('2026-02-23', 5, 'forward')).toBe('2026-02-27')
	})

	test('forward: Sunday target wraps across the week boundary', () => {
		// Monday 2026-02-23 → next Sunday (0) is 2026-03-01.
		expect(alignToWeekday('2026-02-23', 0, 'forward')).toBe('2026-03-01')
	})

	test('backward: already on the weekday stays put', () => {
		expect(alignToWeekday('2026-02-23', 1, 'backward')).toBe('2026-02-23')
	})

	test('backward: rewinds into the previous week', () => {
		// Monday 2026-02-23 → previous Friday is 2026-02-20.
		expect(alignToWeekday('2026-02-23', 5, 'backward')).toBe('2026-02-20')
	})

	test('backward: previous occurrence across month boundary', () => {
		// Sunday 2026-03-01 → previous Monday is 2026-02-23.
		expect(alignToWeekday('2026-03-01', 1, 'backward')).toBe('2026-02-23')
	})

	test('rejects invalid weekday and malformed dates', () => {
		expect(() => alignToWeekday('2026-02-23', 7, 'forward')).toThrow(RangeError)
		expect(() => alignToWeekday('23-02-2026', 1, 'forward')).toThrow(RangeError)
	})
})

describe('nextCycleWindow', () => {
	test('null afterEnd: aligns today forward, end is duration-1 days later', () => {
		// Tuesday 2026-02-24, Monday start → 2026-03-02 + 13 days = 2026-03-15.
		const w = nextCycleWindow(null, MON, '2026-02-24')
		expect(w).toEqual({ startsAt: '2026-03-02', endsAt: '2026-03-15' })
	})

	test('null afterEnd on the weekday itself starts today', () => {
		const w = nextCycleWindow(null, MON, '2026-02-23')
		expect(w.startsAt).toBe('2026-02-23')
		expect(w.endsAt).toBe('2026-03-08')
	})

	test('cooldown pushes the earliest start out before alignment', () => {
		const policy: CyclePolicy = { ...MON, cooldownDays: 2 }
		// Previous cycle ends Monday 2026-02-23 → earliest start Thursday 02-26
		// → aligned forward to Monday 2026-03-02.
		const w = nextCycleWindow('2026-02-23', policy, '2026-02-20')
		expect(w.startsAt).toBe('2026-03-02')
		expect(w.endsAt).toBe('2026-03-15')
	})

	test('zero cooldown: day after the previous end, aligned forward', () => {
		// Ends Sunday 2026-03-08 → earliest Monday 03-09, already a Monday.
		const w = nextCycleWindow('2026-03-08', MON, '2026-02-20')
		expect(w).toEqual({ startsAt: '2026-03-09', endsAt: '2026-03-22' })
	})

	test('dormant project floors at today instead of backfilling missed cycles', () => {
		// Previous end is months stale — the chain must not restart in the past.
		const w = nextCycleWindow('2025-01-01', MON, '2026-02-24')
		expect(w.startsAt).toBe('2026-03-02')
		expect(w.startsAt >= '2026-02-24').toBe(true)
	})
})

describe('windowsToPreCreate', () => {
	test('empty existing set produces minAhead future windows continuing from today', () => {
		// Monday 2026-02-23 IS the weekday: first window starts today (not
		// future), so a third window is chained to reach 2 futures.
		const out = windowsToPreCreate([], MON, '2026-02-23')
		expect(out.length).toBe(3)
		expect(out[0]).toEqual({ startsAt: '2026-02-23', endsAt: '2026-03-08' })
		expect(out[1]).toEqual({ startsAt: '2026-03-09', endsAt: '2026-03-22' })
		expect(out[2]).toEqual({ startsAt: '2026-03-23', endsAt: '2026-04-05' })
	})

	test('empty existing set mid-week: both windows are future', () => {
		const out = windowsToPreCreate([], MON, '2026-02-24')
		expect(out.length).toBe(2)
		expect(out[0]?.startsAt).toBe('2026-03-02')
		expect(out[1]?.startsAt).toBe('2026-03-16')
	})

	test('enough future windows → nothing to create', () => {
		const existing = [
			{ startsAt: '2026-03-02', endsAt: '2026-03-15' },
			{ startsAt: '2026-03-16', endsAt: '2026-03-29' }
		]
		expect(windowsToPreCreate(existing, MON, '2026-02-24')).toEqual([])
	})

	test('partial coverage tops up continuing after the latest end', () => {
		const existing = [{ startsAt: '2026-03-02', endsAt: '2026-03-15' }]
		const out = windowsToPreCreate(existing, MON, '2026-02-24')
		expect(out).toEqual([{ startsAt: '2026-03-16', endsAt: '2026-03-29' }])
	})

	test('windows starting exactly today do not count toward the future quota', () => {
		// One existing window starts today: future count is 0 → both quota
		// windows must come after it.
		const existing = [{ startsAt: '2026-02-23', endsAt: '2026-03-08' }]
		const out = windowsToPreCreate(existing, MON, '2026-02-23')
		expect(out.length).toBe(2)
		expect(out[0]?.startsAt).toBe('2026-03-09')
		expect(out[1]?.startsAt).toBe('2026-03-23')
	})

	test('never duplicates an existing window', () => {
		// The 03-09 window already exists (manually created, not the latest
		// end) — the chain would regenerate it; it must be skipped, not emitted.
		const existing = [
			{ startsAt: '2026-02-23', endsAt: '2026-03-08' },
			{ startsAt: '2026-03-09', endsAt: '2026-03-22' }
		]
		const out = windowsToPreCreate(existing, MON, '2026-02-23')
		for (const w of out) {
			expect(existing.some((e) => e.startsAt === w.startsAt && e.endsAt === w.endsAt)).toBe(false)
		}
		expect(out).toEqual([{ startsAt: '2026-03-23', endsAt: '2026-04-05' }])
	})

	test('output is capped at 4 even with a large minAhead', () => {
		const out = windowsToPreCreate([], MON, '2026-02-24', 10)
		expect(out.length).toBe(4)
	})

	test('cooldown separates consecutive windows', () => {
		const policy: CyclePolicy = { ...MON, cooldownDays: 3 }
		const out = windowsToPreCreate([], policy, '2026-02-24')
		expect(out.length).toBe(2)
		// First: aligned from today → 2026-03-02..03-15; earliest next start is
		// 03-16 + 3 cooldown = 03-19 → aligned forward to Monday 03-23.
		expect(out[0]).toEqual({ startsAt: '2026-03-02', endsAt: '2026-03-15' })
		expect(out[1]).toEqual({ startsAt: '2026-03-23', endsAt: '2026-04-05' })
	})

	test('past-only existing windows continue after the latest end floored at today', () => {
		// Cycle ended long ago — pre-creation restarts from today, not 2025.
		const existing = [{ startsAt: '2025-11-03', endsAt: '2025-11-16' }]
		const out = windowsToPreCreate(existing, MON, '2026-02-24')
		expect(out.length).toBe(2)
		expect(out[0]?.startsAt).toBe('2026-03-02')
	})
})

describe('activation/completion predicates', () => {
	test('isCycleDueToActivate', () => {
		const planned = { status: 'planned', startsAt: '2026-02-23' }
		expect(isCycleDueToActivate(planned, '2026-02-23', false)).toBe(true)
		expect(isCycleDueToActivate(planned, '2026-02-24', false)).toBe(true)
		expect(isCycleDueToActivate(planned, '2026-02-22', false)).toBe(false)
		expect(isCycleDueToActivate(planned, '2026-02-24', true)).toBe(false)
		expect(isCycleDueToActivate({ status: 'active', startsAt: '2026-02-23' }, '2026-02-24', false)).toBe(
			false
		)
		expect(isCycleDueToActivate({ status: 'completed', startsAt: '2026-02-23' }, '2026-02-24', false)).toBe(
			false
		)
	})

	test('isCycleDueToComplete', () => {
		const active = { status: 'active', endsAt: '2026-03-08' }
		expect(isCycleDueToComplete(active, '2026-03-09')).toBe(true)
		expect(isCycleDueToComplete(active, '2026-03-08')).toBe(false)
		expect(isCycleDueToComplete({ status: 'planned', endsAt: '2026-03-08' }, '2026-03-09')).toBe(false)
		expect(isCycleDueToComplete({ status: 'completed', endsAt: '2026-03-08' }, '2026-03-09')).toBe(false)
	})
})
