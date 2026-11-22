import { describe, expect, test } from 'bun:test'
import { resolveFieldMerge } from './conflict'

describe('resolveFieldMerge', () => {
	const base = { title: 'Original', statusId: 'todo', priority: 1 }

	test('auto-merges disjoint changes', () => {
		const server = { title: 'Updated remotely', statusId: 'todo', priority: 1 }
		const res = resolveFieldMerge({
			base,
			localPatch: { statusId: 'in_progress', priority: 3 },
			server
		})
		expect(res).toEqual({
			kind: 'auto_merged',
			mergedPatch: { statusId: 'in_progress', priority: 3 }
		})
	})

	test('convergent edits on the same field auto-merge cleanly', () => {
		const server = { title: 'Same title', statusId: 'todo', priority: 1 }
		const res = resolveFieldMerge({
			base,
			localPatch: { title: 'Same title', priority: 2 },
			server
		})
		expect(res).toEqual({
			kind: 'auto_merged',
			mergedPatch: { priority: 2 }
		})
	})

	test('flags overlapping edits while preserving non-conflicting fields', () => {
		const server = { title: 'Server title', statusId: 'done', priority: 1 }
		const res = resolveFieldMerge({
			base,
			localPatch: { title: 'Local title', priority: 4 },
			server
		})
		expect(res).toEqual({
			kind: 'conflict',
			overlappingFields: ['title'],
			nonConflictingPatch: { priority: 4 }
		})
	})
})
