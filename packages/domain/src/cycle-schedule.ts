/**
 * Cycle scheduling math for the full cycles engine (§3.3). Pure: every date
 * is injected as an ISO calendar-date string ('YYYY-MM-DD'); no clock is read.
 *
 * All arithmetic is UTC calendar math — a date string is a day, not an
 * instant, so timezone never enters the computation.
 *
 * Window semantics: a cycle window is INCLUSIVE of both endpoints — a
 * 14-day cycle starting Monday ends on the Sunday 13 days later
 * (`endsAt = startsAt + durationDays - 1`). The next window's earliest
 * possible start is the day after the previous end plus `cooldownDays`
 * rest days, aligned forward to the project's start weekday.
 */

export interface CyclePolicy {
	readonly durationDays: number
	readonly cooldownDays: number
	/** 0 = Sunday … 6 = Saturday (mirrors `Date#getUTCDay`). */
	readonly startWeekday: number
	readonly rolloverMode: 'next_cycle' | 'backlog' | 'none'
}

export interface CycleWindow {
	readonly startsAt: string
	readonly endsAt: string
}

const ISO_DATE_RE = /^\d{4}-\d{2}-\d{2}$/
const DAY_MS = 86_400_000

function parseIsoDate(date: string, label: string): number {
	if (!ISO_DATE_RE.test(date)) {
		throw new RangeError(`Invalid ${label} date "${date}": expected 'YYYY-MM-DD'`)
	}
	const ms = Date.parse(`${date}T00:00:00Z`)
	if (!Number.isFinite(ms)) {
		throw new RangeError(`Invalid ${label} date "${date}"`)
	}
	return ms
}

function formatIsoDate(ms: number): string {
	return new Date(ms).toISOString().slice(0, 10)
}

function addDays(date: string, days: number): string {
	return formatIsoDate(parseIsoDate(date, 'input') + days * DAY_MS)
}

/** UTC weekday of an ISO date string: 0 = Sunday … 6 = Saturday. */
function weekdayOf(date: string): number {
	return new Date(parseIsoDate(date, 'input')).getUTCDay()
}

function assertWeekday(startWeekday: number): void {
	if (!Number.isInteger(startWeekday) || startWeekday < 0 || startWeekday > 6) {
		throw new RangeError(`startWeekday must be an integer in 0..6, got ${startWeekday}`)
	}
}

/**
 * The next ('forward') or previous ('backward') occurrence of `startWeekday`.
 * A date already on the weekday stays put in both directions — 'forward'
 * never moves into the past, 'backward' never into the future.
 */
export function alignToWeekday(
	date: string,
	startWeekday: number,
	direction: 'forward' | 'backward'
): string {
	assertWeekday(startWeekday)
	const dow = weekdayOf(date)
	if (direction === 'forward') {
		return addDays(date, (startWeekday - dow + 7) % 7)
	}
	return addDays(date, -((dow - startWeekday + 7) % 7))
}

/**
 * The window of the cycle that follows `afterEndDate` under `policy`.
 *
 * Start = the first `startWeekday` on or after max(today, afterEnd + 1 +
 * cooldownDays) — the alignment floors at today so a dormant project does
 * not backfill a chain of missed cycles. Because the floor is today the
 * start can never be in the past relative to today; callers still own the
 * decision of what to do with the returned window.
 */
export function nextCycleWindow(
	afterEndDate: string | null,
	policy: CyclePolicy,
	today: string
): CycleWindow {
	parseIsoDate(today, 'today')
	let candidate = today
	if (afterEndDate !== null) {
		const earliest = addDays(afterEndDate, 1 + policy.cooldownDays)
		candidate = earliest > today ? earliest : today
	}
	const startsAt = alignToWeekday(candidate, policy.startWeekday, 'forward')
	return { startsAt, endsAt: addDays(startsAt, policy.durationDays - 1) }
}

function windowKey(w: CycleWindow): string {
	return `${w.startsAt}|${w.endsAt}`
}

/**
 * Windows the nightly worker should pre-create so at least `minAhead` FUTURE
 * cycles (startsAt strictly after today) are always planned (§3.3).
 *
 * The chain continues after the LATEST existing end (or from today when
 * empty), each window separated by `cooldownDays` via `nextCycleWindow`.
 * Windows starting exactly today are emitted — chain continuity depends on
 * them — but do not count toward the future quota. Output is capped at 4
 * windows and never duplicates an existing (or already-emitted) window; a
 * duplicate is skipped without counting toward the quota.
 */
export function windowsToPreCreate(
	existing: readonly CycleWindow[],
	policy: CyclePolicy,
	today: string,
	minAhead = 2
): CycleWindow[] {
	parseIsoDate(today, 'today')
	const seen = new Set(existing.map(windowKey))
	let futureCount = 0
	let latestEnd: string | null = null
	for (const w of existing) {
		if (w.startsAt > today) futureCount++
		if (latestEnd === null || w.endsAt > latestEnd) latestEnd = w.endsAt
	}
	if (futureCount >= minAhead) return []

	const out: CycleWindow[] = []
	let afterEnd = latestEnd
	// The cap is the loop bound: each iteration either emits one window or
	// skips a duplicate, and every iteration advances `afterEnd` strictly
	// forward, so the chain cannot stall.
	while (futureCount < minAhead && out.length < 4) {
		const w = nextCycleWindow(afterEnd, policy, today)
		afterEnd = w.endsAt
		const key = windowKey(w)
		if (seen.has(key)) continue
		seen.add(key)
		out.push(w)
		if (w.startsAt > today) futureCount++
	}
	return out
}

/** A planned cycle whose start day has arrived activates — unless one is already active. */
export function isCycleDueToActivate(
	c: { readonly status: string; readonly startsAt: string },
	today: string,
	hasActive: boolean
): boolean {
	return !hasActive && c.status === 'planned' && c.startsAt <= today
}

/** An active cycle past its end day completes on the next maintenance run. */
export function isCycleDueToComplete(
	c: { readonly status: string; readonly endsAt: string },
	today: string
): boolean {
	return c.status === 'active' && c.endsAt < today
}
