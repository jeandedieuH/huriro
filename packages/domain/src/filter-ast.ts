/**
 * Compound filter AST for saved views, automation conditions, and server-side
 * issue queries (§3.4, ADR-0028). Pure: the clock and the status→category
 * lookup are injected via `FilterContext`.
 *
 * `FILTER_FIELDS` is the single registry of filterable fields — the server SQL
 * interpreter and the local evaluator below both read it, so adding a field is
 * a one-entry change. Fields from later milestones (`milestone_id`, `custom:*`,
 * `has_pr`, `has_customer`) are deliberately absent and fail validation with
 * `unknown_field`.
 *
 * Evaluation semantics:
 *   - A null/absent field vs `eq`/`lt`/`lte`/`gt`/`gte`/`in`/`contains` is
 *     false; `neq`/`nin` on null is TRUE — mirroring SQL `IS DISTINCT FROM`,
 *     which is what the server interpreter uses for those ops.
 *   - `eq`/`neq` with a `null` value mean `is_null`/`is_not_null`.
 *   - Multi-valued `label_id`: `eq` = has the label, `neq` = lacks it,
 *     `in` = has any of, `nin` = has none of.
 *   - `due_date`/`start_date` compare calendar-date strings ('YYYY-MM-DD');
 *     datetime fields compare instants. `{relative:'+7d'}` resolves against
 *     `ctx.now` at compile time (UTC calendar date for `date` fields).
 *   - `title` ops are case-insensitive.
 *   - An issue whose `statusId` has no category via `ctx.statusCategoryOf`
 *     fails every `status_category` predicate.
 *   - Empty `and` = true, empty `or` = false.
 */

export type FilterOp =
	| 'eq'
	| 'neq'
	| 'in'
	| 'nin'
	| 'lt'
	| 'lte'
	| 'gt'
	| 'gte'
	| 'contains'
	| 'is_null'
	| 'is_not_null'

export type FilterScalar = string | number | boolean

/** `{relative:'+7d'}` — sign, amount, unit (m inutes, h ours, d ays, w eeks). */
export interface RelativeDate {
	readonly relative: string
}

export type FilterValue = FilterScalar | readonly FilterScalar[] | RelativeDate | null

export type FilterFieldType = 'enum' | 'uuid' | 'int' | 'number' | 'text' | 'date' | 'datetime'

export interface FilterFieldDef {
	readonly type: FilterFieldType
	/** True for multi-valued relations: ops test set membership, not equality. */
	readonly multi?: boolean
	readonly ops: readonly FilterOp[]
	/** Allowed members for `type:'enum'`. */
	readonly values?: readonly string[]
	/** Inclusive bounds for `type:'int' | 'number'`. */
	readonly min?: number
	readonly max?: number
	/** Logical column the server SQL interpreter targets. */
	readonly source: string
}

