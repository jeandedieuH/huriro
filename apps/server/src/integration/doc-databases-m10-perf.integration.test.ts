/**
 * Gate G10/R24 property-aware database performance evidence.
 *
 * Disabled in the default suite because seeding 10k typed rows is intentionally
 * expensive. Run with HURIRO_PERF=1 plus the normal integration database env.
 * Regression assertions are 2× the product gates; printed timings are evidence.
 */
import { afterAll, describe, expect, test } from 'bun:test'
import { randomUUID } from 'node:crypto'
import type {
	DocDatabaseDetailDto,
	DocDatabasePropertyDto,
	DocDatabaseRowDto,
	DocDatabaseRowsPageDto
} from '@huriro/contracts'
import {
	compareDatabaseRows,
	type DatabaseFilterExpr,
	type DatabaseSortSpec,
	evaluateDatabaseFilter
} from '@huriro/domain'
import type { TestDb } from '@huriro/test-utils'
import { apiRequest, createIntegrationServer, getTestDb, seedM1Fixture } from './test-harness'

const PERF_ENABLED = process.env['HURIRO_PERF'] === '1'
const ROW_COUNT = 10_000

let db: TestDb | null = null

// Initialize inside the timed test rather than beforeAll: pulling/starting the
// PostgreSQL image can legitimately exceed Bun's fixed 5s hook timeout on a cold machine.
async function requirePerfDb(): Promise<TestDb> {
	if (!db) db = await getTestDb()
	if (!db) throw new Error('performance database unavailable')
	return db
}

type Fixture = Awaited<ReturnType<typeof seedM1Fixture>>
type App = ReturnType<typeof createIntegrationServer>['app']

interface PerfFixture {
	readonly fixture: Fixture
	readonly databaseId: string
	readonly properties: {
		readonly title: DocDatabasePropertyDto
		readonly number: DocDatabasePropertyDto
		readonly done: DocDatabasePropertyDto
		readonly due: DocDatabasePropertyDto
		readonly tags: DocDatabasePropertyDto
		readonly notes: DocDatabasePropertyDto
	}
}

function percentile(samples: readonly number[], q: number): number {
	const sorted = [...samples].sort((a, b) => a - b)
	return sorted[Math.max(0, Math.ceil(sorted.length * q) - 1)] ?? 0
}

async function timedRowsQuery(
	app: App,
	fixture: Fixture,
	databaseId: string,
	body: { filter?: DatabaseFilterExpr; sorts?: DatabaseSortSpec[]; limit?: number; cursor?: string }
) {
	const started = performance.now()
	const res = await apiRequest(app, {
		method: 'POST',
		path: `/api/v1/docs/databases/${databaseId}/rows/query`,
		workspaceId: fixture.workspaceId,
		userId: fixture.memberAId,
		email: fixture.memberAEmail,
		body: { limit: 200, ...body }
	})
	return { res, elapsedMs: performance.now() - started }
}

async function createProperty(
	app: App,
	fixture: Fixture,
	databaseId: string,
	name: string,
	propType: string
) {
	const res = await apiRequest(app, {
		method: 'POST',
		path: `/api/v1/docs/databases/${databaseId}/properties`,
		workspaceId: fixture.workspaceId,
		userId: fixture.memberAId,
		email: fixture.memberAEmail,
		headers: { 'idempotency-key': randomUUID() },
		body: { name, propType }
	})
	expect(res.status).toBe(201)
	return res.json as unknown as DocDatabasePropertyDto
}

