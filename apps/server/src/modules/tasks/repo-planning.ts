/**
 * Planning persistence (§3.2): initiatives, milestones and project updates.
 * Kept separate from the large core task
 * repository so roadmap entities evolve without making the core file harder
 * to review; same composite workspace scoping and explicit projection rules.
 */
import type {
	InitiativeDto,
	IssueRelationDto,
	ProjectMilestoneDto,
	ProjectUpdateDto
} from '@huriro/contracts'
import type { Queryable } from '@huriro/db'

export type InitiativeRow = Omit<InitiativeDto, 'projectIds'>

const INITIATIVE_COLS = `
	id, workspace_id AS "workspaceId", name, description, description_text AS "descriptionText",
	health, owner_id AS "ownerId", target_date::text AS "targetDate", position,
	created_at::text AS "createdAt", updated_at::text AS "updatedAt", version
`

export async function listInitiativeRows(tx: Queryable, workspaceId: string): Promise<InitiativeRow[]> {
	return tx<InitiativeRow[]>`
		SELECT ${tx.unsafe(INITIATIVE_COLS)} FROM initiatives
		WHERE workspace_id = ${workspaceId}
		ORDER BY position COLLATE "C" ASC, id ASC
	`
}

export async function getInitiativeRow(
	tx: Queryable,
	workspaceId: string,
	initiativeId: string
): Promise<InitiativeRow | null> {
	const [row] = await tx<InitiativeRow[]>`
		SELECT ${tx.unsafe(INITIATIVE_COLS)} FROM initiatives
		WHERE workspace_id = ${workspaceId} AND id = ${initiativeId}
	`
	return row ?? null
}

export async function listInitiativeProjectEdges(
	tx: Queryable,
	workspaceId: string
): Promise<{ initiativeId: string; projectId: string; position: string }[]> {
	return tx<{ initiativeId: string; projectId: string; position: string }[]>`
		SELECT initiative_id AS "initiativeId", project_id AS "projectId", position
		FROM initiative_projects WHERE workspace_id = ${workspaceId}
		ORDER BY position COLLATE "C" ASC, project_id ASC
	`
}

export async function getLastInitiativePosition(tx: Queryable, workspaceId: string): Promise<string | null> {
	const [row] = await tx<{ position: string }[]>`
		SELECT position FROM initiatives WHERE workspace_id = ${workspaceId}
		ORDER BY position COLLATE "C" DESC, id DESC LIMIT 1
	`
	return row?.position ?? null
}

export async function insertInitiativeRow(
	tx: Queryable,
	args: {
		readonly id?: string | undefined
		readonly workspaceId: string
		readonly name: string
		readonly description: unknown | null
		readonly descriptionText: string
		readonly health: InitiativeDto['health']
		readonly ownerId: string | null
		readonly targetDate: string | null
		readonly position: string
	}
): Promise<InitiativeRow> {
	const description = args.description === null ? null : tx.json(args.description as never)
	const rows = args.id
		? await tx<InitiativeRow[]>`
			INSERT INTO initiatives (id, workspace_id, name, description, description_text, health, owner_id, target_date, position)
			VALUES (${args.id}, ${args.workspaceId}, ${args.name}, ${description}, ${args.descriptionText}, ${args.health}, ${args.ownerId}, ${args.targetDate}::date, ${args.position})
			RETURNING ${tx.unsafe(INITIATIVE_COLS)}
		`
		: await tx<InitiativeRow[]>`
			INSERT INTO initiatives (workspace_id, name, description, description_text, health, owner_id, target_date, position)
			VALUES (${args.workspaceId}, ${args.name}, ${description}, ${args.descriptionText}, ${args.health}, ${args.ownerId}, ${args.targetDate}::date, ${args.position})
			RETURNING ${tx.unsafe(INITIATIVE_COLS)}
		`
	const row = rows[0]
	if (!row) throw new Error('Failed to insert initiative')
	return row
}

export async function updateInitiativeRow(
	tx: Queryable,
	args: {
		readonly workspaceId: string
		readonly initiativeId: string
		readonly expectedVersion: number
		readonly name: string
		readonly description: unknown | null
		readonly descriptionText: string
		readonly health: InitiativeDto['health']
		readonly ownerId: string | null
		readonly targetDate: string | null
		readonly position: string
	}
): Promise<InitiativeRow | null> {
	const description = args.description === null ? null : tx.json(args.description as never)
	const [row] = await tx<InitiativeRow[]>`
		UPDATE initiatives
		SET name = ${args.name}, description = ${description}, description_text = ${args.descriptionText},
			health = ${args.health}, owner_id = ${args.ownerId}, target_date = ${args.targetDate}::date,
			position = ${args.position}, version = version + 1
		WHERE workspace_id = ${args.workspaceId} AND id = ${args.initiativeId} AND version = ${args.expectedVersion}
		RETURNING ${tx.unsafe(INITIATIVE_COLS)}
	`
	return row ?? null
}

