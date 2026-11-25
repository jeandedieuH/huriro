/**
 * Integration suite for the general outbox dead-letter mechanism (§5.5, §20):
 *  1. A permanently-failing consumer (here: quarantine reads erroring with a
 *     transient, non-terminal I/O error) exhausts its attempt budget and the
 *     row is dead-lettered — out of the retry loop, payload + error kept,
 *     never silently dropped.
 *  2. Failed rows back off: while next_attempt_at is in the future the drain
 *     skips them, so a poisoned row is not retried on every tick.
 *  3. Operator replay re-arms a dead letter with a fresh attempt budget;
 *     replaying unknown/empty id sets is a no-op.
 *
 * The failing consumer is the file-quarantine pipeline pointed at a storage
 * whose reads throw ECONNRESET — transient, so the missing-object terminal
 * path does not apply and the generic budget/backoff machinery is what saves
 * the drain.
 */
import { beforeAll, describe, expect, test } from 'bun:test'
import type { TestDb } from '@huriro/test-utils'
import { MemoryBlobStorage } from '../modules/files'
import { drainOutboxOnce, replayDeadLetterEvents } from '../worker'
import { apiRequest, createIntegrationServer, getTestDb, seedM1Fixture } from './test-harness'

/** Quarantine reads always fail with a TRANSIENT error — never ENOENT, so the
 * scan never terminates early and the row burns through its attempt budget. */
class TransientFailStorage extends MemoryBlobStorage {
	reads = 0
	override async readQuarantine(key: string): Promise<Uint8Array> {
		this.reads++
		throw Object.assign(new Error(`connection reset reading ${key}`), { code: 'ECONNRESET' })
	}
}

let db: TestDb | null = null

beforeAll(async () => {
	db = await getTestDb()
})

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

interface OutboxState {
	publishedAt: string | null
	attempts: number
	lastError: string | null
	deadLetteredAt: string | null
	nextAttemptAt: string | null
}

async function outboxState(owner: TestDb['owner'], workspaceId: string): Promise<OutboxState> {
	const rows = await owner<OutboxState[]>`
		SELECT published_at::text AS "publishedAt", attempts, last_error AS "lastError",
			dead_lettered_at::text AS "deadLetteredAt", next_attempt_at::text AS "nextAttemptAt"
		FROM outbox
		WHERE workspace_id = ${workspaceId} AND event_type = 'files.uploaded.v1'
	`
	expect(rows.length).toBe(1)
	const row = rows[0]
	if (!row) throw new Error('outbox row missing')
	return row
}

