/**
 * Real PostgreSQL 18 integration test harness (Gate G1).
 *
 * Uses `getTestDb()` from `@huriro/test-utils` (`DATABASE_URL` or `HURIRO_TESTCONTAINERS=1`),
 * runs every HTTP request as `huriro_app` through `createApp()`, and supports seeded
 * owner/admin/member/guest/suspended/outsider users + secondary tenant isolation.
 */
import type { Sql } from '@huriro/db'
import { aMembership, aUser, aWorkspace, getTestDb, migrationsDir, type TestDb } from '@huriro/test-utils'
import { createApp } from '../api/app'
import type { Auth } from '../modules/identity'
import { InProcessPubSub } from '../realtime/pubsub'

export interface M1SeededFixture {
	readonly workspaceId: string
	readonly otherWorkspaceId: string
	readonly ownerId: string
	readonly ownerEmail: string
	readonly adminId: string
	readonly adminEmail: string
	readonly memberAId: string
	readonly memberAEmail: string
	readonly memberBId: string
	readonly memberBEmail: string
	readonly guestId: string
	readonly guestEmail: string
	readonly suspendedId: string
	readonly suspendedEmail: string
	readonly outsiderId: string
	readonly outsiderEmail: string
	readonly otherTenantUserId: string
	readonly otherTenantEmail: string
}

export function createTestAuth(): Auth {
	return {
		handler: () => new Response('Not found', { status: 404 }),
		api: {
			async getSession({ headers }: { headers: Headers }) {
				const userId = headers.get('x-test-user-id')
				const email = headers.get('x-test-user-email') ?? 'test@huriro.local'
				if (!userId) return null
				return {
					user: { id: userId, email, name: email },
					session: { id: `sess-${userId}`, userId }
				}
			}
		}
	} as unknown as Auth
}

export function createIntegrationServer(db: TestDb) {
	const auth = createTestAuth()
	const pubsub = new InProcessPubSub()
	const app = createApp({
		sql: db.app,
		migrationsDir: migrationsDir(),
		mode: 'selfhost',
		auth,
		pubsub
	})
	return { app, auth, pubsub }
}

export async function apiRequest(
	app: ReturnType<typeof createApp>,
	opts: {
		readonly method?: string
		readonly path: string
		readonly workspaceId?: string | undefined
		readonly userId?: string | undefined
		readonly email?: string | undefined
		readonly body?: unknown
		readonly headers?: Record<string, string>
	}
): Promise<{ readonly status: number; readonly json: Record<string, unknown>; readonly res: Response }> {
	const reqHeaders: Record<string, string> = {
		'x-huriro-client': 'huriro-test',
		...opts.headers
	}
	if (opts.workspaceId) reqHeaders['x-workspace-id'] = opts.workspaceId
	if (opts.userId) reqHeaders['x-test-user-id'] = opts.userId
	if (opts.email) reqHeaders['x-test-user-email'] = opts.email
	if (opts.body !== undefined && !reqHeaders['content-type']) {
		reqHeaders['content-type'] = 'application/json'
	}

	const res = await app.handle(
		new Request(`http://localhost${opts.path}`, {
			method: opts.method ?? 'GET',
			headers: reqHeaders,
			...(opts.body !== undefined ? { body: JSON.stringify(opts.body) } : {})
		})
	)
	const text = await res.text()
	let parsed: Record<string, unknown> = {}
	if (text.length > 0) {
		try {
			parsed = JSON.parse(text) as Record<string, unknown>
		} catch {
			parsed = { raw: text }
		}
	}
	return { status: res.status, json: parsed, res }
}

export async function seedM1Fixture(ownerSql: Sql): Promise<M1SeededFixture> {
	const wsA = await aWorkspace(ownerSql)
	const wsB = await aWorkspace(ownerSql)

	const owner = await aUser(ownerSql)
	const admin = await aUser(ownerSql)
	const memberA = await aUser(ownerSql)
	const memberB = await aUser(ownerSql)
	const guest = await aUser(ownerSql)
	const suspended = await aUser(ownerSql)
	const outsider = await aUser(ownerSql)
	const otherTenantUser = await aUser(ownerSql)

	await aMembership(ownerSql, { workspaceId: wsA.id, userId: owner.id, roleId: wsA.roleIds['owner'] ?? '' })
	await aMembership(ownerSql, { workspaceId: wsA.id, userId: admin.id, roleId: wsA.roleIds['admin'] ?? '' })
	await aMembership(ownerSql, {
		workspaceId: wsA.id,
		userId: memberA.id,
		roleId: wsA.roleIds['member'] ?? ''
	})
	await aMembership(ownerSql, {
		workspaceId: wsA.id,
		userId: memberB.id,
		roleId: wsA.roleIds['member'] ?? ''
	})
	await aMembership(ownerSql, { workspaceId: wsA.id, userId: guest.id, roleId: wsA.roleIds['guest'] ?? '' })
	await aMembership(ownerSql, {
		workspaceId: wsA.id,
		userId: suspended.id,
		roleId: wsA.roleIds['member'] ?? '',
		status: 'suspended'
	})
	await aMembership(ownerSql, {
		workspaceId: wsB.id,
		userId: otherTenantUser.id,
		roleId: wsB.roleIds['owner'] ?? ''
	})

	return {
		workspaceId: wsA.id,
		otherWorkspaceId: wsB.id,
		ownerId: owner.id,
		ownerEmail: owner.email,
		adminId: admin.id,
		adminEmail: admin.email,
		memberAId: memberA.id,
		memberAEmail: memberA.email,
		memberBId: memberB.id,
		memberBEmail: memberB.email,
		guestId: guest.id,
		guestEmail: guest.email,
		suspendedId: suspended.id,
		suspendedEmail: suspended.email,
		outsiderId: outsider.id,
		outsiderEmail: outsider.email,
		otherTenantUserId: otherTenantUser.id,
		otherTenantEmail: otherTenantUser.email
	}
}

export { getTestDb }
