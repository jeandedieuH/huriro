/**
 * FilterExpr → SQL interpreter (§3.4). Semantics MUST equal the domain
 * evaluator in @huriro/domain filter-ast.ts — the differential test
 * (filter-sql.integration.test.ts) is the guarantee:
 *   - null vs eq/in/lt/lte/gt/gte/contains → false → every leaf is wrapped in
 *     COALESCE(<pred>, false) so NOT/NEQ stay two-valued.
 *   - neq/nin on null → TRUE → `IS DISTINCT FROM` / `NOT COALESCE(col = ANY(), false)`.
 *   - `status_category` fails even neq/nin when the issue's status row is
 *     missing (LEFT JOIN → s.category NULL) → COALESCE around DISTINCT FROM too.
 *   - label_id (multi): eq = EXISTS, neq = NOT EXISTS, in = EXISTS ANY,
 *     nin = NOT EXISTS ANY; is_null = has no labels.
 *   - eq/neq with a null operand mean is_null/is_not_null.
 *   - `date` fields compare `::date` against the UTC calendar date of a
 *     resolved relative; `datetime` fields compare `::timestamptz` instants.
 *   - title ops are case-insensitive; contains escapes LIKE wildcards.
 * Field → column mapping comes ONLY from FILTER_FIELDS[..].source; the literal
 * column fragments below are the single whitelist — no interpolated
 * identifiers, all values bound as parameters.
 */

import type { Queryable } from '@huriro/db'
import {
	FILTER_FIELDS,
	type FilterExpr,
	type FilterFieldDef,
	type FilterFieldType,
	type FilterPredicate,
	type FilterValue,
	resolveRelative,
	validateFilter
} from '@huriro/domain'
import { HttpError } from '../../api/error'

type Fragment = ReturnType<Queryable>

export interface FilterSqlResult {
	/** Boolean fragment, safe to AND into a WHERE on `issues i` (+ LEFT JOIN project_statuses s). */
	readonly where: Fragment
	/** True when the expression references `status_category` — the s JOIN is required. */
	readonly needsStatusJoin: boolean
}

function escapeLike(s: string): string {
	return s.replace(/[\\%_]/g, (c) => `\\${c}`)
}

/** JS-side operand normalization mirroring normOperand in filter-ast.ts. undefined → pred is always false. */
function normOperand(
	raw: FilterValue | undefined,
	type: FilterFieldType,
	now: Date
): string | number | undefined {
	if (raw !== null && typeof raw === 'object' && !Array.isArray(raw) && 'relative' in raw) {
		if (type !== 'date' && type !== 'datetime') return undefined
		const d = resolveRelative({ relative: raw.relative }, now)
		return type === 'date' ? d.toISOString().slice(0, 10) : d.toISOString()
	}
	switch (type) {
		case 'enum':
		case 'date':
			return typeof raw === 'string' ? raw : undefined
		case 'uuid':
		case 'text':
			return typeof raw === 'string' ? raw.toLowerCase() : undefined
		case 'int':
		case 'number':
			return typeof raw === 'number' && Number.isFinite(raw) ? raw : undefined
		case 'datetime': {
			const ms = typeof raw === 'string' ? Date.parse(raw) : Number.NaN
			return Number.isFinite(ms) ? new Date(ms).toISOString() : undefined
		}
	}
}

/** Binds `w` with the static PG cast for the field type. */
function valueParam(tx: Queryable, w: string | number, type: FilterFieldType): Fragment {
	switch (type) {
		case 'uuid':
			return tx`${w}::uuid`
		case 'date':
			return tx`${w}::date`
		case 'datetime':
			return tx`${w}::timestamptz`
		case 'int':
			return tx`${w}::int`
		case 'number':
			return tx`${w}::float8`
		default:
			return tx`${w}`
	}
}

function arrayParam(tx: Queryable, arr: readonly (string | number)[], type: FilterFieldType): Fragment {
	const list = [...arr]
	switch (type) {
		case 'uuid':
			return tx`${list}::uuid[]`
		case 'date':
			return tx`${list}::date[]`
		case 'datetime':
			return tx`${list}::timestamptz[]`
		case 'int':
			return tx`${list}::int[]`
		case 'number':
			return tx`${list}::float8[]`
		default:
			return tx`${list}::text[]`
	}
}

