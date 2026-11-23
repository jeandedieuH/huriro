/**
 * Real PostgreSQL 18 integration test harness (Gate G1).
 *
 * Uses `getTestDb()` from `@huriro/test-utils` (`DATABASE_URL` or `HURIRO_TESTCONTAINERS=1`),
 * runs every HTTP request as `huriro_app` through `createApp()`, and supports seeded
 * owner/admin/member/guest/suspended/outsider users + secondary tenant isolation.
 */
import { randomUUID } from 'node:crypto'
import type { Sql } from '@huriro/db'
import { aMembership, aUser, aWorkspace, getTestDb, migrationsDir, type TestDb } from '@huriro/test-utils'
import { createApp } from '../api/app'
import type { DnsResolver } from '../api/egress'
import type { CollabDirectBridge } from '../modules/docs'
import { type BlobStorage, MemoryBlobStorage } from '../modules/files'
import type { Auth } from '../modules/identity'
import type { GithubApiClient } from '../modules/integrations'
import type { VapidConfig } from '../modules/notifications'
import { InProcessPubSub, type RealtimePubSub } from '../realtime/pubsub'

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

export function createIntegrationServer(
	db: TestDb,
	opts?: {
		readonly collabBridge?: CollabDirectBridge
		readonly collabTicketSecret?: string
		readonly pubsub?: RealtimePubSub
		readonly blobStorage?: BlobStorage
		readonly rootSecret?: string
		readonly githubAppWebhookSecret?: string
		readonly githubClient?: GithubApiClient
		readonly vapid?: VapidConfig
		readonly egressFetch?: typeof fetch
		readonly egressResolver?: DnsResolver
	}
) {
	const auth = createTestAuth()
	// Injected pubsub lets a test share one bus between api, realtime, and the
	// collab runtime — matching how `serve --role=all` wires them in src/index.ts.
	const pubsub = opts?.pubsub ?? new InProcessPubSub()
	const blobStorage = opts?.blobStorage ?? new MemoryBlobStorage()
	const rootSecret = opts?.rootSecret ?? 'huriro-integration-test-root-secret-32chars'
	const app = createApp({
		sql: db.app,
		migrationsDir: migrationsDir(),
		mode: 'selfhost',
		auth,
		pubsub,
		blobStorage,
		rootSecret,
		...(opts?.collabBridge ? { collabBridge: opts.collabBridge } : {}),
		...(opts?.collabTicketSecret ? { collabTicketSecret: opts.collabTicketSecret } : {}),
		...(opts?.githubAppWebhookSecret ? { githubAppWebhookSecret: opts.githubAppWebhookSecret } : {}),
		...(opts?.githubClient ? { githubClient: opts.githubClient } : {}),
		...(opts?.vapid ? { vapid: opts.vapid } : {}),
		...(opts?.egressFetch ? { egressFetch: opts.egressFetch } : {}),
		...(opts?.egressResolver ? { egressResolver: opts.egressResolver } : {})
	})
	return { app, auth, pubsub, blobStorage, rootSecret }
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
	const tag = randomUUID().slice(0, 8)
	const wsA = await aWorkspace(ownerSql, { slug: `ws-${tag}-a`, name: `Workspace A ${tag}` })
	const wsB = await aWorkspace(ownerSql, { slug: `ws-${tag}-b`, name: `Workspace B ${tag}` })

	const owner = await aUser(ownerSql, { email: `owner-${tag}@test.huriro.dev`, displayName: `Owner ${tag}` })
	const admin = await aUser(ownerSql, { email: `admin-${tag}@test.huriro.dev`, displayName: `Admin ${tag}` })
	const memberA = await aUser(ownerSql, {
		email: `membera-${tag}@test.huriro.dev`,
		displayName: `Member A ${tag}`
	})
	const memberB = await aUser(ownerSql, {
		email: `memberb-${tag}@test.huriro.dev`,
		displayName: `Member B ${tag}`
	})
	const guest = await aUser(ownerSql, { email: `guest-${tag}@test.huriro.dev`, displayName: `Guest ${tag}` })
	const suspended = await aUser(ownerSql, {
		email: `suspended-${tag}@test.huriro.dev`,
		displayName: `Suspended ${tag}`
	})
	const outsider = await aUser(ownerSql, {
		email: `outsider-${tag}@test.huriro.dev`,
		displayName: `Outsider ${tag}`
	})
	const otherTenantUser = await aUser(ownerSql, {
		email: `othertenant-${tag}@test.huriro.dev`,
		displayName: `Other Tenant ${tag}`
	})

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
