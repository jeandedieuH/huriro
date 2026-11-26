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

let db: TestDb | null = null

// Testcontainers can exceed Bun's fixed hook timeout on a cold machine. Lazy
// initialization inside the timed tests keeps cold-start behavior deterministic.
async function ensureDb(): Promise<TestDb | null> {
	if (!db) db = await getTestDb()
	return db
}

function integrationTest(name: string, fn: () => Promise<void>) {
	test(name, fn, 60_000)
}

type Fixture = Awaited<ReturnType<typeof seedM1Fixture>>
type App = ReturnType<typeof createIntegrationServer>['app']

function req(app: App, fixture: Fixture, opts: Parameters<typeof apiRequest>[1]) {
	return apiRequest(app, { workspaceId: fixture.workspaceId, userId: fixture.ownerId, ...opts })
}

function asMember(app: App, fixture: Fixture, opts: Parameters<typeof apiRequest>[1]) {
	return apiRequest(app, {
		workspaceId: fixture.workspaceId,
		userId: fixture.memberAId,
		email: fixture.memberAEmail,
		...opts
	})
}

function cell(input: Partial<DocDatabaseRowDto['cells'][string]>): DocDatabaseRowDto['cells'][string] {
	return { text: null, number: null, boolean: null, dateStart: null, dateEnd: null, json: null, ...input }
}

async function createDatabase(app: App, fixture: Fixture, title = 'M10 database') {
	const res = await asMember(app, fixture, {
		method: 'POST',
		path: '/api/v1/docs/databases',
		headers: { 'idempotency-key': randomUUID() },
		body: { title, isInline: false }
	})
	expect(res.status).toBe(201)
	return res.json as unknown as DocDatabaseDetailDto
}

async function createProperty(
	app: App,
	fixture: Fixture,
	databaseId: string,
	input: { name: string; propType: string; config?: Record<string, unknown> }
) {
	const res = await asMember(app, fixture, {
		method: 'POST',
		path: `/api/v1/docs/databases/${databaseId}/properties`,
		headers: { 'idempotency-key': randomUUID() },
		body: input
	})
	expect(res.status).toBe(201)
	return res.json as unknown as DocDatabasePropertyDto
}

async function createRow(
	app: App,
	fixture: Fixture,
	databaseId: string,
	input: { title: string; cells?: DocDatabaseRowDto['cells'] }
) {
	const res = await asMember(app, fixture, {
		method: 'POST',
		path: `/api/v1/docs/databases/${databaseId}/rows`,
		headers: { 'idempotency-key': randomUUID() },
		body: input
	})
	expect(res.status).toBe(201)
	return res.json as unknown as DocDatabaseRowDto
}

async function queryRows(
	app: App,
	fixture: Fixture,
	databaseId: string,
	body: { filter?: DatabaseFilterExpr; sorts?: DatabaseSortSpec[]; limit?: number; cursor?: string } = {}
) {
	const res = await asMember(app, fixture, {
		method: 'POST',
		path: `/api/v1/docs/databases/${databaseId}/rows/query`,
		body: { limit: 500, ...body }
	})
	expect(res.status).toBe(200)
	return res.json as unknown as DocDatabaseRowsPageDto
}

