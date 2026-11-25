/**
 * Compile-time drift guard: the wire `FilterExprSchema` type and the domain
 * `FilterExpr` must stay structurally identical (§3.4). tsc failing here means
 * one side changed shape — update the other, not this file.
 *
 * The domain uses `readonly` arrays/props while TypeBox Static emits mutable
 * ones; `DeepMutable` normalizes that known difference before comparing, so
 * genuine drift (field literals, ops, node kinds, value shapes) still fails
 * both directions.
 */
import { describe, expect, test } from 'bun:test'
import type { FilterExprSchema as WireFilterExpr } from '@huriro/contracts'
import type { FilterExpr } from '@huriro/domain'

type DeepMutable<T> = T extends readonly (infer U)[]
	? DeepMutable<U>[]
	: T extends object
		? { -readonly [K in keyof T]: DeepMutable<T[K]> }
		: T

// Wire → domain: fails if the schema gains anything the domain lacks.
function wireToDomain(expr: WireFilterExpr): FilterExpr {
	return expr
}

// Domain → wire: fails if the domain gains anything the schema lacks.
// (readonly on the source is normalized too — a readonly array can never be
// assigned into a mutable one, so the comparison happens deep-mutable.)
function domainToWire(expr: DeepMutable<FilterExpr>): WireFilterExpr {
	return expr
}

describe('FilterExpr wire/domain assignability', () => {
	test('bidirectionally assignable', () => {
		const wire = domainToWire({
			kind: 'and',
			args: [
				{ kind: 'pred', field: 'priority', op: 'gte', value: 2 },
				{ kind: 'not', arg: { kind: 'pred', field: 'label_id', op: 'in', value: ['a', 'b'] } }
			]
		})
		expect(wireToDomain(wire).kind).toBe('and')
	})
})
