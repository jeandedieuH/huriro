import { extractFormulaPropDependencies, parseFormula } from './parser'
import {
	FORMULA_LIMITS,
	type FormulaDateValue,
	FormulaError,
	type FormulaErrorCode,
	type FormulaExpr,
	type FormulaRuntimeValue,
	type FormulaValue,
	isFormulaDate,
	isFormulaLambda
} from './types'

export interface FormulaEvalContext {
	/** Typed property accessor — missing names must return undefined. */
	readonly prop: (name: string) => FormulaValue | undefined
	/** Injected clock. `now()`/`today()` are deterministic only because this is explicit. */
	readonly now: Date
	readonly variables?: Readonly<Record<string, FormulaValue>> | undefined
	readonly maxEvalSteps?: number | undefined
}

interface EvalState {
	steps: number
	readonly maxSteps: number
}

function step(state: EvalState, amount = 1): void {
	state.steps += amount
	if (state.steps > state.maxSteps) {
		throw new FormulaError('eval_step_limit', `Formula evaluation exceeded ${state.maxSteps} steps`)
	}
}

function assertStringLen(value: string): string {
	if (value.length > FORMULA_LIMITS.maxStringLen) {
		throw new FormulaError('string_limit', `Formula string exceeds ${FORMULA_LIMITS.maxStringLen} characters`)
	}
	return value
}

function assertList<T>(value: readonly T[]): readonly T[] {
	if (value.length > FORMULA_LIMITS.maxListLen) {
		throw new FormulaError('list_limit', `Formula list exceeds ${FORMULA_LIMITS.maxListLen} entries`)
	}
	return value
}

function truthy(value: FormulaRuntimeValue | undefined): boolean {
	if (value === undefined || value === null || value === false) return false
	if (typeof value === 'number') return value !== 0 && Number.isFinite(value)
	if (typeof value === 'string') return value.length > 0
	if (Array.isArray(value)) return value.length > 0
	return true
}

function toNumber(value: FormulaRuntimeValue | undefined): number | null {
	if (value === undefined || value === null) return null
	if (typeof value === 'number') return Number.isFinite(value) ? value : null
	if (typeof value === 'boolean') return value ? 1 : 0
	if (typeof value === 'string' && value.trim() !== '') {
		const n = Number(value)
		return Number.isFinite(n) ? n : null
	}
	return null
}

function requireNumber(value: FormulaRuntimeValue | undefined, label: string): number {
	const n = toNumber(value)
	if (n === null) throw new FormulaError('type_error', `${label} must be numeric`)
	return n
}

function toText(value: FormulaRuntimeValue | undefined): string {
	if (value === undefined || value === null) return ''
	if (typeof value === 'string') return assertStringLen(value)
	if (typeof value === 'number' || typeof value === 'boolean') return String(value)
	if (isFormulaDate(value)) return value.iso
	if (Array.isArray(value)) return assertStringLen(value.map(toText).join(', '))
	return ''
}

function sameValue(a: FormulaRuntimeValue | undefined, b: FormulaRuntimeValue | undefined): boolean {
	if (a === undefined || a === null) return b === undefined || b === null
	if (b === undefined || b === null) return false
	if (isFormulaDate(a) && isFormulaDate(b)) return a.iso === b.iso
	if (Array.isArray(a) && Array.isArray(b)) {
		return a.length === b.length && a.every((item, idx) => sameValue(item, b[idx]))
	}
	return a === b
}

function parseDateInput(value: FormulaRuntimeValue | undefined): Date | null {
	if (value === undefined || value === null) return null
	if (isFormulaDate(value)) return new Date(value.iso)
	if (typeof value === 'string') {
		const ms = Date.parse(value.length === 10 ? `${value}T00:00:00.000Z` : value)
		return Number.isFinite(ms) ? new Date(ms) : null
	}
	return null
}

function requireDate(value: FormulaRuntimeValue | undefined, label: string): Date {
	const date = parseDateInput(value)
	if (!date) throw new FormulaError('invalid_date', `${label} must be a date or ISO date string`)
	return date
}

function dateValue(date: Date): FormulaDateValue {
	return { kind: 'date', iso: date.toISOString() }
}

