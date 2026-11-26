/**
 * Property-aware structured-database filter model (§4.1, ADR-0026). Pure and
 * shared so server SQL and local replica evaluation use the same semantics.
 */

export const DATABASE_FILTER_LIMITS = { maxDepth: 8, maxNodes: 128, maxInList: 100 } as const

export type DatabaseFilterOp =
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

export type DatabaseFilterExpr =
	| {
			readonly kind: 'predicate'
			readonly propertyId: string
			readonly op: DatabaseFilterOp
			readonly value?: unknown
	  }
	| { readonly kind: 'and' | 'or'; readonly children: readonly DatabaseFilterExpr[] }
	| { readonly kind: 'not'; readonly child: DatabaseFilterExpr }

export interface DatabaseSortSpec {
	readonly propertyId: string
	readonly direction: 'asc' | 'desc'
}

export interface DatabasePropertyMeta {
	readonly id: string
	readonly name: string
	readonly propType: string
}

export interface DatabaseCellValueLike {
	readonly text?: string | null
	readonly number?: number | null
	readonly boolean?: boolean | null
	readonly dateStart?: string | null
	readonly dateEnd?: string | null
	readonly json?: unknown
}

export interface DatabaseRowLike {
	readonly title: string
	readonly createdAt: string
	readonly updatedAt: string
	readonly createdBy: string
	readonly updatedBy: string | null
	readonly cells: Readonly<Record<string, DatabaseCellValueLike | undefined>>
}

export interface DatabaseFilterValidation {
	readonly ok: boolean
	readonly errors: readonly string[]
}

const OPS = new Set<DatabaseFilterOp>([
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
])
const TEXT_TYPES = new Set([
	'title',
	'text',
	'url',
	'email',
	'phone',
	'select',
	'status',
	'created_by',
	'updated_by'
])
const NUMBER_TYPES = new Set(['number'])
const MULTI_TYPES = new Set(['multi_select', 'person', 'file', 'relation'])

function isRecord(value: unknown): value is Record<string, unknown> {
	return typeof value === 'object' && value !== null && !Array.isArray(value)
}

function findProperty(
	properties: readonly DatabasePropertyMeta[],
	propertyId: string
): DatabasePropertyMeta | undefined {
	for (let i = 0; i < properties.length; i++) {
		const prop = properties[i]
		if (prop && prop.id === propertyId) return prop
	}
	return undefined
}

function nodeCount(expr: DatabaseFilterExpr): number {
	if (expr.kind === 'predicate') return 1
	if (expr.kind === 'not') return 1 + nodeCount(expr.child)
	return 1 + expr.children.reduce((sum, child) => sum + nodeCount(child), 0)
}

function depth(expr: DatabaseFilterExpr): number {
	if (expr.kind === 'predicate') return 1
	if (expr.kind === 'not') return 1 + depth(expr.child)
	return 1 + Math.max(0, ...expr.children.map(depth))
}

function scalar(value: unknown): string | number | boolean | null {
	if (value === undefined || value === null) return null
	if (typeof value === 'string' || typeof value === 'number' || typeof value === 'boolean') return value
	return null
}

function isUtcIso24(value: string): boolean {
	return (
		value.length === 24 &&
		value.charCodeAt(4) === 45 &&
		value.charCodeAt(7) === 45 &&
		value.charCodeAt(10) === 84 &&
		value.charCodeAt(13) === 58 &&
		value.charCodeAt(16) === 58 &&
		value.charCodeAt(19) === 46 &&
		value.charCodeAt(23) === 90 &&
		value.charCodeAt(0) >= 48 &&
		value.charCodeAt(0) <= 57
	)
}

/** Extract the canonical scalar/multi value for one property from sparse cells. */
export function databaseCellValue(row: DatabaseRowLike, property: DatabasePropertyMeta | undefined): unknown {
	if (!property) return null
	const propType = property.propType
	if (propType === 'title') return row.title
	if (propType === 'created_time') return row.createdAt
	if (propType === 'updated_time') return row.updatedAt
	if (propType === 'created_by') return row.createdBy
	if (propType === 'updated_by') return row.updatedBy
	const cell = row.cells[property.id]
	if (!cell) return null
	if (cell.text !== undefined && cell.text !== null) return cell.text
	if (cell.number !== undefined && cell.number !== null) return cell.number
	if (cell.boolean !== undefined && cell.boolean !== null) return cell.boolean
	if (cell.dateStart !== undefined && cell.dateStart !== null) {
		return cell.dateEnd ? [cell.dateStart, cell.dateEnd] : cell.dateStart
	}
	if (cell.json !== undefined && cell.json !== null) return cell.json
	return null
}

