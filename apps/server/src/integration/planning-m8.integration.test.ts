/**
 * Real PostgreSQL integration coverage for the M8 planning spine (§3.2):
 * initiatives, project milestones, project status updates, issue milestone
 * links, optimistic concurrency, ACL visibility filtering, and sync replication.
 */
import { beforeAll, describe, expect, test } from 'bun:test'
import { randomUUID } from 'node:crypto'
import { uuid7 } from '@huriro/db'
import type { TestDb } from '@huriro/test-utils'
import {
	apiRequest,
	createIntegrationServer,
	getTestDb,
	type M1SeededFixture,
	seedM1Fixture
} from './test-harness'

let db: TestDb | null = null

beforeAll(async () => {
	db = await getTestDb()
})

type App = ReturnType<typeof createIntegrationServer>['app']

async function req(
	app: App,
	fixture: M1SeededFixture,
	opts: {
		readonly method?: string
		readonly path: string
		readonly userId?: string
		readonly email?: string
		readonly body?: unknown
		readonly headers?: Record<string, string>
	}
) {
	return apiRequest(app, {
		method: opts.method ?? 'GET',
		path: opts.path,
		workspaceId: fixture.workspaceId,
		userId: opts.userId ?? fixture.memberAId,
		email: opts.email ?? fixture.memberAEmail,
		...(opts.body !== undefined ? { body: opts.body } : {}),
		...(opts.headers ? { headers: opts.headers } : {})
	})
}

async function createProject(
	app: App,
	fixture: M1SeededFixture,
	key: string,
	visibility: 'workspace' | 'private',
	userId = fixture.memberAId
) {
	const res = await req(app, fixture, {
		method: 'POST',
		path: '/api/v1/projects',
		userId,
		body: { key, name: `${key} Project`, visibility }
	})
	expect(res.status).toBe(201)
	return res.json as { id: string; version: number }
}

