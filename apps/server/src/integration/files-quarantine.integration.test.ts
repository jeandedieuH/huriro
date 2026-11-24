/**
 * Integration suite for quarantine pipeline terminal failures (§8.7, §5):
 *  1. A quarantine object that is definitively absent (blob volume lost/wiped,
 *     or written by another instance) must NOT retry forever — the file is
 *     marked scan-failed, audited, and the outbox event publishes.
 *  2. An upload event whose file row was deleted afterwards is terminal too —
 *     nothing can ever scan it, so the event publishes instead of poisoning
 *     the drain loop.
 */
import { beforeAll, describe, expect, test } from 'bun:test'
import type { TestDb } from '@huriro/test-utils'
import { MemoryBlobStorage } from '../modules/files'
import { drainOutboxOnce as drainOutboxBatch } from '../worker'
import { apiRequest, createIntegrationServer, getTestDb, seedM1Fixture } from './test-harness'

async function drainOutboxOnce(...args: Parameters<typeof drainOutboxBatch>): Promise<number> {
	let total = 0
	while (true) {
		const drained = await drainOutboxBatch(...args)
		total += drained
		if (drained === 0) break
	}
	return total
}

let db: TestDb | null = null

beforeAll(async () => {
	db = await getTestDb()
})

/** Upload `hello draft` through the API; returns the file id. Bytes land in the server's blob storage. */
async function uploadDraft(
	app: ReturnType<typeof createIntegrationServer>['app'],
	workspaceId: string,
	userId: string
): Promise<string> {
	const init = await apiRequest(app, {
		method: 'POST',
		path: '/api/v1/files/uploads',
		workspaceId,
		userId,
		body: { filename: 'draft.txt', contentType: 'text/plain', byteSize: 11 }
	})
	expect(init.status).toBe(201)
	const fileId = String((init.json['file'] as Record<string, unknown>)['id'])

	const put = await app.handle(
		new Request(`http://localhost/api/v1/files/uploads/${fileId}/content`, {
			method: 'PUT',
			headers: {
				'content-type': 'application/octet-stream',
				'x-workspace-id': workspaceId,
				'x-test-user-id': userId,
				'x-huriro-client': 'huriro-test'
			},
			body: Buffer.from('hello draft')
		})
	)
	expect(put.status).toBe(200)
	return fileId
}

describe('files quarantine terminal failures (PostgreSQL 18)', () => {
	test('1. missing quarantine object -> scan_status=failed, audited, outbox event publishes', async () => {
		if (!db) return
		const fixture = await seedM1Fixture(db.owner)
		// The API server writes bytes into ITS storage instance…
		const { app, rootSecret } = createIntegrationServer(db)
		const fileId = await uploadDraft(app, fixture.workspaceId, fixture.memberAId)

		// …but the worker drains with a storage instance that does NOT have them
		// (blob volume lost/wiped, or bytes written by another instance). This is
		// exactly the poisoned-row scenario: before the fix the event retried forever.
		const emptyStorage = new MemoryBlobStorage()
		await drainOutboxOnce(db.app, undefined, {
			blobStorage: emptyStorage,
			rootSecret,
			onlyWorkspaceId: fixture.workspaceId
		})

		const outboxRows = await db.owner<{ publishedAt: string | null; attempts: number }[]>`
			SELECT published_at::text AS "publishedAt", attempts
			FROM outbox
			WHERE workspace_id = ${fixture.workspaceId} AND event_type = 'files.uploaded.v1'
		`
		expect(outboxRows.length).toBe(1)
		expect(outboxRows[0]?.publishedAt).not.toBeNull()

		const fileRows = await db.owner<{ scanStatus: string; scanDetail: string | null }[]>`
			SELECT scan_status AS "scanStatus", scan_detail AS "scanDetail"
			FROM files
			WHERE workspace_id = ${fixture.workspaceId} AND id = ${fileId}
		`
		expect(fileRows[0]?.scanStatus).toBe('failed')
		expect(fileRows[0]?.scanDetail).toBe('quarantine_object_missing')

		const auditRows = await db.owner<{ action: string }[]>`
			SELECT action FROM audit_log
			WHERE workspace_id = ${fixture.workspaceId} AND target_id = ${fileId} AND action = 'file.quarantine.missing'
		`
		expect(auditRows.length).toBe(1)
	})

	test('2. deleted file row -> upload event publishes instead of retrying forever', async () => {
		if (!db) return
		const fixture = await seedM1Fixture(db.owner)
		const { app, rootSecret, blobStorage } = createIntegrationServer(db)
		const fileId = await uploadDraft(app, fixture.workspaceId, fixture.memberAId)

		// File row hard-deleted after the upload event was written.
		await db.owner`DELETE FROM files WHERE workspace_id = ${fixture.workspaceId} AND id = ${fileId}`

		await drainOutboxOnce(db.app, undefined, {
			blobStorage,
			rootSecret,
			onlyWorkspaceId: fixture.workspaceId
		})

		const outboxRows = await db.owner<{ publishedAt: string | null }[]>`
			SELECT published_at::text AS "publishedAt"
			FROM outbox
			WHERE workspace_id = ${fixture.workspaceId} AND event_type = 'files.uploaded.v1'
		`
		expect(outboxRows.length).toBe(1)
		expect(outboxRows[0]?.publishedAt).not.toBeNull()
	})
})
