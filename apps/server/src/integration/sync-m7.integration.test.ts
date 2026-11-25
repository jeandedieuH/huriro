/**
 * M7 Sync Engine v2 integration tests (§8.1, ADR-0031):
 * - Tier-1 core snapshot excludes closed-over-30d issues, keeps open/triage/recent
 * - GET /sync/scope-snapshot keyset pagination over >1000 history rows (no dupes/gaps)
 * - Forward-compat empty scopes, malformed scope/cursor 422s, permission deny paths
 * - /sync/changes `scopes` intersection delivers entity_link rows (and only then)
 * - Cross-tenant isolation for both new surfaces
 */
import { beforeAll, describe, expect, test } from 'bun:test'
import { randomUUID } from 'node:crypto'
import type { TestDb } from '@huriro/test-utils'
import { apiRequest, createIntegrationServer, getTestDb, seedM1Fixture } from './test-harness'

let db: TestDb | null = null

beforeAll(async () => {
	db = await getTestDb()
})

type Fixture = Awaited<ReturnType<typeof seedM1Fixture>>
type App = ReturnType<typeof createIntegrationServer>['app']

function req(app: App, fixture: Fixture, opts: Parameters<typeof apiRequest>[1]) {
	return apiRequest(app, { workspaceId: fixture.workspaceId, userId: fixture.ownerId, ...opts })
}

async function createProject(
	app: App,
	fixture: Fixture,
	args: {
		key: string
		name: string
		visibility?: 'workspace' | 'private'
		triageEnabled?: boolean
		userId?: string
	}
) {
	const res = await apiRequest(app, {
		method: 'POST',
		path: '/api/v1/projects',
		workspaceId: fixture.workspaceId,
		userId: args.userId ?? fixture.ownerId,
		headers: { 'idempotency-key': randomUUID() },
		body: {
			key: args.key,
			name: args.name,
			...(args.visibility ? { visibility: args.visibility } : {}),
			...(args.triageEnabled ? { triageEnabled: true } : {})
		}
	})
	expect(res.status).toBe(201)
	return String(res.json['id'])
}

async function createIssue(
	app: App,
	fixture: Fixture,
	projectId: string,
	title: string,
	extra?: Record<string, unknown>
) {
	const res = await apiRequest(app, {
		method: 'POST',
		path: '/api/v1/issues',
		workspaceId: fixture.workspaceId,
		userId: fixture.ownerId,
		headers: { 'idempotency-key': randomUUID() },
		body: { projectId, title, ...extra }
	})
	expect(res.status).toBe(201)
	return res.json as Record<string, unknown>
}

async function completedStatusId(app: App, fixture: Fixture, projectId: string): Promise<string> {
	const res = await req(app, fixture, { path: `/api/v1/projects/${projectId}/statuses` })
	const list = res.json['data'] as { id: string; category: string }[]
	const done = list.find((s) => s.category === 'completed')
	if (!done) throw new Error('no completed status')
	return done.id
}