export async function deleteInitiativeRow(
	tx: Queryable,
	workspaceId: string,
	initiativeId: string
): Promise<InitiativeRow | null> {
	const [row] = await tx<InitiativeRow[]>`
		DELETE FROM initiatives WHERE workspace_id = ${workspaceId} AND id = ${initiativeId}
		RETURNING ${tx.unsafe(INITIATIVE_COLS)}
	`
	return row ?? null
}

export async function replaceInitiativeProjectEdges(
	tx: Queryable,
	args: {
		readonly workspaceId: string
		readonly initiativeId: string
		readonly projectPositions: readonly { readonly projectId: string; readonly position: string }[]
	}
): Promise<void> {
	const projectIds = args.projectPositions.map((p) => p.projectId)
	await tx`
		DELETE FROM initiative_projects
		WHERE workspace_id = ${args.workspaceId} AND initiative_id = ${args.initiativeId}
			AND NOT (project_id = ANY(${projectIds}::uuid[]))
	`
	for (const edge of args.projectPositions) {
		await tx`
			INSERT INTO initiative_projects (workspace_id, initiative_id, project_id, position)
			VALUES (${args.workspaceId}, ${args.initiativeId}, ${edge.projectId}, ${edge.position})
			ON CONFLICT (workspace_id, initiative_id, project_id) DO UPDATE SET position = excluded.position
		`
	}
}

const MILESTONE_COLS = `
	id, workspace_id AS "workspaceId", project_id AS "projectId", name, description,
	target_date::text AS "targetDate", status, position,
	created_at::text AS "createdAt", updated_at::text AS "updatedAt", version
`

export async function listProjectMilestoneRows(
	tx: Queryable,
	workspaceId: string,
	projectIds: readonly string[]
): Promise<ProjectMilestoneDto[]> {
	if (projectIds.length === 0) return []
	return tx<ProjectMilestoneDto[]>`
		SELECT ${tx.unsafe(MILESTONE_COLS)} FROM project_milestones
		WHERE workspace_id = ${workspaceId} AND project_id = ANY(${[...projectIds]}::uuid[])
		ORDER BY project_id ASC, position COLLATE "C" ASC, id ASC
	`
}

export async function getProjectMilestoneRow(
	tx: Queryable,
	workspaceId: string,
	milestoneId: string
): Promise<ProjectMilestoneDto | null> {
	const [row] = await tx<ProjectMilestoneDto[]>`
		SELECT ${tx.unsafe(MILESTONE_COLS)} FROM project_milestones
		WHERE workspace_id = ${workspaceId} AND id = ${milestoneId}
	`
	return row ?? null
}

export async function getLastMilestonePosition(
	tx: Queryable,
	workspaceId: string,
	projectId: string
): Promise<string | null> {
	const [row] = await tx<{ position: string }[]>`
		SELECT position FROM project_milestones
		WHERE workspace_id = ${workspaceId} AND project_id = ${projectId}
		ORDER BY position COLLATE "C" DESC, id DESC LIMIT 1
	`
	return row?.position ?? null
}

export async function insertProjectMilestoneRow(
	tx: Queryable,
	args: {
		readonly id?: string | undefined
		readonly workspaceId: string
		readonly projectId: string
		readonly name: string
		readonly description: string
		readonly targetDate: string | null
		readonly status: ProjectMilestoneDto['status']
		readonly position: string
	}
): Promise<ProjectMilestoneDto> {
	const rows = args.id
		? await tx<ProjectMilestoneDto[]>`
			INSERT INTO project_milestones (id, workspace_id, project_id, name, description, target_date, status, position)
			VALUES (${args.id}, ${args.workspaceId}, ${args.projectId}, ${args.name}, ${args.description}, ${args.targetDate}::date, ${args.status}, ${args.position})
			RETURNING ${tx.unsafe(MILESTONE_COLS)}
		`
		: await tx<ProjectMilestoneDto[]>`
			INSERT INTO project_milestones (workspace_id, project_id, name, description, target_date, status, position)
			VALUES (${args.workspaceId}, ${args.projectId}, ${args.name}, ${args.description}, ${args.targetDate}::date, ${args.status}, ${args.position})
			RETURNING ${tx.unsafe(MILESTONE_COLS)}
		`
	const row = rows[0]
	if (!row) throw new Error('Failed to insert project milestone')
	return row
}

export async function updateProjectMilestoneRow(
	tx: Queryable,
	args: {
		readonly workspaceId: string
		readonly milestoneId: string
		readonly expectedVersion: number
		readonly name: string
		readonly description: string
		readonly targetDate: string | null
		readonly status: ProjectMilestoneDto['status']
		readonly position: string
	}
): Promise<ProjectMilestoneDto | null> {
	const [row] = await tx<ProjectMilestoneDto[]>`
		UPDATE project_milestones
		SET name = ${args.name}, description = ${args.description}, target_date = ${args.targetDate}::date,
			status = ${args.status}, position = ${args.position}, version = version + 1
		WHERE workspace_id = ${args.workspaceId} AND id = ${args.milestoneId} AND version = ${args.expectedVersion}
		RETURNING ${tx.unsafe(MILESTONE_COLS)}
	`
	return row ?? null
}

