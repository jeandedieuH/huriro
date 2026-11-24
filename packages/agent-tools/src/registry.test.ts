import { describe, expect, test } from 'bun:test'
import { isAgentExecutable } from '@huriro/domain'
import { Value } from 'typebox/value'
import { getTool, TOOLS, toolManifest } from './index'

describe('tool registry invariants (§13.1a, §13.5)', () => {
	test('tool names are unique', () => {
		expect(TOOLS.size).toBeGreaterThan(0)
		// Map construction would collapse dupes — re-derive from manifest.
		const names = toolManifest().map((t) => t.name)
		expect(new Set(names).size).toBe(names.length)
	})

	test('every tool has a scope and tier', () => {
		for (const t of TOOLS.values()) {
			expect(t.scope).toBeTruthy()
			expect(t.tier).toBeTruthy()
		}
	})

	test('no R3 tool is registered or executable', () => {
		for (const t of TOOLS.values()) {
			expect(t.tier).not.toBe('R3')
			expect(isAgentExecutable(t.tier)).toBe(true)
		}
	})

	test('every write tool is idempotent', () => {
		for (const t of TOOLS.values()) {
			if (t.kind === 'write') expect(t.idempotent).toBe(true)
		}
	})

	test('descriptions are non-empty', () => {
		for (const t of TOOLS.values()) {
			expect(t.description.trim().length).toBeGreaterThan(0)
			expect(t.title.trim().length).toBeGreaterThan(0)
		}
	})

	test('all schemas compile and inputs are closed objects', () => {
		for (const t of TOOLS.values()) {
			// Compile runs lazily inside Check; any invalid schema throws here.
			expect(() => Value.Check(t.input, {})).not.toThrow()
			expect(() => Value.Check(t.output, null)).not.toThrow()
			expect(
				(t.input as unknown as { additionalProperties?: boolean }).additionalProperties,
				`${t.name} input must be closed`
			).toBe(false)
		}
	})

	test('input schemas reject unknown properties', () => {
		for (const t of TOOLS.values()) {
			expect(Value.Check(t.input, { __injected__: true })).toBe(false)
		}
	})

	test('bulk_update escalates above 20 issues', () => {
		const tool = getTool('tasks.bulk_update')
		expect(tool?.tierForInput?.({ issues: Array.from({ length: 20 }, () => 'x') })).toBe('R1')
		expect(tool?.tierForInput?.({ issues: Array.from({ length: 21 }, () => 'x') })).toBe('R2')
		expect(tool?.tierForInput?.({ issues: Array.from({ length: 200 }, () => 'x') })).toBe('R2')
	})

	test('bulk_update input caps at 200', () => {
		const tool = getTool('tasks.bulk_update')
		expect(
			Value.Check(tool!.input, {
				issues: Array.from({ length: 201 }, (_, i) => `ISSUE-${i}`)
			})
		).toBe(false)
	})

	test('expected tools are registered (mail.* ships in M5)', () => {
		const names = [...TOOLS.keys()]
		for (const expected of [
			'workspace.describe',
			'tasks.search',
			'tasks.get',
			'tasks.my_queue',
			'tasks.create',
			'tasks.update',
			'tasks.comment',
			'tasks.report_status',
			'tasks.bulk_update',
			'docs.search',
			'docs.get',
			'docs.append',
			'docs.create',
			'chat.read_thread',
			'search.unified',
			'approvals.status'
		]) {
			expect(names).toContain(expected)
		}
		expect(names.some((n) => n.startsWith('mail.'))).toBe(false)
	})
})