async function seedTypedRows(app: App, fixture: Fixture) {
	const detail = await createDatabase(app, fixture, 'Typed inventory')
	const dbid = detail.database.id
	const titleProp = detail.properties.find((p) => p.propType === 'title')!
	const number = await createProperty(app, fixture, dbid, { name: 'Estimate', propType: 'number' })
	const done = await createProperty(app, fixture, dbid, { name: 'Done', propType: 'checkbox' })
	const when = await createProperty(app, fixture, dbid, { name: 'Due', propType: 'date' })
	const tags = await createProperty(app, fixture, dbid, { name: 'Tags', propType: 'multi_select' })
	const owner = await createProperty(app, fixture, dbid, { name: 'Owner', propType: 'person' })
	const notes = await createProperty(app, fixture, dbid, { name: 'Notes', propType: 'text' })
	const rows: DocDatabaseRowDto[] = []
	for (let i = 0; i < 40; i++) {
		rows.push(
			await createRow(app, fixture, dbid, {
				title: i % 9 === 0 ? 'Quarterly Report' : `Alpha task ${i}`,
				cells: {
					[number.id]: i % 7 === 0 ? cell({}) : cell({ number: ((i * 13) % 31) + 0.5 }),
					[done.id]: cell({ boolean: i % 3 === 0 }),
					[when.id]: i % 5 === 0 ? cell({}) : cell({ dateStart: `2026-0${(i % 8) + 1}-15T00:00:00.000Z` }),
					[tags.id]: cell({ json: i % 4 === 0 ? ['red', 'ops'] : i % 4 === 1 ? ['blue'] : [] }),
					[owner.id]: cell({ json: i % 2 === 0 ? [fixture.memberAId] : [] }),
					[notes.id]: cell({
						text: i % 6 === 0 ? 'urgent production fix' : i % 6 === 1 ? 'customer asks' : null
					})
				}
			})
		)
	}
	rows.push(
		await createRow(app, fixture, dbid, {
			title: 'Sparse empty row',
			cells: {}
		})
	)
	return { detail, dbid, titleProp, number, done, when, tags, owner, notes, rows }
}

