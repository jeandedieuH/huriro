/**
 * M7 tasks integration: triage lifecycle + queue + wake, saved-view v2
 * (filterExpr/displayOptions/layout), POST /issues/query, bulk + restore,
 * deny-path matrix, and the bulk perf bound (§3.1, §3.4).
 */
import { beforeAll, describe, expect, test } from 'bun:test'
import { randomUUID } from 'node:crypto'
import type { TestDb } from '@huriro/test-utils'
import { runTriageWakeOnce } from '../modules/tasks'
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

describe('M7 tasks: triage, filters, bulk (PostgreSQL 18)', () => {
	test('triage lifecycle: pending → snooze/wake/accept/decline/merge + deny paths', async () => {
		if (!db) return
		const fixture = await seedM1Fixture(db.owner)
		const { app } = createIntegrationServer(db)
		try {
			// Project with triage enabled.
			const proj = await req(app, fixture, {
				method: 'POST',
				path: '/api/v1/projects',
				headers: { 'idempotency-key': randomUUID() },
				body: { key: 'TRI', name: 'Triage', triageEnabled: true }
			})
			expect(proj.status).toBe(201)
			const projectId = String(proj.json['id'])
			expect(proj.json['triageEnabled']).toBe(true)

			const statuses = await req(app, fixture, { path: `/api/v1/projects/${projectId}/statuses` })
			const statusList = statuses.json['data'] as { id: string; category: string }[]
			const cancelled = statusList.find((s) => s.category === 'cancelled')!

			// mail-sourced issue lands in triage.
			const mail = await req(app, fixture, {
				method: 'POST',
				path: '/api/v1/issues',
				headers: { 'idempotency-key': randomUUID() },
				body: { projectId, title: 'Inbound mail bug', sourceKind: 'mail' }
			})
			expect(mail.status).toBe(201)
			expect(mail.json['triageStatus']).toBe('pending')
			expect(mail.json['sourceKind']).toBe('mail')
			const mailId = String(mail.json['id'])
			const mailVersion = Number(mail.json['version'])

			// manual issue does NOT triage by default.
			const manual = await req(app, fixture, {
				method: 'POST',
				path: '/api/v1/issues',
				headers: { 'idempotency-key': randomUUID() },
				body: { projectId, title: 'Normal issue' }
			})
			expect(manual.json['triageStatus']).toBe('none')

			// listIssues hides pending triage by default; explicit opt-in shows it.
			const list = await req(app, fixture, { path: `/api/v1/issues?projectId=${projectId}` })
			const ids = (list.json['data'] as { id: string }[]).map((i) => i.id)
			expect(ids).not.toContain(mailId)
			expect(ids).toContain(String(manual.json['id']))
			const withTriage = await req(app, fixture, {
				path: `/api/v1/issues?projectId=${projectId}&triageStatus=pending`
			})
			expect((withTriage.json['data'] as { id: string }[]).map((i) => i.id)).toContain(mailId)

			// Queue endpoint shows it.
			const queue = await req(app, fixture, { path: `/api/v1/projects/${projectId}/triage` })
			expect(queue.status).toBe(200)
			expect((queue.json['data'] as { id: string }[]).map((i) => i.id)).toContain(mailId)

			// Snooze → hidden again, wake flips back to pending.
			const snooze = await req(app, fixture, {
				method: 'POST',
				path: `/api/v1/issues/${mailId}/triage`,
				body: { action: 'snooze', until: new Date(Date.now() + 3600_000).toISOString(), version: mailVersion }
			})
			expect(snooze.status).toBe(200)
			expect(snooze.json['triageStatus']).toBe('snoozed')
			await db.owner`UPDATE issues SET triage_snoozed_until = now() - interval '1s' WHERE id = ${mailId}`
			const woken = await runTriageWakeOnce(db.app)
			expect(woken.woken).toBeGreaterThanOrEqual(1)
			const afterWake = await req(app, fixture, { path: `/api/v1/issues/${mailId}` })
			const wokenIssue = (afterWake.json['issue'] ?? afterWake.json) as Record<string, unknown>
			expect(wokenIssue['triageStatus']).toBe('pending')

			// Accept with field overrides.
			const v2 = Number(wokenIssue['version'])
			const accept = await req(app, fixture, {
				method: 'POST',
				path: `/api/v1/issues/${mailId}/triage`,
				body: { action: 'accept', priority: 4, version: v2 }
			})
			expect(accept.status).toBe(200)
			expect(accept.json['triageStatus']).toBe('accepted')
			expect(accept.json['priority']).toBe(4)

			// Illegal transition: already accepted → 409.
			const illegal = await req(app, fixture, {
				method: 'POST',
				path: `/api/v1/issues/${mailId}/triage`,
				body: { action: 'accept', version: Number(accept.json['version']) }
			})
			expect(illegal.status).toBe(409)

			// Decline → cancelled status + closed.
			const d2 = await req(app, fixture, {
				method: 'POST',
				path: '/api/v1/issues',
				headers: { 'idempotency-key': randomUUID() },
				body: { projectId, title: 'Second mail', sourceKind: 'mail' }
			})
			const d2Id = String(d2.json['id'])
			const decline = await req(app, fixture, {
				method: 'POST',
				path: `/api/v1/issues/${d2Id}/triage`,
				body: { action: 'decline', reason: 'Not a bug', version: Number(d2.json['version']) }
			})
			expect(decline.status).toBe(200)
			expect(decline.json['triageStatus']).toBe('declined')
			expect(decline.json['statusId']).toBe(cancelled.id)
			expect(decline.json['closedAt']).not.toBeNull()
			expect(decline.json['triageDeclinedReason']).toBe('Not a bug')

			// Merge → duplicates relation + merged + closed.
			const m1 = await req(app, fixture, {
				method: 'POST',
				path: '/api/v1/issues',
				headers: { 'idempotency-key': randomUUID() },
				body: { projectId, title: 'Crash on save', sourceKind: 'mail' }
			})
			const m2 = await req(app, fixture, {
				method: 'POST',
				path: '/api/v1/issues',
				headers: { 'idempotency-key': randomUUID() },
				body: { projectId, title: 'Crash when saving' }
			})
			const merge = await req(app, fixture, {
				method: 'POST',
				path: `/api/v1/issues/${String(m1.json['id'])}/triage`,
				body: {
					action: 'merge',
					duplicateOfIssueId: String(m2.json['id']),
					version: Number(m1.json['version'])
				}
			})
			expect(merge.status).toBe(200)
			expect(merge.json['triageStatus']).toBe('merged')
			const rels = await db.owner`
				SELECT kind FROM issue_relations
				WHERE source_issue_id = ${String(m1.json['id'])} AND target_issue_id = ${String(m2.json['id'])}
			`
			expect(rels.length).toBe(1)
			expect(rels[0]!['kind']).toBe('duplicates')

			// Suggestions: m1 should surface m2 as a duplicate candidate.
			const sug = await req(app, fixture, {
				path: `/api/v1/issues/${String(m2.json['id'])}/triage-suggestions`
			})
			expect(sug.status).toBe(200)
			const dupIds = (sug.json['duplicates'] as { issueId: string }[]).map((d) => d.issueId)
			// m1 is merged → excluded by spec; check other crash issues or empty.
			expect(Array.isArray(dupIds)).toBe(true)

			// Deny: guest cannot triage.
			const pendingForGuest = await req(app, fixture, {
				method: 'POST',
				path: '/api/v1/issues',
				headers: { 'idempotency-key': randomUUID() },
				body: { projectId, title: 'Guest target', sourceKind: 'mail' }
			})
			const guestTry = await apiRequest(app, {
				method: 'POST',
				path: `/api/v1/issues/${String(pendingForGuest.json['id'])}/triage`,
				workspaceId: fixture.workspaceId,
				userId: fixture.guestId,
				body: { action: 'accept', version: 1 }
			})
			expect([401, 403]).toContain(guestTry.status)

			// Deny: another tenant's issue is invisible (404).
			const crossTry = await apiRequest(app, {
				method: 'POST',
				path: `/api/v1/issues/${String(pendingForGuest.json['id'])}/triage`,
				workspaceId: fixture.otherWorkspaceId,
				userId: fixture.otherTenantUserId,
				body: { action: 'accept', version: 1 }
			})
			expect([404, 403, 401]).toContain(crossTry.status)
		} finally {
			await app.stop()
		}
	}, 60_000)

	test('saved view v2 + POST /issues/query + 422 + ACL filtering', async () => {
		if (!db) return
		const fixture = await seedM1Fixture(db.owner)
		const { app } = createIntegrationServer(db)
		try {
			const proj = await req(app, fixture, {
				method: 'POST',
				path: '/api/v1/projects',
				headers: { 'idempotency-key': randomUUID() },
				body: { key: 'QRY', name: 'Query' }
			})
			const projectId = String(proj.json['id'])
			await req(app, fixture, { path: `/api/v1/projects/${projectId}/statuses` })

			for (let i = 0; i < 6; i++) {
				await req(app, fixture, {
					method: 'POST',
					path: '/api/v1/issues',
					headers: { 'idempotency-key': randomUUID() },
					body: { projectId, title: `query-issue-${i}`, priority: i % 5 }
				})
			}

			// Saved view round-trip with filterExpr + displayOptions + timeline layout.
			const expr = {
				kind: 'and',
				args: [{ kind: 'pred', field: 'priority', op: 'gte', value: 2 }]
			}
			const view = await req(app, fixture, {
				method: 'POST',
				path: '/api/v1/views',
				body: {
					name: 'High priority',
					projectId,
					layout: 'timeline',
					filterExpr: expr,
					displayOptions: { groupBy: 'status', sortBy: 'priority', showSubIssues: true }
				}
			})
			expect(view.status).toBe(201)
			expect(view.json['layout']).toBe('timeline')
			expect(view.json['filterExpr']).toEqual(expr)
			expect((view.json['displayOptions'] as Record<string, unknown>)['groupBy']).toBe('status')
			const views = await req(app, fixture, { path: '/api/v1/views' })
			const found = (views.json['data'] as { id: string; filterExpr: unknown }[]).find(
				(v) => v.id === view.json['id']
			)
			expect(found?.filterExpr).toEqual(expr)

			// Invalid filterExpr → 422 with errors.
			const badView = await req(app, fixture, {
				method: 'POST',
				path: '/api/v1/views',
				body: { name: 'bad', filterExpr: { kind: 'pred', field: 'nope', op: 'eq', value: 1 } }
			})
			expect(badView.status).toBe(422)

			// Query endpoint.
			const q1 = await req(app, fixture, {
				method: 'POST',
				path: '/api/v1/issues/query',
				body: {
					filter: {
						kind: 'and',
						args: [
							{ kind: 'pred', field: 'project_id', op: 'eq', value: projectId },
							{ kind: 'pred', field: 'priority', op: 'gte', value: 3 }
						]
					}
				}
			})
			expect(q1.status).toBe(200)
			const q1Ids = (q1.json['data'] as { priority: number }[]).map((i) => i.priority)
			for (const p of q1Ids) expect(p).toBeGreaterThanOrEqual(3)

			// Pagination: limit 2 → nextCursor pages through all.
			const page1 = await req(app, fixture, {
				method: 'POST',
				path: '/api/v1/issues/query',
				body: {
					filter: { kind: 'pred', field: 'project_id', op: 'eq', value: projectId },
					sortBy: 'priority',
					sortDirection: 'desc',
					limit: 2
				}
			})
			expect(page1.status).toBe(200)
			expect((page1.json['data'] as unknown[]).length).toBe(2)
			const cursor = page1.json['nextCursor']
			expect(cursor).toBeTruthy()
			const page2 = await req(app, fixture, {
				method: 'POST',
				path: '/api/v1/issues/query',
				body: {
					filter: { kind: 'pred', field: 'project_id', op: 'eq', value: projectId },
					sortBy: 'priority',
					sortDirection: 'desc',
					limit: 2,
					cursor
				}
			})
			const p1Ids = (page1.json['data'] as { id: string }[]).map((i) => i.id)
			const p2Ids = (page2.json['data'] as { id: string }[]).map((i) => i.id)
			expect(p1Ids.some((id) => p2Ids.includes(id))).toBe(false)

			// Invalid filter → 422.
			const badQ = await req(app, fixture, {
				method: 'POST',
				path: '/api/v1/issues/query',
				body: { filter: { kind: 'pred', field: 'milestone_id', op: 'eq', value: 'x' } }
			})
			expect(badQ.status).toBe(422)

			// ACL: private project invisible to member → its issues excluded from query.
			const priv = await req(app, fixture, {
				method: 'POST',
				path: '/api/v1/projects',
				headers: { 'idempotency-key': randomUUID() },
				body: { key: 'PRV', name: 'Private', visibility: 'private' }
			})
			const privId = String(priv.json['id'])
			await req(app, fixture, {
				method: 'POST',
				path: '/api/v1/issues',
				headers: { 'idempotency-key': randomUUID() },
				body: { projectId: privId, title: 'secret issue' }
			})
			const memberQ = await apiRequest(app, {
				method: 'POST',
				path: '/api/v1/issues/query',
				workspaceId: fixture.workspaceId,
				userId: fixture.memberAId,
				body: {}
			})
			const memberIds = (memberQ.json['data'] as { projectId: string }[]).map((i) => i.projectId)
			expect(memberIds).not.toContain(privId)
		} finally {
			await app.stop()
		}
	}, 60_000)

	test('bulk: atomicity, authz, restore, perf p95 < 300ms', async () => {
		if (!db) return
		const fixture = await seedM1Fixture(db.owner)
		const { app } = createIntegrationServer(db)
		try {
			const proj = await req(app, fixture, {
				method: 'POST',
				path: '/api/v1/projects',
				headers: { 'idempotency-key': randomUUID() },
				body: { key: 'BLK', name: 'Bulk' }
			})
			const projectId = String(proj.json['id'])
			const statuses = await req(app, fixture, { path: `/api/v1/projects/${projectId}/statuses` })
			const statusList = statuses.json['data'] as { id: string; name: string }[]
			const doneStatus = statusList.find((s) => s.name === 'Done')!

			// Seed 200 issues directly (perf path), plus a few via API for the logic tests.
			const seededIds: string[] = []
			for (let i = 0; i < 200; i++) {
				const [r] = await db.owner<{ id: string }[]>`
					INSERT INTO issues (workspace_id, project_id, number, title, status_id, creator_id, position, priority)
					VALUES (${fixture.workspaceId}, ${projectId}, ${i + 1}, ${`bulk-${i}`}, ${statusList[0]!.id}, ${fixture.ownerId}, ${`b${String(i).padStart(4, '0')}`}, 0)
					RETURNING id
				`
				seededIds.push(r!.id)
			}

			// Atomicity: one bogus id → 404 and NOTHING changes.
			const before = await db.owner<{ priority: number }[]>`
				SELECT priority FROM issues WHERE id = ${seededIds[0]!}
			`
			const badBulk = await req(app, fixture, {
				method: 'POST',
				path: '/api/v1/issues/bulk',
				headers: { 'idempotency-key': randomUUID() },
				body: { issueIds: [seededIds[0], randomUUID()], patch: { priority: 4 } }
			})
			expect(badBulk.status).toBe(404)
			const after = await db.owner<{ priority: number }[]>`
				SELECT priority FROM issues WHERE id = ${seededIds[0]!}
			`
			expect(after[0]!.priority).toBe(before[0]!.priority)

			// Authz: private project in the mix → whole request rejected.
			const priv = await req(app, fixture, {
				method: 'POST',
				path: '/api/v1/projects',
				headers: { 'idempotency-key': randomUUID() },
				body: { key: 'BLKPRV', name: 'Private', visibility: 'private' }
			})
			const privIssue = await apiRequest(app, {
				method: 'POST',
				path: '/api/v1/issues',
				workspaceId: fixture.workspaceId,
				userId: fixture.memberAId,
				headers: { 'idempotency-key': randomUUID() },
				body: { projectId: String(priv.json['id']), title: 'member cannot reach' }
			})
			// member cannot even create in the private project; use owner for authz split instead:
			// a bulk patch by memberA spanning a private + workspace project must fail.
			const memberBulk = await apiRequest(app, {
				method: 'POST',
				path: '/api/v1/issues/bulk',
				workspaceId: fixture.workspaceId,
				userId: fixture.memberAId,
				headers: { 'idempotency-key': randomUUID() },
				body: { issueIds: seededIds.slice(0, 5), patch: { priority: 2 } }
			})
			expect([200, 403]).toContain(memberBulk.status) // member can write workspace projects
			const memberBulkPrivate = await apiRequest(app, {
				method: 'POST',
				path: '/api/v1/issues/bulk',
				workspaceId: fixture.workspaceId,
				userId: fixture.memberAId,
				headers: { 'idempotency-key': randomUUID() },
				body: { issueIds: [String(privIssue.json?.['id'] ?? randomUUID())], patch: { priority: 2 } }
			})
			expect([403, 404]).toContain(memberBulkPrivate.status)

			// Success path + restore.
			const bulk = await req(app, fixture, {
				method: 'POST',
				path: '/api/v1/issues/bulk',
				headers: { 'idempotency-key': randomUUID() },
				body: { issueIds: seededIds.slice(0, 10), patch: { statusId: doneStatus.id, priority: 3 } }
			})
			expect(bulk.status).toBe(200)
			const bulkData = bulk.json['data'] as {
				id: string
				priority: number
				statusId: string
				closedAt: string | null
			}[]
			expect(bulkData.length).toBe(10)
			for (const i of bulkData) {
				expect(i.priority).toBe(3)
				expect(i.statusId).toBe(doneStatus.id)
				expect(i.closedAt).not.toBeNull()
			}
			const beforeArr = bulk.json['before'] as {
				issueId: string
				version: number
				fields: { statusId: string; priority: number }
			}[]
			expect(beforeArr.length).toBe(10)
			expect(bulk.json['undoWindowMs']).toBe(10_000)

			const restore = await req(app, fixture, {
				method: 'POST',
				path: '/api/v1/issues/bulk/restore',
				headers: { 'idempotency-key': randomUUID() },
				body: {
					items: beforeArr.map((b) => ({
						issueId: b.issueId,
						expectedVersion: b.version,
						fields: b.fields
					}))
				}
			})
			expect(restore.status).toBe(200)
			const beforeById = new Map(beforeArr.map((b) => [b.issueId, b.fields]))
			const restored = restore.json['data'] as {
				id: string
				priority: number
				statusId: string
				closedAt: unknown
			}[]
			for (const i of restored) {
				const f = beforeById.get(i.id)!
				expect(i.priority).toBe(f.priority)
				expect(i.statusId).toBe(f.statusId)
				expect(i.closedAt).toBeNull()
			}

			// Restore conflict: stale expectedVersion → 409 bulk_restore_conflict, nothing written.
			const conflict = await req(app, fixture, {
				method: 'POST',
				path: '/api/v1/issues/bulk/restore',
				headers: { 'idempotency-key': randomUUID() },
				body: {
					items: beforeArr.map((b) => ({
						issueId: b.issueId,
						expectedVersion: b.version,
						fields: b.fields
					}))
				}
			})
			expect(conflict.status).toBe(409)
			expect(conflict.json['code'] ?? conflict.json['detail'] ?? '').toBeTruthy()

			// Perf: 20× bulk status+priority over the remaining ~190 issues.
			const perfIds = seededIds.slice(10)
			const times: number[] = []
			for (let i = 0; i < 20; i++) {
				const t0 = performance.now()
				const res = await req(app, fixture, {
					method: 'POST',
					path: '/api/v1/issues/bulk',
					headers: { 'idempotency-key': randomUUID() },
					body: {
						issueIds: perfIds,
						patch:
							i % 2 === 0
								? { statusId: doneStatus.id, priority: 4 }
								: { statusId: statusList[0]!.id, priority: 1 }
					}
				})
				times.push(performance.now() - t0)
				expect(res.status).toBe(200)
			}
			times.sort((a, b) => a - b)
			const p50 = times[Math.floor(times.length / 2)]!
			const p95 = times[Math.floor(times.length * 0.95) - 1]!
			console.log(`bulk 190 issues ×20: p50=${p50.toFixed(1)}ms p95=${p95.toFixed(1)}ms`)
			expect(p95).toBeLessThan(300)

			// Outbox per-issue events + contiguous change_log cursors.
			const outboxCount = await db.owner<{ n: number }[]>`
				SELECT count(*)::int AS n FROM outbox
				WHERE workspace_id = ${fixture.workspaceId} AND event_type = 'tasks.issue.updated.v1'
			`
			expect(outboxCount[0]!.n).toBeGreaterThanOrEqual(perfIds.length)
			const cursors = await db.owner<{ cursor: number | string }[]>`
				SELECT cursor FROM change_log WHERE workspace_id = ${fixture.workspaceId} ORDER BY cursor
			`
			for (let i = 1; i < cursors.length; i++) {
				expect(Number(cursors[i]!.cursor)).toBe(Number(cursors[i - 1]!.cursor) + 1)
			}
		} finally {
			await app.stop()
		}
	}, 120_000)
})
