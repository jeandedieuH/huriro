/**
 * M3 stage-2 integration suite — agent REST surface + dispatcher + approvals.
 *
 * Real better-auth instance over a migrated Testcontainers DB (same minting
 * path as agent-bearer.integration.test.ts). Covers: attribution, per-call
 * revocation checks, deny matrix, R2 approval lifecycle, undo, idempotent
 * replay, and the audience/credential separation on the new surface.
 */
import { beforeAll, describe, expect, test } from 'bun:test'
import { randomUUID } from 'node:crypto'
import { getOAuthProviderApi } from '@better-auth/oauth-provider'
import { aMembership, aProject, aWorkspace, getTestDb, migrationsDir, type TestDb } from '@huriro/test-utils'
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
	readonly pubsub: InProcessPubSub
	readonly auth: Auth
	readonly ctx: Awaited<Auth['$context']>
}

async function rig(): Promise<Rig | null> {
	if (!db) return null
	const { InProcessPubSub } = await import('../realtime/pubsub')
	const auth = createAuth(config(db.url))
	await ensureAgentOAuthSeed(auth)
	const ctx = await auth.$context
	const pubsub = new InProcessPubSub()
	const app = createApp({
		sql: db.app,
		migrationsDir: migrationsDir(),
		mode: 'selfhost',
		auth,
		pubsub,
		allowedOrigins: [BASE],
		rootSecret: 'x'.repeat(48)
	})
	return { app, pubsub, auth, ctx }
}

async function mintToken(
	r: Rig,
	opts: { userId: string; scopes: string[]; clientId?: string }
): Promise<string> {
	const provider = (r.auth.options.plugins ?? []).find(
		(p) => (p as { id: string }).id === 'oauth-provider'
	) as { options: unknown }
	const adapter = r.ctx.adapter as unknown as {
		findOne<T>(a: { model: string; where: { field: string; value: string }[] }): Promise<T>
	}
	const client = await adapter.findOne({
		model: 'oauthClient',
		where: [{ field: 'clientId', value: opts.clientId ?? HURIRO_CLI_CLIENT_ID }]
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
		resources: [agentAudienceUris(BASE).rest]
	})
	return issued.access_token
}

/** Cookie session via real better-auth sign-up (writes public.users too). */
async function signup(r: Rig, email: string): Promise<{ userId: string; cookie: string }> {
	// Go through the HTTP handler so we capture the *signed* session cookie —
	// the api return token is not the cookie value better-auth verifies.
	const res = await r.auth.handler(
		new Request(`${BASE}/api/auth/sign-up/email`, {
			method: 'POST',
			// Unique source IP per signup so the auth sign-up rate limit (memory,
			// per-instance) doesn't trip on multi-user fixtures.
			headers: {
				'content-type': 'application/json',
				'x-forwarded-for': `10.99.${Math.floor(Math.random() * 255)}.${Math.floor(Math.random() * 255)}`
			},
			body: JSON.stringify({ email, name: email, password: 'test-password-123456' })
		})
	)
	const setCookie = res.headers.get('set-cookie') ?? ''
	const sessionPair = setCookie
		.split(',')
		.map((c) => c.trim().split(';')[0])
		.find((c) => c?.startsWith('better-auth.session_token='))
	const body = (await res.json()) as { user?: { id?: string } }
	if (!sessionPair || !body.user?.id) throw new Error(`signup failed: ${res.status}`)
	return { userId: body.user.id, cookie: sessionPair }
}

interface ReqOpts {
	readonly method?: string
	readonly path: string
	readonly workspaceId?: string
	readonly cookie?: string
	readonly token?: string
	readonly body?: unknown
	readonly headers?: Record<string, string>
}

async function req(app: Rig['app'], o: ReqOpts) {
	const headers: Record<string, string> = {
		'x-huriro-client': 'huriro-test',
		'content-type': 'application/json',
		origin: BASE,
		...o.headers
	}
	if (o.workspaceId) headers['x-workspace-id'] = o.workspaceId
	if (o.cookie) headers['cookie'] = o.cookie
	if (o.token) headers['authorization'] = `Bearer ${o.token}`
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
	return { status: res.status, json, res }
}

const toolCall = (app: Rig['app'], o: Omit<ReqOpts, 'method' | 'path'>, tool: string) =>
	req(app, { ...o, method: 'POST', path: `/api/v1/agent/tools/${tool}` })

// Per-process suffix keeps slugs/emails unique when the shared test DB is reused.
const RUN = Date.now().toString(36)

