/**
 * Route-shape tests that don't need a database: problem+json contract on
 * rejection paths (§16.2, and the "test successful AND rejected" Elysia rule).
 * DB-backed paths live in the integration suite (packages/test-utils harness).
 */
import { describe, expect, test } from 'bun:test'
import type { Sql } from '@huriro/db'
import { EmailDeliveryError, type EmailPipeline } from '../email'
import type { Auth } from '../modules/identity'
import { createApp } from './app'

function createSetupSqlStub(configured: boolean): Sql {
	const txFn = async (strings: TemplateStringsArray, ...values: unknown[]): Promise<unknown[]> => {
		const query = strings.join(' ? ').replace(/\s+/g, ' ').trim()
		if (query.startsWith('SELECT set_config')) return []
		if (query.startsWith('SELECT value FROM instance_settings')) {
			return values[0] === 'setup_completed' && configured ? [{ value: true }] : []
		}
		throw new Error(`unexpected sql query in unit test: ${query}`)
	}
	return Object.assign(txFn, {
		begin: async <T>(fn: (tx: typeof txFn) => Promise<T>): Promise<T> => fn(txFn)
	}) as unknown as Sql
}

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

	test('GET /api/v1/auth/providers returns empty list without auth', async () => {
		const res = await app.handle(new Request('http://t/api/v1/auth/providers'))
		expect(res.status).toBe(200)
		expect(await res.json()).toEqual({ providers: [] })
	})

	test('GET /workspaces/current without auth → 501 problem+json', async () => {
		const res = await app.handle(new Request('http://t/api/v1/workspaces/current'))
		expect(res.status).toBe(501)
		const body = (await res.json()) as { code?: string }
		expect(body.code).toBe('not_implemented')
	})

	test('POST /workspaces rejects invalid slug → 422 problem+json', async () => {
		const res = await app.handle(
			new Request('http://t/api/v1/workspaces', {
				method: 'POST',
				headers: { 'content-type': 'application/json' },
				body: JSON.stringify({ name: 'Acme', slug: 'INVALID SLUG' })
			})
		)
		expect(res.status).toBe(422)
		const body = (await res.json()) as { code?: string }
		expect(body.code).toBe('validation_failed')
	})

	test('POST /workspaces without auth → 501 problem+json', async () => {
		const res = await app.handle(
			new Request('http://t/api/v1/workspaces', {
				method: 'POST',
				headers: { 'content-type': 'application/json' },
				body: JSON.stringify({ name: 'Acme', slug: 'acme' })
			})
		)
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

	// ---- CSRF gate (§12.6): cookie-authed mutations under /api/v1 ----

	test('POST /workspaces behind the dev proxy accepts the public origin', async () => {
		// Nitro devProxy rewrites Host → 127.0.0.1:3001 but the browser Origin
		// stays :3000. HURIRO_URL in allowedOrigins lets it through; the request
		// then reaches the handler, which 501s only because auth is null here.
		const proxyApp = createApp({
			sql: stubSql as never,
			migrationsDir: '.',
			mode: 'selfhost',
			auth: null,
			allowedOrigins: ['http://localhost:3000']
		})
		const res = await proxyApp.handle(
			new Request('http://127.0.0.1:3001/api/v1/workspaces', {
				method: 'POST',
				headers: {
					'content-type': 'application/json',
					cookie: 'better-auth.session_token=x',
					origin: 'http://localhost:3000',
					'x-huriro-client': 'huriro-web'
				},
				body: JSON.stringify({ name: 'Acme', slug: 'acme' })
			})
		)
		expect(res.status).toBe(501)
	})

	test('POST /workspaces cross-origin without allowedOrigins → 403', async () => {
		// Strict default: the browser origin is not the request origin and no
		// public origin is configured — stays forbidden.
		const res = await app.handle(
			new Request('http://127.0.0.1:3001/api/v1/workspaces', {
				method: 'POST',
				headers: {
					'content-type': 'application/json',
					cookie: 's=1',
					origin: 'http://localhost:3000',
					'x-huriro-client': 'huriro-web'
				},
				body: JSON.stringify({ name: 'Acme', slug: 'acme' })
			})
		)
		expect(res.status).toBe(403)
	})

	test('POST /workspaces with a foreign Origin → 403 problem+json', async () => {
		const res = await app.handle(
			new Request('http://127.0.0.1:3001/api/v1/workspaces', {
				method: 'POST',
				headers: {
					'content-type': 'application/json',
					cookie: 's=1',
					origin: 'https://evil.example',
					'x-huriro-client': 'huriro-web'
				},
				body: JSON.stringify({ name: 'Acme', slug: 'acme' })
			})
		)
		expect(res.status).toBe(403)
		const body = (await res.json()) as { code?: string }
		expect(body.code).toBe('forbidden')
	})

	test('cookie-authed POST without X-Huriro-Client → 403 problem+json', async () => {
		const res = await app.handle(
			new Request('http://t/api/v1/workspaces', {
				method: 'POST',
				headers: { 'content-type': 'application/json', cookie: 's=1', origin: 'http://t' },
				body: JSON.stringify({ name: 'Acme', slug: 'acme' })
			})
		)
		expect(res.status).toBe(403)
		const body = (await res.json()) as { code?: string }
		expect(body.code).toBe('forbidden')
	})

	// ---- M1 route contracts & security headers ----

	test('security headers are attached to responses', async () => {
		const res = await app.handle(new Request('http://t/health'))
		expect(res.headers.get('x-content-type-options')).toBe('nosniff')
		expect(res.headers.get('x-frame-options')).toBe('DENY')
		expect(res.headers.get('referrer-policy')).toBe('strict-origin-when-cross-origin')
	})

	test('GET /projects without auth → 501 problem+json', async () => {
		const res = await app.handle(
			new Request('http://t/api/v1/projects', {
				headers: { 'x-workspace-id': crypto.randomUUID() }
			})
		)
		expect(res.status).toBe(501)
		expect(res.headers.get('content-type')).toContain('application/problem+json')
		const body = (await res.json()) as { code?: string }
		expect(body.code).toBe('not_implemented')
	})

	test('POST /issues rejects invalid project key / priority before auth or returns 422/501', async () => {
		const res = await app.handle(
			new Request('http://t/api/v1/issues', {
				method: 'POST',
				headers: { 'content-type': 'application/json', 'x-workspace-id': crypto.randomUUID() },
				body: JSON.stringify({ projectId: crypto.randomUUID(), title: 'Bad', priority: 9 })
			})
		)
		expect(res.status).toBe(422)
		const body = (await res.json()) as { code?: string }
		expect(body.code).toBe('validation_failed')
	})

	test('GET /sync/changes without auth → 501 problem+json', async () => {
		const res = await app.handle(
			new Request('http://t/api/v1/sync/changes?since=0', {
				headers: { 'x-workspace-id': crypto.randomUUID() }
			})
		)
		expect(res.status).toBe(501)
		const body = (await res.json()) as { code?: string }
		expect(body.code).toBe('not_implemented')
	})

	test('GET /search without auth → 501 problem+json', async () => {
		const res = await app.handle(
			new Request('http://t/api/v1/search?q=bug', {
				headers: { 'x-workspace-id': crypto.randomUUID() }
			})
		)
		expect(res.status).toBe(501)
		const body = (await res.json()) as { code?: string }
		expect(body.code).toBe('not_implemented')
	})

	test('GET /notifications without auth → 501 problem+json', async () => {
		const res = await app.handle(
			new Request('http://t/api/v1/notifications', {
				headers: { 'x-workspace-id': crypto.randomUUID() }
			})
		)
		expect(res.status).toBe(501)
		const body = (await res.json()) as { code?: string }
		expect(body.code).toBe('not_implemented')
	})

	test('POST /imports/dry-run validates source union', async () => {
		const res = await app.handle(
			new Request('http://t/api/v1/imports/dry-run', {
				method: 'POST',
				headers: { 'content-type': 'application/json', 'x-workspace-id': crypto.randomUUID() },
				body: JSON.stringify({ source: 'trello' })
			})
		)
		expect(res.status).toBe(422)
		const body = (await res.json()) as { code?: string }
		expect(body.code).toBe('validation_failed')
	})

	test('POST /chat/channels validates channel name format', async () => {
		const res = await app.handle(
			new Request('http://t/api/v1/chat/channels', {
				method: 'POST',
				headers: { 'content-type': 'application/json', 'x-workspace-id': crypto.randomUUID() },
				body: JSON.stringify({ name: 'Invalid Spaces!' })
			})
		)
		expect(res.status).toBe(422)
		const body = (await res.json()) as { code?: string }
		expect(body.code).toBe('validation_failed')
	})

	test('POST /webhooks validates required events array', async () => {
		const res = await app.handle(
			new Request('http://t/api/v1/webhooks', {
				method: 'POST',
				headers: { 'content-type': 'application/json', 'x-workspace-id': crypto.randomUUID() },
				body: JSON.stringify({ name: 'Hook', url: 'https://example.com/hook', events: [] })
			})
		)
		expect(res.status).toBe(422)
		const body = (await res.json()) as { code?: string }
		expect(body.code).toBe('validation_failed')
	})

	test('POST /integrations/github/webhook rejects missing X-Hub-Signature-256 with 401', async () => {
		const res = await app.handle(
			new Request('http://t/api/v1/integrations/github/webhook', {
				method: 'POST',
				headers: { 'content-type': 'application/json' },
				body: JSON.stringify({ action: 'opened' })
			})
		)
		expect(res.status).toBe(401)
		const body = (await res.json()) as { code?: string }
		expect(body.code).toBe('webhook_signature_invalid')
	})

	// ---- pre-setup auth gating (§12.2) ----

	test('POST /api/auth/sign-up/email returns 403 problem+json while instance setup is incomplete', async () => {
		let handlerCalls = 0
		const gatedApp = createApp({
			sql: createSetupSqlStub(false),
			migrationsDir: '.',
			mode: 'selfhost',
			auth: {
				options: { baseURL: 'http://localhost', socialProviders: {} },
				handler: async () => {
					handlerCalls += 1
					return new Response(JSON.stringify({ ok: true }), { status: 200 })
				}
			} as unknown as Auth
		})

		const res = await gatedApp.handle(
			new Request('http://localhost/api/auth/sign-up/email', {
				method: 'POST',
				headers: { 'content-type': 'application/json' },
				body: JSON.stringify({ email: 'stranger@example.com', password: 'Password99!', name: 'Stranger' })
			})
		)
		expect(res.status).toBe(403)
		expect(res.headers.get('content-type')).toContain('application/problem+json')
		const body = (await res.json()) as { code?: string }
		expect(body.code).toBe('setup_required')
		expect(handlerCalls).toBe(0)
	})

	test('POST /api/auth/sign-up/email forwards to auth handler after setup completes', async () => {
		let handlerCalls = 0
		const openApp = createApp({
			sql: createSetupSqlStub(true),
			migrationsDir: '.',
			mode: 'selfhost',
			auth: {
				options: { baseURL: 'http://localhost', socialProviders: {} },
				handler: async () => {
					handlerCalls += 1
					return new Response(JSON.stringify({ token: 'tok' }), {
						status: 200,
						headers: { 'content-type': 'application/json' }
					})
				}
			} as unknown as Auth
		})

		const res = await openApp.handle(
			new Request('http://localhost/api/auth/sign-up/email', {
				method: 'POST',
				headers: { 'content-type': 'application/json' },
				body: JSON.stringify({ email: 'ada@example.com', password: 'Password99!', name: 'Ada' })
			})
		)
		expect(res.status).toBe(200)
		expect(handlerCalls).toBe(1)
	})

	test('POST /api/auth/sign-in/email stays reachable while setup is incomplete', async () => {
		let handlerCalls = 0
		const gatedApp = createApp({
			sql: createSetupSqlStub(false),
			migrationsDir: '.',
			mode: 'selfhost',
			auth: {
				options: { baseURL: 'http://localhost', socialProviders: {} },
				handler: async () => {
					handlerCalls += 1
					return new Response(JSON.stringify({ token: 'tok' }), {
						status: 200,
						headers: { 'content-type': 'application/json' }
					})
				}
			} as unknown as Auth
		})

		const res = await gatedApp.handle(
			new Request('http://localhost/api/auth/sign-in/email', {
				method: 'POST',
				headers: { 'content-type': 'application/json' },
				body: JSON.stringify({ email: 'ada@example.com', password: 'Password99!' })
			})
		)
		expect(res.status).toBe(200)
		expect(handlerCalls).toBe(1)
	})

	test('email status & test routes enforce auth and schema validation cleanly', async () => {
		const resNoAuth = await app.handle(
			new Request('http://t/api/v1/notifications/email/status', {
				headers: { 'x-workspace-id': crypto.randomUUID() }
			})
		)
		expect(resNoAuth.status).toBe(501)
		expect(resNoAuth.headers.get('content-type')).toContain('application/problem+json')

		const resInvalidEmail = await app.handle(
			new Request('http://t/api/v1/notifications/email/test', {
				method: 'POST',
				headers: {
					'content-type': 'application/json',
					'x-workspace-id': crypto.randomUUID(),
					'x-huriro-client': 'huriro-web'
				},
				body: JSON.stringify({ to: 'not-an-email' })
			})
		)
		expect(resInvalidEmail.status).toBe(422)
		const bodyInvalid = (await resInvalidEmail.json()) as { code?: string }
		expect(bodyInvalid.code).toBe('validation_failed')

		const resTestNoSession = await createApp({
			sql: stubSql as never,
			migrationsDir: '.',
			mode: 'selfhost',
			auth: {
				options: { baseURL: 'http://localhost', socialProviders: {} },
				api: { getSession: async () => null }
			} as unknown as Auth
		}).handle(
			new Request('http://t/api/v1/notifications/email/test', {
				method: 'POST',
				headers: {
					'content-type': 'application/json',
					'x-workspace-id': crypto.randomUUID(),
					'x-huriro-client': 'huriro-web'
				},
				body: JSON.stringify({ to: 'ops@example.com' })
			})
		)
		expect(resTestNoSession.status).toBe(401)
		expect(resTestNoSession.headers.get('content-type')).toContain('application/problem+json')
	})

	test('POST /notifications/email/test maps EmailDeliveryError to safe 502 email_delivery_failed problem+json', async () => {
		const userId = crypto.randomUUID()
		const workspaceId = crypto.randomUUID()
		const txFn = async (strings: TemplateStringsArray): Promise<unknown[]> => {
			const query = strings.join(' ? ').replace(/\s+/g, ' ').trim()
			if (query.startsWith('SELECT set_config')) return []
			if (query.includes('FROM memberships m')) {
				return [{ roleId: crypto.randomUUID(), roleKey: 'owner', roleRank: 100, status: 'active' }]
			}
			if (query.includes('FROM role_permissions')) {
				return [{ permission: 'settings.manage' }]
			}
			if (query.includes('FROM workspaces')) {
				return [{ name: 'Acme Workspace' }]
			}
			throw new Error(`unexpected sql query in unit test: ${query}`)
		}
		const emailTestSql = Object.assign(txFn, {
			begin: async <T>(fn: (tx: typeof txFn) => Promise<T>): Promise<T> => fn(txFn)
		}) as unknown as Sql

		const emailStub = {
			configured: true,
			mode: 'selfhost',
			provider: 'smtp',
			from: 'Huriro <noreply@huriro.local>',
			emailVerificationRequired: false,
			baseUrl: 'http://localhost:3000',
			appName: 'Huriro',
			sendTestEmail: async () => {
				throw new EmailDeliveryError('smtp', 'raw secret smtp reply', {
					retryable: true,
					cause: Object.assign(new Error('dns fail'), { code: 'EDNS' })
				})
			}
		} as unknown as EmailPipeline

		const failingEmailApp = createApp({
			sql: emailTestSql,
			migrationsDir: '.',
			mode: 'selfhost',
			email: emailStub,
			auth: {
				options: { baseURL: 'http://localhost', socialProviders: {} },
				api: {
					getSession: async () => ({
						user: { id: userId, email: 'ops@example.com' },
						session: { id: crypto.randomUUID() }
					})
				}
			} as unknown as Auth
		})

		const res = await failingEmailApp.handle(
			new Request('http://t/api/v1/notifications/email/test', {
				method: 'POST',
				headers: {
					'content-type': 'application/json',
					cookie: 's=1',
					origin: 'http://t',
					'x-workspace-id': workspaceId,
					'x-huriro-client': 'huriro-web'
				},
				body: JSON.stringify({ to: 'ops@example.com' })
			})
		)
		expect(res.status).toBe(502)
		expect(res.headers.get('content-type')).toContain('application/problem+json')
		const rawBody = await res.text()
		expect(rawBody).not.toContain('raw secret smtp reply')
		const body = JSON.parse(rawBody) as { code?: string; title?: string; detail?: string }
		expect(body.code).toBe('email_delivery_failed')
		expect(body.title).toBe('Email delivery failed (smtp)')
		expect(body.detail).toContain('hostname')
		expect(body.detail).toContain('DNS')
	})
})
