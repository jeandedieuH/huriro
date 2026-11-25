/**
 * Timeline/calendar date math for Tasks v2 (Ã‚§3.2). Pure: every date is an
 * injected ISO calendar date (`YYYY-MM-DD`); no clock or timezone is read.
 */

const ISO_DATE_RE = /^\d{4}-\d{2}-\d{2}$/
const DAY_MS = 86_400_000

export type TimelineZoom = 'week' | 'month' | 'quarter' | 'year'

export interface TimelineRange {
	readonly startDate: string
	readonly endDate: string
	readonly days: number
}

export interface TimelineBarGeometry {
	readonly leftPercent: number
	readonly widthPercent: number
	readonly startsClipped: boolean
	readonly endsClipped: boolean
}

function parseIsoDate(date: string, label = 'date'): number {
	if (!ISO_DATE_RE.test(date)) throw new RangeError(`Invalid ${label} "${date}": expected YYYY-MM-DD`)
	const ms = Date.parse(`${date}T00:00:00Z`)
	if (!Number.isFinite(ms)) throw new RangeError(`Invalid ${label} "${date}"`)
	return ms
}

export function formatIsoDate(ms: number): string {
	return new Date(ms).toISOString().slice(0, 10)
}

export function addDaysIso(date: string, days: number): string {
	if (!Number.isInteger(days)) throw new RangeError('days must be an integer')
	return formatIsoDate(parseIsoDate(date) + days * DAY_MS)
}

export function diffDaysIso(startDate: string, endDate: string): number {
	return Math.round((parseIsoDate(endDate, 'endDate') - parseIsoDate(startDate, 'startDate')) / DAY_MS)
}

export function todayIsoFromDate(now: Date): string {
	return now.toISOString().slice(0, 10)
}

/** Inclusive timeline range centered on `anchorDate` for one zoom level. */
export function timelineRangeForZoom(zoom: TimelineZoom, anchorDate: string): TimelineRange {
	parseIsoDate(anchorDate, 'anchorDate')
	const spanByZoom: Record<TimelineZoom, number> = { week: 14, month: 42, quarter: 120, year: 370 }
	const days = spanByZoom[zoom]
	const half = Math.floor(days / 2)
	const startDate = addDaysIso(anchorDate, -half)
	return { startDate, endDate: addDaysIso(startDate, days - 1), days }
}

/** Percent geometry for an inclusive date bar inside an inclusive range, clipped at edges. */
export function timelineBarGeometry(
	startDate: string,
	dueDate: string,
	range: TimelineRange
): TimelineBarGeometry | null {
	const startMs = parseIsoDate(startDate, 'startDate')
	const dueMs = parseIsoDate(dueDate, 'dueDate')
	if (dueMs < startMs) throw new RangeError('dueDate must be on or after startDate')
	const rangeStartMs = parseIsoDate(range.startDate, 'range.startDate')
	const rangeEndMs = parseIsoDate(range.endDate, 'range.endDate')
	if (dueMs < rangeStartMs || startMs > rangeEndMs) return null
	const clippedStart = Math.max(startMs, rangeStartMs)
	const clippedEnd = Math.min(dueMs, rangeEndMs)
	const leftDays = Math.round((clippedStart - rangeStartMs) / DAY_MS)
	const widthDays = Math.round((clippedEnd - clippedStart) / DAY_MS) + 1
	return {
		leftPercent: (leftDays / range.days) * 100,
		widthPercent: (widthDays / range.days) * 100,
		startsClipped: startMs < rangeStartMs,
		endsClipped: dueMs > rangeEndMs
	}
}

/** Shift both endpoints of a date span, preserving its duration. Null endpoints stay null. */
export function shiftDateSpan(
	span: { readonly startDate: string | null; readonly dueDate: string | null },
	days: number
): { readonly startDate: string | null; readonly dueDate: string | null } {
	if (!Number.isInteger(days) || days === 0) throw new RangeError('days must be a non-zero integer')
	if (span.startDate === null && span.dueDate === null) return span
	if (span.startDate === null) {
		const dueDate = addDaysIso(span.dueDate!, days)
		return { startDate: null, dueDate }
	}
	if (span.dueDate === null) {
		const startDate = addDaysIso(span.startDate, days)
		return { startDate, dueDate: startDate }
	}
	return { startDate: addDaysIso(span.startDate, days), dueDate: addDaysIso(span.dueDate, days) }
}

/** Resize one edge of a date span; never allows end before start. */
export function resizeDateSpan(
	span: { readonly startDate: string; readonly dueDate: string },
	edge: 'start' | 'end',
	days: number
): { readonly startDate: string; readonly dueDate: string } {
	if (!Number.isInteger(days) || days === 0) throw new RangeError('days must be a non-zero integer')
	if (edge === 'start') {
		const next = addDaysIso(span.startDate, days)
		return { startDate: next > span.dueDate ? span.dueDate : next, dueDate: span.dueDate }
	}
	const next = addDaysIso(span.dueDate, days)
	return { startDate: span.startDate, dueDate: next < span.startDate ? span.startDate : next }
}

/** Six-week month grid used by Calendar view; includes leading/trailing adjacent-month days. */
export function calendarMonthGrid(year: number, monthIndex: number, weekStartsOn: 0 | 1 = 1): string[][] {
	if (!Number.isInteger(year) || !Number.isInteger(monthIndex) || monthIndex < 0 || monthIndex > 11) {
		throw new RangeError('Invalid calendar month')
	}
	const first = formatIsoDate(Date.UTC(year, monthIndex, 1))
	const firstDow = new Date(parseIsoDate(first)).getUTCDay()
	const leading = (firstDow - weekStartsOn + 7) % 7
	const gridStart = addDaysIso(first, -leading)
	return Array.from({ length: 6 }, (_, week) =>
		Array.from({ length: 7 }, (_, day) => addDaysIso(gridStart, week * 7 + day))
	)
}
