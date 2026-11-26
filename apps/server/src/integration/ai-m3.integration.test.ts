/**
 * M3 AI gateway integration (§11.3–§11.4): settings + BYO provider config,
 * the outbox embedding pipeline, semantic search v1 with SQL-level ACL,
 * thread/doc summaries with metering + cache — all behind the per-workspace
 * `ai_enabled` flag (off by default). The provider is a fake OpenAI-compatible
 * endpoint injected through egressFetch/egressResolver.
 */
import { beforeAll, describe, expect, test } from 'bun:test'
import { randomUUID } from 'node:crypto'
import type { Sql } from '@huriro/db'
import { aMembership, aProject, aWorkspace, getTestDb, migrationsDir, type TestDb } from '@huriro/test-utils'
import { createApp } from '../api/app'
import type { Config } from '../env'
import { type Auth, createAuth, ensureAgentOAuthSeed } from '../modules/identity'
import { InProcessPubSub } from '../realtime/pubsub'
import { drainOutboxOnce } from '../worker'

const BASE = 'http://localhost:3000'
const ROOT_SECRET = 'r'.repeat(48)

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

/** 768-dim unit-ish vector biased by whether the text mentions `keyword`. */
function fakeEmbedding(text: string, keyword: string): number[] {
	const v = new Array<number>(768).fill(0)
	v[0] = text.toLowerCase().includes(keyword) ? 1 : 0
	v[1] = text.toLowerCase().includes(keyword) ? 0 : 1
	return v
}

/** Deterministic fake provider — records every request for assertions. */
function fakeProvider(calls: string[]): typeof fetch {
	return (async (input: RequestInfo | URL, init?: RequestInit) => {
		const url = String(input)
		const body = typeof init?.body === 'string' ? init.body : ''
		calls.push(`${init?.method ?? 'GET'} ${url}`)
		if (url.endsWith('/v1/embeddings')) {
			const parsed = JSON.parse(body) as { input: string[] }
			return new Response(
				JSON.stringify({ data: parsed.input.map((t) => ({ embedding: fakeEmbedding(t, 'kerberos') })) })
			)
		}
		if (url.endsWith('/v1/chat/completions')) {
			if (body.includes('Available workspace tags:')) {
				return new Response(
					JSON.stringify({
						choices: [{ message: { content: 'billing, vip — matches invoice inquiry' } }],
						usage: { prompt_tokens: 12, completion_tokens: 8 }
					})
				)
			}
			if (body.includes('Draft a helpful, polite plain-text email reply')) {
				return new Response(
					JSON.stringify({
						choices: [
							{
								message: {
									content: 'Hi there, we reviewed your billing inquiry and are following up.'
								}
							}
						],
						usage: { prompt_tokens: 15, completion_tokens: 12 }
					})
				)
			}
			return new Response(
				JSON.stringify({
					choices: [{ message: { content: '- concise summary bullet' } }],
					usage: { prompt_tokens: 11, completion_tokens: 5 }
				})
			)
		}
		return new Response('not found', { status: 404 })
	}) as typeof fetch
}

// Resolver: the fake host maps to a public IP so strict egress passes.
const fakeResolver = async () => [{ address: '93.184.216.34', family: 4 }]

interface Rig {
	readonly app: ReturnType<typeof createApp>
	readonly auth: Auth
	readonly origin: string
	readonly calls: string[]
}

async function rig(): Promise<Rig | null> {
	if (!db) return null
	const auth = createAuth(config(db.url))
	await ensureAgentOAuthSeed(auth)
	const calls: string[] = []
	const app = createApp({
		sql: db.app,
		migrationsDir: migrationsDir(),
		mode: 'selfhost',
		auth,
		pubsub: new InProcessPubSub(),
		allowedOrigins: [BASE],
		rootSecret: ROOT_SECRET,
		egressFetch: fakeProvider(calls),
		egressResolver: fakeResolver
	})
	return { app, auth, origin: BASE, calls }
}

