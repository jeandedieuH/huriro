import { type FormulaToken, lexFormula } from './lexer'
import { FORMULA_LIMITS, FormulaError, type FormulaExpr } from './types'

export function countFormulaAstNodes(expr: FormulaExpr): number {
	switch (expr.kind) {
		case 'literal':
		case 'prop':
		case 'var':
			return 1
		case 'call':
			return 1 + expr.args.reduce((sum, arg) => sum + countFormulaAstNodes(arg), 0)
		case 'lambda':
			return 1 + countFormulaAstNodes(expr.body)
		case 'unary':
			return 1 + countFormulaAstNodes(expr.arg)
		case 'binary':
			return 1 + countFormulaAstNodes(expr.left) + countFormulaAstNodes(expr.right)
	}
}

function formulaDepth(expr: FormulaExpr): number {
	switch (expr.kind) {
		case 'literal':
		case 'prop':
		case 'var':
			return 1
		case 'call':
			return 1 + Math.max(0, ...expr.args.map(formulaDepth))
		case 'lambda':
			return 1 + formulaDepth(expr.body)
		case 'unary':
			return 1 + formulaDepth(expr.arg)
		case 'binary':
			return 1 + Math.max(formulaDepth(expr.left), formulaDepth(expr.right))
	}
}

class Parser {
	private pos = 0
	private readonly tokens: readonly FormulaToken[]

	constructor(tokens: readonly FormulaToken[]) {
		this.tokens = tokens
	}

	parse(): FormulaExpr {
		const expr = this.parseExpression()
		this.expectEof()
		const nodes = countFormulaAstNodes(expr)
		if (nodes > FORMULA_LIMITS.maxAstNodes) {
			throw new FormulaError('ast_node_limit', `Formula exceeds ${FORMULA_LIMITS.maxAstNodes} AST nodes`)
		}
		if (formulaDepth(expr) > FORMULA_LIMITS.maxDepth) {
			throw new FormulaError('validation_error', `Formula exceeds ${FORMULA_LIMITS.maxDepth} nesting levels`)
		}
		return expr
	}

	private current(): FormulaToken {
		return this.tokens[this.pos] ?? { kind: 'eof', pos: -1 }
	}

	private peek(offset = 1): FormulaToken {
		return this.tokens[this.pos + offset] ?? { kind: 'eof', pos: -1 }
	}

	private consume(): FormulaToken {
		const token = this.current()
		this.pos += 1
		return token
	}

	private matchOp(value: string): boolean {
		const token = this.current()
		if (token.kind === 'op' && token.value === value) {
			this.pos += 1
			return true
		}
		return false
	}

	private expectOp(value: string): void {
		const token = this.current()
		if (!this.matchOp(value)) {
			throw new FormulaError('parse_error', `Expected "${value}"`, token.pos)
		}
	}

	private expectEof(): void {
		const token = this.current()
		if (token.kind !== 'eof') throw new FormulaError('parse_error', 'Unexpected trailing input', token.pos)
	}

	private matchIdent(value: string): boolean {
		const token = this.current()
		if (token.kind === 'ident' && token.value === value) {
			this.pos += 1
			return true
		}
		return false
	}

	private parseExpression(): FormulaExpr {
		// Lambda form used by map/filter: `x -> x * 2` (or `x => x * 2`).
		const token = this.current()
		const next = this.peek()
		if (token.kind === 'ident' && next.kind === 'op' && (next.value === '->' || next.value === '=>')) {
			const param = token.value
			this.consume()
			this.consume()
			return { kind: 'lambda', param, body: this.parseExpression() }
		}
		return this.parseOr()
	}

	private parseOr(): FormulaExpr {
		let left = this.parseAnd()
		while (this.matchIdent('or') || this.matchOp('||')) {
			left = { kind: 'binary', op: 'or', left, right: this.parseAnd() }
		}
		return left
	}

	private parseAnd(): FormulaExpr {
		let left = this.parseEquality()
		while (this.matchIdent('and') || this.matchOp('&&')) {
			left = { kind: 'binary', op: 'and', left, right: this.parseEquality() }
		}
		return left
	}

