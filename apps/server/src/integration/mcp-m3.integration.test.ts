/**
 * `/mcp` endpoint integration test (§13.1b, MCP 2026-07-28).
 *
 * Raw JSON-RPC over app.handle — no SDK client. Covers the auth wall
 * (401 + RFC 9728 challenge, audience separation, cookie handling),
 * method gating, scoped tools/list, a read tool end-to-end, MRTR
 * input_required → signed-state accept/tamper paths, the
 * no-elicitation → approval_required fallback, and discovery well-knowns.
 */
import { beforeAll, describe, expect, test } from 'bun:test'
import { randomUUID } from 'node:crypto'
import { getOAuthProviderApi } from '@better-auth/oauth-provider'
import {
	aMembership,
	anIssue,
	aProject,
	aWorkspace,
	getTestDb,
	migrationsDir,
	type TestDb
} from '@huriro/test-utils'
import { createApp } from '../api/app'
import type { Config } from '../env'
import {
	type Auth,
	agentAudienceUris,
	createAuth,
	ensureAgentOAuthSeed,
	HURIRO_CLI_CLIENT_ID
} from '../modules/identity'
import type { InProcessPubSub } from '../realtime/pubsub'

const BASE = 'http://localhost:3000'
const DEVICE_GRANT = 'urn:ietf:params:oauth:grant-type:device_code'
const CAPS_ELICIT = { 'io.modelcontextprotocol/clientCapabilities': { elicitation: {} } }

/** Link huriro-cli to the /mcp resource — idempotent across tests sharing a DB. */
async function linkMcp(r: Rig, clientId = HURIRO_CLI_CLIENT_ID) {
	const aud = agentAudienceUris(BASE)
	const adapter = r.ctx.adapter as unknown as {
		findOne<T>(a: { model: string; where: { field: string; value: string }[] }): Promise<T>
		create(a: { model: string; data: Record<string, unknown> }): Promise<unknown>
	}
	const existing = await adapter.findOne({
		model: 'oauthClientResource',
		where: [
			{ field: 'clientId', value: clientId },
			{ field: 'resourceId', value: aud.mcp }
		]
	})
	if (!existing) {
		await adapter.create({
			model: 'oauthClientResource',
			data: { clientId, resourceId: aud.mcp, createdAt: new Date() }
		})
	}
}

function config(databaseAuthUrl: string): Config {
	return {
		HURIRO_URL: BASE,
		HURIRO_ENV: 'test',
		HURIRO_MODE: 'selfhost',
		databaseUrl: databaseAuthUrl,
		databaseAdminUrl: databaseAuthUrl,
		databaseAuthUrl,
		secretKey: 'a'.repeat(48),
		betterAuthSecret: 'b'.repeat(48),
		PASSKEY_RP_NAME: 'Huriro',
		PORT: 3001,
		WS_PORT: 3005,
		LOG_LEVEL: 'error',
		BLOB_STORE: 'fs',
		BLOB_DIR: '/tmp'
	} as Config
}

let db: TestDb | null = null
beforeAll(async () => {
	db = await getTestDb()
})

interface Rig {
	readonly app: ReturnType<typeof createApp>
	readonly auth: Auth
	readonly ctx: Awaited<Auth['$context']>
}

async function rig(): Promise<Rig | null> {
	if (!db) return null
	const { InProcessPubSub } = await import('../realtime/pubsub')
	const auth = createAuth(config(db.url))
	await ensureAgentOAuthSeed(auth)
	const ctx = await auth.$context
	const pubsub: InProcessPubSub = new InProcessPubSub()
	const app = createApp({
		sql: db.app,
		migrationsDir: migrationsDir(),
		mode: 'selfhost',
		auth,
		pubsub,
		allowedOrigins: [BASE],
		rootSecret: 'x'.repeat(48)
	})
	return { app, auth, ctx }
}