function dateUnits(unitRaw: FormulaRuntimeValue | undefined): string {
	const unit = toText(unitRaw).toLowerCase().replace(/s$/, '')
	if (!['millisecond', 'second', 'minute', 'hour', 'day', 'week', 'month', 'year'].includes(unit)) {
		throw new FormulaError(
			'validation_error',
			`Unsupported date unit "${unitRaw === undefined ? '' : toText(unitRaw)}"`
		)
	}
	return unit
}

function addDate(date: Date, amount: number, unit: string): Date {
	const out = new Date(date.getTime())
	switch (unit) {
		case 'millisecond':
			out.setUTCMilliseconds(out.getUTCMilliseconds() + amount)
			break
		case 'second':
			out.setUTCSeconds(out.getUTCSeconds() + amount)
			break
		case 'minute':
			out.setUTCMinutes(out.getUTCMinutes() + amount)
			break
		case 'hour':
			out.setUTCHours(out.getUTCHours() + amount)
			break
		case 'day':
			out.setUTCDate(out.getUTCDate() + amount)
			break
		case 'week':
			out.setUTCDate(out.getUTCDate() + amount * 7)
			break
		case 'month':
			out.setUTCMonth(out.getUTCMonth() + amount)
			break
		case 'year':
			out.setUTCFullYear(out.getUTCFullYear() + amount)
			break
	}
	return out
}

function formatDateTokens(date: Date, format: string): string {
	const pad = (n: number, len = 2) => String(n).padStart(len, '0')
	const tokens: Record<string, string> = {
		YYYY: String(date.getUTCFullYear()),
		YY: String(date.getUTCFullYear()).slice(-2),
		MM: pad(date.getUTCMonth() + 1),
		M: String(date.getUTCMonth() + 1),
		DD: pad(date.getUTCDate()),
		D: String(date.getUTCDate()),
		HH: pad(date.getUTCHours()),
		H: String(date.getUTCHours()),
		mm: pad(date.getUTCMinutes()),
		m: String(date.getUTCMinutes()),
		ss: pad(date.getUTCSeconds()),
		s: String(date.getUTCSeconds())
	}
	// Longest-first replacement avoids MM being consumed by the M token.
	return assertStringLen(
		format.replace(/YYYY|YY|MM|M|DD|D|HH|H|mm|m|ss|s/g, (token) => tokens[token] ?? token)
	)
}

function compareValues(
	left: FormulaRuntimeValue | undefined,
	right: FormulaRuntimeValue | undefined
): number | null {
	if (left === undefined || left === null || right === undefined || right === null) return null
	const ld = parseDateInput(left)
	const rd = parseDateInput(right)
	if (ld && rd) return ld.getTime() - rd.getTime()
	const ln = toNumber(left)
	const rn = toNumber(right)
	if (ln !== null && rn !== null) return ln - rn
	const ls = toText(left)
	const rs = toText(right)
	return ls < rs ? -1 : ls > rs ? 1 : 0
}

function evalExpr(
	expr: FormulaExpr,
	ctx: FormulaEvalContext,
	vars: Readonly<Record<string, FormulaRuntimeValue>>,
	state: EvalState
): FormulaRuntimeValue {
	step(state)
	switch (expr.kind) {
		case 'literal':
			return expr.value
		case 'prop': {
			const value = ctx.prop(expr.name)
			if (value === undefined) throw new FormulaError('unknown_property', `Unknown property "${expr.name}"`)
			return value
		}
		case 'var': {
			if (Object.hasOwn(vars, expr.name)) return vars[expr.name] as FormulaRuntimeValue
			if (ctx.variables && Object.hasOwn(ctx.variables, expr.name))
				return ctx.variables[expr.name] as FormulaValue
			throw new FormulaError('unknown_variable', `Unknown variable "${expr.name}"`)
		}
		case 'lambda':
			return { kind: 'lambda', param: expr.param, body: expr.body }
		case 'unary': {
			if (expr.op === 'not') return !truthy(evalExpr(expr.arg, ctx, vars, state))
			const n = requireNumber(evalExpr(expr.arg, ctx, vars, state), 'Unary operand')
			return expr.op === '-' ? -n : n
		}
		case 'binary':
			return evalBinary(expr, ctx, vars, state)
		case 'call':
			return evalCall(expr, ctx, vars, state)
	}
}

