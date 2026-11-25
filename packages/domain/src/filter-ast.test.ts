import { describe, expect, it } from 'bun:test'
import type {
	FilterableIssue,
	FilterContext,
	FilterExpr,
	FilterField,
	FilterOp,
	FilterPredicate
} from './filter-ast'
import {
	compileFilter,
	evaluateFilter,
	FILTER_TRUE,
	legacyFiltersToExpr,
	normalizeFilter,
	resolveRelative,
	validateFilter
} from './filter-ast'

const U = (n: number): string => `00000000-0000-4000-8000-${String(n).padStart(12, '0')}`

const STATUS_STARTED = U(1)
const STATUS_DONE = U(2)
const STATUS_UNKNOWN = U(3)
const PROJECT = U(10)
const ASSIGNEE = U(20)
const CYCLE = U(30)
const LABEL_A = U(40)
const LABEL_B = U(41)
const LABEL_C = U(42)
const PARENT = U(50)

const NOW = new Date('2026-11-25T12:00:00.000Z')
const CATEGORIES: Record<string, string> = {
	[STATUS_STARTED]: 'started',
	[STATUS_DONE]: 'completed'
}
const CTX: FilterContext = {
	now: NOW,
	statusCategoryOf: (statusId) => CATEGORIES[statusId]
}

function makeIssue(over: Partial<FilterableIssue> = {}): FilterableIssue {
	const base: FilterableIssue = {
		id: U(999),
		projectId: PROJECT,
		statusId: STATUS_STARTED,
		priority: 2,
		assigneeId: ASSIGNEE,
		assigneeType: 'user',
		labelIds: [LABEL_A, LABEL_B],
		cycleId: CYCLE,
		parentId: PARENT,
		title: 'Fix the Flickering Sidebar',
		estimate: 3,
		dueDate: '2026-12-01',
		startDate: '2026-11-20',
		createdAt: '2026-11-01T08:00:00.000Z',
		updatedAt: '2026-11-24T09:30:00.000Z',
		closedAt: null,
		triageStatus: 'none',
		sourceKind: 'manual'
	}
	return Object.assign(base, over)
}

function pred(field: FilterField, op: FilterOp, value?: FilterPredicate['value']): FilterExpr {
	return value === undefined ? { kind: 'pred', field, op } : { kind: 'pred', field, op, value }
}

function check(expr: FilterExpr, over: Partial<FilterableIssue> = {}): boolean {
	return evaluateFilter(expr, makeIssue(over), CTX)
}

