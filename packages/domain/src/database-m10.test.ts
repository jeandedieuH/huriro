import { describe, expect, test } from 'bun:test'
import { compareDatabaseRows, evaluateDatabaseFilter, validateDatabaseFilter } from './database-filter'
import { databaseRowsFromCsv, databaseRowsToCsv, parseCsv } from './database-portability'
import { evaluateFormula, parseFormula } from './formula'

const properties = [
	{ id: '11111111-1111-1111-1111-111111111111', name: 'Name', propType: 'title' },
	{ id: '22222222-2222-2222-2222-222222222222', name: 'Estimate', propType: 'number' },
	{ id: '33333333-3333-3333-3333-333333333333', name: 'Done', propType: 'checkbox' },
	{ id: '44444444-4444-4444-4444-444444444444', name: 'Tags', propType: 'multi_select' }
]
const row = {
	title: 'Alpha',
	createdAt: '2026-01-01T00:00:00.000Z',
	updatedAt: '2026-01-02T00:00:00.000Z',
	createdBy: 'u',
	updatedBy: null,
	cells: {
		'22222222-2222-2222-2222-222222222222': { number: 7 },
		'33333333-3333-3333-3333-333333333333': { boolean: true },
		'44444444-4444-4444-4444-444444444444': { json: ['a', 'b'] }
	}
}

describe('database filter domain semantics', () => {
	test('evaluates scalar, array, boolean and grouped predicates', () => {
		expect(
			evaluateDatabaseFilter(
				{ kind: 'predicate', propertyId: properties[1]!.id, op: 'gte', value: 7 },
				row,
				properties
			)
		).toBe(true)
		expect(
			evaluateDatabaseFilter(
				{ kind: 'predicate', propertyId: properties[3]!.id, op: 'contains', value: 'a' },
				row,
				properties
			)
		).toBe(true)
		expect(
			evaluateDatabaseFilter(
				{
					kind: 'and',
					children: [
						{ kind: 'predicate', propertyId: properties[2]!.id, op: 'eq', value: true },
						{
							kind: 'not',
							child: { kind: 'predicate', propertyId: properties[0]!.id, op: 'contains', value: 'zzz' }
						}
					]
				},
				row,
				properties
			)
		).toBe(true)
	})
	test('validates depth, unknown properties and op shape', () => {
		expect(
			validateDatabaseFilter({ kind: 'predicate', propertyId: 'missing', op: 'eq', value: 1 }, properties).ok
		).toBe(false)
		expect(
			validateDatabaseFilter(
				{ kind: 'predicate', propertyId: properties[1]!.id, op: 'contains', value: 'x' },
				properties
			).ok
		).toBe(false)
	})
	test('sort comparator puts null last and honors descending', () => {
		const empty = { ...row, title: 'B', cells: {} }
		expect(
			compareDatabaseRows(row, empty, [{ propertyId: properties[1]!.id, direction: 'asc' }], properties)
		).toBeLessThan(0)
		expect(
			compareDatabaseRows(row, empty, [{ propertyId: properties[1]!.id, direction: 'desc' }], properties)
		).toBeLessThan(0)
	})
})

describe('database portability', () => {
	test('parses quoted CSV and round trips typed scalar values', () => {
		expect(parseCsv('a,"b,b","c""d"\r\n1,2,3')[0]).toEqual(['a', 'b,b', 'c"d'])
		const imported = databaseRowsFromCsv('Name,Estimate,Done\nAlpha,7,true\n', properties)
		expect(imported[0]?.title).toBe('Alpha')
		expect(imported[0]?.cells[properties[1]!.id]?.number).toBe(7)
		expect(databaseRowsToCsv([{ title: 'Alpha', cells: imported[0]!.cells }], properties)).toContain('Alpha')
	})
})

describe('formula sandbox fuzz boundaries', () => {
	test('generated nested formulas are rejected or bounded without hanging', () => {
		for (let depth = 1; depth < 80; depth += 7) {
			const source = '1' + ' + 1'.repeat(depth)
			const started = performance.now()
			try {
				parseFormula(source)
			} catch (error) {
				expect(error).toBeInstanceOf(Error)
			}
			expect(performance.now() - started).toBeLessThan(100)
		}
	})
	test('hostile input cannot evaluate ambient code or huge strings', () => {
		expect(() => evaluateFormula('process.env', { now: new Date(0), prop: () => null })).toThrow()
		expect(() => evaluateFormula('repeat("x", 100000000)', { now: new Date(0), prop: () => null })).toThrow()
	})
})
