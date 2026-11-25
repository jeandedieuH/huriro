import { describe, expect, test } from 'bun:test'
import { normalizeFilter, validateFilter } from './filter-ast'
import {
	appendFilterNode,
	countFilterNodes,
	createGroup,
	createPredicate,
	filterExprEquals,
	getFilterNode,
	patchPredicate,
	removeFilterNode,
	setFilterCombinator,
	toggleFilterNot,
	updateFilterNode
} from './filter-builder'

function valid(expr: unknown): boolean {
	return validateFilter(expr).ok
}

describe('createPredicate / createGroup', () => {
	test('default predicate validates clean', () => {
		expect(valid(createPredicate())).toBe(true)
		expect(valid(createGroup())).toBe(true)
	})

	test('predicates for every registered field validate clean', () => {
		const fields = [
			'status_category',
			'status_id',
			'priority',
			'assignee_id',
			'assignee_type',
			'label_id',
			'cycle_id',
			'project_id',
			'parent_id',
			'title',
			'estimate',
			'due_date',
			'start_date',
			'created_at',
			'updated_at',
			'closed_at',
			'triage_status',
			'source_kind'
		] as const
		for (const field of fields) {
			const pred = createPredicate(field)
			expect(valid(pred)).toBe(true)
		}
	})
})

describe('updateFilterNode / appendFilterNode / removeFilterNode', () => {
	test('append into root group keeps validation and is immutable', () => {
		const root = createGroup('and')
		const before = root
		const next = appendFilterNode(root, [], createPredicate('priority'))
		expect(root).toBe(before) // no mutation
		expect(next).not.toBe(root)
		expect(valid(next)).toBe(true)
		if (next.kind === 'and') expect(next.args).toHaveLength(2)
	})

	test('nested append + edit at deep path', () => {
		let root = createGroup('and')
		root = appendFilterNode(root, [], createGroup('or'))
		// root = and[pred, or[pred]]
		root = appendFilterNode(root, [1], createPredicate('title'))
		const deep = getFilterNode(root, [1, 1])
		expect(deep?.kind).toBe('pred')
		const edited = updateFilterNode(root, [1, 1], (n) => patchPredicate(n, { value: 'sync' }))
		const node = getFilterNode(edited, [1, 1])
		expect(node).toMatchObject({ kind: 'pred', field: 'title', value: 'sync' })
		expect(valid(edited)).toBe(true)
	})

	test('removing the only child of a nested group collapses the group', () => {
		let root = createGroup('and')
		root = appendFilterNode(root, [], createGroup('or'))
		// and[pred, or[pred]] — remove or[0]
		const next = removeFilterNode(root, [1, 0])
		expect(JSON.stringify(next)).not.toContain('"or"')
		expect(valid(next)).toBe(true)
	})

	test('removing root yields the neutral empty-and', () => {
		const next = removeFilterNode(createGroup('and'), [])
		expect(next).toEqual({ kind: 'and', args: [] })
	})

	test('editing a nonexistent path returns input unchanged', () => {
		const root = createGroup('and')
		expect(updateFilterNode(root, [9, 9], () => null)).toBe(root)
	})
})

describe('patchPredicate', () => {
	test('field switch resets op/value to legal defaults', () => {
		const pred = patchPredicate(createPredicate('priority'), { field: 'due_date' })
		expect(valid(pred)).toBe(true)
		expect(pred).toMatchObject({ field: 'due_date' })
	})

	test('switching to a valueless op drops the value', () => {
		const pred = patchPredicate(createPredicate('assignee_id'), { op: 'is_null' })
		expect(pred).not.toHaveProperty('value')
		expect(valid(pred)).toBe(true)
	})

	test('switching back to a valued op restores a valid default', () => {
		let pred = patchPredicate(createPredicate('assignee_id'), { op: 'is_null' })
		pred = patchPredicate(pred, { op: 'eq' })
		expect(valid(pred)).toBe(true)
	})

	test('eq → in wraps scalar into an array; in → eq unwraps', () => {
		let pred = patchPredicate(createPredicate('priority'), { value: 2 })
		pred = patchPredicate(pred, { op: 'in' })
		expect(pred).toMatchObject({ op: 'in', value: [2] })
		expect(valid(pred)).toBe(true)
		pred = patchPredicate(pred, { op: 'eq' })
		expect(pred).toMatchObject({ op: 'eq', value: 2 })
		expect(valid(pred)).toBe(true)
	})
})

describe('toggleFilterNot / setFilterCombinator / misc', () => {
	test('double negation unwraps', () => {
		const pred = createPredicate()
		const once = toggleFilterNot(pred)
		expect(once.kind).toBe('not')
		expect(filterExprEquals(toggleFilterNot(once), pred)).toBe(true)
	})

	test('combinator switch validates through a JSON wire round-trip', () => {
		let root = createGroup('and')
		root = setFilterCombinator(root, 'or')
		expect(root.kind).toBe('or')
		// The AST is the wire format: JSON round-trip + server-side validation.
		const wire = JSON.parse(JSON.stringify(root)) as unknown
		expect(valid(wire)).toBe(true)
		expect(filterExprEquals(normalizeFilter(root), root)).toBe(true)
	})

	test('countFilterNodes counts nested structure', () => {
		let root = createGroup('and')
		root = appendFilterNode(root, [], createGroup('or'))
		// and + pred + or + pred = 4
		expect(countFilterNodes(root)).toBe(4)
	})
})