export const FILTER_FIELDS = {
	status_category: {
		type: 'enum',
		ops: ['eq', 'neq', 'in', 'nin'],
		values: ['backlog', 'unstarted', 'started', 'completed', 'cancelled'],
		source: 'status.category'
	},
	status_id: { type: 'uuid', ops: ['eq', 'neq', 'in', 'nin'], source: 'issues.status_id' },
	priority: {
		type: 'int',
		ops: ['eq', 'neq', 'in', 'nin', 'lt', 'lte', 'gt', 'gte'],
		min: 0,
		max: 4,
		source: 'issues.priority'
	},
	assignee_id: {
		type: 'uuid',
		ops: ['eq', 'neq', 'in', 'nin', 'is_null', 'is_not_null'],
		source: 'issues.assignee_id'
	},
	assignee_type: {
		type: 'enum',
		ops: ['eq', 'neq', 'in', 'nin', 'is_null', 'is_not_null'],
		values: ['user', 'agent'],
		source: 'issues.assignee_type'
	},
	label_id: { type: 'uuid', multi: true, ops: ['eq', 'neq', 'in', 'nin'], source: 'issue_labels.label_id' },
	cycle_id: {
		type: 'uuid',
		ops: ['eq', 'neq', 'in', 'nin', 'is_null', 'is_not_null'],
		source: 'issues.cycle_id'
	},
	project_id: { type: 'uuid', ops: ['eq', 'neq', 'in', 'nin'], source: 'issues.project_id' },
	parent_id: {
		type: 'uuid',
		ops: ['eq', 'neq', 'in', 'nin', 'is_null', 'is_not_null'],
		source: 'issues.parent_id'
	},
	title: { type: 'text', ops: ['contains', 'eq', 'neq'], source: 'issues.title' },
	estimate: {
		type: 'number',
		ops: ['eq', 'neq', 'in', 'nin', 'lt', 'lte', 'gt', 'gte', 'is_null', 'is_not_null'],
		source: 'issues.estimate'
	},
	due_date: {
		type: 'date',
		ops: ['eq', 'neq', 'lt', 'lte', 'gt', 'gte', 'is_null', 'is_not_null'],
		source: 'issues.due_date'
	},
	start_date: {
		type: 'date',
		ops: ['eq', 'neq', 'lt', 'lte', 'gt', 'gte', 'is_null', 'is_not_null'],
		source: 'issues.start_date'
	},
	created_at: { type: 'datetime', ops: ['eq', 'neq', 'lt', 'lte', 'gt', 'gte'], source: 'issues.created_at' },
	updated_at: { type: 'datetime', ops: ['eq', 'neq', 'lt', 'lte', 'gt', 'gte'], source: 'issues.updated_at' },
	closed_at: {
		type: 'datetime',
		ops: ['eq', 'neq', 'lt', 'lte', 'gt', 'gte', 'is_null', 'is_not_null'],
		source: 'issues.closed_at'
	},
	triage_status: {
		type: 'enum',
		ops: ['eq', 'neq', 'in', 'nin'],
		values: ['none', 'pending', 'accepted', 'snoozed', 'declined', 'merged'],
		source: 'issues.triage_status'
	},
	source_kind: {
		type: 'enum',
		ops: ['eq', 'neq', 'in', 'nin'],
		values: ['manual', 'mail', 'chat', 'form', 'github', 'gitlab', 'api', 'agent'],
		source: 'issues.source_kind'
	}
} as const satisfies Record<string, FilterFieldDef>

export type FilterField = keyof typeof FILTER_FIELDS

const FIELD_DEFS: Record<string, FilterFieldDef> = FILTER_FIELDS

export interface FilterPredicate {
	readonly kind: 'pred'
	readonly field: FilterField
	readonly op: FilterOp
	readonly value?: FilterValue
}

export type FilterExpr =
	| { readonly kind: 'and'; readonly args: readonly FilterExpr[] }
	| { readonly kind: 'or'; readonly args: readonly FilterExpr[] }
	| { readonly kind: 'not'; readonly arg: FilterExpr }
	| FilterPredicate

/** Matches everything — `and` with no args. */
export const FILTER_TRUE: FilterExpr = { kind: 'and', args: [] }

/** Structural shape the evaluator reads — satisfied by issue DTOs/replica rows. */
export interface FilterableIssue {
	readonly id: string
	readonly projectId: string
	readonly statusId: string
	readonly priority: number
	readonly assigneeId: string | null
	readonly assigneeType: string | null
	readonly labelIds: readonly string[]
	readonly cycleId: string | null
	readonly parentId: string | null
	readonly title: string
	readonly estimate: number | string | null
	readonly dueDate: string | null
	readonly startDate: string | null
	readonly createdAt: string
	readonly updatedAt: string
	readonly closedAt: string | null
	readonly triageStatus: string
	readonly sourceKind: string
}

export interface FilterContext {
	readonly now: Date
	readonly statusCategoryOf: (statusId: string) => string | undefined
}