async function signup(r: Rig, email: string): Promise<{ userId: string; cookie: string }> {
	const res = await r.auth.handler(
		new Request(`${BASE}/api/auth/sign-up/email`, {
			method: 'POST',
			headers: {
				'content-type': 'application/json',
				'x-forwarded-for': `10.95.${Math.floor(Math.random() * 255)}.${Math.floor(Math.random() * 255)}`
			},
			body: JSON.stringify({ email, name: email, password: 'test-password-123456' })
		})
	)
	const cookie = (res.headers.get('set-cookie') ?? '')
		.split(',')
		.map((c) => c.trim().split(';')[0])
		.find((c) => c?.startsWith('better-auth.session_token='))
	const body = (await res.json()) as { user?: { id?: string } }
	if (!cookie || !body.user?.id) throw new Error(`signup failed: ${res.status}`)
	return { userId: body.user.id, cookie }
}

async function req(
	r: Rig,
	o: { method?: string; path: string; cookie: string; workspaceId?: string; body?: unknown }
) {
	const headers: Record<string, string> = {
		'content-type': 'application/json',
		'x-huriro-client': 'huriro-test',
		origin: r.origin,
		cookie: o.cookie
	}
	if (o.workspaceId) headers['x-workspace-id'] = o.workspaceId
	const res = await r.app.handle(
		new Request(`${r.origin}${o.path}`, {
			method: o.method ?? 'GET',
			headers,
			...(o.body !== undefined ? { body: JSON.stringify(o.body) } : {})
		})
	)
	const json = (await res.json().catch(() => ({}))) as Record<string, unknown>
	return { status: res.status, json }
}

async function seed(r: Rig, tag: string) {
	const sql = db?.owner as Sql
	const ws = await aWorkspace(sql, { slug: `ai-${tag}` })
	const { userId, cookie } = await signup(r, `ai-${tag}@test.huriro.dev`)
	const roleId = ws.roleIds['owner']
	if (!roleId) throw new Error('owner role missing')
	await aMembership(sql, { workspaceId: ws.id, userId, roleId })
	const project = await aProject(sql, { workspaceId: ws.id, key: 'AI', name: 'AI' })
	return { ws, userId, cookie, project }
}

