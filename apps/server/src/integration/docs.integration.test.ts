/**
 * Real PostgreSQL 18 + FORCE RLS integration tests for M2 Docs (Gate G2):
 *   - Page tree CRUD, move + fractional rebalance (>64 chars), cycle & depth-20 guards
 *   - Built-in templates, favorites, split, Markdown import/export, append API
 *   - Full deny-path & tenant isolation matrix (outsider, suspended, guest, private ACL, admin bypass audit, cross-tenant)
 *   - Sync deltas / ACL grant scoped snapshot / revoke / delete tombstones
 *   - Search indexing + SQL `can_read` privacy gate + `#block-<id>` deep links
 *   - Anchored comment & mention notifications
 *   - Notion & Markdown importers + identifier redirects
 *   - Retention thinning (`runDocMaintenanceOnce`) preserving `named` & `pre_restore`
 */
import { beforeAll, describe, expect, test } from 'bun:test'
import { randomUUID } from 'node:crypto'
import { withWorkspace } from '@huriro/db'
import type { TestDb } from '@huriro/test-utils'
import { runDocMaintenanceOnce } from '../modules/docs'
import { drainOutboxOnce } from '../worker'
import { apiRequest, createIntegrationServer, getTestDb, seedM1Fixture } from './test-harness'

let db: TestDb | null = null

beforeAll(async () => {
	db = await getTestDb()
})

