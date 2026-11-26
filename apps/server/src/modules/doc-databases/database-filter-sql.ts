/**
 * Structured-database FilterExpr + Sort → SQL compiler (§4.1, ADR-0026).
 *
 * Referenced non-system properties are joined ONCE per property alias (`c_0`,
 * `c_1`, …) over outer row alias `r`, avoiding correlated `EXISTS`/`LATERAL`
 * subplans and keeping predicates sargable for PostgreSQL partial/covering
 * indexes. Aliases are integer-indexed internal identifiers and all user
 * values are bound parameters, so view config can never inject SQL.
 */
import type { Queryable } from '@huriro/db'
import type { DatabaseFilterExpr, DatabasePropertyMeta, DatabaseSortSpec } from '@huriro/domain'
import { validateDatabaseFilter } from '@huriro/domain'
import { HttpError } from '../../api/error'

function emptySql(tx: Queryable) {
	return tx``
}
type Fragment = ReturnType<typeof emptySql>

const SYSTEM_COLUMNS = new Set(['title', 'created_time', 'updated_time', 'created_by', 'updated_by'])
const MULTI_TYPES = new Set(['multi_select', 'person', 'file', 'relation'])
const COMPUTED_TYPES = new Set(['formula', 'rollup'])
const TEXT_CELL_TYPES = new Set(['text', 'url', 'email', 'phone', 'select', 'status'])

export interface CompiledDatabaseRowQuery {
	readonly joins: Fragment
	readonly where: Fragment
	readonly order: Fragment
	readonly hasCellJoins: boolean
}

function joinFragments(tx: Queryable, parts: readonly Fragment[], sep: Fragment): Fragment {
	if (parts.length === 0) return tx``
	return parts.reduce((acc, part, index) => (index === 0 ? part : tx`${acc}${sep}${part}`), tx`` as Fragment)
}

function cellAlias(tx: Queryable, index: number): Fragment {
	if (!Number.isInteger(index) || index < 0) {
		throw new Error(`Invalid database cell alias index: ${index}`)
	}
	// postgres.js exposes an identifier helper on the callable Sql/TransactionSql object.
	const ident = tx(`c_${index}`)
	return ident as unknown as Fragment
}

function systemColumn(tx: Queryable, propType: string): Fragment {
	switch (propType) {
		case 'title':
			return tx`r.title`
		case 'created_time':
			return tx`r.created_at`
		case 'updated_time':
			return tx`r.updated_at`
		case 'created_by':
			return tx`r.created_by`
		case 'updated_by':
			return tx`r.updated_by`
		default:
			return tx`NULL`
	}
}

function typedCellColumn(tx: Queryable, alias: Fragment, propType: string): Fragment {
	if (propType === 'number') return tx`${alias}.val_number`
	if (propType === 'checkbox') return tx`${alias}.val_bool`
	if (propType === 'date') return tx`${alias}.val_date_start`
	if (MULTI_TYPES.has(propType)) return tx`${alias}.val_json`
	return tx`${alias}.val_text`
}

function genericTextValue(tx: Queryable, alias: Fragment): Fragment {
	return tx`COALESCE(${alias}.val_text, ${alias}.val_number::text, ${alias}.val_bool::text, ${alias}.val_date_start::text, ${alias}.val_json::text)`
}

function notNullGuard(tx: Queryable, alias: Fragment, propType: string): Fragment {
	if (propType === 'number') return tx`AND ${alias}.val_number IS NOT NULL`
	if (propType === 'checkbox') return tx`AND ${alias}.val_bool IS NOT NULL`
	if (propType === 'date') return tx`AND ${alias}.val_date_start IS NOT NULL`
	if (MULTI_TYPES.has(propType)) return tx`AND ${alias}.val_json IS NOT NULL`
	if (TEXT_CELL_TYPES.has(propType)) return tx`AND ${alias}.val_text IS NOT NULL`
	return tx``
}

function collectReferencedProperties(
	filter: DatabaseFilterExpr | null,
	sorts: readonly DatabaseSortSpec[],
	propsById: ReadonlyMap<string, DatabasePropertyMeta>
): Map<string, number> {
	const aliasIndexByPropId = new Map<string, number>()
	const register = (propertyId: string) => {
		const prop = propsById.get(propertyId)
		if (!prop || SYSTEM_COLUMNS.has(prop.propType) || aliasIndexByPropId.has(propertyId)) return
		aliasIndexByPropId.set(propertyId, aliasIndexByPropId.size)
	}
	const visit = (node: DatabaseFilterExpr) => {
		if (node.kind === 'predicate') {
			register(node.propertyId)
			return
		}
		if (node.kind === 'not') {
			visit(node.child)
			return
		}
		for (const child of node.children) visit(child)
	}
	if (filter) visit(filter)
	for (const sort of sorts) register(sort.propertyId)
	return aliasIndexByPropId
}

