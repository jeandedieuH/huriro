import { describe, expect, test } from 'bun:test'
import { decodeCursor, ERROR_CODES, ERROR_DOC_BASE, encodeCursor, problem } from './index'

describe('problem()', () => {
	test('builds RFC 9457 body with stable code and doc URL', () => {
		const p = problem({
			status: 404,
			code: 'not_found',
			title: 'Workspace not found',
			requestId: 'req_1'
		})
		expect(p.type).toBe(`${ERROR_DOC_BASE}not_found`)
		expect(p.status).toBe(404)
		expect(p.code).toBe('not_found')
		expect(p.requestId).toBe('req_1')
		expect('detail' in p).toBe(false) // optional fields omitted, not null
	})

	test('merges extension fields without overwriting the core shape', () => {
		const p = problem(
			{ status: 409, code: 'stale_version', title: 'stale', requestId: 'r' },
			{ currentVersion: 5, yourVersion: 3 }
		)
		expect((p as { currentVersion?: unknown }).currentVersion).toBe(5)
		expect(p.code).toBe('stale_version')
	})
})

describe('error codes', () => {
	test('are unique', () => {
		expect(new Set(ERROR_CODES).size).toBe(ERROR_CODES.length)
	})
})

describe('cursors', () => {
	test('round-trip an arbitrary payload', () => {
		const payload = { id: '0190a0b1-9a9a-7000-8000-000000000001', v: 2 }
		expect(decodeCursor<typeof payload>(encodeCursor(payload))).toEqual(payload)
	})

	test('decode returns undefined for empty/garbage input', () => {
		expect(decodeCursor(undefined)).toBeUndefined()
		expect(decodeCursor('not-a-cursor!!!')).toBeUndefined()
	})
})