async function mintToken(
	r: Rig,
	opts: { userId: string; scopes: string[]; resources: string[] }
): Promise<string> {
	const provider = (r.auth.options.plugins ?? []).find(
		(p) => (p as { id: string }).id === 'oauth-provider'
	) as { options: unknown }
	const adapter = r.ctx.adapter as unknown as {
		findOne<T>(a: { model: string; where: { field: string; value: string }[] }): Promise<T>
	}
	const client = await adapter.findOne({
		model: 'oauthClient',
		where: [{ field: 'clientId', value: HURIRO_CLI_CLIENT_ID }]
	})
	const api = getOAuthProviderApi(
		{ context: r.ctx, json: (b: unknown) => b } as never,
		provider.options as never,
		DEVICE_GRANT as never
	)
	const issued = await api.issueTokens({
		client: client as never,
		user: { id: opts.userId } as never,
		scopes: opts.scopes,
		resources: opts.resources
	})
	return issued.access_token
}

async function signup(r: Rig, email: string): Promise<string> {
	const res = await r.auth.handler(
		new Request(`${BASE}/api/auth/sign-up/email`, {
			method: 'POST',
			headers: {
				'content-type': 'application/json',
				'x-forwarded-for': `10.88.${Math.floor(Math.random() * 255)}.${Math.floor(Math.random() * 255)}`
			},
			body: JSON.stringify({ email, name: email, password: 'test-password-123456' })
		})
	)
	const body = (await res.json()) as { user?: { id?: string } }
	if (!body.user?.id) throw new Error(`signup failed: ${res.status}`)
	return body.user.id
}

interface RpcOpts {
	readonly token?: string | undefined
	readonly cookie?: string | undefined
	readonly headers?: Record<string, string>
	readonly meta?: Record<string, unknown>
	readonly params?: Record<string, unknown>
	readonly method?: string
}

async function rpc(app: Rig['app'], method: string, params: Record<string, unknown>, o: RpcOpts = {}) {
	const headers: Record<string, string> = {
		'content-type': 'application/json',
		'mcp-protocol-version': '2026-07-28',
		'mcp-method': method,
		...o.headers
	}
	// SEP-2243: `Mcp-Name` mirrors params.name / params.uri / params.taskId.
	if (typeof params['name'] === 'string') headers['mcp-name'] = params['name']
	else if (typeof params['uri'] === 'string') headers['mcp-name'] = params['uri']
	if (o.token) headers['authorization'] = `Bearer ${o.token}`
	if (o.cookie) headers['cookie'] = o.cookie
	const res = await app.handle(
		new Request(`${BASE}/mcp`, {
			method: 'POST',
			headers,
			body: JSON.stringify({
				jsonrpc: '2.0',
				id: randomUUID(),
				method,
				params: { _meta: { 'io.modelcontextprotocol/protocolVersion': '2026-07-28', ...o.meta }, ...params }
			})
		})
	)
	const text = await res.text()
	let json: Record<string, unknown> = {}
	try {
		json = text ? (JSON.parse(text) as Record<string, unknown>) : {}
	} catch {
		json = { raw: text }
	}
	return { status: res.status, json, res }
}

async function seed(r: Rig, tag: string) {
	const sql = db?.owner
	if (!sql) throw new Error('no test db')
	const ws = await aWorkspace(sql, { slug: `mcp-${tag}` })
	const userId = await signup(r, `mcp-${tag}@test.huriro.dev`)
	const roleId = ws.roleIds['owner']
	if (!roleId) throw new Error('owner role missing')
	await aMembership(sql, { workspaceId: ws.id, userId, roleId })
	const project = await aProject(sql, { workspaceId: ws.id, key: 'MC', name: 'MC' })
	return { ws, userId, project }
}