function jsonContains(tx: Queryable, col: Fragment, prop: DatabasePropertyMeta, value: unknown): Fragment {
	if (value === undefined) return tx`FALSE`
	if (typeof value === 'object' && value !== null) {
		return tx`${col} @> ${tx.json([value] as never)}`
	}
	const needle = String(value)
	if (prop.propType === 'multi_select') {
		return tx`${col} @> ${tx.json([needle] as never)}`
	}
	return tx`(${col} @> ${tx.json([needle] as never)} OR ${col} @> ${tx.json([{ id: needle }] as never)} OR ${col} @> ${tx.json([{ targetId: needle }] as never)})`
}

function isNullCheck(
	tx: Queryable,
	prop: DatabasePropertyMeta,
	col: Fragment,
	alias: Fragment | null
): Fragment {
	if (SYSTEM_COLUMNS.has(prop.propType)) return tx`${col} IS NULL`
	if (MULTI_TYPES.has(prop.propType)) return tx`(${col} IS NULL OR ${col} = '[]'::jsonb)`
	if (COMPUTED_TYPES.has(prop.propType) && alias) {
		return tx`(${alias}.val_text IS NULL AND ${alias}.val_number IS NULL AND ${alias}.val_bool IS NULL AND ${alias}.val_date_start IS NULL AND (${alias}.val_json IS NULL OR ${alias}.val_json = '[]'::jsonb))`
	}
	return tx`${col} IS NULL`
}

function isNotNullCheck(
	tx: Queryable,
	prop: DatabasePropertyMeta,
	col: Fragment,
	alias: Fragment | null
): Fragment {
	if (SYSTEM_COLUMNS.has(prop.propType)) return tx`${col} IS NOT NULL`
	if (MULTI_TYPES.has(prop.propType)) return tx`(${col} IS NOT NULL AND ${col} <> '[]'::jsonb)`
	if (COMPUTED_TYPES.has(prop.propType) && alias) {
		return tx`(${alias}.val_text IS NOT NULL OR ${alias}.val_number IS NOT NULL OR ${alias}.val_bool IS NOT NULL OR ${alias}.val_date_start IS NOT NULL OR (${alias}.val_json IS NOT NULL AND ${alias}.val_json <> '[]'::jsonb))`
	}
	return tx`${col} IS NOT NULL`
}

function numericComparison(tx: Queryable, col: Fragment, op: string, rawNumber: number): Fragment {
	const v = tx`${String(rawNumber)}::numeric`
	switch (op) {
		case 'eq':
			return tx`${col} = ${v}`
		case 'neq':
			return tx`${col} IS DISTINCT FROM ${v}`
		case 'lt':
			return tx`${col} < ${v}`
		case 'lte':
			return tx`${col} <= ${v}`
		case 'gt':
			return tx`${col} > ${v}`
		case 'gte':
			return tx`${col} >= ${v}`
		default:
			return tx`FALSE`
	}
}

function dateComparison(tx: Queryable, col: Fragment, op: string, rawIso: string): Fragment {
	const v = tx`${rawIso}::timestamptz`
	switch (op) {
		case 'eq':
			return tx`${col} = ${v}`
		case 'neq':
			return tx`${col} IS DISTINCT FROM ${v}`
		case 'lt':
			return tx`${col} < ${v}`
		case 'lte':
			return tx`${col} <= ${v}`
		case 'gt':
			return tx`${col} > ${v}`
		case 'gte':
			return tx`${col} >= ${v}`
		default:
			return tx`FALSE`
	}
}

function textComparison(tx: Queryable, colExpr: Fragment, op: string, normalizedText: string): Fragment {
	switch (op) {
		case 'eq':
			return tx`${colExpr} = ${normalizedText}`
		case 'neq':
			return tx`${colExpr} IS DISTINCT FROM ${normalizedText}`
		case 'lt':
			return tx`${colExpr} COLLATE "C" < ${normalizedText}`
		case 'lte':
			return tx`${colExpr} COLLATE "C" <= ${normalizedText}`
		case 'gt':
			return tx`${colExpr} COLLATE "C" > ${normalizedText}`
		case 'gte':
			return tx`${colExpr} COLLATE "C" >= ${normalizedText}`
		default:
			return tx`FALSE`
	}
}

