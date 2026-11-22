/**
 * CSRF gate unit tests (§12.6). The check runs once as a beforeHandle on the
 * /api/v1 group — the regression it covers: behind a reverse proxy `request.url`
 * is the internal listener, not the page origin, so a legitimate browser Origin
 * must match the configured public origin (HURIRO_URL) instead.
 */
import { describe, expect, test } from 'bun:test'
import { assertCookieCsrf } from './context'
import { HttpError } from './error'

/** Cookie-authed POST with the client header — the shape the web app sends. */
function mutation(url: string, headers: Record<string, string> = {}): Request {
	return new Request(url, {
		method: 'POST',
		headers: { cookie: 'session=1', 'x-huriro-client': 'huriro-test', ...headers }
	})
}

function expectForbidden(fn: () => void): void {
	try {
		fn()
	} catch (err) {
		expect(err).toBeInstanceOf(HttpError)
		expect((err as HttpError).status).toBe(403)
		return
	}
	throw new Error('expected HttpError(403)')
}

describe('assertCookieCsrf', () => {
	test('skips requests without cookie auth (Bearer/native clients)', () => {
		expect(() =>
			assertCookieCsrf(new Request('http://api.internal:3001/api/v1/x', { method: 'POST' }))
		).not.toThrow()
	})

	test('skips safe methods', () => {
		expect(() =>
			assertCookieCsrf(new Request('http://app.example/api/v1/x', { headers: { cookie: 's=1' } }))
		).not.toThrow()
	})

	test('accepts a same-origin mutation', () => {
		expect(() =>
			assertCookieCsrf(mutation('http://app.example/api/v1/x', { origin: 'http://app.example' }))
		).not.toThrow()
	})

	test('accepts an allowed public origin behind a proxy', () => {
		// The reported bug: Nitro devProxy rewrites Host to 127.0.0.1:3001 while
		// the browser Origin stays http://localhost:3000.
		expect(() =>
			assertCookieCsrf(
				mutation('http://127.0.0.1:3001/api/v1/workspaces', { origin: 'http://localhost:3000' }),
				['http://localhost:3000']
			)
		).not.toThrow()
	})

	test('accepts a TLS-terminated origin (Caddy: https page → http request)', () => {
		expect(() =>
			assertCookieCsrf(mutation('http://app.example.com/api/v1/x', { origin: 'https://app.example.com' }), [
				'https://app.example.com'
			])
		).not.toThrow()
	})

	test('rejects a foreign origin', () => {
		expectForbidden(() =>
			assertCookieCsrf(mutation('http://127.0.0.1:3001/api/v1/x', { origin: 'https://evil.example' }), [
				'http://localhost:3000'
			])
		)
	})

	test('rejects cross-site fetch metadata', () => {
		expectForbidden(() =>
			assertCookieCsrf(mutation('http://app.example/api/v1/x', { 'sec-fetch-site': 'cross-site' }))
		)
	})

	test('requires X-Huriro-Client on cookie-authed mutations', () => {
		expectForbidden(() =>
			assertCookieCsrf(
				new Request('http://app.example/api/v1/x', { method: 'POST', headers: { cookie: 's=1' } })
			)
		)
	})
})