describe('MCP endpoint (M3 stage 3)', () => {
	test('auth wall: 401 + resource_metadata, audience split, cookie handling', async () => {
		const r = await rig()
		if (!r || !db) return

		// Unauthenticated → JSON-RPC 401 + RFC 9728 challenge.
		const noAuth = await rpc(r.app, 'tools/list', {})
		expect(noAuth.status).toBe(401)
		expect(noAuth.res.headers.get('www-authenticate') ?? '').toContain('resource_metadata')

		// Cookie-only is never a credential on /mcp.
		const cookieOnly = await rpc(r.app, 'tools/list', {}, { cookie: 'better-auth.session_token=x' })
		expect(cookieOnly.status).toBe(401)

		const { ws, userId } = await seed(r, randomUUID().slice(0, 6))
		const aud = agentAudienceUris(BASE)
		await linkMcp(r)
		const restToken = await mintToken(r, { userId, scopes: ['tasks.read'], resources: [aud.rest] })
		const mcpToken = await mintToken(r, { userId, scopes: ['tasks.read'], resources: [aud.mcp] })

		// Audience separation both ways.
		expect((await rpc(r.app, 'tools/list', {}, { token: restToken })).status).toBe(401)
		const restRes = await r.app.handle(
			new Request(`${BASE}/api/v1/agent/tools/workspace.describe`, {
				method: 'POST',
				headers: {
					'content-type': 'application/json',
					authorization: `Bearer ${mcpToken}`,
					'x-workspace-id': ws.id
				},
				body: '{}'
			})
		)
		expect(restRes.status).toBe(401)

		// GET/DELETE → 405 + Allow: POST.
		const g = await r.app.handle(new Request(`${BASE}/mcp`, { method: 'GET' }))
		expect(g.status).toBe(405)
		expect(g.headers.get('allow')).toBe('POST')
		const d = await r.app.handle(new Request(`${BASE}/mcp`, { method: 'DELETE' }))
		expect(d.status).toBe(405)

		// Valid MCP token → scoped tools/list.
		const list = await rpc(r.app, 'tools/list', {}, { token: mcpToken, meta: CAPS_ELICIT })
		expect(list.status).toBe(200)
		const tools = ((list.json['result'] as { tools?: { name: string }[] })?.tools ?? []).map((t) => t.name)
		expect(tools).toContain('tasks.get')
		expect(tools).not.toContain('tasks.create') // read-only token

		// Cookie + valid bearer → 400 credential_type_mismatch.
		const both = await rpc(
			r.app,
			'tools/list',
			{},
			{ token: mcpToken, cookie: 'better-auth.session_token=x' }
		)
		expect(both.status).toBe(400)
	})

	test('read tool end-to-end + workspace binding + unknown client', async () => {
		const r = await rig()
		if (!r || !db) return
		const { userId } = await seed(r, randomUUID().slice(0, 6))
		const aud = agentAudienceUris(BASE)
		await linkMcp(r)
		const token = await mintToken(r, { userId, scopes: ['tasks.read'], resources: [aud.mcp] })

		// huriro-cli lazily auto-connects → workspace.describe works and binds.
		const call = await rpc(
			r.app,
			'tools/call',
			{ name: 'workspace.describe', arguments: {} },
			{ token, meta: CAPS_ELICIT }
		)
		expect(call.status).toBe(200)
		const result = call.json['result'] as { content?: { text: string }[]; isError?: boolean }
		expect(result.isError).toBeFalsy()
		expect(result.content?.[0]?.text ?? '').toContain('#')

		// Unknown OAuth client with no principal → 403 agent_not_connected.
		// Unique client_id per run — the shared DB keeps clients between runs.
		const otherClientId = `https://other-${randomUUID().slice(0, 6)}.example.test/client`
		await r.ctx.adapter.create({
			model: 'oauthClient',
			data: {
				id: randomUUID(),
				clientId: otherClientId,
				name: 'Other',
				redirectUris: [],
				createdAt: new Date()
			}
		})
		await r.ctx.adapter.create({
			model: 'oauthClientResource',
			data: {
				clientId: otherClientId,
				resourceId: aud.mcp,
				createdAt: new Date()
			}
		})
		const provider = (r.auth.options.plugins ?? []).find(
			(p) => (p as { id: string }).id === 'oauth-provider'
		) as { options: unknown }
		const api = getOAuthProviderApi(
			{ context: r.ctx, json: (b: unknown) => b } as never,
			provider.options as never,
			DEVICE_GRANT as never
		)
		const adapter = r.ctx.adapter as unknown as {
			findOne<T>(a: { model: string; where: { field: string; value: string }[] }): Promise<T>
		}
		const otherClient = await adapter.findOne({
			model: 'oauthClient',
			where: [{ field: 'clientId', value: otherClientId }]
		})
		const issued = await api.issueTokens({
			client: otherClient as never,
			user: { id: userId } as never,
			scopes: ['tasks.read'],
			resources: [aud.mcp]
		})
		const denied = await rpc(
			r.app,
			'tools/call',
			{ name: 'tasks.get', arguments: { issue: 'x' } },
			{ token: issued.access_token, meta: CAPS_ELICIT }
		)
		// The MCP tool surface returns errors as tool results; either a 403
		// pre-dispatch or an isError result carrying the code is acceptable —
		// what must never happen is a 200 ok.
		const deniedResult = denied.json['result'] as
			| { isError?: boolean; _meta?: Record<string, unknown> }
			| undefined
		const deniedErr = denied.json['error'] as { code?: number } | undefined
		expect(denied.status === 403 || deniedResult?.isError === true || deniedErr !== undefined).toBe(true)
	})

	test('R1 write: input_required → signed-state accept → executed once; tamper refused', async () => {
		const r = await rig()
		if (!r || !db) return
		const { project, userId } = await seed(r, randomUUID().slice(0, 6))
		const aud = agentAudienceUris(BASE)
		await linkMcp(r)
		const token = await mintToken(r, {
			userId,
			scopes: ['tasks.read', 'tasks.write'],
			resources: [aud.mcp]
		})

		// First call → MRTR input_required with signed requestState.
		const args = { projectId: project.id, title: 'mcp-created', description: 'via mcp' }
		const first = await rpc(
			r.app,
			'tools/call',
			{ name: 'tasks.create', arguments: args },
			{ token, meta: CAPS_ELICIT }
		)
		expect(first.status).toBe(200)
		const firstResult = first.json['result'] as Record<string, unknown>
		expect(firstResult?.['resultType']).toBe('input_required')
		const state =
			(firstResult?.['requestState'] as string | undefined) ??
			((firstResult?.['_meta'] as Record<string, unknown> | undefined)?.[
				'io.modelcontextprotocol/requestState'
			] as string | undefined)
		expect(typeof state).toBe('string')

		// Accepted retry with untouched args → executes once. MRTR lifts
		// requestState/inputResponses from TOP-LEVEL params.
		const retry = await rpc(
			r.app,
			'tools/call',
			{
				name: 'tasks.create',
				arguments: args,
				requestState: state,
				inputResponses: { confirm: { action: 'accept', content: { confirm: true } } }
			},
			{ token, meta: CAPS_ELICIT }
		)
		expect(retry.status).toBe(200)
		const retryResult = retry.json['result'] as {
			isError?: boolean
			structuredContent?: Record<string, unknown>
		}
		expect(retryResult?.isError).toBeFalsy()

		// Tampered args against the same state → refused, no second write.
		const tampered = await rpc(
			r.app,
			'tools/call',
			{
				name: 'tasks.create',
				arguments: { ...args, title: 'tampered' },
				requestState: state,
				inputResponses: { confirm: { action: 'accept', content: { confirm: true } } }
			},
			{ token, meta: CAPS_ELICIT }
		)
		const tamperedResult = tampered.json['result'] as { isError?: boolean } | undefined
		expect(tamperedResult?.isError).toBe(true)
	})

	test('no-elicitation client: R1 write parks as approval_required', async () => {
		const r = await rig()
		if (!r || !db) return
		const { project, userId } = await seed(r, randomUUID().slice(0, 6))
		const aud = agentAudienceUris(BASE)
		await linkMcp(r)
		const token = await mintToken(r, {
			userId,
			scopes: ['tasks.read', 'tasks.write'],
			resources: [aud.mcp]
		})
		const call = await rpc(
			r.app,
			'tools/call',
			{ name: 'tasks.create', arguments: { projectId: project.id, title: 'noelicit' } },
			// Envelope key is required per request; an empty capabilities
			// object is exactly what a no-elicitation client declares.
			{ token, meta: { 'io.modelcontextprotocol/clientCapabilities': {} } }
		)
		expect(call.status).toBe(200)
		const result = call.json['result'] as { isError?: boolean; structuredContent?: Record<string, unknown> }
		expect(result?.isError).toBeFalsy()
		expect(result?.structuredContent?.['status']).toBe('approval_required')
		expect(typeof result?.structuredContent?.['approvalId']).toBe('string')
	})

	test('discovery: well-known endpoints serve correct metadata', async () => {
		const r = await rig()
		if (!r || !db) return
		const prm = await r.app.handle(
			new Request(`${BASE}/.well-known/oauth-protected-resource`, { method: 'GET' })
		)
		// May live under the resource path depending on better-auth version —
		// accept either, assert metadata when found.
		const paths = [
			`${BASE}/.well-known/oauth-protected-resource`,
			`${BASE}/.well-known/oauth-protected-resource/mcp`
		]
		let found = false
		for (const p of paths) {
			const res = await r.app.handle(new Request(p, { method: 'GET' }))
			if (res.status === 200) {
				found = true
				const md = (await res.json()) as Record<string, unknown>
				expect(JSON.stringify(md)).toContain(`${BASE}/mcp`)
			}
		}
		expect(found).toBe(true)

		const asMeta = await r.app.handle(
			new Request(`${BASE}/.well-known/oauth-authorization-server`, { method: 'GET' })
		)
		expect(asMeta.status).toBe(200)
		const meta = (await asMeta.json()) as Record<string, unknown>
		expect(meta['client_id_metadata_document_supported']).toBe(true)
		expect(meta['registration_endpoint']).toBeUndefined()
		expect(
			prm.status === 200 ||
				(await r.app.handle(new Request(`${BASE}/.well-known/oauth-protected-resource/mcp`))).status === 200
		).toBe(true)
	})
})