describe('scalar ops per field type', () => {
	it('uuid: eq/neq/in/nin on status_id', () => {
		expect(check(pred('status_id', 'eq', STATUS_STARTED))).toBe(true)
		expect(check(pred('status_id', 'eq', STATUS_DONE))).toBe(false)
		expect(check(pred('status_id', 'neq', STATUS_DONE))).toBe(true)
		expect(check(pred('status_id', 'in', [STATUS_DONE, STATUS_STARTED]))).toBe(true)
		expect(check(pred('status_id', 'nin', [STATUS_DONE, STATUS_UNKNOWN]))).toBe(true)
		expect(check(pred('status_id', 'in', [STATUS_DONE]))).toBe(false)
		expect(check(pred('status_id', 'nin', [STATUS_STARTED]))).toBe(false)
	})
	it('enum: eq/neq/in/nin on triage_status', () => {
		expect(check(pred('triage_status', 'eq', 'none'))).toBe(true)
		expect(check(pred('triage_status', 'neq', 'pending'))).toBe(true)
		expect(check(pred('triage_status', 'in', ['pending', 'none']))).toBe(true)
		expect(check(pred('triage_status', 'nin', ['pending', 'accepted']))).toBe(true)
		expect(check(pred('triage_status', 'in', ['pending']))).toBe(false)
	})
	it('int: eq/in/range on priority', () => {
		expect(check(pred('priority', 'eq', 2))).toBe(true)
		expect(check(pred('priority', 'neq', 3))).toBe(true)
		expect(check(pred('priority', 'in', [1, 2]))).toBe(true)
		expect(check(pred('priority', 'nin', [0, 1]))).toBe(true)
		expect(check(pred('priority', 'lt', 3))).toBe(true)
		expect(check(pred('priority', 'lte', 2))).toBe(true)
		expect(check(pred('priority', 'gt', 2))).toBe(false)
		expect(check(pred('priority', 'gte', 2))).toBe(true)
	})
	it('number: range on estimate incl. numeric-string coercion', () => {
		expect(check(pred('estimate', 'eq', 3))).toBe(true)
		expect(check(pred('estimate', 'gt', 2.5))).toBe(true)
		expect(check(pred('estimate', 'lte', 3))).toBe(true)
		expect(check(pred('estimate', 'eq', 3), { estimate: '3' })).toBe(true)
		expect(check(pred('estimate', 'lt', 5), { estimate: '2.5' })).toBe(true)
		expect(check(pred('estimate', 'eq', 3), { estimate: 'not-a-number' })).toBe(false)
	})
	it('text: contains/eq/neq are case-insensitive', () => {
		expect(check(pred('title', 'contains', 'flickering'))).toBe(true)
		expect(check(pred('title', 'contains', 'FLICKERING'))).toBe(true)
		expect(check(pred('title', 'contains', 'database'))).toBe(false)
		expect(check(pred('title', 'eq', 'fix the flickering sidebar'))).toBe(true)
		expect(check(pred('title', 'eq', 'FIX THE FLICKERING SIDEBAR'))).toBe(true)
		expect(check(pred('title', 'neq', 'fix the flickering sidebar'))).toBe(false)
	})
	it('date: eq/range compare calendar-date strings', () => {
		expect(check(pred('due_date', 'eq', '2026-12-01'))).toBe(true)
		expect(check(pred('due_date', 'lt', '2026-12-02'))).toBe(true)
		expect(check(pred('due_date', 'lte', '2026-12-01'))).toBe(true)
		expect(check(pred('due_date', 'gt', '2026-11-30'))).toBe(true)
		expect(check(pred('due_date', 'gte', '2026-12-02'))).toBe(false)
	})
	it('datetime: eq/range compare instants', () => {
		expect(check(pred('created_at', 'eq', '2026-11-01T08:00:00Z'))).toBe(true)
		expect(check(pred('created_at', 'gt', '2026-10-31T00:00:00Z'))).toBe(true)
		expect(check(pred('created_at', 'lt', '2026-11-02T00:00:00Z'))).toBe(true)
		expect(check(pred('created_at', 'gte', '2026-11-01T08:00:00.000Z'))).toBe(true)
		expect(check(pred('created_at', 'eq', '2026-11-01T09:00:00Z'))).toBe(false)
	})
	it('nullable fields: is_null/is_not_null', () => {
		expect(check(pred('closed_at', 'is_null'))).toBe(true)
		expect(check(pred('closed_at', 'is_not_null'))).toBe(false)
		expect(check(pred('parent_id', 'is_not_null'))).toBe(true)
		expect(check(pred('parent_id', 'is_null'), { parentId: null })).toBe(true)
		expect(check(pred('assignee_id', 'is_null'), { assigneeId: null })).toBe(true)
	})
})

describe('null semantics (SQL IS DISTINCT FROM parity)', () => {
	const NULLISH: Partial<FilterableIssue> = {
		assigneeId: null,
		assigneeType: null,
		cycleId: null,
		parentId: null,
		estimate: null,
		dueDate: null,
		startDate: null,
		closedAt: null
	}
	it('comparison ops on null fields are false', () => {
		expect(check(pred('assignee_id', 'eq', ASSIGNEE), NULLISH)).toBe(false)
		expect(check(pred('assignee_id', 'in', [ASSIGNEE]), NULLISH)).toBe(false)
		expect(check(pred('due_date', 'lt', '2030-01-01'), NULLISH)).toBe(false)
		expect(check(pred('due_date', 'gt', '2020-01-01'), NULLISH)).toBe(false)
		expect(check(pred('estimate', 'lte', 99), NULLISH)).toBe(false)
	})
	it('neq/nin on null fields are true', () => {
		expect(check(pred('assignee_id', 'neq', ASSIGNEE), NULLISH)).toBe(true)
		expect(check(pred('assignee_id', 'nin', [ASSIGNEE]), NULLISH)).toBe(true)
		expect(check(pred('cycle_id', 'neq', CYCLE), NULLISH)).toBe(true)
	})
	it('eq null behaves as is_null, neq null as is_not_null', () => {
		expect(check(pred('due_date', 'eq', null), NULLISH)).toBe(true)
		expect(check(pred('due_date', 'eq', null))).toBe(false)
		expect(check(pred('due_date', 'neq', null), NULLISH)).toBe(false)
		expect(check(pred('due_date', 'neq', null))).toBe(true)
	})
})