function evalBinary(
	expr: Extract<FormulaExpr, { kind: 'binary' }>,
	ctx: FormulaEvalContext,
	vars: Readonly<Record<string, FormulaRuntimeValue>>,
	state: EvalState
): FormulaRuntimeValue {
	if (expr.op === 'and') {
		const left = evalExpr(expr.left, ctx, vars, state)
		return truthy(left) ? truthy(evalExpr(expr.right, ctx, vars, state)) : false
	}
	if (expr.op === 'or') {
		const left = evalExpr(expr.left, ctx, vars, state)
		return truthy(left) ? true : truthy(evalExpr(expr.right, ctx, vars, state))
	}
	const left = evalExpr(expr.left, ctx, vars, state)
	const right = evalExpr(expr.right, ctx, vars, state)
	if (expr.op === '==') return sameValue(left, right)
	if (expr.op === '!=') return !sameValue(left, right)
	if (['<', '<=', '>', '>='].includes(expr.op)) {
		const cmp = compareValues(left, right)
		if (cmp === null) return null
		if (expr.op === '<') return cmp < 0
		if (expr.op === '<=') return cmp <= 0
		if (expr.op === '>') return cmp > 0
		return cmp >= 0
	}

	// `+` concatenates when either side is textual; other arithmetic is numeric.
	if (expr.op === '+' && (typeof left === 'string' || typeof right === 'string')) {
		return assertStringLen(toText(left) + toText(right))
	}
	const ln = toNumber(left)
	const rn = toNumber(right)
	if (ln === null || rn === null) return null
	if (expr.op === '+') return ln + rn
	if (expr.op === '-') return ln - rn
	if (expr.op === '*') return ln * rn
	if (expr.op === '/') return rn === 0 ? null : ln / rn
	return rn === 0 ? null : ln % rn
}

function arity(args: readonly FormulaRuntimeValue[], min: number, max: number, name: string): void {
	if (args.length < min || args.length > max) {
		throw new FormulaError(
			'arity_error',
			`${name}() expects ${min === max ? min : `${min}–${max}`} arguments`
		)
	}
}

function listOf(value: FormulaRuntimeValue | undefined, name: string): readonly FormulaValue[] {
	if (!Array.isArray(value)) throw new FormulaError('type_error', `${name}() expects a list`)
	return assertList(value as readonly FormulaValue[])
}