export interface FilterValidationError {
	readonly path: string
	readonly code: string
	readonly message: string
}

export type FilterValidation =
	| { readonly ok: true; readonly expr: FilterExpr }
	| { readonly ok: false; readonly errors: readonly FilterValidationError[] }

const MAX_DEPTH = 8
const MAX_NODES = 100
const MAX_IN_ITEMS = 200

const UUID_RE = /^[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}$/
const DATE_RE = /^\d{4}-(0[1-9]|1[0-2])-(0[1-9]|[12]\d|3[01])$/
const REL_DATE_RE = /^[+-]\d{1,4}[mhdw]$/
const REL_PARSE_RE = /^([+-])(\d{1,4})([mhdw])$/
const REL_UNIT_MS: Record<string, number> = { m: 60_000, h: 3_600_000, d: 86_400_000, w: 604_800_000 }

const FILTER_OPS: readonly FilterOp[] = [
	'eq',
	'neq',
	'in',
	'nin',
	'lt',
	'lte',
	'gt',
	'gte',
	'contains',
	'is_null',
	'is_not_null'
]

function isRecord(v: unknown): v is Record<string, unknown> {
	return typeof v === 'object' && v !== null && !Array.isArray(v)
}

function isFilterOp(v: unknown): v is FilterOp {
	return typeof v === 'string' && (FILTER_OPS as readonly string[]).includes(v)
}

function isRelativeDate(v: unknown): v is RelativeDate {
	return isRecord(v) && typeof v['relative'] === 'string'
}

export function resolveRelative(rel: RelativeDate, now: Date): Date {
	const m = REL_PARSE_RE.exec(rel.relative)
	if (!m) return new Date(now.getTime())
	const sign = m[1] === '-' ? -1 : 1
	const ms = Number(m[2]) * (REL_UNIT_MS[m[3] ?? ''] ?? 0)
	return new Date(now.getTime() + sign * ms)
}

type Fail = (path: string, code: string, message: string) => void

function validateScalar(v: unknown, def: FilterFieldDef, path: string, fail: Fail): void {
	switch (def.type) {
		case 'enum':
			if (typeof v !== 'string' || !def.values?.includes(v)) {
				fail(path, 'bad_value', `must be one of: ${(def.values ?? []).join(', ')}`)
			}
			return
		case 'uuid':
			if (typeof v !== 'string' || !UUID_RE.test(v)) fail(path, 'bad_value', 'must be a uuid string')
			return
		case 'int':
			if (
				typeof v !== 'number' ||
				!Number.isInteger(v) ||
				(def.min !== undefined && v < def.min) ||
				(def.max !== undefined && v > def.max)
			) {
				fail(path, 'bad_value', `must be an integer in [${def.min ?? '-inf'}, ${def.max ?? '+inf'}]`)
			}
			return
		case 'number':
			if (typeof v !== 'number' || !Number.isFinite(v)) fail(path, 'bad_value', 'must be a finite number')
			return
		case 'text':
			if (typeof v !== 'string') fail(path, 'bad_value', 'must be a string')
			return
		case 'date':
			if (typeof v !== 'string' || !DATE_RE.test(v)) {
				fail(path, 'bad_value', "must be an ISO date string 'YYYY-MM-DD'")
			}
			return
		case 'datetime':
			if (typeof v !== 'string' || Number.isNaN(Date.parse(v))) {
				fail(path, 'bad_value', 'must be an ISO datetime string')
			}
			return
	}
}