describe('multi-valued label_id semantics', () => {
	it('eq = has label, neq = lacks label', () => {
		expect(check(pred('label_id', 'eq', LABEL_A))).toBe(true)
		expect(check(pred('label_id', 'eq', LABEL_C))).toBe(false)
		expect(check(pred('label_id', 'neq', LABEL_C))).toBe(true)
		expect(check(pred('label_id', 'neq', LABEL_A))).toBe(false)
	})
	it('in = has any, nin = has none', () => {
		expect(check(pred('label_id', 'in', [LABEL_C, LABEL_A]))).toBe(true)
		expect(check(pred('label_id', 'in', [LABEL_C]))).toBe(false)
		expect(check(pred('label_id', 'nin', [LABEL_C]))).toBe(true)
		expect(check(pred('label_id', 'nin', [LABEL_C, LABEL_B]))).toBe(false)
	})
	it('empty label list behaves like null', () => {
		const over = { labelIds: [] }
		expect(check(pred('label_id', 'eq', LABEL_A), over)).toBe(false)
		expect(check(pred('label_id', 'neq', LABEL_A), over)).toBe(true)
		expect(check(pred('label_id', 'in', [LABEL_A]), over)).toBe(false)
		expect(check(pred('label_id', 'nin', [LABEL_A]), over)).toBe(true)
	})
})

describe('boolean combinators', () => {
	const pTrue = pred('priority', 'eq', 2)
	const pFalse = pred('priority', 'eq', 4)
	it('and/or/not combine predicates', () => {
		expect(check({ kind: 'and', args: [pTrue, pred('triage_status', 'eq', 'none')] })).toBe(true)
		expect(check({ kind: 'and', args: [pTrue, pFalse] })).toBe(false)
		expect(check({ kind: 'or', args: [pFalse, pTrue] })).toBe(true)
		expect(check({ kind: 'or', args: [pFalse, pFalse] })).toBe(false)
		expect(check({ kind: 'not', arg: pFalse })).toBe(true)
		expect(check({ kind: 'not', arg: pTrue })).toBe(false)
	})
	it('empty and = true, empty or = false', () => {
		expect(check({ kind: 'and', args: [] })).toBe(true)
		expect(check({ kind: 'or', args: [] })).toBe(false)
		expect(check(FILTER_TRUE)).toBe(true)
	})
	it('nested boolean trees', () => {
		const expr: FilterExpr = {
			kind: 'and',
			args: [
				{ kind: 'or', args: [pred('priority', 'eq', 4), pred('priority', 'eq', 2)] },
				{ kind: 'not', arg: pred('triage_status', 'eq', 'pending') }
			]
		}
		expect(check(expr)).toBe(true)
	})
})

describe('status_category derivation', () => {
	it('matches via ctx.statusCategoryOf', () => {
		expect(check(pred('status_category', 'eq', 'started'))).toBe(true)
		expect(check(pred('status_category', 'eq', 'completed'))).toBe(false)
		expect(check(pred('status_category', 'eq', 'completed'), { statusId: STATUS_DONE })).toBe(true)
		expect(check(pred('status_category', 'in', ['backlog', 'started']))).toBe(true)
	})
	it('unknown status id fails every status_category predicate', () => {
		expect(check(pred('status_category', 'eq', 'started'), { statusId: STATUS_UNKNOWN })).toBe(false)
		expect(check(pred('status_category', 'neq', 'completed'), { statusId: STATUS_UNKNOWN })).toBe(false)
		expect(check(pred('status_category', 'nin', ['completed']), { statusId: STATUS_UNKNOWN })).toBe(false)
	})
})

