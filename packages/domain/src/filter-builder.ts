/**
 * Pure editing operations over the FilterExpr AST for the visual filter
 * builder (§3.4). The builder UI in apps/web (and later apps/mobile) manipulates
 * the tree exclusively through these helpers so every intermediate state stays
 * a valid, serializable FilterExpr — the AST itself IS the wire format, no
 * separate serialization step exists.
 *
 * Paths are child indexes into `and`/`or` `args`: `[2, 0]` means "the first
 * child of the group at root.args[2]". Operations never mutate; empty groups
 * are preserved as written (an empty `and` is FILTER_TRUE — the builder uses
 * that as its neutral initial state).
 */
import type { FilterExpr, FilterField, FilterFieldDef, FilterOp, FilterValue } from './filter-ast'
import { FILTER_FIELDS } from './filter-ast'

export type FilterNodePath = readonly number[]

function isScalar(v: unknown): v is string | number | boolean {
	return typeof v === 'string' || typeof v === 'number' || typeof v === 'boolean'
}

/** Legal default value for a (field, op) pair — enum members, numbers, relative dates. */
function defaultValueForField(def: FilterFieldDef): FilterValue {
	if (def.values) return def.values[0] ?? null
	if (def.type === 'int' || def.type === 'number') return def.min ?? 0
	if (def.type === 'date' || def.type === 'datetime') return { relative: '+0d' }
	if (def.type === 'text') return ''
	return null
}

/** Default predicate for a freshly added builder row — always validateFilter-clean. */
export function createPredicate(field: FilterField = 'status_category'): FilterExpr {
	const def = FILTER_FIELDS[field]
	const op = def.ops[0] ?? 'eq'
	if (!opNeedsValue(op)) return { kind: 'pred', field, op }
	return { kind: 'pred', field, op, value: defaultValueForField(def) }
}

export function createGroup(kind: 'and' | 'or' = 'and'): FilterExpr {
	return { kind, args: [createPredicate()] }
}

/** Null-propagating ops drop null children out of the parent group. */
export type FilterNodeEdit = (node: FilterExpr) => FilterExpr | null

function isGroup(node: FilterExpr): node is Extract<FilterExpr, { readonly kind: 'and' | 'or' }> {
	return node.kind === 'and' || node.kind === 'or'
}

/** Inner recursion — null means "this node was removed". */
function updateNodeInner(node: FilterExpr, path: FilterNodePath, edit: FilterNodeEdit): FilterExpr | null {
	if (path.length === 0) return edit(node)
	if (!isGroup(node)) return node
	const [head, ...rest] = path
	const index = head ?? -1
	if (index < 0 || index >= node.args.length) return node
	const args: FilterExpr[] = []
	for (let i = 0; i < node.args.length; i++) {
		const child = node.args[i]
		if (!child) continue
		if (i !== index) {
			args.push(child)
			continue
		}
		const next = updateNodeInner(child, rest, edit)
		// Removed nodes drop out of the parent group; a nested group left
		// empty by the removal collapses too so the builder never shows a
		// dangling empty sub-group. The root itself is exempt — the exported
		// wrapper keeps it as the neutral empty `and`.
		if (next === null) continue
		if (isGroup(next) && next.args.length === 0) continue
		args.push(next)
	}
	return { kind: node.kind, args }
}

/**
 * Apply `edit` to the node at `path`, rebuilding the tree immutably. When the
 * edit returns null the node is removed from its parent group; removing the
 * root itself yields an empty `and` (FILTER_TRUE). Editing a path that does
 * not exist returns the input unchanged.
 */
export function updateFilterNode(root: FilterExpr, path: FilterNodePath, edit: FilterNodeEdit): FilterExpr {
	const next = updateNodeInner(root, path, edit)
	if (next === null) return { kind: 'and', args: [] }
	if (path.length === 0) return next
	// Root groups may legitimately end up empty — that IS the neutral state.
	return next
}

