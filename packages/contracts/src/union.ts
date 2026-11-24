/**
 * Tuple-preserving literal-union helper. `Type.Union(VALUES.map(Type.Literal))`
 * loses the tuple shape (`.map` widens to `TLiteral<U>[]`) and `Static`
 * resolves to `never` under typebox 1.x — rebuild the element types as a
 * mutable mapped tuple so each literal stays its own union branch.
 */
import { type TLiteral, type TUnion, Type } from 'typebox'

export function unionOf<const V extends readonly [string, ...string[]]>(
	values: V
): TUnion<{ -readonly [I in keyof V]: TLiteral<V[I]> }> {
	const schemas = values.map((v) => Type.Literal(v)) as unknown as {
		-readonly [I in keyof V]: TLiteral<V[I]>
	}
	return Type.Union(schemas) as TUnion<{ -readonly [I in keyof V]: TLiteral<V[I]> }>
}