describe('relative dates', () => {
	it('resolves units m/h/d/w against injected now', () => {
		expect(resolveRelative({ relative: '+7d' }, NOW).toISOString()).toBe('2026-12-02T12:00:00.000Z')
		expect(resolveRelative({ relative: '-48h' }, NOW).toISOString()).toBe('2026-11-23T12:00:00.000Z')
		expect(resolveRelative({ relative: '+2w' }, NOW).toISOString()).toBe('2026-12-09T12:00:00.000Z')
		expect(resolveRelative({ relative: '-30m' }, NOW).toISOString()).toBe('2026-11-25T11:30:00.000Z')
	})
	it('invalid syntax falls back to now unchanged', () => {
		expect(resolveRelative({ relative: '7x' }, NOW).getTime()).toBe(NOW.getTime())
	})
	it("due_date lt '+7d' compares the resolved UTC date", () => {
		const expr = pred('due_date', 'lt', { relative: '+7d' }) // resolves to 2026-12-02
		expect(check(expr)).toBe(true) // 2026-12-01 < 2026-12-02
		expect(check(expr, { dueDate: '2026-12-02' })).toBe(false)
		expect(check(expr, { dueDate: '2026-12-03' })).toBe(false)
	})
	it("updated_at gt '-48h' compares the resolved instant", () => {
		const expr = pred('updated_at', 'gt', { relative: '-48h' }) // resolves to 2026-11-23T12:00Z
		expect(check(expr)).toBe(true) // 2026-11-24T09:30 > -48h mark
		expect(check(expr, { updatedAt: '2026-11-23T11:00:00Z' })).toBe(false)
	})
})