function validateValue(value: unknown, def: FilterFieldDef, op: FilterOp, path: string, fail: Fail): void {
	if (op === 'in' || op === 'nin') {
		if (!Array.isArray(value)) {
			fail(path, 'bad_value', `'${op}' requires an array of scalars`)
			return
		}
		if (value.length > MAX_IN_ITEMS) {
			fail(path, 'too_many_values', `'${op}' lists are capped at ${MAX_IN_ITEMS} items`)
			return
		}
		value.forEach((item, i) => {
			validateScalar(item, def, `${path}[${i}]`, fail)
		})
		return
	}
	if (value === null) {
		// eq null = is_null, neq null = is_not_null; meaningless for other ops
		if (op !== 'eq' && op !== 'neq') fail(path, 'bad_value', "null is only a valid operand for 'eq'/'neq'")
		return
	}
	if (isRelativeDate(value)) {
		if (def.type !== 'date' && def.type !== 'datetime') {
			fail(path, 'bad_relative', 'relative dates are only valid on date/datetime fields')
			return
		}
		if (!REL_DATE_RE.test(value.relative)) {
			fail(`${path}.relative`, 'bad_relative', "expected '[+-]<1-4 digits><m|h|d|w>', e.g. '+7d'")
		}
		return
	}
	if (isRecord(value) || Array.isArray(value)) {
		fail(path, 'bad_value', 'must be a scalar, null, or { relative } on date/datetime fields')
		return
	}
	validateScalar(value, def, path, fail)
}

function validatePredicate(node: Record<string, unknown>, path: string, fail: Fail): void {
	const field = node['field']
	if (typeof field !== 'string') {
		fail(`${path}.field`, 'invalid_shape', 'field must be a string')
		return
	}
	const def = FIELD_DEFS[field]
	if (!def) {
		fail(`${path}.field`, 'unknown_field', `'${field}' is not a registered filter field`)
		return
	}
	const op = node['op']
	if (!isFilterOp(op)) {
		fail(`${path}.op`, 'unknown_op', `op must be one of: ${FILTER_OPS.join(', ')}`)
		return
	}
	if (!def.ops.includes(op)) {
		fail(`${path}.op`, 'op_not_allowed', `op '${op}' is not allowed on ${def.type} field '${field}'`)
		return
	}
	const hasValue = node['value'] !== undefined
	if (op === 'is_null' || op === 'is_not_null') {
		if (hasValue) fail(`${path}.value`, 'unexpected_value', `'${op}' takes no value`)
		return
	}
	if (!hasValue) {
		fail(`${path}.value`, 'missing_value', `op '${op}' requires a value`)
		return
	}
	validateValue(node['value'], def, op, `${path}.value`, fail)
}

/** Structural validation of untrusted JSON — never throws; collects every error. */
export function validateFilter(input: unknown): FilterValidation {
	const errors: FilterValidationError[] = []
	const fail: Fail = (path, code, message) => errors.push({ path, code, message })
	const state = { nodes: 0 }

	const walk = (node: unknown, path: string, depth: number): void => {
		state.nodes += 1
		if (depth > MAX_DEPTH) {
			fail(path, 'too_deep', `nesting exceeds max depth ${MAX_DEPTH}`)
			return
		}
		if (!isRecord(node)) {
			fail(path, 'invalid_shape', 'filter node must be an object')
			return
		}
		switch (node['kind']) {
			case 'and':
			case 'or': {
				if (!Array.isArray(node['args'])) {
					fail(`${path}.args`, 'invalid_shape', `'${node['kind']}' requires an args array`)
					return
				}
				node['args'].forEach((arg, i) => {
					walk(arg, `${path}.args[${i}]`, depth + 1)
				})
				return
			}
			case 'not':
				walk(node['arg'], `${path}.arg`, depth + 1)
				return
			case 'pred':
				validatePredicate(node, path, fail)
				return
			default:
				fail(`${path}.kind`, 'invalid_shape', "kind must be 'and' | 'or' | 'not' | 'pred'")
		}
	}

	walk(input, '$', 1)
	if (state.nodes > MAX_NODES) {
		fail('$', 'too_many_nodes', `expression has ${state.nodes} nodes; max is ${MAX_NODES}`)
	}
	if (errors.length > 0) return { ok: false, errors }
	return { ok: true, expr: input as FilterExpr }
}

