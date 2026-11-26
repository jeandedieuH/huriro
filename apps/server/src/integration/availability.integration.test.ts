/** Shared user availability integration: typed status/working hours, scheduled
 * windows, guest visibility, sync snapshot projection, and the expiry sweep.
 * Real PostgreSQL/RLS.
 */
import { beforeAll, describe, expect, test } from 'bun:test'
import type { TestDb } from '@huriro/test-utils'
import { runAvailabilitySweepOnce } from '../modules/availability'
import { apiRequest, createIntegrationServer, getTestDb, seedM1Fixture } from './test-harness'

let db: TestDb | null = null

beforeAll(async () => {
	db = await getTestDb()
})

describe('Shared user availability (PostgreSQL 18)', () => {
	test('updates typed status/working hours and exposes them through /availability/me', async () => {
		if (!db) return
		const fixture = await seedM1Fixture(db.owner)
		const { app } = createIntegrationServer(db)
		const res = await apiRequest(app, {
			method: 'PUT',
			path: '/api/v1/availability/me',
			workspaceId: fixture.workspaceId,
			userId: fixture.memberAId,
			body: {
				statusEmoji: '🌴',
				statusText: 'At the offsite',
				timezone: 'Europe/Berlin',
				workingHours: {
					enabled: true,
					timezone: 'Europe/Berlin',
					days: { mon: [{ start: '09:00', end: '17:00' }] }
				}
			}
		})
		expect(res.status).toBe(200)
		expect(res.json['statusText']).toBe('At the offsite')
		expect(res.json['timezone']).toBe('Europe/Berlin')
		const workingHours = res.json['workingHours'] as {
			enabled: boolean
			days: { mon: { start: string; end: string }[] }
		}
		expect(workingHours.enabled).toBe(true)
		expect(workingHours.days.mon).toEqual([{ start: '09:00', end: '17:00' }])

		const mine = await apiRequest(app, {
			path: '/api/v1/availability/me',
			workspaceId: fixture.workspaceId,
			userId: fixture.memberAId
		})
		expect(mine.status).toBe(200)
		expect(mine.json['displayName']).toContain('Member A')
		expect(typeof mine.json['effectiveState']).toBe('string')
	})

	test('scheduled OOO windows reject overlap and are owner-scoped', async () => {
		if (!db) return
		const fixture = await seedM1Fixture(db.owner)
		const { app } = createIntegrationServer(db)
		const base = {
			kind: 'ooo',
			title: 'Vacation',
			startsAt: '2027-01-04T08:00:00.000Z',
			endsAt: '2027-01-08T18:00:00.000Z',
			delegateUserId: fixture.memberBId
		}
		const created = await apiRequest(app, {
			method: 'POST',
			path: '/api/v1/availability/windows',
			workspaceId: fixture.workspaceId,
			userId: fixture.memberAId,
			body: base
		})
		expect(created.status).toBe(201)
		const overlap = await apiRequest(app, {
			method: 'POST',
			path: '/api/v1/availability/windows',
			workspaceId: fixture.workspaceId,
			userId: fixture.memberAId,
			body: { ...base, startsAt: '2027-01-06T00:00:00.000Z', title: 'Overlap' }
		})
		expect(overlap.status).toBe(409)

		const otherUserDelete = await apiRequest(app, {
			method: 'DELETE',
			path: `/api/v1/availability/windows/${String(created.json['id'])}`,
			workspaceId: fixture.workspaceId,
			userId: fixture.memberBId
		})
		expect(otherUserDelete.status).toBe(403)

		const list = await apiRequest(app, {
			path: '/api/v1/availability/windows',
			workspaceId: fixture.workspaceId,
			userId: fixture.memberAId
		})
		expect((list.json['data'] as unknown[]).length).toBe(1)
	})

	test('guests see only their own row; active members see the workspace', async () => {
		if (!db) return
		const fixture = await seedM1Fixture(db.owner)
		const { app } = createIntegrationServer(db)
		const guestList = await apiRequest(app, {
			path: '/api/v1/availability',
			workspaceId: fixture.workspaceId,
			userId: fixture.guestId
		})
		expect(guestList.status).toBe(200)
		const guestIds = (guestList.json['data'] as { userId: string }[]).map((row) => row.userId)
		expect(guestIds).toEqual([fixture.guestId])

		const memberList = await apiRequest(app, {
			path: '/api/v1/availability',
			workspaceId: fixture.workspaceId,
			userId: fixture.memberAId
		})
		const memberIds = (memberList.json['data'] as { userId: string }[]).map((row) => row.userId)
		expect(memberIds).toContain(fixture.memberAId)
		expect(memberIds).toContain(fixture.memberBId)
		expect(memberIds).not.toContain(fixture.suspendedId)
	})

	test('sync snapshot carries userAvailability and the sweep clears expired DND', async () => {
		if (!db) return
		const fixture = await seedM1Fixture(db.owner)
		const { app } = createIntegrationServer(db)
		const past = new Date(Date.now() - 60_000).toISOString()
		const updated = await apiRequest(app, {
			method: 'PUT',
			path: '/api/v1/availability/me',
			workspaceId: fixture.workspaceId,
			userId: fixture.memberAId,
			body: { statusText: 'Focus', dndUntil: past }
		})
		expect(updated.status).toBe(200)

		const snap = await apiRequest(app, {
			path: '/api/v1/sync/snapshot',
			workspaceId: fixture.workspaceId,
			userId: fixture.memberBId
		})
		expect(snap.status).toBe(200)
		const rows = snap.json['userAvailability'] as { userId: string }[]
		expect(rows.some((row) => row.userId === fixture.memberAId)).toBe(true)

		const swept = await runAvailabilitySweepOnce(db.app)
		expect(swept.expired).toBeGreaterThanOrEqual(1)

		const after = await apiRequest(app, {
			path: '/api/v1/availability/me',
			workspaceId: fixture.workspaceId,
			userId: fixture.memberAId
		})
		expect(after.json['dndUntil']).toBeNull()
		expect(after.json['statusText']).toBe('Focus')
	})
})