export async function deleteProjectMilestoneRow(
	tx: Queryable,
	workspaceId: string,
	milestoneId: string
): Promise<ProjectMilestoneDto | null> {
	const [row] = await tx<ProjectMilestoneDto[]>`
		DELETE FROM project_milestones WHERE workspace_id = ${workspaceId} AND id = ${milestoneId}
		RETURNING ${tx.unsafe(MILESTONE_COLS)}
	`
	return row ?? null
}

const PROJECT_UPDATE_COLS = `
	id, workspace_id AS "workspaceId", project_id AS "projectId", health, body, body_text AS "bodyText",
	completed_issues AS "completedIssues", total_issues AS "totalIssues", scope_change AS "scopeChange",
	created_by AS "createdBy", created_at::text AS "createdAt", updated_at::text AS "updatedAt", version
`

export async function listProjectUpdateRows(
	tx: Queryable,
	workspaceId: string,
	projectIds: readonly string[],
	limitPerProject = 20
): Promise<ProjectUpdateDto[]> {
	if (projectIds.length === 0) return []
	return tx<ProjectUpdateDto[]>`
		SELECT ${tx.unsafe(PROJECT_UPDATE_COLS)} FROM (
			SELECT pu.*, row_number() OVER (PARTITION BY project_id ORDER BY created_at DESC, id DESC) AS rn
			FROM project_updates pu
			WHERE pu.workspace_id = ${workspaceId} AND pu.project_id = ANY(${[...projectIds]}::uuid[])
		) ranked
		WHERE rn <= ${limitPerProject}
		ORDER BY project_id ASC, created_at DESC, id DESC
	`
}

export async function insertProjectUpdateRow(
	tx: Queryable,
	args: {
		readonly id?: string | undefined
		readonly workspaceId: string
		readonly projectId: string
		readonly health: ProjectUpdateDto['health']
		readonly body: unknown | null
		readonly bodyText: string
		readonly completedIssues: number
		readonly totalIssues: number
		readonly scopeChange: number
		readonly createdBy: string
	}
): Promise<ProjectUpdateDto> {
	const body = args.body === null ? null : tx.json(args.body as never)
	const rows = args.id
		? await tx<ProjectUpdateDto[]>`
			INSERT INTO project_updates (id, workspace_id, project_id, health, body, body_text, completed_issues, total_issues, scope_change, created_by)
			VALUES (${args.id}, ${args.workspaceId}, ${args.projectId}, ${args.health}, ${body}, ${args.bodyText}, ${args.completedIssues}, ${args.totalIssues}, ${args.scopeChange}, ${args.createdBy})
			RETURNING ${tx.unsafe(PROJECT_UPDATE_COLS)}
		`
		: await tx<ProjectUpdateDto[]>`
			INSERT INTO project_updates (workspace_id, project_id, health, body, body_text, completed_issues, total_issues, scope_change, created_by)
			VALUES (${args.workspaceId}, ${args.projectId}, ${args.health}, ${body}, ${args.bodyText}, ${args.completedIssues}, ${args.totalIssues}, ${args.scopeChange}, ${args.createdBy})
			RETURNING ${tx.unsafe(PROJECT_UPDATE_COLS)}
		`
	const row = rows[0]
	if (!row) throw new Error('Failed to insert project update')
	return row
}

export async function getProjectIssueCounts(
	tx: Queryable,
	workspaceId: string,
	projectId: string
): Promise<{ completedIssues: number; totalIssues: number }> {
	const [row] = await tx<{ completedIssues: number; totalIssues: number }[]>`
		SELECT
			count(*) FILTER (WHERE ps.category = 'completed')::int AS "completedIssues",
			count(*)::int AS "totalIssues"
		FROM issues i
		JOIN project_statuses ps ON ps.workspace_id = i.workspace_id AND ps.project_id = i.project_id AND ps.id = i.status_id
		WHERE i.workspace_id = ${workspaceId} AND i.project_id = ${projectId} AND i.deleted_at IS NULL
	`
	return row ?? { completedIssues: 0, totalIssues: 0 }
}

/** Dependency arrows are meaningful only when both endpoints are visible. */
export async function listIssueRelationsForProjects(
	tx: Queryable,
	workspaceId: string,
	projectIds: readonly string[]
): Promise<IssueRelationDto[]> {
	if (projectIds.length === 0) return []
	return tx<IssueRelationDto[]>`
		SELECT r.id, r.workspace_id AS "workspaceId", r.source_issue_id AS "sourceIssueId",
			r.target_issue_id AS "targetIssueId", r.kind, r.created_by AS "createdBy", r.created_at::text AS "createdAt"
		FROM issue_relations r
		JOIN issues si ON si.workspace_id = r.workspace_id AND si.id = r.source_issue_id
		JOIN issues ti ON ti.workspace_id = r.workspace_id AND ti.id = r.target_issue_id
		WHERE r.workspace_id = ${workspaceId}
			AND si.project_id = ANY(${[...projectIds]}::uuid[])
			AND ti.project_id = ANY(${[...projectIds]}::uuid[])
		ORDER BY r.created_at ASC, r.id ASC
	`
}