/** UTC calendar-date key for `date`-typed comparisons. */
function dateKeyOf(d: Date): string {
	return d.toISOString().slice(0, 10)
}

function isNullish(v: unknown, multi?: boolean): boolean {
	if (v === null || v === undefined) return true
	return multi === true && Array.isArray(v) && v.length === 0
}

function toFiniteNumber(v: number | string | null): number | null {
	if (v === null) return null
	const n = typeof v === 'number' ? v : v.trim() === '' ? null : Number(v)
	return n !== null && Number.isFinite(n) ? n : null
}

function fieldValue(issue: FilterableIssue, field: FilterField, ctx: FilterContext): unknown {
	switch (field) {
		case 'status_category':
			return ctx.statusCategoryOf(issue.statusId)
		case 'status_id':
			return issue.statusId
		case 'priority':
			return issue.priority
		case 'assignee_id':
			return issue.assigneeId
		case 'assignee_type':
			return issue.assigneeType
		case 'label_id':
			return issue.labelIds
		case 'cycle_id':
			return issue.cycleId
		case 'project_id':
			return issue.projectId
		case 'parent_id':
			return issue.parentId
		case 'title':
			return issue.title
		case 'estimate':
			return toFiniteNumber(issue.estimate)
		case 'due_date':
			return issue.dueDate
		case 'start_date':
			return issue.startDate
		case 'created_at':
			return issue.createdAt
		case 'updated_at':
			return issue.updatedAt
		case 'closed_at':
			return issue.closedAt
		case 'triage_status':
			return issue.triageStatus
		case 'source_kind':
			return issue.sourceKind
	}
}

type Comparable = string | number

/** Normalizes a predicate operand into the comparable domain of the field type. */
function normOperand(
	raw: FilterValue | undefined,
	def: FilterFieldDef,
	ctx: FilterContext
): Comparable | null {
	if (isRelativeDate(raw)) {
		if (def.type !== 'date' && def.type !== 'datetime') return null
		const d = resolveRelative(raw, ctx.now)
		return def.type === 'date' ? dateKeyOf(d) : d.getTime()
	}
	return normScalar(raw, def.type)
}

function normScalar(v: unknown, type: FilterFieldType): Comparable | null {
	switch (type) {
		case 'enum':
			return typeof v === 'string' ? v : null
		case 'uuid':
		case 'text':
			return typeof v === 'string' ? v.toLowerCase() : null
		case 'int':
		case 'number':
			return typeof v === 'number' && Number.isFinite(v) ? v : null
		case 'date':
			return typeof v === 'string' ? v : null
		case 'datetime': {
			const ms = typeof v === 'string' ? Date.parse(v) : Number.NaN
			return Number.isFinite(ms) ? ms : null
		}
	}
}

/** Normalizes an issue's stored value; null = absent/unparseable (fails comparisons). */
function normIssueValue(v: unknown, type: FilterFieldType): Comparable | null {
	if (v === null || v === undefined) return null
	switch (type) {
		case 'enum':
			return typeof v === 'string' ? v : null
		case 'uuid':
		case 'text':
			return typeof v === 'string' ? v.toLowerCase() : String(v).toLowerCase()
		case 'int':
		case 'number': {
			const n = typeof v === 'number' ? v : Number(v)
			return Number.isFinite(n) ? n : null
		}
		case 'date':
			return typeof v === 'string' ? v : null
		case 'datetime': {
			const ms = typeof v === 'string' ? Date.parse(v) : Number.NaN
			return Number.isFinite(ms) ? ms : null
		}
	}
}

function compareOrdered(a: Comparable, b: Comparable): number {
	if (typeof a === 'number' && typeof b === 'number') return a - b
	const sa = String(a)
	const sb = String(b)
	return sa < sb ? -1 : sa > sb ? 1 : 0
}

type ValueTest = (fieldValue: unknown) => boolean