function compileInList(
	tx: Queryable,
	prop: DatabasePropertyMeta,
	col: Fragment,
	alias: Fragment | null,
	values: readonly unknown[]
): Fragment {
	if (values.length === 0) return tx`FALSE`
	if (prop.propType === 'number') {
		const nums = values
			.filter((v): v is number => typeof v === 'number' && Number.isFinite(v))
			.map((v) => String(v))
		return nums.length === 0 ? tx`FALSE` : tx`${col} = ANY(${nums}::numeric[])`
	}
	if (prop.propType === 'date' || prop.propType === 'created_time' || prop.propType === 'updated_time') {
		const isos = values
			.map((v) => (typeof v === 'string' ? Date.parse(v) : Number.NaN))
			.filter(Number.isFinite)
			.map((ms) => new Date(ms).toISOString())
		return isos.length === 0 ? tx`FALSE` : tx`${col} = ANY(${isos}::timestamptz[])`
	}
	if (prop.propType === 'checkbox') {
		const bools = values.filter((v): v is boolean => typeof v === 'boolean')
		return bools.length === 0 ? tx`FALSE` : tx`${col} = ANY(${bools}::boolean[])`
	}
	if (COMPUTED_TYPES.has(prop.propType) && alias) {
		const parts: Fragment[] = []
		const nums = values
			.filter((v): v is number => typeof v === 'number' && Number.isFinite(v))
			.map((v) => String(v))
		if (nums.length > 0) parts.push(tx`${alias}.val_number = ANY(${nums}::numeric[])`)
		const bools = values.filter((v): v is boolean => typeof v === 'boolean')
		if (bools.length > 0) parts.push(tx`${alias}.val_bool = ANY(${bools}::boolean[])`)
		const strs = values
			.filter((v) => v !== null && v !== undefined && typeof v !== 'number' && typeof v !== 'boolean')
			.map((v) => (typeof v === 'object' ? JSON.stringify(v) : String(v)).toLowerCase())
		if (strs.length > 0) {
			parts.push(
				tx`LOWER(COALESCE(${alias}.val_text, ${alias}.val_date_start::text, ${alias}.val_json::text)) = ANY(${strs}::text[])`
			)
		}
		return parts.length === 0 ? tx`FALSE` : tx`(${joinFragments(tx, parts, tx` OR `)})`
	}
	const normalized = values
		.filter((v) => v !== null && v !== undefined)
		.map((v) => (typeof v === 'object' ? JSON.stringify(v) : String(v)).toLowerCase())
	if (normalized.length === 0) return tx`FALSE`
	const isTextCol = prop.propType === 'title' || TEXT_CELL_TYPES.has(prop.propType)
	return isTextCol
		? tx`LOWER(${col}) = ANY(${normalized}::text[])`
		: tx`LOWER(${col}::text) = ANY(${normalized}::text[])`
}

