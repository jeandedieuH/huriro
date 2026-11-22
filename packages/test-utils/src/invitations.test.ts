/**
 * Invitation RLS coverage (§12.3): the accept flow's context bootstrap is the
 * subtle part — an invitee has no workspace context yet, so the invitations
 * policy's email escape (`email = app.user_email`) is the only door in.
 * These tests pin that contract at the SQL layer, as huriro_app.
 */
import { beforeAll, describe, expect, test } from 'bun:test'
import { createHash } from 'node:crypto'
import { getTestDb, type TestDb } from './db'
import { aMembership, aUser, aWorkspace } from './factories'

let db: TestDb | null = null

beforeAll(async () => {
	db = await getTestDb()
})

function tokenPair() {
	const token = `tok_${crypto.randomUUID()}`
	return { token, hash: createHash('sha256').update(token).digest('hex') }
}

async function seedInvite(args: { workspaceId: string; roleId: string; email: string; invitedBy: string }) {
	const { hash } = tokenPair()
	const [row] = await db!.owner<{ id: string }[]>`
		INSERT INTO invitations (workspace_id, email, role_id, token_hash, invited_by, expires_at)
		VALUES (${args.workspaceId}, ${args.email}, ${args.roleId}, ${hash}, ${args.invitedBy},
			now() + interval '7 days')
		RETURNING id
	`
	return { id: row!.id, hash }
}

describe('invitation rls', () => {
	test('invitee sees own-email invite without workspace context', async () => {
		if (!db) return
		const inviter = await aUser(db.owner)
		const invitee = await aUser(db.owner)
		const ws = await aWorkspace(db.owner)
		await aMembership(db.owner, { workspaceId: ws.id, userId: inviter.id, roleId: ws.roleIds['owner']! })
		const invite = await seedInvite({
			workspaceId: ws.id,
			roleId: ws.roleIds['member']!,
			email: invitee.email,
			invitedBy: inviter.id
		})

		// Only user context — no app.workspace_id. The email clause must surface
		// exactly this invite and nothing else.
		const rows = await db.app.begin(async (tx) => {
			await tx`SELECT set_config('app.user_id', ${invitee.id}, true)`
			await tx`SELECT set_config('app.user_email', ${invitee.email}, true)`
			return tx<{ id: string }[]>`SELECT id FROM invitations`
		})
		expect(rows.map((r) => r.id)).toEqual([invite.id])
	})

	test('invitations are invisible to other users and without any context', async () => {
		if (!db) return
		const inviter = await aUser(db.owner)
		const stranger = await aUser(db.owner)
		const ws = await aWorkspace(db.owner)
		await aMembership(db.owner, { workspaceId: ws.id, userId: inviter.id, roleId: ws.roleIds['owner']! })
		await seedInvite({
			workspaceId: ws.id,
			roleId: ws.roleIds['member']!,
			email: 'nobody@example.dev',
			invitedBy: inviter.id
		})

		const strangerRows = await db.app.begin(async (tx) => {
			await tx`SELECT set_config('app.user_id', ${stranger.id}, true)`
			await tx`SELECT set_config('app.user_email', ${stranger.email}, true)`
			return tx<{ id: string }[]>`SELECT id FROM invitations`
		})
		expect(strangerRows.length).toBe(0)

		// A member of the workspace sees it under tenant context (normal path).
		const tenantRows = await db.app.begin(async (tx) => {
			await tx`SELECT set_config('app.workspace_id', ${ws.id}, true)`
			await tx`SELECT set_config('app.user_id', ${inviter.id}, true)`
			return tx<{ id: string }[]>`SELECT id FROM invitations`
		})
		expect(tenantRows.length).toBe(1)
	})

	test('accept flow: email ctx → read → tenant ctx → membership write', async () => {
		if (!db) return
		const inviter = await aUser(db.owner)
		const invitee = await aUser(db.owner)
		const ws = await aWorkspace(db.owner)
		await aMembership(db.owner, { workspaceId: ws.id, userId: inviter.id, roleId: ws.roleIds['owner']! })
		const invite = await seedInvite({
			workspaceId: ws.id,
			roleId: ws.roleIds['member']!,
			email: invitee.email,
			invitedBy: inviter.id
		})

		// Mirror acceptInvitation()'s exact sequence, as huriro_app — proves the
		// policies admit it end-to-end.
		await db.app.begin(async (tx) => {
			await tx`SELECT set_config('app.user_id', ${invitee.id}, true)`
			await tx`SELECT set_config('app.user_email', ${invitee.email}, true)`
			const [found] = await tx<{ workspaceId: string; roleId: string }[]>`
				SELECT workspace_id AS "workspaceId", role_id AS "roleId"
				FROM invitations WHERE token_hash = ${invite.hash} AND status = 'pending'
			`
			expect(found).toBeDefined()
			await tx`SELECT set_config('app.workspace_id', ${found!.workspaceId}, true)`
			await tx`
				INSERT INTO memberships (workspace_id, user_id, role_id)
				VALUES (${found!.workspaceId}, ${invitee.id}, ${found!.roleId})
				ON CONFLICT (workspace_id, user_id) DO NOTHING
			`
			await tx`UPDATE invitations SET status = 'accepted', accepted_at = now() WHERE id = ${invite.id}`
		})

		// Verify the seat exists under the tenant context.
		const member = await db.app.begin(async (tx) => {
			await tx`SELECT set_config('app.workspace_id', ${ws.id}, true)`
			const [r] = await tx<{ n: number }[]>`
				SELECT count(*)::int AS n FROM memberships WHERE user_id = ${invitee.id}
			`
			return r!.n
		})
		expect(member).toBe(1)
	})

	test('auth schema is sealed off from huriro_app', async () => {
		if (!db) return
		// The auth tables exist (migration 0005 applied) but huriro_app holds
		// zero grants on them — isolation is structural, not conventional.
		const err = await db.app`SELECT count(*) FROM auth.session`.then(
			() => null,
			(e: unknown) => e
		)
		expect(err).not.toBeNull()
		expect(String(err)).toContain('permission denied')
	})
})