/** Append `node` at the end of the group at `groupPath` (root when empty). */
export function appendFilterNode(root: FilterExpr, groupPath: FilterNodePath, node: FilterExpr): FilterExpr {
	return updateFilterNode(root, groupPath, (target) => {
		if (!isGroup(target)) return target
		return { kind: target.kind, args: [...target.args, node] }
	})
}

export function removeFilterNode(root: FilterExpr, path: FilterNodePath): FilterExpr {
	return updateFilterNode(root, path, () => null)
}

/** Toggle boolean negation: wrap in `not`, or unwrap an existing `not`. */
export function toggleFilterNot(node: FilterExpr): FilterExpr {
	return node.kind === 'not' ? node.arg : { kind: 'not', arg: node }
}

/** Switch a group's combinator; no-op for non-group nodes. */
export function setFilterCombinator(node: FilterExpr, kind: 'and' | 'or'): FilterExpr {
	return isGroup(node) ? { kind, args: node.args } : node
}

export function getFilterNode(root: FilterExpr, path: FilterNodePath): FilterExpr | null {
	let cur: FilterExpr = root
	for (const index of path) {
		if (!isGroup(cur)) return null
		const next = cur.args[index]
		if (!next) return null
		cur = next
	}
	return cur
}

/** Total node count — the builder caps editing beyond validateFilter's 100-node budget. */
export function countFilterNodes(expr: FilterExpr): number {
	if (expr.kind === 'pred') return 1
	if (expr.kind === 'not') return 1 + countFilterNodes(expr.arg)
	return 1 + expr.args.reduce((sum, arg) => sum + countFilterNodes(arg), 0)
}

/**
 * Ops that need no value input in the builder (`is_null` / `is_not_null`).
 * When switching a predicate to one of these the stale `value` must be dropped
 * so validateFilter keeps passing — `patchPredicate` handles that.
 */
export function opNeedsValue(op: FilterOp): boolean {
	return op !== 'is_null' && op !== 'is_not_null'
}

/**
 * Immutably patch a predicate node. Changing `field` resets op/value to that
 * field's first legal combination; changing `op` to a value-less op drops
 * `value`; invalid values for the (field, op) pair are reset to a legal default
 * so every intermediate builder state stays serializable.
 */
export function patchPredicate(
	node: FilterExpr,
	patch: { readonly field?: FilterField; readonly op?: FilterOp; readonly value?: FilterValue }
): FilterExpr {
	if (node.kind !== 'pred') return node
	const field = patch.field ?? node.field
	const def = FILTER_FIELDS[field]
	const fieldChanged = patch.field !== undefined && patch.field !== node.field
	let op = patch.op ?? node.op
	if (fieldChanged || !(def.ops as readonly FilterOp[]).includes(op)) op = def.ops[0] ?? 'eq'
	if (!opNeedsValue(op)) {
		return { kind: 'pred', field, op }
	}
	// Explicit values win; otherwise keep the current value unless the field
	// changed or the op flipped from valueless back to valued.
	const wasValueless = !opNeedsValue(node.op)
	const keepValue = !fieldChanged && !wasValueless ? node.value : undefined
	let value: FilterValue | undefined = patch.value !== undefined ? patch.value : keepValue
	if (value === undefined) value = defaultValueForField(def)
	// `in`/`nin` carry arrays of scalars, every other valued op a scalar —
	// coerce on op switches so validateFilter never sees a shape mismatch
	// mid-edit. Nulls/relative dates can't ride inside `in` lists and reset.
	if (op === 'in' || op === 'nin') {
		if (!Array.isArray(value)) {
			value = isScalar(value) ? [value] : []
		}
	} else if (Array.isArray(value)) {
		const first = value[0]
		value = first !== undefined && isScalar(first) ? first : defaultValueForField(def)
	}
	return { kind: 'pred', field, op, value }
}

/**
 * Human-compact structural equality — used to detect whether a loaded saved
 * view's expr differs from the currently edited one (semantic normalization
 * itself lives in normalizeFilter).
 */
export function filterExprEquals(a: FilterExpr, b: FilterExpr): boolean {
	return JSON.stringify(a) === JSON.stringify(b)
}