async function seedOwner(r: Rig, tag: string) {
	const sql = db?.owner
	if (!sql) throw new Error('no test db')
	const ws = await aWorkspace(sql, { slug: `m3-${tag}-${RUN}` })
	const u = await signup(r, `m3-${tag}-${RUN}@test.huriro.dev`)
	const roleId = ws.roleIds['owner']
	if (!roleId) throw new Error('owner role missing')
	await aMembership(sql, { workspaceId: ws.id, userId: u.userId, roleId })
	const project = await aProject(sql, { workspaceId: ws.id, key: 'M3', name: 'M3' })
	return { ws, ...u, project }
}

describe('M3 stage 2 — agent tools + approvals', () => {
	test('happy path: my_queue, agent-attributed comment/create, status, undo', async () => {
		const r = await rig()
		if (!r || !db) return
		const { ws, userId, cookie, project } = await seedOwner(r, randomUUID().slice(0, 6))
		const token = await mintToken(r, { userId, scopes: ['tasks.read', 'tasks.write'] })

		// First call lazily creates the huriro-cli automation principal.
		const describeRes = await toolCall(r.app, { token, workspaceId: ws.id, body: {} }, 'workspace.describe')
		expect(describeRes.status).toBe(200)
		const principalId = (describeRes.json['data'] as { agent: { principalId: string } }).agent.principalId

		// Unknown-body validation happens before dispatch (additionalProperties).
		const badShape = await toolCall(
			r.app,
			{ token, workspaceId: ws.id, body: { projectId: project.id, title: 'x', bogus: 1 } },
			'tasks.create'
		)
		expect([400, 422]).toContain(badShape.status)

		// Create an issue assigned to the agent principal, then it appears in my_queue.
		const created = await toolCall(
			r.app,
			{
				token,
				workspaceId: ws.id,
				headers: { 'idempotency-key': randomUUID() },
				body: {
					projectId: project.id,
					title: 'agent-created',
					assigneeId: principalId,
					assigneeType: 'agent'
				}
			},
			'tasks.create'
		)
		expect(created.status).toBe(200)
		const createdData = (created.json['data'] as { issue: { id: string } }).issue
		expect(created.json['undoId']).toBeTruthy()

		// Attribution: audit row + tool-call row recorded as the agent.
		const audits = await db.owner<{ actorType: string; actorId: string }[]>`
			SELECT actor_type AS "actorType", actor_id AS "actorId" FROM audit_log
			WHERE workspace_id = ${ws.id} ORDER BY created_at DESC LIMIT 1
		`
		expect(audits[0]?.actorType).toBe('agent')
		expect(audits[0]?.actorId).toBe(principalId)
		const calls = await db.owner<{ status: string; agentId: string }[]>`
			SELECT status, agent_id AS "agentId" FROM agent_tool_calls WHERE workspace_id = ${ws.id}
		`
		expect(calls.some((c) => c.status === 'ok' && c.agentId === principalId)).toBe(true)

		const queue = await toolCall(r.app, { token, workspaceId: ws.id, body: {} }, 'tasks.my_queue')
		expect(queue.status).toBe(200)
		const q = queue.json['data'] as { data: { id: string }[] }
		expect(q.data.map((i) => i.id)).toContain(createdData.id)

		// Comment: author_type must be 'agent'.
		const comment = await toolCall(
			r.app,
			{ token, workspaceId: ws.id, body: { issue: createdData.id, body: 'agent says hi' } },
			'tasks.comment'
		)
		expect(comment.status).toBe(200)
		const cmts = await db.owner<{ authorType: string; authorId: string }[]>`
			SELECT author_type AS "authorType", author_id AS "authorId" FROM issue_comments
			WHERE issue_id = ${createdData.id}
		`
		expect(cmts[0]?.authorType).toBe('agent')
		expect(cmts[0]?.authorId).toBe(principalId)

		const report = await toolCall(
			r.app,
			{ token, workspaceId: ws.id, body: { issue: createdData.id, state: 'working', message: 'on it' } },
			'tasks.report_status'
		)
		expect(report.status).toBe(200)
		const reports = await db.owner<{ n: number }[]>`
			SELECT count(*)::int AS n FROM agent_status_reports WHERE agent_id = ${principalId}
		`
		expect(reports[0]?.n).toBe(1)

		// Undo the create within the window (human, session).
		const undoRes = await req(r.app, {
			method: 'POST',
			path: `/api/v1/agents/activity/${String(created.json['undoId'])}/undo`,
			workspaceId: ws.id,
			cookie
		})
		expect(undoRes.status).toBe(200)
		const gone = await db.owner<{ deleted: string | null }[]>`
			SELECT deleted_at AS deleted FROM issues WHERE id = ${createdData.id}
		`
		expect(gone[0]?.deleted).not.toBeNull()
	})

	test('deny matrix: scope, ceiling, owner state, revocation, tenants, credentials', async () => {
		const r = await rig()
		if (!r || !db) return
		const { ws, userId, cookie, project } = await seedOwner(r, randomUUID().slice(0, 6))
		const wsB = await aWorkspace(db.owner, { slug: `m3b-${randomUUID().slice(0, 6)}` })

		// Read-only token: write tool denied with insufficient_scope challenge.
		const roToken = await mintToken(r, { userId, scopes: ['tasks.read'] })
		const writeDenied = await toolCall(
			r.app,
			{ token: roToken, workspaceId: ws.id, body: { projectId: project.id, title: 'x' } },
			'tasks.create'
		)
		expect(writeDenied.status).toBe(403)
		expect(writeDenied.json['type'] ?? writeDenied.json['code'] ?? '').toContain('insufficient_scope')
		expect(writeDenied.res.headers.get('www-authenticate')).toContain('insufficient_scope')
		const readOk = await toolCall(r.app, { token: roToken, workspaceId: ws.id, body: {} }, 'tasks.search')
		expect(readOk.status).toBe(200)

		// Narrow the principal ceiling below the token scopes -> next call denied.
		const rwToken = await mintToken(r, { userId, scopes: ['tasks.read', 'tasks.write'] })
		const first = await toolCall(r.app, { token: rwToken, workspaceId: ws.id, body: {} }, 'tasks.search')
		expect(first.status).toBe(200)
		const principalId =
			(first.json['data'] as { principal?: { id: string } }).principal?.id ??
			(
				await db.owner<{ id: string }[]>`
				SELECT id FROM agent_principals WHERE workspace_id = ${ws.id} AND owner_user_id = ${userId}
			`
			)[0]?.id
		if (!principalId) throw new Error('principal not found')
		await db.owner`
			UPDATE agent_principals SET scope_ceiling = '{tasks.read}'::text[] WHERE id = ${principalId}
		`
		const ceilingDenied = await toolCall(
			r.app,
			{ token: rwToken, workspaceId: ws.id, body: { projectId: project.id, title: 'x' } },
			'tasks.create'
		)
		expect(ceilingDenied.status).toBe(403)

		// Owner role downgrade (owner -> guest): reads now denied.
		await db.owner`
			UPDATE memberships SET role_id = (
				SELECT id FROM roles WHERE workspace_id = ${ws.id} AND key = 'guest')
			WHERE workspace_id = ${ws.id} AND user_id = ${userId}
		`
		// Guest has no workspace permissions: the call is denied or sees zero
		// rows (same behavior a human guest gets — ACLs, not a hard gate).
		const downgraded = await toolCall(r.app, { token: roToken, workspaceId: ws.id, body: {} }, 'tasks.search')
		if (downgraded.status === 200) {
			const d = downgraded.json['data'] as { data?: unknown[]; issues?: unknown[] }
			expect((d.data ?? d.issues ?? []).length).toBe(0)
		} else {
			expect([401, 403]).toContain(downgraded.status)
		}
		await db.owner`
			UPDATE memberships SET role_id = (
				SELECT id FROM roles WHERE workspace_id = ${ws.id} AND key = 'owner')
			WHERE workspace_id = ${ws.id} AND user_id = ${userId}
		`
		// restore ceiling for the rest of the matrix
		await db.owner`
			UPDATE agent_principals SET scope_ceiling = '{tasks.read,tasks.write}'::text[]
			WHERE id = ${principalId}
		`

		// Suspended owner membership -> immediate deny.
		await db.owner`
			UPDATE memberships SET status = 'suspended'
			WHERE workspace_id = ${ws.id} AND user_id = ${userId}
		`
		const suspOwner = await toolCall(r.app, { token: roToken, workspaceId: ws.id, body: {} }, 'tasks.search')
		expect([401, 403]).toContain(suspOwner.status)
		await db.owner`
			UPDATE memberships SET status = 'active'
			WHERE workspace_id = ${ws.id} AND user_id = ${userId}
		`

		// Suspended / revoked principal -> deny even with a valid token.
		await db.owner`UPDATE agent_principals SET status = 'suspended' WHERE id = ${principalId}`
		const susp = await toolCall(r.app, { token: roToken, workspaceId: ws.id, body: {} }, 'tasks.search')
		expect(susp.status).toBe(403)
		await db.owner`UPDATE agent_principals SET status = 'revoked' WHERE id = ${principalId}`
		const revoked = await toolCall(r.app, { token: roToken, workspaceId: ws.id, body: {} }, 'tasks.search')
		expect(revoked.status).toBe(403)

		// Cross-workspace: a wsA token/principal cannot read wsB.
		await db.owner`UPDATE agent_principals SET status = 'active' WHERE id = ${principalId}`
		const cross = await toolCall(r.app, { token: roToken, workspaceId: wsB.id, body: {} }, 'tasks.search')
		expect([401, 403]).toContain(cross.status)

		// Unknown OAuth client with no principal -> agent_not_connected.
		const otherClient = `other-cli-${randomUUID().slice(0, 6)}`
		await r.ctx.adapter.create({
			model: 'oauthClient',
			data: {
				clientId: otherClient,
				name: 'Other CLI',
				tokenEndpointAuthMethod: 'none',
				grantTypes: [DEVICE_GRANT],
				scopes: ['tasks.read'],
				redirectUris: [],
				disabled: false,
				skipConsent: false,
				createdAt: new Date(),
				updatedAt: new Date()
			}
		})
		await r.ctx.adapter.create({
			model: 'oauthClientResource',
			data: { clientId: otherClient, resourceId: agentAudienceUris(BASE).rest, createdAt: new Date() }
		})
		const foreignToken = await mintToken(r, { userId, scopes: ['tasks.read'], clientId: otherClient })
		const notConnected = await toolCall(
			r.app,
			{ token: foreignToken, workspaceId: ws.id, body: {} },
			'tasks.search'
		)
		expect(notConnected.status).toBe(403)
		expect(notConnected.json['type'] ?? notConnected.json['code'] ?? '').toContain('agent_not_connected')

		// Credential separation: cookie on agent route -> 401; bearer on session route -> 401.
		const cookieOnAgent = await toolCall(r.app, { cookie, workspaceId: ws.id, body: {} }, 'tasks.search')
		expect(cookieOnAgent.status).toBe(401)
		const bearerOnSession = await req(r.app, {
			path: '/api/v1/projects',
			workspaceId: ws.id,
			token: roToken
		})
		expect(bearerOnSession.status).toBe(401)

		// Human principal CRUD works over the session surface.
		const list = await req(r.app, { path: '/api/v1/agents', workspaceId: ws.id, cookie })
		expect(list.status).toBe(200)
		expect((list.json['data'] as unknown[]).length).toBeGreaterThan(0)
	})

	test('R2 approval lifecycle: park, decide permissions, execute, tamper, expiry', async () => {
		const r = await rig()
		if (!r || !db) return
		const { ws, userId, cookie, project } = await seedOwner(r, randomUUID().slice(0, 6))
		const guest = await signup(r, `g-${randomUUID().slice(0, 6)}@test.huriro.dev`)
		const guestRole = ws.roleIds['guest']
		if (!guestRole) throw new Error('guest role missing')
		await aMembership(db.owner, { workspaceId: ws.id, userId: guest.userId, roleId: guestRole })
		const token = await mintToken(r, { userId, scopes: ['tasks.read', 'tasks.write'] })

		// Create 21 issues via REST (agent token works only on /agent).
		const issueIds: string[] = []
		for (let i = 0; i < 21; i++) {
			const c = await req(r.app, {
				method: 'POST',
				path: '/api/v1/issues',
				workspaceId: ws.id,
				cookie,
				headers: { 'idempotency-key': randomUUID() },
				body: { projectId: project.id, title: `bulk-${i}` }
			})
			expect(c.status).toBe(201)
			issueIds.push(String(c.json['id']))
		}

		// bulk_update 21 -> approval_required, ZERO rows changed.
		const bulk = await toolCall(
			r.app,
			{ token, workspaceId: ws.id, body: { issues: issueIds, priority: 4 } },
			'tasks.bulk_update'
		)
		expect(bulk.status).toBe(200)
		const parked = bulk.json as { status: string; approvalId: string }
		expect(parked.status).toBe('approval_required')
		const prio = await db.owner<{ n: number }[]>`
			SELECT count(*)::int AS n FROM issues WHERE id = ANY(${issueIds}::uuid[]) AND priority = 4
		`
		expect(prio[0]?.n).toBe(0)

		// Guest cannot decide; bearer cannot call decide at all.
		const guestDecide = await req(r.app, {
			method: 'POST',
			path: `/api/v1/approvals/${parked.approvalId}/decide`,
			workspaceId: ws.id,
			cookie: guest.cookie,
			body: { decision: 'approve' }
		})
		expect(guestDecide.status).toBe(403)
		const bearerDecide = await req(r.app, {
			method: 'POST',
			path: `/api/v1/approvals/${parked.approvalId}/decide`,
			workspaceId: ws.id,
			token,
			body: { decision: 'approve' }
		})
		expect(bearerDecide.status).toBe(401)

		// approvals.status tool reflects the pending handle for this agent.
		const poll = await toolCall(
			r.app,
			{ token, workspaceId: ws.id, body: { approvalId: parked.approvalId } },
			'approvals.status'
		)
		expect(poll.status).toBe(200)

		// Approve as owner -> executes stored args as the agent.
		const decide = await req(r.app, {
			method: 'POST',
			path: `/api/v1/approvals/${parked.approvalId}/decide`,
			workspaceId: ws.id,
			cookie,
			body: { decision: 'approve' }
		})
		expect(decide.status).toBe(200)
		const after = await db.owner<{ n: number }[]>`
			SELECT count(*)::int AS n FROM issues WHERE id = ANY(${issueIds}::uuid[]) AND priority = 4
		`
		expect(after[0]?.n).toBe(21)
		// Attribution: the approval execution is audited as the agent, not the approver.
		const callRow = await db.owner<{ status: string; agentId: string }[]>`
			SELECT status, agent_id AS "agentId" FROM agent_tool_calls
			WHERE workspace_id = ${ws.id} AND approval_id = ${parked.approvalId}
		`
		expect(callRow[0]?.status).toBe('ok')
		expect(callRow[0]?.agentId).toBeTruthy()

		// Double approve is a no-op/409.
		const twice = await req(r.app, {
			method: 'POST',
			path: `/api/v1/approvals/${parked.approvalId}/decide`,
			workspaceId: ws.id,
			cookie,
			body: { decision: 'approve' }
		})
		expect([200, 409]).toContain(twice.status)

		// Tamper: second parked approval's args changed after parking -> refuse.
		const bulk2 = await toolCall(
			r.app,
			{ token, workspaceId: ws.id, body: { issues: issueIds, priority: 1 } },
			'tasks.bulk_update'
		)
		const ap2 = (bulk2.json as { approvalId: string }).approvalId
		await db.owner`
			UPDATE agent_approvals SET args = jsonb_set(args, '{priority}', '2'::jsonb)
			WHERE id = ${ap2}
		`
		const tampered = await req(r.app, {
			method: 'POST',
			path: `/api/v1/approvals/${ap2}/decide`,
			workspaceId: ws.id,
			cookie,
			body: { decision: 'approve' }
		})
		// The CAS succeeds but execution refuses the tampered args -> failed, no write.
		expect(tampered.status).toBe(200)
		expect((tampered.json['data'] as { status: string }).status).toBe('failed')
		const stillOne = await db.owner<{ n: number }[]>`
			SELECT count(*)::int AS n FROM issues WHERE id = ANY(${issueIds}::uuid[]) AND priority = 1
		`
		expect(stillOne[0]?.n).toBe(0)

		// Expired approval cannot be approved.
		const bulk3 = await toolCall(
			r.app,
			{ token, workspaceId: ws.id, body: { issues: issueIds, priority: 2 } },
			'tasks.bulk_update'
		)
		const ap3 = (bulk3.json as { approvalId: string }).approvalId
		await db.owner`
			UPDATE agent_approvals SET expires_at = now() - interval '1 minute' WHERE id = ${ap3}
		`
		const expired = await req(r.app, {
			method: 'POST',
			path: `/api/v1/approvals/${ap3}/decide`,
			workspaceId: ws.id,
			cookie,
			body: { decision: 'approve' }
		})
		expect([400, 409, 410, 422]).toContain(expired.status)

		// Principal revoked after parking -> approve fails, no write.
		const bulk4 = await toolCall(
			r.app,
			{ token, workspaceId: ws.id, body: { issues: issueIds, priority: 3 } },
			'tasks.bulk_update'
		)
		const ap4 = (bulk4.json as { approvalId: string }).approvalId
		await db.owner`
			UPDATE agent_principals SET status = 'revoked'
			WHERE workspace_id = ${ws.id} AND owner_user_id = ${userId}
		`
		const afterRevoke = await req(r.app, {
			method: 'POST',
			path: `/api/v1/approvals/${ap4}/decide`,
			workspaceId: ws.id,
			cookie,
			body: { decision: 'approve' }
		})
		expect(afterRevoke.status).toBe(200) // decide succeeds; execution fails
		const ap4row = await db.owner<{ status: string }[]>`
			SELECT status FROM agent_approvals WHERE id = ${ap4}
		`
		expect(ap4row[0]?.status).toBe('failed')
		const noPrio3 = await db.owner<{ n: number }[]>`
			SELECT count(*)::int AS n FROM issues WHERE id = ANY(${issueIds}::uuid[]) AND priority = 3
		`
		expect(noPrio3[0]?.n).toBe(0)
	})

	test('denial audit survives rollback; approval exec is atomic + scope-bound', async () => {
		const r = await rig()
		if (!r || !db) return
		const { ws, userId, cookie, project } = await seedOwner(r, randomUUID().slice(0, 6))

		// --- A1: denied calls persist an agent_tool_calls row (separate tx). ---
		const roToken = await mintToken(r, { userId, scopes: ['tasks.read'] })
		// Prime the principal (huriro-cli lazily auto-connects on first call).
		const prime = await toolCall(r.app, { token: roToken, workspaceId: ws.id, body: {} }, 'tasks.search')
		expect(prime.status).toBe(200)
		const writeDenied = await toolCall(
			r.app,
			{ token: roToken, workspaceId: ws.id, body: { projectId: project.id, title: 'x' } },
			'tasks.create'
		)
		expect(writeDenied.status).toBe(403)
		const deniedRows = await db.owner<{ status: string; code: string | null }[]>`
			SELECT status, error_code AS code FROM agent_tool_calls
			WHERE workspace_id = ${ws.id} AND status <> 'ok'`
		expect(deniedRows.some((c) => c.status === 'denied' && c.code === 'insufficient_scope')).toBe(true)

		// Suspended principal -> 403 + persisted denial row.
		await db.owner`
			UPDATE agent_principals SET status = 'suspended'
			WHERE workspace_id = ${ws.id} AND owner_user_id = ${userId}`
		const susp = await toolCall(r.app, { token: roToken, workspaceId: ws.id, body: {} }, 'tasks.search')
		expect(susp.status).toBe(403)
		await db.owner`
			UPDATE agent_principals SET status = 'active'
			WHERE workspace_id = ${ws.id} AND owner_user_id = ${userId}`
		const suspRows = await db.owner<{ code: string | null }[]>`
			SELECT error_code AS code FROM agent_tool_calls
			WHERE workspace_id = ${ws.id} AND error_code = 'agent_suspended'`
		expect(suspRows.length).toBe(1)

		// agent_not_connected (no principal) -> audit_log security event instead.
		const otherClient = `nc-${randomUUID().slice(0, 6)}`
		await r.ctx.adapter.create({
			model: 'oauthClient',
			data: {
				clientId: otherClient,
				name: 'NC',
				tokenEndpointAuthMethod: 'none',
				grantTypes: [DEVICE_GRANT],
				scopes: ['tasks.read'],
				redirectUris: [],
				disabled: false,
				skipConsent: false,
				createdAt: new Date(),
				updatedAt: new Date()
			}
		})
		await r.ctx.adapter.create({
			model: 'oauthClientResource',
			data: { clientId: otherClient, resourceId: agentAudienceUris(BASE).rest, createdAt: new Date() }
		})
		const foreign = await mintToken(r, { userId, scopes: ['tasks.read'], clientId: otherClient })
		const nc = await toolCall(r.app, { token: foreign, workspaceId: ws.id, body: {} }, 'tasks.search')
		expect(nc.status).toBe(403)
		const secRows = await db.owner<{ action: string; code: string }[]>`
			SELECT action, metadata->>'code' AS code FROM audit_log
			WHERE workspace_id = ${ws.id} AND action = 'agent.tool_denied'`
		expect(secRows.some((a) => a.code === 'agent_not_connected')).toBe(true)

		// --- A3: scope binding — read-only token cannot even PARK a write. ---
		const issueIds: string[] = []
		for (let i = 0; i < 21; i++) {
			const c = await req(r.app, {
				method: 'POST',
				path: '/api/v1/issues',
				workspaceId: ws.id,
				cookie,
				headers: { 'idempotency-key': randomUUID() },
				body: { projectId: project.id, title: `a2-${i}` }
			})
			expect(c.status).toBe(201)
			issueIds.push(String(c.json['id']))
		}
		const roBulk = await toolCall(
			r.app,
			{ token: roToken, workspaceId: ws.id, body: { issues: issueIds, priority: 4 } },
			'tasks.bulk_update'
		)
		expect(roBulk.status).toBe(403)

		// Widen the ceiling AFTER parking: execution must still run with the
		// scopes the requesting token had (token_scopes column), never wider.
		// (The principal was lazily created with the ro token's ceiling.)
		await db.owner`
			UPDATE agent_principals SET scope_ceiling = '{tasks.read,tasks.write}'::text[]
			WHERE workspace_id = ${ws.id} AND owner_user_id = ${userId}`
		const rwToken = await mintToken(r, { userId, scopes: ['tasks.read', 'tasks.write'] })
		const parked = await toolCall(
			r.app,
			{ token: rwToken, workspaceId: ws.id, body: { issues: issueIds, priority: 4 } },
			'tasks.bulk_update'
		)
		expect((parked.json as { status: string }).status).toBe('approval_required')
		const apId = (parked.json as { approvalId: string }).approvalId
		const storedScopes = await db.owner<{ s: string[] }[]>`
			SELECT token_scopes AS s FROM agent_approvals WHERE id = ${apId}`
		expect(storedScopes[0]?.s.sort()).toEqual(['tasks.read', 'tasks.write'].sort())
		await db.owner`
			UPDATE agent_principals SET scope_ceiling = '{tasks.read,tasks.write,docs.write}'::text[]
			WHERE workspace_id = ${ws.id} AND owner_user_id = ${userId}`
		const decide = await req(r.app, {
			method: 'POST',
			path: `/api/v1/approvals/${apId}/decide`,
			workspaceId: ws.id,
			cookie,
			body: { decision: 'approve' }
		})
		expect(decide.status).toBe(200)
		const execCall = await db.owner<{ requested: string[]; effective: string[] }[]>`
			SELECT requested_scopes AS requested, effective_scopes AS effective FROM agent_tool_calls
			WHERE approval_id = ${apId} AND status = 'ok'`
		expect(execCall[0]?.requested.sort()).toEqual(['tasks.read', 'tasks.write'].sort())
		expect(execCall[0]?.effective).not.toContain('docs.write')

		// --- A2: a mid-batch failure rolls back EVERY write of the approval. ---
		const issueIds2: string[] = []
		for (let i = 0; i < 21; i++) {
			const c = await req(r.app, {
				method: 'POST',
				path: '/api/v1/issues',
				workspaceId: ws.id,
				cookie,
				headers: { 'idempotency-key': randomUUID() },
				body: { projectId: project.id, title: `a2b-${i}` }
			})
			expect(c.status).toBe(201)
			issueIds2.push(String(c.json['id']))
		}
		// Bogus issue mid-list: sequential handler writes ~10, then throws.
		issueIds2.splice(10, 0, randomUUID())
		const parked2 = await toolCall(
			r.app,
			{ token: rwToken, workspaceId: ws.id, body: { issues: issueIds2, priority: 1 } },
			'tasks.bulk_update'
		)
		expect((parked2.json as { status: string }).status).toBe('approval_required')
		const ap2 = (parked2.json as { approvalId: string }).approvalId
		const decide2 = await req(r.app, {
			method: 'POST',
			path: `/api/v1/approvals/${ap2}/decide`,
			workspaceId: ws.id,
			cookie,
			body: { decision: 'approve' }
		})
		expect(decide2.status).toBe(200)
		expect((decide2.json['data'] as { status: string }).status).toBe('failed')
		const saved = await db.owner<{ n: number }[]>`
			SELECT count(*)::int AS n FROM issues WHERE id = ANY(${issueIds2}::uuid[]) AND priority = 1`
		expect(saved[0]?.n).toBe(0)
		const errCall = await db.owner<{ status: string; code: string | null }[]>`
			SELECT status, error_code AS code FROM agent_tool_calls
			WHERE approval_id = ${ap2} AND status = 'error'`
		expect(errCall.length).toBe(1)
	})

	test('idempotent replay of tasks.create returns the same issue', async () => {
		const r = await rig()
		if (!r || !db) return
		const { ws, userId, project } = await seedOwner(r, randomUUID().slice(0, 6))
		const token = await mintToken(r, { userId, scopes: ['tasks.write'] })
		const key = randomUUID()
		const body = { projectId: project.id, title: 'once' }
		const a = await toolCall(
			r.app,
			{ token, workspaceId: ws.id, headers: { 'idempotency-key': key }, body },
			'tasks.create'
		)
		expect(a.status).toBe(200)
		const b = await toolCall(
			r.app,
			{ token, workspaceId: ws.id, headers: { 'idempotency-key': key }, body },
			'tasks.create'
		)
		expect(b.status).toBe(200)
		expect((b.json['data'] as { id: string }).id).toBe((a.json['data'] as { id: string }).id)
		const count = await db.owner<{ n: number }[]>`
			SELECT count(*)::int AS n FROM issues WHERE workspace_id = ${ws.id} AND title = 'once'
		`
		expect(count[0]?.n).toBe(1)
	})
})