describe('outbox dead letters (PostgreSQL 18)', () => {
	test('1. permanently-failing event is dead-lettered after the attempt budget, then left alone', async () => {
		if (!db) return
		const fixture = await seedM1Fixture(db.owner)
		const { app, rootSecret } = createIntegrationServer(db)
		await uploadDraft(app, fixture.workspaceId, fixture.memberAId)

		const storage = new TransientFailStorage()
		const opts = {
			blobStorage: storage,
			rootSecret,
			onlyWorkspaceId: fixture.workspaceId,
			maxAttempts: 3,
			backoffBaseMs: 0 // deterministic: every retry is due immediately
		}

		// budget = 3 → three failing drains, each exactly one attempt
		await drainOutboxOnce(db.app, undefined, opts)
		let state = await outboxState(db.owner, fixture.workspaceId)
		expect(state.attempts).toBe(1)
		expect(state.deadLetteredAt).toBeNull()
		expect(state.publishedAt).toBeNull()

		await drainOutboxOnce(db.app, undefined, opts)
		// backoffBaseMs=0 still races the database clock by a few milliseconds under
		// a loaded full-suite run; make the third attempt explicitly due so this test
		// verifies the attempt budget rather than scheduler timing noise.
		await db.owner`
			UPDATE outbox SET next_attempt_at = NULL
			WHERE workspace_id = ${fixture.workspaceId} AND event_type = 'files.uploaded.v1'
		`
		await drainOutboxOnce(db.app, undefined, opts)
		state = await outboxState(db.owner, fixture.workspaceId)
		expect(state.attempts).toBe(3)
		expect(state.deadLetteredAt).not.toBeNull()
		expect(state.publishedAt).toBeNull() // terminal ≠ published: still inspectable as unfinished
		expect(state.lastError).toContain('connection reset')
		const readsAtDeath = storage.reads
		expect(readsAtDeath).toBe(3)

		// The dead letter is out of the retry loop: further drains never touch it.
		await drainOutboxOnce(db.app, undefined, opts)
		await drainOutboxOnce(db.app, undefined, opts)
		state = await outboxState(db.owner, fixture.workspaceId)
		expect(state.attempts).toBe(3)
		expect(storage.reads).toBe(readsAtDeath)

		// …but it is not silently dropped: payload + error sit in outbox for the
		// operator dead-letter view, and replay re-arms it.
		const idRows = await db.owner<{ id: string }[]>`
			SELECT id FROM outbox WHERE workspace_id = ${fixture.workspaceId} AND event_type = 'files.uploaded.v1'
		`
		const outboxId = idRows[0]?.id
		expect(outboxId).toBeDefined()
		if (!outboxId) return
		const replayed = await replayDeadLetterEvents(db.owner, [outboxId])
		expect(replayed).toBe(1)
		state = await outboxState(db.owner, fixture.workspaceId)
		expect(state.deadLetteredAt).toBeNull()
		expect(state.attempts).toBe(0)
		expect(state.lastError).toBeNull()

		// Re-armed means the drain picks it up again with a fresh budget.
		await drainOutboxOnce(db.app, undefined, opts)
		state = await outboxState(db.owner, fixture.workspaceId)
		expect(state.attempts).toBe(1)
	})

	test('2. failed rows back off — not retried while next_attempt_at is in the future', async () => {
		if (!db) return
		const fixture = await seedM1Fixture(db.owner)
		const { app, rootSecret } = createIntegrationServer(db)
		await uploadDraft(app, fixture.workspaceId, fixture.memberAId)

		const storage = new TransientFailStorage()
		const opts = {
			blobStorage: storage,
			rootSecret,
			onlyWorkspaceId: fixture.workspaceId,
			maxAttempts: 100,
			backoffBaseMs: 60_000 // first failure schedules the retry ~a minute out
		}

		await drainOutboxOnce(db.app, undefined, opts)
		let state = await outboxState(db.owner, fixture.workspaceId)
		expect(state.attempts).toBe(1)
		expect(state.nextAttemptAt).not.toBeNull()

		// Immediately draining again must skip the row entirely.
		await drainOutboxOnce(db.app, undefined, opts)
		state = await outboxState(db.owner, fixture.workspaceId)
		expect(state.attempts).toBe(1)
		expect(storage.reads).toBe(1)
	})

	test('3. replay is idempotent and scoped — empty/unknown ids re-arm nothing', async () => {
		if (!db) return
		expect(await replayDeadLetterEvents(db.owner, [])).toBe(0)
		expect(await replayDeadLetterEvents(db.owner, ['00000000-0000-0000-0000-000000000000'])).toBe(0)
		// replay-all on a workspace-less database state is out of scope here, but
		// the scoped form must never touch rows that are not dead-lettered.
		const fixture = await seedM1Fixture(db.owner)
		const { app, rootSecret, blobStorage } = createIntegrationServer(db)
		await uploadDraft(app, fixture.workspaceId, fixture.memberAId)
		await drainOutboxOnce(db.app, undefined, {
			blobStorage,
			rootSecret,
			onlyWorkspaceId: fixture.workspaceId
		})
		// healthy publish: replaying it must be a no-op
		const rows = await db.owner<{ id: string }[]>`
			SELECT id FROM outbox WHERE workspace_id = ${fixture.workspaceId} AND event_type = 'files.uploaded.v1'
		`
		const publishedId = rows[0]?.id
		expect(publishedId).toBeDefined()
		if (!publishedId) return
		expect(await replayDeadLetterEvents(db.owner, [publishedId])).toBe(0)
		const state = await outboxState(db.owner, fixture.workspaceId)
		expect(state.publishedAt).not.toBeNull()
		expect(state.attempts).toBe(0)
	})
})