async function seedPerfDatabase(testDb: TestDb, app: App): Promise<PerfFixture> {
	const fixture = await seedM1Fixture(testDb.owner)
	const created = await apiRequest(app, {
		method: 'POST',
		path: '/api/v1/docs/databases',
		workspaceId: fixture.workspaceId,
		userId: fixture.memberAId,
		email: fixture.memberAEmail,
		headers: { 'idempotency-key': randomUUID() },
		body: { title: `G10 perf ${randomUUID().slice(0, 8)}`, isInline: false }
	})
	expect(created.status).toBe(201)
	const detail = created.json as unknown as DocDatabaseDetailDto
	const databaseId = detail.database.id
	const title = detail.properties.find((p) => p.propType === 'title')!
	const number = await createProperty(app, fixture, databaseId, 'Estimate', 'number')
	const done = await createProperty(app, fixture, databaseId, 'Done', 'checkbox')
	const due = await createProperty(app, fixture, databaseId, 'Due', 'date')
	const tags = await createProperty(app, fixture, databaseId, 'Tags', 'multi_select')
	const notes = await createProperty(app, fixture, databaseId, 'Notes', 'text')

	await testDb.owner`
		INSERT INTO doc_database_rows (workspace_id,database_id,title,position,created_by,updated_by)
		SELECT ${fixture.workspaceId},${databaseId},'Perf row ' || g,'r' || lpad(g::text, 6, '0'),${fixture.memberAId},${fixture.memberAId}
		FROM generate_series(1, ${ROW_COUNT}) g
	`
	const joinSeries = `
		FROM doc_database_rows r
		JOIN generate_series(1, ${ROW_COUNT}) g ON r.position = 'r' || lpad(g::text, 6, '0')
		WHERE r.workspace_id = '${fixture.workspaceId}' AND r.database_id = '${databaseId}'
	`
	// Bulk fixture writes intentionally use the owner pool; all measured requests use huriro_app.
	await testDb.owner.unsafe(`
		INSERT INTO doc_database_cell_values (workspace_id,database_id,row_id,property_id,val_number)
		SELECT r.workspace_id,r.database_id,r.id,'${number.id}',CASE WHEN g % 7 = 0 THEN NULL ELSE ((g * 13) % 1000)::numeric / 10 END
		${joinSeries}
	`)
	await testDb.owner.unsafe(`
		INSERT INTO doc_database_cell_values (workspace_id,database_id,row_id,property_id,val_bool)
		SELECT r.workspace_id,r.database_id,r.id,'${done.id}',g % 3 = 0
		${joinSeries}
	`)
	await testDb.owner.unsafe(`
		INSERT INTO doc_database_cell_values (workspace_id,database_id,row_id,property_id,val_date_start)
		SELECT r.workspace_id,r.database_id,r.id,'${due.id}',CASE WHEN g % 5 = 0 THEN NULL ELSE (timestamptz '2026-01-01T00:00:00Z' + (g % 180) * interval '1 day') END
		${joinSeries}
	`)
	await testDb.owner.unsafe(`
		INSERT INTO doc_database_cell_values (workspace_id,database_id,row_id,property_id,val_json)
		SELECT r.workspace_id,r.database_id,r.id,'${tags.id}',CASE
			WHEN g % 4 = 0 THEN jsonb_build_array('red','ops')
			WHEN g % 4 = 1 THEN jsonb_build_array('blue')
			ELSE '[]'::jsonb END
		${joinSeries}
	`)
	await testDb.owner.unsafe(`
		INSERT INTO doc_database_cell_values (workspace_id,database_id,row_id,property_id,val_text)
		SELECT r.workspace_id,r.database_id,r.id,'${notes.id}',CASE
			WHEN g % 6 = 0 THEN 'urgent production fix'
			WHEN g % 6 = 1 THEN 'customer asks'
			ELSE NULL END
		${joinSeries}
	`)
	await testDb.owner.unsafe('ANALYZE doc_database_rows, doc_database_cell_values')
	return { fixture, databaseId, properties: { title, number, done, due, tags, notes } }
}

async function hydrateAllRows(app: App, seeded: PerfFixture): Promise<DocDatabaseRowDto[]> {
	const rows: DocDatabaseRowDto[] = []
	let cursor: string | undefined
	for (let page = 0; page < 100; page++) {
		const res = await apiRequest(app, {
			method: 'POST',
			path: `/api/v1/docs/databases/${seeded.databaseId}/rows/query`,
			workspaceId: seeded.fixture.workspaceId,
			userId: seeded.fixture.memberAId,
			email: seeded.fixture.memberAEmail,
			body: { limit: 500, ...(cursor ? { cursor } : {}) }
		})
		expect(res.status).toBe(200)
		const data = res.json as unknown as DocDatabaseRowsPageDto
		rows.push(...data.rows)
		if (!data.hasMore) return rows
		cursor = data.nextCursor ?? undefined
	}
	throw new Error('pagination did not terminate')
}

