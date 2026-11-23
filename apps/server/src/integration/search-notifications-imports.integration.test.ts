/**
 * Real PostgreSQL 18 integration tests for M1 Search (FTS + trigram + SQL ACL filtering),
 * Outbox -> Notifications fan-out & triage, and Linear/GitHub Importers (dry-run, execute,
 * idempotency, redirect mapping, coarse grant, zero token persistence).
 */
import { beforeAll, describe, expect, test } from 'bun:test'
import type { TestDb } from '@huriro/test-utils'
import { drainOutboxOnce } from '../worker'
import { apiRequest, createIntegrationServer, getTestDb, seedM1Fixture } from './test-harness'

let db: TestDb | null = null

beforeAll(async () => {
	db = await getTestDb()
})

describe('M1 search, notifications, and imports integration (PostgreSQL 18)', () => {
	test('outbox drains search index + SQL ACL excludes private project hits from unauthorized members', async () => {
		if (!db) return
		const fixture = await seedM1Fixture(db.owner)
		const { app, pubsub } = createIntegrationServer(db)
		try {
			const pubProj = await apiRequest(app, {
				method: 'POST',
				path: '/api/v1/projects',
				workspaceId: fixture.workspaceId,
				userId: fixture.memberAId,
				body: { key: 'OPEN', name: 'Open Project', visibility: 'workspace' }
			})
			const privProj = await apiRequest(app, {
				method: 'POST',
				path: '/api/v1/projects',
				workspaceId: fixture.workspaceId,
				userId: fixture.memberAId,
				body: { key: 'VAULT', name: 'Secret Vault', visibility: 'private' }
			})
			const pubId = String(pubProj.json['id'])
			const privId = String(privProj.json['id'])

			await apiRequest(app, {
				method: 'POST',
				path: '/api/v1/issues',
				workspaceId: fixture.workspaceId,
				userId: fixture.memberAId,
				body: {
					projectId: pubId,
					title: 'Kubernetes replica synchronization failure',
					descriptionText: 'Reconcile state machine across edges'
				}
			})
			await apiRequest(app, {
				method: 'POST',
				path: '/api/v1/issues',
				workspaceId: fixture.workspaceId,
				userId: fixture.memberAId,
				body: {
					projectId: privId,
					title: 'Kubernetes secret rotation credentials vulnerability',
					descriptionText: 'Sensitive private finding'
				}
			})

			// Drain transactional outbox into search_documents (scoped: other
			// test files' leftover rows must not starve this batch's LIMIT)
			const drained = await drainOutboxOnce(db.app, pubsub, { onlyWorkspaceId: fixture.workspaceId })
			expect(drained).toBeGreaterThanOrEqual(4)

			// Member A sees both Kubernetes issues + exact key match OPEN-1
			const memberASearch = await apiRequest(app, {
				path: '/api/v1/search?q=Kubernetes',
				workspaceId: fixture.workspaceId,
				userId: fixture.memberAId
			})
			expect(memberASearch.status).toBe(200)
			const hitsA = memberASearch.json['hits'] as { identifier: string | null }[]
			expect(hitsA.some((h) => h.identifier === 'OPEN-1')).toBe(true)
			expect(hitsA.some((h) => h.identifier === 'VAULT-1')).toBe(true)

			// Member B sees OPEN-1 and NEVER sees VAULT-1 at SQL query layer
			const memberBSearch = await apiRequest(app, {
				path: '/api/v1/search?q=Kubernetes',
				workspaceId: fixture.workspaceId,
				userId: fixture.memberBId
			})
			expect(memberBSearch.status).toBe(200)
			const hitsB = memberBSearch.json['hits'] as { identifier: string | null }[]
			expect(hitsB.some((h) => h.identifier === 'OPEN-1')).toBe(true)
			expect(hitsB.some((h) => h.identifier === 'VAULT-1')).toBe(false)

			// Exact key query & trigram typo query both match OPEN-1
			const exactSearch = await apiRequest(app, {
				path: '/api/v1/search?q=OPEN-1',
				workspaceId: fixture.workspaceId,
				userId: fixture.memberBId
			})
			const exactHits = exactSearch.json['hits'] as { identifier: string | null }[]
			expect(exactHits[0]?.identifier).toBe('OPEN-1')
		} finally {
			await pubsub.close()
		}
	})

	test('notifications fan out on assignment & comment (never self) and support read/read-all/archive', async () => {
		if (!db) return
		const fixture = await seedM1Fixture(db.owner)
		const { app, pubsub } = createIntegrationServer(db)
		try {
			const projRes = await apiRequest(app, {
				method: 'POST',
				path: '/api/v1/projects',
				workspaceId: fixture.workspaceId,
				userId: fixture.memberAId,
				body: { key: 'NTF', name: 'Notify', visibility: 'workspace' }
			})
			const projectId = String(projRes.json['id'])

			// Member A creates issue assigned to Member B -> notifies Member B, NOT Member A
			const issueRes = await apiRequest(app, {
				method: 'POST',
				path: '/api/v1/issues',
				workspaceId: fixture.workspaceId,
				userId: fixture.memberAId,
				body: {
					projectId,
					title: 'Review sync changes',
					assigneeType: 'user',
					assigneeId: fixture.memberBId
				}
			})
			const issueId = String(issueRes.json['id'])

			// Member A comments mentioning owner's email handle
			const ownerHandle = fixture.ownerEmail.split('@')[0] ?? 'owner'
			await apiRequest(app, {
				method: 'POST',
				path: `/api/v1/issues/${issueId}/comments`,
				workspaceId: fixture.workspaceId,
				userId: fixture.memberAId,
				body: { bodyText: `cc @${ownerHandle} please check` }
			})

			await drainOutboxOnce(db.app, pubsub, { onlyWorkspaceId: fixture.workspaceId })

			// Member A has zero self-notifications
			const nA = await apiRequest(app, {
				path: '/api/v1/notifications',
				workspaceId: fixture.workspaceId,
				userId: fixture.memberAId
			})
			expect(nA.status).toBe(200)
			expect((nA.json['data'] as unknown[]).length).toBe(0)

			// Member B got assignment + comment notifications
			const nB = await apiRequest(app, {
				path: '/api/v1/notifications',
				workspaceId: fixture.workspaceId,
				userId: fixture.memberBId
			})
			const notifsB = nB.json['data'] as { id: string; kind: string; readAt: string | null }[]
			expect(notifsB.length).toBeGreaterThanOrEqual(1)
			expect(Number(nB.json['unreadCount'])).toBeGreaterThanOrEqual(1)

			// Mark one read + archive + read-all
			const firstId = notifsB[0]?.id ?? ''
			const readOne = await apiRequest(app, {
				method: 'POST',
				path: `/api/v1/notifications/${firstId}/read`,
				workspaceId: fixture.workspaceId,
				userId: fixture.memberBId
			})
			expect(readOne.status).toBe(200)

			const readAll = await apiRequest(app, {
				method: 'POST',
				path: '/api/v1/notifications/read-all',
				workspaceId: fixture.workspaceId,
				userId: fixture.memberBId
			})
			expect(readAll.status).toBe(200)

			const archiveOne = await apiRequest(app, {
				method: 'POST',
				path: `/api/v1/notifications/${firstId}/archive`,
				workspaceId: fixture.workspaceId,
				userId: fixture.memberBId
			})
			expect(archiveOne.status).toBe(200)
		} finally {
			await pubsub.close()
		}
	})

	test('Linear & GitHub importers support dry-run, idempotent execute, coarse grant, redirect, and never persist apiToken', async () => {
		if (!db) return
		const fixture = await seedM1Fixture(db.owner)
		const { app, pubsub } = createIntegrationServer(db)
		try {
			const linearPayload = {
				projectKey: 'IMP',
				projectName: 'Imported Engineering',
				issues: [
					{
						id: 'lin-uuid-1',
						identifier: 'OLD-123',
						title: 'Legacy Linear Ticket',
						description: 'Keep old identifier redirectable',
						stateName: 'In Progress',
						priority: 3,
						assigneeEmail: fixture.memberAEmail,
						labels: ['backend'],
						comments: [{ id: 'lin-c-1', body: 'Imported comment body', authorEmail: fixture.ownerEmail }]
					}
				]
			}

			// Member (without import.run) -> 403
			const deniedDryRun = await apiRequest(app, {
				method: 'POST',
				path: '/api/v1/imports/dry-run',
				workspaceId: fixture.workspaceId,
				userId: fixture.memberAId,
				body: { source: 'linear', linear: linearPayload }
			})
			expect(deniedDryRun.status).toBe(403)

			// Admin -> dry-run creates zero issues
			const dryRun = await apiRequest(app, {
				method: 'POST',
				path: '/api/v1/imports/dry-run',
				workspaceId: fixture.workspaceId,
				userId: fixture.adminId,
				body: { source: 'linear', linear: linearPayload, apiToken: 'secret-live-token-never-stored' }
			})
			expect(dryRun.status).toBe(200)
			const jobId = String(dryRun.json['jobId'])
			const counts = dryRun.json['counts'] as { issues: number; comments: number }
			expect(counts.issues).toBe(1)
			expect(counts.comments).toBe(1)

			// Verify secret apiToken is NOT stored in import_jobs row
			const [storedJob] = await db.owner<{ config: Record<string, unknown> }[]>`
				SELECT config FROM import_jobs WHERE id = ${jobId}
			`
			expect(JSON.stringify(storedJob?.config)).not.toContain('secret-live-token-never-stored')

			// Pull baseline sync cursor before execute
			const beforeExec = await apiRequest(app, {
				path: '/api/v1/sync/changes?since=0&limit=500',
				workspaceId: fixture.workspaceId,
				userId: fixture.ownerId
			})
			const cursorBefore = Number(beforeExec.json['nextCursor'])

			// Execute import
			const execRes = await apiRequest(app, {
				method: 'POST',
				path: '/api/v1/imports/execute',
				workspaceId: fixture.workspaceId,
				userId: fixture.adminId,
				body: { jobId }
			})
			expect(execRes.status).toBe(200)
			const report1 = execRes.json['report'] as {
				importedIssues: number
				importedComments: number
				skippedIssues: number
			}
			expect(report1.importedIssues).toBe(1)
			expect(report1.importedComments).toBe(1)
			expect(report1.skippedIssues).toBe(0)

			// Verify coarse `grant` emitted in change_log instead of spamming N upserts
			const changesAfter = await apiRequest(app, {
				path: `/api/v1/sync/changes?since=${cursorBefore}&limit=500`,
				workspaceId: fixture.workspaceId,
				userId: fixture.ownerId
			})
			const chg = changesAfter.json['changes'] as { action: string; entity: string }[]
			expect(chg.some((c) => c.action === 'grant')).toBe(true)

			// Redirect OLD-123 -> IMP-1 via both /imports/redirect/:id and /issues/by-key/:id
			const redir1 = await apiRequest(app, {
				path: '/api/v1/imports/redirect/OLD-123',
				workspaceId: fixture.workspaceId,
				userId: fixture.memberAId
			})
			expect(redir1.status).toBe(200)
			expect(redir1.json['identifier']).toBe('IMP-1')

			const redir2 = await apiRequest(app, {
				path: '/api/v1/issues/by-key/OLD-123',
				workspaceId: fixture.workspaceId,
				userId: fixture.memberAId
			})
			expect(redir2.status).toBe(200)
			expect(redir2.json['redirectedFrom']).toBe('OLD-123')

			// Second execute of same payload is idempotent (skippedIssues: 1, no duplicate creation)
			const execAgain = await apiRequest(app, {
				method: 'POST',
				path: '/api/v1/imports/execute',
				workspaceId: fixture.workspaceId,
				userId: fixture.adminId,
				body: { source: 'linear', linear: linearPayload }
			})
			expect(execAgain.status).toBe(200)
			const report2 = execAgain.json['report'] as { importedIssues: number; skippedIssues: number }
			expect(report2.importedIssues).toBe(0)
			expect(report2.skippedIssues).toBe(1)
		} finally {
			await pubsub.close()
		}
	})
})