function normOperandList(
	raw: FilterValue | undefined,
	def: FilterFieldDef,
	ctx: FilterContext
): readonly Comparable[] | null {
	if (!Array.isArray(raw)) return null
	const out: Comparable[] = []
	for (const item of raw) {
		const n = normOperand(item, def, ctx)
		if (n === null) return null
		out.push(n)
	}
	return out
}

function buildMultiTest(
	op: FilterOp,
	raw: FilterValue | undefined,
	def: FilterFieldDef,
	ctx: FilterContext
): ValueTest | null {
	const has = (v: unknown, wanted: Comparable): boolean =>
		Array.isArray(v) && v.some((item) => normIssueValue(item, def.type) === wanted)
	if (op === 'in' || op === 'nin') {
		const list = normOperandList(raw, def, ctx)
		if (list === null) return null
		const wanted = new Set(list)
		const hasAny = (v: unknown): boolean =>
			Array.isArray(v) &&
			v.some((item) => {
				const n = normIssueValue(item, def.type)
				return n !== null && wanted.has(n)
			})
		return op === 'in' ? hasAny : (v) => !hasAny(v)
	}
	const w = normOperand(raw, def, ctx)
	if (w === null) return null
	if (op === 'eq') return (v) => has(v, w)
	if (op === 'neq') return (v) => !has(v, w)
	return null
}

function buildCompare(pred: FilterPredicate, def: FilterFieldDef, ctx: FilterContext): ValueTest | null {
	const { op, value: raw } = pred

	if (op === 'is_null') return (v) => isNullish(v, def.multi)
	if (op === 'is_not_null') return (v) => !isNullish(v, def.multi)

	if (raw === null) {
		if (op === 'eq') return (v) => isNullish(v, def.multi)
		if (op === 'neq') return (v) => !isNullish(v, def.multi)
		return null
	}

	if (def.multi) return buildMultiTest(op, raw, def, ctx)

	if (op === 'contains') {
		if (typeof raw !== 'string') return null
		const needle = raw.toLowerCase()
		return (v) => typeof v === 'string' && v.toLowerCase().includes(needle)
	}

	if (op === 'in' || op === 'nin') {
		const list = normOperandList(raw, def, ctx)
		if (list === null) return null
		const wanted = new Set(list)
		if (op === 'in') {
			return (v) => {
				const n = normIssueValue(v, def.type)
				return n !== null && wanted.has(n)
			}
		}
		return (v) => {
			const n = normIssueValue(v, def.type)
			return n === null || !wanted.has(n)
		}
	}

	const w = normOperand(raw, def, ctx)
	if (w === null) return null
	switch (op) {
		case 'eq':
			return (v) => {
				const n = normIssueValue(v, def.type)
				return n !== null && n === w
			}
		case 'neq':
			return (v) => {
				const n = normIssueValue(v, def.type)
				return n === null || n !== w
			}
		case 'lt':
			return (v) => {
				const n = normIssueValue(v, def.type)
				return n !== null && compareOrdered(n, w) < 0
			}
		case 'lte':
			return (v) => {
				const n = normIssueValue(v, def.type)
				return n !== null && compareOrdered(n, w) <= 0
			}
		case 'gt':
			return (v) => {
				const n = normIssueValue(v, def.type)
				return n !== null && compareOrdered(n, w) > 0
			}
		case 'gte':
			return (v) => {
				const n = normIssueValue(v, def.type)
				return n !== null && compareOrdered(n, w) >= 0
			}
		default:
			return null
	}
}

type IssueTest = (issue: FilterableIssue) => boolean

const FALSE_TEST: IssueTest = () => false

function compilePredicate(pred: FilterPredicate, ctx: FilterContext): IssueTest {
	const def = FIELD_DEFS[pred.field]
	// Defensive default: compile assumes validated input but never throws
	if (!def?.ops.includes(pred.op)) return FALSE_TEST
	const cmp = buildCompare(pred, def, ctx)
	if (!cmp) return FALSE_TEST
	if (pred.field === 'status_category') {
		return (issue) => {
			const v = ctx.statusCategoryOf(issue.statusId)
			return v !== null && v !== undefined && cmp(v)
		}
	}
	return (issue) => cmp(fieldValue(issue, pred.field, ctx))
}

