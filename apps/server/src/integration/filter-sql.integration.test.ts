/**
 * Differential test: the filter-sql interpreter MUST return the same id set as
 * the domain evaluator (compileFilter/evaluateFilter) for ~300 seeded PRNG
 * expressions against ~300 seeded issues. This is the correctness guarantee
 * for the whole compound-filter feature (§3.4).
 *
 * Print the seed + failing expression on mismatch so a failure is replayable.
 */
import { beforeAll, describe, expect, test } from 'bun:test'
import { randomUUID } from 'node:crypto'
import {
	compileFilter,
	FILTER_FIELDS,
	type FilterableIssue,
	type FilterExpr,
	type FilterField,
	validateFilter
} from '@huriro/domain'
import { aMembership, aUser, aWorkspace, getTestDb, type TestDb } from '@huriro/test-utils'
import { buildIssueFilterSql } from '../modules/tasks/filter-sql'

let db: TestDb | null = null

beforeAll(async () => {
	db = await getTestDb()
})

// ---------- Seeded PRNG (mulberry32) ----------

function mulberry32(seed: number): () => number {
	let a = seed >>> 0
	return () => {
		a = (a + 0x6d2b79f5) >>> 0
		let t = a
		t = Math.imul(t ^ (t >>> 15), t | 1)
		t ^= t + Math.imul(t ^ (t >>> 7), t | 61)
		return ((t ^ (t >>> 14)) >>> 0) / 4294967296
	}
}

const NOW = new Date('2026-06-15T12:00:00.000Z')
const SEED = Number(process.env['FILTER_SQL_SEED'] ?? 20260615)

function pick<T>(rng: () => number, arr: readonly T[]): T {
	return arr[Math.floor(rng() * arr.length)]!
}

interface SeedRefs {
	workspaceId: string
	userId: string
	projectIds: string[]
	statusIds: string[]
	labelIds: string[]
	issues: FilterableIssue[]
	statusCategoryOf: Map<string, string>
}