describe('validateFilter', () => {
	function codes(input: unknown): string[] {
		const res = validateFilter(input)
		return res.ok ? [] : res.errors.map((e) => e.code)
	}
	it('accepts a valid compound expression', () => {
		const res = validateFilter({
			kind: 'and',
			args: [
				pred('status_category', 'in', ['started', 'unstarted']),
				{ kind: 'or', args: [pred('title', 'contains', 'bug'), pred('priority', 'gte', 3)] },
				{ kind: 'not', arg: pred('closed_at', 'is_not_null') },
				pred('due_date', 'lt', { relative: '+7d' })
			]
		})
		expect(res.ok).toBe(true)
	})
	it('accepts empty and/or args', () => {
		expect(validateFilter({ kind: 'and', args: [] }).ok).toBe(true)
		expect(validateFilter({ kind: 'or', args: [] }).ok).toBe(true)
	})
	it('rejects unknown fields incl. later-milestone fields', () => {
		for (const field of ['bogus', 'milestone_id', 'custom:severity', 'has_pr', 'has_customer']) {
			const errs = codes({ kind: 'pred', field, op: 'eq', value: 'x' })
			expect(errs).toContain('unknown_field')
		}
	})
	it('rejects bad op for field type', () => {
		expect(codes({ kind: 'pred', field: 'title', op: 'lt', value: 'x' })).toContain('op_not_allowed')
		expect(codes({ kind: 'pred', field: 'priority', op: 'contains', value: 'x' })).toContain('op_not_allowed')
		expect(codes({ kind: 'pred', field: 'status_id', op: 'is_null' })).toContain('op_not_allowed')
		expect(codes({ kind: 'pred', field: 'priority', op: 'bogus', value: 1 })).toContain('unknown_op')
	})
	it('rejects bad enum members, uuids, ranges', () => {
		expect(codes(pred('triage_status', 'eq', 'nope'))).toContain('bad_value')
		expect(codes(pred('status_id', 'eq', 'not-a-uuid'))).toContain('bad_value')
		expect(codes(pred('priority', 'eq', 7))).toContain('bad_value')
		expect(codes(pred('priority', 'eq', 1.5))).toContain('bad_value')
		expect(codes(pred('estimate', 'eq', 'three'))).toContain('bad_value')
		expect(codes(pred('due_date', 'eq', 'Dec 1st'))).toContain('bad_value')
	})
	it('rejects relative dates on non-date fields and bad relative syntax', () => {
		expect(codes(pred('priority', 'eq', { relative: '+1d' }))).toContain('bad_relative')
		expect(codes(pred('due_date', 'lt', { relative: '7x' }))).toContain('bad_relative')
		expect(codes(pred('due_date', 'lt', { relative: '7d' }))).toContain('bad_relative')
		expect(codes(pred('due_date', 'lt', { relative: '+12345d' }))).toContain('bad_relative')
	})
	it('enforces depth, node, and in-list caps', () => {
		let deep: unknown = pred('priority', 'eq', 2)
		for (let i = 0; i < 8; i++) deep = { kind: 'not', arg: deep } // leaf lands at depth 9
		expect(codes(deep)).toContain('too_deep')

		const wide = { kind: 'and', args: Array.from({ length: 101 }, () => pred('priority', 'eq', 2)) }
		expect(codes(wide)).toContain('too_many_nodes')

		const huge = {
			kind: 'pred',
			field: 'status_id',
			op: 'in',
			value: Array.from({ length: 201 }, (_, i) => U(i))
		}
		expect(codes(huge)).toContain('too_many_values')
	})
	it('accepts boundary sizes', () => {
		let deep: unknown = pred('priority', 'eq', 2)
		for (let i = 0; i < 7; i++) deep = { kind: 'not', arg: deep } // leaf lands at depth 8
		expect(validateFilter(deep).ok).toBe(true)
		const wide = { kind: 'and', args: Array.from({ length: 99 }, () => pred('priority', 'eq', 2)) }
		expect(validateFilter(wide).ok).toBe(true)
	})
	it('rejects malformed shapes and operand mistakes', () => {
		expect(codes(null)).toContain('invalid_shape')
		expect(codes({ kind: 'and' })).toContain('invalid_shape')
		expect(codes({ kind: 'wat', args: [] })).toContain('invalid_shape')
		expect(codes({ kind: 'pred', op: 'eq', value: 1 })).toContain('invalid_shape')
		expect(codes({ kind: 'pred', field: 'priority', op: 'eq' })).toContain('missing_value')
		expect(codes({ kind: 'pred', field: 'assignee_id', op: 'is_null', value: 'x' })).toContain(
			'unexpected_value'
		)
		expect(codes({ kind: 'pred', field: 'status_id', op: 'in', value: 'abc' })).toContain('bad_value')
		expect(codes({ kind: 'pred', field: 'due_date', op: 'lt', value: null })).toContain('bad_value')
	})
})

describe('normalizeFilter', () => {
	const a = pred('priority', 'eq', 1)
	const b = pred('priority', 'eq', 2)
	const c = pred('priority', 'eq', 3)
	it('flattens nested same-kind and/or', () => {
		expect(normalizeFilter({ kind: 'and', args: [a, { kind: 'and', args: [b, c] }] })).toEqual({
			kind: 'and',
			args: [a, b, c]
		})
		expect(
			normalizeFilter({ kind: 'or', args: [{ kind: 'or', args: [a, { kind: 'or', args: [b] }] }, c] })
		).toEqual({
			kind: 'or',
			args: [a, b, c]
		})
	})
	it('does not flatten across kinds', () => {
		const expr: FilterExpr = { kind: 'and', args: [a, { kind: 'or', args: [b, c] }] }
		expect(normalizeFilter(expr)).toEqual(expr)
	})
	it('collapses double not', () => {
		expect(normalizeFilter({ kind: 'not', arg: { kind: 'not', arg: a } })).toEqual(a)
		expect(normalizeFilter({ kind: 'not', arg: { kind: 'not', arg: { kind: 'not', arg: a } } })).toEqual({
			kind: 'not',
			arg: a
		})
	})
	it('is idempotent', () => {
		const expr: FilterExpr = {
			kind: 'and',
			args: [a, { kind: 'and', args: [{ kind: 'not', arg: { kind: 'not', arg: b } }, c] }]
		}
		const once = normalizeFilter(expr)
		expect(normalizeFilter(once)).toEqual(once)
	})
})

