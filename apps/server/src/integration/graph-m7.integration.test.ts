/**
 * M7 unified cross-entity graph (§7.1, ADR-0033): CRUD/traversal/peek,
 * legacy dual-write + backfill, endpoint visibility filtering, write-policy
 * enforcement, cross-tenant denial, and delete-path referential cleanup.
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

/** Small owner-pool fixture seam; all behavior under test is still exercised through the API. */
async function seedConversation(database: TestDb, fixture: Fixture, subject: string): Promise<string> {
	const [account] = await database.owner<{ id: string }[]>`
		INSERT INTO mail_accounts (workspace_id, provider, address, display_name, created_by)
		VALUES (${fixture.workspaceId}, 'inbound_parse', ${`support-${randomUUID()}@test.huriro.dev`}, 'Support', ${fixture.ownerId})
		RETURNING id
	`
	const [inbox] = await database.owner<{ id: string }[]>`
		INSERT INTO mail_inboxes (workspace_id, name, position, created_by)
		VALUES (${fixture.workspaceId}, ${`Inbox ${randomUUID()}`}, 'a0', ${fixture.ownerId})
		RETURNING id
	`
	const [conversation] = await database.owner<{ id: string }[]>`
		INSERT INTO mail_conversations (
			workspace_id, inbox_id, account_id, subject, normalized_subject, last_message_at, customer_email
		)
		VALUES (
			${fixture.workspaceId}, ${inbox!.id}, ${account!.id}, ${subject}, ${subject.toLowerCase()}, now(), 'customer@example.com'
		)
		RETURNING id
	`
	return conversation!.id
}

async function createProjectIssue(
	app: App,
	fixture: Fixture,
	key: string,
	visibility?: 'workspace' | 'private'
) {
	const project = await req(app, fixture, {
		method: 'POST',
		path: '/api/v1/projects',
		headers: { 'idempotency-key': randomUUID() },
		body: { key, name: `${key} project`, ...(visibility ? { visibility } : {}) }
	})
	expect(project.status).toBe(201)
	const issue = await req(app, fixture, {
		method: 'POST',
		path: '/api/v1/issues',
		headers: { 'idempotency-key': randomUUID() },
		body: { projectId: String(project.json['id']), title: `${key} graph issue` }
	})
	expect(issue.status).toBe(201)
	return { projectId: String(project.json['id']), issueId: String(issue.json['id']) }
}

async function createDoc(
	app: App,
	fixture: Fixture,
	title: string,
	visibility: 'workspace' | 'private' = 'workspace'
) {
	const doc = await req(app, fixture, {
		method: 'POST',
		path: '/api/v1/docs',
		headers: { 'idempotency-key': randomUUID() },
		body: { title, visibility, markdown: `# ${title}\n\nGraph fixture.` }
	})
	expect(doc.status).toBe(201)
	return String(doc.json['id'])
}

