/**
 * Pure 3-way field-level conflict merge (§9.5).
 *
 * When a mutation returns `409 stale_version`, the client compares the fields
 * touched by `localPatch` against the fields changed on the server since
 * `base` (or explicitly reported by the server in `serverChangedFields`):
 *   - Disjoint edits → `auto_merged` with the rebased patch
 *   - Overlapping edits → `conflict` surfacing both values for user resolution
 */

function deepEqual(a: unknown, b: unknown): boolean {
	if (Object.is(a, b)) return true
	if (typeof a !== typeof b || a === null || b === null) return false
	if (typeof a !== 'object') return false
	if (Array.isArray(a) || Array.isArray(b)) {
		if (!Array.isArray(a) || !Array.isArray(b) || a.length !== b.length) return false
		return a.every((v, i) => deepEqual(v, b[i]))
	}
	const recA = a as Record<string, unknown>
	const recB = b as Record<string, unknown>
	const keysA = Object.keys(recA)
	const keysB = Object.keys(recB)
	if (keysA.length !== keysB.length) return false
	return keysA.every((k) => Object.hasOwn(recB, k) && deepEqual(recA[k], recB[k]))
}

export type MergeResolution<T extends Record<string, unknown>> =
	| {
			readonly kind: 'auto_merged'
			readonly mergedPatch: Partial<T>
	  }
	| {
			readonly kind: 'conflict'
			readonly overlappingFields: readonly string[]
			readonly nonConflictingPatch: Partial<T>
	  }

export function resolveFieldMerge<T extends Record<string, unknown>>(args: {
	readonly base?: Partial<T> | undefined
	readonly localPatch: Partial<T>
	readonly server: T
	readonly serverChangedFields?: readonly string[] | undefined
}): MergeResolution<T> {
	const { base, localPatch, server, serverChangedFields } = args
	const localKeys = Object.keys(localPatch).filter((k) => localPatch[k] !== undefined)

	const serverChanged = new Set<string>()
	if (serverChangedFields) {
		for (const f of serverChangedFields) serverChanged.add(f)
	} else if (base) {
		for (const key of new Set([...Object.keys(base), ...Object.keys(server)])) {
			if (!deepEqual(base[key], server[key])) {
				serverChanged.add(key)
			}
		}
	} else {
		// Without base or serverChangedFields, treat any key where local differs from server as potentially overlapping.
		for (const key of localKeys) {
			if (!deepEqual(localPatch[key], server[key])) {
				serverChanged.add(key)
			}
		}
	}

	const overlappingFields: string[] = []
	const nonConflictingPatch: Partial<T> = {}

	for (const key of localKeys) {
		const localVal = localPatch[key]
		const serverVal = server[key]
		// If client and server converged to the exact same value, there is no conflict.
		if (deepEqual(localVal, serverVal)) continue

		if (serverChanged.has(key)) {
			overlappingFields.push(key)
		} else {
			;(nonConflictingPatch as Record<string, unknown>)[key] = localVal
		}
	}

	if (overlappingFields.length === 0) {
		return { kind: 'auto_merged', mergedPatch: nonConflictingPatch }
	}

	return {
		kind: 'conflict',
		overlappingFields,
		nonConflictingPatch
	}
}
