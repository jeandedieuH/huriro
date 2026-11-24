/**
 * Pure unit tests for dispatcher policy math (§13.5) + rate limiting (§13.7).
 */
import { describe, expect, test } from 'bun:test'
import type { ToolSpec } from '@huriro/agent-tools'
import { getTool } from '@huriro/agent-tools'
import { HttpError } from '../../api/error'
import {
	AgentRateLimiter,
	assertRaiseOnlyTierOverrides,
	assertToolScope,
	DEFAULT_AGENT_RATE_LIMITS,
	toolTierForCall
} from './policy'

const base: Parameters<typeof toolTierForCall>[2] = {
	scopeCeiling: [],
	tierOverrides: {},
	requireApprovalAllWrites: false
}

function tool(name: string): ToolSpec {
	const t = getTool(name)
	if (!t) throw new Error(`tool ${name} missing`)
	return t
}

describe('toolTierForCall — raise-only tier math', () => {
	test('base tier passes through with no overrides', () => {
		const { effective } = toolTierForCall(tool('tasks.update'), {}, base)
		expect(effective).toBe('R1')
	})

	test('workspace override raises but never lowers', () => {
		const raised = toolTierForCall(
			tool('tasks.update'),
			{},
			{
				...base,
				tierOverrides: { 'tasks.update': 'R2' }
			}
		)
		expect(raised.effective).toBe('R2')
		const lowerAttempt = toolTierForCall(
			tool('tasks.bulk_update'),
			{ issues: [] },
			{
				...base,
				tierOverrides: { 'tasks.bulk_update': 'R0' }
			}
		)
		// raise-only: a lower override is ignored at call time (rejected at patch time)
		expect(lowerAttempt.effective).toBe('R1')
	})

	test('require_approval_all_writes raises any write to R2, leaves reads', () => {
		const p = { ...base, requireApprovalAllWrites: true }
		expect(toolTierForCall(tool('tasks.update'), {}, p).effective).toBe('R2')
		expect(toolTierForCall(tool('tasks.search'), {}, p).effective).toBe('R0')
	})

	test('bulk threshold: <=20 issues stays R1, 21 becomes R2', () => {
		const t = tool('tasks.bulk_update')
		const small = { issues: Array.from({ length: 20 }, (_, i) => `i${i}`) }
		const large = { issues: Array.from({ length: 21 }, (_, i) => `i${i}`) }
		expect(toolTierForCall(t, small, base).effective).toBe('R1')
		expect(toolTierForCall(t, large, base).effective).toBe('R2')
	})

	test('input schemas reject >200 bulk issues and unknown properties', async () => {
		const { Value } = await import('typebox/value')
		const t = tool('tasks.bulk_update')
		expect(Value.Check(t.input, { issues: Array.from({ length: 201 }, (_, i) => `i${i}`) })).toBe(false)
		expect(Value.Check(t.input, { issues: ['x'], evil: true })).toBe(false)
	})

	test('R3 is never executable (registry refuses to register it too)', () => {
		for (const t of ['tasks.update', 'docs.create', 'tasks.bulk_update']) {
			expect(tool(t).tier).not.toBe('R3')
		}
	})
})

describe('assertToolScope', () => {
	test("'any' scope passes; required scope must be in token AND ceiling", () => {
		assertToolScope(tool('workspace.describe'), [], [])
		expect(() => assertToolScope(tool('tasks.search'), ['docs.read'], ['docs.read'])).toThrow(HttpError)
		expect(() => assertToolScope(tool('tasks.search'), ['tasks.read'], ['docs.read'])).toThrow(HttpError)
		assertToolScope(tool('tasks.search'), ['tasks.read'], ['tasks.read'])
	})

	test('insufficient_scope carries the RFC 6750 challenge', () => {
		try {
			assertToolScope(tool('tasks.create'), ['tasks.read'], ['tasks.read'])
			expect.unreachable()
		} catch (e) {
			const err = e as HttpError
			expect(err.status).toBe(403)
			expect(err.code).toBe('insufficient_scope')
			expect(err.headers?.['WWW-Authenticate']).toContain('insufficient_scope')
		}
	})
})

describe('assertRaiseOnlyTierOverrides', () => {
	test('raising passes, lowering and unknown tools fail', () => {
		const base2 = (n: string) => getTool(n)?.tier
		expect(() => assertRaiseOnlyTierOverrides({ 'tasks.update': 'R2' }, base2)).not.toThrow()
		expect(() => assertRaiseOnlyTierOverrides({ 'tasks.bulk_update': 'R0' }, base2)).toThrow(HttpError)
		expect(() => assertRaiseOnlyTierOverrides({ 'nope.tool': 'R2' }, base2)).toThrow(HttpError)
	})
})

describe('AgentRateLimiter', () => {
	test('token bucket: callsPerMinute throttles with Retry-After 429', () => {
		const l = new AgentRateLimiter({ ...DEFAULT_AGENT_RATE_LIMITS, callsPerMinute: 2 })
		l.acquire('a').release()
		l.acquire('a')
		// inFlight=1 < maxConcurrent, tokens now 0 → next acquire 429s
		expect(() => l.acquire('a')).toThrow(HttpError)
	})

	test('concurrency cap trips even with tokens left', () => {
		const l = new AgentRateLimiter({ ...DEFAULT_AGENT_RATE_LIMITS, maxConcurrent: 1 })
		l.acquire('a')
		expect(() => l.acquire('a')).toThrow(HttpError)
	})

	test('release frees the concurrency slot', () => {
		const l = new AgentRateLimiter({ ...DEFAULT_AGENT_RATE_LIMITS, maxConcurrent: 1 })
		const hold = l.acquire('a')
		hold.release()
		expect(() => l.acquire('a')).not.toThrow()
	})

	test('read-volume cap charges bytes and 429s past the hourly limit', () => {
		const l = new AgentRateLimiter({ ...DEFAULT_AGENT_RATE_LIMITS, readBytesPerHour: 10 })
		l.chargeRead('tok', 6)
		expect(() => l.chargeRead('tok', 6)).toThrow(HttpError)
	})

	test('buckets are independent per key', () => {
		const l = new AgentRateLimiter({ ...DEFAULT_AGENT_RATE_LIMITS, callsPerMinute: 1 })
		l.acquire('a')
		expect(() => l.acquire('b')).not.toThrow()
	})
})
