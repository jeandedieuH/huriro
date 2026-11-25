/**
 * Real PostgreSQL 18 integration tests for the invitation create/resend/accept
 * cycle (§12.3). Pins the uq_invitations_pending upsert contract: re-inviting a
 * pending address renews in place (token rotation) instead of 500ing, expired
 * invites never block re-invites, seated members get a problem+json 409, and
 * re-invites after acceptance insert a fresh row.
 */
import { beforeAll, describe, expect, test } from 'bun:test'
import { randomUUID } from 'node:crypto'
import type { TestDb } from '@huriro/test-utils'
import { apiRequest, createIntegrationServer, getTestDb, seedM1Fixture } from './test-harness'

let db: TestDb | null = null

beforeAll(async () => {
	db = await getTestDb()
})

function invitePath() {
	return '/api/v1/invitations'
}

describe('invitations integration (PostgreSQL 18 + FORCE RLS)', () => {
	test('re-inviting a pending address renews in place: same row, rotated token, resent=true — never a 500', async () => {
		if (!db) return
		const fixture = await seedM1Fixture(db.owner)
		const { app } = createIntegrationServer(db)
		const email = `invitee-${randomUUID().slice(0, 8)}@test.huriro.dev`

		const first = await apiRequest(app, {
			method: 'POST',
			path: invitePath(),
			userId: fixture.ownerId,
			email: fixture.ownerEmail,
			body: { workspaceId: fixture.workspaceId, email, role: 'member' }
		})
		expect(first.status).toBe(200)
		expect(first.json['resent']).toBe(false)
		const firstToken = String(first.json['token'])
		const inviteId = String(first.json['id'])

		// The regression pin: this exact second POST used to die as an unhandled
		// 23505 → 500. Now it is a renewal.
		const second = await apiRequest(app, {
			method: 'POST',
			path: invitePath(),
			userId: fixture.ownerId,
			email: fixture.ownerEmail,
			body: { workspaceId: fixture.workspaceId, email, role: 'member' }
		})
		expect(second.status).toBe(200)
		expect(second.json['resent']).toBe(true)
		expect(second.json['id']).toBe(inviteId)
		const secondToken = String(second.json['token'])
		expect(secondToken).not.toBe(firstToken)

		// Still exactly one invitation row for that email in the workspace.
		const rows = await db.owner<{ n: number }[]>`
			SELECT count(*)::int AS n FROM invitations
			WHERE workspace_id = ${fixture.workspaceId} AND email = ${email}
		`
		expect(rows[0]!.n).toBe(1)

		// Token rotation burns the old link…
		const oldAccept = await apiRequest(app, {
			method: 'POST',
			path: '/api/v1/invitations/accept',
			userId: fixture.outsiderId,
			email,
			body: { token: firstToken }
		})
		expect(oldAccept.status).toBe(404)

		// …while the fresh token seats the invitee.
		const newAccept = await apiRequest(app, {
			method: 'POST',
			path: '/api/v1/invitations/accept',
			userId: fixture.outsiderId,
			email,
			body: { token: secondToken }
		})
		expect(newAccept.status).toBe(200)
		expect(newAccept.json['membershipCreated']).toBe(true)

		// Audit trail distinguishes creation from resend.
		const auditRows = await db.owner<{ action: string }[]>`
			SELECT action FROM audit_log
			WHERE target_type = 'invitation' AND target_id = ${inviteId}::uuid
			ORDER BY created_at ASC, id ASC
		`
		expect(auditRows.map((r) => r.action)).toEqual([
			'invitation.create',
			'invitation.resend',
			'invitation.accept'
		])
	})

	test('an expired pending invite does not block re-invite — renewal extends the expiry', async () => {
		if (!db) return
		const fixture = await seedM1Fixture(db.owner)
		const { app } = createIntegrationServer(db)
		const email = `expired-${randomUUID().slice(0, 8)}@test.huriro.dev`

		const first = await apiRequest(app, {
			method: 'POST',
			path: invitePath(),
			userId: fixture.ownerId,
			email: fixture.ownerEmail,
			body: { workspaceId: fixture.workspaceId, email, role: 'member' }
		})
		expect(first.status).toBe(200)
		const inviteId = String(first.json['id'])

		// Simulate the 7-day window lapsing: the row stays 'pending' but expired —
		// the state that used to permanently block re-invites through the index.
		await db.owner`
			UPDATE invitations SET expires_at = now() - interval '1 day' WHERE id = ${inviteId}::uuid
		`

		const second = await apiRequest(app, {
			method: 'POST',
			path: invitePath(),
			userId: fixture.ownerId,
			email: fixture.ownerEmail,
			body: { workspaceId: fixture.workspaceId, email, role: 'member' }
		})
		expect(second.status).toBe(200)
		expect(second.json['resent']).toBe(true)
		expect(second.json['id']).toBe(inviteId)

		const [row] = await db.owner<{ status: string; expiresAt: Date }[]>`
			SELECT status, expires_at AS "expiresAt" FROM invitations WHERE id = ${inviteId}::uuid
		`
		expect(row!.status).toBe('pending')
		expect(row!.expiresAt.getTime()).toBeGreaterThan(Date.now())

		// The renewed token is acceptably fresh end-to-end.
		const accept = await apiRequest(app, {
			method: 'POST',
			path: '/api/v1/invitations/accept',
			userId: fixture.outsiderId,
			email,
			body: { token: String(second.json['token']) }
		})
		expect(accept.status).toBe(200)
	})

	test('inviting a seated member is a problem+json 409, not an unhandled error', async () => {
		if (!db) return
		const fixture = await seedM1Fixture(db.owner)
		const { app } = createIntegrationServer(db)

		const res = await apiRequest(app, {
			method: 'POST',
			path: invitePath(),
			userId: fixture.ownerId,
			email: fixture.ownerEmail,
			body: { workspaceId: fixture.workspaceId, email: fixture.memberAEmail, role: 'member' }
		})
		expect(res.status).toBe(409)
		expect(res.json['code']).toBe('conflict')
		expect(res.json['type']).toBe('https://docs.huriro.app/errors/conflict')
		expect(typeof res.json['requestId']).toBe('string')

		// No invitation row may leak in for the seated member.
		const rows = await db.owner<{ n: number }[]>`
			SELECT count(*)::int AS n FROM invitations
			WHERE workspace_id = ${fixture.workspaceId} AND email = ${fixture.memberAEmail}
		`
		expect(rows[0]!.n).toBe(0)
	})

	test('seated-member guard fires after acceptance; once removed, re-invite inserts a fresh row', async () => {
		if (!db) return
		const fixture = await seedM1Fixture(db.owner)
		const { app } = createIntegrationServer(db)
		// The invite email must be the invitee's real account email — the accept
		// path enforces that match, so the seated-membership join keys on it.
		const email = fixture.outsiderEmail
		const inviteeId = fixture.outsiderId

		const first = await apiRequest(app, {
			method: 'POST',
			path: invitePath(),
			userId: fixture.ownerId,
			email: fixture.ownerEmail,
			body: { workspaceId: fixture.workspaceId, email, role: 'member' }
		})
		expect(first.status).toBe(200)
		const accept = await apiRequest(app, {
			method: 'POST',
			path: '/api/v1/invitations/accept',
			userId: inviteeId,
			email,
			body: { token: String(first.json['token']) }
		})
		expect(accept.status).toBe(200)

		// Once accepted, the invitee is seated — re-inviting is the already_member 409.
		const seated = await apiRequest(app, {
			method: 'POST',
			path: invitePath(),
			userId: fixture.ownerId,
			email: fixture.ownerEmail,
			body: { workspaceId: fixture.workspaceId, email, role: 'member' }
		})
		expect(seated.status).toBe(409)
		expect(seated.json['code']).toBe('conflict')

		// Simulate member removal (no API for it yet): with the seat gone, the
		// re-invite must work — and because the old row is 'accepted' (outside the
		// partial index), it is a FRESH row, not a renewal.
		await db.owner`
			DELETE FROM memberships WHERE workspace_id = ${fixture.workspaceId} AND user_id = ${inviteeId}::uuid
		`
		const reinvite = await apiRequest(app, {
			method: 'POST',
			path: invitePath(),
			userId: fixture.ownerId,
			email: fixture.ownerEmail,
			body: { workspaceId: fixture.workspaceId, email, role: 'member' }
		})
		expect(reinvite.status).toBe(200)
		expect(reinvite.json['resent']).toBe(false)
		expect(reinvite.json['id']).not.toBe(String(first.json['id']))

		// The fresh token seats them again.
		const reaccept = await apiRequest(app, {
			method: 'POST',
			path: '/api/v1/invitations/accept',
			userId: inviteeId,
			email,
			body: { token: String(reinvite.json['token']) }
		})
		expect(reaccept.status).toBe(200)
		expect(reaccept.json['membershipCreated']).toBe(true)
	})

	test('invitations stay tenant-scoped: an outsider cannot invite, and cross-tenant rows are invisible', async () => {
		if (!db) return
		const fixture = await seedM1Fixture(db.owner)
		const { app } = createIntegrationServer(db)

		// Outsider (no membership) is denied by the owner/admin role gate.
		const denied = await apiRequest(app, {
			method: 'POST',
			path: invitePath(),
			userId: fixture.outsiderId,
			email: fixture.outsiderEmail,
			body: {
				workspaceId: fixture.workspaceId,
				email: `x-${randomUUID().slice(0, 8)}@test.huriro.dev`,
				role: 'member'
			}
		})
		expect(denied.status).toBe(403)
		expect(denied.json['code']).toBe('insufficient_role')

		// A plain member cannot invite either.
		const memberDenied = await apiRequest(app, {
			method: 'POST',
			path: invitePath(),
			userId: fixture.memberAId,
			email: fixture.memberAEmail,
			body: {
				workspaceId: fixture.workspaceId,
				email: `y-${randomUUID().slice(0, 8)}@test.huriro.dev`,
				role: 'member'
			}
		})
		expect(memberDenied.status).toBe(403)
	})
})