	private parseEquality(): FormulaExpr {
		let left = this.parseComparison()
		for (;;) {
			if (this.matchOp('==')) left = { kind: 'binary', op: '==', left, right: this.parseComparison() }
			else if (this.matchOp('!=')) left = { kind: 'binary', op: '!=', left, right: this.parseComparison() }
			else return left
		}
	}

	private parseComparison(): FormulaExpr {
		let left = this.parseAdditive()
		for (;;) {
			if (this.matchOp('<=')) left = { kind: 'binary', op: '<=', left, right: this.parseAdditive() }
			else if (this.matchOp('>=')) left = { kind: 'binary', op: '>=', left, right: this.parseAdditive() }
			else if (this.matchOp('<')) left = { kind: 'binary', op: '<', left, right: this.parseAdditive() }
			else if (this.matchOp('>')) left = { kind: 'binary', op: '>', left, right: this.parseAdditive() }
			else return left
		}
	}

	private parseAdditive(): FormulaExpr {
		let left = this.parseMultiplicative()
		for (;;) {
			if (this.matchOp('+')) left = { kind: 'binary', op: '+', left, right: this.parseMultiplicative() }
			else if (this.matchOp('-')) left = { kind: 'binary', op: '-', left, right: this.parseMultiplicative() }
			else return left
		}
	}

	private parseMultiplicative(): FormulaExpr {
		let left = this.parseUnary()
		for (;;) {
			if (this.matchOp('*')) left = { kind: 'binary', op: '*', left, right: this.parseUnary() }
			else if (this.matchOp('/')) left = { kind: 'binary', op: '/', left, right: this.parseUnary() }
			else if (this.matchOp('%')) left = { kind: 'binary', op: '%', left, right: this.parseUnary() }
			else return left
		}
	}

	private parseUnary(): FormulaExpr {
		if (this.matchOp('-')) return { kind: 'unary', op: '-', arg: this.parseUnary() }
		if (this.matchOp('+')) return { kind: 'unary', op: '+', arg: this.parseUnary() }
		if (this.matchIdent('not') || this.matchOp('!'))
			return { kind: 'unary', op: 'not', arg: this.parseUnary() }
		return this.parsePrimary()
	}

	private parsePrimary(): FormulaExpr {
		const token = this.consume()
		if (token.kind === 'number') return { kind: 'literal', value: token.value }
		if (token.kind === 'string') return { kind: 'literal', value: token.value }
		if (token.kind === 'bool') return { kind: 'literal', value: token.value }
		if (token.kind === 'null') return { kind: 'literal', value: null }
		if (token.kind === 'op' && token.value === '(') {
			const inner = this.parseExpression()
			this.expectOp(')')
			return inner
		}
		if (token.kind === 'ident') {
			if (this.matchOp('(')) {
				const args: FormulaExpr[] = []
				if (!this.matchOp(')')) {
					for (;;) {
						args.push(this.parseExpression())
						if (this.matchOp(')')) break
						this.expectOp(',')
					}
				}
				if (token.value === 'prop') {
					if (args.length !== 1) {
						throw new FormulaError('arity_error', 'prop() expects exactly one property name', token.pos)
					}
					const [nameExpr] = args
					if (nameExpr?.kind !== 'literal' || typeof nameExpr.value !== 'string') {
						throw new FormulaError(
							'validation_error',
							'prop() requires a string literal property name',
							token.pos
						)
					}
					return { kind: 'prop', name: nameExpr.value }
				}
				return { kind: 'call', name: token.value, args }
			}
			return { kind: 'var', name: token.value }
		}
		throw new FormulaError('parse_error', 'Expected a value, property, or function call', token.pos)
	}
}

export function parseFormula(source: string): FormulaExpr {
	return new Parser(lexFormula(source)).parse()
}

/** Static dependency extraction used by schema cycle detection and editors. */
export function extractFormulaPropDependencies(expr: FormulaExpr): string[] {
	const out = new Set<string>()
	const visit = (node: FormulaExpr): void => {
		switch (node.kind) {
			case 'prop':
				out.add(node.name)
				return
			case 'call':
				for (const arg of node.args) visit(arg)
				return
			case 'lambda':
				visit(node.body)
				return
			case 'unary':
				visit(node.arg)
				return
			case 'binary':
				visit(node.left)
				visit(node.right)
				return
			default:
				return
		}
	}
	visit(expr)
	return [...out].sort()
}