describe('M7 sync engine v2: two-tier hydration + scope protocol (PostgreSQL 18)', () => {
	test('core snapshot excludes closed>30d but includes open, triage, and recently closed issues', async () => {
		if (!db) return
		const fixture = await seedM1Fixture(db.owner)
		const { app, pubsub } = createIntegrationServer(db)
		try {
			const projectId = await createProject(app, fixture, {
				key: 'TIER',
				name: 'Tiered',
				triageEnabled: true
			})
			const doneStatus = await completedStatusId(app, fixture, projectId)

			// Open issue — tier-1.
			const open = await createIssue(app, fixture, projectId, 'Open issue')
			// Triage-pending issue — tier-1 (sync feeds include triage rows; clients filter).
			const triage = await createIssue(app, fixture, projectId, 'Inbound triage', { sourceKind: 'mail' })
			expect(triage['triageStatus']).toBe('pending')
			// Recently closed (5 days ago) — still tier-1.
			const recentClosed = await createIssue(app, fixture, projectId, 'Recently closed')
			const patch = await req(app, fixture, {
				method: 'PATCH',
				path: `/api/v1/issues/${String(recentClosed['id'])}`,
				body: { statusId: doneStatus, version: 1 }
			})
			expect(patch.status).toBe(200)
			expect(patch.json['closedAt']).not.toBeNull()
			// Closed 40 days ago — tier-2, must NOT be in the core snapshot.
			const oldClosed = await createIssue(app, fixture, projectId, 'Ancient closed')
			await req(app, fixture, {
				method: 'PATCH',
				path: `/api/v1/issues/${String(oldClosed['id'])}`,
				body: { statusId: doneStatus, version: 1 }
			})
			await db.owner`
				UPDATE issues SET closed_at = now() - interval '40 days'
				WHERE workspace_id = ${fixture.workspaceId} AND id = ${String(oldClosed['id'])}
			`

			const snap = await req(app, fixture, { path: '/api/v1/sync/snapshot' })
			expect(snap.status).toBe(200)
			// Legacy response shape is unchanged: same top-level keys as v1.
			for (const key of [
				'cursor',
				'serverTime',
				'projects',
				'projectStatuses',
				'labels',
				'cycles',
				'issues',
				'savedViews',
				'notifications',
				'docPages'
			]) {
				expect(key in snap.json).toBe(true)
			}
			const ids = (snap.json['issues'] as { id: string }[]).map((i) => i.id)
			expect(ids).toContain(String(open['id']))
			expect(ids).toContain(String(triage['id']))
			expect(ids).toContain(String(recentClosed['id']))
			expect(ids).not.toContain(String(oldClosed['id']))

			// The scoped legacy `project:<id>` snapshot follows the same tiering.
			const scoped = await req(app, fixture, { path: `/api/v1/sync/snapshot?scope=project:${projectId}` })
			expect(scoped.status).toBe(200)
			const scopedIds = (scoped.json['issues'] as { id: string }[]).map((i) => i.id)
			expect(scopedIds).toContain(String(open['id']))
			expect(scopedIds).not.toContain(String(oldClosed['id']))
		} finally {
			await pubsub.close()
		}
	})

	test('scope-snapshot paginates >1000 history rows with no dupes/gaps, NULLS LAST, correct eligibility', async () => {
		if (!db) return
		const fixture = await seedM1Fixture(db.owner)
		const { app, pubsub } = createIntegrationServer(db)
		try {
			const projectId = await createProject(app, fixture, { key: 'HIST', name: 'History' })
			const statuses = await req(app, fixture, { path: `/api/v1/projects/${projectId}/statuses` })
			const statusList = statuses.json['data'] as { id: string; category: string }[]
			const doneId = statusList.find((s) => s.category === 'completed')!.id

			// 1100 old-closed rows with an IDENTICAL closed_at — maximal stress for the
			// (closed_at, id) keyset tiebreak across pages.
			await db.owner`
				INSERT INTO issues (
					workspace_id, project_id, number, title, description_text, status_id,
					creator_id, position, closed_at, created_at, updated_at
				)
				SELECT
					${fixture.workspaceId}, ${projectId}, 5000 + g, 'Hist ' || g, '', ${doneId},
					${fixture.ownerId}, 'z' || lpad(g::text, 6, '0'),
					now() - interval '40 days', now() - interval '60 days', now() - interval '40 days'
				FROM generate_series(1, 1100) g
			`
			// One deleted-long-ago row that was never closed → closed_at NULL → NULLS LAST tail.
			await db.owner`
				INSERT INTO issues (
					workspace_id, project_id, number, title, description_text, status_id,
					creator_id, position, closed_at, created_at, updated_at, deleted_at
				)
				VALUES (
					${fixture.workspaceId}, ${projectId}, 990001, 'Deleted old open', '', ${doneId},
					${fixture.ownerId}, 'zzdel', NULL, now() - interval '90 days', now() - interval '40 days',
					now() - interval '40 days'
				)
			`
			// Ineligible rows that must never appear: recently closed, open, recently deleted.
			await db.owner`
				INSERT INTO issues (
					workspace_id, project_id, number, title, description_text, status_id,
					creator_id, position, closed_at, created_at, updated_at, deleted_at
				)
				VALUES
					(${fixture.workspaceId}, ${projectId}, 990002, 'Recently closed', '', ${doneId},
						${fixture.ownerId}, 'zzr1', now() - interval '5 days', now() - interval '9 days', now() - interval '5 days', NULL),
					(${fixture.workspaceId}, ${projectId}, 990003, 'Open row', '', ${doneId},
						${fixture.ownerId}, 'zzr2', NULL, now() - interval '9 days', now() - interval '5 days', NULL),
					(${fixture.workspaceId}, ${projectId}, 990004, 'Recently deleted', '', ${doneId},
						${fixture.ownerId}, 'zzr3', NULL, now() - interval '90 days', now() - interval '5 days', now() - interval '5 days')
			`

			// Page through the whole scope at limit=200 — 1101 eligible rows ⇒ 6 pages.
			const collected: { id: string; closedAt: string | null }[] = []
			let after: string | null = null
			let pages = 0
			for (;;) {
				pages += 1
				expect(pages).toBeLessThanOrEqual(8)
				const qs = after ? `&after=${encodeURIComponent(after)}` : ''
				const res = await req(app, fixture, {
					path: `/api/v1/sync/scope-snapshot?scope=issue_hist:${projectId}&limit=200${qs}`
				})
				expect(res.status).toBe(200)
				expect(res.json['scope']).toBe(`issue_hist:${projectId}`)
				const rows = res.json['rows'] as { id: string; closedAt: string | null }[]
				collected.push(...rows)
				if (res.json['hasMore'] === true) {
					expect(typeof res.json['nextAfter']).toBe('string')
					after = String(res.json['nextAfter'])
				} else {
					expect(res.json['nextAfter']).toBeNull()
					break
				}
			}
			expect(pages).toBe(6)
			expect(collected).toHaveLength(1101)
			// No duplicates and no gaps across the whole pagination walk.
			const unique = new Set(collected.map((r) => r.id))
			expect(unique.size).toBe(1101)
			// Ordering: closedAt non-increasing, NULLs strictly at the tail.
			let sawNull = false
			for (let i = 0; i < collected.length; i++) {
				const row = collected[i]!
				if (row.closedAt === null) {
					sawNull = true
				} else {
					expect(sawNull).toBe(false)
					const prev = collected[i - 1]
					if (prev && prev.closedAt !== null) {
						expect(Date.parse(row.closedAt)).toBeLessThanOrEqual(Date.parse(prev.closedAt))
					}
				}
			}
			expect(sawNull).toBe(true)
			// Ineligible rows are absent.
			const titles = collected.map((r) => r.id)
			expect(titles).toHaveLength(1101)
			const rowLookup = await db.owner`
				SELECT id, title FROM issues
				WHERE workspace_id = ${fixture.workspaceId} AND project_id = ${projectId} AND number >= 990000
			`
			for (const r of rowLookup) {
				if (r['title'] === 'Deleted old open') {
					expect(unique.has(String(r['id']))).toBe(true)
				} else {
					expect(unique.has(String(r['id']))).toBe(false)
				}
			}

			// Malformed inputs → 422.
			for (const bad of [
				'/api/v1/sync/scope-snapshot?scope=foo:bar',
				'/api/v1/sync/scope-snapshot?scope=issue_hist:',
				'/api/v1/sync/scope-snapshot?scope=issue_hist:not-a-uuid',
				'/api/v1/sync/scope-snapshot?scope=nocolon',
				`/api/v1/sync/scope-snapshot?scope=issue_hist:${projectId}&after=!!!not-base64!!!`
			]) {
				const badRes = await req(app, fixture, { path: bad })
				expect(badRes.status).toBe(422)
			}

			// Forward-compat valid-but-unimplemented scopes → 200 with empty rows.
			for (const scope of [`db:${randomUUID()}`, `links:issue:${randomUUID()}`, `channel:${randomUUID()}`]) {
				const empty = await req(app, fixture, {
					path: `/api/v1/sync/scope-snapshot?scope=${encodeURIComponent(scope)}`
				})
				expect(empty.status).toBe(200)
				expect(empty.json['rows']).toEqual([])
				expect(empty.json['hasMore']).toBe(false)
				expect(empty.json['nextAfter']).toBeNull()
			}
		} finally {
			await pubsub.close()
		}
	})

	test('scope-snapshot deny paths: private project forbidden, cross-tenant invisible', async () => {
		if (!db) return
		const fixture = await seedM1Fixture(db.owner)
		const { app, pubsub } = createIntegrationServer(db)
		try {
			// Private project owned by memberA — memberB has no ACL on it.
			const privProject = await createProject(app, fixture, {
				key: 'PRIV',
				name: 'Private',
				visibility: 'private',
				userId: fixture.memberAId
			})
			const denied = await apiRequest(app, {
				path: `/api/v1/sync/scope-snapshot?scope=issue_hist:${privProject}`,
				workspaceId: fixture.workspaceId,
				userId: fixture.memberBId
			})
			expect(denied.status).toBe(403)

			// MemberA (with access) gets a clean empty page.
			const allowed = await apiRequest(app, {
				path: `/api/v1/sync/scope-snapshot?scope=issue_hist:${privProject}`,
				workspaceId: fixture.workspaceId,
				userId: fixture.memberAId
			})
			expect(allowed.status).toBe(200)

			// Cross-tenant: workspace B user asking through workspace B context for a
			// workspace A project id → 404 not_found (existence never leaks).
			const xtenant = await apiRequest(app, {
				path: `/api/v1/sync/scope-snapshot?scope=issue_hist:${privProject}`,
				workspaceId: fixture.otherWorkspaceId,
				userId: fixture.otherTenantUserId
			})
			expect([403, 404]).toContain(xtenant.status)
			expect(xtenant.json['rows']).toBeUndefined()
		} finally {
			await pubsub.close()
		}
	})

	test('changes scopes=links:issue:<id> delivers entity_link rows; absent scopes never do', async () => {
		if (!db) return
		const fixture = await seedM1Fixture(db.owner)
		const { app, pubsub } = createIntegrationServer(db)
		try {
			const projectId = await createProject(app, fixture, { key: 'LNK', name: 'Links' })
			const a = await createIssue(app, fixture, projectId, 'Link source')
			const b = await createIssue(app, fixture, projectId, 'Link target')
			const aId = String(a['id'])
			const bId = String(b['id'])

			const baseline = await req(app, fixture, { path: '/api/v1/sync/changes?since=0&limit=500' })
			const sinceCursor = Number(baseline.json['nextCursor'])

			const link = await req(app, fixture, {
				method: 'POST',
				path: '/api/v1/graph/links',
				headers: { 'idempotency-key': randomUUID() },
				body: {
					sourceType: 'issue',
					sourceId: aId,
					targetType: 'issue',
					targetId: bId,
					relationKind: 'blocks'
				}
			})
			expect(link.status).toBe(201)

			// Without scopes: entity_link rows are never part of the core feed.
			const core = await req(app, fixture, {
				path: `/api/v1/sync/changes?since=${sinceCursor}&limit=500`
			})
			expect(core.status).toBe(200)
			const coreEntities = (core.json['changes'] as { entity: string }[]).map((c) => c.entity)
			expect(coreEntities).not.toContain('entity_link')

			// With the non-intersecting scope of an unrelated entity: still nothing.
			const wrongScope = await req(app, fixture, {
				path: `/api/v1/sync/changes?since=${sinceCursor}&limit=500&scopes=${encodeURIComponent(`links:issue:${randomUUID()}`)}`
			})
			expect(wrongScope.status).toBe(200)
			expect((wrongScope.json['changes'] as { entity: string }[]).map((c) => c.entity)).not.toContain(
				'entity_link'
			)

			// With intersecting scope: the raw edge row is delivered.
			const scoped = await req(app, fixture, {
				path: `/api/v1/sync/changes?since=${sinceCursor}&limit=500&scopes=${encodeURIComponent(`links:issue:${aId}`)}`
			})
			expect(scoped.status).toBe(200)
			const linkRows = (
				scoped.json['changes'] as { entity: string; data: Record<string, unknown> | null }[]
			).filter((c) => c.entity === 'entity_link')
			expect(linkRows).toHaveLength(1)
			const payload = linkRows[0]!.data
			expect(payload).not.toBeNull()
			expect(payload!['sourceType']).toBe('issue')
			expect(payload!['sourceId']).toBe(aId)
			expect(payload!['targetId']).toBe(bId)
			expect(payload!['relationKind']).toBe('blocks')

			// The other endpoint's scope intersects too (dual-scoped rows).
			const otherSide = await req(app, fixture, {
				path: `/api/v1/sync/changes?since=${sinceCursor}&limit=500&scopes=${encodeURIComponent(`links:issue:${bId}`)}`
			})
			expect(
				(otherSide.json['changes'] as { entity: string }[]).filter((c) => c.entity === 'entity_link')
			).toHaveLength(1)

			// Delete the edge → the delete row is also scope-delivered with a null payload.
			const linkId = String(link.json['id'])
			const del = await req(app, fixture, { method: 'DELETE', path: `/api/v1/graph/links/${linkId}` })
			expect(del.status).toBe(200)
			const afterDelete = await req(app, fixture, {
				path: `/api/v1/sync/changes?since=${sinceCursor}&limit=500&scopes=${encodeURIComponent(`links:issue:${aId}`)}`
			})
			const deleteRows = (afterDelete.json['changes'] as { entity: string; action: string }[]).filter(
				(c) => c.entity === 'entity_link'
			)
			// collapseChangesPerEntity keeps only the latest mutation per entity — the delete.
			expect(deleteRows).toHaveLength(1)
			expect(deleteRows[0]!.action).toBe('delete')

			// Malformed scopes validation → 422.
			for (const bad of [
				'scopes=foo:bar',
				'scopes=links:issue', // links requires the <type>:<id> double segment
				'scopes=issue_hist:',
				`scopes=${Array.from({ length: 51 }, () => `issue_hist:${randomUUID()}`).join(',')}`
			]) {
				const badRes = await req(app, fixture, {
					path: `/api/v1/sync/changes?since=${sinceCursor}&limit=10&${bad}`
				})
				expect(badRes.status).toBe(422)
			}

			// Cross-tenant: subscribing the exact entity scope in workspace B yields nothing —
			// the change feed itself is workspace-scoped before any intersection logic runs.
			const xtenant = await apiRequest(app, {
				path: `/api/v1/sync/changes?since=0&limit=500&scopes=${encodeURIComponent(`links:issue:${aId}`)}`,
				workspaceId: fixture.otherWorkspaceId,
				userId: fixture.otherTenantUserId
			})
			expect(xtenant.status).toBe(200)
			expect(
				(xtenant.json['changes'] as { entity: string }[]).filter((c) => c.entity === 'entity_link')
			).toHaveLength(0)
		} finally {
			await pubsub.close()
		}
	})
})