describe('M10 document databases integration (PostgreSQL 18)', () => {
	afterAll(async () => {
		if (db) {
			await db.stop()
			db = null
		}
	})

	integrationTest(
		'CRUD authorization and cross-tenant deny paths use database permissions and workspace isolation',
		async () => {
			const testDb = await ensureDb()
			if (!testDb) return
			const fixture = await seedM1Fixture(testDb.owner)
			const { app, pubsub } = createIntegrationServer(testDb)
			try {
				const detail = await createDatabase(app, fixture)
				const dbid = detail.database.id
				expect(detail.database.createdBy).toBe(fixture.memberAId)
				expect(detail.properties.some((p) => p.propType === 'title')).toBe(true)
				expect(detail.views.some((v) => v.viewType === 'table')).toBe(true)

				const read = await asMember(app, fixture, { path: `/api/v1/docs/databases/${dbid}` })
				expect(read.status).toBe(200)
				const outsiderRead = await apiRequest(app, {
					path: `/api/v1/docs/databases/${dbid}`,
					workspaceId: fixture.workspaceId,
					userId: fixture.outsiderId,
					email: fixture.outsiderEmail
				})
				expect([401, 403, 404]).toContain(outsiderRead.status)
				for (const user of [
					{ id: fixture.guestId, email: fixture.guestEmail },
					{ id: fixture.suspendedId, email: fixture.suspendedEmail }
				]) {
					const denied = await apiRequest(app, {
						path: `/api/v1/docs/databases/${dbid}`,
						workspaceId: fixture.workspaceId,
						userId: user.id,
						email: user.email
					})
					expect(denied.status).toBe(403)
					const writeDenied = await apiRequest(app, {
						method: 'POST',
						path: `/api/v1/docs/databases/${dbid}/rows`,
						workspaceId: fixture.workspaceId,
						userId: user.id,
						email: user.email,
						headers: { 'idempotency-key': randomUUID() },
						body: { title: 'denied' }
					})
					expect(writeDenied.status).toBe(403)
				}

				const foreign = await req(app, fixture, { path: `/api/v1/docs/databases/${randomUUID()}` })
				expect(foreign.status).toBe(404)
				const crossTenant = await apiRequest(app, {
					path: `/api/v1/docs/databases/${dbid}`,
					workspaceId: fixture.otherWorkspaceId,
					userId: fixture.otherTenantUserId,
					email: fixture.otherTenantEmail
				})
				expect([403, 404]).toContain(crossTenant.status)
			} finally {
				await pubsub.close()
			}
		}
	)

	integrationTest(
		'filter SQL is differentially equivalent to the domain evaluator across typed values and nulls',
		async () => {
			const testDb = await ensureDb()
			if (!testDb) return
			const fixture = await seedM1Fixture(testDb.owner)
			const { app, pubsub } = createIntegrationServer(testDb)
			try {
				const seeded = await seedTypedRows(app, fixture)
				const properties = [
					seeded.titleProp,
					seeded.number,
					seeded.done,
					seeded.when,
					seeded.tags,
					seeded.owner,
					seeded.notes
				]
				const all = (await queryRows(app, fixture, seeded.dbid)).rows
				expect(all.length).toBe(seeded.rows.length)
				const p = seeded
				const numGte10: DatabaseFilterExpr = {
					kind: 'predicate',
					propertyId: p.number.id,
					op: 'gte',
					value: 10
				}
				const numLt8: DatabaseFilterExpr = { kind: 'predicate', propertyId: p.number.id, op: 'lt', value: 8 }
				const numIsNull: DatabaseFilterExpr = { kind: 'predicate', propertyId: p.number.id, op: 'is_null' }
				const doneTrue: DatabaseFilterExpr = {
					kind: 'predicate',
					propertyId: p.done.id,
					op: 'eq',
					value: true
				}
				const whenIsNull: DatabaseFilterExpr = { kind: 'predicate', propertyId: p.when.id, op: 'is_null' }
				const tagsRed: DatabaseFilterExpr = {
					kind: 'predicate',
					propertyId: p.tags.id,
					op: 'contains',
					value: 'red'
				}
				const ownerMember: DatabaseFilterExpr = {
					kind: 'predicate',
					propertyId: p.owner.id,
					op: 'contains',
					value: fixture.memberAId
				}
				const notesUrgent: DatabaseFilterExpr = {
					kind: 'predicate',
					propertyId: p.notes.id,
					op: 'contains',
					value: 'URGENT'
				}
				const predicates: DatabaseFilterExpr[] = [
					numGte10,
					numLt8,
					numIsNull,
					{ kind: 'predicate', propertyId: p.number.id, op: 'is_not_null' },
					doneTrue,
					{ kind: 'predicate', propertyId: p.done.id, op: 'neq', value: true },
					{ kind: 'predicate', propertyId: p.when.id, op: 'lt', value: '2026-04-01' },
					whenIsNull,
					tagsRed,
					{ kind: 'predicate', propertyId: p.tags.id, op: 'eq', value: 'blue' },
					{ kind: 'predicate', propertyId: p.tags.id, op: 'in', value: ['red', 'missing'] },
					{ kind: 'predicate', propertyId: p.tags.id, op: 'nin', value: ['red'] },
					{ kind: 'predicate', propertyId: p.tags.id, op: 'is_null' },
					{ kind: 'predicate', propertyId: p.tags.id, op: 'is_not_null' },
					ownerMember,
					notesUrgent,
					{ kind: 'predicate', propertyId: p.notes.id, op: 'is_null' },
					{ kind: 'predicate', propertyId: p.notes.id, op: 'is_not_null' },
					{ kind: 'predicate', propertyId: p.titleProp.id, op: 'contains', value: 'report' },
					{ kind: 'predicate', propertyId: p.titleProp.id, op: 'in', value: ['Alpha task 1', 'missing'] },
					{ kind: 'predicate', propertyId: p.number.id, op: 'neq', value: 13.5 },
					{ kind: 'predicate', propertyId: p.number.id, op: 'nin', value: [13.5, 26.5] }
				]
				const expressions: DatabaseFilterExpr[] = [
					...predicates,
					{
						kind: 'and',
						children: [numGte10, doneTrue, { kind: 'not', child: ownerMember }]
					},
					{
						kind: 'or',
						children: [numLt8, { kind: 'and', children: [tagsRed, notesUrgent] }]
					},
					{ kind: 'not', child: { kind: 'or', children: [numIsNull, whenIsNull] } },
					{ kind: 'not', child: numLt8 }
				]
				for (const [index, filter] of expressions.entries()) {
					const page = await queryRows(app, fixture, seeded.dbid, { filter })
					const expected = all
						.filter((row) => evaluateDatabaseFilter(filter, row, properties))
						.map((row) => row.id)
						.sort()
					const actual = page.rows.map((row) => row.id).sort()
					expect({ index, actual }).toEqual({ index, actual: expected })
				}

				for (const sorts of [
					[{ propertyId: p.number.id, direction: 'asc' as const }],
					[
						{ propertyId: p.number.id, direction: 'desc' as const },
						{ propertyId: p.titleProp.id, direction: 'asc' as const }
					],
					[{ propertyId: p.when.id, direction: 'asc' as const }]
				]) {
					const page = await queryRows(app, fixture, seeded.dbid, { sorts })
					const expected = [...all]
						.sort((a, b) => compareDatabaseRows(a, b, sorts, properties))
						.map((row) => row.id)
					expect(page.rows.map((row) => row.id)).toEqual(expected)
				}

				// Combined filter + sort referencing the same property across paginated windows.
				const combinedFilter: DatabaseFilterExpr = {
					kind: 'and',
					children: [
						{ kind: 'predicate', propertyId: p.number.id, op: 'gte', value: 10 },
						{
							kind: 'or',
							children: [
								{ kind: 'predicate', propertyId: p.tags.id, op: 'contains', value: 'red' },
								{ kind: 'predicate', propertyId: p.notes.id, op: 'is_null' }
							]
						}
					]
				}
				const combinedSorts: DatabaseSortSpec[] = [
					{ propertyId: p.number.id, direction: 'desc' },
					{ propertyId: p.when.id, direction: 'asc' }
				]
				const combinedActual: string[] = []
				let pageCursor: string | undefined
				for (let step = 0; step < 20; step++) {
					const page = await queryRows(app, fixture, seeded.dbid, {
						filter: combinedFilter,
						sorts: combinedSorts,
						limit: 10,
						...(pageCursor ? { cursor: pageCursor } : {})
					})
					combinedActual.push(...page.rows.map((row) => row.id))
					if (!page.hasMore) break
					pageCursor = page.nextCursor ?? undefined
				}
				const combinedExpected = all
					.filter((row) => evaluateDatabaseFilter(combinedFilter, row, properties))
					.sort((a, b) => compareDatabaseRows(a, b, combinedSorts, properties))
					.map((row) => row.id)
				expect(combinedActual).toEqual(combinedExpected)
			} finally {
				await pubsub.close()
			}
		}
	)

	integrationTest(
		'CSV/JSON import-export, row-page allocation, and optimistic-create id fields round trip',
		async () => {
			const testDb = await ensureDb()
			if (!testDb) return
			const fixture = await seedM1Fixture(testDb.owner)
			const { app, pubsub } = createIntegrationServer(testDb)
			try {
				const databaseId = randomUUID()
				const titlePropertyId = randomUUID()
				const tableViewId = randomUUID()
				const created = await asMember(app, fixture, {
					method: 'POST',
					path: '/api/v1/docs/databases',
					headers: { 'idempotency-key': randomUUID() },
					body: { id: databaseId, titlePropertyId, tableViewId, title: 'Portable' }
				})
				expect(created.status).toBe(201)
				const detail = created.json as unknown as DocDatabaseDetailDto
				expect(detail.properties[0]?.id).toBe(titlePropertyId)
				expect(detail.views[0]?.id).toBe(tableViewId)

				const imported = await asMember(app, fixture, {
					method: 'POST',
					path: `/api/v1/docs/databases/${databaseId}/rows/import`,
					headers: { 'idempotency-key': randomUUID() },
					body: { format: 'csv', data: 'Name\nAlpha\nBeta\n' }
				})
				expect([200, 201]).toContain(imported.status)
				expect(imported.json['created']).toBe(2)
				const exported = await asMember(app, fixture, {
					path: `/api/v1/docs/databases/${databaseId}/rows/export?format=csv`
				})
				expect(exported.status).toBe(200)
				expect(String(exported.json['raw'] ?? exported.json['data'] ?? '')).toContain('Alpha')

				const rows = await queryRows(app, fixture, databaseId)
				const first = rows.rows[0]
				expect(first).toBeDefined()
				const allocate = await asMember(app, fixture, {
					method: 'POST',
					path: `/api/v1/docs/databases/${databaseId}/rows/${first!.id}/page`,
					headers: { 'idempotency-key': randomUUID() }
				})
				expect([200, 201]).toContain(allocate.status)
				const pageId = String(allocate.json['pageId'] ?? allocate.json['id'])
				const again = await asMember(app, fixture, {
					method: 'POST',
					path: `/api/v1/docs/databases/${databaseId}/rows/${first!.id}/page`,
					headers: { 'idempotency-key': randomUUID() }
				})
				expect(String(again.json['pageId'] ?? again.json['id'])).toBe(pageId)
			} finally {
				await pubsub.close()
			}
		}
	)
})