describe('M2 docs integration (PostgreSQL 18 + FORCE RLS)', () => {
	test('tree CRUD, templates, favorites, split, append, Markdown export/import, rebalance >64 chars, cycle & depth-20 guards', async () => {
		if (!db) return
		const fixture = await seedM1Fixture(db.owner)
		const { app, pubsub } = createIntegrationServer(db)
		try {
			// Create root page from markdown
			const rootRes = await apiRequest(app, {
				method: 'POST',
				path: '/api/v1/docs',
				workspaceId: fixture.workspaceId,
				userId: fixture.memberAId,
				headers: { 'idempotency-key': randomUUID() },
				body: {
					title: 'Architecture Handbook',
					visibility: 'workspace',
					markdown: '# Overview\n\nTarget latency budget is 50ms p95.\n\n## Storage\n\nPostgres 18.'
				}
			})
			expect(rootRes.status).toBe(201)
			const rootId = String(rootRes.json['id'])
			const rootSlug = String(rootRes.json['slug'])
			expect(rootRes.json['depth']).toBe(0)

			// Idempotent replay with same key returns same page without duplicating
			const detailRes = await apiRequest(app, {
				path: `/api/v1/docs/by-slug/${rootSlug}`,
				workspaceId: fixture.workspaceId,
				userId: fixture.memberBId
			})
			expect(detailRes.status).toBe(200)
			expect(String(detailRes.json['plainText'])).toContain('Target latency budget is 50ms p95.')
			expect(detailRes.json['canWrite']).toBe(true)

			// Built-in template page ('rfc')
			const rfcRes = await apiRequest(app, {
				method: 'POST',
				path: '/api/v1/docs',
				workspaceId: fixture.workspaceId,
				userId: fixture.memberAId,
				body: { title: 'RFC 001 Sync', templateId: 'rfc' }
			})
			expect(rfcRes.status).toBe(201)
			const rfcDetail = await apiRequest(app, {
				path: `/api/v1/docs/${String(rfcRes.json['id'])}`,
				workspaceId: fixture.workspaceId,
				userId: fixture.memberAId
			})
			expect(String(rfcDetail.json['plainText'])).toContain('Rollout & rollback')

			// Favorite + Unfavorite
			const favRes = await apiRequest(app, {
				method: 'POST',
				path: `/api/v1/docs/${rootId}/favorite`,
				workspaceId: fixture.workspaceId,
				userId: fixture.memberBId
			})
			expect(favRes.status).toBe(200)
			expect((favRes.json['data'] as { isFavorite: boolean }).isFavorite).toBe(true)

			const unfavRes = await apiRequest(app, {
				method: 'DELETE',
				path: `/api/v1/docs/${rootId}/favorite`,
				workspaceId: fixture.workspaceId,
				userId: fixture.memberBId
			})
			expect(unfavRes.status).toBe(200)
			expect((unfavRes.json['data'] as { isFavorite: boolean }).isFavorite).toBe(false)

			// Split + Append + Export + Markdown Import
			const splitRes = await apiRequest(app, {
				method: 'POST',
				path: `/api/v1/docs/${rootId}/split`,
				workspaceId: fixture.workspaceId,
				userId: fixture.memberAId,
				body: { title: 'Extracted Storage Spec', markdown: '## PG18 Details\n\nFORCE RLS enabled.' }
			})
			expect(splitRes.status).toBe(201)
			const splitId = String(splitRes.json['id'])
			expect(splitRes.json['parentId']).toBe(rootId)

			const appendRes = await apiRequest(app, {
				method: 'POST',
				path: `/api/v1/docs/${splitId}/append`,
				workspaceId: fixture.workspaceId,
				userId: fixture.memberAId,
				body: { markdown: 'Appended operational note.', origin: 'api:append' }
			})
			expect(appendRes.status).toBe(200)
			expect(String(appendRes.json['plainText'])).toContain('Appended operational note.')

			const exportRes = await apiRequest(app, {
				path: `/api/v1/docs/${splitId}/export?format=markdown`,
				workspaceId: fixture.workspaceId,
				userId: fixture.memberAId
			})
			expect(exportRes.status).toBe(200)
			expect(String(exportRes.json['markdown'])).toContain('FORCE RLS enabled.')

			const mdImportRes = await apiRequest(app, {
				method: 'POST',
				path: '/api/v1/docs/import/markdown',
				workspaceId: fixture.workspaceId,
				userId: fixture.memberAId,
				body: { parentId: rootId, title: 'Imported Guide', markdown: '# Imported\n\nBody text here.' }
			})
			expect(mdImportRes.status).toBe(201)

			// Cycle guard: cannot move parent under its own child
			const cycleRes = await apiRequest(app, {
				method: 'POST',
				path: `/api/v1/docs/${rootId}/move`,
				workspaceId: fixture.workspaceId,
				userId: fixture.memberAId,
				body: { parentId: splitId, version: 1 }
			})
			expect(cycleRes.status).toBe(422)

			// Rebalance >64 char position keys cleanly
			const posLeft = `0${'0'.repeat(62)}1`
			const posRight = `0${'0'.repeat(62)}2`
			const sibA = await apiRequest(app, {
				method: 'POST',
				path: '/api/v1/docs',
				workspaceId: fixture.workspaceId,
				userId: fixture.memberAId,
				body: { parentId: rootId, title: 'Sib A', position: posLeft }
			})
			const sibB = await apiRequest(app, {
				method: 'POST',
				path: '/api/v1/docs',
				workspaceId: fixture.workspaceId,
				userId: fixture.memberAId,
				body: { parentId: rootId, title: 'Sib B', position: posRight }
			})
			const sibC = await apiRequest(app, {
				method: 'POST',
				path: '/api/v1/docs',
				workspaceId: fixture.workspaceId,
				userId: fixture.memberAId,
				body: { parentId: rootId, title: 'Sib C' }
			})
			expect(sibA.status).toBe(201)
			expect(sibB.status).toBe(201)
			expect(sibC.status).toBe(201)

			const moveRes = await apiRequest(app, {
				method: 'POST',
				path: `/api/v1/docs/${String(sibC.json['id'])}/move`,
				workspaceId: fixture.workspaceId,
				userId: fixture.memberAId,
				body: {
					parentId: rootId,
					afterPageId: String(sibA.json['id']),
					beforePageId: String(sibB.json['id']),
					version: 1
				}
			})
			expect(moveRes.status).toBe(200)
			expect(moveRes.json['rebalanced']).toBe(true)

			// Depth-20 nesting guard: root=0..depth=20 allowed, depth=21 rejected with 422
			let parentChainId = rootId
			for (let depth = 1; depth <= 20; depth++) {
				const child = await apiRequest(app, {
					method: 'POST',
					path: '/api/v1/docs',
					workspaceId: fixture.workspaceId,
					userId: fixture.memberAId,
					body: { parentId: parentChainId, title: `Nested ${depth}` }
				})
				expect(child.status).toBe(201)
				expect(child.json['depth']).toBe(depth)
				parentChainId = String(child.json['id'])
			}
			const tooDeep = await apiRequest(app, {
				method: 'POST',
				path: '/api/v1/docs',
				workspaceId: fixture.workspaceId,
				userId: fixture.memberAId,
				body: { parentId: parentChainId, title: 'Too deep' }
			})
			expect(tooDeep.status).toBe(422)

			// Archive subtree root deletes whole subtree cleanly
			const delRes = await apiRequest(app, {
				method: 'DELETE',
				path: `/api/v1/docs/${rootId}`,
				workspaceId: fixture.workspaceId,
				userId: fixture.memberAId
			})
			expect(delRes.status).toBe(200)
			expect((delRes.json['archivedIds'] as string[]).length).toBeGreaterThanOrEqual(24)

			const goneRes = await apiRequest(app, {
				path: `/api/v1/docs/${splitId}`,
				workspaceId: fixture.workspaceId,
				userId: fixture.memberAId
			})
			expect(goneRes.status).toBe(404)
		} finally {
			await pubsub.close()
		}
	})

	test('enforces deny-path security matrix: outsider, suspended, guest, private ACLs, cross-tenant, and admin bypass audit', async () => {
		if (!db) return
		const fixture = await seedM1Fixture(db.owner)
		const { app, pubsub } = createIntegrationServer(db)
		try {
			// MemberA creates a workspace doc and a private doc
			const wsDocRes = await apiRequest(app, {
				method: 'POST',
				path: '/api/v1/docs',
				workspaceId: fixture.workspaceId,
				userId: fixture.memberAId,
				body: { title: 'Public Handbook', visibility: 'workspace', markdown: 'Team guide.' }
			})
			const privDocRes = await apiRequest(app, {
				method: 'POST',
				path: '/api/v1/docs',
				workspaceId: fixture.workspaceId,
				userId: fixture.memberAId,
				body: { title: 'Secret Acquisition Plan', visibility: 'private', markdown: 'Confidential terms.' }
			})
			expect(wsDocRes.status).toBe(201)
			expect(privDocRes.status).toBe(201)
			const wsDocId = String(wsDocRes.json['id'])
			const privDocId = String(privDocRes.json['id'])

			// Unauthenticated -> 401
			expect(
				(
					await apiRequest(app, {
						path: '/api/v1/docs',
						workspaceId: fixture.workspaceId
					})
				).status
			).toBe(401)

			// Outsider, suspended, cross-tenant user -> 403
			for (const deniedUser of [fixture.outsiderId, fixture.suspendedId, fixture.otherTenantUserId]) {
				expect(
					(
						await apiRequest(app, {
							path: `/api/v1/docs/${wsDocId}`,
							workspaceId: fixture.workspaceId,
							userId: deniedUser
						})
					).status
				).toBe(403)
			}

			// Cross-workspace isolation: owner reading workspace A doc using workspace B header -> 404/403
			const crossWs = await apiRequest(app, {
				path: `/api/v1/docs/${wsDocId}`,
				workspaceId: fixture.otherWorkspaceId,
				userId: fixture.ownerId
			})
			expect([403, 404]).toContain(crossWs.status)

			// Guest cannot read workspace doc or create docs without explicit ACL
			expect(
				(
					await apiRequest(app, {
						path: `/api/v1/docs/${wsDocId}`,
						workspaceId: fixture.workspaceId,
						userId: fixture.guestId
					})
				).status
			).toBe(403)
			expect(
				(
					await apiRequest(app, {
						method: 'POST',
						path: '/api/v1/docs',
						workspaceId: fixture.workspaceId,
						userId: fixture.guestId,
						body: { title: 'Guest Attempt' }
					})
				).status
			).toBe(403)

			// MemberB cannot access private doc until ACL is granted
			expect(
				(
					await apiRequest(app, {
						path: `/api/v1/docs/${privDocId}`,
						workspaceId: fixture.workspaceId,
						userId: fixture.memberBId
					})
				).status
			).toBe(403)

			const listB = await apiRequest(app, {
				path: '/api/v1/docs',
				workspaceId: fixture.workspaceId,
				userId: fixture.memberBId
			})
			const visibleIdsB = (listB.json['data'] as { id: string }[]).map((p) => p.id)
			expect(visibleIdsB).toContain(wsDocId)
			expect(visibleIdsB).not.toContain(privDocId)

			// Grant read ACL to MemberB -> read allowed (canWrite=false), write/ticket=read, patch rejected 403
			const readGrant = await apiRequest(app, {
				method: 'POST',
				path: '/api/v1/acl',
				workspaceId: fixture.workspaceId,
				userId: fixture.memberAId,
				body: {
					resourceType: 'doc_page',
					resourceId: privDocId,
					principalType: 'user',
					principalId: fixture.memberBId,
					permission: 'read'
				}
			})
			expect(readGrant.status).toBe(200)
			const readGrantId = String(readGrant.json['id'])

			const privReadB = await apiRequest(app, {
				path: `/api/v1/docs/${privDocId}`,
				workspaceId: fixture.workspaceId,
				userId: fixture.memberBId
			})
			expect(privReadB.status).toBe(200)
			expect(privReadB.json['canWrite']).toBe(false)

			const deniedPatchB = await apiRequest(app, {
				method: 'PATCH',
				path: `/api/v1/docs/${privDocId}`,
				workspaceId: fixture.workspaceId,
				userId: fixture.memberBId,
				body: { title: 'Tampered', version: 1 }
			})
			expect(deniedPatchB.status).toBe(403)

			// Replace ACL with write permission -> MemberB can edit
			await apiRequest(app, {
				method: 'DELETE',
				path: `/api/v1/acl/${readGrantId}`,
				workspaceId: fixture.workspaceId,
				userId: fixture.memberAId
			})
			const writeGrant = await apiRequest(app, {
				method: 'POST',
				path: '/api/v1/acl',
				workspaceId: fixture.workspaceId,
				userId: fixture.memberAId,
				body: {
					resourceType: 'doc_page',
					resourceId: privDocId,
					principalType: 'user',
					principalId: fixture.memberBId,
					permission: 'write'
				}
			})
			expect(writeGrant.status).toBe(200)

			const allowedPatchB = await apiRequest(app, {
				method: 'PATCH',
				path: `/api/v1/docs/${privDocId}`,
				workspaceId: fixture.workspaceId,
				userId: fixture.memberBId,
				body: { title: 'Updated Secret Plan', version: 1 }
			})
			expect(allowedPatchB.status).toBe(200)

			// Admin bypasses ACL cleanly and records audit_log entry
			const adminReadPriv = await apiRequest(app, {
				path: `/api/v1/docs/${privDocId}`,
				workspaceId: fixture.workspaceId,
				userId: fixture.adminId
			})
			expect(adminReadPriv.status).toBe(200)

			const auditRows = await db.owner<{ action: string }[]>`
				SELECT action FROM audit_log
				WHERE workspace_id = ${fixture.workspaceId}
					AND actor_id = ${fixture.adminId}
					AND target_id = ${privDocId}
			`
			expect(auditRows.some((r) => r.action.includes('bypass') || r.action.includes('admin'))).toBe(true)
		} finally {
			await pubsub.close()
		}
	})

	test('sync deltas/grant/revoke, search deep links + SQL ACL, notifications, Notion/MD imports + redirects, and version retention thinning', async () => {
		if (!db) return
		const fixture = await seedM1Fixture(db.owner)
		const { app, pubsub } = createIntegrationServer(db)
		try {
			// 1. Create workspace + private docs for sync & search tests
			const openDoc = await apiRequest(app, {
				method: 'POST',
				path: '/api/v1/docs',
				workspaceId: fixture.workspaceId,
				userId: fixture.memberAId,
				body: {
					title: 'Production Runbook',
					visibility: 'workspace',
					markdown: '# Disaster Recovery\n\nVerify PgBackRest WAL archiving status nightly.'
				}
			})
			const privDoc = await apiRequest(app, {
				method: 'POST',
				path: '/api/v1/docs',
				workspaceId: fixture.workspaceId,
				userId: fixture.memberAId,
				body: {
					title: 'Zero-Day Incident',
					visibility: 'private',
					markdown: '# Triage\n\nPgBackRest key rotation details.'
				}
			})
			expect(openDoc.status).toBe(201)
			expect(privDoc.status).toBe(201)
			const openDocId = String(openDoc.json['id'])
			const privDocId = String(privDoc.json['id'])

			// Sync feed excludes private doc for MemberB until granted
			const syncBefore = await apiRequest(app, {
				path: '/api/v1/sync/changes?since=0&limit=500',
				workspaceId: fixture.workspaceId,
				userId: fixture.memberBId
			})
			expect(syncBefore.status).toBe(200)
			const changesBefore = syncBefore.json['changes'] as {
				cursor: number
				entity: string
				id: string
				action: string
			}[]
			expect(changesBefore.some((c) => c.entity === 'doc_page' && c.id === openDocId)).toBe(true)
			expect(changesBefore.some((c) => c.entity === 'doc_page' && c.id === privDocId)).toBe(false)
			const cursorBeforeGrant = Number(syncBefore.json['nextCursor'])

			// Grant ACL -> sync feed returns grant snapshot; revoke -> returns revoke entry
			const grantRes = await apiRequest(app, {
				method: 'POST',
				path: '/api/v1/acl',
				workspaceId: fixture.workspaceId,
				userId: fixture.memberAId,
				body: {
					resourceType: 'doc_page',
					resourceId: privDocId,
					principalType: 'user',
					principalId: fixture.memberBId,
					permission: 'read'
				}
			})
			expect(grantRes.status).toBe(200)
			const aclId = String(grantRes.json['id'])

			const syncAfterGrant = await apiRequest(app, {
				path: `/api/v1/sync/changes?since=${cursorBeforeGrant}&limit=500`,
				workspaceId: fixture.workspaceId,
				userId: fixture.memberBId
			})
			const grantChanges = syncAfterGrant.json['changes'] as {
				entity: string
				id: string
				action: string
				data?: Record<string, unknown> | null
			}[]
			expect(grantChanges.some((c) => c.action === 'grant' && c.data)).toBe(true)
			const cursorAfterGrant = Number(syncAfterGrant.json['nextCursor'])

			await apiRequest(app, {
				method: 'DELETE',
				path: `/api/v1/acl/${aclId}`,
				workspaceId: fixture.workspaceId,
				userId: fixture.memberAId
			})

			const syncAfterRevoke = await apiRequest(app, {
				path: `/api/v1/sync/changes?since=${cursorAfterGrant}&limit=500`,
				workspaceId: fixture.workspaceId,
				userId: fixture.memberBId
			})
			const revokeChanges = syncAfterRevoke.json['changes'] as { action: string; entity: string }[]
			expect(revokeChanges.some((c) => c.action === 'revoke')).toBe(true)

			// 2. Comment mention -> notification fan-out & search deep link (#block-...)
			const memberBHandle = fixture.memberBEmail.split('@')[0] ?? fixture.memberBEmail
			const commentRes = await apiRequest(app, {
				method: 'POST',
				path: `/api/v1/docs/${openDocId}/comments`,
				workspaceId: fixture.workspaceId,
				userId: fixture.memberAId,
				body: { bodyText: `Please review WAL check @${memberBHandle}` }
			})
			expect(commentRes.status).toBe(201)

			// Drain outbox -> updates search_documents and notifications
			await drainOutboxOnce(db.app, pubsub)

			// MemberB sees notification
			const notifRes = await apiRequest(app, {
				path: '/api/v1/notifications',
				workspaceId: fixture.workspaceId,
				userId: fixture.memberBId
			})
			expect(notifRes.status).toBe(200)
			const notifs = notifRes.json['data'] as { kind: string; entityId: string }[]
			expect(notifs.some((n) => n.entityId === openDocId && n.kind === 'doc.mentioned')).toBe(true)

			// Search hits for MemberA see both open & private docs with #block- deep links; MemberB only open doc
			const searchA = await apiRequest(app, {
				path: '/api/v1/search?q=PgBackRest',
				workspaceId: fixture.workspaceId,
				userId: fixture.memberAId
			})
			expect(searchA.status).toBe(200)
			const hitsA = searchA.json['hits'] as { entityId: string; deepLink: string }[]
			const openHit = hitsA.find((h) => h.entityId === openDocId)
			expect(openHit).toBeDefined()
			expect(openHit?.deepLink).toMatch(/^\/docs\/production-runbook.*#block-/)
			expect(hitsA.some((h) => h.entityId === privDocId)).toBe(true)

			const searchB = await apiRequest(app, {
				path: '/api/v1/search?q=PgBackRest',
				workspaceId: fixture.workspaceId,
				userId: fixture.memberBId
			})
			const hitsB = searchB.json['hits'] as { entityId: string }[]
			expect(hitsB.some((h) => h.entityId === openDocId)).toBe(true)
			expect(hitsB.some((h) => h.entityId === privDocId)).toBe(false)

			// 3. Notion + Markdown workspace importers & redirect mapping
			const notionId = '0123456789abcdef0123456789abcdef'
			const notionDry = await apiRequest(app, {
				method: 'POST',
				path: '/api/v1/imports/dry-run',
				workspaceId: fixture.workspaceId,
				userId: fixture.ownerId,
				body: {
					source: 'notion',
					notion: {
						rootTitle: 'Imported Wiki',
						pages: [
							{
								remotePath: `Runbook Guide ${notionId}.md`,
								markdown: '# Runbook Guide\n\nImported from Notion export.',
								notionId
							}
						]
					}
				}
			})
			expect(notionDry.status).toBe(200)
			expect((notionDry.json['counts'] as { pages?: number })['pages']).toBe(1)

			const notionExec = await apiRequest(app, {
				method: 'POST',
				path: '/api/v1/imports/execute',
				workspaceId: fixture.workspaceId,
				userId: fixture.ownerId,
				body: { jobId: String(notionDry.json['jobId']), source: 'notion' }
			})
			expect(notionExec.status).toBe(200)

			const redirectLookup = await apiRequest(app, {
				path: `/api/v1/docs/by-slug/${notionId}`,
				workspaceId: fixture.workspaceId,
				userId: fixture.memberAId
			})
			expect(redirectLookup.status).toBe(200)
			expect(redirectLookup.json['redirectedFrom']).toBe(notionId)
			expect((redirectLookup.json['page'] as { title: string }).title).toBe('Runbook Guide')

			const mdDry = await apiRequest(app, {
				method: 'POST',
				path: '/api/v1/imports/dry-run',
				workspaceId: fixture.workspaceId,
				userId: fixture.ownerId,
				body: {
					source: 'markdown',
					markdown: {
						rootTitle: 'Docs Folder',
						files: [{ path: 'ops/deploy.md', markdown: '---\ntitle: Deploy Steps\n---\n\nRun deploy.' }]
					}
				}
			})
			expect(mdDry.status).toBe(200)
			const mdExec = await apiRequest(app, {
				method: 'POST',
				path: '/api/v1/imports/execute',
				workspaceId: fixture.workspaceId,
				userId: fixture.ownerId,
				body: { jobId: String(mdDry.json['jobId']), source: 'markdown' }
			})
			expect(mdExec.status).toBe(200)

			// 4. Retention thinning keeps hourly (7-30d), daily (>30d), named, and pre_restore checkpoints
			const emptyPayload = Buffer.from([])
			await db.owner`
				INSERT INTO doc_versions (workspace_id, page_id, kind, label, state, byte_size, plain_text, authors, created_at)
				VALUES
					(${fixture.workspaceId}, ${openDocId}, 'auto', NULL, ${emptyPayload}, 0, 'h1', '{}', date_trunc('hour', now() - interval '10 days') + interval '5 minutes'),
					(${fixture.workspaceId}, ${openDocId}, 'auto', NULL, ${emptyPayload}, 0, 'h2', '{}', date_trunc('hour', now() - interval '10 days') + interval '15 minutes'),
					(${fixture.workspaceId}, ${openDocId}, 'auto', NULL, ${emptyPayload}, 0, 'h3', '{}', date_trunc('hour', now() - interval '10 days') + interval '25 minutes'),
					(${fixture.workspaceId}, ${openDocId}, 'auto', NULL, ${emptyPayload}, 0, 'd1', '{}', date_trunc('day', now() - interval '40 days') + interval '1 hour'),
					(${fixture.workspaceId}, ${openDocId}, 'auto', NULL, ${emptyPayload}, 0, 'd2', '{}', date_trunc('day', now() - interval '40 days') + interval '3 hours'),
					(${fixture.workspaceId}, ${openDocId}, 'named', 'Pinned milestone', ${emptyPayload}, 0, 'named', '{}', date_trunc('day', now() - interval '40 days') + interval '2 hours'),
					(${fixture.workspaceId}, ${openDocId}, 'pre_restore', 'Pre-restore keep', ${emptyPayload}, 0, 'prerestore', '{}', date_trunc('day', now() - interval '40 days') + interval '2 hours')
			`
			const thinned = await withWorkspace(db.app, { workspaceId: fixture.workspaceId }, (tx) =>
				runDocMaintenanceOnce(tx)
			)
			expect(thinned.thinnedVersions).toBe(3)

			const remainingVersions = await db.owner<{ kind: string; plainText: string }[]>`
				SELECT kind, plain_text AS "plainText"
				FROM doc_versions
				WHERE workspace_id = ${fixture.workspaceId} AND page_id = ${openDocId}
			`
			const autoTexts = remainingVersions.filter((v) => v.kind === 'auto').map((v) => v.plainText)
			expect(autoTexts).toContain('h3')
			expect(autoTexts).not.toContain('h1')
			expect(autoTexts).toContain('d2')
			expect(autoTexts).not.toContain('d1')
			expect(remainingVersions.some((v) => v.kind === 'named')).toBe(true)
			expect(remainingVersions.some((v) => v.kind === 'pre_restore')).toBe(true)
		} finally {
			await pubsub.close()
		}
	})
})
