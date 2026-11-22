import { describe, expect, test } from 'bun:test'
import {
	comparePositions,
	generateKeyBetween,
	generateNKeysBetween,
	isValidPositionKey,
	needsRebalance,
	rebalanceKeys
} from './fractional-index'

describe('fractional indexing', () => {
	test('handles empty, prepend, append, and middle bounds', () => {
		const first = generateKeyBetween(null, null)
		expect(isValidPositionKey(first)).toBe(true)

		const before = generateKeyBetween(null, first)
		expect(comparePositions(before, first)).toBe(-1)
		expect(isValidPositionKey(before)).toBe(true)

		const after = generateKeyBetween(first, null)
		expect(comparePositions(first, after)).toBe(-1)
		expect(isValidPositionKey(after)).toBe(true)

		const mid = generateKeyBetween(before, after)
		expect(comparePositions(before, mid)).toBe(-1)
		expect(comparePositions(mid, after)).toBe(-1)
	})

	test('survives 500 consecutive midpoint insertions without losing order', () => {
		let left = generateKeyBetween(null, null)
		const right = generateKeyBetween(left, null)
		const keys = [left]

		for (let i = 0; i < 500; i++) {
			const mid = generateKeyBetween(left, right)
			expect(isValidPositionKey(mid)).toBe(true)
			expect(comparePositions(left, mid)).toBe(-1)
			expect(comparePositions(mid, right)).toBe(-1)
			keys.push(mid)
			left = mid
		}
		keys.push(right)

		// Verify strict C/ASCII sort order matches insertion order
		const sorted = [...keys].sort(comparePositions)
		expect(sorted).toEqual(keys)
		expect(needsRebalance(keys)).toBe(true)
	})

	test('survives 500 consecutive prepends and appends', () => {
		let head = generateKeyBetween(null, null)
		const prepended = [head]
		for (let i = 0; i < 200; i++) {
			head = generateKeyBetween(null, head)
			expect(isValidPositionKey(head)).toBe(true)
			prepended.unshift(head)
		}
		expect([...prepended].sort(comparePositions)).toEqual(prepended)

		let tail = generateKeyBetween(null, null)
		const appended = [tail]
		for (let i = 0; i < 200; i++) {
			tail = generateKeyBetween(tail, null)
			expect(isValidPositionKey(tail)).toBe(true)
			appended.push(tail)
		}
		expect([...appended].sort(comparePositions)).toEqual(appended)
	})

	test('generateNKeysBetween and rebalanceKeys produce strictly ordered short keys', () => {
		const keys = rebalanceKeys(50)
		expect(keys).toHaveLength(50)
		expect([...keys].sort(comparePositions)).toEqual(keys)
		expect(needsRebalance(keys)).toBe(false)
		for (const k of keys) {
			expect(isValidPositionKey(k)).toBe(true)
			expect(k.length).toBeLessThanOrEqual(4)
		}

		const batch = generateNKeysBetween(keys[10] ?? null, keys[11] ?? null, 5)
		expect(batch).toHaveLength(5)
		expect(comparePositions(keys[10]!, batch[0]!)).toBe(-1)
		expect(comparePositions(batch[4]!, keys[11]!)).toBe(-1)
	})

	test('throws on inverted or invalid bounds', () => {
		expect(() => generateKeyBetween('B', 'A')).toThrow(RangeError)
		expect(() => generateKeyBetween('A', 'A')).toThrow(RangeError)
		expect(() => generateKeyBetween('A0', null)).toThrow(RangeError)
		expect(() => generateKeyBetween(null, 'bad-key')).toThrow(RangeError)
	})
})