async function seedIssues(sql: TestDb, rng: () => number): Promise<SeedRefs> {
	const tag = `fs${Math.floor(rng() * 1e8)}-${randomUUID().slice(0, 8)}`
	const ws = await aWorkspace(sql.owner, { slug: tag, name: tag })
	const user = await aUser(sql.owner, { email: `${tag}@test.huriro.dev`, displayName: tag })
	await aMembership(sql.owner, {
		workspaceId: ws.id,
		userId: user.id,
		roleId: ws.roleIds['owner'] ?? ''
	})

	const [p1] = await sql.owner<{ id: string }[]>`
		INSERT INTO projects (workspace_id, key, name, description, visibility, position, created_by)
		VALUES (${ws.id}, 'AAA', 'Alpha', '', 'workspace', 'a0', ${user.id})
		RETURNING id
	`
	const [p2] = await sql.owner<{ id: string }[]>`
		INSERT INTO projects (workspace_id, key, name, description, visibility, position, created_by)
		VALUES (${ws.id}, 'BBB', 'Beta', '', 'workspace', 'a1', ${user.id})
		RETURNING id
	`
	if (!p1 || !p2) throw new Error('project seed failed')
	const projectIds = [p1.id, p2.id]

	const statusDefs = [
		{ name: 'Backlog', category: 'backlog' },
		{ name: 'Todo', category: 'unstarted' },
		{ name: 'Doing', category: 'started' },
		{ name: 'Done', category: 'completed' },
		{ name: 'Canceled', category: 'cancelled' }
	] as const
	const statusIds: string[] = []
	const statusCategoryOf = new Map<string, string>()
	for (let i = 0; i < statusDefs.length; i++) {
		for (const pid of projectIds) {
			const sd = statusDefs[i]!
			const [s] = await sql.owner<{ id: string }[]>`
				INSERT INTO project_statuses (workspace_id, project_id, name, category, color, position, is_default)
				VALUES (${ws.id}, ${pid}, ${sd.name}, ${sd.category}, 'neutral', ${`p${i}`}, ${sd.category === 'unstarted'})
				RETURNING id
			`
			if (!s) throw new Error('status seed failed')
			statusIds.push(s.id)
			statusCategoryOf.set(s.id, sd.category)
		}
	}
	// An orphan status id (no row) exercises status_category -> always false.

	const [agent] = await sql.owner<{ id: string }[]>`
		INSERT INTO agent_principals (workspace_id, kind, name, owner_user_id)
		VALUES (${ws.id}, 'builtin_assistant', 'seed-agent', ${user.id})
		RETURNING id
	`
	if (!agent) throw new Error('agent seed failed')

	const labelIds: string[] = []
	for (let i = 0; i < 4; i++) {
		const [l] = await sql.owner<{ id: string }[]>`
			INSERT INTO labels (workspace_id, name, color)
			VALUES (${ws.id}, ${`label-${i}`}, 'red')
			RETURNING id
		`
		if (!l) throw new Error('label seed failed')
		labelIds.push(l.id)
	}

	const triageStatuses = ['none', 'pending', 'accepted', 'snoozed', 'declined', 'merged'] as const
	const sourceKinds = ['manual', 'mail', 'chat', 'form', 'github', 'gitlab', 'api', 'agent'] as const
	const titles = [
		'Fix login bug',
		'Improve 100% coverage',
		'Refactor_under_score',
		'Deploy pipeline % progress',
		'Quarterly Report',
		'onboarding flow',
		'API rate limits',
		'Dark mode toggle',
		'crash on save',
		'Update docs'
	]
	const descs = ['', 'alpha beta', 'gamma delta', 'urgent fix', 'see ticket 42']

	const issues: FilterableIssue[] = []
	const baseMs = Date.parse('2026-05-01T00:00:00.000Z')
	for (let i = 0; i < 300; i++) {
		const projectId = pick(rng, projectIds)
		const statusId = pick(rng, statusIds)
		const priority = Math.floor(rng() * 5)
		const hasAssignee = rng() < 0.5
		const assigneeType = hasAssignee ? (rng() < 0.8 ? 'user' : 'agent') : null
		// validate_issue_assignee requires a live principal for agent assignees.
		const assigneeId = hasAssignee ? (assigneeType === 'user' ? user.id : agent.id) : null
		const triage = pick(rng, triageStatuses)
		const source = pick(rng, sourceKinds)
		const estimate = rng() < 0.6 ? Math.round(rng() * 1300) / 100 : null
		const due = rng() < 0.5 ? new Date(baseMs + Math.floor(rng() * 90) * 86400000) : null
		const start = rng() < 0.3 ? new Date(baseMs + Math.floor(rng() * 30) * 86400000) : null
		const created = new Date(baseMs + Math.floor(rng() * 45) * 86400000 + Math.floor(rng() * 86400000))
		const updated = new Date(created.getTime() + Math.floor(rng() * 30) * 3600000)
		const closed = rng() < 0.3 ? new Date(updated.getTime() + 3600000) : null
		const title = `${pick(rng, titles)} ${i}`
		const nLabels = rng() < 0.4 ? 0 : 1 + Math.floor(rng() * 3)
		const labels: string[] = []
		for (let k = 0; k < nLabels; k++) labels.push(pick(rng, labelIds))

		const [row] = await sql.owner<{ id: string }[]>`
			INSERT INTO issues (
				workspace_id, project_id, number, title, description_text,
				status_id, priority,
				assignee_type, assignee_id, creator_id, position,
				start_date, due_date, estimate,
				triage_status, triage_snoozed_until, triage_declined_reason, source_kind,
				closed_at, created_at, updated_at
			) VALUES (
				${ws.id}, ${projectId}, ${i + 1}, ${title}, ${pick(rng, descs)},
				${statusId}, ${priority},
				${assigneeType}, ${assigneeId}, ${user.id}, ${`k${String(i).padStart(4, '0')}`},
				${start ? start.toISOString().slice(0, 10) : null}::date,
				${due ? due.toISOString().slice(0, 10) : null}::date,
				${estimate},
				${triage}, ${triage === 'snoozed' ? '2026-07-01T00:00:00Z' : null}::timestamptz,
				${triage === 'declined' ? 'no fit' : null}, ${source},
				${closed?.toISOString() ?? null}::timestamptz,
				${created.toISOString()}::timestamptz, ${updated.toISOString()}::timestamptz
			)
			RETURNING id
		`
		if (!row) throw new Error('issue seed failed')
		for (const lid of new Set(labels)) {
			await sql.owner`
				INSERT INTO issue_labels (workspace_id, issue_id, label_id)
				VALUES (${ws.id}, ${row.id}, ${lid})
				ON CONFLICT DO NOTHING
			`
		}
		issues.push({
			id: row.id,
			projectId,
			statusId,
			priority,
			assigneeId,
			assigneeType: assigneeType as 'user' | 'agent' | null,
			labelIds: [...new Set(labels)],
			cycleId: null,
			parentId: null,
			title,
			estimate,
			dueDate: due ? due.toISOString().slice(0, 10) : null,
			startDate: start ? start.toISOString().slice(0, 10) : null,
			createdAt: created.toISOString(),
			updatedAt: updated.toISOString(),
			closedAt: closed?.toISOString() ?? null,
			triageStatus: triage,
			sourceKind: source
		})
	}
	return { workspaceId: ws.id, userId: user.id, projectIds, statusIds, labelIds, issues, statusCategoryOf }
}

// ---------- Expression generator ----------