// ---------- stage 3 round 2: resources, binding, revocation, kill switch, .md ----------

/** Session for an EXISTING fixture user: seed() signs up with password
 * 'test-password-123456', so sign-in hands back the real signed cookie. */
async function signIn(r: Rig, email: string): Promise<string> {
	const res = await r.auth.handler(
		new Request(`${BASE}/api/auth/sign-in/email`, {
			method: 'POST',
			headers: {
				'content-type': 'application/json',
				'x-forwarded-for': `10.66.${Math.floor(Math.random() * 255)}.${Math.floor(Math.random() * 255)}`
			},
			body: JSON.stringify({ email, password: 'test-password-123456' })
		})
	)
	const setCookie = res.headers.get('set-cookie') ?? ''
	const cookie = setCookie
		.split(',')
		.map((c) => c.trim().split(';')[0])
		.find((c) => c?.startsWith('better-auth.session_token='))
	if (!cookie) throw new Error(`sign-in failed: ${res.status}`)
	return cookie
}

async function rest(
	app: Rig['app'],
	o: { method?: string; path: string; cookie?: string; token?: string; workspaceId?: string; body?: unknown }
) {
	const headers: Record<string, string> = {
		'content-type': 'application/json',
		'x-huriro-client': 'huriro-test',
		origin: BASE
	}
	if (o.cookie) headers['cookie'] = o.cookie
	if (o.token) headers['authorization'] = `Bearer ${o.token}`
	if (o.workspaceId) headers['x-workspace-id'] = o.workspaceId
	const res = await app.handle(
		new Request(`${BASE}${o.path}`, {
			method: o.method ?? 'GET',
			headers,
			...(o.body !== undefined ? { body: JSON.stringify(o.body) } : {})
		})
	)
	const text = await res.text()
	let json: Record<string, unknown> = {}
	try {
		json = text ? (JSON.parse(text) as Record<string, unknown>) : {}
	} catch {
		json = { raw: text }
	}
	return { status: res.status, json, text, res }
}

