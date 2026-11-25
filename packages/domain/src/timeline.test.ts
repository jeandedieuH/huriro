import { describe, expect, test } from 'bun:test'
import {
	calendarMonthGrid,
	resizeDateSpan,
	shiftDateSpan,
	timelineBarGeometry,
	timelineRangeForZoom
} from './timeline'

describe('timeline date math', () => {
	test('builds inclusive zoom ranges', () => {
		const range = timelineRangeForZoom('week', '2026-03-10')
		expect(range.days).toBe(14)
		expect(range.endDate >= range.startDate).toBe(true)
	})

	test('clips inclusive bar geometry at range edges', () => {
		const geometry = timelineBarGeometry('2026-03-01', '2026-03-20', {
			startDate: '2026-03-05',
			endDate: '2026-03-11',
			days: 7
		})
		expect(geometry?.startsClipped).toBe(true)
		expect(geometry?.endsClipped).toBe(true)
		expect(geometry?.leftPercent).toBe(0)
		expect(geometry?.widthPercent).toBe(100)
	})

	test('shifts spans preserving duration and handles due-only spans', () => {
		expect(shiftDateSpan({ startDate: '2026-03-01', dueDate: '2026-03-03' }, 2)).toEqual({
			startDate: '2026-03-03',
			dueDate: '2026-03-05'
		})
		expect(shiftDateSpan({ startDate: null, dueDate: '2026-03-03' }, 1)).toEqual({
			startDate: null,
			dueDate: '2026-03-04'
		})
	})

	test('resizes without inverting the span', () => {
		expect(resizeDateSpan({ startDate: '2026-03-03', dueDate: '2026-03-04' }, 'start', 5)).toEqual({
			startDate: '2026-03-04',
			dueDate: '2026-03-04'
		})
	})

	test('calendar grid is always six weeks', () => {
		const weeks = calendarMonthGrid(2026, 2, 1)
		expect(weeks).toHaveLength(6)
		expect(weeks.every((week) => week.length === 7)).toBe(true)
	})
})