function scalarFor(rng: () => number, field: FilterField, refs: SeedRefs): string | number {
	switch (field) {
		case 'status_category':
			return pick(rng, ['backlog', 'unstarted', 'started', 'completed', 'cancelled'])
		case 'status_id':
			return rng() < 0.15 ? randomUUID() : pick(rng, refs.statusIds)
		case 'priority':
			return Math.floor(rng() * 5)
		case 'assignee_id':
			return rng() < 0.2 ? randomUUID() : refs.userId
		case 'assignee_type':
			return pick(rng, ['user', 'agent'])
		case 'label_id':
			return pick(rng, refs.labelIds)
		case 'cycle_id':
		case 'parent_id':
			return randomUUID()
		case 'project_id':
			return pick(rng, refs.projectIds)
		case 'title':
			return pick(rng, ['login', '100%', 'score', 'REPORT', 'nonexistent-title'])
		case 'estimate':
			return Math.round(rng() * 1300) / 100
		case 'due_date':
		case 'start_date':
			return rng() < 0.3
				? `2026-0${1 + Math.floor(rng() * 6)}-15`
				: new Date(Date.parse('2026-05-01T00:00:00Z') + Math.floor(rng() * 90) * 86400000)
						.toISOString()
						.slice(0, 10)
		case 'created_at':
		case 'updated_at':
		case 'closed_at':
			return new Date(
				Date.parse('2026-05-01T00:00:00Z') + Math.floor(rng() * 60) * 86400000 + Math.floor(rng() * 86400000)
			).toISOString()
		case 'triage_status':
			return pick(rng, ['none', 'pending', 'accepted', 'snoozed', 'declined', 'merged'])
		case 'source_kind':
			return pick(rng, ['manual', 'mail', 'chat', 'form', 'github', 'gitlab', 'api', 'agent'])
	}
}

function randomPred(rng: () => number, refs: SeedRefs): FilterExpr {
	const fields = Object.keys(FILTER_FIELDS) as FilterField[]
	const field = pick(rng, fields)
	const def = FILTER_FIELDS[field]
	const ops = def.ops
	const op = pick(rng, ops)

	if (op === 'is_null' || op === 'is_not_null') {
		return { kind: 'pred', field, op }
	}
	if (op === 'in' || op === 'nin') {
		const n = 1 + Math.floor(rng() * 4)
		const list: (string | number)[] = []
		for (let i = 0; i < n; i++) list.push(scalarFor(rng, field, refs))
		return { kind: 'pred', field, op, value: list }
	}
	if (rng() < 0.08) {
		// null operand → is_null / is_not_null semantics for eq/neq.
		return { kind: 'pred', field, op: rng() < 0.5 ? 'eq' : 'neq', value: null }
	}
	if ((def.type === 'date' || def.type === 'datetime') && rng() < 0.25) {
		const rel = `${rng() < 0.5 ? '+' : '-'}${1 + Math.floor(rng() * 60)}${pick(rng, ['m', 'h', 'd', 'w'])}`
		return { kind: 'pred', field, op, value: { relative: rel } }
	}
	return { kind: 'pred', field, op, value: scalarFor(rng, field, refs) }
}

function randomExpr(rng: () => number, refs: SeedRefs, depth: number): FilterExpr {
	if (depth >= 3 || rng() < 0.45) return randomPred(rng, refs)
	const roll = rng()
	if (roll < 0.15) return { kind: 'not', arg: randomExpr(rng, refs, depth + 1) }
	const kind = rng() < 0.5 ? 'and' : 'or'
	const n = 1 + Math.floor(rng() * 4)
	return {
		kind,
		args: Array.from({ length: n }, () => randomExpr(rng, refs, depth + 1))
	} as FilterExpr
}

// ---------- The test ----------

describe('filter-sql differential vs domain evaluator', () => {
	test('~300 generated expressions produce identical id sets', async () => {
		if (!db) return
		const rng = mulberry32(SEED)
		const refs = await seedIssues(db, rng)
		const ctx = {
			now: NOW,
			statusCategoryOf: (id: string) => refs.statusCategoryOf.get(id)
		}
		const exprCount = 300
		let checked = 0

		for (let i = 0; i < exprCount; i++) {
			const expr = randomExpr(rng, refs, 0)
			const valid = validateFilter(expr)
			if (!valid.ok) continue
			checked++

			const domain = new Set(
				refs.issues.filter((issue) => compileFilter(valid.expr, ctx)(issue)).map((issue) => issue.id)
			)

			const frag = buildIssueFilterSql(db.owner, valid.expr, { now: NOW })
			const rows = await db.owner<{ id: string }[]>`
				SELECT i.id FROM issues i
				${
					frag.needsStatusJoin
						? db.owner`LEFT JOIN project_statuses s ON s.workspace_id = i.workspace_id AND s.id = i.status_id`
						: db.owner``
				}
				WHERE i.workspace_id = ${refs.workspaceId}
					AND i.deleted_at IS NULL
					AND (${frag.where})
			`
			const sql = new Set(rows.map((r) => r.id))

			expect({ expr, seed: SEED, sql: [...sql].sort() }).toEqual({
				expr,
				seed: SEED,
				sql: [...domain].sort()
			})
		}
		console.log(`filter-sql differential: seed=${SEED} issues=${refs.issues.length} exprs=${checked}`)
		expect(checked).toBeGreaterThan(250)
	}, 120_000)
})
