/**
 * M7 full cycles engine integration (§3.3): nightly maintenance —
 * auto-activation, auto-completion + rollover (all three modes), pre-creation,
 * daily burnup snapshots, idempotency, cross-tenant isolation, and the
 * snapshots endpoint access control.
 */
import { beforeAll, describe, expect, test } from 'bun:test'
import { randomUUID } from 'node:crypto'
import type { TestDb } from '@huriro/test-utils'
import { runCycleMaintenanceOnce } from '../modules/tasks'
import { apiRequest, createIntegrationServer, getTestDb, seedM1Fixture } from './test-harness'

let db: TestDb | null = null

beforeAll(async () => {
	db = await getTestDb()
})

function req(
	app: ReturnType<typeof createIntegrationServer>['app'],
	fixture: Awaited<ReturnType<typeof seedM1Fixture>>,
	opts: Parameters<typeof apiRequest>[1]
) {
	return apiRequest(app, { workspaceId: fixture.workspaceId, userId: fixture.ownerId, ...opts })
}

/** Monday 2026-02-23 is the reference weekday anchor for all crafted windows. */
const T1 = new Date('2026-02-24T02:00:00Z') // Tuesday

async function createCycleProject(
	app: ReturnType<typeof createIntegrationServer>['app'],
	fixture: Awaited<ReturnType<typeof seedM1Fixture>>,
	key: string,
	policy: {
		rolloverMode?: 'next_cycle' | 'backlog' | 'none'
		durationDays?: number
		cooldownDays?: number
	} = {}
): Promise<{ projectId: string; statuses: { id: string; category: string; name: string }[] }> {
	const proj = await req(app, fixture, {
		method: 'POST',
		path: '/api/v1/projects',
		headers: { 'idempotency-key': randomUUID() },
		body: {
			key,
			name: `Cycles ${key}`,
			cycleEnabled: true,
			cycleDurationDays: policy.durationDays ?? 14,
			cycleCooldownDays: policy.cooldownDays ?? 0,
			cycleStartWeekday: 1,
			cycleAutoRolloverMode: policy.rolloverMode ?? 'next_cycle'
		}
	})
	expect(proj.status).toBe(201)
	const projectId = String(proj.json['id'])
	expect(proj.json['cycleEnabled']).toBe(true)
	const statuses = await req(app, fixture, { path: `/api/v1/projects/${projectId}/statuses` })
	return { projectId, statuses: statuses.json['data'] as { id: string; category: string; name: string }[] }
}

async function createCycleRow(
	app: ReturnType<typeof createIntegrationServer>['app'],
	fixture: Awaited<ReturnType<typeof seedM1Fixture>>,
	input: {
		projectId: string
		name: string
		status: 'planned' | 'active' | 'completed'
		startsAt: string
		endsAt: string
	}
): Promise<string> {
	const res = await req(app, fixture, {
		method: 'POST',
		path: '/api/v1/cycles',
		body: {
			projectId: input.projectId,
			name: input.name,
			status: input.status,
			startsAt: input.startsAt,
			endsAt: input.endsAt
		}
	})
	expect(res.status).toBe(201)
	return String(res.json['id'])
}

async function createIssueRow(
	app: ReturnType<typeof createIntegrationServer>['app'],
	fixture: Awaited<ReturnType<typeof seedM1Fixture>>,
	input: {
		projectId: string
		cycleId?: string
		statusId?: string
		estimate?: number
		title: string
	}
): Promise<string> {
	const res = await req(app, fixture, {
		method: 'POST',
		path: '/api/v1/issues',
		headers: { 'idempotency-key': randomUUID() },
		body: {
			projectId: input.projectId,
			title: input.title,
			...(input.cycleId ? { cycleId: input.cycleId } : {}),
			...(input.statusId ? { statusId: input.statusId } : {}),
			...(input.estimate !== undefined ? { estimate: input.estimate } : {})
		}
	})
	expect(res.status).toBe(201)
	return String(res.json['id'])
}