describe('legacyFiltersToExpr', () => {
	it('maps each SavedViewFilters key to predicates AND-ed together', () => {
		const expr = legacyFiltersToExpr({
			statusIds: [STATUS_STARTED, STATUS_DONE],
			priorities: [1, 2],
			assigneeIds: [ASSIGNEE],
			labelIds: [LABEL_A],
			cycleId: CYCLE,
			search: 'sidebar'
		})
		expect(expr).toEqual({
			kind: 'and',
			args: [
				{ kind: 'pred', field: 'status_id', op: 'in', value: [STATUS_STARTED, STATUS_DONE] },
				{ kind: 'pred', field: 'priority', op: 'in', value: [1, 2] },
				{ kind: 'pred', field: 'assignee_id', op: 'in', value: [ASSIGNEE] },
				{ kind: 'pred', field: 'label_id', op: 'in', value: [LABEL_A] },
				{ kind: 'pred', field: 'cycle_id', op: 'eq', value: CYCLE },
				{ kind: 'pred', field: 'title', op: 'contains', value: 'sidebar' }
			]
		})
	})
	it('maps cycleId null to is_null', () => {
		expect(legacyFiltersToExpr({ cycleId: null })).toEqual({
			kind: 'and',
			args: [{ kind: 'pred', field: 'cycle_id', op: 'is_null' }]
		})
	})
	it('skips mine (caller resolves self) and unrecognized/empty values', () => {
		expect(legacyFiltersToExpr({})).toEqual({ kind: 'and', args: [] })
		expect(legacyFiltersToExpr({ mine: true })).toEqual({ kind: 'and', args: [] })
		expect(legacyFiltersToExpr({ statusIds: 'nope', priorities: [], search: '  ' })).toEqual({
			kind: 'and',
			args: []
		})
	})
	it('produces validatable, evaluatable expressions', () => {
		const expr = legacyFiltersToExpr({ statusIds: [STATUS_STARTED], priorities: [2], search: 'flickering' })
		expect(validateFilter(expr).ok).toBe(true)
		expect(check(expr)).toBe(true)
	})
})

describe('compileFilter safety & perf', () => {
	it('never throws on unvalidated input — defensive false', () => {
		expect(compileFilter({ kind: 'bogus' } as unknown as FilterExpr, CTX)(makeIssue())).toBe(false)
		expect(
			compileFilter(
				{ kind: 'pred', field: 'nope', op: 'eq', value: 1 } as unknown as FilterExpr,
				CTX
			)(makeIssue())
		).toBe(false)
		expect(
			compileFilter({ kind: 'pred', field: 'priority', op: 'eq' } as unknown as FilterExpr, CTX)(makeIssue())
		).toBe(false)
	})
	it('evaluates 50k issues through a 5-predicate expression in < 250 ms', () => {
		const expr: FilterExpr = {
			kind: 'and',
			args: [
				pred('priority', 'gte', 1),
				pred('status_category', 'in', ['backlog', 'unstarted', 'started']),
				pred('label_id', 'nin', [LABEL_C]),
				pred('due_date', 'lt', { relative: '+30d' }),
				pred('title', 'contains', 'issue')
			]
		}
		const fn = compileFilter(expr, CTX)
		const issues = Array.from({ length: 50_000 }, (_, i) =>
			makeIssue({
				id: U(i),
				priority: i % 5,
				title: `Issue number ${i}`,
				dueDate: i % 3 === 0 ? '2026-12-20' : null
			})
		)
		const started = performance.now()
		let matched = 0
		for (const issue of issues) if (fn(issue)) matched += 1
		const elapsed = performance.now() - started
		// biome-ignore lint/suspicious/noConsole: the measured number is the point of this test
		console.log(`50k issues x 5 predicates: ${elapsed.toFixed(1)} ms (${matched} matched)`)
		expect(matched).toBeGreaterThan(0)
		expect(elapsed).toBeLessThan(250)
	})
})