function issueCol(tx: Queryable, source: string): Fragment {
	switch (source) {
		case 'status.category':
			return tx`s.category`
		case 'issues.status_id':
			return tx`i.status_id`
		case 'issues.priority':
			return tx`i.priority`
		case 'issues.assignee_id':
			return tx`i.assignee_id`
		case 'issues.assignee_type':
			return tx`i.assignee_type`
		case 'issues.cycle_id':
			return tx`i.cycle_id`
		case 'issues.project_id':
			return tx`i.project_id`
		case 'issues.parent_id':
			return tx`i.parent_id`
		case 'issues.title':
			return tx`i.title`
		case 'issues.estimate':
			return tx`i.estimate`
		case 'issues.due_date':
			return tx`i.due_date`
		case 'issues.start_date':
			return tx`i.start_date`
		case 'issues.created_at':
			return tx`i.created_at`
		case 'issues.updated_at':
			return tx`i.updated_at`
		case 'issues.closed_at':
			return tx`i.closed_at`
		case 'issues.triage_status':
			return tx`i.triage_status`
		case 'issues.source_kind':
			return tx`i.source_kind`
		default:
			return tx`FALSE`
	}
}

const FALSE_FRAG = (tx: Queryable): Fragment => tx`FALSE`

const anyLabel = (tx: Queryable): Fragment => tx`EXISTS (
	SELECT 1 FROM issue_labels il
	WHERE il.workspace_id = i.workspace_id AND il.issue_id = i.id
)`

function labelExists(tx: Queryable, ids: readonly string[]): Fragment {
	return tx`EXISTS (
		SELECT 1 FROM issue_labels il
		WHERE il.workspace_id = i.workspace_id
			AND il.issue_id = i.id
			AND il.label_id = ANY(${[...ids]}::uuid[])
	)`
}

function predSql(tx: Queryable, pred: FilterPredicate, now: Date): { where: Fragment; statusJoin: boolean } {
	const def: FilterFieldDef | undefined = FILTER_FIELDS[pred.field]
	if (!def || !def.ops.includes(pred.op)) return { where: FALSE_FRAG(tx), statusJoin: false }
	const statusJoin = pred.field === 'status_category'
	const { op, value: raw } = pred

	if (def.multi) {
		// label_id — set-membership semantics on issue_labels.
		if (op === 'is_null') return { where: tx`NOT ${anyLabel(tx)}`, statusJoin }
		if (op === 'is_not_null') return { where: anyLabel(tx), statusJoin }
		if (raw === null) {
			if (op === 'eq') return { where: tx`NOT ${anyLabel(tx)}`, statusJoin }
			if (op === 'neq') return { where: anyLabel(tx), statusJoin }
			return { where: FALSE_FRAG(tx), statusJoin }
		}
		if (op === 'in' || op === 'nin') {
			if (!Array.isArray(raw)) return { where: FALSE_FRAG(tx), statusJoin }
			const ids = raw.map((v) => normOperand(v, def.type, now))
			if (ids.some((v) => v === undefined)) return { where: FALSE_FRAG(tx), statusJoin }
			const exists = labelExists(tx, ids as string[])
			return { where: op === 'in' ? exists : tx`NOT ${exists}`, statusJoin }
		}
		const w = normOperand(raw, def.type, now)
		if (w === undefined || typeof w !== 'string') return { where: FALSE_FRAG(tx), statusJoin }
		if (op === 'eq') return { where: labelExists(tx, [w]), statusJoin }
		if (op === 'neq') return { where: tx`NOT ${labelExists(tx, [w])}`, statusJoin }
		return { where: FALSE_FRAG(tx), statusJoin }
	}

	const col = issueCol(tx, def.source)

	if (op === 'is_null') return { where: tx`${col} IS NULL`, statusJoin }
	if (op === 'is_not_null') return { where: tx`${col} IS NOT NULL`, statusJoin }
	if (raw === null) {
		if (op === 'eq') return { where: tx`${col} IS NULL`, statusJoin }
		if (op === 'neq') return { where: tx`${col} IS NOT NULL`, statusJoin }
		return { where: FALSE_FRAG(tx), statusJoin }
	}

	if (op === 'contains') {
		if (typeof raw !== 'string' || def.type !== 'text') return { where: FALSE_FRAG(tx), statusJoin }
		return { where: tx`COALESCE(${col} ILIKE ${`%${escapeLike(raw)}%`}, false)`, statusJoin }
	}

	if (op === 'in' || op === 'nin') {
		if (!Array.isArray(raw)) return { where: FALSE_FRAG(tx), statusJoin }
		const vals = raw.map((v) => normOperand(v, def.type, now))
		if (vals.some((v) => v === undefined)) return { where: FALSE_FRAG(tx), statusJoin }
		const arr = arrayParam(tx, vals as (string | number)[], def.type)
		if (op === 'in') return { where: tx`COALESCE(${col} = ANY(${arr}), false)`, statusJoin }
		return statusJoin
			? { where: tx`COALESCE(NOT ${col} = ANY(${arr}), false)`, statusJoin }
			: { where: tx`NOT COALESCE(${col} = ANY(${arr}), false)`, statusJoin }
	}

	const w = normOperand(raw, def.type, now)
	if (w === undefined) return { where: FALSE_FRAG(tx), statusJoin }

	if (def.type === 'text') {
		// title — case-insensitive eq/neq mirroring the evaluator's toLowerCase.
		switch (op) {
			case 'eq':
				return {
					where: tx`COALESCE(LOWER(${col}) = ${w.toString().toLowerCase()}, false)`,
					statusJoin
				}
			case 'neq':
				return {
					where: tx`LOWER(${col}) IS DISTINCT FROM ${w.toString().toLowerCase()}`,
					statusJoin
				}
			default:
				return { where: FALSE_FRAG(tx), statusJoin }
		}
	}

	const v = valueParam(tx, w, def.type)
	switch (op) {
		case 'eq':
			return { where: tx`COALESCE(${col} = ${v}, false)`, statusJoin }
		case 'neq':
			return statusJoin
				? { where: tx`COALESCE(${col} IS DISTINCT FROM ${v}, false)`, statusJoin }
				: { where: tx`${col} IS DISTINCT FROM ${v}`, statusJoin }
		case 'lt':
			return { where: tx`COALESCE(${col} < ${v}, false)`, statusJoin }
		case 'lte':
			return { where: tx`COALESCE(${col} <= ${v}, false)`, statusJoin }
		case 'gt':
			return { where: tx`COALESCE(${col} > ${v}, false)`, statusJoin }
		case 'gte':
			return { where: tx`COALESCE(${col} >= ${v}, false)`, statusJoin }
		default:
			return { where: FALSE_FRAG(tx), statusJoin }
	}
}