describe('M8 planning integration (PostgreSQL + FORCE RLS)', () => {
	test('initiatives enforce initiative.manage, validate linked projects, filter private edges, and replicate', async () => {
		if (!db) return
		const fixture = await seedM1Fixture(db.owner)
		const { app, pubsub } = createIntegrationServer(db)
		try {
			const workspaceProject = await createProject(app, fixture, 'PLN', 'workspace')
			const privateProject = await createProject(app, fixture, 'PRV', 'private')

			// Initiative administration is intentionally portfolio-level: ordinary
			// members can write projects but cannot create cross-project initiatives.
			const memberDenied = await req(app, fixture, {
				method: 'POST',
				path: '/api/v1/initiatives',
				body: { name: 'Member cannot create', projectIds: [workspaceProject.id] }
			})
			expect(memberDenied.status).toBe(403)

			const guestDenied = await req(app, fixture, {
				method: 'POST',
				path: '/api/v1/initiatives',
				userId: fixture.guestId,
				email: fixture.guestEmail,
				body: { name: 'Guest cannot create' }
			})
			expect(guestDenied.status).toBe(403)

			const created = await req(app, fixture, {
				method: 'POST',
				path: '/api/v1/initiatives',
				userId: fixture.adminId,
				email: fixture.adminEmail,
				body: {
					name: 'Q1 reliability',
					descriptionText: 'Finish the reliability program',
					targetDate: '2027-03-31',
					projectIds: [workspaceProject.id, privateProject.id]
				}
			})
			expect(created.status).toBe(201)
			expect(created.json['projectIds']).toEqual([workspaceProject.id, privateProject.id])
			const initiativeId = String(created.json['id'])

			// Members see the initiative, but private-project edges are removed unless
			// they hold project access — the initiative itself must not become an ACL leak.
			const memberBList = await req(app, fixture, {
				path: '/api/v1/initiatives',
				userId: fixture.memberBId,
				email: fixture.memberBEmail
			})
			expect(memberBList.status).toBe(200)
			const memberBInitiative = (memberBList.json['data'] as { id: string; projectIds: string[] }[]).find(
				(i) => i.id === initiativeId
			)
			expect(memberBInitiative?.projectIds).toEqual([workspaceProject.id])

			const adminList = await req(app, fixture, {
				path: '/api/v1/initiatives',
				userId: fixture.adminId,
				email: fixture.adminEmail
			})
			const adminInitiative = (adminList.json['data'] as { id: string; projectIds: string[] }[]).find(
				(i) => i.id === initiativeId
			)
			expect(adminInitiative?.projectIds).toEqual([workspaceProject.id, privateProject.id])

			// Change rows are written once but filtered per recipient. Read the feed
			// before the later update collapses this create row away: the admin-authored
			// payload contains both edges, while memberB must receive only the visible one.
			const memberBCreateFeed = await req(app, fixture, {
				path: '/api/v1/sync/changes?since=0&limit=500',
				userId: fixture.memberBId,
				email: fixture.memberBEmail
			})
			expect(memberBCreateFeed.status).toBe(200)
			const memberBCreateChange = (
				memberBCreateFeed.json['changes'] as {
					entity: string
					id: string
					data?: { projectIds?: string[] } | null
				}[]
			).find((c) => c.entity === 'initiative' && c.id === initiativeId)
			expect(memberBCreateChange?.data?.projectIds).toEqual([workspaceProject.id])

			// Unknown/invisible project ids are validation failures rather than silent drops.
			const invalidLink = await req(app, fixture, {
				method: 'POST',
				path: '/api/v1/initiatives',
				userId: fixture.adminId,
				email: fixture.adminEmail,
				body: { name: 'Invalid project edge', projectIds: [randomUUID()] }
			})
			expect(invalidLink.status).toBe(422)

			const updated = await req(app, fixture, {
				method: 'PATCH',
				path: `/api/v1/initiatives/${initiativeId}`,
				userId: fixture.adminId,
				email: fixture.adminEmail,
				body: { health: 'at_risk', projectIds: [workspaceProject.id], version: 1 }
			})
			expect(updated.status).toBe(200)
			expect(updated.json['health']).toBe('at_risk')
			expect(updated.json['projectIds']).toEqual([workspaceProject.id])

			const stale = await req(app, fixture, {
				method: 'PATCH',
				path: `/api/v1/initiatives/${initiativeId}`,
				userId: fixture.adminId,
				email: fixture.adminEmail,
				body: { health: 'off_track', version: 1 }
			})
			expect(stale.status).toBe(409)

			// Workspace-scoped initiative changes replicate in both the snapshot and feed.
			const snapshot = await req(app, fixture, {
				path: '/api/v1/sync/snapshot',
				userId: fixture.adminId,
				email: fixture.adminEmail
			})
			expect(snapshot.status).toBe(200)
			const initiatives = snapshot.json['initiatives'] as { id: string; projectIds: string[] }[]
			expect(initiatives.find((i) => i.id === initiativeId)?.projectIds).toEqual([workspaceProject.id])

			const changes = await req(app, fixture, {
				path: '/api/v1/sync/changes?since=0&limit=500',
				userId: fixture.adminId,
				email: fixture.adminEmail
			})
			const initiativeChanges = (changes.json['changes'] as { entity: string; id: string }[]).filter(
				(c) => c.entity === 'initiative' && c.id === initiativeId
			)
			expect(initiativeChanges.length).toBeGreaterThan(0)

			const deleted = await req(app, fixture, {
				method: 'DELETE',
				path: `/api/v1/initiatives/${initiativeId}`,
				userId: fixture.adminId,
				email: fixture.adminEmail
			})
			expect(deleted.status).toBe(204)
		} finally {
			await pubsub.close()
		}
	})

	test('milestones validate project ownership, move/clear issue links, delete null-safe, and respect ACLs', async () => {
		if (!db) return
		const fixture = await seedM1Fixture(db.owner)
		const { app, pubsub } = createIntegrationServer(db)
		try {
			const projectA = await createProject(app, fixture, 'MSA', 'workspace')
			const projectB = await createProject(app, fixture, 'MSB', 'workspace')

			const milestone = await req(app, fixture, {
				method: 'POST',
				path: `/api/v1/projects/${projectA.id}/milestones`,
				body: { name: 'Beta', targetDate: '2027-02-15' }
			})
			expect(milestone.status).toBe(201)
			const milestoneId = String(milestone.json['id'])

			const issue = await req(app, fixture, {
				method: 'POST',
				path: '/api/v1/issues',
				body: { projectId: projectA.id, title: 'Milestone-linked issue', milestoneId }
			})
			expect(issue.status).toBe(201)
			expect(issue.json['milestoneId']).toBe(milestoneId)
			const issueId = String(issue.json['id'])

			// The API validates the same-project invariant before the composite FK has to.
			const wrongProject = await req(app, fixture, {
				method: 'POST',
				path: '/api/v1/issues',
				body: { projectId: projectB.id, title: 'Wrong project milestone', milestoneId }
			})
			expect(wrongProject.status).toBe(422)

			const staleMilestone = await req(app, fixture, {
				method: 'PATCH',
				path: `/api/v1/projects/${projectA.id}/milestones/${milestoneId}`,
				body: { status: 'completed', version: 99 }
			})
			expect(staleMilestone.status).toBe(409)

			// Moving the issue to another project clears the milestone because milestones
			// are project-local planning objects.
			const move = await req(app, fixture, {
				method: 'PATCH',
				path: `/api/v1/issues/${issueId}`,
				body: { projectId: projectB.id, version: 1 }
			})
			expect(move.status).toBe(200)
			expect(move.json['projectId']).toBe(projectB.id)
			expect(move.json['milestoneId'] ?? null).toBeNull()

			const moveBack = await req(app, fixture, {
				method: 'PATCH',
				path: `/api/v1/issues/${issueId}`,
				body: { projectId: projectA.id, milestoneId, version: 2 }
			})
			expect(moveBack.status).toBe(200)
			expect(moveBack.json['milestoneId']).toBe(milestoneId)

			// Deleting the milestone must null only milestone_id — never workspace_id or
			// project_id on the composite FK. This pins migration 0025's column-list form.
			const deleteMilestone = await req(app, fixture, {
				method: 'DELETE',
				path: `/api/v1/projects/${projectA.id}/milestones/${milestoneId}`
			})
			expect(deleteMilestone.status).toBe(204)
			const afterDelete = await req(app, fixture, { path: `/api/v1/issues/${issueId}` })
			expect(afterDelete.status).toBe(200)
			const afterIssue = afterDelete.json['issue'] as Record<string, unknown>
			expect(afterIssue['milestoneId'] ?? null).toBeNull()
			expect(afterIssue['projectId']).toBe(projectA.id)

			// Private project milestone reads/writes follow the underlying project ACL.
			const privateProject = await createProject(app, fixture, 'MSP', 'private')
			const privateMilestone = await req(app, fixture, {
				method: 'POST',
				path: `/api/v1/projects/${privateProject.id}/milestones`,
				body: { name: 'Private beta' }
			})
			expect(privateMilestone.status).toBe(201)
			const privateMilestoneId = String(privateMilestone.json['id'])
			const memberBRead = await req(app, fixture, {
				path: `/api/v1/projects/${privateProject.id}/milestones`,
				userId: fixture.memberBId,
				email: fixture.memberBEmail
			})
			expect(memberBRead.status).toBe(403)
			const memberBPatch = await req(app, fixture, {
				method: 'PATCH',
				path: `/api/v1/projects/${privateProject.id}/milestones/${privateMilestoneId}`,
				userId: fixture.memberBId,
				email: fixture.memberBEmail,
				body: { status: 'completed', version: 1 }
			})
			expect(memberBPatch.status).toBe(403)

			const snapshot = await req(app, fixture, { path: '/api/v1/sync/snapshot' })
			const snapshotMilestones = snapshot.json['projectMilestones'] as { id: string; projectId: string }[]
			expect(
				snapshotMilestones.some((m) => m.id === privateMilestoneId && m.projectId === privateProject.id)
			).toBe(true)
		} finally {
			await pubsub.close()
		}
	})

	test('project updates snapshot real completion counts and replicate project-scoped health rows', async () => {
		if (!db) return
		const fixture = await seedM1Fixture(db.owner)
		const { app, pubsub } = createIntegrationServer(db)
		try {
			const project = await createProject(app, fixture, 'UPD', 'workspace')
			const statuses = await req(app, fixture, { path: `/api/v1/projects/${project.id}/statuses` })
			const done = (statuses.json['data'] as { id: string; category: string }[]).find(
				(s) => s.category === 'completed'
			)
			expect(done).toBeDefined()

			const issue = await req(app, fixture, {
				method: 'POST',
				path: '/api/v1/issues',
				body: { projectId: project.id, title: 'Completed issue', statusId: done?.id }
			})
			expect(issue.status).toBe(201)

			const created = await req(app, fixture, {
				method: 'POST',
				path: `/api/v1/projects/${project.id}/updates`,
				body: {
					health: 'on_track',
					bodyText: 'Milestone is on track',
					scopeChange: 2
				}
			})
			expect(created.status).toBe(201)
			expect(created.json['completedIssues']).toBe(1)
			expect(created.json['totalIssues']).toBe(1)
			expect(created.json['scopeChange']).toBe(2)
			expect(created.json['createdBy']).toBe(fixture.memberAId)

			const guestDenied = await req(app, fixture, {
				method: 'POST',
				path: `/api/v1/projects/${project.id}/updates`,
				userId: fixture.guestId,
				email: fixture.guestEmail,
				body: { health: 'off_track', bodyText: 'guest write' }
			})
			expect(guestDenied.status).toBe(403)

			const list = await req(app, fixture, { path: `/api/v1/projects/${project.id}/updates` })
			expect(list.status).toBe(200)
			expect((list.json['data'] as unknown[]).length).toBe(1)

			const snapshot = await req(app, fixture, { path: '/api/v1/sync/snapshot' })
			const updates = snapshot.json['projectUpdates'] as {
				id: string
				projectId: string
				completedIssues: number
			}[]
			expect(updates.find((u) => u.id === created.json['id'])?.completedIssues).toBe(1)

			const changes = await req(app, fixture, { path: '/api/v1/sync/changes?since=0&limit=500' })
			const change = (changes.json['changes'] as { entity: string; id: string; scope: string[] }[]).find(
				(c) => c.entity === 'project_update' && c.id === created.json['id']
			)
			expect(change?.scope).toContain(`project:${project.id}`)
		} finally {
			await pubsub.close()
		}
	})

	test('offline mutation envelopes apply planning creates, updates, and project-scoped ids atomically per row', async () => {
		if (!db) return
		const fixture = await seedM1Fixture(db.owner)
		const { app, pubsub } = createIntegrationServer(db)
		try {
			const project = await createProject(app, fixture, 'OFF', 'workspace')
			const initiativeId = uuid7()
			const milestoneId = uuid7()
			const projectUpdateId = uuid7()
			const batch = await req(app, fixture, {
				method: 'POST',
				path: '/api/v1/mutations',
				userId: fixture.adminId,
				email: fixture.adminEmail,
				body: {
					mutations: [
						{
							mutationId: randomUUID(),
							workspaceId: fixture.workspaceId,
							entity: 'initiative',
							entityId: initiativeId,
							op: 'create',
							patch: { name: 'Offline initiative', targetDate: '2027-04-30', projectIds: [project.id] }
						},
						{
							mutationId: randomUUID(),
							workspaceId: fixture.workspaceId,
							entity: 'project_milestone',
							entityId: milestoneId,
							op: 'create',
							patch: { projectId: project.id, name: 'Offline milestone', targetDate: '2027-04-15' }
						},
						{
							mutationId: randomUUID(),
							workspaceId: fixture.workspaceId,
							entity: 'project_milestone',
							entityId: milestoneId,
							op: 'update',
							baseVersion: 1,
							patch: { projectId: project.id, status: 'completed' }
						},
						{
							mutationId: randomUUID(),
							workspaceId: fixture.workspaceId,
							entity: 'project_update',
							entityId: projectUpdateId,
							op: 'create',
							patch: { projectId: project.id, health: 'at_risk', bodyText: 'Offline status update' }
						},
						{
							mutationId: randomUUID(),
							workspaceId: fixture.workspaceId,
							entity: 'initiative',
							entityId: initiativeId,
							op: 'update',
							baseVersion: 1,
							patch: { health: 'at_risk' }
						}
					]
				}
			})
			expect(batch.status).toBe(200)
			const results = batch.json['results'] as { outcome: string; data?: Record<string, unknown> }[]
			expect(results.map((result) => result.outcome)).toEqual([
				'applied',
				'applied',
				'applied',
				'applied',
				'applied'
			])
			expect(results[1]?.data?.['projectId']).toBe(project.id)
			expect(results[2]?.data?.['status']).toBe('completed')
			expect(results[3]?.data?.['createdBy']).toBe(fixture.adminId)
			expect(results[4]?.data?.['health']).toBe('at_risk')

			const forbidden = await req(app, fixture, {
				method: 'POST',
				path: '/api/v1/mutations',
				body: {
					mutations: [
						{
							mutationId: randomUUID(),
							workspaceId: fixture.workspaceId,
							entity: 'initiative',
							entityId: uuid7(),
							op: 'create',
							patch: { name: 'Member offline initiative' }
						}
					]
				}
			})
			expect(forbidden.status).toBe(200)
			expect((forbidden.json['results'] as { outcome: string; status: number }[])[0]).toMatchObject({
				outcome: 'forbidden',
				status: 403
			})
		} finally {
			await pubsub.close()
		}
	})
})