// ---------- stage 3: consent backend (§13.1b) ----------

const CONSENT_CLIENT = 'https://agent.example/app'
const AS_SECRET = 'b'.repeat(48) // betterAuthSecret — ctx.context.secret

/** Forge the signed oauth_query the AS puts on the /oauth/consent redirect. */
async function mintConsentCode(clientId: string, scopes: string[]): Promise<string> {
	const { makeSignature } = await import('better-auth/crypto')
	const params = new URLSearchParams()
	params.set('client_id', clientId)
	params.set('response_type', 'code')
	params.set('redirect_uri', 'https://agent.example/cb')
	params.set('scope', scopes.join(' '))
	params.set('state', 'st-1')
	params.set('code_challenge', 'x'.repeat(43))
	params.set('code_challenge_method', 'S256')
	params.set('exp', String(Math.floor(Date.now() / 1000) + 600))
	params.set('ba_iat', String(Date.now()))
	const names = [...new Set([...params.keys(), 'ba_param'])].sort()
	for (const n of names) params.append('ba_param', n)
	const canonical = new URLSearchParams(
		[...params.entries()].sort(([ka, va], [kb, vb]) =>
			ka < kb ? -1 : ka > kb ? 1 : va < vb ? -1 : va > vb ? 1 : 0
		)
	)
	params.set('sig', await makeSignature(canonical.toString(), AS_SECRET))
	return params.toString()
}