function compilePredicate(
	tx: Queryable,
	prop: DatabasePropertyMeta | undefined,
	alias: Fragment | null,
	op: string,
	value: unknown
): Fragment {
	if (!prop) return tx`FALSE`
	const isSystem = SYSTEM_COLUMNS.has(prop.propType)
	if (!isSystem && !alias) return tx`FALSE`
	const col: Fragment = isSystem
		? systemColumn(tx, prop.propType)
		: COMPUTED_TYPES.has(prop.propType)
			? genericTextValue(tx, alias as Fragment)
			: typedCellColumn(tx, alias as Fragment, prop.propType)

	if (op === 'is_null') return isNullCheck(tx, prop, col, alias)
	if (op === 'is_not_null') return isNotNullCheck(tx, prop, col, alias)

	if (value === null) {
		if (op === 'eq') {
			if (COMPUTED_TYPES.has(prop.propType) && alias) {
				return tx`(${alias}.val_text IS NULL AND ${alias}.val_number IS NULL AND ${alias}.val_bool IS NULL AND ${alias}.val_date_start IS NULL AND ${alias}.val_json IS NULL)`
			}
			return tx`${col} IS NULL`
		}
		if (op === 'neq') {
			if (COMPUTED_TYPES.has(prop.propType) && alias) {
				return tx`(${alias}.val_text IS NOT NULL OR ${alias}.val_number IS NOT NULL OR ${alias}.val_bool IS NOT NULL OR ${alias}.val_date_start IS NOT NULL OR ${alias}.val_json IS NOT NULL)`
			}
			return tx`${col} IS NOT NULL`
		}
		return tx`FALSE`
	}

	if (MULTI_TYPES.has(prop.propType)) {
		if (op === 'contains' || op === 'eq') return jsonContains(tx, col, prop, value)
		if (op === 'neq') {
			if (value === undefined) return tx`TRUE`
			return tx`NOT COALESCE((${jsonContains(tx, col, prop, value)}), false)`
		}
		if (op === 'in' || op === 'nin') {
			if (!Array.isArray(value)) return tx`FALSE`
			if (value.length === 0) return op === 'in' ? tx`FALSE` : tx`TRUE`
			const parts = value.map((item) => jsonContains(tx, col, prop, item))
			const anyMatch = joinFragments(tx, parts, tx` OR `)
			return op === 'in' ? tx`(${anyMatch})` : tx`NOT COALESCE((${anyMatch}), false)`
		}
		return tx`FALSE`
	}

	if (op === 'contains') {
		if (typeof value !== 'string') return tx`FALSE`
		const escaped = value.replace(/[\\%_]/g, (c) => `\\${c}`)
		const pattern = `%${escaped}%`
		const isTextCol = prop.propType === 'title' || TEXT_CELL_TYPES.has(prop.propType)
		return isTextCol ? tx`${col} ILIKE ${pattern}` : tx`${col}::text ILIKE ${pattern}`
	}

	if (op === 'in' || op === 'nin') {
		if (!Array.isArray(value)) return tx`FALSE`
		if (value.length === 0) return op === 'in' ? tx`FALSE` : tx`TRUE`
		const match = compileInList(tx, prop, col, alias, value)
		return op === 'in' ? match : tx`NOT COALESCE((${match}), false)`
	}

	if (prop.propType === 'number') {
		if (typeof value === 'number' && Number.isFinite(value)) {
			return numericComparison(tx, col, op, value)
		}
		if (
			(op === 'lt' || op === 'lte' || op === 'gt' || op === 'gte') &&
			typeof value === 'string' &&
			value.trim() !== ''
		) {
			const parsed = Number(value)
			if (Number.isFinite(parsed)) return numericComparison(tx, col, op, parsed)
		}
		return op === 'neq' ? tx`TRUE` : tx`FALSE`
	}

	if (prop.propType === 'date' || prop.propType === 'created_time' || prop.propType === 'updated_time') {
		const ms = typeof value === 'string' ? Date.parse(value) : Number.NaN
		if (!Number.isFinite(ms)) return op === 'neq' ? tx`TRUE` : tx`FALSE`
		return dateComparison(tx, col, op, new Date(ms).toISOString())
	}

	if (prop.propType === 'checkbox') {
		if (typeof value !== 'boolean') return op === 'neq' ? tx`TRUE` : tx`FALSE`
		if (op === 'eq') return tx`${col} = ${value}`
		if (op === 'neq') return tx`${col} IS DISTINCT FROM ${value}`
		return tx`FALSE`
	}

	if (COMPUTED_TYPES.has(prop.propType) && alias) {
		if (typeof value === 'number' && Number.isFinite(value)) {
			return numericComparison(tx, tx`${alias}.val_number`, op, value)
		}
		if (typeof value === 'boolean') {
			if (op === 'eq') return tx`${alias}.val_bool = ${value}`
			if (op === 'neq') return tx`${alias}.val_bool IS DISTINCT FROM ${value}`
			return tx`FALSE`
		}
		if (typeof value === 'string' && value.includes('-')) {
			const ms = Date.parse(value)
			if (Number.isFinite(ms)) {
				return dateComparison(tx, tx`${alias}.val_date_start`, op, new Date(ms).toISOString())
			}
		}
	}

	if (value === undefined) return op === 'neq' ? tx`TRUE` : tx`FALSE`
	const normalized = (typeof value === 'object' ? JSON.stringify(value) : String(value)).toLowerCase()
	const isTextCol = prop.propType === 'title' || TEXT_CELL_TYPES.has(prop.propType)
	const colExpr = isTextCol ? tx`LOWER(${col})` : tx`LOWER(${col}::text)`
	return textComparison(tx, colExpr, op, normalized)
}

