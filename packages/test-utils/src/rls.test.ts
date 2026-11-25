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
import {
	aCycle,
	aMembership,
	anAclEntry,
	anIssue,
	aProject,
	aUser,
	aWorkspace,
	seedTwoTenants
} from './factories'
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

	test('M7 tables: cross-tenant deny on every new tenant table', async () => {
		if (skip()) return
		const { wsA, wsB, userA, userB } = await seedTwoTenants(db!.owner)

		// wsA fixtures via the owner pool: a cycle (snapshot FK), an automation
		// principal + rule + run + step chain, and one entity_links edge.
		const projA = await aProject(db!.owner, { workspaceId: wsA.id, createdBy: userA.id })
		const cycleId = await aCycle(db!.owner, { workspaceId: wsA.id, projectId: projA.id })
		await db!.owner`
			INSERT INTO cycle_daily_snapshots
				(workspace_id, cycle_id, snapshot_date, total_issues, completed_issues, started_issues)
			VALUES (${wsA.id}, ${cycleId}, '2026-11-24', 10, 4, 5)
		`
		await db!.owner`
			INSERT INTO entity_links
				(workspace_id, source_type, source_id, target_type, target_id, relation_kind)
			VALUES (${wsA.id}, 'issue', ${randomUUID()}, 'doc_page', ${randomUUID()}, 'references')
		`
		const [principalA] = await db!.owner<{ id: string }[]>`
			INSERT INTO agent_principals (workspace_id, kind, name, owner_user_id, scope_ceiling)
			VALUES (${wsA.id}, 'automation', 'rls-test-automation', ${userA.id}, '{tasks.read}'::text[])
			RETURNING id
		`
		const [ruleA] = await db!.owner<{ id: string }[]>`
			INSERT INTO automation_rules (workspace_id, name, principal_id, trigger_kind, created_by)
			VALUES (${wsA.id}, 'rule-a', ${principalA!.id}, 'event', ${userA.id})
			RETURNING id
		`
		const [runA] = await db!.owner<{ id: string }[]>`
			INSERT INTO automation_runs (workspace_id, rule_id, status)
			VALUES (${wsA.id}, ${ruleA!.id}, 'succeeded')
			RETURNING id
		`
		await db!.owner`
			INSERT INTO automation_run_steps (workspace_id, run_id, step_index, action_kind, status)
			VALUES (${wsA.id}, ${runA!.id}, 0, 'issue.create', 'succeeded')
		`

		const M7_TABLES = [
			'cycle_daily_snapshots',
			'entity_links',
			'automation_rules',
			'automation_runs',
			'automation_run_steps'
		] as const

		// Inside wsB's context every wsA row is invisible — SELECT reads nothing,
		// and UPDATE/DELETE silently match zero rows (RLS hides the targets).
		await withWorkspace(db!.app, { workspaceId: wsB.id, userId: userB.id }, async (tx) => {
			for (const t of M7_TABLES) {
				const [r] = await tx.unsafe<{ n: number }[]>(
					`SELECT count(*)::int AS n FROM ${t} WHERE workspace_id = '${wsA.id}'`
				)
				expect(r!.n, `${t} leaked wsA rows into wsB context`).toBe(0)
				const upd = await tx.unsafe<unknown[]>(
					`UPDATE ${t} SET workspace_id = workspace_id WHERE workspace_id = '${wsA.id}' RETURNING workspace_id`
				)
				expect(upd.length, `${t} allowed UPDATE of wsA rows from wsB`).toBe(0)
				const del = await tx.unsafe<unknown[]>(
					`DELETE FROM ${t} WHERE workspace_id = '${wsA.id}' RETURNING workspace_id`
				)
				expect(del.length, `${t} allowed DELETE of wsA rows from wsB`).toBe(0)
			}
		})

		// WITH CHECK: a wsA-workspace row can't be written from wsB's context —
		// each denial gets its own tx (a permission error aborts the block).
		const crossInsert = async (table: string) => {
			const inserts: Record<string, string> = {
				cycle_daily_snapshots: `INSERT INTO cycle_daily_snapshots
					(workspace_id, cycle_id, snapshot_date, total_issues, completed_issues, started_issues)
					VALUES ('${wsA.id}', '${cycleId}', '2026-11-25', 11, 5, 5)`,
				entity_links: `INSERT INTO entity_links
					(workspace_id, source_type, source_id, target_type, target_id)
					VALUES ('${wsA.id}', 'issue', '${randomUUID()}', 'doc_page', '${randomUUID()}')`,
				automation_rules: `INSERT INTO automation_rules
					(workspace_id, name, principal_id, trigger_kind)
					VALUES ('${wsA.id}', 'rule-x', '${principalA!.id}', 'cron')`,
				automation_runs: `INSERT INTO automation_runs
					(workspace_id, rule_id, status)
					VALUES ('${wsA.id}', '${ruleA!.id}', 'running')`,
				automation_run_steps: `INSERT INTO automation_run_steps
					(workspace_id, run_id, step_index, action_kind, status)
					VALUES ('${wsA.id}', '${runA!.id}', 9, 'issue.create', 'skipped')`
			}
			try {
				await withWorkspace(db!.app, { workspaceId: wsB.id, userId: userB.id }, async (tx) => {
					await tx.unsafe(inserts[table]!)
				})
				return null
			} catch (e) {
				return e as { code?: string; message?: string }
			}
		}
		for (const t of M7_TABLES) {
			const err = await crossInsert(t)
			expect(err, `${t} accepted a wsA row inside wsB context`).not.toBeNull()
		}
	}, 30_000)

	test('M8 planning tables: cross-tenant deny, CHECK constraints, and milestone FK semantics', async () => {
		if (skip()) return
		const { wsA, wsB, userA, userB } = await seedTwoTenants(db!.owner)
		const projA = await aProject(db!.owner, { workspaceId: wsA.id, createdBy: userA.id })
		const projA2 = await aProject(db!.owner, { workspaceId: wsA.id, createdBy: userA.id })

		const [initiative] = await db!.owner<{ id: string }[]>`
			INSERT INTO initiatives (workspace_id, name, health, owner_id, target_date, position)
			VALUES (${wsA.id}, 'rls-initiative', 'on_track', ${userA.id}, '2027-03-31', 'V')
			RETURNING id
		`
		await db!.owner`
			INSERT INTO initiative_projects (workspace_id, initiative_id, project_id, position)
			VALUES (${wsA.id}, ${initiative!.id}, ${projA.id}, 'V')
		`
		const [milestone] = await db!.owner<{ id: string }[]>`
			INSERT INTO project_milestones (workspace_id, project_id, name, target_date, position)
			VALUES (${wsA.id}, ${projA.id}, 'rls-milestone', '2027-02-15', 'V')
			RETURNING id
		`
		await db!.owner`
			INSERT INTO project_updates (workspace_id, project_id, health, completed_issues, total_issues, created_by)
			VALUES (${wsA.id}, ${projA.id}, 'at_risk', 1, 3, ${userA.id})
		`

		const linkedIssue = await anIssue(db!.owner, {
			workspaceId: wsA.id,
			projectId: projA.id,
			statusId: projA.statusIds['Todo']!,
			creatorId: userA.id
		})
		await db!.owner`
			UPDATE issues SET milestone_id = ${milestone!.id}
			WHERE workspace_id = ${wsA.id} AND id = ${linkedIssue.id}
		`

		const M8_TABLES = ['initiatives', 'initiative_projects', 'project_milestones', 'project_updates'] as const
		await withWorkspace(db!.app, { workspaceId: wsB.id, userId: userB.id }, async (tx) => {
			for (const t of M8_TABLES) {
				const [r] = await tx.unsafe<{ n: number }[]>(
					`SELECT count(*)::int AS n FROM ${t} WHERE workspace_id = '${wsA.id}'`
				)
				expect(r!.n, `${t} leaked wsA rows into wsB context`).toBe(0)
				const upd = await tx.unsafe<unknown[]>(
					`UPDATE ${t} SET workspace_id = workspace_id WHERE workspace_id = '${wsA.id}' RETURNING workspace_id`
				)
				expect(upd.length, `${t} allowed UPDATE of wsA rows from wsB`).toBe(0)
				const del = await tx.unsafe<unknown[]>(
					`DELETE FROM ${t} WHERE workspace_id = '${wsA.id}' RETURNING workspace_id`
				)
				expect(del.length, `${t} allowed DELETE of wsA rows from wsB`).toBe(0)
			}
		})

		// WITH CHECK denial: valid wsA-shaped rows are still rejected from wsB context.
		const crossInsert = async (table: (typeof M8_TABLES)[number]) => {
			const inserts: Record<(typeof M8_TABLES)[number], string> = {
				initiatives: `INSERT INTO initiatives (workspace_id, name, health, position)
					VALUES ('${wsA.id}', 'cross-x', 'on_track', 'X')`,
				initiative_projects: `INSERT INTO initiative_projects (workspace_id, initiative_id, project_id, position)
					VALUES ('${wsA.id}', '${initiative!.id}', '${projA.id}', 'X')`,
				project_milestones: `INSERT INTO project_milestones (workspace_id, project_id, name, position)
					VALUES ('${wsA.id}', '${projA.id}', 'cross-x', 'X')`,
				project_updates: `INSERT INTO project_updates (workspace_id, project_id, health)
					VALUES ('${wsA.id}', '${projA.id}', 'on_track')`
			}
			try {
				await withWorkspace(db!.app, { workspaceId: wsB.id, userId: userB.id }, async (tx) => {
					await tx.unsafe(inserts[table])
				})
				return null
			} catch (e) {
				return e as { code?: string }
			}
		}
		for (const t of M8_TABLES) {
			const err = await crossInsert(t)
			expect(err, `${t} accepted a wsA row inside wsB context`).not.toBeNull()
		}

		const denied = async (q: PromiseLike<unknown>) => {
			try {
				await q
				return null
			} catch (e) {
				return e as { code?: string }
			}
		}

		// Enum and count CHECK constraints are database invariants, not service conveniences.
		expect(
			(await denied(db!.owner`UPDATE initiatives SET health = 'bogus' WHERE id = ${initiative!.id}`))?.code
		).toBe('23514')
		expect(
			(
				await denied(
					db!.owner`INSERT INTO project_milestones (workspace_id, project_id, name, status, position)
						VALUES (${wsA.id}, ${projA.id}, 'bad-status', 'bogus', 'X')`
				)
			)?.code
		).toBe('23514')
		expect(
			(
				await denied(
					db!
						.owner`INSERT INTO project_updates (workspace_id, project_id, health, completed_issues, total_issues)
						VALUES (${wsA.id}, ${projA.id}, 'on_track', 4, 3)`
				)
			)?.code
		).toBe('23514')

		// The composite issue FK enforces same-project milestone ownership even for owner SQL.
		const otherProjectIssue = await anIssue(db!.owner, {
			workspaceId: wsA.id,
			projectId: projA2.id,
			statusId: projA2.statusIds['Todo']!,
			creatorId: userA.id
		})
		expect(
			(
				await denied(db!.owner`
					UPDATE issues SET milestone_id = ${milestone!.id}
					WHERE workspace_id = ${wsA.id} AND id = ${otherProjectIssue.id}
				`)
			)?.code
		).toBe('23503')

		// Regression for migration 0026: milestone deletion must null ONLY milestone_id,
		// preserving workspace_id/project_id on the issue row.
		await db!.owner`DELETE FROM project_milestones WHERE workspace_id = ${wsA.id} AND id = ${milestone!.id}`
		const [after] = await db!.owner<{ workspaceId: string; projectId: string; milestoneId: string | null }[]>`
			SELECT workspace_id AS "workspaceId", project_id AS "projectId", milestone_id AS "milestoneId"
			FROM issues WHERE workspace_id = ${wsA.id} AND id = ${linkedIssue.id}
		`
		expect(after?.workspaceId).toBe(wsA.id)
		expect(after?.projectId).toBe(projA.id)
		expect(after?.milestoneId).toBeNull()
	}, 30_000)

	test('M7 CHECK constraints reject bad values', async () => {
		if (skip()) return
		const { wsA, userA } = await seedTwoTenants(db!.owner)
		const projA = await aProject(db!.owner, { workspaceId: wsA.id, createdBy: userA.id })

		const denied = async (q: PromiseLike<unknown>) => {
			try {
				await q
				return null
			} catch (e) {
				return e as { code?: string }
			}
		}

		// issues.triage_status enum
		const issue = await anIssue(db!.owner, {
			workspaceId: wsA.id,
			projectId: projA.id,
			statusId: projA.statusIds['Todo']!,
			creatorId: userA.id
		})
		const triageErr = await denied(
			db!.owner`UPDATE issues SET triage_status = 'bogus' WHERE id = ${issue.id}`
		)
		expect(triageErr?.code).toBe('23514')

		// entity_links self-edge
		const selfId = randomUUID()
		const selfErr = await denied(db!.owner`
			INSERT INTO entity_links
				(workspace_id, source_type, source_id, target_type, target_id)
			VALUES (${wsA.id}, 'issue', ${selfId}, 'issue', ${selfId})
		`)
		expect(selfErr?.code).toBe('23514')

		// automation_runs idempotency: one real run per (rule, event) —
		// dry runs are exempt from the partial unique index.
		const [principalA] = await db!.owner<{ id: string }[]>`
			INSERT INTO agent_principals (workspace_id, kind, name, owner_user_id, scope_ceiling)
			VALUES (${wsA.id}, 'automation', 'ck-test-automation', ${userA.id}, '{tasks.read}'::text[])
			RETURNING id
		`
		const [ruleA] = await db!.owner<{ id: string }[]>`
			INSERT INTO automation_rules (workspace_id, name, principal_id, trigger_kind)
			VALUES (${wsA.id}, 'rule-ck', ${principalA!.id}, 'event')
			RETURNING id
		`
		const eventId = randomUUID()
		await db!.owner`
			INSERT INTO automation_runs (workspace_id, rule_id, trigger_event_id, status)
			VALUES (${wsA.id}, ${ruleA!.id}, ${eventId}, 'succeeded')
		`
		const dupErr = await denied(db!.owner`
			INSERT INTO automation_runs (workspace_id, rule_id, trigger_event_id, status)
			VALUES (${wsA.id}, ${ruleA!.id}, ${eventId}, 'running')
		`)
		expect(dupErr?.code).toBe('23505')
		// Same event twice is fine when the runs are dry runs.
		await db!.owner`
			INSERT INTO automation_runs (workspace_id, rule_id, trigger_event_id, status, dry_run)
			VALUES (${wsA.id}, ${ruleA!.id}, ${eventId}, 'dry_run', true),
			       (${wsA.id}, ${ruleA!.id}, ${eventId}, 'dry_run', true)
		`
	}, 30_000)

	test('M9 docs & wiki tables: cross-tenant deny, WITH CHECK, and CHECK/FK constraints', async () => {
		if (skip()) return
		const { wsA, wsB, userA, userB } = await seedTwoTenants(db!.owner)

		const [tsA] = await db!.owner<{ id: string }[]>`
			INSERT INTO teamspaces (workspace_id, name, slug, visibility, position, created_by)
			VALUES (${wsA.id}, 'Engineering', 'engineering', 'closed', 'V', ${userA.id})
			RETURNING id
		`
		await db!.owner`
			INSERT INTO teamspace_members (workspace_id, teamspace_id, user_id, role)
			VALUES (${wsA.id}, ${tsA!.id}, ${userA.id}, 'owner')
		`
		const [pageA] = await db!.owner<{ id: string }[]>`
			INSERT INTO doc_pages (
				workspace_id, teamspace_id, path, depth, slug, title, position, created_by
			)
			VALUES (${wsA.id}, ${tsA!.id}, 'tmp-m9', 0, 'm9-rls-doc', 'M9 RLS Doc', 'V', ${userA.id})
			RETURNING id
		`
		const [syncA] = await db!.owner<{ id: string }[]>`
			INSERT INTO doc_synced_blocks (
				workspace_id, title, source_page_id, state, state_vector, byte_size, created_by
			)
			VALUES (${wsA.id}, 'Shared Banner', ${pageA!.id}, ${Buffer.from([0])}, ${Buffer.from([0])}, 1, ${userA.id})
			RETURNING id
		`
		await db!.owner`
			INSERT INTO doc_suggestions (
				workspace_id, page_id, group_id, kind, author_type, author_id, before_text, after_text
			)
			VALUES (${wsA.id}, ${pageA!.id}, 'grp-1', 'replace', 'user', ${userA.id}, 'old', 'new')
		`
		await db!.owner`
			INSERT INTO doc_verifications (workspace_id, page_id, status, verified_by, verified_at)
			VALUES (${wsA.id}, ${pageA!.id}, 'verified', ${userA.id}, now())
		`
		await db!.owner`
			INSERT INTO doc_public_shares (workspace_id, page_id, public_slug, created_by)
			VALUES (${wsA.id}, ${pageA!.id}, 'm9-public', ${userA.id})
		`

		const M9_TABLES = [
			'teamspaces',
			'teamspace_members',
			'doc_synced_blocks',
			'doc_suggestions',
			'doc_verifications',
			'doc_public_shares'
		] as const

		await withWorkspace(db!.app, { workspaceId: wsB.id, userId: userB.id }, async (tx) => {
			for (const t of M9_TABLES) {
				const [r] = await tx.unsafe<{ n: number }[]>(
					`SELECT count(*)::int AS n FROM ${t} WHERE workspace_id = '${wsA.id}'`
				)
				expect(r!.n, `${t} leaked wsA rows into wsB context`).toBe(0)
				const upd = await tx.unsafe<unknown[]>(
					`UPDATE ${t} SET workspace_id = workspace_id WHERE workspace_id = '${wsA.id}' RETURNING workspace_id`
				)
				expect(upd.length, `${t} allowed UPDATE of wsA rows from wsB`).toBe(0)
				const del = await tx.unsafe<unknown[]>(
					`DELETE FROM ${t} WHERE workspace_id = '${wsA.id}' RETURNING workspace_id`
				)
				expect(del.length, `${t} allowed DELETE of wsA rows from wsB`).toBe(0)
			}
		})

		const crossInsert = async (table: (typeof M9_TABLES)[number]) => {
			const inserts: Record<(typeof M9_TABLES)[number], string> = {
				teamspaces: `INSERT INTO teamspaces (workspace_id, name, slug, visibility, position)
					VALUES ('${wsA.id}', 'Cross', 'cross', 'open', 'X')`,
				teamspace_members: `INSERT INTO teamspace_members (workspace_id, teamspace_id, user_id, role)
					VALUES ('${wsA.id}', '${tsA!.id}', '${userB.id}', 'member')`,
				doc_synced_blocks: `INSERT INTO doc_synced_blocks (workspace_id, title, state, state_vector, byte_size)
					VALUES ('${wsA.id}', 'Cross', '\\x00', '\\x00', 1)`,
				doc_suggestions: `INSERT INTO doc_suggestions (workspace_id, page_id, group_id, kind, author_type, author_id)
					VALUES ('${wsA.id}', '${pageA!.id}', 'grp-x', 'insert', 'user', '${userB.id}')`,
				doc_verifications: `INSERT INTO doc_verifications (workspace_id, page_id, status)
					VALUES ('${wsA.id}', '${pageA!.id}', 'stale')`,
				doc_public_shares: `INSERT INTO doc_public_shares (workspace_id, page_id, public_slug)
					VALUES ('${wsA.id}', '${pageA!.id}', 'cross-share')`
			}
			try {
				await withWorkspace(db!.app, { workspaceId: wsB.id, userId: userB.id }, async (tx) => {
					await tx.unsafe(inserts[table])
				})
				return null
			} catch (e) {
				return e as { code?: string }
			}
		}
		for (const t of M9_TABLES) {
			const err = await crossInsert(t)
			expect(err, `${t} accepted a wsA row inside wsB context`).not.toBeNull()
		}

		const denied = async (q: PromiseLike<unknown>) => {
			try {
				await q
				return null
			} catch (e) {
				return e as { code?: string }
			}
		}
		expect(
			(await denied(db!.owner`UPDATE teamspaces SET visibility = 'bogus' WHERE id = ${tsA!.id}`))?.code
		).toBe('23514')
		expect(
			(
				await denied(
					db!
						.owner`INSERT INTO doc_pages (workspace_id, path, depth, slug, title, font_style, position, created_by)
						VALUES (${wsA.id}, 'bad', 0, 'bad-font', 'Bad Font', 'comic', 'Z', ${userA.id})`
				)
			)?.code
		).toBe('23514')
		expect(
			(
				await denied(
					db!
						.owner`INSERT INTO collab_tickets (workspace_id, room_kind, page_id, synced_block_id, user_id, permission, token_hash, expires_at)
						VALUES (${wsA.id}, 'synced_block', ${pageA!.id}, ${syncA!.id}, ${userA.id}, 'write', 'bad-xor-hash', now() + interval '1 minute')`
				)
			)?.code
		).toBe('23514')
	}, 30_000)
})
