/**
 * Gate G7 scale fixture (§9 Gate G7): one deterministic 50,000-issue workspace.
 *
 * IMPORTANT: this is fixture seeding, not a mutation path. Rows are written
 * directly through the OWNER/admin pool in batched INSERT ... SELECT statements
 * for speed, so the production write invariants (domain row + outbox + audit in
 * one transaction) intentionally do not apply here. The fixture still respects
 * every foreign key, CHECK constraint, composite tenant key, and RLS-visible
 * shape; assertions and benchmark traffic themselves always run as huriro_app.
 *
 * Re-runnability: entities use deterministic UUIDs or natural unique keys, and
 * large inserts use ON CONFLICT DO NOTHING. A crashed seed can simply be run
 * again; already-complete projects are skipped before their chunks are written.
 */
import { createHash } from 'node:crypto'
import type { Sql } from '@huriro/db'
import { SYSTEM_ROLES } from '@huriro/domain'

const SCALE_WORKSPACE_SLUG = 'g7-scale'
const SCALE_OWNER_EMAIL = 'g7-scale-owner@test.huriro.dev'
const ISSUE_CHUNK_SIZE = 1000
const TOTAL_ISSUES = 50_000
const ENTITY_LINKS_PER_PROJECT = 100

/** Deliberately uneven project sizes while keeping exact 50k total volume. */
const PROJECT_SEEDS = [
	{ key: 'G7P01', name: 'Scale Platform', issueCount: 6200, triageEnabled: true, cycleEnabled: true },
	{ key: 'G7P02', name: 'Scale Sync', issueCount: 5900, triageEnabled: true, cycleEnabled: true },
	{ key: 'G7P03', name: 'Scale Mobile', issueCount: 5600, triageEnabled: false, cycleEnabled: true },
	{ key: 'G7P04', name: 'Scale Web', issueCount: 5300, triageEnabled: true, cycleEnabled: false },
	{ key: 'G7P05', name: 'Scale API', issueCount: 5200, triageEnabled: false, cycleEnabled: true },
	{ key: 'G7P06', name: 'Scale Design', issueCount: 5000, triageEnabled: true, cycleEnabled: false },
	{ key: 'G7P07', name: 'Scale Infra', issueCount: 4700, triageEnabled: false, cycleEnabled: true },
	{ key: 'G7P08', name: 'Scale Docs', issueCount: 4500, triageEnabled: false, cycleEnabled: false },
	{ key: 'G7P09', name: 'Scale Mail', issueCount: 4300, triageEnabled: false, cycleEnabled: true },
	{ key: 'G7P10', name: 'Scale QA', issueCount: 3300, triageEnabled: false, cycleEnabled: false }
] as const

type StatusKey = 'backlog' | 'todo' | 'inProgress' | 'done' | 'canceled'
type CycleKey = 'previous' | 'active' | 'next'

export interface G7ScaleProjectFixture {
	readonly id: string
	readonly key: string
	readonly issueCount: number
	readonly statusIds: Record<StatusKey, string>
	readonly cycleIds: Record<CycleKey, string>
}

export interface G7ScaleCounts {
	readonly projects: number
	readonly totalIssues: number
	readonly activeIssues: number
	readonly tier1CoreIssues: number
	readonly tier2HistoryIssues: number
	readonly triagePending: number
	readonly triageSnoozed: number
	readonly labels: number
	readonly issueLabels: number
	readonly cycles: number
	readonly entityLinks: number
	readonly automationRules: number
}

export interface G7ScaleFixture {
	readonly workspaceId: string
	readonly ownerId: string
	readonly ownerEmail: string
	readonly projects: readonly G7ScaleProjectFixture[]
	readonly labelIds: readonly string[]
	readonly counts: G7ScaleCounts
}