async function workspaceCounts(sql: TestDb['owner'], workspaceId: string) {
	const [outbox] = await sql<{ n: number }[]>`
		SELECT count(*)::int AS n FROM outbox WHERE workspace_id = ${workspaceId}
	`
	const [changes] = await sql<{ n: number }[]>`
		SELECT count(*)::int AS n FROM change_log WHERE workspace_id = ${workspaceId}
	`
	const [snapshots] = await sql<{ n: number }[]>`
		SELECT count(*)::int AS n FROM cycle_daily_snapshots WHERE workspace_id = ${workspaceId}
	`
	const [cycles] = await sql<{ n: number }[]>`
		SELECT count(*)::int AS n FROM cycles WHERE workspace_id = ${workspaceId}
	`
	return {
		outbox: outbox?.n ?? 0,
		changeLog: changes?.n ?? 0,
		snapshots: snapshots?.n ?? 0,
		cycles: cycles?.n ?? 0
	}
}

describe('M7 cycles engine: nightly maintenance (PostgreSQL 18)', () => {
	test('activation, pre-creation, snapshot content + same-day idempotency', async () => {
		if (!db) return
		const fixture = await seedM1Fixture(db.owner)
		const { app } = createIntegrationServer(db)
		try {
			const { projectId, statuses } = await createCycleProject(app, fixture, 'CYA')
			const byCat = (c: string) => statuses.find((s) => s.category === c)!

			// Planned cycle due to activate: started Monday 02-23, today is Tue 02-24.
			const c1 = await createCycleRow(app, fixture, {
				projectId,
				name: 'Sprint 1',
				status: 'planned',
				startsAt: '2026-02-23',
				endsAt: '2026-03-08'
			})

			// Issues across every category, wired into the cycle.
			await createIssueRow(app, fixture, { projectId, cycleId: c1, title: 'unstarted one', estimate: 2 })
			await createIssueRow(app, fixture, {
				projectId,
				cycleId: c1,
				statusId: byCat('started').id,
				title: 'started one',
				estimate: 3
			})
			await createIssueRow(app, fixture, {
				projectId,
				cycleId: c1,
				statusId: byCat('completed').id,
				title: 'done one',
				estimate: 5
			})
			await createIssueRow(app, fixture, {
				projectId,
				cycleId: c1,
				statusId: byCat('cancelled').id,
				title: 'cancelled one',
				estimate: 7
			})
			await createIssueRow(app, fixture, {
				projectId,
				cycleId: c1,
				statusId: byCat('backlog').id,
				title: 'backlog one'
			})

			const res = await runCycleMaintenanceOnce(db.app, T1)
			expect(res.projectsProcessed).toBeGreaterThanOrEqual(1)
			expect(res.activated).toBeGreaterThanOrEqual(1)

			// C1 activated.
			const [c1row] = await db.owner<{ status: string }[]>`
				SELECT status FROM cycles WHERE id = ${c1}
			`
			expect(c1row!.status).toBe('active')

			// Pre-creation: chain after 03-08 → 03-09..03-22 + 03-23..04-05, named
			// Cycle 2 / Cycle 3 (one cycle existed when the naming count ran).
			const created = await db.owner<{ name: string; startsAt: string; endsAt: string; status: string }[]>`
				SELECT name, starts_at::text AS "startsAt", ends_at::text AS "endsAt", status
				FROM cycles
				WHERE workspace_id = ${fixture.workspaceId} AND project_id = ${projectId} AND id <> ${c1}
				ORDER BY starts_at ASC
			`
			expect(created.length).toBe(2)
			expect(created[0]).toMatchObject({
				name: 'Cycle 2',
				startsAt: '2026-03-09',
				endsAt: '2026-03-22',
				status: 'planned'
			})
			expect(created[1]).toMatchObject({
				name: 'Cycle 3',
				startsAt: '2026-03-23',
				endsAt: '2026-04-05',
				status: 'planned'
			})

			// Snapshot for the active cycle with correct grouped counts.
			const [snap] = await db.owner<Record<string, number | string>[]>`
				SELECT total_issues AS "totalIssues", completed_issues AS "completedIssues",
					started_issues AS "startedIssues", cancelled_issues AS "cancelledIssues",
					total_estimate::float8 AS "totalEstimate", completed_estimate::float8 AS "completedEstimate",
					scope_added_count AS "scopeAddedCount", scope_removed_count AS "scopeRemovedCount"
				FROM cycle_daily_snapshots
				WHERE workspace_id = ${fixture.workspaceId} AND cycle_id = ${c1} AND snapshot_date = '2026-02-24'::date
			`
			expect(snap).toBeTruthy()
			expect(Number(snap!['totalIssues'])).toBe(5)
			expect(Number(snap!['completedIssues'])).toBe(1)
			expect(Number(snap!['startedIssues'])).toBe(1)
			expect(Number(snap!['cancelledIssues'])).toBe(1)
			expect(snap!['totalEstimate']).toBe(17)
			expect(snap!['completedEstimate']).toBe(5)
			// First snapshot has no baseline → no scope delta.
			expect(Number(snap!['scopeAddedCount'])).toBe(0)
			expect(Number(snap!['scopeRemovedCount'])).toBe(0)

			// Outbox: activation + creations; change_log: cycle upserts. Sprint 1
			// itself was created through the API, so the automatic pre-created
			// ones are the two carrying the engine's `automatic` payload flag.
			const events = await db.owner<{ eventType: string; payload: Record<string, unknown> }[]>`
				SELECT event_type AS "eventType", payload FROM outbox
				WHERE workspace_id = ${fixture.workspaceId} AND event_type LIKE 'tasks.cycle.%'
			`
			const types = events.map((e) => e.eventType)
			expect(types).toContain('tasks.cycle.activated.v1')
			const automaticCreates = events.filter(
				(e) => e.eventType === 'tasks.cycle.created.v1' && e.payload['automatic'] === true
			)
			expect(automaticCreates.length).toBe(2)
			const cycleChanges = await db.owner<{ n: number }[]>`
				SELECT count(*)::int AS n FROM change_log
				WHERE workspace_id = ${fixture.workspaceId} AND entity_type = 'cycle'
			`
			// C1 creation + activation + 2 pre-created (each insert+upsert events may merge) — at least 3.
			expect(cycleChanges[0]!.n).toBeGreaterThanOrEqual(3)

			// Idempotency: a second run with the same `now` writes nothing new.
			const before = await workspaceCounts(db.owner, fixture.workspaceId)
			const res2 = await runCycleMaintenanceOnce(db.app, T1)
			const after = await workspaceCounts(db.owner, fixture.workspaceId)
			expect(after).toEqual(before)
			// The fixture's project contributes zero mutations on the re-run — global
			// counters can still move from other tenants' projects in the shared db.
			void res2
		} finally {
			await app.stop()
		}
	}, 60_000)

	test('completion + rollover in all three modes', async () => {
		if (!db) return
		const fixture = await seedM1Fixture(db.owner)
		const { app } = createIntegrationServer(db)
		try {
			// ---- mode next_cycle WITH an existing planned successor ----
			const p1 = await createCycleProject(app, fixture, 'RNC')
			const c1 = await createCycleRow(app, fixture, {
				projectId: p1.projectId,
				name: 'Sprint 1',
				status: 'active',
				startsAt: '2026-02-09',
				endsAt: '2026-02-22'
			})
			const c2 = await createCycleRow(app, fixture, {
				projectId: p1.projectId,
				name: 'Sprint 2',
				status: 'planned',
				startsAt: '2026-02-23',
				endsAt: '2026-03-08'
			})
			const byCat1 = (c: string) => p1.statuses.find((s) => s.category === c)!
			const unstarted = byCat1('unstarted').id
			const keep1 = await createIssueRow(app, fixture, {
				projectId: p1.projectId,
				cycleId: c1,
				title: 'roll me 1'
			})
			const keep2 = await createIssueRow(app, fixture, {
				projectId: p1.projectId,
				cycleId: c1,
				statusId: byCat1('started').id,
				title: 'roll me 2'
			})
			const stayDone = await createIssueRow(app, fixture, {
				projectId: p1.projectId,
				cycleId: c1,
				statusId: byCat1('completed').id,
				title: 'stay done'
			})
			const stayCancelled = await createIssueRow(app, fixture, {
				projectId: p1.projectId,
				cycleId: c1,
				statusId: byCat1('cancelled').id,
				title: 'stay cancelled'
			})
			const keep3 = await createIssueRow(app, fixture, {
				projectId: p1.projectId,
				cycleId: c1,
				statusId: unstarted,
				title: 'roll me 3'
			})

			// ---- mode next_cycle WITHOUT a successor → one is created on the spot ----
			const p2 = await createCycleProject(app, fixture, 'RNN')
			const cSolo = await createCycleRow(app, fixture, {
				projectId: p2.projectId,
				name: 'Sprint 1',
				status: 'active',
				startsAt: '2026-02-09',
				endsAt: '2026-02-22'
			})
			const solo1 = await createIssueRow(app, fixture, {
				projectId: p2.projectId,
				cycleId: cSolo,
				title: 'solo roll 1'
			})
			const solo2 = await createIssueRow(app, fixture, {
				projectId: p2.projectId,
				cycleId: cSolo,
				title: 'solo roll 2'
			})

			// ---- mode backlog ----
			const p3 = await createCycleProject(app, fixture, 'RBL', { rolloverMode: 'backlog' })
			const cBacklog = await createCycleRow(app, fixture, {
				projectId: p3.projectId,
				name: 'Sprint 1',
				status: 'active',
				startsAt: '2026-02-09',
				endsAt: '2026-02-22'
			})
			const bl1 = await createIssueRow(app, fixture, {
				projectId: p3.projectId,
				cycleId: cBacklog,
				title: 'backlog me'
			})
			const byCat3 = (c: string) => p3.statuses.find((s) => s.category === c)!
			const blDone = await createIssueRow(app, fixture, {
				projectId: p3.projectId,
				cycleId: cBacklog,
				statusId: byCat3('completed').id,
				title: 'already done'
			})

			// ---- mode none ----
			const p4 = await createCycleProject(app, fixture, 'RNO', { rolloverMode: 'none' })
			const cNone = await createCycleRow(app, fixture, {
				projectId: p4.projectId,
				name: 'Sprint 1',
				status: 'active',
				startsAt: '2026-02-09',
				endsAt: '2026-02-22'
			})
			const none1 = await createIssueRow(app, fixture, {
				projectId: p4.projectId,
				cycleId: cNone,
				title: 'untouched'
			})

			const res = await runCycleMaintenanceOnce(db.app, T1)
			expect(res.completed).toBeGreaterThanOrEqual(4)
			expect(res.rolledOver).toBeGreaterThanOrEqual(6)

			// next_cycle with successor: unfinished moved to c2, closed stayed.
			const moved = await db.owner<{ id: string; cycleId: string | null }[]>`
				SELECT id, cycle_id AS "cycleId" FROM issues
				WHERE id = ANY(${[keep1, keep2, keep3, stayDone, stayCancelled]}::uuid[])
			`
			const byId = new Map(moved.map((r) => [r.id, r.cycleId]))
			expect(byId.get(keep1)).toBe(c2)
			expect(byId.get(keep2)).toBe(c2)
			expect(byId.get(keep3)).toBe(c2)
			expect(byId.get(stayDone)).toBe(c1)
			expect(byId.get(stayCancelled)).toBe(c1)

			const [c1row] = await db.owner<{ status: string }[]>`SELECT status FROM cycles WHERE id = ${c1}`
			expect(c1row!.status).toBe('completed')

			// rolled_over event for c1: 3 issues, existing successor as target.
			const rollEvents = await db.owner<{ payload: Record<string, unknown> }[]>`
				SELECT payload FROM outbox
				WHERE workspace_id = ${fixture.workspaceId}
					AND event_type = 'tasks.cycle.rolled_over.v1'
					AND aggregate_id = ${c1}
			`
			expect(rollEvents.length).toBe(1)
			expect(rollEvents[0]!.payload['issueCount']).toBe(3)
			expect(rollEvents[0]!.payload['mode']).toBe('next_cycle')
			expect(rollEvents[0]!.payload['targetCycleId']).toBe(c2)

			// next_cycle without successor: a cycle was created and received the issues.
			const soloMoved = await db.owner<{ id: string; cycleId: string | null }[]>`
				SELECT id, cycle_id AS "cycleId" FROM issues WHERE id = ANY(${[solo1, solo2]}::uuid[])
			`
			expect(soloMoved.length).toBe(2)
			const targetId = soloMoved[0]!.cycleId
			expect(targetId).toBeTruthy()
			expect(targetId).not.toBe(cSolo)
			expect(soloMoved[1]!.cycleId).toBe(targetId)
			const [targetCycle] = await db.owner<{ status: string; startsAt: string; endsAt: string }[]>`
				SELECT status, starts_at::text AS "startsAt", ends_at::text AS "endsAt" FROM cycles WHERE id = ${targetId}
			`
			expect(targetCycle!.status).toBe('planned')
			// Created target starts after the completed cycle's end.
			expect(targetCycle!.startsAt > '2026-02-22').toBe(true)
			const soloRollEvents = await db.owner<{ payload: Record<string, unknown> }[]>`
				SELECT payload FROM outbox
				WHERE workspace_id = ${fixture.workspaceId}
					AND event_type = 'tasks.cycle.rolled_over.v1'
					AND aggregate_id = ${cSolo}
			`
			expect(soloRollEvents.length).toBe(1)
			expect(soloRollEvents[0]!.payload['targetCycleId']).toBe(targetId)
			expect(soloRollEvents[0]!.payload['issueCount']).toBe(2)

			// backlog: cycle_id NULL, no target in the event payload.
			const [blRow] = await db.owner<{ cycleId: string | null }[]>`
				SELECT cycle_id AS "cycleId" FROM issues WHERE id = ${bl1}
			`
			expect(blRow!.cycleId).toBeNull()
			const [blDoneRow] = await db.owner<{ cycleId: string | null }[]>`
				SELECT cycle_id AS "cycleId" FROM issues WHERE id = ${blDone}
			`
			expect(blDoneRow!.cycleId).toBe(cBacklog)
			const blEvents = await db.owner<{ payload: Record<string, unknown> }[]>`
				SELECT payload FROM outbox
				WHERE workspace_id = ${fixture.workspaceId}
					AND event_type = 'tasks.cycle.rolled_over.v1'
					AND aggregate_id = ${cBacklog}
			`
			expect(blEvents.length).toBe(1)
			expect(blEvents[0]!.payload['mode']).toBe('backlog')
			expect(blEvents[0]!.payload['targetCycleId']).toBeUndefined()
			expect(blEvents[0]!.payload['issueCount']).toBe(1)

			// none: completed but untouched, and NO rolled_over event at all.
			const [noneRow] = await db.owner<{ cycleId: string | null }[]>`
				SELECT cycle_id AS "cycleId" FROM issues WHERE id = ${none1}
			`
			expect(noneRow!.cycleId).toBe(cNone)
			const [cNoneRow] = await db.owner<{ status: string }[]>`SELECT status FROM cycles WHERE id = ${cNone}`
			expect(cNoneRow!.status).toBe('completed')
			const noneEvents = await db.owner<{ payload: Record<string, unknown> }[]>`
				SELECT payload FROM outbox
				WHERE workspace_id = ${fixture.workspaceId}
					AND event_type = 'tasks.cycle.rolled_over.v1'
					AND aggregate_id = ${cNone}
			`
			expect(noneEvents.length).toBe(0)

			// Per-issue change_log upserts for the rolled issues.
			const issueChanges = await db.owner<{ entityId: string }[]>`
				SELECT entity_id AS "entityId" FROM change_log
				WHERE workspace_id = ${fixture.workspaceId}
					AND entity_type = 'issue'
					AND entity_id = ANY(${[keep1, keep2, keep3, solo1, solo2, bl1]}::uuid[])
			`
			const changedIds = new Set(issueChanges.map((r) => r.entityId))
			for (const id of [keep1, keep2, keep3, solo1, solo2, bl1]) {
				expect(changedIds.has(id)).toBe(true)
			}
		} finally {
			await app.stop()
		}
	}, 90_000)

	test('day progression: activation after completion, scope delta in snapshots', async () => {
		if (!db) return
		const fixture = await seedM1Fixture(db.owner)
		const { app } = createIntegrationServer(db)
		try {
			const { projectId } = await createCycleProject(app, fixture, 'CDP', { durationDays: 7 })
			// Active cycle ending Sunday 02-22; successor starts Monday 02-23.
			const c1 = await createCycleRow(app, fixture, {
				projectId,
				name: 'Sprint 1',
				status: 'active',
				startsAt: '2026-02-16',
				endsAt: '2026-02-22'
			})
			const c2 = await createCycleRow(app, fixture, {
				projectId,
				name: 'Sprint 2',
				status: 'planned',
				startsAt: '2026-02-23',
				endsAt: '2026-03-01'
			})
			const r1 = await createIssueRow(app, fixture, { projectId, cycleId: c1, title: 'carry 1' })
			const r2 = await createIssueRow(app, fixture, { projectId, cycleId: c1, title: 'carry 2' })

			// Day 1 (Tue 02-24): c1 completes + rolls into c2, and c2 activates in
			// the SAME pass — completion runs before activation precisely so a due
			// successor does not lose its first day. c2 gets its first snapshot.
			await runCycleMaintenanceOnce(db.app, T1)
			const [c2afterD1] = await db.owner<{ status: string }[]>`SELECT status FROM cycles WHERE id = ${c2}`
			expect(c2afterD1!.status).toBe('active')
			const [snapD1] = await db.owner<Record<string, number | string>[]>`
			SELECT total_issues AS "totalIssues" FROM cycle_daily_snapshots
			WHERE workspace_id = ${fixture.workspaceId} AND cycle_id = ${c2} AND snapshot_date = '2026-02-24'::date
			`
			expect(snapD1).toBeTruthy()
			expect(Number(snapD1!['totalIssues'])).toBe(2)

			// Day 2 (Wed 02-25): steady state — second snapshot, no scope delta.
			const T2 = new Date('2026-02-25T02:00:00Z')
			await runCycleMaintenanceOnce(db.app, T2)
			const [snapD2] = await db.owner<Record<string, number | string>[]>`
			SELECT total_issues AS "totalIssues", scope_added_count AS "scopeAdded", scope_removed_count AS "scopeRemoved"
			FROM cycle_daily_snapshots
			WHERE workspace_id = ${fixture.workspaceId} AND cycle_id = ${c2} AND snapshot_date = '2026-02-25'::date
			`
			expect(snapD2).toBeTruthy()
			expect(Number(snapD2!['totalIssues'])).toBe(2)
			expect(Number(snapD2!['scopeAdded'])).toBe(0)
			expect(Number(snapD2!['scopeRemoved'])).toBe(0)

			// Day 3 (Thu 02-26): one more issue enters the cycle mid-flight → scope +1.
			await createIssueRow(app, fixture, { projectId, cycleId: c2, title: 'scope creep' })
			const T3 = new Date('2026-02-26T02:00:00Z')
			await runCycleMaintenanceOnce(db.app, T3)
			const [snapD3] = await db.owner<Record<string, number | string>[]>`
				SELECT total_issues AS "totalIssues", scope_added_count AS "scopeAdded", scope_removed_count AS "scopeRemoved"
				FROM cycle_daily_snapshots
				WHERE workspace_id = ${fixture.workspaceId} AND cycle_id = ${c2} AND snapshot_date = '2026-02-26'::date
			`
			expect(Number(snapD3!['totalIssues'])).toBe(3)
			expect(Number(snapD3!['scopeAdded'])).toBe(1)
			expect(Number(snapD3!['scopeRemoved'])).toBe(0)

			// Day 4 (Fri 02-27): the scope-creep issue is soft-deleted → scope -1.
			const creep = await db.owner<{ id: string }[]>`
				SELECT id FROM issues WHERE workspace_id = ${fixture.workspaceId} AND title = 'scope creep'
			`
			await db.owner`UPDATE issues SET deleted_at = now() WHERE id = ${creep[0]!.id}`
			const T4 = new Date('2026-02-27T02:00:00Z')
			await runCycleMaintenanceOnce(db.app, T4)
			const [snapD4] = await db.owner<Record<string, number | string>[]>`
				SELECT total_issues AS "totalIssues", scope_added_count AS "scopeAdded", scope_removed_count AS "scopeRemoved"
				FROM cycle_daily_snapshots
				WHERE workspace_id = ${fixture.workspaceId} AND cycle_id = ${c2} AND snapshot_date = '2026-02-27'::date
			`
			expect(Number(snapD4!['totalIssues'])).toBe(2)
			expect(Number(snapD4!['scopeAdded'])).toBe(0)
			expect(Number(snapD4!['scopeRemoved'])).toBe(1)

			// Snapshot series is ascending per the endpoint contract; the two carried
			// issues still reference c2.
			const carried = await db.owner<{ cycleId: string | null }[]>`
				SELECT cycle_id AS "cycleId" FROM issues WHERE id = ANY(${[r1, r2]}::uuid[])
			`
			for (const r of carried) expect(r.cycleId).toBe(c2)
		} finally {
			await app.stop()
		}
	}, 90_000)

	test('snapshots endpoint access control + cross-tenant isolation', async () => {
		if (!db) return
		const fixture = await seedM1Fixture(db.owner)
		const { app } = createIntegrationServer(db)
		try {
			const { projectId } = await createCycleProject(app, fixture, 'CAC')
			const c1 = await createCycleRow(app, fixture, {
				projectId,
				name: 'Sprint 1',
				status: 'planned',
				startsAt: '2026-02-23',
				endsAt: '2026-03-08'
			})
			await createIssueRow(app, fixture, { projectId, cycleId: c1, title: 'scoped' })
			await runCycleMaintenanceOnce(db.app, T1)

			// Member reads the series ascending.
			const memberRes = await apiRequest(app, {
				path: `/api/v1/cycles/${c1}/snapshots`,
				workspaceId: fixture.workspaceId,
				userId: fixture.memberAId
			})
			expect(memberRes.status).toBe(200)
			const series = memberRes.json['data'] as {
				snapshotDate: string
				totalIssues: number
				cycleId: string
				workspaceId: string
				totalEstimate: number
			}[]
			expect(series.length).toBe(1)
			expect(series[0]!.cycleId).toBe(c1)
			expect(series[0]!.snapshotDate).toBe('2026-02-24')
			expect(series[0]!.totalIssues).toBe(1)
			for (let i = 1; i < series.length; i++) {
				expect(series[i]!.snapshotDate > series[i - 1]!.snapshotDate).toBe(true)
			}

			// Guest without an ACL grant is denied.
			const guestRes = await apiRequest(app, {
				path: `/api/v1/cycles/${c1}/snapshots`,
				workspaceId: fixture.workspaceId,
				userId: fixture.guestId
			})
			expect([401, 403]).toContain(guestRes.status)

			// Cross-tenant: the cycle id is invisible from workspace B (404).
			const crossRes = await apiRequest(app, {
				path: `/api/v1/cycles/${c1}/snapshots`,
				workspaceId: fixture.otherWorkspaceId,
				userId: fixture.otherTenantUserId
			})
			expect([401, 403, 404]).toContain(crossRes.status)

			// Unknown cycle → 404.
			const missing = await req(app, fixture, { path: `/api/v1/cycles/${randomUUID()}/snapshots` })
			expect(missing.status).toBe(404)

			// ---- isolation: a cycle-enabled project in workspace B is processed in
			// its own tenant tx; a NON-enabled project anywhere stays untouched. ----
			const wsBProject = await db.owner<{ id: string }[]>`
				INSERT INTO projects (workspace_id, key, name, position, cycle_enabled, cycle_start_weekday)
				VALUES (${fixture.otherWorkspaceId}, 'CTB', 'Tenant B cycles', 'ctb0', true, 1)
				RETURNING id
			`
			const bProjectId = wsBProject[0]!.id
			const bCycle = await db.owner<{ id: string }[]>`
				INSERT INTO cycles (workspace_id, project_id, name, status, starts_at, ends_at)
				VALUES (${fixture.otherWorkspaceId}, ${bProjectId}, 'B Sprint', 'planned', '2026-02-23'::date, '2026-03-08'::date)
				RETURNING id
			`
			const bCycleId = bCycle[0]!.id
			// Non-enabled project in workspace B with a due planned cycle — never discovered.
			const offProject = await db.owner<{ id: string }[]>`
				INSERT INTO projects (workspace_id, key, name, position, cycle_enabled)
				VALUES (${fixture.otherWorkspaceId}, 'CTO', 'Tenant B no-cycles', 'cto0', false)
				RETURNING id
			`
			const offCycle = await db.owner<{ id: string }[]>`
				INSERT INTO cycles (workspace_id, project_id, name, status, starts_at, ends_at)
				VALUES (${fixture.otherWorkspaceId}, ${offProject[0]!.id}, 'Off Sprint', 'planned', '2026-02-23'::date, '2026-03-08'::date)
				RETURNING id
			`

			const bBefore = await workspaceCounts(db.owner, fixture.otherWorkspaceId)
			await runCycleMaintenanceOnce(db.app, T1)

			// B's enabled project activated its cycle…
			const [bRow] = await db.owner<{ status: string }[]>`SELECT status FROM cycles WHERE id = ${bCycleId}`
			expect(bRow!.status).toBe('active')
			// …in workspace B's own outbox — tenant-scoped, never A's.
			const bEvents = await db.owner<{ workspaceId: string }[]>`
				SELECT workspace_id AS "workspaceId" FROM outbox
				WHERE event_type = 'tasks.cycle.activated.v1' AND aggregate_id = ${bCycleId}
			`
			expect(bEvents.length).toBe(1)
			expect(bEvents[0]!.workspaceId).toBe(fixture.otherWorkspaceId)
			// …while the non-enabled project's cycle is completely untouched.
			const [offRow] = await db.owner<{ status: string; version: number }[]>`
				SELECT status, version FROM cycles WHERE id = ${offCycle[0]!.id}
			`
			expect(offRow!.status).toBe('planned')
			expect(offRow!.version).toBe(1)

			// Nothing in workspace A references tenant B's cycle ids (or vice versa).
			const crossChanges = await db.owner<{ n: number }[]>`
				SELECT count(*)::int AS n FROM change_log
				WHERE workspace_id = ${fixture.workspaceId} AND entity_id = ${bCycleId}
			`
			expect(crossChanges[0]!.n).toBe(0)
			const bAfter = await workspaceCounts(db.owner, fixture.otherWorkspaceId)
			expect(bAfter.outbox).toBeGreaterThan(bBefore.outbox)
		} finally {
			await app.stop()
		}
	}, 90_000)
})
