/**
 * Lexicographic fractional indexing in base-62 (§8.1).
 *
 * Alphabet order matches ASCII / PostgreSQL `COLLATE "C"` bytewise order:
 *   '0'..'9' (48..57) < 'A'..'Z' (65..90) < 'a'..'z' (97..122)
 *
 * Invariant: valid keys are non-empty base-62 strings that NEVER end in '0',
 * guaranteeing a midpoint key always exists between any two ordered keys without
 * precision exhaustion (unlike IEEE-754 floats which stall after ~53 bisections).
 */

const DIGITS = '0123456789ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz'
const BASE = DIGITS.length // 62
const MID_DIGIT = DIGITS[Math.floor(BASE / 2)] ?? 'V'
const VALID_KEY_RE = /^[0-9A-Za-z]+$/

export const DEFAULT_REBALANCE_MAX_LENGTH = 64

function digitIndex(ch: string): number {
	const idx = DIGITS.indexOf(ch)
	if (idx === -1) {
		throw new RangeError(`Invalid fractional index character "${ch}"`)
	}
	return idx
}

export function isValidPositionKey(key: string): boolean {
	return key.length > 0 && VALID_KEY_RE.test(key) && key.at(-1) !== '0'
}

/** Bytewise ASCII comparison matching PostgreSQL `COLLATE "C"`. */
export function comparePositions(a: string, b: string): number {
	if (a === b) return 0
	return a < b ? -1 : 1
}

function validateBound(key: string | null, label: string): void {
	if (key === null) return
	if (!isValidPositionKey(key)) {
		throw new RangeError(
			`Invalid ${label} position key "${key}": must be non-empty base-62 not ending in "0"`
		)
	}
}

/**
 * Compute a key strictly greater than `a` (when `b` is null) using base-62 midpoint.
 */
function keyAfter(a: string): string {
	for (let i = 0; i < a.length; i++) {
		const ch = a.charAt(i)
		const idx = digitIndex(ch)
		if (idx < BASE - 1) {
			const nextIdx = idx < BASE - 2 ? Math.floor((idx + BASE) / 2) : BASE - 1
			return `${a.slice(0, i)}${DIGITS.charAt(nextIdx)}`
		}
	}
	return `${a}${MID_DIGIT}`
}

/**
 * Generate a fractional-index key strictly between `a` and `b` in ASCII/C order.
 * Pass `null` for an unbounded side.
 */
export function generateKeyBetween(a: string | null, b: string | null): string {
	validateBound(a, 'lower')
	validateBound(b, 'upper')

	if (a !== null && b !== null && comparePositions(a, b) >= 0) {
		throw new RangeError(`Lower key "${a}" must be strictly less than upper key "${b}"`)
	}

	if (a === null && b === null) {
		return MID_DIGIT
	}

	if (a !== null && b === null) {
		return keyAfter(a)
	}

	// Now b is guaranteed non-null (and if a !== null, a < b).
	const upper = b as string
	const lower = a ?? ''

	let i = 0
	while (true) {
		const chA = i < lower.length ? lower.charAt(i) : '0'
		const chB = i < upper.length ? upper.charAt(i) : '0'
		if (chA !== chB) {
			const idxA = digitIndex(chA)
			const idxB = digitIndex(chB)
			if (idxB - idxA > 1) {
				const mid = Math.floor((idxA + idxB) / 2)
				return `${upper.slice(0, i)}${DIGITS.charAt(mid)}`
			}
			// Adjacent digits (idxB === idxA + 1): lock prefix at idxA and pick a suffix > lower's tail.
			const prefix = i < lower.length ? lower.slice(0, i + 1) : `${upper.slice(0, i)}0`
			const tailA = i + 1 < lower.length ? lower.slice(i + 1) : ''
			const suffix = tailA.length === 0 ? MID_DIGIT : keyAfter(tailA)
			return `${prefix}${suffix}`
		}
		i++
	}
}

/**
 * Generate `n` strictly ascending, balanced keys between `a` and `b`.
 */
export function generateNKeysBetween(a: string | null, b: string | null, n: number): string[] {
	if (!Number.isInteger(n) || n < 0) {
		throw new RangeError(`Count must be a non-negative integer, got ${n}`)
	}
	if (n === 0) return []
	if (n === 1) return [generateKeyBetween(a, b)]

	const midIndex = Math.floor(n / 2)
	const midKey = generateKeyBetween(a, b)
	const left = generateNKeysBetween(a, midKey, midIndex)
	const right = generateNKeysBetween(midKey, b, n - midIndex - 1)
	return [...left, midKey, ...right]
}

/** True when any key exceeds `maxLength` characters (default 64, §8.1). */
export function needsRebalance(
	keys: readonly string[],
	maxLength: number = DEFAULT_REBALANCE_MAX_LENGTH
): boolean {
	return keys.some((k) => k.length > maxLength)
}

/** Generate `count` fresh balanced keys starting from the empty range. */
export function rebalanceKeys(count: number): string[] {
	return generateNKeysBetween(null, null, count)
}
