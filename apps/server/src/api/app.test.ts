/**
 * Route-shape tests that don't need a database: problem+json contract on
 * rejection paths (§16.2, and the "test successful AND rejected" Elysia rule).
 * DB-backed paths live in the integration suite (packages/test-utils harness).
 */
import { describe, expect, test } from 'bun:test'
import { createApp } from './app'

// A stub Sql that fails fast — these tests never reach the database.
const stubSql = new Proxy((() => {}) as never, {
	get: () => () => Promise.reject(new Error('no db in unit tests'))
})

const app = createApp({ sql: stubSql as never, migrationsDir: '.', mode: 'selfhost', auth: null })

describe('api contract', () => {
	test('GET /health', async () => {
		const res = await app.handle(new Request('http://t/health'))
		expect(res.status).toBe(200)
		expect(await res.json()).toEqual({ status: 'ok' })
	})

	test('unknown route → problem+json', async () => {
		const res = await app.handle(new Request('http://t/nope'))
		expect(res.status).toBe(404)
		expect(res.headers.get('content-type')).toContain('application/problem+json')
		const body = (await res.json()) as { code?: string; requestId?: string }
		expect(body.code).toBeDefined()
		expect(body.requestId).toBeDefined()
	})

	test('invalid setup body → 422 problem+json, never a stack', async () => {
		const res = await app.handle(
			new Request('http://t/api/v1/setup', {
				method: 'POST',
				headers: { 'content-type': 'application/json' },
				body: JSON.stringify({ token: 'short' })
			})
		)
		expect(res.status).toBe(422)
		const body = (await res.json()) as { code?: string }
		expect(body.code).toBe('validation_failed')
	})

	test('x-request-id round-trips', async () => {
		const res = await app.handle(
			new Request('http://t/health', { headers: { 'x-request-id': 'req_test_1' } })
		)
		expect(res.headers.get('x-request-id')).toBe('req_test_1')
	})

	// ---- session-gated routes: auth null → 501 not_implemented (never 500) ----

	test('GET /workspaces/current without auth → 501 problem+json', async () => {
		const res = await app.handle(new Request('http://t/api/v1/workspaces/current'))
		expect(res.status).toBe(501)
		const body = (await res.json()) as { code?: string }
		expect(body.code).toBe('not_implemented')
	})

	test('POST /invitations/accept without auth → 501 problem+json', async () => {
		const res = await app.handle(
			new Request('http://t/api/v1/invitations/accept', {
				method: 'POST',
				headers: { 'content-type': 'application/json' },
				body: JSON.stringify({ token: 'a'.repeat(43) })
			})
		)
		expect(res.status).toBe(501)
		const body = (await res.json()) as { code?: string }
		expect(body.code).toBe('not_implemented')
	})

	test('POST /invitations accepts only owner-issuable roles', async () => {
		const res = await app.handle(
			new Request('http://t/api/v1/invitations', {
				method: 'POST',
				headers: { 'content-type': 'application/json' },
				body: JSON.stringify({
					workspaceId: crypto.randomUUID(),
					email: 'x@y.z',
					role: 'owner' // inviting as owner is never allowed
				})
			})
		)
		expect(res.status).toBe(422)
		const body = (await res.json()) as { code?: string }
		expect(body.code).toBe('validation_failed')
	})
})