describe('MCP stage 3 — resources, binding, revocation, kill switch, .md', () => {
	test('resources/read for issue and doc; .md agent twins + session route; no shadowing', async () => {
		const r = await rig()
		if (!r || !db) return
		const tag = `res${randomUUID().slice(0, 6)}`
		const { ws, userId, project } = await seed(r, tag)
		const cookie = await signIn(r, `mcp-${tag}@test.huriro.dev`)
		const aud = agentAudienceUris(BASE)
		await linkMcp(r)
		const token = await mintToken(r, {
			userId,
			scopes: ['tasks.read', 'tasks.write', 'docs.read', 'docs.write'],
			resources: [aud.mcp, aud.rest]
		})

		// Seed an issue + doc via the REST agent surface (REST R1 is pre-approved).
		const create = await rest(r.app, {
			method: 'POST',
			path: '/api/v1/agent/tools/tasks.create',
			token,
			workspaceId: ws.id,
			body: { projectId: project.id, title: 'res-issue', description: 'see [x](https://evil.example)' }
		})
		expect(create.status).toBe(200)
		const issueId = (create.json['data'] as { issue: { id: string } }).issue.id
		const docCreate = await rest(r.app, {
			method: 'POST',
			path: '/api/v1/agent/tools/docs.create',
			token,
			workspaceId: ws.id,
			body: { title: 'res-doc', markdown: 'hello [l](https://evil.example)' }
		})
		expect(docCreate.status).toBe(200)
		const pageId =
			(docCreate.json['data'] as { pageId?: string }).pageId ?? (docCreate.json['data'] as { id: string }).id

		// resources/read: issue + doc, untrusted-wrapped, links neutralized.
		const ri = await rpc(
			r.app,
			'resources/read',
			{ uri: `huriro://issues/${issueId}` },
			{ token, meta: CAPS_ELICIT }
		)
		expect(ri.status).toBe(200)
		const riText = (ri.json['result'] as { contents?: { text: string }[] })?.contents?.[0]?.text ?? ''
		expect(riText).toContain('UNTRUSTED CONTENT')
		expect(riText).toContain('link: https://evil.example')
		const rd = await rpc(
			r.app,
			'resources/read',
			{ uri: `huriro://docs/${pageId}` },
			{ token, meta: CAPS_ELICIT }
		)
		expect(rd.status).toBe(200)
		expect((rd.json['result'] as { contents?: { text: string }[] })?.contents?.[0]?.text ?? '').toContain(
			'UNTRUSTED CONTENT'
		)

		// Session .md route + agent-bearer twin; JSON routes unshadowed.
		const sessMd = await rest(r.app, { path: `/api/v1/issues/${issueId}.md`, cookie, workspaceId: ws.id })
		expect(sessMd.status).toBe(200)
		expect(sessMd.res.headers.get('content-type') ?? '').toContain('text/markdown')
		expect(sessMd.text).toContain('UNTRUSTED CONTENT')
		const sessJson = await rest(r.app, { path: `/api/v1/issues/${issueId}`, cookie, workspaceId: ws.id })
		expect(sessJson.status).toBe(200)
		expect(sessJson.res.headers.get('content-type') ?? '').toContain('json')
		const sessDocMd = await rest(r.app, { path: `/api/v1/docs/${pageId}.md`, cookie, workspaceId: ws.id })
		expect(sessDocMd.status).toBe(200)
		expect(sessDocMd.text).toContain('UNTRUSTED CONTENT')

		const agentMd = await rest(r.app, {
			path: `/api/v1/agent/issues/${issueId}.md`,
			token,
			workspaceId: ws.id
		})
		expect(agentMd.status).toBe(200)
		expect(agentMd.res.headers.get('content-type') ?? '').toContain('text/markdown')
		expect(agentMd.text).toContain('UNTRUSTED CONTENT')
		const agentDocMd = await rest(r.app, {
			path: `/api/v1/agent/docs/${pageId}.md`,
			token,
			workspaceId: ws.id
		})
		expect(agentDocMd.status).toBe(200)
		expect(agentDocMd.text).toContain('UNTRUSTED CONTENT')
	})

	test('multi-workspace selection, revocation, kill switch, declined elicitation, R2 approve, 2025 init', async () => {
		const r = await rig()
		if (!r || !db) return
		const tag = `multi${randomUUID().slice(0, 6)}`
		const { ws, userId, project } = await seed(r, tag)
		const session = await signIn(r, `mcp-${tag}@test.huriro.dev`)
		const aud = agentAudienceUris(BASE)
		await linkMcp(r)
		const token = await mintToken(r, {
			userId,
			scopes: ['tasks.read', 'tasks.write'],
			resources: [aud.mcp, aud.rest]
		})

		// Single-workspace principal binds implicitly.
		const d1 = await rpc(
			r.app,
			'tools/call',
			{ name: 'workspace.describe', arguments: {} },
			{ token, meta: CAPS_ELICIT }
		)
		expect(d1.status).toBe(200)
		expect(JSON.stringify(d1.json['result'])).toContain(ws.id)

		// X-Huriro-Workspace selects among the user's workspaces; non-member refused.
		const ws2 = await aWorkspace(db.owner, { slug: `mcp-multi-b-${tag}` })
		const ownerRole = ws2.roleIds['owner']
		if (!ownerRole) throw new Error('owner role missing')
		await aMembership(db.owner, { workspaceId: ws2.id, userId, roleId: ownerRole })
		const d2 = await rpc(
			r.app,
			'tools/call',
			{ name: 'workspace.describe', arguments: {} },
			{ token, meta: CAPS_ELICIT, headers: { 'x-huriro-workspace': ws2.id } }
		)
		expect(d2.status).toBe(200)
		expect(JSON.stringify(d2.json['result'])).toContain(ws2.id)
		const ws3 = await aWorkspace(db.owner, { slug: `mcp-multi-c-${tag}` })
		const d3 = await rpc(
			r.app,
			'tools/call',
			{ name: 'workspace.describe', arguments: {} },
			{ token, meta: CAPS_ELICIT, headers: { 'x-huriro-workspace': ws3.id } }
		)
		const d3Err = d3.json['result'] as { isError?: boolean } | undefined
		expect(d3.status === 403 || d3Err?.isError === true || d3.json['error'] !== undefined).toBe(true)

		// Declined elicitation -> zero writes.
		const dec = await rpc(
			r.app,
			'tools/call',
			{ name: 'tasks.create', arguments: { projectId: project.id, title: 'declined' } },
			{ token, meta: CAPS_ELICIT, headers: { 'x-huriro-workspace': ws.id } }
		)
		const decResult = dec.json['result'] as Record<string, unknown>
		const decState =
			(decResult?.['requestState'] as string | undefined) ??
			((decResult?.['_meta'] as Record<string, unknown> | undefined)?.[
				'io.modelcontextprotocol/requestState'
			] as string | undefined)
		expect(typeof decState).toBe('string')
		await rpc(
			r.app,
			'tools/call',
			{
				name: 'tasks.create',
				arguments: { projectId: project.id, title: 'declined' },
				requestState: decState,
				inputResponses: { confirm: { action: 'decline' } }
			},
			{ token, meta: CAPS_ELICIT, headers: { 'x-huriro-workspace': ws.id } }
		)
		const count = await db.owner<
			{ n: number }[]
		>`SELECT count(*)::int AS n FROM issues WHERE title = 'declined'`
		expect(count[0]?.n).toBe(0)

		// R2 via MCP: bulk_update of 21 issues parks; owner approves via session route.
		const statusRow = await db.owner<
			{ id: string }[]
		>`SELECT id FROM project_statuses WHERE project_id = ${project.id} LIMIT 1`
		const ids: string[] = []
		for (let i = 0; i < 21; i++) {
			const iss = await anIssue(db.owner, {
				workspaceId: ws.id,
				projectId: project.id,
				statusId: statusRow[0]!.id,
				creatorId: userId,
				title: `bulk-${i}`
			})
			ids.push(iss.id)
		}
		const bulk = await rpc(
			r.app,
			'tools/call',
			{ name: 'tasks.bulk_update', arguments: { issues: ids, priority: 1 } },
			{ token, meta: CAPS_ELICIT, headers: { 'x-huriro-workspace': ws.id } }
		)
		const bulkResult = bulk.json['result'] as { structuredContent?: Record<string, unknown> } | undefined
		expect(bulkResult?.structuredContent?.['status']).toBe('approval_required')
		const approvalId = bulkResult?.structuredContent?.['approvalId'] as string
		expect(typeof approvalId).toBe('string')
		const dec2 = await rest(r.app, {
			method: 'POST',
			path: `/api/v1/approvals/${approvalId}/decide`,
			cookie: session,
			workspaceId: ws.id,
			body: { decision: 'approve' }
		})
		expect(dec2.status).toBe(200)
		const pr = await db.owner<
			{ n: number }[]
		>`SELECT count(*)::int AS n FROM issues WHERE workspace_id = ${ws.id} AND priority = 1`
		expect(pr[0]?.n).toBe(21)

		// Kill switch on BOTH surfaces.
		const off = await rest(r.app, {
			method: 'PATCH',
			path: '/api/v1/settings/agents',
			cookie: session,
			workspaceId: ws.id,
			body: { mcpEnabled: false }
		})
		expect(off.status).toBe(200)
		const mcpOff = await rpc(
			r.app,
			'tools/call',
			{ name: 'workspace.describe', arguments: {} },
			{ token, meta: CAPS_ELICIT, headers: { 'x-huriro-workspace': ws.id } }
		)
		const mcpOffErr = mcpOff.json['result'] as { isError?: boolean } | undefined
		expect(
			mcpOff.status === 403 ||
				mcpOffErr?.isError === true ||
				JSON.stringify(mcpOff.json).includes('agents_disabled')
		).toBe(true)
		const restOff = await rest(r.app, {
			method: 'POST',
			path: '/api/v1/agent/tools/workspace.describe',
			token,
			workspaceId: ws.id,
			body: {}
		})
		expect(restOff.status).toBe(403)
		expect(restOff.text).toContain('agents_disabled')
		await rest(r.app, {
			method: 'PATCH',
			path: '/api/v1/settings/agents',
			cookie: session,
			workspaceId: ws.id,
			body: { mcpEnabled: true }
		})

		// Revocation -> the still-valid token is denied on the NEXT call.
		const agents = await rest(r.app, { path: '/api/v1/agents', cookie: session, workspaceId: ws.id })
		const principal = ((agents.json['data'] as { id: string }[] | undefined) ?? [])[0]
		expect(principal).toBeTruthy()
		const rev = await rest(r.app, {
			method: 'DELETE',
			path: `/api/v1/agents/${principal!.id}`,
			cookie: session,
			workspaceId: ws.id
		})
		expect(rev.status).toBe(200)
		const afterRevoke = await rpc(
			r.app,
			'tools/call',
			{ name: 'workspace.describe', arguments: {} },
			{ token, meta: CAPS_ELICIT, headers: { 'x-huriro-workspace': ws.id } }
		)
		const afterErr = afterRevoke.json['result'] as { isError?: boolean } | undefined
		expect(
			afterRevoke.status === 403 || afterErr?.isError === true || afterRevoke.json['error'] !== undefined
		).toBe(true)

		// 2025 session-oriented initialize is rejected (legacy:'reject').
		const init = await rpc(
			r.app,
			'initialize',
			{ protocolVersion: '2025-06-18', capabilities: {}, clientInfo: { name: 'x', version: '1' } },
			{ token, headers: { 'mcp-protocol-version': '2025-06-18' } }
		)
		expect(init.status === 200 && init.json['error'] === undefined && init.json['result'] !== undefined).toBe(
			false
		)
	})
})