function compileNode(expr: FilterExpr, ctx: FilterContext): IssueTest {
	switch (expr.kind) {
		case 'and': {
			const fns = expr.args.map((a) => compileNode(a, ctx))
			return (issue) => {
				for (const fn of fns) if (!fn(issue)) return false
				return true
			}
		}
		case 'or': {
			const fns = expr.args.map((a) => compileNode(a, ctx))
			return (issue) => {
				for (const fn of fns) if (fn(issue)) return true
				return false
			}
		}
		case 'not': {
			const fn = compileNode(expr.arg, ctx)
			return (issue) => !fn(issue)
		}
		case 'pred':
			return compilePredicate(expr, ctx)
		default:
			return FALSE_TEST
	}
}

export function compileFilter(expr: FilterExpr, ctx: FilterContext): (issue: FilterableIssue) => boolean {
	return compileNode(expr, ctx)
}

export function evaluateFilter(expr: FilterExpr, issue: FilterableIssue, ctx: FilterContext): boolean {
	return compileFilter(expr, ctx)(issue)
}

/** Flattens nested same-kind and/or and collapses double `not`. Idempotent — used for stable hashing/diffing. */
export function normalizeFilter(expr: FilterExpr): FilterExpr {
	switch (expr.kind) {
		case 'and': {
			const args: FilterExpr[] = []
			for (const arg of expr.args) {
				const n = normalizeFilter(arg)
				if (n.kind === 'and') args.push(...n.args)
				else args.push(n)
			}
			return { kind: 'and', args }
		}
		case 'or': {
			const args: FilterExpr[] = []
			for (const arg of expr.args) {
				const n = normalizeFilter(arg)
				if (n.kind === 'or') args.push(...n.args)
				else args.push(n)
			}
			return { kind: 'or', args }
		}
		case 'not': {
			const inner = normalizeFilter(expr.arg)
			return inner.kind === 'not' ? inner.arg : { kind: 'not', arg: inner }
		}
		default:
			return expr
	}
}

/**
 * Maps a V1 `SavedViewFilters` object (contracts/tasks.ts) onto the AST.
 * `mine` is skipped — "me" needs the caller's principal id, so the caller ANDs
 * `assignee_id eq <self>` + `assignee_type eq 'user'` itself. V1 `search`
 * matched title OR description_text; the AST narrows it to `title contains`.
 */
export function legacyFiltersToExpr(legacy: Readonly<Record<string, unknown>>): FilterExpr {
	const args: FilterExpr[] = []
	const pushIn = (key: string, field: FilterField, numeric: boolean): void => {
		const raw = legacy[key]
		if (!Array.isArray(raw)) return
		const items = raw.filter((x): x is FilterScalar =>
			numeric ? typeof x === 'number' : typeof x === 'string'
		)
		if (items.length > 0) args.push({ kind: 'pred', field, op: 'in', value: items })
	}
	pushIn('statusIds', 'status_id', false)
	pushIn('priorities', 'priority', true)
	pushIn('assigneeIds', 'assignee_id', false)
	pushIn('labelIds', 'label_id', false)

	const cycleId = legacy['cycleId']
	if (typeof cycleId === 'string') args.push({ kind: 'pred', field: 'cycle_id', op: 'eq', value: cycleId })
	else if (cycleId === null) args.push({ kind: 'pred', field: 'cycle_id', op: 'is_null' })

	const search = legacy['search']
	if (typeof search === 'string' && search.trim().length > 0) {
		args.push({ kind: 'pred', field: 'title', op: 'contains', value: search.trim() })
	}
	return { kind: 'and', args }
}
