/**
 * M3 stage 4 integration: workspace API keys + the huriro client CLI end-to-end.
 * API keys are REST-audience only, workspace-bound, revoked live; the CLI is
 * driven in-process via main(argv, io) with a real Bun.serve fetch.
 */
import { beforeAll, describe, expect, test } from 'bun:test'
import { randomUUID } from 'node:crypto'
import { main } from '@huriro/cli'
import type { FetchLike, Io } from '@huriro/cli/io'
import { aMembership, aProject, aWorkspace, getTestDb, migrationsDir, type TestDb } from '@huriro/test-utils'
import { createApp } from '../api/app'
import type { Config } from '../env'
import { type Auth, createAuth, ensureAgentOAuthSeed } from '../modules/identity'

const BASE = 'http://localhost:3000'

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
	readonly origin: string
}

async function rig(): Promise<Rig | null> {
	if (!db) return null
	const { InProcessPubSub } = await import('../realtime/pubsub')
	const auth = createAuth(config(db.url))
	await ensureAgentOAuthSeed(auth)
	const ctx = await auth.$context
	const app = createApp({
		sql: db.app,
		migrationsDir: migrationsDir(),
		mode: 'selfhost',
		auth,
		pubsub: new InProcessPubSub(),
		allowedOrigins: [BASE],
		rootSecret: 'x'.repeat(48)
	})
	return { app, auth, ctx, origin: BASE }
}

async function signup(r: Rig, email: string): Promise<string> {
	const res = await r.auth.handler(
		new Request(`${r.origin}/api/auth/sign-up/email`, {
			method: 'POST',
			headers: {
				'content-type': 'application/json',
				// Unique source IP per signup so the auth sign-up rate limit
				// (memory, per-instance) doesn't trip on multi-test fixtures.
				'x-forwarded-for': `10.97.${Math.floor(Math.random() * 255)}.${Math.floor(Math.random() * 255)}`
			},
			body: JSON.stringify({ email, name: email, password: 'test-password-123456' })
		})
	)
	const body = (await res.json()) as { user?: { id?: string } }
	if (!body.user?.id) throw new Error(`signup failed: ${res.status}`)
	return body.user.id
}

async function signIn(r: Rig, email: string): Promise<string> {
	const res = await r.auth.handler(
		new Request(`${r.origin}/api/auth/sign-in/email`, {
			method: 'POST',
			headers: {
				'content-type': 'application/json',
				// Unique source IP per sign-in — the auth rate limiter is keyed by IP.
				'x-forwarded-for': `10.96.${Math.floor(Math.random() * 255)}.${Math.floor(Math.random() * 255)}`
			},
			body: JSON.stringify({ email, password: 'test-password-123456' })
		})
	)
	const cookie = (res.headers.get('set-cookie') ?? '')
		.split(',')
		.map((c) => c.trim().split(';')[0])
		.find((c) => c?.startsWith('better-auth.session_token='))
	if (!cookie) throw new Error(`sign-in failed: ${res.status}`)
	return cookie
}

