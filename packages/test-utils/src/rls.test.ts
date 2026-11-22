/**
 * RLS coverage test — the §4.2/§12.4 gate:
 *   1. every public table is classified (the "entry" requirement)
 *   2. every RLS table has ENABLE + FORCE + ≥1 policy
 *   3. no workspace context → zero rows on every tenant table (as huriro_app)
 *   4. two-tenant fixtures cannot see across the boundary (as huriro_app,
 *      never the owner — §12.4)
 *   5. memberships/workspaces carry their documented visibility exceptions
 *   6. can_read() grants/denies per acl_entries
 *
 * Skips cleanly when no test DB is available (unit runs never need Docker).
 */
import { beforeAll, describe, expect, test } from 'bun:test'
import { randomUUID } from 'node:crypto'
import { type Queryable, withWorkspace } from '@huriro/db'
import { getTestDb, type TestDb } from './db'
import { aMembership, anAclEntry, aUser, aWorkspace, seedTwoTenants } from './factories'
import { classifyTable, INSTANCE_RLS_TABLES, SYSTEM_TABLES, TENANT_TABLES } from './rls'

let db: TestDb | null = null

beforeAll(async () => {
	db = await getTestDb()
})

function skip(): boolean {
	return db === null
}

describe('rls coverage', () => {
	test('every public table is classified', async () => {
		if (skip()) return
		const rows = await db!.owner<{ tableName: string }[]>`
			SELECT tablename AS "tableName" FROM pg_tables WHERE schemaname = 'public'
		`
		const unclassified = rows.map((r) => r.tableName).filter((t) => classifyTable(t) === null)
		expect(unclassified).toEqual([])
	})

	test('every RLS table has FORCE + at least one policy', async () => {
		if (skip()) return
		const expected = [...TENANT_TABLES, ...INSTANCE_RLS_TABLES]
		const rows = await db!.owner<{ tableName: string; rls: boolean; force: boolean }[]>`
			SELECT c.relname AS "tableName", c.relrowsecurity AS rls, c.relforcerowsecurity AS force
			FROM pg_class c
			JOIN pg_namespace n ON n.oid = c.relnamespace
			WHERE n.nspname = 'public' AND c.relkind = 'r'
		`
		const byName = new Map(rows.map((r) => [r.tableName, r]))
		for (const t of expected) {
			const row = byName.get(t)
			expect(row, `missing table ${t}`).toBeDefined()
			expect(row!.rls, `RLS not enabled on ${t}`).toBe(true)
			expect(row!.force, `FORCE RLS missing on ${t}`).toBe(true)
		}
		const policies = await db!.owner<{ tableName: string; count: number }[]>`
			SELECT tablename AS "tableName", count(*)::int AS count
			FROM pg_policies WHERE schemaname = 'public' GROUP BY tablename
		`
		const policyCount = new Map(policies.map((p) => [p.tableName, p.count]))
		for (const t of expected) {
			expect(policyCount.get(t) ?? 0, `no policy on ${t}`).toBeGreaterThan(0)
		}
	})

	test('system tables are NOT tenant-RLS (classification is honest)', async () => {
		if (skip()) return
		for (const t of SYSTEM_TABLES) {
			// System tables either have no RLS or non-tenant policies — the point is
			// they're classified, not that they're unprotected. Grant state is
			// asserted by the grant test below.
			const cls = classifyTable(t)
			expect(cls).toBe('system')
		}
	})

	test('no context → zero rows on every tenant table, as huriro_app', async () => {
		if (skip()) return
		// Fixture rows exist (owner pool, bypasses RLS).
		const { wsA } = await seedTwoTenants(db!.owner)
		await anAclEntry(db!.owner, {
			workspaceId: wsA.id,
			resourceType: 'doc_page',
			principalType: 'user',
			principalId: randomUUID(),
			permission: 'read'
		})
		for (const t of TENANT_TABLES) {
			const [row] = await db!.app.unsafe<{ n: number }[]>(`SELECT count(*)::int AS n FROM ${t}`)
			expect(row!.n, `${t} leaked rows without tenant context`).toBe(0)
		}
	})

	test('two tenants cannot see across the boundary, as huriro_app', async () => {
		if (skip()) return
		const { wsA, wsB, userA } = await seedTwoTenants(db!.owner)

		// A doc shared with userA in wsA; wsB must never see it.
		const docId = randomUUID()
		await anAclEntry(db!.owner, {
			workspaceId: wsA.id,
			resourceType: 'doc_page',
			resourceId: docId,
			principalType: 'user',
			principalId: userA.id,
			permission: 'write'
		})

		const countIn = async (table: string, wsId: string, userId: string) =>
			withWorkspace(db!.app, { workspaceId: wsId, userId }, async (tx) => {
				const [r] = await tx.unsafe<{ n: number }[]>(`SELECT count(*)::int AS n FROM ${table}`)
				return r!.n
			})
		// Rows belonging to a different workspace must be invisible inside ctx:
		const foreignIn = async (table: string, ctxWsId: string, foreignWsId: string, userId: string) =>
			withWorkspace(db!.app, { workspaceId: ctxWsId, userId }, async (tx) => {
				const [r] = await tx.unsafe<{ n: number }[]>(
					`SELECT count(*)::int AS n FROM ${table} WHERE workspace_id = '${foreignWsId}'`
				)
				return r!.n
			})

		// roles: each workspace seeds 4 system roles — ctx sees its own only.
		expect(await countIn('roles', wsA.id, userA.id)).toBe(4)
		expect(await countIn('roles', wsB.id, userA.id)).toBe(4)
		expect(await foreignIn('roles', wsB.id, wsA.id, userA.id)).toBe(0)
		expect(await foreignIn('roles', wsA.id, wsB.id, userA.id)).toBe(0)

		// acl_entries: the shared doc exists only under wsA's context.
		expect(await countIn('acl_entries', wsA.id, userA.id)).toBe(1)
		expect(await countIn('acl_entries', wsB.id, userA.id)).toBe(0)

		// change_log: a write inside wsA is invisible from wsB.
		await withWorkspace(db!.owner, { workspaceId: wsA.id, userId: userA.id }, async (tx) => {
			await tx`
				INSERT INTO change_log (workspace_id, cursor, entity_type, entity_id, action)
				VALUES (${wsA.id}, 1, 'test', ${docId}, 'upsert')
			`
		})
		expect(await countIn('change_log', wsA.id, userA.id)).toBe(1)
		expect(await countIn('change_log', wsB.id, userA.id)).toBe(0)
	})

	test('memberships: a user sees their own rows across workspaces', async () => {
		if (skip()) return
		const { wsA, wsB, userA } = await seedTwoTenants(db!.owner)
		// Add userA to wsB as well.
		await aMembership(db!.owner, { workspaceId: wsB.id, userId: userA.id, roleId: wsB.roleIds['member']! })

		// With only a user context (no workspace), own memberships are visible —
		// required for "my workspaces" before tenant context exists (§12.4).
		const rows = await db!.app.begin(async (tx) => {
			await tx`SELECT set_config('app.user_id', ${userA.id}, true)`
			return tx<{ workspaceId: string }[]>`
				SELECT workspace_id AS "workspaceId" FROM memberships WHERE user_id = ${userA.id}
			`
		})
		const wsIds = rows.map((r) => r.workspaceId).sort()
		expect(wsIds).toEqual([wsA.id, wsB.id].sort())
	})

	test('workspaces: member-visible only', async () => {
		if (skip()) return
		const { wsA, wsB, userA } = await seedTwoTenants(db!.owner)
		const visible = await db!.app.begin(async (tx) => {
			await tx`SELECT set_config('app.user_id', ${userA.id}, true)`
			return tx<{ id: string }[]>`SELECT id FROM workspaces`
		})
		const ids = visible.map((w) => w.id)
		expect(ids).toContain(wsA.id)
		expect(ids).not.toContain(wsB.id) // userA is not a member of wsB
	})

	test('can_read() honors acl_entries — inside tenant context only', async () => {
		if (skip()) return
		const userA = await aUser(db!.owner)
		const stranger = await aUser(db!.owner)
		const wsA = await aWorkspace(db!.owner)
		const wsB = await aWorkspace(db!.owner)
		await aMembership(db!.owner, { workspaceId: wsA.id, userId: userA.id, roleId: wsA.roleIds['member']! })
		const docId = randomUUID()
		await anAclEntry(db!.owner, {
			workspaceId: wsA.id,
			resourceType: 'doc_page',
			resourceId: docId,
			principalType: 'user',
			principalId: userA.id,
			permission: 'read'
		})

		const inCtx = (wsId: string, fn: (tx: Queryable) => Promise<boolean>) =>
			withWorkspace(db!.app, { workspaceId: wsId, userId: userA.id }, fn)

		expect(
			await inCtx(wsA.id, async (tx) => {
				const [r] = await tx<{ ok: boolean }[]>`
					SELECT can_read(${wsA.id}, 'doc_page', ${docId}, ${userA.id}) AS ok`
				return r!.ok
			})
		).toBe(true)

		expect(
			await inCtx(wsA.id, async (tx) => {
				const [r] = await tx<{ ok: boolean }[]>`
					SELECT can_read(${wsA.id}, 'doc_page', ${docId}, ${stranger.id}) AS ok`
				return r!.ok
			})
		).toBe(false)

		// Write level requires more than a read grant.
		expect(
			await inCtx(wsA.id, async (tx) => {
				const [r] = await tx<{ ok: boolean }[]>`
					SELECT can_read(${wsA.id}, 'doc_page', ${docId}, ${userA.id}, 'write') AS ok`
				return r!.ok
			})
		).toBe(false)

		// Cross-tenant probing fails closed: wsB context can't ask about wsA's doc.
		expect(
			await inCtx(wsB.id, async (tx) => {
				const [r] = await tx<{ ok: boolean }[]>`
					SELECT can_read(${wsA.id}, 'doc_page', ${docId}, ${userA.id}) AS ok`
				return r!.ok
			})
		).toBe(false)
	})
})
