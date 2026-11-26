/**
 * Shared types and hard resource caps for the sandboxed database formula
 * engine (§4.1, ADR-0026). The engine is pure: time, property values, and
 * variables are always injected by the caller.
 */
export const FORMULA_LIMITS = {
	maxSourceLen: 8192,
	maxAstNodes: 256,
	maxEvalSteps: 2000,
	maxStringLen: 16_384,
	maxListLen: 1000,
	maxDepth: 32
} as const

export interface FormulaDateValue {
	readonly kind: 'date'
	/** UTC ISO timestamp. Date-only values are represented at UTC midnight. */
	readonly iso: string
}

export type FormulaPrimitive = string | number | boolean | null | FormulaDateValue
export type FormulaValue = FormulaPrimitive | readonly FormulaValue[]

export interface FormulaLambdaValue {
	readonly kind: 'lambda'
	readonly param: string
	readonly body: FormulaExpr
}

/** Runtime-only value — lambdas are never valid formula output. */
export type FormulaRuntimeValue = FormulaValue | FormulaLambdaValue

export type FormulaExpr =
	| { readonly kind: 'literal'; readonly value: FormulaValue }
	| { readonly kind: 'prop'; readonly name: string }
	| { readonly kind: 'var'; readonly name: string }
	| { readonly kind: 'call'; readonly name: string; readonly args: readonly FormulaExpr[] }
	| { readonly kind: 'lambda'; readonly param: string; readonly body: FormulaExpr }
	| { readonly kind: 'unary'; readonly op: '-' | '+' | 'not'; readonly arg: FormulaExpr }
	| {
			readonly kind: 'binary'
			readonly op: '+' | '-' | '*' | '/' | '%' | '==' | '!=' | '<' | '<=' | '>' | '>=' | 'and' | 'or'
			readonly left: FormulaExpr
			readonly right: FormulaExpr
	  }

export type FormulaErrorCode =
	| 'parse_error'
	| 'validation_error'
	| 'ast_node_limit'
	| 'eval_step_limit'
	| 'string_limit'
	| 'list_limit'
	| 'type_error'
	| 'unknown_function'
	| 'unknown_property'
	| 'unknown_variable'
	| 'arity_error'
	| 'cycle_detected'
	| 'invalid_date'

export class FormulaError extends Error {
	readonly code: FormulaErrorCode
	readonly position: number | undefined

	constructor(code: FormulaErrorCode, message: string, position?: number) {
		super(message)
		this.name = 'FormulaError'
		this.code = code
		this.position = position
	}
}

export function isFormulaDate(value: FormulaRuntimeValue | undefined): value is FormulaDateValue {
	return (
		typeof value === 'object' &&
		value !== null &&
		!Array.isArray(value) &&
		(value as { kind?: unknown }).kind === 'date' &&
		typeof (value as { iso?: unknown }).iso === 'string'
	)
}

export function isFormulaLambda(value: FormulaRuntimeValue | undefined): value is FormulaLambdaValue {
	return (
		typeof value === 'object' &&
		value !== null &&
		!Array.isArray(value) &&
		(value as { kind?: unknown }).kind === 'lambda'
	)
}
