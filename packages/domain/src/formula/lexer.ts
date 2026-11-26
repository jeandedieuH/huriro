import { FORMULA_LIMITS, FormulaError } from './types'

export type FormulaToken =
	| { readonly kind: 'number'; readonly value: number; readonly pos: number }
	| { readonly kind: 'string'; readonly value: string; readonly pos: number }
	| { readonly kind: 'ident'; readonly value: string; readonly pos: number }
	| { readonly kind: 'bool'; readonly value: boolean; readonly pos: number }
	| { readonly kind: 'null'; readonly pos: number }
	| { readonly kind: 'op'; readonly value: string; readonly pos: number }
	| { readonly kind: 'eof'; readonly pos: number }

const OPS = new Set([
	'+',
	'-',
	'*',
	'/',
	'%',
	'==',
	'!=',
	'<=',
	'>=',
	'<',
	'>',
	'(',
	')',
	',',
	'->',
	'=>',
	'&&',
	'||',
	'!'
])

function isIdentStart(ch: string): boolean {
	return /[A-Za-z_]/.test(ch)
}

function isIdentPart(ch: string): boolean {
	return /[A-Za-z0-9_]/.test(ch)
}

/** Linear-time hand-written lexer — no backtracking regular expressions over user input. */
export function lexFormula(source: string): FormulaToken[] {
	if (source.length > FORMULA_LIMITS.maxSourceLen) {
		throw new FormulaError(
			'validation_error',
			`Formula source exceeds ${FORMULA_LIMITS.maxSourceLen} characters`,
			0
		)
	}
	const tokens: FormulaToken[] = []
	let i = 0
	while (i < source.length) {
		const ch = source[i] ?? ''
		if (ch === ' ' || ch === '\t' || ch === '\n' || ch === '\r') {
			i += 1
			continue
		}

		if (/[0-9]/.test(ch) || (ch === '.' && /[0-9]/.test(source[i + 1] ?? ''))) {
			const start = i
			let seenDot = false
			while (i < source.length) {
				const c = source[i] ?? ''
				if (/[0-9]/.test(c)) {
					i += 1
					continue
				}
				if (c === '.' && !seenDot) {
					seenDot = true
					i += 1
					continue
				}
				break
			}
			const raw = source.slice(start, i)
			const value = Number(raw)
			if (!Number.isFinite(value)) throw new FormulaError('parse_error', `Invalid number "${raw}"`, start)
			tokens.push({ kind: 'number', value, pos: start })
			continue
		}

		if (ch === '"' || ch === "'") {
			const quote = ch
			const start = i
			i += 1
			let out = ''
			let closed = false
			while (i < source.length) {
				const c = source[i] ?? ''
				if (c === quote) {
					closed = true
					i += 1
					break
				}
				if (c === '\\') {
					const next = source[i + 1]
					if (next === undefined) break
					const escaped =
						next === 'n'
							? '\n'
							: next === 'r'
								? '\r'
								: next === 't'
									? '\t'
									: next === '\\'
										? '\\'
										: next === quote
											? quote
											: null
					if (escaped === null) throw new FormulaError('parse_error', `Unsupported escape \\${next}`, i)
					out += escaped
					i += 2
					continue
				}
				out += c
				if (out.length > FORMULA_LIMITS.maxStringLen) {
					throw new FormulaError('string_limit', 'Formula string literal exceeds maximum length', start)
				}
				i += 1
			}
			if (!closed) throw new FormulaError('parse_error', 'Unterminated string literal', start)
			tokens.push({ kind: 'string', value: out, pos: start })
			continue
		}

		if (isIdentStart(ch)) {
			const start = i
			i += 1
			while (i < source.length && isIdentPart(source[i] ?? '')) i += 1
			const value = source.slice(start, i)
			if (value === 'true' || value === 'false')
				tokens.push({ kind: 'bool', value: value === 'true', pos: start })
			else if (value === 'null') tokens.push({ kind: 'null', pos: start })
			else tokens.push({ kind: 'ident', value, pos: start })
			continue
		}

		const two = source.slice(i, i + 2)
		if (OPS.has(two)) {
			tokens.push({ kind: 'op', value: two, pos: i })
			i += 2
			continue
		}
		if (OPS.has(ch)) {
			// Bare '=' is intentionally not assignment; equality is '=='.
			tokens.push({ kind: 'op', value: ch, pos: i })
			i += 1
			continue
		}
		if (ch === '=') throw new FormulaError('parse_error', 'Use == for equality', i)
		throw new FormulaError('parse_error', `Unexpected character "${ch}"`, i)
	}
	tokens.push({ kind: 'eof', pos: source.length })
	return tokens
}
