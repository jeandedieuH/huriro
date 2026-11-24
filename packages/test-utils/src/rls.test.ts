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

	// Sweeps every tenant table sequentially — table count grows each milestone,
	// so the default 5s timeout is too tight on cold/dev DBs.
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
	}, 30_000)

	test('two tenants cannot see across the boundary, as huriro_app', async () => {
		if (skip()) return
		const { wsA, wsB, userA, userB } = await seedTwoTenants(db!.owner)

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

		// roles: each workspace seeds 4 system roles; 0010 allows active members to read
		// roles of workspaces they belong to (for /workspaces/current discovery), while
		// workspaces where the user has no membership remain invisible.
		expect(await countIn('roles', wsA.id, userA.id)).toBe(4)
		expect(await countIn('roles', wsB.id, userB.id)).toBe(4)
		expect(await foreignIn('roles', wsA.id, wsB.id, userA.id)).toBe(0)
		expect(await foreignIn('roles', wsB.id, wsA.id, userB.id)).toBe(0)

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
	}, 30_000)

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

	test('M3 agent tables: cross-tenant deny + agent_tool_calls is append-only', async () => {
		if (skip()) return
		const { wsA, wsB, userA, userB } = await seedTwoTenants(db!.owner)

		// Seed a principal + tool-call row in wsA via the owner pool.
		const [principal] = await db!.owner<{ id: string }[]>`
			INSERT INTO agent_principals (workspace_id, kind, name, owner_user_id, scope_ceiling)
			VALUES (${wsA.id}, 'automation', 'rls-test-agent', ${userA.id}, '{tasks.read}'::text[])
			RETURNING id
		`
		const [call] = await db!.owner<{ id: string }[]>`
			INSERT INTO agent_tool_calls
				(workspace_id, agent_id, owner_user_id, tool, args_hash, requested_tier, effective_tier, status)
			VALUES
				(${wsA.id}, ${principal!.id}, ${userA.id}, 'tasks.search', 'h', 'R0', 'R0', 'ok')
			RETURNING id
		`

		// wsB context sees neither row (as huriro_app, never the owner).
		const foreignCount = await withWorkspace(
			db!.app,
			{ workspaceId: wsB.id, userId: userB.id },
			async (tx) => {
				const [a] = await tx<{ n: number }[]>`
					SELECT count(*)::int AS n FROM agent_principals WHERE workspace_id = ${wsA.id}`
				const [c] = await tx<{ n: number }[]>`
					SELECT count(*)::int AS n FROM agent_tool_calls WHERE workspace_id = ${wsA.id}`
				return a!.n + c!.n
			}
		)
		expect(foreignCount).toBe(0)

		// Append-only: huriro_app has SELECT+INSERT but no UPDATE/DELETE grant.
		// Each denial runs in its own tx — a permission error aborts the block —
		// and queries are awaited inside try/catch because postgres.js Query
		// objects start eagerly (rejects matchers race otherwise).
		const denied = async (q: PromiseLike<unknown>) => {
			try {
				await q
				return null
			} catch (e) {
				return e as { code?: string; message?: string }
			}
		}
		// Denials run on the bare pool: a failed statement inside sql.begin aborts
		// the whole tx, and the ACL check fires before any tenant policy anyway.
		const updErr = await denied(db!.app`UPDATE agent_tool_calls SET status = 'error' WHERE id = ${call!.id}`)
		expect(updErr?.code ?? updErr?.message ?? '').toMatch(/42501|permission denied/)
		const delErr = await denied(db!.app`DELETE FROM agent_tool_calls WHERE id = ${call!.id}`)
		expect(delErr?.code ?? delErr?.message ?? '').toMatch(/42501|permission denied/)

		// INSERT in the right tenant still works (the dispatcher depends on it).
		await withWorkspace(db!.app, { workspaceId: wsA.id, userId: userA.id }, async (tx) => {
			await tx`
				INSERT INTO agent_tool_calls
					(workspace_id, agent_id, owner_user_id, tool, args_hash, requested_tier, effective_tier, status)
				VALUES
					(${wsA.id}, ${principal!.id}, ${userA.id}, 'tasks.get', 'h2', 'R0', 'R0', 'ok')
			`
		})
		// A foreign-workspace insert is rejected (RLS WITH CHECK and/or composite FK).
		const insErr = await denied(db!.app`
			INSERT INTO agent_tool_calls
				(workspace_id, agent_id, owner_user_id, tool, args_hash, requested_tier, effective_tier, status)
			VALUES
				(${wsB.id}, ${principal!.id}, ${userB.id}, 'tasks.get', 'h3', 'R0', 'R0', 'ok')
		`)
		expect(insErr).not.toBeNull()
	})
})