describe('M7 graph integration (PostgreSQL 18)', () => {
	test('creates idempotently, traverses bidirectionally, peeks issue/mail/doc, and deletes links', async () => {
		if (!db) return
		const fixture = await seedM1Fixture(db.owner)
		const { app, pubsub } = createIntegrationServer(db)
		try {
			const { issueId } = await createProjectIssue(app, fixture, 'GRA')
			const docId = await createDoc(app, fixture, 'Graph Architecture')
			const conversationId = await seedConversation(db, fixture, 'Graph customer thread')

			const createIssueMail = await req(app, fixture, {
				method: 'POST',
				path: '/api/v1/graph/links',
				headers: { 'idempotency-key': randomUUID() },
				body: {
					sourceType: 'issue',
					sourceId: issueId,
					targetType: 'mail_conversation',
					targetId: conversationId
				}
			})
			expect(createIssueMail.status).toBe(201)
			const issueMailLinkId = String(createIssueMail.json['id'])
			expect(createIssueMail.json['relationKind']).toBe('references')

			// Repeating the same edge is a no-op and returns the canonical existing row.
			const duplicate = await req(app, fixture, {
				method: 'POST',
				path: '/api/v1/graph/links',
				body: {
					sourceType: 'issue',
					sourceId: issueId,
					targetType: 'mail_conversation',
					targetId: conversationId
				}
			})
			expect(duplicate.status).toBe(201)
			expect(String(duplicate.json['id'])).toBe(issueMailLinkId)

			const createMailDoc = await req(app, fixture, {
				method: 'POST',
				path: '/api/v1/graph/links',
				body: {
					sourceType: 'mail_conversation',
					sourceId: conversationId,
					targetType: 'doc_page',
					targetId: docId,
					relationKind: 'references'
				}
			})
			expect(createMailDoc.status).toBe(201)

			// Traversal is symmetric in result shape and has deliberately no total count.
			const fromMail = await req(app, fixture, {
				path: `/api/v1/graph/links?type=mail_conversation&id=${conversationId}`
			})
			expect(fromMail.status).toBe(200)
			expect((fromMail.json['data'] as unknown[]).length).toBe(2)
			expect(fromMail.json['total']).toBeUndefined()
			const fromDoc = await req(app, fixture, { path: `/api/v1/graph/links?type=doc_page&id=${docId}` })
			expect((fromDoc.json['data'] as { id: string }[]).map((l) => l.id)).toEqual([
				String(createMailDoc.json['id'])
			])

			const issuePeek = await req(app, fixture, { path: `/api/v1/graph/peek?type=issue&id=${issueId}` })
			expect(issuePeek.status).toBe(200)
			expect(String(issuePeek.json['title'])).toContain('graph issue')
			expect(issuePeek.json['subtitle']).toMatch(/^GRA-/)
			expect((issuePeek.json['meta'] as Record<string, unknown>)['triageStatus']).toBe('none')

			const mailPeek = await req(app, fixture, {
				path: `/api/v1/graph/peek?type=mail_conversation&id=${conversationId}`
			})
			expect(mailPeek.status).toBe(200)
			expect(mailPeek.json['title']).toBe('Graph customer thread')
			expect((mailPeek.json['status'] as { kind: string }).kind).toBe('open')

			const docPeek = await req(app, fixture, { path: `/api/v1/graph/peek?type=doc_page&id=${docId}` })
			expect(docPeek.status).toBe(200)
			expect(docPeek.json['title']).toBe('Graph Architecture')
			expect(typeof (docPeek.json['meta'] as Record<string, unknown>)['path']).toBe('string')
			expect((docPeek.json['meta'] as Record<string, unknown>)['slug']).toBe('graph-architecture')

			const unsupportedSource = await req(app, fixture, {
				method: 'POST',
				path: '/api/v1/graph/links',
				body: { sourceType: 'chat_message', sourceId: randomUUID(), targetType: 'issue', targetId: issueId }
			})
			expect(unsupportedSource.status).toBe(422)
			const unsupportedPeek = await req(app, fixture, {
				path: `/api/v1/graph/peek?type=vcs_pr&id=${randomUUID()}`
			})
			expect(unsupportedPeek.status).toBe(422)

			const del = await req(app, fixture, {
				method: 'DELETE',
				path: `/api/v1/graph/links/${issueMailLinkId}`
			})
			expect(del.status).toBe(200)
			expect(del.json['deleted']).toBe(true)
			const afterDelete = await req(app, fixture, {
				path: `/api/v1/graph/links?type=mail_conversation&id=${conversationId}`
			})
			expect((afterDelete.json['data'] as unknown[]).length).toBe(1)

			const changes = await db.owner<{ action: string; scope: string[] }[]>`
				SELECT action, scope FROM change_log
				WHERE workspace_id = ${fixture.workspaceId} AND entity_type = 'entity_link'
				ORDER BY cursor ASC
			`
			expect(changes.length).toBeGreaterThanOrEqual(3)
			expect(changes[0]!.scope).toContain(`links:issue:${issueId}`)
			expect(changes[0]!.scope).toContain(`links:mail_conversation:${conversationId}`)
			expect(changes.at(-1)!.action).toBe('delete')
		} finally {
			await pubsub.close()
		}
	})

	test('dual-writes mail conversion/link rows, backfills legacy rows idempotently, and preserves metadata', async () => {
		if (!db) return
		const fixture = await seedM1Fixture(db.owner)
		const { app, pubsub } = createIntegrationServer(db)
		try {
			const { issueId } = await createProjectIssue(app, fixture, 'DWA')
			const docId = await createDoc(app, fixture, 'Dual Write Doc')
			const conversationId = await seedConversation(db, fixture, 'Dual write customer')
			const createdAt = '2025-04-01T10:00:00+00:00'

			// Seed the two V1 rows directly, then execute the exact expand-only backfill SQL.
			await db.owner`
				INSERT INTO mail_conversation_tasks (workspace_id, conversation_id, task_id, created_by, created_at)
				VALUES (${fixture.workspaceId}, ${conversationId}, ${issueId}, ${fixture.ownerId}, ${createdAt})
			`
			await db.owner`
				INSERT INTO mail_conversation_docs (workspace_id, conversation_id, page_id, created_by, created_at)
				VALUES (${fixture.workspaceId}, ${conversationId}, ${docId}, ${fixture.ownerId}, ${createdAt})
			`
			const backfillSql = `
INSERT INTO entity_links (workspace_id, source_type, source_id, target_type, target_id, relation_kind, created_by, created_at)
SELECT workspace_id, 'mail_conversation', conversation_id, 'issue', task_id, 'tracked_by', created_by, created_at
FROM mail_conversation_tasks
ON CONFLICT (workspace_id, source_type, source_id, target_type, target_id, relation_kind) DO NOTHING;
INSERT INTO entity_links (workspace_id, source_type, source_id, target_type, target_id, relation_kind, created_by, created_at)
SELECT workspace_id, 'mail_conversation', conversation_id, 'doc_page', page_id, 'references', created_by, created_at
FROM mail_conversation_docs
ON CONFLICT (workspace_id, source_type, source_id, target_type, target_id, relation_kind) DO NOTHING;
`
			await db.owner.unsafe(backfillSql)
			await db.owner.unsafe(backfillSql) // idempotency: second execution inserts zero rows

			const edges = await db.owner<
				{ targetId: string; relationKind: string; createdBy: string; createdAt: string }[]
			>`
				SELECT target_id AS "targetId", relation_kind AS "relationKind", created_by AS "createdBy", created_at::text AS "createdAt"
				FROM entity_links
				WHERE workspace_id = ${fixture.workspaceId} AND source_type = 'mail_conversation' AND source_id = ${conversationId}
				ORDER BY target_id
			`
			expect(edges.length).toBe(2)
			expect(edges.map((e) => e.createdBy)).toEqual([fixture.ownerId, fixture.ownerId])
			expect(edges[0]!.createdAt.startsWith('2025-04-01')).toBe(true)
			const kinds = new Map(edges.map((e) => [e.targetId, e.relationKind]))
			expect(kinds.get(issueId)).toBe('tracked_by')
			expect(kinds.get(docId)).toBe('references')

			// Migration 0023 itself is checksum-recorded by the immutable migration runner.
			const migrations = await db.owner<{ name: string }[]>`
				SELECT name FROM schema_migrations WHERE version = 23
			`
			expect(migrations[0]?.name).toBe('0023_entity_links_backfill.sql')

			// Delete only the graph copies (legacy V1 rows remain). Repeating the
			// legacy API links must recreate both rows through the dual-write path.
			await db.owner`
				DELETE FROM entity_links
				WHERE workspace_id = ${fixture.workspaceId} AND source_type = 'mail_conversation' AND source_id = ${conversationId}
			`
			const linkTask = await req(app, fixture, {
				method: 'POST',
				path: `/api/v1/mail/conversations/${conversationId}/links`,
				body: { taskId: issueId }
			})
			expect(linkTask.status).toBe(204)
			const linkDoc = await req(app, fixture, {
				method: 'POST',
				path: `/api/v1/mail/conversations/${conversationId}/links`,
				body: { pageId: docId }
			})
			expect(linkDoc.status).toBe(204)
			const count = await db.owner<{ count: string }[]>`
				SELECT count(*)::text AS count FROM entity_links
				WHERE workspace_id = ${fixture.workspaceId} AND source_type = 'mail_conversation' AND source_id = ${conversationId}
			`
			expect(Number(count[0]!.count)).toBe(2)
		} finally {
			await pubsub.close()
		}
	})

	test('filters invisible/private counterparts, hides guest access as 404, and denies cross-tenant callers', async () => {
		if (!db) return
		const fixture = await seedM1Fixture(db.owner)
		const { app, pubsub } = createIntegrationServer(db)
		try {
			const pub = await createProjectIssue(app, fixture, 'PUB')
			const priv = await createProjectIssue(app, fixture, 'SEC', 'private')
			const conversationId = await seedConversation(db, fixture, 'Visibility thread')
			for (const issueId of [pub.issueId, priv.issueId]) {
				const res = await req(app, fixture, {
					method: 'POST',
					path: '/api/v1/graph/links',
					body: {
						sourceType: 'issue',
						sourceId: issueId,
						targetType: 'mail_conversation',
						targetId: conversationId
					}
				})
				expect(res.status).toBe(201)
			}

			// Member B can traverse the public workspace account but the private-project edge vanishes.
			const memberView = await apiRequest(app, {
				path: `/api/v1/graph/links?type=mail_conversation&id=${conversationId}`,
				workspaceId: fixture.workspaceId,
				userId: fixture.memberBId
			})
			expect(memberView.status).toBe(200)
			const rows = memberView.json['data'] as { sourceId: string; targetId: string }[]
			expect(rows.length).toBe(1)
			expect(rows.some((r) => r.sourceId === priv.issueId || r.targetId === priv.issueId)).toBe(false)

			const memberPeek = await apiRequest(app, {
				path: `/api/v1/graph/peek?type=issue&id=${priv.issueId}`,
				workspaceId: fixture.workspaceId,
				userId: fixture.memberBId
			})
			expect(memberPeek.status).toBe(404)

			// Guests hold no implicit mail/project access; graph never confirms endpoint existence.
			for (const path of [
				`/api/v1/graph/links?type=mail_conversation&id=${conversationId}`,
				`/api/v1/graph/peek?type=mail_conversation&id=${conversationId}`
			]) {
				const guest = await apiRequest(app, {
					path,
					workspaceId: fixture.workspaceId,
					userId: fixture.guestId
				})
				expect(guest.status).toBe(404)
			}

			// Cross-tenant callers are rejected before any tenant row is touched.
			const crossTenant = await apiRequest(app, {
				path: `/api/v1/graph/links?type=mail_conversation&id=${conversationId}`,
				workspaceId: fixture.workspaceId,
				userId: fixture.otherTenantUserId
			})
			expect([403, 404]).toContain(crossTenant.status)
		} finally {
			await pubsub.close()
		}
	})

	test('enforces source write permission with 403 and never writes a partial edge', async () => {
		if (!db) return
		const fixture = await seedM1Fixture(db.owner)
		const { app, pubsub } = createIntegrationServer(db)
		try {
			const { projectId, issueId } = await createProjectIssue(app, fixture, 'ACL', 'private')
			const docId = await createDoc(app, fixture, 'ACL target')

			// Read-only project ACL lets member B read the endpoints but not satisfy issue.write.
			const grant = await req(app, fixture, {
				method: 'POST',
				path: '/api/v1/acl',
				body: {
					resourceType: 'project',
					resourceId: projectId,
					principalType: 'user',
					principalId: fixture.memberBId,
					permission: 'read'
				}
			})
			expect([200, 201]).toContain(grant.status)

			const denied = await apiRequest(app, {
				method: 'POST',
				path: '/api/v1/graph/links',
				workspaceId: fixture.workspaceId,
				userId: fixture.memberBId,
				body: { sourceType: 'issue', sourceId: issueId, targetType: 'doc_page', targetId: docId }
			})
			expect(denied.status).toBe(403)
			expect(
				denied.json['code'] ?? (denied.json['error'] as Record<string, unknown> | undefined)?.['code']
			).toBe('resource_private')
			const rows = await db.owner`SELECT id FROM entity_links WHERE workspace_id = ${fixture.workspaceId}`
			expect(rows.length).toBe(0)
		} finally {
			await pubsub.close()
		}
	})

	test('deleting an issue removes incoming and outgoing graph edges transactionally', async () => {
		if (!db) return
		const fixture = await seedM1Fixture(db.owner)
		const { app, pubsub } = createIntegrationServer(db)
		try {
			const { issueId } = await createProjectIssue(app, fixture, 'DEL')
			const docId = await createDoc(app, fixture, 'Deletion target')
			const conversationId = await seedConversation(db, fixture, 'Deletion thread')
			for (const body of [
				{ sourceType: 'issue', sourceId: issueId, targetType: 'doc_page', targetId: docId },
				{
					sourceType: 'mail_conversation',
					sourceId: conversationId,
					targetType: 'issue',
					targetId: issueId,
					relationKind: 'tracked_by'
				}
			]) {
				const res = await req(app, fixture, { method: 'POST', path: '/api/v1/graph/links', body })
				expect(res.status).toBe(201)
			}

			const del = await req(app, fixture, { method: 'DELETE', path: `/api/v1/issues/${issueId}` })
			expect(del.status).toBe(200)
			const remaining = await db.owner`
				SELECT id FROM entity_links
				WHERE workspace_id = ${fixture.workspaceId}
					AND ((source_type = 'issue' AND source_id = ${issueId}) OR (target_type = 'issue' AND target_id = ${issueId}))
			`
			expect(remaining.length).toBe(0)
			const tombstones = await db.owner`
				SELECT entity_id FROM change_log
				WHERE workspace_id = ${fixture.workspaceId} AND entity_type = 'entity_link' AND action = 'delete'
			`
			expect(tombstones.length).toBe(2)
		} finally {
			await pubsub.close()
		}
	})
})