async function addConsentClient(r: Rig): Promise<void> {
	const adapter = r.ctx.adapter as unknown as {
		findOne<T>(a: { model: string; where: { field: string; value: string }[] }): Promise<T>
		create(a: { model: string; data: Record<string, unknown> }): Promise<unknown>
	}
	const existing = await adapter.findOne({
		model: 'oauthClient',
		where: [{ field: 'clientId', value: CONSENT_CLIENT }]
	})
	if (!existing) {
		await adapter.create({
			model: 'oauthClient',
			data: {
				clientId: CONSENT_CLIENT,
				name: 'Fixture Agent App',
				tokenEndpointAuthMethod: 'none',
				grantTypes: ['authorization_code', 'refresh_token'],
				scopes: ['openid', 'tasks.read', 'tasks.write'],
				redirectUris: ['https://agent.example/cb'],
				disabled: false,
				skipConsent: false,
				createdAt: new Date(),
				updatedAt: new Date()
			}
		})
	}
}

describe('M3 stage 3 — consent backend', () => {
	test('context: signed code resolves client from the registered record + member workspaces', async () => {
		const r = await rig()
		if (!r) return
		const { ws, cookie } = await seedOwner(r, 'cctx')
		await addConsentClient(r)
		const code = await mintConsentCode(CONSENT_CLIENT, ['tasks.read', 'tasks.write'])
		const res = await req(r.app, {
			cookie,
			path: `/api/v1/agents/consent/context?consent_code=${encodeURIComponent(code)}`
		})
		expect(res.status).toBe(200)
		const data = res.json['data'] as {
			client: { name: string; clientId: string; verified: boolean }
			requestedScopes: { scope: string; risk: string }[]
			workspaces: { workspaceId: string }[]
		}
		// Client identity comes from the registered record, never the request.
		expect(data.client.name).toBe('Fixture Agent App')
		expect(data.client.clientId).toBe(CONSENT_CLIENT)
		expect(data.client.verified).toBe(true)
		expect(data.requestedScopes.find((s) => s.scope === 'tasks.write')?.risk).toBe('write')
		expect(data.workspaces.some((w) => w.workspaceId === ws.id)).toBe(true)
		// Unauthenticated and tampered codes are rejected.
		expect(
			(await req(r.app, { path: `/api/v1/agents/consent/context?consent_code=${encodeURIComponent(code)}` }))
				.status
		).toBe(401)
		expect(
			(
				await req(r.app, {
					cookie,
					path: `/api/v1/agents/consent/context?consent_code=${encodeURIComponent(code.slice(0, -2) + 'zz')}`
				})
			).status
		).toBe(404)
	})

	test('decision: guards + accept connects principal, deny creates nothing', async () => {
		const r = await rig()
		if (!r) return
		const { ws, cookie } = await seedOwner(r, 'cdec')
		const other = await aWorkspace(db!.owner, { slug: `m3-cdec-other-${RUN}` })
		await addConsentClient(r)
		const code = await mintConsentCode(CONSENT_CLIENT, ['tasks.read', 'tasks.write'])
		const decide = (over: Record<string, unknown>) =>
			req(r.app, {
				method: 'POST',
				cookie,
				path: '/api/v1/agents/consent/decision',
				body: {
					consentCode: code,
					accept: true,
					workspaceId: ws.id,
					scopes: ['tasks.read'],
					allowWriteScopes: false,
					...over
				}
			})

		// Write scope without explicit opt-in.
		expect((await decide({ scopes: ['tasks.write'] })).status).toBe(403)
		// Scope outside the requested set.
		expect((await decide({ scopes: ['docs.write'], allowWriteScopes: true })).status).toBe(400)
		// Workspace the user is not a member of.
		expect((await decide({ workspaceId: other.id, allowWriteScopes: true })).status).toBe(403)
		// Tampered consent code.
		expect((await decide({ consentCode: `${code.slice(0, -2)}zz` })).status).toBe(404)

		// Deny hits the AS deny path only — no principal.
		const denied = await decide({ accept: false, allowWriteScopes: true })
		expect(denied.status).toBe(200)
		expect(
			(await req(r.app, { cookie, workspaceId: ws.id, path: '/api/v1/me/connected-apps' })).json[
				'data'
			] as unknown[]
		).toHaveLength(0)

		// Accept with write opt-in → consent grant + connectAgent upsert.
		const ok = await decide({ scopes: ['tasks.read', 'tasks.write'], allowWriteScopes: true })
		expect(ok.status).toBe(200)
		const apps = (await req(r.app, { cookie, workspaceId: ws.id, path: '/api/v1/me/connected-apps' })).json[
			'data'
		] as {
			oauthClientId: string
		}[]
		expect(apps.some((a) => a.oauthClientId === CONSENT_CLIENT)).toBe(true)
	})
})