function join(tx: Queryable, parts: readonly { where: Fragment }[], sep: Fragment): Fragment {
	return parts.reduce((acc, p, idx) => (idx === 0 ? p.where : tx`${acc}${sep}${p.where}`), tx`` as Fragment)
}

function compile(tx: Queryable, expr: FilterExpr, now: Date): { where: Fragment; statusJoin: boolean } {
	switch (expr.kind) {
		case 'and': {
			if (expr.args.length === 0) return { where: tx`TRUE`, statusJoin: false }
			const parts = expr.args.map((a) => compile(tx, a, now))
			return {
				where: tx`(${join(tx, parts, tx` AND `)})`,
				statusJoin: parts.some((p) => p.statusJoin)
			}
		}
		case 'or': {
			if (expr.args.length === 0) return { where: tx`FALSE`, statusJoin: false }
			const parts = expr.args.map((a) => compile(tx, a, now))
			return {
				where: tx`(${join(tx, parts, tx` OR `)})`,
				statusJoin: parts.some((p) => p.statusJoin)
			}
		}
		case 'not': {
			const inner = compile(tx, expr.arg, now)
			return { where: tx`NOT (${inner.where})`, statusJoin: inner.statusJoin }
		}
		case 'pred':
			return predSql(tx, expr, now)
		default:
			return { where: FALSE_FRAG(tx), statusJoin: false }
	}
}

/**
 * Validates `expr` with the domain authority (422 on failure) and compiles it
 * to a boolean WHERE fragment over `issues i`. `project_statuses s` must be
 * LEFT-JOINed when `.needsStatusJoin` is true.
 */
export function buildIssueFilterSql(tx: Queryable, expr: FilterExpr, ctx: { now: Date }): FilterSqlResult {
	const v = validateFilter(expr)
	if (!v.ok) {
		throw new HttpError(422, 'validation_failed', 'Invalid filter expression', undefined, {
			errors: v.errors
		})
	}
	const out = compile(tx, v.expr, ctx.now)
	return { where: out.where, needsStatusJoin: out.statusJoin }
}
