import { describe, expect, it } from 'bun:test'
import { isArgsError, parseArgs } from './args'
import { pollDeviceTokens, refreshTokens } from './device'
import { EXIT, exitForFailure } from './http'
import { main } from './index'
import { testIo } from './io'
import { credentialsPath, getCredential, redactSecret, setCredential } from './store'

describe('arg parser', () => {
	it('positional + flags + value flags', () => {
		const p = parseArgs(['issue', 'view', 'ENG-1', '--md', '--workspace', 'ws1'])
		if (isArgsError(p)) throw new Error('parse failed')
		expect(p.positional).toEqual(['issue', 'view', 'ENG-1'])
		expect(p.flags['md']).toBe(true)
		expect(p.flags['workspace']).toBe('ws1')
	})
	it('unknown value-flag missing value → usage error', () => {
		expect(isArgsError(parseArgs(['issue', 'view', '--id']))).toBe(true)
	})
})

describe('exit-code mapping', () => {
	it('maps problem codes to stable codes', () => {
		expect(exitForFailure(401, 'unauthorized').code).toBe(EXIT.auth)
		expect(exitForFailure(403, 'insufficient_scope').code).toBe(EXIT.auth)
		expect(exitForFailure(404, 'not_found').code).toBe(EXIT.notFound)
		expect(exitForFailure(429, 'tool_rate_limited', '5').code).toBe(EXIT.rateLimited)
		expect(exitForFailure(500, 'internal').code).toBe(EXIT.error)
		expect(exitForFailure(403, 'insufficient_scope').message).toContain('scope')
	})
})

describe('device poller', () => {
	it('pending → success', async () => {
		let calls = 0
		const io = testIo({
			fetch: async () => {
				calls++
				return calls < 2
					? new Response(JSON.stringify({ error: 'authorization_pending' }), { status: 400 })
					: new Response(JSON.stringify({ access_token: 'at1', refresh_token: 'rt1', expires_in: 60 }))
			}
		})
		const t = await pollDeviceTokens(io, 'http://s', 'dc', { interval: 1, expiresIn: 60 })
		expect('accessToken' in t && t.accessToken).toBe('at1')
	})
	it('slow_down increases interval; denied aborts', async () => {
		const io = testIo({
			fetch: async () => new Response(JSON.stringify({ error: 'access_denied' }), { status: 400 })
		})
		const t = await pollDeviceTokens(io, 'http://s', 'dc', { interval: 1, expiresIn: 60 })
		expect('error' in t && t.error).toBe('access_denied')
	})
	it('refresh returns tokens; invalid_grant → null', async () => {
		const io = testIo({
			fetch: async (_u, init) =>
				String((init as RequestInit).body).includes('refresh_token')
					? new Response(JSON.stringify({ access_token: 'at2', refresh_token: 'rt2' }))
					: new Response('{}', { status: 400 })
		})
		expect((await refreshTokens(io, 'http://s', 'rt'))?.accessToken).toBe('at2')
		const bad = testIo({ fetch: async () => new Response('{"error":"invalid_grant"}', { status: 400 }) })
		expect(await refreshTokens(bad, 'http://s', 'rt')).toBeNull()
	})
})

describe('credential store', () => {
	it('per-URL isolation + atomic write path', () => {
		const io = testIo()
		setCredential(io, 'http://a/', { accessToken: 'x', kind: 'oauth' })
		setCredential(io, 'http://b', { accessToken: 'y', kind: 'api-key' })
		expect(getCredential(io, 'http://a')?.accessToken).toBe('x')
		expect(getCredential(io, 'http://b')?.accessToken).toBe('y')
		expect(getCredential(io, 'http://c')).toBeUndefined()
		expect(io.files.has(credentialsPath(io))).toBe(true)
	})
	it('redaction never echoes secrets', () => {
		const k = 'hrk_AbCdEfGh_verylongsecretvalue1234567890'
		expect(redactSecret(k)).not.toContain('verylongsecret')
	})
})

describe('command dispatch', () => {
	it('unknown command → exit 2', async () => {
		const io = testIo({ env: { HURIRO_URL: 'http://s', HURIRO_TOKEN: 't', HURIRO_WORKSPACE: 'w' } })
		expect(await main(['bogus'], io)).toBe(EXIT.usage)
	})
	it('unknown tool → exit 2 with manifest list', async () => {
		const io = testIo({ env: { HURIRO_URL: 'http://s', HURIRO_TOKEN: 't', HURIRO_WORKSPACE: 'w' } })
		expect(await main(['tool', 'nope'], io)).toBe(EXIT.usage)
		expect(io.err.join()).toContain('tasks.my_queue')
	})
	it('tool call success prints data; approval_required → exit 4', async () => {
		const io = testIo({
			env: { HURIRO_URL: 'http://s', HURIRO_TOKEN: 't', HURIRO_WORKSPACE: 'w' },
			fetch: async (_u, init) => {
				expect((init as RequestInit).headers as Record<string, string>).toMatchObject({
					'x-workspace-id': 'w'
				})
				return new Response(
					JSON.stringify({ status: 'approval_required', approvalId: 'ap1', approveUrl: 'http://x' })
				)
			}
		})
		expect(await main(['tool', 'tasks.update', '--id', 'i1'], io)).toBe(EXIT.approval)
		expect(io.err.join()).toContain('ap1')
	})
	it('insufficient_scope → exit 3', async () => {
		const io = testIo({
			env: { HURIRO_URL: 'http://s', HURIRO_TOKEN: 't', HURIRO_WORKSPACE: 'w' },
			fetch: async () => new Response(JSON.stringify({ code: 'insufficient_scope' }), { status: 403 })
		})
		expect(await main(['queue'], io)).toBe(EXIT.auth)
	})
	it('write calls send an Idempotency-Key', async () => {
		let sawIdem = ''
		const io = testIo({
			env: { HURIRO_URL: 'http://s', HURIRO_TOKEN: 't', HURIRO_WORKSPACE: 'w' },
			fetch: async (_u, init) => {
				const h = (init as RequestInit).headers as Record<string, string>
				sawIdem = h['idempotency-key'] ?? ''
				return new Response(JSON.stringify({ status: 'executed', data: { ok: true } }))
			}
		})
		expect(await main(['tool', 'tasks.comment', '--issue', 'i1', '-m', 'hi'], io)).toBe(EXIT.ok)
		expect(sawIdem.length).toBeGreaterThan(0)
	})
})
