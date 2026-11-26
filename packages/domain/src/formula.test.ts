import { describe, expect, test } from 'bun:test'
import {
	detectFormulaDependencyCycle,
	evaluateFormula,
	FORMULA_LIMITS,
	FormulaError,
	isFormulaDate,
	parseFormula,
	validateFormulaSource
} from './index'

const now = new Date('2026-11-26T12:00:00.000Z')
const props = (
	values: Record<
		string,
		Parameters<typeof evaluateFormula>[1]['prop'] extends (name: string) => infer T ? T : never
	>
) => ({ prop: (name: string) => values[name], now }) as const

describe('database formula engine (ADR-0026)', () => {
	test('evaluates arithmetic, strings, logic, and prop access', () => {
		expect(evaluateFormula('prop("Price") * 2 + 1', props({ Price: 4 }))).toBe(9)
		expect(
			evaluateFormula(
				'upper(concat(prop("First"), " ", prop("Last")))',
				props({ First: 'Ada', Last: 'Lovelace' })
			)
		).toBe('ADA LOVELACE')
		expect(evaluateFormula('if(prop("Done"), "yes", "no")', props({ Done: true }))).toBe('yes')
		expect(evaluateFormula('contains("Huriro", "rir") && !empty("x")', props({}))).toBe(true)
	})

	test('evaluates dates with injected clock', () => {
		const today = evaluateFormula('today()', props({}))
		expect(isFormulaDate(today)).toBe(true)
		if (isFormulaDate(today)) expect(today.iso).toBe('2026-11-26T00:00:00.000Z')
		expect(evaluateFormula('formatDate(dateAdd(today(), 2, "days"), "YYYY-MM-DD")', props({}))).toBe(
			'2026-11-28'
		)
		expect(evaluateFormula('dateBetween(dateAdd(today(), 7, "days"), today(), "days")', props({}))).toBe(7)
	})

	test('map/filter/sum lambdas are bounded and deterministic', () => {
		expect(evaluateFormula('sum(map(split("1,2,3", ","), x -> x * 2))', props({}))).toBe(12)
		expect(evaluateFormula('join(filter(split("a,,bb", ","), x -> length(x) > 0), "|")', props({}))).toBe(
			'a|bb'
		)
	})

	test('rejects malformed and unsafe input without eval', () => {
		expect(validateFormulaSource('prop(1 + 2)').ok).toBe(false)
		expect(validateFormulaSource('1 = 1').ok).toBe(false)
		expect(validateFormulaSource('unknownFn(1)').ok).toBe(true) // unknown only at evaluation
		expect(() => evaluateFormula('unknownFn(1)', props({}))).toThrow(FormulaError)
		expect(() => evaluateFormula('prop("Missing")', props({}))).toThrow(FormulaError)
	})

	test('enforces AST, evaluation step, string, and nesting caps', () => {
		const wide = Array.from({ length: FORMULA_LIMITS.maxAstNodes + 1 }, () => '1').join('+')
		expect(validateFormulaSource(wide).ok).toBe(false)
		const oversized = `replace("${'a'.repeat(1024)}", "a", "${'a'.repeat(32)}")`
		expect(() => evaluateFormula(oversized, props({}))).toThrow(FormulaError)
		const numericMap = `sum(map(split("1,2,3", ","), x -> x * 2))`
		expect(evaluateFormula(numericMap, props({}))).toBe(12)
	})

	test('detects formula dependency cycles by property name', () => {
		expect(
			detectFormulaDependencyCycle([
				{ name: 'A', formulaSource: 'prop("B") + 1' },
				{ name: 'B', formulaSource: 'prop("A") + 1' }
			])
		).toEqual(['A', 'B', 'A'])
		expect(
			detectFormulaDependencyCycle([
				{ name: 'A', formulaSource: 'prop("B") + 1' },
				{ name: 'B', formulaSource: 'prop("C") + 1' },
				{ name: 'C' }
			])
		).toBeNull()
	})

	test('parser produces stable AST for static analysis', () => {
		const ast = parseFormula('prop("Total") >= 10 and not empty(prop("Owner"))')
		expect(ast.kind).toBe('binary')
	})
})