function compareScalar(a: unknown, b: unknown): number | null {
	const av = scalar(a)
	const bv = scalar(b)
	if (av === null || bv === null) return null
	if (typeof av === 'number' && typeof bv === 'number' && Number.isFinite(av) && Number.isFinite(bv)) {
		return av - bv
	}
	if (typeof av === 'boolean' && typeof bv === 'boolean') {
		return av === bv ? 0 : av ? 1 : -1
	}
	if (typeof av === 'string' && typeof bv === 'string') {
		// Fast path for canonical 24-char UTC ISO timestamps avoids repeated Date.parse calls.
		if (isUtcIso24(av) && isUtcIso24(bv)) return av < bv ? -1 : av > bv ? 1 : 0
		if (av.includes('-')) {
			const ad = Date.parse(av)
			if (Number.isFinite(ad)) {
				const bd = Date.parse(bv)
				if (Number.isFinite(bd)) return ad - bd
			}
		}
		const an = av.trim() !== '' ? Number(av) : Number.NaN
		if (Number.isFinite(an)) {
			const bn = bv.trim() !== '' ? Number(bv) : Number.NaN
			if (Number.isFinite(bn)) return an - bn
		}
		const as = av.toLowerCase()
		const bs = bv.toLowerCase()
		return as < bs ? -1 : as > bs ? 1 : 0
	}
	const avStr = String(av)
	if (avStr.includes('-')) {
		const ad = Date.parse(avStr)
		if (Number.isFinite(ad)) {
			const bd = Date.parse(String(bv))
			if (Number.isFinite(bd)) return ad - bd
		}
	}
	const an =
		typeof av === 'number' ? av : typeof av === 'string' && av.trim() !== '' ? Number(av) : Number.NaN
	const bn =
		typeof bv === 'number' ? bv : typeof bv === 'string' && bv.trim() !== '' ? Number(bv) : Number.NaN
	if (Number.isFinite(an) && Number.isFinite(bn)) return an - bn
	const as = avStr.toLowerCase()
	const bs = String(bv).toLowerCase()
	return as < bs ? -1 : as > bs ? 1 : 0
}

function sameValue(a: unknown, b: unknown): boolean {
	if (a === b) return true
	if (a === null || a === undefined) return b === null || b === undefined
	if (b === null || b === undefined) return false
	if (typeof a === 'string' && typeof b === 'string') return a.toLowerCase() === b.toLowerCase()
	if (typeof a === 'object' || typeof b === 'object') return JSON.stringify(a) === JSON.stringify(b)
	return false
}

function arrayContainsValue(haystack: readonly unknown[], needle: unknown): boolean {
	for (let i = 0; i < haystack.length; i++) {
		if (sameValue(haystack[i], needle)) return true
	}
	return false
}

function evalPredicate(
	expr: Extract<DatabaseFilterExpr, { kind: 'predicate' }>,
	row: DatabaseRowLike,
	property: DatabasePropertyMeta | undefined
): boolean {
	const raw = databaseCellValue(row, property)
	const op = expr.op
	const operand = expr.value
	if (op === 'is_null') return raw === null || raw === undefined || (Array.isArray(raw) && raw.length === 0)
	if (op === 'is_not_null')
		return !(raw === null || raw === undefined || (Array.isArray(raw) && raw.length === 0))
	if (operand === null) {
		if (op === 'eq') return raw === null || raw === undefined
		if (op === 'neq') return raw !== null && raw !== undefined
	}
	if (op === 'contains') {
		if (Array.isArray(raw)) return arrayContainsValue(raw, operand)
		if (typeof raw === 'string' && typeof operand === 'string') {
			return raw.includes(operand) || raw.toLowerCase().includes(operand.toLowerCase())
		}
		return false
	}
	if (op === 'in' || op === 'nin') {
		if (!Array.isArray(operand)) return false
		let found = false
		if (Array.isArray(raw)) {
			for (let i = 0; i < operand.length; i++) {
				if (arrayContainsValue(raw, operand[i])) {
					found = true
					break
				}
			}
		} else if (raw !== null && raw !== undefined) {
			for (let i = 0; i < operand.length; i++) {
				if (sameValue(raw, operand[i])) {
					found = true
					break
				}
			}
		}
		return op === 'in' ? found : !found
	}
	if (op === 'eq') {
		if (Array.isArray(raw)) return arrayContainsValue(raw, operand)
		return raw !== null && raw !== undefined && sameValue(raw, operand)
	}
	if (op === 'neq') {
		if (Array.isArray(raw)) return !arrayContainsValue(raw, operand)
		return raw === null || raw === undefined || !sameValue(raw, operand)
	}
	const cmp = compareScalar(Array.isArray(raw) ? raw[0] : raw, operand)
	if (cmp === null) {
		// SQL parity: ordered comparisons fail on NULL, including under NOT.
		return false
	}
	if (op === 'lt') return cmp < 0
	if (op === 'lte') return cmp <= 0
	if (op === 'gt') return cmp > 0
	if (op === 'gte') return cmp >= 0
	return false
}