function evalCall(
	expr: Extract<FormulaExpr, { kind: 'call' }>,
	ctx: FormulaEvalContext,
	vars: Readonly<Record<string, FormulaRuntimeValue>>,
	state: EvalState
): FormulaRuntimeValue {
	const name = expr.name
	// Lazy control-flow forms must not pre-evaluate unused branches.
	if (name === 'if') {
		if (expr.args.length !== 3) throw new FormulaError('arity_error', 'if() expects 3 arguments')
		return truthy(evalExpr(expr.args[0]!, ctx, vars, state))
			? evalExpr(expr.args[1]!, ctx, vars, state)
			: evalExpr(expr.args[2]!, ctx, vars, state)
	}
	if (name === 'ifs') {
		if (expr.args.length < 2 || expr.args.length % 2 !== 0) {
			throw new FormulaError('arity_error', 'ifs() expects condition/value pairs')
		}
		for (let i = 0; i < expr.args.length; i += 2) {
			if (truthy(evalExpr(expr.args[i]!, ctx, vars, state)))
				return evalExpr(expr.args[i + 1]!, ctx, vars, state)
		}
		return null
	}

	const args = expr.args.map((arg) => evalExpr(arg, ctx, vars, state))
	const textArg = (idx: number) => toText(args[idx])
	const numArg = (idx: number) => requireNumber(args[idx], `${name}() argument ${idx + 1}`)

	switch (name) {
		case 'round': {
			arity(args, 1, 2, name)
			const digits = args.length > 1 ? Math.trunc(numArg(1)) : 0
			const scale = 10 ** Math.max(-12, Math.min(12, digits))
			return Math.round(numArg(0) * scale) / scale
		}
		case 'ceil':
			arity(args, 1, 1, name)
			return Math.ceil(numArg(0))
		case 'floor':
			arity(args, 1, 1, name)
			return Math.floor(numArg(0))
		case 'abs':
			arity(args, 1, 1, name)
			return Math.abs(numArg(0))
		case 'min':
		case 'max': {
			arity(args, 1, 100, name)
			const nums = args.map((_, i) => numArg(i))
			return name === 'min' ? Math.min(...nums) : Math.max(...nums)
		}
		case 'concat':
			arity(args, 1, 100, name)
			return assertStringLen(args.map(toText).join(''))
		case 'contains': {
			arity(args, 2, 2, name)
			if (Array.isArray(args[0]))
				return (args[0] as readonly FormulaValue[]).some((v) => sameValue(v, args[1]))
			return textArg(0).toLowerCase().includes(textArg(1).toLowerCase())
		}
		case 'replace':
			arity(args, 3, 3, name)
			return assertStringLen(textArg(0).split(textArg(1)).join(textArg(2)))
		case 'slice': {
			arity(args, 2, 3, name)
			const start = Math.trunc(numArg(1))
			const end = args.length > 2 ? Math.trunc(numArg(2)) : undefined
			const input = args[0]
			if (Array.isArray(input)) return (input as readonly FormulaValue[]).slice(start, end)
			return assertStringLen(textArg(0).slice(start, end))
		}
		case 'split': {
			arity(args, 2, 2, name)
			return assertList(textArg(0).split(textArg(1))) as readonly FormulaValue[]
		}
		case 'length':
		case 'len': {
			arity(args, 1, 1, name)
			const input = args[0]
			return Array.isArray(input) ? input.length : textArg(0).length
		}
		case 'lower':
			arity(args, 1, 1, name)
			return textArg(0).toLowerCase()
		case 'upper':
			arity(args, 1, 1, name)
			return textArg(0).toUpperCase()
		case 'dateAdd': {
			arity(args, 3, 3, name)
			const unit = dateUnits(args[2])
			return dateValue(addDate(requireDate(args[0], 'dateAdd() first argument'), Math.trunc(numArg(1)), unit))
		}
		case 'dateBetween': {
			arity(args, 3, 3, name)
			const first = requireDate(args[0], 'dateBetween() first argument')
			const second = requireDate(args[1], 'dateBetween() second argument')
			const unit = dateUnits(args[2])
			const diff = first.getTime() - second.getTime()
			if (unit === 'month')
				return (
					(first.getUTCFullYear() - second.getUTCFullYear()) * 12 + first.getUTCMonth() - second.getUTCMonth()
				)
			if (unit === 'year') return first.getUTCFullYear() - second.getUTCFullYear()
			const divisors: Record<string, number> = {
				millisecond: 1,
				second: 1000,
				minute: 60_000,
				hour: 3_600_000,
				day: 86_400_000,
				week: 604_800_000
			}
			return Math.trunc(diff / (divisors[unit] ?? 1))
		}
		case 'formatDate':
			arity(args, 2, 2, name)
			return formatDateTokens(requireDate(args[0], 'formatDate() first argument'), textArg(1))
		case 'now':
			arity(args, 0, 0, name)
			return dateValue(ctx.now)
		case 'today': {
			arity(args, 0, 0, name)
			const d = new Date(ctx.now.getTime())
			d.setUTCHours(0, 0, 0, 0)
			return dateValue(d)
		}
		case 'and':
			arity(args, 1, 100, name)
			return args.every(truthy)
		case 'or':
			arity(args, 1, 100, name)
			return args.some(truthy)
		case 'not':
			arity(args, 1, 1, name)
			return !truthy(args[0])
		case 'empty': {
			arity(args, 1, 1, name)
			return !truthy(args[0])
		}
		case 'map':
		case 'filter': {
			if (expr.args.length !== 2)
				throw new FormulaError('arity_error', `${name}() expects a list and a lambda`)
			const list = listOf(args[0], name)
			const lambdaExpr = expr.args[1]
			if (lambdaExpr?.kind !== 'lambda')
				throw new FormulaError('type_error', `${name}() expects an x -> expression lambda`)
			const out: FormulaValue[] = []
			for (const item of list) {
				step(state)
				const scoped = { ...vars, [lambdaExpr.param]: item }
				const value = evalExpr(lambdaExpr.body, ctx, scoped, state)
				if (isFormulaLambda(value)) throw new FormulaError('type_error', 'Lambdas cannot be formula output')
				if (name === 'map') out.push(value as FormulaValue)
				else if (truthy(value)) out.push(item)
				if (out.length > FORMULA_LIMITS.maxListLen) {
					throw new FormulaError('list_limit', `Formula list exceeds ${FORMULA_LIMITS.maxListLen} entries`)
				}
			}
			return out
		}
		case 'sum': {
			arity(args, 1, 1, name)
			let total = 0
			for (const item of listOf(args[0], name)) {
				step(state)
				total += toNumber(item) ?? 0
			}
			return total
		}
		case 'join':
			arity(args, 1, 2, name)
			return assertStringLen(
				listOf(args[0], name)
					.map(toText)
					.join(args.length > 1 ? textArg(1) : ', ')
			)
		default:
			throw new FormulaError('unknown_function', `Unknown formula function "${name}()"`)
	}
}