describe('AI gateway (M3 §11)', () => {
	test('flags off by default → ai_disabled; settings + provider config; key write-only', async () => {
		const r = await rig()
		if (!r || !db) return
		const tag = randomUUID().slice(0, 6)
		const { ws, cookie } = await seed(r, tag)

		// Off by default — summarize/search return ai_disabled.
		const off = await req(r, {
			method: 'GET',
			path: '/api/v1/ai/search?q=kerberos',
			cookie,
			workspaceId: ws.id
		})
		expect(off.status).toBe(403)
		expect(off.json['code']).toBe('ai_disabled')

		// Enable + configure a provider (BYO key — never returned again).
		expect(
			(
				await req(r, {
					method: 'PATCH',
					path: '/api/v1/ai/settings',
					cookie,
					workspaceId: ws.id,
					body: { aiEnabled: true }
				})
			).status
		).toBe(200)
		const prov = await req(r, {
			method: 'PUT',
			path: '/api/v1/ai/providers',
			cookie,
			workspaceId: ws.id,
			body: {
				kind: 'openai_compatible',
				name: 'byo',
				baseUrl: 'https://ai.example.test',
				apiKey: 'sk-secret-test-key-12345',
				chatModel: 'gpt-test',
				embeddingModel: 'nomic-embed-text'
			}
		})
		expect(prov.status, JSON.stringify(prov.json)).toBe(200)
		expect(prov.json['hasApiKey']).toBe(true)
		expect(JSON.stringify(prov.json)).not.toContain('sk-secret')

		// Unknown embedding model is rejected at config time.
		const bad = await req(r, {
			method: 'PUT',
			path: '/api/v1/ai/providers',
			cookie,
			workspaceId: ws.id,
			body: {
				kind: 'openai_compatible',
				name: 'bad',
				baseUrl: 'https://ai.example.test',
				embeddingModel: 'nope-9000'
			}
		})
		expect(bad.status).toBe(422)
	})

	test('outbox embeds issue chunks; semantic search finds by meaning; ACL + tenant isolation hold', async () => {
		const r = await rig()
		if (!r || !db) return
		const tag = randomUUID().slice(0, 6)
		const { ws, cookie, project } = await seed(r, tag)

		await req(r, {
			method: 'PATCH',
			path: '/api/v1/ai/settings',
			cookie,
			workspaceId: ws.id,
			body: { aiEnabled: true }
		})
		const prov = await req(r, {
			method: 'PUT',
			path: '/api/v1/ai/providers',
			cookie,
			workspaceId: ws.id,
			body: {
				kind: 'openai_compatible',
				name: 'byo',
				baseUrl: 'https://ai.example.test',
				embeddingModel: 'nomic-embed-text'
			}
		})
		expect(prov.status).toBe(200)

		const issue = await req(r, {
			method: 'POST',
			path: '/api/v1/issues',
			cookie,
			workspaceId: ws.id,
			body: {
				projectId: project.id,
				title: `kerberos sso login ${tag}`,
				descriptionText: 'single sign-on via kerberos tickets'
			}
		})
		expect(issue.status).toBe(201)
		const issueId = String(issue.json['id'])

		// Drain: search document indexed + chunks embedded.
		const drained = await drainOutboxOnce(db.app, new InProcessPubSub(), {
			onlyWorkspaceId: ws.id,
			rootSecret: ROOT_SECRET,
			egressFetch: fakeProvider(r.calls),
			egressResolver: fakeResolver
		})
		expect(drained).toBeGreaterThanOrEqual(1)
		const chunks = await db.owner<{ n: number }[]>`
			SELECT count(*)::int AS n FROM chunk_embeddings
			WHERE workspace_id = ${ws.id} AND entity_id = ${issueId}::uuid`
		expect(chunks[0]?.n).toBeGreaterThanOrEqual(1)

		// Semantic search finds it by meaning ("ticket sso"), not keyword.
		const search = await req(r, {
			method: 'GET',
			path: '/api/v1/ai/search?q=ticket sso',
			cookie,
			workspaceId: ws.id
		})
		expect(search.status, JSON.stringify(search.json)).toBe(200)
		const hits = (search.json['hits'] ?? []) as { entityId: string }[]
		expect(hits.map((h) => h.entityId)).toContain(issueId)

		// A second workspace with AI off sees only ai_disabled — flag isolation
		// is also tenant isolation for the AI surface.
		const other = await aWorkspace(db.owner, { slug: `ai-${tag}-b` })
		const { userId: userB, cookie: cookieB } = await signup(r, `ai-${tag}-b@test.huriro.dev`)
		const roleB = other.roleIds['owner']
		if (!roleB) throw new Error('role missing')
		await aMembership(db.owner, { workspaceId: other.id, userId: userB, roleId: roleB })
		const searchB = await req(r, {
			method: 'GET',
			path: '/api/v1/ai/search?q=ticket sso',
			cookie: cookieB,
			workspaceId: other.id
		})
		// AI is off in workspace B → ai_disabled (flag isolation is also tenant isolation).
		expect(searchB.status).toBe(403)
	})

	test('summarize: prompt → provider → DTO; metering rows; repeat call is cached', async () => {
		const r = await rig()
		if (!r || !db) return
		const tag = randomUUID().slice(0, 6)
		const { ws, cookie, project, userId } = await seed(r, tag)

		await req(r, {
			method: 'PATCH',
			path: '/api/v1/ai/settings',
			cookie,
			workspaceId: ws.id,
			body: { aiEnabled: true, aiTracePrompts: true }
		})
		await req(r, {
			method: 'PUT',
			path: '/api/v1/ai/providers',
			cookie,
			workspaceId: ws.id,
			body: {
				kind: 'openai_compatible',
				name: 'byo',
				baseUrl: 'https://ai.example.test',
				chatModel: 'gpt-test'
			}
		})
		const issue = await req(r, {
			method: 'POST',
			path: '/api/v1/issues',
			cookie,
			workspaceId: ws.id,
			body: { projectId: project.id, title: `summarize me ${tag}`, descriptionText: 'body' }
		})
		const issueId = String(issue.json['id'])
		const chatCallsBefore = r.calls.filter((c) => c.includes('chat/completions')).length

		const sum = await req(r, {
			method: 'POST',
			path: '/api/v1/ai/summarize',
			cookie,
			workspaceId: ws.id,
			body: { entityType: 'issue', entityId: issueId }
		})
		expect(sum.status, JSON.stringify(sum.json)).toBe(200)
		expect(String(sum.json['summary'])).toContain('summary bullet')
		expect(sum.json['cached']).toBe(false)
		expect(r.calls.filter((c) => c.includes('chat/completions')).length).toBe(chatCallsBefore + 1)

		// ai_runs metering row: model, tokens, outcome=ok, trace captured (opt-in).
		const runs = await db.owner<
			{ runType: string; outcome: string; model: string; tokensIn: number; traced: boolean }[]
		>`
			SELECT run_type AS "runType", outcome, model, tokens_in AS "tokensIn",
				(prompt_trace IS NOT NULL) AS traced
			FROM ai_runs
			WHERE workspace_id = ${ws.id} AND run_type = 'summary' AND user_id = ${userId}
		`
		expect(runs.length).toBe(1)
		expect(runs[0]?.outcome).toBe('ok')
		expect(runs[0]?.model).toBe('gpt-test')
		expect(runs[0]?.traced).toBe(true)

		// Repeat identical summary → exact cache hit, no second provider call.
		const sum2 = await req(r, {
			method: 'POST',
			path: '/api/v1/ai/summarize',
			cookie,
			workspaceId: ws.id,
			body: { entityType: 'issue', entityId: issueId }
		})
		expect(sum2.json['cached']).toBe(true)
		expect(r.calls.filter((c) => c.includes('chat/completions')).length).toBe(chatCallsBefore + 1)
	})

	test('deny paths: member cannot manage providers; guest cannot use AI', async () => {
		const r = await rig()
		if (!r || !db) return
		const tag = randomUUID().slice(0, 6)
		const { ws } = await seed(r, tag)

		// Member (not admin) — ai.use yes, ai.manage no.
		const { userId: memberId, cookie: memberCookie } = await signup(r, `ai-m-${tag}@test.huriro.dev`)
		const memberRole = ws.roleIds['member']
		if (!memberRole) throw new Error('member role missing')
		await aMembership(db.owner, { workspaceId: ws.id, userId: memberId, roleId: memberRole })
		const denied = await req(r, {
			method: 'PATCH',
			path: '/api/v1/ai/settings',
			cookie: memberCookie,
			workspaceId: ws.id,
			body: { aiEnabled: true }
		})
		expect(denied.status).toBe(403)
		expect(denied.json['code']).toBe('insufficient_role')
		const settingsRead = await req(r, {
			method: 'GET',
			path: '/api/v1/ai/settings',
			cookie: memberCookie,
			workspaceId: ws.id
		})
		expect(settingsRead.status).toBe(403)

		// Guest — no ai.use at all (including mail AI endpoints).
		const { userId: guestId, cookie: guestCookie } = await signup(r, `ai-g-${tag}@test.huriro.dev`)
		const guestRole = ws.roleIds['guest']
		if (!guestRole) throw new Error('guest role missing')
		await aMembership(db.owner, { workspaceId: ws.id, userId: guestId, roleId: guestRole })
		const guestSearch = await req(r, {
			method: 'GET',
			path: '/api/v1/ai/search?q=x',
			cookie: guestCookie,
			workspaceId: ws.id
		})
		expect(guestSearch.status).toBe(403)
		const guestMailAssist = await req(r, {
			method: 'POST',
			path: '/api/v1/ai/mail/assist',
			cookie: guestCookie,
			workspaceId: ws.id,
			body: { conversationId: randomUUID(), mode: 'summarize' }
		})
		expect(guestMailAssist.status).toBe(403)
	})

	test('mail AI: summarize mail_conversation and guarded /ai/mail/assist modes', async () => {
		const r = await rig()
		if (!r || !db) return
		const tag = randomUUID().slice(0, 6)
		const { ws, cookie } = await seed(r, tag)

		await req(r, {
			method: 'PATCH',
			path: '/api/v1/ai/settings',
			cookie,
			workspaceId: ws.id,
			body: { aiEnabled: true, aiTracePrompts: true }
		})
		await req(r, {
			method: 'PUT',
			path: '/api/v1/ai/providers',
			cookie,
			workspaceId: ws.id,
			body: {
				kind: 'openai_compatible',
				name: 'byo',
				baseUrl: 'https://ai.example.test',
				chatModel: 'gpt-test'
			}
		})

		const acct = await req(r, {
			method: 'POST',
			path: '/api/v1/mail/accounts',
			cookie,
			workspaceId: ws.id,
			body: { provider: 'inbound_parse', address: `support-${tag}@test.huriro.dev`, displayName: 'Support' }
		})
		expect(acct.status).toBe(201)
		const accountId = String(acct.json['id'])

		const identity = await req(r, {
			method: 'POST',
			path: '/api/v1/mail/identities',
			cookie,
			workspaceId: ws.id,
			body: {
				accountId,
				address: `support-${tag}@test.huriro.dev`,
				displayName: 'Support',
				isDefault: true
			}
		})
		expect(identity.status).toBe(201)
		const identityId = String(identity.json['id'])

		const inbox = await req(r, {
			method: 'POST',
			path: '/api/v1/mail/inboxes',
			cookie,
			workspaceId: ws.id,
			body: { name: 'Support' }
		})
		expect(inbox.status).toBe(201)
		const inboxId = String(inbox.json['id'])

		const billingTag = await req(r, {
			method: 'POST',
			path: '/api/v1/mail/tags',
			cookie,
			workspaceId: ws.id,
			body: { inboxId, name: 'billing', color: 'blue' }
		})
		expect(billingTag.status).toBe(201)

		const outbound = await req(r, {
			method: 'POST',
			path: '/api/v1/mail/outbound',
			cookie,
			workspaceId: ws.id,
			body: {
				inboxId,
				identityId,
				subject: `Invoice billing question ${tag}`,
				recipients: { to: [{ email: 'customer@acme.example', name: 'Customer' }] },
				bodyText: 'Following up on your invoice question.'
			}
		})
		expect(outbound.status).toBe(201)
		const convId = String(outbound.json['conversationId'])

		// Generic /ai/summarize works for mail_conversation and caches repeat requests.
		const mailSum1 = await req(r, {
			method: 'POST',
			path: '/api/v1/ai/summarize',
			cookie,
			workspaceId: ws.id,
			body: { entityType: 'mail_conversation', entityId: convId }
		})
		expect(mailSum1.status, JSON.stringify(mailSum1.json)).toBe(200)
		expect(String(mailSum1.json['summary'])).toContain('summary bullet')
		expect(mailSum1.json['cached']).toBe(false)

		const mailSum2 = await req(r, {
			method: 'POST',
			path: '/api/v1/ai/summarize',
			cookie,
			workspaceId: ws.id,
			body: { entityType: 'mail_conversation', entityId: convId }
		})
		expect(mailSum2.status).toBe(200)
		expect(mailSum2.json['cached']).toBe(true)

		// /ai/mail/assist supports summarize, suggest_reply, and suggest_tags without auto-sending.
		const assistSummary = await req(r, {
			method: 'POST',
			path: '/api/v1/ai/mail/assist',
			cookie,
			workspaceId: ws.id,
			body: { conversationId: convId, mode: 'summarize' }
		})
		expect(assistSummary.status, JSON.stringify(assistSummary.json)).toBe(200)
		expect(assistSummary.json['mode']).toBe('summarize')
		expect(String(assistSummary.json['text'])).toContain('summary bullet')

		const assistReply = await req(r, {
			method: 'POST',
			path: '/api/v1/ai/mail/assist',
			cookie,
			workspaceId: ws.id,
			body: { conversationId: convId, mode: 'suggest_reply', instruction: 'Keep it friendly' }
		})
		expect(assistReply.status, JSON.stringify(assistReply.json)).toBe(200)
		expect(assistReply.json['mode']).toBe('suggest_reply')
		expect(String(assistReply.json['text'])).toContain('reviewed your billing inquiry')

		const assistTags = await req(r, {
			method: 'POST',
			path: '/api/v1/ai/mail/assist',
			cookie,
			workspaceId: ws.id,
			body: { conversationId: convId, mode: 'suggest_tags' }
		})
		expect(assistTags.status, JSON.stringify(assistTags.json)).toBe(200)
		expect(assistTags.json['mode']).toBe('suggest_tags')
		expect(assistTags.json['suggestedTags'] as string[]).toContain('billing')

		// Guardrail: AI assistance never sends messages or mutates draft status automatically.
		const timeline = await req(r, {
			method: 'GET',
			path: `/api/v1/mail/conversations/${convId}/timeline`,
			cookie,
			workspaceId: ws.id
		})
		expect(timeline.status).toBe(200)
		expect((timeline.json['messages'] as unknown[]).length).toBe(0)
		const drafts = timeline.json['drafts'] as Record<string, unknown>[]
		expect(drafts.length).toBe(1)
		expect(drafts[0]?.['status']).toBe('draft')
	})
})