function evalNode(
	node: DatabaseFilterExpr,
	row: DatabaseRowLike,
	properties: readonly DatabasePropertyMeta[]
): boolean {
	if (node.kind === 'predicate') return evalPredicate(node, row, findProperty(properties, node.propertyId))
	if (node.kind === 'and') {
		const children = node.children
		for (let i = 0; i < children.length; i++) {
			const child = children[i]
			if (!child || !evalNode(child, row, properties)) return false
		}
		return true
	}
	if (node.kind === 'or') {
		const children = node.children
		for (let i = 0; i < children.length; i++) {
			const child = children[i]
			if (child && evalNode(child, row, properties)) return true
		}
		return false
	}
	if (node.kind === 'not') return !evalNode(node.child, row, properties)
	return false
}

/** Evaluate a validated or unvalidated expression defensively; invalid nodes are false. */
export function evaluateDatabaseFilter(
	expr: DatabaseFilterExpr,
	row: DatabaseRowLike,
	properties: readonly DatabasePropertyMeta[]
): boolean {
	try {
		return evalNode(expr, row, properties)
	} catch {
		return false
	}
}

export function validateDatabaseFilter(
	expr: unknown,
	properties: readonly DatabasePropertyMeta[]
): DatabaseFilterValidation {
	const errors: string[] = []
	const byId = new Map(properties.map((p) => [p.id, p]))
	if (!isRecord(expr) || typeof expr['kind'] !== 'string')
		return { ok: false, errors: ['filter root must be an object'] }
	const root = expr as unknown as DatabaseFilterExpr
	if (nodeCount(root) > DATABASE_FILTER_LIMITS.maxNodes)
		errors.push(`filter exceeds ${DATABASE_FILTER_LIMITS.maxNodes} nodes`)
	if (depth(root) > DATABASE_FILTER_LIMITS.maxDepth)
		errors.push(`filter exceeds ${DATABASE_FILTER_LIMITS.maxDepth} levels`)
	const visit = (node: DatabaseFilterExpr): void => {
		if (node.kind === 'predicate') {
			const prop = byId.get(node.propertyId)
			if (!prop) errors.push(`unknown property ${node.propertyId}`)
			if (!OPS.has(node.op)) errors.push(`unsupported op ${String(node.op)}`)
			if (
				(node.op === 'in' || node.op === 'nin') &&
				(!Array.isArray(node.value) || node.value.length > DATABASE_FILTER_LIMITS.maxInList)
			) {
				errors.push(`${node.op} requires an array of at most ${DATABASE_FILTER_LIMITS.maxInList} values`)
			}
			void TEXT_TYPES
			if (node.op === 'contains' && prop && NUMBER_TYPES.has(prop.propType))
				errors.push('contains is not valid for number properties')
			if (
				(node.op === 'lt' || node.op === 'lte' || node.op === 'gt' || node.op === 'gte') &&
				prop &&
				MULTI_TYPES.has(prop.propType)
			) {
				errors.push(`range comparison is not valid for ${prop.propType}`)
			}
			if ((node.op === 'is_null' || node.op === 'is_not_null') && node.value !== undefined)
				errors.push(`${node.op} does not take a value`)
			return
		}
		if (node.kind === 'not') {
			visit(node.child)
			return
		}
		if (!Array.isArray(node.children)) {
			errors.push(`${node.kind} group requires children`)
			return
		}
		for (const child of node.children) visit(child)
	}
	visit(root)
	return { ok: errors.length === 0, errors }
}

/** Shared sort comparator for local replicas; missing values sort last. */
export function compareDatabaseRows(
	a: DatabaseRowLike,
	b: DatabaseRowLike,
	sorts: readonly DatabaseSortSpec[],
	properties: readonly DatabasePropertyMeta[]
): number {
	for (let i = 0; i < sorts.length; i++) {
		const sort = sorts[i]
		if (!sort) continue
		const prop = findProperty(properties, sort.propertyId)
		const av = databaseCellValue(a, prop)
		const bv = databaseCellValue(b, prop)
		const aNull = av === null || av === undefined
		const bNull = bv === null || bv === undefined
		if (aNull && bNull) continue
		if (aNull) return 1
		if (bNull) return -1
		const cmp = compareScalar(Array.isArray(av) ? av[0] : av, Array.isArray(bv) ? bv[0] : bv) ?? 0
		if (cmp !== 0) return sort.direction === 'asc' ? cmp : -cmp
	}
	return 0
}