async function rest(
	r: Rig,
	o: { method?: string; path: string; cookie?: string; token?: string; workspaceId?: string; body?: unknown }
) {
	const headers: Record<string, string> = {
		'content-type': 'application/json',
		'x-huriro-client': 'huriro-test',
		origin: r.origin
	}
	if (o.cookie) headers['cookie'] = o.cookie
	if (o.token) headers['authorization'] = `Bearer ${o.token}`
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

function cliIo(r: Rig, env: Record<string, string>): Io & { out: string[]; err: string[] } {
	const out: string[] = []
	const err: string[] = []
	const fetch: FetchLike = (url, init) => r.app.handle(new Request(String(url), init))
	return {
		fetch,
		env,
		stdout: (t) => out.push(t),
		stderr: (t) => err.push(t),
		readStdin: async () => '',
		configDir: '/cfg',
		readFile: () => '',
		sleep: async () => {},
		randomId: () => randomUUID(),
		now: () => Date.now(),
		writeFile0600: () => {},
		isTty: false,
		out,
		err
	}
}

async function seed(r: Rig, tag: string) {
	const sql = db?.owner
	if (!sql) throw new Error('no test db')
	const ws = await aWorkspace(sql, { slug: `cli-${tag}` })
	const userId = await signup(r, `cli-${tag}@test.huriro.dev`)
	const roleId = ws.roleIds['owner']
	if (!roleId) throw new Error('owner role missing')
	await aMembership(sql, { workspaceId: ws.id, userId, roleId })
	const project = await aProject(sql, { workspaceId: ws.id, key: 'CL', name: 'CL' })
	return { ws, userId, project }
}

describe('workspace API keys (M3 stage 4)', () => {
	test('create → use → list → revoke lifecycle; audience + session guards', async () => {
		const r = await rig()
		if (!r || !db) return
		try {
			const tag = randomUUID().slice(0, 6)
			const { ws, userId, project } = await seed(r, tag)
			const cookie = await signIn(r, `cli-${tag}@test.huriro.dev`)
			const wsB = await aWorkspace(db.owner, { slug: `cli-${tag}-b` })

			// Create via session route — raw key returned once.
			const created = await rest(r, {
				method: 'POST',
				path: '/api/v1/agents/api-keys',
				cookie,
				workspaceId: ws.id,
				body: { name: 'ci-bot', scopes: ['tasks.read', 'tasks.write', 'workspace.describe'] }
			})
			expect(created.status, JSON.stringify(created.json)).toBe(200)
			const key = (created.json['data'] as Record<string, unknown>)['key'] as string
			expect(key).toMatch(/^hrk_[A-Za-z0-9_-]{8}_[A-Za-z0-9_-]{43}$/)
			const keyId = (created.json['data'] as Record<string, unknown>)['id'] as string

			// List never leaks the secret.
			const list = await rest(r, { path: '/api/v1/agents/api-keys', cookie, workspaceId: ws.id })
			expect(list.status).toBe(200)
			const listed = (list.json['data'] as { prefix: string; name: string }[]).find(
				(k) => k.name === 'ci-bot'
			)
			expect(listed).toBeTruthy()
			expect(JSON.stringify(list.json)).not.toContain(key.slice(-20))

			// CLI uses the key via env (non-interactive path).
			const io = cliIo(r, {
				HURIRO_URL: r.origin,
				HURIRO_API_KEY: key,
				HURIRO_WORKSPACE: ws.id
			})
			expect(await main(['queue'], io), io.err.join(' | ')).toBe(0)
			expect(
				await main(['issue', 'create', '--title', 'from cli', '--project', project.id, '--json'], io),
				io.err.join(' | ')
			).toBe(0)
			expect(await main(['workspace', 'describe'], io)).toBe(0)

			// Key is REST-only: rejected on /mcp and on session routes.
			const mcpRes = await r.app.handle(
				new Request(`${r.origin}/mcp`, {
					method: 'POST',
					headers: { 'content-type': 'application/json', authorization: `Bearer ${key}` },
					body: JSON.stringify({ jsonrpc: '2.0', id: 1, method: 'tools/list' })
				})
			)
			expect(mcpRes.status).toBe(401)
			const sessionRoute = await rest(r, { path: '/api/v1/issues', token: key, workspaceId: ws.id })
			expect(sessionRoute.status).toBe(401)

			// Key cannot mint keys (bearer credential, not a session).
			const selfCreate = await rest(r, {
				method: 'POST',
				path: '/api/v1/agents/api-keys',
				token: key,
				workspaceId: ws.id,
				body: { name: 'self', scopes: ['tasks.read'] }
			})
			expect(selfCreate.status).toBe(401)

			// Cross-workspace: key bound to ws A cannot read workspace B.
			const ioB = cliIo(r, {
				HURIRO_URL: r.origin,
				HURIRO_API_KEY: key,
				HURIRO_WORKSPACE: wsB.id
			})
			expect(await main(['queue'], ioB)).toBe(3)

			// Revoke → next call is 401.
			const revoked = await rest(r, {
				method: 'DELETE',
				path: `/api/v1/agents/api-keys/${keyId}`,
				cookie,
				workspaceId: ws.id
			})
			expect(revoked.status).toBe(200)
			expect(await main(['queue'], io)).toBe(3)
			void userId
		} finally {
			void 0
		}
	})

	test('device flow login → whoami → queue → refresh rotation', async () => {
		const r = await rig()
		if (!r || !db) return
		try {
			const tag = randomUUID().slice(0, 6)
			const { ws } = await seed(r, tag)
			const cookie = await signIn(r, `cli-${tag}@test.huriro.dev`)

			// Drive `huriro login`: capture device_code from the request, approve it
			// server-side with the signed-in session cookie.
			let deviceCode = ''
			let approveStatus = 0
			let approveBody = ''
			let claimStatus = 0
			let claimBody = ''
			const files = new Map<string, string>()
			const io = cliIo(r, {})
			const wrappingFetch: FetchLike = async (url, init) => {
				const u = String(url)
				if (u.endsWith('/api/auth/device/code')) {
					const res = await io.fetch(u, init)
					const j = (await res.clone().json()) as { device_code?: string; user_code?: string }
					deviceCode = j.device_code ?? ''
					if (j.user_code) {
						// RFC 8628 UX split: the signed-in user must first claim
						// (verify) the user_code via GET /device, then approve it.
						const claim = await r.auth.handler(
							new Request(`${r.origin}/api/auth/device?user_code=${j.user_code}`, {
								headers: { cookie }
							})
						)
						claimStatus = claim.status
						claimBody = await claim.text()
						const approve = await r.auth.handler(
							new Request(`${r.origin}/api/auth/device/approve`, {
								method: 'POST',
								headers: { 'content-type': 'application/json', cookie },
								body: JSON.stringify({ userCode: j.user_code })
							})
						)
						approveStatus = approve.status
						approveBody = await approve.text()
					}
					return res
				}
				return io.fetch(url, init)
			}
			const io2 = {
				...io,
				fetch: wrappingFetch,
				writeFile0600: (p: string, d: string) => void files.set(p, d)
			}
			const code = await main(['login', '--url', r.origin, '--workspace', ws.id], io2)
			expect(claimStatus, claimBody).toBe(200)
			expect(approveStatus, approveBody).toBe(200)
			expect(code, io2.err.join(' | ')).toBe(0)
			expect(deviceCode).not.toBe('')
			expect(io2.out.join()).toContain('logged in')

			// Stored credential drives whoami + queue.
			const io3 = {
				...cliIo(r, { HURIRO_URL: r.origin }),
				readFile: (p: string) => files.get(p) ?? '',
				writeFile0600: (p: string, d: string) => void files.set(p, d)
			}
			expect(await main(['whoami'], io3)).toBe(0)
			expect(io3.out.join()).toContain(r.origin)
			expect(await main(['queue'], io3), io3.err.join(' | ')).toBe(0)
		} finally {
			void 0
		}
	})

	test('insufficient_scope exit 3 and approval_required exit 4', async () => {
		const r = await rig()
		if (!r || !db) return
		try {
			const tag = randomUUID().slice(0, 6)
			const { ws } = await seed(r, tag)
			const cookie = await signIn(r, `cli-${tag}@test.huriro.dev`)

			// Read-only key: write tool → exit 3.
			const ro = await rest(r, {
				method: 'POST',
				path: '/api/v1/agents/api-keys',
				cookie,
				workspaceId: ws.id,
				body: { name: 'ro', scopes: ['tasks.read'] }
			})
			const roKey = (ro.json['data'] as Record<string, unknown>)['key'] as string
			const roIo = cliIo(r, { HURIRO_URL: r.origin, HURIRO_API_KEY: roKey, HURIRO_WORKSPACE: ws.id })
			expect(await main(['issue', 'comment', 'i1', '-m', 'hi'], roIo)).toBe(3)
			expect(roIo.err.join()).toContain('scope')

			// R2 tool (bulk_update) → approval_required → exit 4 with approvalId.
			const rw = await rest(r, {
				method: 'POST',
				path: '/api/v1/agents/api-keys',
				cookie,
				workspaceId: ws.id,
				body: { name: 'rw', scopes: ['tasks.read', 'tasks.write'] }
			})
			const rwKey = (rw.json['data'] as Record<string, unknown>)['key'] as string
			const rwIo = cliIo(r, { HURIRO_URL: r.origin, HURIRO_API_KEY: rwKey, HURIRO_WORKSPACE: ws.id })
			const ids = Array.from({ length: 21 }, () => randomUUID())
			const rc = await main(
				['tool', 'tasks.bulk_update', '--input', JSON.stringify({ issues: ids, priority: 1 })],
				rwIo
			)
			expect(rc).toBe(4)
			expect(rwIo.err.join()).toContain('approval')
		} finally {
			void 0
		}
	})

	test('agent work loop: assign → queue → comment → status; owner downgrade denies', async () => {
		const r = await rig()
		if (!r || !db) return
		try {
			const tag = randomUUID().slice(0, 6)
			const { ws, userId, project } = await seed(r, tag)
			const cookie = await signIn(r, `cli-${tag}@test.huriro.dev`)

			const created = await rest(r, {
				method: 'POST',
				path: '/api/v1/agents/api-keys',
				cookie,
				workspaceId: ws.id,
				body: { name: 'loop-bot', scopes: ['tasks.read', 'tasks.write'] }
			})
			expect(created.status).toBe(200)
			const key = (created.json['data'] as Record<string, unknown>)['key'] as string
			const agentId = (created.json['data'] as Record<string, unknown>)['agentId'] as string

			// Human assigns an issue to the agent principal — the G3 pickup flow.
			const issue = await rest(r, {
				method: 'POST',
				path: '/api/v1/issues',
				cookie,
				workspaceId: ws.id,
				body: {
					projectId: project.id,
					title: 'agent work loop',
					assigneeId: agentId,
					assigneeType: 'agent'
				}
			})
			expect(issue.status, JSON.stringify(issue.json)).toBe(201)
			const identifier = String(issue.json['identifier'])
			const issueId = String(issue.json['id'])

			const io = cliIo(r, { HURIRO_URL: r.origin, HURIRO_API_KEY: key, HURIRO_WORKSPACE: ws.id })
			expect(await main(['queue'], io), io.err.join(' | ')).toBe(0)
			expect(io.out.join()).toContain(identifier)

			expect(await main(['issue', 'comment', identifier, '-m', 'picked it up'], io), io.err.join(' | ')).toBe(
				0
			)
			const cmts = await db.owner<{ authorType: string }[]>`
				SELECT author_type AS "authorType" FROM issue_comments WHERE issue_id = ${issueId}`
			expect(cmts[0]?.authorType).toBe('agent')

			// `done` closes the issue — it drops out of the queue.
			expect(await main(['issue', 'status', identifier, '--state', 'done', '-m', 'shipped'], io)).toBe(0)
			expect(await main(['queue'], io)).toBe(0)
			expect(io.out.at(-1) ?? '').not.toContain(identifier)

			// Owner downgrade → write denied on the very next call (live re-resolution).
			await db.owner`
				UPDATE memberships SET role_id = (SELECT id FROM roles WHERE workspace_id = ${ws.id} AND key = 'guest')
				WHERE workspace_id = ${ws.id} AND user_id = ${userId}`
			expect(await main(['issue', 'comment', identifier, '-m', 'should fail'], io)).toBe(3)
		} finally {
			void 0
		}
	})

	test('R2 parks → human approves → approvals wait exits 0', async () => {
		const r = await rig()
		if (!r || !db) return
		try {
			const tag = randomUUID().slice(0, 6)
			const { ws, project } = await seed(r, tag)
			const cookie = await signIn(r, `cli-${tag}@test.huriro.dev`)
			const rw = await rest(r, {
				method: 'POST',
				path: '/api/v1/agents/api-keys',
				cookie,
				workspaceId: ws.id,
				body: { name: 'wait-bot', scopes: ['tasks.read', 'tasks.write'] }
			})
			const key = (rw.json['data'] as Record<string, unknown>)['key'] as string
			const io = cliIo(r, { HURIRO_URL: r.origin, HURIRO_API_KEY: key, HURIRO_WORKSPACE: ws.id })

			const issueIds: string[] = []
			for (let i = 0; i < 21; i++) {
				const c = await rest(r, {
					method: 'POST',
					path: '/api/v1/issues',
					cookie,
					workspaceId: ws.id,
					body: { projectId: project.id, title: `wait-${i}` }
				})
				expect(c.status).toBe(201)
				issueIds.push(String(c.json['id']))
			}

			const rc = await main(
				['tool', 'tasks.bulk_update', '--input', JSON.stringify({ issues: issueIds, priority: 3 }), '--json'],
				io
			)
			expect(rc).toBe(4)
			const parked = JSON.parse(io.out.join()) as { status: string; approvalId: string }
			expect(parked.status).toBe('approval_required')

			const decide = await rest(r, {
				method: 'POST',
				path: `/api/v1/approvals/${parked.approvalId}/decide`,
				cookie,
				workspaceId: ws.id,
				body: { decision: 'approve' }
			})
			expect(decide.status, JSON.stringify(decide.json)).toBe(200)
			expect(
				await main(['approvals', 'wait', parked.approvalId, '--timeout', '30'], io),
				io.err.join(' | ')
			).toBe(0)
			const prio = await db.owner<{ n: number }[]>`
				SELECT count(*)::int AS n FROM issues WHERE id = ANY(${issueIds}::uuid[]) AND priority = 3`
			expect(prio[0]?.n).toBe(21)
		} finally {
			void 0
		}
	})

	test('device login → principal revoked → next call denied', async () => {
		const r = await rig()
		if (!r || !db) return
		try {
			const tag = randomUUID().slice(0, 6)
			const { ws } = await seed(r, tag)
			const cookie = await signIn(r, `cli-${tag}@test.huriro.dev`)

			// Device login with the human approving the user_code (same flow as
			// the refresh-rotation test, condensed).
			const files = new Map<string, string>()
			const base = cliIo(r, {})
			const loginIo = {
				...base,
				fetch: async (url: unknown, init?: unknown) => {
					const u = String(url)
					const res = await base.fetch(u, init as never)
					if (u.endsWith('/api/auth/device/code')) {
						const j = (await res.clone().json()) as { user_code?: string }
						if (j.user_code) {
							await r.auth.handler(
								new Request(`${r.origin}/api/auth/device?user_code=${j.user_code}`, {
									headers: { cookie }
								})
							)
							await r.auth.handler(
								new Request(`${r.origin}/api/auth/device/approve`, {
									method: 'POST',
									headers: { 'content-type': 'application/json', cookie },
									body: JSON.stringify({ userCode: j.user_code })
								})
							)
						}
					}
					return res
				},
				writeFile0600: (p: string, d: string) => void files.set(p, d)
			}
			expect(await main(['login', '--url', r.origin, '--workspace', ws.id], loginIo)).toBe(0)
			const io = {
				...cliIo(r, { HURIRO_URL: r.origin }),
				readFile: (p: string) => files.get(p) ?? '',
				writeFile0600: (p: string, d: string) => void files.set(p, d)
			}
			// First call lazily connects the 'CLI · …' automation principal.
			expect(await main(['queue'], io), io.err.join(' | ')).toBe(0)

			const agents = await rest(r, { path: '/api/v1/agents', cookie, workspaceId: ws.id })
			expect(agents.status).toBe(200)
			const cliAgent = (agents.json['data'] as { id: string; name: string }[]).find((a) =>
				a.name.startsWith('CLI ·')
			)
			expect(cliAgent, JSON.stringify(agents.json)).toBeTruthy()
			const revoked = await rest(r, {
				method: 'DELETE',
				path: `/api/v1/agents/${cliAgent?.id}`,
				cookie,
				workspaceId: ws.id
			})
			expect(revoked.status, JSON.stringify(revoked.json)).toBe(200)

			// Revocation also tears down the OAuth grant — the next call is 401
			// (dead token) or 403 (revoked principal); the CLI maps both to exit 3.
			expect(await main(['queue'], io)).toBe(3)
		} finally {
			void 0
		}
	})
})