describe('Gate G10 database performance evidence (HURIRO_PERF=1 only)', () => {
	afterAll(async () => {
		if (db) {
			await db.stop()
			db = null
		}
	})

	test('10k typed rows: filtered/sorted server windows and local replica evaluation stay within regression gates', async () => {
		if (!PERF_ENABLED) return
		const testDb = await requirePerfDb()
		const { app, pubsub } = createIntegrationServer(testDb)
		try {
			const seeded = await seedPerfDatabase(testDb, app)
			const p = seeded.properties
			const filter: DatabaseFilterExpr = {
				kind: 'and',
				children: [
					{ kind: 'predicate', propertyId: p.number.id, op: 'gte', value: 20 },
					{ kind: 'predicate', propertyId: p.done.id, op: 'eq', value: true },
					{
						kind: 'or',
						children: [
							{ kind: 'predicate', propertyId: p.tags.id, op: 'contains', value: 'red' },
							{ kind: 'predicate', propertyId: p.notes.id, op: 'contains', value: 'urgent' }
						]
					}
				]
			}
			const sorts: DatabaseSortSpec[] = [
				{ propertyId: p.number.id, direction: 'desc' },
				{ propertyId: p.due.id, direction: 'asc' }
			]
			for (let i = 0; i < 3; i++) {
				const warm = await timedRowsQuery(app, seeded.fixture, seeded.databaseId, { filter, sorts })
				expect(warm.res.status).toBe(200)
			}
			const samples: number[] = []
			for (let i = 0; i < 12; i++) {
				const measured = await timedRowsQuery(app, seeded.fixture, seeded.databaseId, { filter, sorts })
				expect(measured.res.status).toBe(200)
				samples.push(measured.elapsedMs)
			}
			const serverP95 = percentile(samples, 0.95)
			console.log(
				`G10 server 10k typed filter+sort window: p50=${percentile(samples, 0.5).toFixed(1)}ms p95=${serverP95.toFixed(1)}ms samples=${samples.map((n) => n.toFixed(1)).join(',')}`
			)
			// Product gate: <120ms server; regression assertion is deliberately 2×.
			expect(serverP95).toBeLessThan(240)

			const rows = await hydrateAllRows(app, seeded)
			expect(rows).toHaveLength(ROW_COUNT)
			const propertyMeta = [p.title, p.number, p.done, p.due, p.tags, p.notes]
			for (let i = 0; i < 3; i++) {
				const warmFiltered = rows.filter((row) => evaluateDatabaseFilter(filter, row, propertyMeta))
				warmFiltered.sort((a, b) => compareDatabaseRows(a, b, sorts, propertyMeta))
				expect(warmFiltered.length).toBeGreaterThan(0)
			}
			const localSamples: number[] = []
			for (let i = 0; i < 12; i++) {
				const started = performance.now()
				const filtered = rows.filter((row) => evaluateDatabaseFilter(filter, row, propertyMeta))
				filtered.sort((a, b) => compareDatabaseRows(a, b, sorts, propertyMeta))
				localSamples.push(performance.now() - started)
				expect(filtered.length).toBeGreaterThan(0)
			}
			const localP95 = percentile(localSamples, 0.95)
			console.log(
				`G10 local 10k typed filter+sort: p50=${percentile(localSamples, 0.5).toFixed(1)}ms p95=${localP95.toFixed(1)}ms bytes=${JSON.stringify(rows).length}`
			)
			// Product gate: <16ms local; regression assertion is deliberately 2×.
			expect(localP95).toBeLessThan(32)
		} finally {
			await pubsub.close()
		}
	}, 300_000)
})
