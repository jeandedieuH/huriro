/**
 * Real PostgreSQL 18 integration tests for M1 Tasks CRUD, fractional rebalancing,
 * idempotency, optimistic concurrency (409), and the permission/ACL/tenant deny matrix.
 */
import { beforeAll, describe, expect, test } from 'bun:test'
import { randomUUID } from 'node:crypto'
import type { TestDb } from '@huriro/test-utils'
import { apiRequest, createIntegrationServer, getTestDb, seedM1Fixture } from './test-harness'

let db: TestDb | null = null

beforeAll(async () => {
	db = await getTestDb()
})

describe('M1 tasks integration (PostgreSQL 18 + FORCE RLS)', () => {
	test('project CRUD, atomic issue numbering, sub-issues, relations, comments, views, and rebalance >64 chars', async () => {
		if (!db) return
		const fixture = await seedM1Fixture(db.owner)
		const { app, pubsub } = createIntegrationServer(db)
		try {
			// Create workspace project -> seeds 5 default statuses + change_log cursor
			const createProj = await apiRequest(app, {
				method: 'POST',
				path: '/api/v1/projects',
				workspaceId: fixture.workspaceId,
				userId: fixture.memberAId,
				email: fixture.memberAEmail,
				headers: { 'idempotency-key': randomUUID() },
				body: { key: 'ENG', name: 'Engineering', visibility: 'workspace' }
			})
			expect(createProj.status).toBe(201)
			const projectId = String(createProj.json['id'])
			expect(createProj.json['key']).toBe('ENG')

			// Default statuses created
			const statusesRes = await apiRequest(app, {
				path: `/api/v1/projects/${projectId}/statuses`,
				workspaceId: fixture.workspaceId,
				userId: fixture.memberAId
			})
			expect(statusesRes.status).toBe(200)
			const statuses = statusesRes.json['data'] as { id: string; name: string; isDefault: boolean }[]
			expect(statuses.length).toBeGreaterThanOrEqual(5)
			const todoStatus = statuses.find((s) => s.isDefault) ?? statuses[0]
			const doneStatus =
				statuses.find((s) => s.name.toLowerCase().includes('done')) ?? statuses[statuses.length - 1]
			expect(todoStatus).toBeDefined()
			expect(doneStatus).toBeDefined()

			// Sequential atomic issue numbering + idempotency replay
			const idemKey = randomUUID()
			const create1 = await apiRequest(app, {
				method: 'POST',
				path: '/api/v1/issues',
				workspaceId: fixture.workspaceId,
				userId: fixture.memberAId,
				headers: { 'idempotency-key': idemKey },
				body: { projectId, title: 'First issue', priority: 3 }
			})
			expect(create1.status).toBe(201)
			expect(create1.json['identifier']).toBe('ENG-1')
			const issue1Id = String(create1.json['id'])

			// Same idempotency key + same body -> replayed 201 same id
			const replay1 = await apiRequest(app, {
				method: 'POST',
				path: '/api/v1/issues',
				workspaceId: fixture.workspaceId,
				userId: fixture.memberAId,
				headers: { 'idempotency-key': idemKey },
				body: { projectId, title: 'First issue', priority: 3 }
			})
			expect(replay1.status).toBe(201)
			expect(replay1.json['id']).toBe(issue1Id)

			// Same idempotency key + different body -> 422 idempotency_conflict
			const mismatch1 = await apiRequest(app, {
				method: 'POST',
				path: '/api/v1/issues',
				workspaceId: fixture.workspaceId,
				userId: fixture.memberAId,
				headers: { 'idempotency-key': idemKey },
				body: { projectId, title: 'Changed payload', priority: 1 }
			})
			expect(mismatch1.status).toBe(422)

			// Second issue -> ENG-2 + sub-issue ENG-3
			const create2 = await apiRequest(app, {
				method: 'POST',
				path: '/api/v1/issues',
				workspaceId: fixture.workspaceId,
				userId: fixture.memberAId,
				headers: { 'idempotency-key': randomUUID() },
				body: { projectId, title: 'Second issue', statusId: todoStatus?.id }
			})
			expect(create2.status).toBe(201)
			expect(create2.json['identifier']).toBe('ENG-2')
			const issue2Id = String(create2.json['id'])

			const createSub = await apiRequest(app, {
				method: 'POST',
				path: '/api/v1/issues',
				workspaceId: fixture.workspaceId,
				userId: fixture.memberAId,
				headers: { 'idempotency-key': randomUUID() },
				body: { projectId, parentId: issue1Id, title: 'Child task' }
			})
			expect(createSub.status).toBe(201)
			expect(createSub.json['identifier']).toBe('ENG-3')

			// Relations + comments + saved view
			const relRes = await apiRequest(app, {
				method: 'POST',
				path: `/api/v1/issues/${issue1Id}/relations`,
				workspaceId: fixture.workspaceId,
				userId: fixture.memberAId,
				body: { targetIssueId: issue2Id, kind: 'blocks' }
			})
			expect(relRes.status).toBe(201)

			const commentRes = await apiRequest(app, {
				method: 'POST',
				path: `/api/v1/issues/${issue1Id}/comments`,
				workspaceId: fixture.workspaceId,
				userId: fixture.memberAId,
				body: { bodyText: 'Looks good @memberB' }
			})
			expect(commentRes.status).toBe(201)

			const detailRes = await apiRequest(app, {
				path: `/api/v1/issues/${issue1Id}`,
				workspaceId: fixture.workspaceId,
				userId: fixture.memberAId
			})
			expect(detailRes.status).toBe(200)
			expect((detailRes.json['comments'] as unknown[]).length).toBe(1)
			expect((detailRes.json['relations'] as unknown[]).length).toBe(1)
			expect((detailRes.json['subIssues'] as unknown[]).length).toBe(1)

			// Board move past >64 chars forces rebalance and shortens keys while keeping order
			const longLeft = `0${'0'.repeat(65)}1`
			const longRight = `0${'0'.repeat(65)}2`
			const p1 = await apiRequest(app, {
				method: 'PATCH',
				path: `/api/v1/issues/${issue1Id}`,
				workspaceId: fixture.workspaceId,
				userId: fixture.memberAId,
				body: { position: longLeft, version: 1 }
			})
			expect(p1.status).toBe(200)
			const p2 = await apiRequest(app, {
				method: 'PATCH',
				path: `/api/v1/issues/${issue2Id}`,
				workspaceId: fixture.workspaceId,
				userId: fixture.memberAId,
				body: { position: longRight, version: 1 }
			})
			expect(p2.status).toBe(200)

			// Move sub-issue between longLeft & longRight -> triggers auto-rebalance
			const moveRes = await apiRequest(app, {
				method: 'POST',
				path: `/api/v1/issues/${String(createSub.json['id'])}/move`,
				workspaceId: fixture.workspaceId,
				userId: fixture.memberAId,
				body: { afterIssueId: issue1Id, beforeIssueId: issue2Id, version: 1 }
			})
			expect(moveRes.status).toBe(200)
			expect(moveRes.json['rebalanced']).toBe(true)
			const movedIssue = moveRes.json['issue'] as { position: string; identifier: string }
			expect(movedIssue.position.length).toBeLessThanOrEqual(8)

			// Optimistic concurrency 409 on stale version
			const staleRes = await apiRequest(app, {
				method: 'PATCH',
				path: `/api/v1/issues/${issue1Id}`,
				workspaceId: fixture.workspaceId,
				userId: fixture.memberAId,
				body: { title: 'Stale write', version: 1 }
			})
			expect(staleRes.status).toBe(409)
		} finally {
			await pubsub.close()
		}
	})

	test('enforces deny-path security matrix: outsider, suspended, guest, private ACL, admin bypass audit, cross-tenant', async () => {
		if (!db) return
		const fixture = await seedM1Fixture(db.owner)
		const { app, pubsub } = createIntegrationServer(db)
		try {
			// Member A creates a private project (automatically gets 'manage' ACL)
			const privRes = await apiRequest(app, {
				method: 'POST',
				path: '/api/v1/projects',
				workspaceId: fixture.workspaceId,
				userId: fixture.memberAId,
				body: { key: 'SEC', name: 'Secret Project', visibility: 'private' }
			})
			expect(privRes.status).toBe(201)
			const privProjectId = String(privRes.json['id'])

			const privIssueRes = await apiRequest(app, {
				method: 'POST',
				path: '/api/v1/issues',
				workspaceId: fixture.workspaceId,
				userId: fixture.memberAId,
				body: { projectId: privProjectId, title: 'Private bug' }
			})
			expect(privIssueRes.status).toBe(201)
			const privIssueId = String(privIssueRes.json['id'])

			// Outsider (non-member) -> 403
			const outsiderGet = await apiRequest(app, {
				path: '/api/v1/issues',
				workspaceId: fixture.workspaceId,
				userId: fixture.outsiderId
			})
			expect(outsiderGet.status).toBe(403)

			// Suspended member -> 403
			const suspendedGet = await apiRequest(app, {
				path: '/api/v1/issues',
				workspaceId: fixture.workspaceId,
				userId: fixture.suspendedId
			})
			expect(suspendedGet.status).toBe(403)

			// Guest cannot create workspace projects or issues -> 403
			const guestCreate = await apiRequest(app, {
				method: 'POST',
				path: '/api/v1/projects',
				workspaceId: fixture.workspaceId,
				userId: fixture.guestId,
				body: { key: 'GST', name: 'Guest Fail', visibility: 'workspace' }
			})
			expect(guestCreate.status).toBe(403)

			// Member B (no ACL on SEC) -> cannot read SEC-1 (403) and listing excludes SEC
			const memberBRead = await apiRequest(app, {
				path: `/api/v1/issues/${privIssueId}`,
				workspaceId: fixture.workspaceId,
				userId: fixture.memberBId
			})
			expect(memberBRead.status).toBe(403)

			const memberBList = await apiRequest(app, {
				path: '/api/v1/issues',
				workspaceId: fixture.workspaceId,
				userId: fixture.memberBId
			})
			expect(memberBList.status).toBe(200)
			expect((memberBList.json['data'] as { id: string }[]).some((i) => i.id === privIssueId)).toBe(false)

			// Cross-tenant isolation: Workspace B owner hitting Workspace B never sees SEC
			const crossList = await apiRequest(app, {
				path: '/api/v1/projects',
				workspaceId: fixture.otherWorkspaceId,
				userId: fixture.otherTenantUserId
			})
			expect(crossList.status).toBe(200)
			expect((crossList.json['data'] as unknown[]).length).toBe(0)

			// Cross-tenant BOLA with wrong X-Workspace-Id header -> 403
			const crossHeader = await apiRequest(app, {
				path: `/api/v1/issues/${privIssueId}`,
				workspaceId: fixture.otherWorkspaceId,
				userId: fixture.otherTenantUserId
			})
			expect(crossHeader.status).toBe(404)

			// Workspace Admin bypasses private ACL and writes audited bypass entry (§12.3)
			const adminRead = await apiRequest(app, {
				path: `/api/v1/issues/${privIssueId}`,
				workspaceId: fixture.workspaceId,
				userId: fixture.adminId
			})
			expect(adminRead.status).toBe(200)

			const auditRows = await db.owner<{ action: string }[]>`
				SELECT action FROM audit_log
				WHERE workspace_id = ${fixture.workspaceId}
					AND actor_id = ${fixture.adminId}
					AND action = 'policy.admin_bypass.project.read'
			`
			expect(auditRows.length).toBeGreaterThanOrEqual(1)
		} finally {
			await pubsub.close()
		}
	})
})