/** Evaluate an already-parsed formula. Output lambdas are impossible by construction. */
export function evaluateFormulaAst(expr: FormulaExpr, ctx: FormulaEvalContext): FormulaValue {
	const state: EvalState = { steps: 0, maxSteps: ctx.maxEvalSteps ?? FORMULA_LIMITS.maxEvalSteps }
	const value = evalExpr(expr, ctx, {}, state)
	if (isFormulaLambda(value))
		throw new FormulaError('type_error', 'A lambda cannot be the top-level formula result')
	return value as FormulaValue
}

export function evaluateFormula(source: string, ctx: FormulaEvalContext): FormulaValue {
	return evaluateFormulaAst(parseFormula(source), ctx)
}

export interface FormulaValidationResult {
	readonly ok: boolean
	readonly ast?: FormulaExpr | undefined
	readonly dependencies: readonly string[]
	readonly error?:
		| { readonly code: FormulaErrorCode; readonly message: string; readonly position?: number | undefined }
		| undefined
}

/** Validate source once for editors/server writes — never throws for malformed user input. */
export function validateFormulaSource(source: string): FormulaValidationResult {
	try {
		const ast = parseFormula(source)
		return { ok: true, ast, dependencies: extractFormulaPropDependencies(ast) }
	} catch (err) {
		if (err instanceof FormulaError) {
			return {
				ok: false,
				dependencies: [],
				error: {
					code: err.code,
					message: err.message,
					...(err.position !== undefined ? { position: err.position } : {})
				}
			}
		}
		return {
			ok: false,
			dependencies: [],
			error: { code: 'validation_error', message: 'Invalid formula' }
		}
	}
}

/**
 * Detect cycles between formula properties by property NAME. Non-formula
 * properties are valid leaf dependencies; missing names are reported by the
 * evaluator/validator at write time rather than treated as cycles.
 */
export function detectFormulaDependencyCycle(
	properties: readonly { readonly name: string; readonly formulaSource?: string | undefined }[]
): string[] | null {
	const formulaByName = new Map<string, readonly string[]>()
	for (const prop of properties) {
		if (!prop.formulaSource) continue
		const parsed = validateFormulaSource(prop.formulaSource)
		if (!parsed.ok) continue
		formulaByName.set(prop.name, parsed.dependencies)
	}
	const visiting = new Set<string>()
	const visited = new Set<string>()
	const path: string[] = []
	const visit = (name: string): string[] | null => {
		if (visited.has(name)) return null
		if (visiting.has(name)) {
			const idx = path.indexOf(name)
			return [...path.slice(Math.max(0, idx)), name]
		}
		visiting.add(name)
		path.push(name)
		for (const dep of formulaByName.get(name) ?? []) {
			if (!formulaByName.has(dep)) continue
			const cycle = visit(dep)
			if (cycle) return cycle
		}
		path.pop()
		visiting.delete(name)
		visited.add(name)
		return null
	}
	for (const name of formulaByName.keys()) {
		const cycle = visit(name)
		if (cycle) return cycle
	}
	return null
}