/** Stable fixture UUIDs: valid UUIDv4 shape derived from a namespaced SHA-256. */
function seedUuid(name: string): string {
	const hex = createHash('sha256').update(`huriro-g7-scale:${name}`).digest('hex')
	const variant = ((Number.parseInt(hex[16] ?? '8', 16) & 0x3) | 0x8).toString(16)
	return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-4${hex.slice(13, 16)}-${variant}${hex.slice(17, 20)}-${hex.slice(20, 32)}`
}

function isoDateOffset(days: number): string {
	return new Date(Date.now() + days * 86_400_000).toISOString().slice(0, 10) ?? '1970-01-01'
}

function labelName(index: number): string {
	return `g7-label-${String(index).padStart(2, '0')}`
}

async function requireOne<T>(rows: readonly T[], label: string): Promise<T> {
	const row = rows[0]
	if (!row) throw new Error(`G7 scale seed invariant failed: missing ${label}`)
	return row
}

async function seedIdentityAndRoles(ownerSql: Sql): Promise<{ workspaceId: string; ownerId: string }> {
	await ownerSql`
		INSERT INTO workspaces (id, slug, name)
		VALUES (${seedUuid('workspace')}, ${SCALE_WORKSPACE_SLUG}, 'G7 Scale Workspace')
		ON CONFLICT (slug) DO NOTHING
	`
	const workspace = await requireOne(
		await ownerSql<{ id: string }[]>`SELECT id FROM workspaces WHERE slug = ${SCALE_WORKSPACE_SLUG}`,
		'scale workspace'
	)

	await ownerSql`
		INSERT INTO users (id, email, display_name)
		VALUES (${seedUuid('owner-user')}, ${SCALE_OWNER_EMAIL}, 'G7 Scale Owner')
		ON CONFLICT (email) DO NOTHING
	`
	const owner = await requireOne(
		await ownerSql<{ id: string }[]>`SELECT id FROM users WHERE email = ${SCALE_OWNER_EMAIL}`,
		'scale owner user'
	)

	for (const role of SYSTEM_ROLES) {
		await ownerSql`
			INSERT INTO roles (id, workspace_id, key, name, is_system, rank)
			VALUES (${seedUuid(`${workspace.id}:role:${role.key}`)}, ${workspace.id}, ${role.key}, ${role.name}, true, ${role.rank})
			ON CONFLICT (workspace_id, key) DO NOTHING
		`
		const roleRow = await requireOne(
			await ownerSql<{ id: string }[]>`
				SELECT id FROM roles WHERE workspace_id = ${workspace.id} AND key = ${role.key}
			`,
			`role ${role.key}`
		)
		for (const permission of role.permissions) {
			await ownerSql`
				INSERT INTO role_permissions (workspace_id, role_id, permission)
				VALUES (${workspace.id}, ${roleRow.id}, ${permission})
				ON CONFLICT DO NOTHING
			`
		}
		if (role.key === 'owner') {
			await ownerSql`
				INSERT INTO memberships (workspace_id, user_id, role_id, status)
				VALUES (${workspace.id}, ${owner.id}, ${roleRow.id}, 'active')
				ON CONFLICT (workspace_id, user_id) DO NOTHING
			`
		}
	}

	await ownerSql`
		INSERT INTO workspace_seq (workspace_id) VALUES (${workspace.id})
		ON CONFLICT (workspace_id) DO NOTHING
	`
	return { workspaceId: workspace.id, ownerId: owner.id }
}

async function seedProjectsStatusesAndCycles(
	ownerSql: Sql,
	workspaceId: string,
	ownerId: string
): Promise<G7ScaleProjectFixture[]> {
	const statusDefs = [
		{
			key: 'backlog',
			name: 'Backlog',
			category: 'backlog',
			color: 'neutral',
			position: 'B',
			isDefault: false
		},
		{ key: 'todo', name: 'Todo', category: 'unstarted', color: 'info', position: 'F', isDefault: true },
		{
			key: 'inProgress',
			name: 'In Progress',
			category: 'started',
			color: 'warning',
			position: 'N',
			isDefault: false
		},
		{ key: 'done', name: 'Done', category: 'completed', color: 'success', position: 'V', isDefault: false },
		{
			key: 'canceled',
			name: 'Canceled',
			category: 'cancelled',
			color: 'danger',
			position: 'd',
			isDefault: false
		}
	] as const
	const projects: G7ScaleProjectFixture[] = []

	for (const [projectIndex, seed] of PROJECT_SEEDS.entries()) {
		await ownerSql`
			INSERT INTO projects (id, workspace_id, key, name, visibility, position, created_by, triage_enabled, cycle_enabled)
			VALUES (
				${seedUuid(`${workspaceId}:project:${seed.key}`)}, ${workspaceId}, ${seed.key}, ${seed.name},
				'workspace', ${`P${String(projectIndex + 1).padStart(2, '0')}`}, ${ownerId},
				${seed.triageEnabled}, ${seed.cycleEnabled}
			)
			ON CONFLICT (workspace_id, key) DO NOTHING
		`
		const projectRow = await requireOne(
			await ownerSql<{ id: string }[]>`
				SELECT id FROM projects WHERE workspace_id = ${workspaceId} AND key = ${seed.key}
			`,
			`project ${seed.key}`
		)
		// Project feature flags are reconciled on every run; this is cheap and keeps
		// an interrupted/old fixture faithful to the scale profile.
		await ownerSql`
			UPDATE projects
			SET triage_enabled = ${seed.triageEnabled}, cycle_enabled = ${seed.cycleEnabled},
				visibility = 'workspace', archived_at = NULL
			WHERE workspace_id = ${workspaceId} AND id = ${projectRow.id}
		`

		const statusIds = {} as Record<StatusKey, string>
		for (const status of statusDefs) {
			await ownerSql`
				INSERT INTO project_statuses (
					id, workspace_id, project_id, name, category, color, position, is_default
				)
				VALUES (
					${seedUuid(`${projectRow.id}:status:${status.key}`)}, ${workspaceId}, ${projectRow.id},
					${status.name}, ${status.category}, ${status.color}, ${status.position}, ${status.isDefault}
				)
				ON CONFLICT (workspace_id, project_id, name) DO NOTHING
			`
			const statusRow = await requireOne(
				await ownerSql<{ id: string }[]>`
					SELECT id FROM project_statuses
					WHERE workspace_id = ${workspaceId} AND project_id = ${projectRow.id} AND name = ${status.name}
				`,
				`status ${seed.key}/${status.name}`
			)
			statusIds[status.key] = statusRow.id
		}

		await ownerSql`
			INSERT INTO issue_counters (workspace_id, project_id, next_number)
			VALUES (${workspaceId}, ${projectRow.id}, ${seed.issueCount + 1})
			ON CONFLICT (project_id) DO UPDATE
			SET next_number = GREATEST(issue_counters.next_number, EXCLUDED.next_number)
		`

		const cycleDefs = [
			{ key: 'previous', name: 'G7 previous cycle', status: 'completed', startOffset: -35, endOffset: -22 },
			{ key: 'active', name: 'G7 active cycle', status: 'active', startOffset: -7, endOffset: 7 },
			{ key: 'next', name: 'G7 next cycle', status: 'planned', startOffset: 8, endOffset: 21 }
		] as const
		const cycleIds = {} as Record<CycleKey, string>
		for (const cycle of cycleDefs) {
			const cycleId = seedUuid(`${projectRow.id}:cycle:${cycle.key}`)
			await ownerSql`
				INSERT INTO cycles (id, workspace_id, project_id, name, status, starts_at, ends_at)
				VALUES (
					${cycleId}, ${workspaceId}, ${projectRow.id}, ${cycle.name}, ${cycle.status},
					${isoDateOffset(cycle.startOffset)}, ${isoDateOffset(cycle.endOffset)}
				)
				ON CONFLICT (workspace_id, id) DO NOTHING
			`
			cycleIds[cycle.key] = cycleId
		}
		// Keep the active cycle actually active when a long-lived huriro_test DB is reused.
		await ownerSql`
			UPDATE cycles
			SET starts_at = ${isoDateOffset(-7)}, ends_at = ${isoDateOffset(7)}, status = 'active'
			WHERE workspace_id = ${workspaceId} AND id = ${cycleIds.active}
		`

		projects.push({
			id: projectRow.id,
			key: seed.key,
			issueCount: seed.issueCount,
			statusIds,
			cycleIds
		})
	}
	return projects
}

/**
 * One batch of scale issues. Distribution per number % 100:
 *   00-81 done, closed >30d ago       (82%)
 *   82-90 canceled, closed >30d ago   ( 9%)  → 91% tier-2 history
 *   91-92 done, recently closed       ( 2%)
 *   93    canceled, recently closed   ( 1%)
 *   94-97 open Todo                   ( 4%)
 *   98    open In Progress            ( 1%)
 *   99    open Backlog                ( 1%)  → 9% / ~4.5k tier-1 core
 */
async function insertIssueChunk(
	ownerSql: Sql,
	args: {
		readonly workspaceId: string
		readonly ownerId: string
		readonly project: G7ScaleProjectFixture
		readonly triageEnabled: boolean
		readonly start: number
		readonly end: number
	}
): Promise<void> {
	const { project } = args
	await ownerSql`
		INSERT INTO issues (
			workspace_id, project_id, number, title, description, description_text,
			status_id, priority, assignee_type, assignee_id, creator_id, position,
			start_date, due_date, estimate, triage_status, triage_snoozed_until,
			triage_declined_reason, source_kind, closed_at, created_at, updated_at, cycle_id
		)
		SELECT
			${args.workspaceId},
			${project.id},
			s.g,
			${project.key} || '-' || s.g || ' · ' ||
				CASE s.g % 6
					WHEN 0 THEN 'stabilize sync replay'
					WHEN 1 THEN 'reduce boot latency'
					WHEN 2 THEN 'triage inbound regression'
					WHEN 3 THEN 'polish bulk selection'
					WHEN 4 THEN 'investigate cycle rollover'
					ELSE 'harden offline mutation queue'
				END,
			CASE WHEN s.g % 3 = 0 THEN jsonb_build_object(
				'type', 'doc',
				'content', jsonb_build_array(jsonb_build_object(
					'type', 'paragraph',
					'content', jsonb_build_array(jsonb_build_object(
						'type', 'text', 'text', 'Seeded scale fixture body for issue ' || s.g
					))
				))
			) ELSE NULL END,
			CASE WHEN s.g % 3 = 0 THEN 'Seeded scale fixture body for issue ' || s.g ELSE '' END,
			CASE
				WHEN s.r <= 81 THEN ${project.statusIds.done}
				WHEN s.r <= 90 THEN ${project.statusIds.canceled}
				WHEN s.r <= 92 THEN ${project.statusIds.done}
				WHEN s.r = 93 THEN ${project.statusIds.canceled}
				WHEN s.r <= 97 THEN ${project.statusIds.todo}
				WHEN s.r = 98 THEN ${project.statusIds.inProgress}
				ELSE ${project.statusIds.backlog}
			END::uuid,
			s.g % 5,
			CASE WHEN s.r >= 94 AND s.g % 7 = 0 THEN 'user' ELSE NULL END,
			CASE WHEN s.r >= 94 AND s.g % 7 = 0 THEN ${args.ownerId} ELSE NULL END::uuid,
			${args.ownerId},
			'V' || lpad(s.g::text, 6, '0'),
			CASE WHEN s.r >= 94 AND s.g % 4 = 0 THEN current_date - (s.g % 10) ELSE NULL END,
			CASE WHEN s.r >= 94 AND s.g % 3 <> 1 THEN current_date + (s.g % 20) ELSE NULL END,
			((s.g % 13)::numeric / 2),
			CASE
				WHEN ${args.triageEnabled} AND s.g % 250 = 94 THEN 'pending'
				WHEN ${args.triageEnabled} AND s.g % 250 = 98 THEN 'snoozed'
				WHEN ${args.triageEnabled} AND s.r <= 90 AND s.g % 500 = 81 THEN 'accepted'
				ELSE 'none'
			END,
			CASE WHEN ${args.triageEnabled} AND s.g % 250 = 98 THEN now() + interval '2 days' ELSE NULL END,
			CASE WHEN s.r = 93 AND s.g % 10 = 3 THEN 'Seeded decline reason' ELSE NULL END,
			CASE
				WHEN ${args.triageEnabled} AND s.g % 250 IN (94, 98) THEN
					CASE s.g % 3 WHEN 0 THEN 'mail' WHEN 1 THEN 'chat' ELSE 'form' END
				ELSE 'manual'
			END,
			CASE
				WHEN s.r <= 90 THEN now() - make_interval(days => 31 + (s.g % 150))
				WHEN s.r <= 93 THEN now() - make_interval(days => 1 + (s.g % 28))
				ELSE NULL
			END,
			CASE
				WHEN s.r <= 90 THEN now() - make_interval(days => 210 + (s.g % 120))
				WHEN s.r <= 93 THEN now() - make_interval(days => 35 + (s.g % 20))
				ELSE now() - make_interval(days => s.g % 28)
			END,
			CASE
				WHEN s.r <= 90 THEN now() - make_interval(days => 31 + (s.g % 150))
				WHEN s.r <= 93 THEN now() - make_interval(days => 1 + (s.g % 28))
				ELSE now() - make_interval(hours => s.g % 72)
			END,
			CASE
				WHEN s.r <= 90 AND s.g % 4 = 0 THEN ${project.cycleIds.previous}
				WHEN s.r >= 91 AND s.g % 4 = 1 THEN ${project.cycleIds.active}
				ELSE NULL
			END::uuid
		FROM (
			SELECT g, g % 100 AS r
			FROM generate_series(${args.start}::int, ${args.end}::int) g
		) s
		ON CONFLICT (workspace_id, project_id, number) DO NOTHING
	`
}

async function seedIssues(
	ownerSql: Sql,
	workspaceId: string,
	ownerId: string,
	projects: readonly G7ScaleProjectFixture[]
): Promise<void> {
	for (const [index, project] of projects.entries()) {
		const seed = PROJECT_SEEDS[index]
		if (!seed) throw new Error(`G7 scale seed invariant failed: missing seed metadata for ${project.key}`)
		const [existing] = await ownerSql<{ n: number }[]>`
			SELECT count(*)::int AS n FROM issues
			WHERE workspace_id = ${workspaceId} AND project_id = ${project.id}
		`
		if ((existing?.n ?? 0) >= project.issueCount) continue

		for (let start = 1; start <= project.issueCount; start += ISSUE_CHUNK_SIZE) {
			const end = Math.min(start + ISSUE_CHUNK_SIZE - 1, project.issueCount)
			await insertIssueChunk(ownerSql, {
				workspaceId,
				ownerId,
				project,
				triageEnabled: seed.triageEnabled,
				start,
				end
			})
		}
	}

	// Recent-closed rows use timestamps relative to seed time. Refresh only that
	// small slice (~1.5k rows) so a reused huriro_test DB cannot age them into
	// tier-2 and silently invalidate the scale distribution.
	for (const project of projects) {
		await ownerSql`
			UPDATE issues
			SET closed_at = now() - make_interval(days => 1 + (number % 28))
			WHERE workspace_id = ${workspaceId}
				AND project_id = ${project.id}
				AND number % 100 IN (91, 92, 93)
		`
		await ownerSql`
			UPDATE issues
			SET triage_snoozed_until = now() + interval '2 days'
			WHERE workspace_id = ${workspaceId}
				AND project_id = ${project.id}
				AND triage_status = 'snoozed'
		`
	}

	// Reserve a deterministic 200-issue bench lane in G7P01. These are ordinary
	// rows inside the 50k distribution; resetting them makes repeated bulk
	// benchmark runs start from the same open/Todo state without adding rows.
	const first = projects[0]
	if (!first) throw new Error('G7 scale seed invariant failed: no first project')
	await ownerSql`
		UPDATE issues
		SET status_id = ${first.statusIds.todo}, closed_at = NULL, priority = 1, deleted_at = NULL
		WHERE workspace_id = ${workspaceId}
			AND project_id = ${first.id}
			AND number <= 5000
			AND number % 100 BETWEEN 94 AND 97
	`
}

async function seedLabelsAndLinks(
	ownerSql: Sql,
	workspaceId: string,
	ownerId: string,
	projects: readonly G7ScaleProjectFixture[]
): Promise<readonly string[]> {
	const labelIds: string[] = []
	const colors = ['neutral', 'info', 'success', 'warning', 'danger'] as const
	for (let i = 0; i < 20; i++) {
		const name = labelName(i)
		await ownerSql`
			INSERT INTO labels (id, workspace_id, name, color)
			VALUES (${seedUuid(`${workspaceId}:label:${i}`)}, ${workspaceId}, ${name}, ${colors[i % colors.length] ?? 'neutral'})
			ON CONFLICT (workspace_id, name) DO NOTHING
		`
		const label = await requireOne(
			await ownerSql<{ id: string }[]>`
				SELECT id FROM labels WHERE workspace_id = ${workspaceId} AND name = ${name}
			`,
			`label ${name}`
		)
		labelIds.push(label.id)
	}

	const expectedIssueLabels = PROJECT_SEEDS.reduce((sum, p) => sum + Math.floor((p.issueCount * 34) / 100), 0)
	const [existingLabelLinks] = await ownerSql<{ n: number }[]>`
		SELECT count(*)::int AS n
		FROM issue_labels il
		JOIN issues i ON i.workspace_id = il.workspace_id AND i.id = il.issue_id
		WHERE il.workspace_id = ${workspaceId}
	`
	if ((existingLabelLinks?.n ?? 0) < expectedIssueLabels) {
		for (const [projectIndex, project] of projects.entries()) {
			await ownerSql`
				INSERT INTO issue_labels (workspace_id, issue_id, label_id)
				SELECT i.workspace_id, i.id, l.id
				FROM issues i
				JOIN labels l ON l.workspace_id = i.workspace_id
				WHERE i.workspace_id = ${workspaceId}
					AND i.project_id = ${project.id}
					AND i.number % 10 IN (1, 2, 3)
					AND l.name = 'g7-label-' || lpad(((i.number + ${projectIndex}) % 20)::text, 2, '0')
				ON CONFLICT (workspace_id, issue_id, label_id) DO NOTHING
			`
			await ownerSql`
				INSERT INTO issue_labels (workspace_id, issue_id, label_id)
				SELECT i.workspace_id, i.id, l.id
				FROM issues i
				JOIN labels l ON l.workspace_id = i.workspace_id
				WHERE i.workspace_id = ${workspaceId}
					AND i.project_id = ${project.id}
					AND i.number % 25 = 4
					AND l.name = 'g7-label-' || lpad(((i.number + ${projectIndex} + 7) % 20)::text, 2, '0')
				ON CONFLICT (workspace_id, issue_id, label_id) DO NOTHING
			`
		}
	}

	const expectedEntityLinks = PROJECT_SEEDS.length * ENTITY_LINKS_PER_PROJECT
	const [existingEntityLinks] = await ownerSql<{ n: number }[]>`
		SELECT count(*)::int AS n FROM entity_links
		WHERE workspace_id = ${workspaceId} AND source_type = 'issue' AND target_type = 'issue'
	`
	if ((existingEntityLinks?.n ?? 0) < expectedEntityLinks) {
		for (const project of projects) {
			await ownerSql`
				INSERT INTO entity_links (
					workspace_id, source_type, source_id, target_type, target_id, relation_kind, created_by
				)
				SELECT
					${workspaceId}, 'issue', src.id, 'issue', tgt.id,
					CASE src.number % 3 WHEN 0 THEN 'blocks' WHEN 1 THEN 'references' ELSE 'duplicates' END,
					${ownerId}
				FROM issues src
				JOIN issues tgt
					ON tgt.workspace_id = src.workspace_id
					AND tgt.project_id = src.project_id
					AND tgt.number = src.number + 1
				WHERE src.workspace_id = ${workspaceId}
					AND src.project_id = ${project.id}
					AND src.number BETWEEN 1 AND ${ENTITY_LINKS_PER_PROJECT}
				ON CONFLICT (workspace_id, source_type, source_id, target_type, target_id, relation_kind) DO NOTHING
			`
		}
	}
	return labelIds
}

async function seedSavedViewsAndAutomations(
	ownerSql: Sql,
	workspaceId: string,
	ownerId: string,
	projects: readonly G7ScaleProjectFixture[]
): Promise<void> {
	for (const [index, project] of projects.entries()) {
		await ownerSql`
			INSERT INTO saved_views (
				id, workspace_id, project_id, owner_user_id, name, layout, filters, sort, is_shared, position
			)
			VALUES (
				${seedUuid(`${project.id}:saved-view`)}, ${workspaceId}, ${project.id}, ${ownerId},
				${`${project.key} scale hotlist`}, 'list', ${ownerSql.json({ openOnly: true } as never)},
				${ownerSql.json({ field: 'position', direction: 'asc' } as never)}, true,
				${`SV${String(index + 1).padStart(2, '0')}`}
			)
			ON CONFLICT (workspace_id, id) DO NOTHING
		`
	}

	const principalId = seedUuid(`${workspaceId}:automation-principal`)
	await ownerSql`
		INSERT INTO agent_principals (id, workspace_id, kind, name, owner_user_id, scope_ceiling, status)
		VALUES (
			${principalId}, ${workspaceId}, 'automation', 'G7 scale automation principal', ${ownerId},
			${'{issue.read,issue.write}'}::text[], 'active'
		)
		ON CONFLICT (workspace_id, id) DO NOTHING
	`

	const rules = [
		{
			key: 'triage-inbound',
			name: 'G7 scale triage inbound',
			triggerKind: 'event',
			triggerConfig: { eventTypes: ['tasks.issue.created.v1'] },
			actions: [{ kind: 'issue.update', issueId: '{{issueId}}', priority: 1 }]
		},
		{
			key: 'close-stale',
			name: 'G7 scale close stale',
			triggerKind: 'event',
			triggerConfig: { eventTypes: ['tasks.issue.updated.v1'] },
			actions: [{ kind: 'issue.update', issueId: '{{issueId}}', priority: 0 }]
		},
		{
			key: 'nightly-cleanup',
			name: 'G7 scale nightly cleanup',
			triggerKind: 'cron',
			triggerConfig: { cron: '0 3 * * *', timezone: 'UTC' },
			actions: [{ kind: 'issue.update', issueId: '{{issueId}}', priority: 2 }]
		}
	] as const
	for (const rule of rules) {
		await ownerSql`
			INSERT INTO automation_rules (
				id, workspace_id, name, description, enabled, principal_id, trigger_kind,
				trigger_config, actions, created_by
			)
			VALUES (
				${seedUuid(`${workspaceId}:automation-rule:${rule.key}`)}, ${workspaceId}, ${rule.name},
				'Disabled scale-fixture rule; present for realistic shape without benchmark interference',
				false, ${principalId}, ${rule.triggerKind}, ${ownerSql.json(rule.triggerConfig as never)},
				${ownerSql.json(rule.actions as never)}, ${ownerId}
			)
			ON CONFLICT (workspace_id, name) DO NOTHING
		`
	}
}

async function countFixture(ownerSql: Sql, workspaceId: string): Promise<G7ScaleCounts> {
	const [issues] = await ownerSql<
		{
			total: number
			active: number
			tier1: number
			tier2: number
			triagePending: number
			triageSnoozed: number
		}[]
	>`
		SELECT
			count(*)::int AS total,
			(count(*) FILTER (WHERE deleted_at IS NULL))::int AS active,
			(count(*) FILTER (
				WHERE deleted_at IS NULL AND (closed_at IS NULL OR closed_at >= now() - interval '30 days')
			))::int AS tier1,
			(count(*) FILTER (
				WHERE deleted_at IS NULL AND closed_at < now() - interval '30 days'
			))::int AS tier2,
			(count(*) FILTER (WHERE triage_status = 'pending'))::int AS "triagePending",
			(count(*) FILTER (WHERE triage_status = 'snoozed'))::int AS "triageSnoozed"
		FROM issues
		WHERE workspace_id = ${workspaceId}
	`
	const [projects] = await ownerSql<{ n: number }[]>`
		SELECT count(*)::int AS n FROM projects WHERE workspace_id = ${workspaceId}
	`
	const [labels] = await ownerSql<{ n: number }[]>`
		SELECT count(*)::int AS n FROM labels WHERE workspace_id = ${workspaceId}
	`
	const [issueLabels] = await ownerSql<{ n: number }[]>`
		SELECT count(*)::int AS n FROM issue_labels WHERE workspace_id = ${workspaceId}
	`
	const [cycles] = await ownerSql<{ n: number }[]>`
		SELECT count(*)::int AS n FROM cycles WHERE workspace_id = ${workspaceId}
	`
	const [entityLinks] = await ownerSql<{ n: number }[]>`
		SELECT count(*)::int AS n FROM entity_links WHERE workspace_id = ${workspaceId}
	`
	const [automationRules] = await ownerSql<{ n: number }[]>`
		SELECT count(*)::int AS n FROM automation_rules WHERE workspace_id = ${workspaceId}
	`
	return {
		projects: projects?.n ?? 0,
		totalIssues: issues?.total ?? 0,
		activeIssues: issues?.active ?? 0,
		tier1CoreIssues: issues?.tier1 ?? 0,
		tier2HistoryIssues: issues?.tier2 ?? 0,
		triagePending: issues?.triagePending ?? 0,
		triageSnoozed: issues?.triageSnoozed ?? 0,
		labels: labels?.n ?? 0,
		issueLabels: issueLabels?.n ?? 0,
		cycles: cycles?.n ?? 0,
		entityLinks: entityLinks?.n ?? 0,
		automationRules: automationRules?.n ?? 0
	}
}

/** Seeds (or resumes/refreshes) the deterministic Gate G7 scale workspace. */
export async function ensureG7ScaleFixture(ownerSql: Sql): Promise<G7ScaleFixture> {
	if (PROJECT_SEEDS.reduce((sum, p) => sum + p.issueCount, 0) !== TOTAL_ISSUES) {
		throw new Error('G7 scale seed invariant failed: project distribution does not sum to 50,000')
	}
	const { workspaceId, ownerId } = await seedIdentityAndRoles(ownerSql)
	const projects = await seedProjectsStatusesAndCycles(ownerSql, workspaceId, ownerId)
	await seedIssues(ownerSql, workspaceId, ownerId, projects)
	const labelIds = await seedLabelsAndLinks(ownerSql, workspaceId, ownerId, projects)
	await seedSavedViewsAndAutomations(ownerSql, workspaceId, ownerId, projects)

	const counts = await countFixture(ownerSql, workspaceId)
	const expectedIssueLabels = PROJECT_SEEDS.reduce((sum, p) => sum + Math.floor((p.issueCount * 34) / 100), 0)
	if (counts.projects !== PROJECT_SEEDS.length) {
		throw new Error(`G7 scale seed invariant failed: expected 10 projects, found ${counts.projects}`)
	}
	if (counts.totalIssues !== TOTAL_ISSUES) {
		throw new Error(`G7 scale seed invariant failed: expected 50,000 issues, found ${counts.totalIssues}`)
	}
	if (counts.labels < 20 || counts.issueLabels < expectedIssueLabels) {
		throw new Error(
			`G7 scale seed invariant failed: label rows incomplete (${counts.labels} labels, ${counts.issueLabels} links)`
		)
	}
	if (
		counts.cycles < PROJECT_SEEDS.length * 3 ||
		counts.entityLinks < PROJECT_SEEDS.length * ENTITY_LINKS_PER_PROJECT
	) {
		throw new Error('G7 scale seed invariant failed: cycle or entity-link rows incomplete')
	}
	if (counts.automationRules < 3 || counts.tier1CoreIssues <= 0 || counts.tier2HistoryIssues <= 0) {
		throw new Error('G7 scale seed invariant failed: automation or tier distribution rows incomplete')
	}

	return {
		workspaceId,
		ownerId,
		ownerEmail: SCALE_OWNER_EMAIL,
		projects,
		labelIds,
		counts
	}
}