function compileExpr(
	tx: Queryable,
	expr: DatabaseFilterExpr,
	propsById: ReadonlyMap<string, DatabasePropertyMeta>,
	aliasByPropId: ReadonlyMap<string, Fragment>
): Fragment {
	if (expr.kind === 'predicate') {
		return compilePredicate(
			tx,
			propsById.get(expr.propertyId),
			aliasByPropId.get(expr.propertyId) ?? null,
			expr.op,
			expr.value
		)
	}
	if (expr.kind === 'not') {
		// Two-valued NOT preserves domain semantics when a cell is missing or NULL.
		return tx`NOT COALESCE((${compileExpr(tx, expr.child, propsById, aliasByPropId)}), false)`
	}
	const parts = expr.children.map((child) => compileExpr(tx, child, propsById, aliasByPropId))
	if (parts.length === 0) return expr.kind === 'and' ? tx`TRUE` : tx`FALSE`
	const sep = expr.kind === 'and' ? tx` AND ` : tx` OR `
	return tx`(${joinFragments(tx, parts, sep)})`
}

function sortExpr(tx: Queryable, prop: DatabasePropertyMeta, alias: Fragment | null): Fragment {
	if (SYSTEM_COLUMNS.has(prop.propType)) {
		if (prop.propType === 'title') return tx`LOWER(r.title) COLLATE "C"`
		return systemColumn(tx, prop.propType)
	}
	if (!alias) return tx`NULL`
	if (prop.propType === 'number') return tx`${alias}.val_number`
	if (prop.propType === 'checkbox') return tx`${alias}.val_bool`
	if (prop.propType === 'date') return tx`${alias}.val_date_start`
	if (TEXT_CELL_TYPES.has(prop.propType)) return tx`LOWER(${alias}.val_text) COLLATE "C"`
	return genericTextValue(tx, alias)
}

/**
 * Validate and compile a structured-database query (filter + sorts) into
 * deduplicated per-property `LEFT JOIN`s, a sargable `WHERE` fragment, and an
 * `ORDER BY` fragment over outer row alias `r`.
 */
export function buildDatabaseRowQuerySql(
	tx: Queryable,
	workspaceId: string,
	options: {
		readonly filter: unknown
		readonly sorts: readonly DatabaseSortSpec[]
		readonly properties: readonly DatabasePropertyMeta[]
	}
): CompiledDatabaseRowQuery {
	const propsById = new Map(options.properties.map((p) => [p.id, p]))
	let validatedFilter: DatabaseFilterExpr | null = null
	if (options.filter !== undefined && options.filter !== null) {
		const validation = validateDatabaseFilter(options.filter, options.properties)
		if (!validation.ok) {
			throw new HttpError(422, 'validation_failed', 'Invalid database filter expression', undefined, {
				errors: validation.errors
			})
		}
		validatedFilter = options.filter as DatabaseFilterExpr
	}

	const limitedSorts = options.sorts.slice(0, 8)
	for (const sort of limitedSorts) {
		if (!propsById.has(sort.propertyId)) {
			throw new HttpError(422, 'validation_failed', `Unknown sort property ${sort.propertyId}`)
		}
	}

	const aliasIndexByPropId = collectReferencedProperties(validatedFilter, limitedSorts, propsById)
	const aliasByPropId = new Map<string, Fragment>()
	const joinParts: Fragment[] = []
	for (const [propId, index] of aliasIndexByPropId) {
		const prop = propsById.get(propId)
		if (!prop) continue
		const alias = cellAlias(tx, index)
		aliasByPropId.set(propId, alias)
		const guard = notNullGuard(tx, alias, prop.propType)
		joinParts.push(
			tx`LEFT JOIN doc_database_cell_values ${alias} ON ${alias}.workspace_id = ${workspaceId}::uuid AND ${alias}.row_id = r.id AND ${alias}.property_id = ${prop.id}::uuid ${guard}`
		)
	}

	const where = validatedFilter ? compileExpr(tx, validatedFilter, propsById, aliasByPropId) : tx`TRUE`

	const orderParts: Fragment[] = []
	for (const sort of limitedSorts) {
		const prop = propsById.get(sort.propertyId)
		if (!prop) continue
		const expr = sortExpr(tx, prop, aliasByPropId.get(sort.propertyId) ?? null)
		orderParts.push(sort.direction === 'asc' ? tx`${expr} ASC NULLS LAST` : tx`${expr} DESC NULLS LAST`)
	}
	orderParts.push(tx`r.id ASC`)

	return {
		joins: joinFragments(tx, joinParts, tx` `),
		where,
		order: joinFragments(tx, orderParts, tx`, `),
		hasCellJoins: joinParts.length > 0
	}
}
