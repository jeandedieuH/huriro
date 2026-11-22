/**
 * Tasks persistence layer (§7.3). Explicit column lists everywhere (no SELECT *),
 * composite workspace scopes, and SQL-enforced visibility/ACL predicates.
 */
import type {
	CycleDto,
	IssueCommentDto,
	IssueDto,
	IssueRelationDto,
	LabelDto,
	ProjectDto,
	ProjectStatusDto,
	SavedViewDto
} from '@huriro/contracts'
import type { Queryable } from '@huriro/db'

const PROJECT_COLS = `
	id,
	workspace_id AS "workspaceId",
	key,
	name,
	description,
	visibility,
	position,
	archived_at::text AS "archivedAt",
	created_by AS "createdBy",
	created_at::text AS "createdAt",
	updated_at::text AS "updatedAt",
	version
`

export async function listVisibleProjects(
	tx: Queryable,
	args: {
		readonly workspaceId: string
		readonly userId: string
		readonly isGuest: boolean
		readonly bypassAcl: boolean
	}
): Promise<ProjectDto[]> {
	if (args.bypassAcl) {
		return tx<ProjectDto[]>`
			SELECT
				id, workspace_id AS "workspaceId", key, name, description, visibility, position,
				archived_at::text AS "archivedAt", created_by AS "createdBy",
				created_at::text AS "createdAt", updated_at::text AS "updatedAt", version
			FROM projects
			WHERE workspace_id = ${args.workspaceId} AND archived_at IS NULL
			ORDER BY position COLLATE "C" ASC, id ASC
		`
	}
	if (args.isGuest) {
		return tx<ProjectDto[]>`
			SELECT
				id, workspace_id AS "workspaceId", key, name, description, visibility, position,
				archived_at::text AS "archivedAt", created_by AS "createdBy",
				created_at::text AS "createdAt", updated_at::text AS "updatedAt", version
			FROM projects
			WHERE workspace_id = ${args.workspaceId}
				AND archived_at IS NULL
				AND can_read(workspace_id, 'project', id, ${args.userId}, 'read')
			ORDER BY position COLLATE "C" ASC, id ASC
		`
	}
	return tx<ProjectDto[]>`
		SELECT
			id, workspace_id AS "workspaceId", key, name, description, visibility, position,
			archived_at::text AS "archivedAt", created_by AS "createdBy",
			created_at::text AS "createdAt", updated_at::text AS "updatedAt", version
		FROM projects
		WHERE workspace_id = ${args.workspaceId}
			AND archived_at IS NULL
			AND (visibility = 'workspace' OR can_read(workspace_id, 'project', id, ${args.userId}, 'read'))
		ORDER BY position COLLATE "C" ASC, id ASC
	`
}

export async function getProjectById(
	tx: Queryable,
	workspaceId: string,
	projectId: string
): Promise<ProjectDto | null> {
	const [row] = await tx<ProjectDto[]>`
		SELECT
			id, workspace_id AS "workspaceId", key, name, description, visibility, position,
			archived_at::text AS "archivedAt", created_by AS "createdBy",
			created_at::text AS "createdAt", updated_at::text AS "updatedAt", version
		FROM projects
		WHERE workspace_id = ${workspaceId} AND id = ${projectId}
	`
	return row ?? null
}

export async function getProjectByKey(
	tx: Queryable,
	workspaceId: string,
	key: string
): Promise<ProjectDto | null> {
	const [row] = await tx<ProjectDto[]>`
		SELECT
			id, workspace_id AS "workspaceId", key, name, description, visibility, position,
			archived_at::text AS "archivedAt", created_by AS "createdBy",
			created_at::text AS "createdAt", updated_at::text AS "updatedAt", version
		FROM projects
		WHERE workspace_id = ${workspaceId} AND key = ${key}
	`
	return row ?? null
}

export async function getLastProjectPosition(tx: Queryable, workspaceId: string): Promise<string | null> {
	const [row] = await tx<{ position: string }[]>`
		SELECT position FROM projects
		WHERE workspace_id = ${workspaceId}
		ORDER BY position COLLATE "C" DESC
		LIMIT 1
	`
	return row?.position ?? null
}

export async function insertProject(
	tx: Queryable,
	args: {
		readonly id?: string | undefined
		readonly workspaceId: string
		readonly key: string
		readonly name: string
		readonly description: string
		readonly visibility: 'workspace' | 'private'
		readonly position: string
		readonly createdBy: string
	}
): Promise<ProjectDto> {
	const rows = args.id
		? await tx<ProjectDto[]>`
			INSERT INTO projects (id, workspace_id, key, name, description, visibility, position, created_by)
			VALUES (${args.id}, ${args.workspaceId}, ${args.key}, ${args.name}, ${args.description}, ${args.visibility}, ${args.position}, ${args.createdBy})
			RETURNING
				id, workspace_id AS "workspaceId", key, name, description, visibility, position,
				archived_at::text AS "archivedAt", created_by AS "createdBy",
				created_at::text AS "createdAt", updated_at::text AS "updatedAt", version
		`
		: await tx<ProjectDto[]>`
			INSERT INTO projects (workspace_id, key, name, description, visibility, position, created_by)
			VALUES (${args.workspaceId}, ${args.key}, ${args.name}, ${args.description}, ${args.visibility}, ${args.position}, ${args.createdBy})
			RETURNING
				id, workspace_id AS "workspaceId", key, name, description, visibility, position,
				archived_at::text AS "archivedAt", created_by AS "createdBy",
				created_at::text AS "createdAt", updated_at::text AS "updatedAt", version
		`
	const row = rows[0]
	if (!row) throw new Error('Failed to insert project')
	await tx`
		INSERT INTO issue_counters (workspace_id, project_id, next_number)
		VALUES (${args.workspaceId}, ${row.id}, 1)
	`
	return row
}

export async function updateProjectRow(
	tx: Queryable,
	args: {
		readonly workspaceId: string
		readonly projectId: string
		readonly expectedVersion: number
		readonly name: string
		readonly description: string
		readonly visibility: 'workspace' | 'private'
		readonly archivedAt: string | null
	}
): Promise<ProjectDto | null> {
	const [row] = await tx<ProjectDto[]>`
		UPDATE projects
		SET name = ${args.name},
			description = ${args.description},
			visibility = ${args.visibility},
			archived_at = ${args.archivedAt}::timestamptz,
			version = version + 1
		WHERE workspace_id = ${args.workspaceId}
			AND id = ${args.projectId}
			AND version = ${args.expectedVersion}
		RETURNING
			id, workspace_id AS "workspaceId", key, name, description, visibility, position,
			archived_at::text AS "archivedAt", created_by AS "createdBy",
			created_at::text AS "createdAt", updated_at::text AS "updatedAt", version
	`
	return row ?? null
}

// ---------- Statuses ----------

export async function listStatusesForProject(
	tx: Queryable,
	workspaceId: string,
	projectId: string
): Promise<ProjectStatusDto[]> {
	return tx<ProjectStatusDto[]>`
		SELECT
			id, workspace_id AS "workspaceId", project_id AS "projectId",
			name, category, color, position, is_default AS "isDefault",
			created_at::text AS "createdAt", updated_at::text AS "updatedAt", version
		FROM project_statuses
		WHERE workspace_id = ${workspaceId} AND project_id = ${projectId}
		ORDER BY position COLLATE "C" ASC, id ASC
	`
}

export async function listVisibleStatuses(
	tx: Queryable,
	workspaceId: string,
	projectIds: readonly string[]
): Promise<ProjectStatusDto[]> {
	if (projectIds.length === 0) return []
	return tx<ProjectStatusDto[]>`
		SELECT
			id, workspace_id AS "workspaceId", project_id AS "projectId",
			name, category, color, position, is_default AS "isDefault",
			created_at::text AS "createdAt", updated_at::text AS "updatedAt", version
		FROM project_statuses
		WHERE workspace_id = ${workspaceId} AND project_id = ANY(${[...projectIds]}::uuid[])
		ORDER BY project_id ASC, position COLLATE "C" ASC, id ASC
	`
}

export async function getStatusById(
	tx: Queryable,
	workspaceId: string,
	statusId: string
): Promise<ProjectStatusDto | null> {
	const [row] = await tx<ProjectStatusDto[]>`
		SELECT
			id, workspace_id AS "workspaceId", project_id AS "projectId",
			name, category, color, position, is_default AS "isDefault",
			created_at::text AS "createdAt", updated_at::text AS "updatedAt", version
		FROM project_statuses
		WHERE workspace_id = ${workspaceId} AND id = ${statusId}
	`
	return row ?? null
}

export async function getDefaultStatusForProject(
	tx: Queryable,
	workspaceId: string,
	projectId: string
): Promise<ProjectStatusDto | null> {
	const [row] = await tx<ProjectStatusDto[]>`
		SELECT
			id, workspace_id AS "workspaceId", project_id AS "projectId",
			name, category, color, position, is_default AS "isDefault",
			created_at::text AS "createdAt", updated_at::text AS "updatedAt", version
		FROM project_statuses
		WHERE workspace_id = ${workspaceId} AND project_id = ${projectId}
		ORDER BY is_default DESC, position COLLATE "C" ASC
		LIMIT 1
	`
	return row ?? null
}

export async function insertStatusRow(
	tx: Queryable,
	args: {
		readonly workspaceId: string
		readonly projectId: string
		readonly name: string
		readonly category: ProjectStatusDto['category']
		readonly color: string
		readonly position: string
		readonly isDefault: boolean
	}
): Promise<ProjectStatusDto> {
	if (args.isDefault) {
		await tx`
			UPDATE project_statuses SET is_default = false
			WHERE workspace_id = ${args.workspaceId} AND project_id = ${args.projectId} AND is_default = true
		`
	}
	const [row] = await tx<ProjectStatusDto[]>`
		INSERT INTO project_statuses (workspace_id, project_id, name, category, color, position, is_default)
		VALUES (${args.workspaceId}, ${args.projectId}, ${args.name}, ${args.category}, ${args.color}, ${args.position}, ${args.isDefault})
		RETURNING
			id, workspace_id AS "workspaceId", project_id AS "projectId",
			name, category, color, position, is_default AS "isDefault",
			created_at::text AS "createdAt", updated_at::text AS "updatedAt", version
	`
	if (!row) throw new Error('Failed to insert project_status')
	return row
}

export async function updateStatusRow(
	tx: Queryable,
	args: {
		readonly workspaceId: string
		readonly statusId: string
		readonly projectId: string
		readonly expectedVersion: number
		readonly name: string
		readonly category: ProjectStatusDto['category']
		readonly color: string
		readonly position: string
		readonly isDefault: boolean
	}
): Promise<ProjectStatusDto | null> {
	if (args.isDefault) {
		await tx`
			UPDATE project_statuses SET is_default = false
			WHERE workspace_id = ${args.workspaceId}
				AND project_id = ${args.projectId}
				AND id <> ${args.statusId}
				AND is_default = true
		`
	}
	const [row] = await tx<ProjectStatusDto[]>`
		UPDATE project_statuses
		SET name = ${args.name},
			category = ${args.category},
			color = ${args.color},
			position = ${args.position},
			is_default = ${args.isDefault},
			version = version + 1
		WHERE workspace_id = ${args.workspaceId}
			AND id = ${args.statusId}
			AND version = ${args.expectedVersion}
		RETURNING
			id, workspace_id AS "workspaceId", project_id AS "projectId",
			name, category, color, position, is_default AS "isDefault",
			created_at::text AS "createdAt", updated_at::text AS "updatedAt", version
	`
	return row ?? null
}

// ---------- Labels ----------

export async function listLabels(tx: Queryable, workspaceId: string): Promise<LabelDto[]> {
	return tx<LabelDto[]>`
		SELECT id, workspace_id AS "workspaceId", name, color,
			created_at::text AS "createdAt", updated_at::text AS "updatedAt", version
		FROM labels
		WHERE workspace_id = ${workspaceId}
		ORDER BY name ASC
	`
}

export async function getLabelById(
	tx: Queryable,
	workspaceId: string,
	labelId: string
): Promise<LabelDto | null> {
	const [row] = await tx<LabelDto[]>`
		SELECT id, workspace_id AS "workspaceId", name, color,
			created_at::text AS "createdAt", updated_at::text AS "updatedAt", version
		FROM labels
		WHERE workspace_id = ${workspaceId} AND id = ${labelId}
	`
	return row ?? null
}

export async function insertLabelRow(
	tx: Queryable,
	args: { readonly workspaceId: string; readonly name: string; readonly color: string }
): Promise<LabelDto> {
	const [row] = await tx<LabelDto[]>`
		INSERT INTO labels (workspace_id, name, color)
		VALUES (${args.workspaceId}, ${args.name}, ${args.color})
		RETURNING id, workspace_id AS "workspaceId", name, color,
			created_at::text AS "createdAt", updated_at::text AS "updatedAt", version
	`
	if (!row) throw new Error('Failed to insert label')
	return row
}

export async function updateLabelRow(
	tx: Queryable,
	args: {
		readonly workspaceId: string
		readonly labelId: string
		readonly expectedVersion: number
		readonly name: string
		readonly color: string
	}
): Promise<LabelDto | null> {
	const [row] = await tx<LabelDto[]>`
		UPDATE labels
		SET name = ${args.name}, color = ${args.color}, version = version + 1
		WHERE workspace_id = ${args.workspaceId} AND id = ${args.labelId} AND version = ${args.expectedVersion}
		RETURNING id, workspace_id AS "workspaceId", name, color,
			created_at::text AS "createdAt", updated_at::text AS "updatedAt", version
	`
	return row ?? null
}

// ---------- Cycles ----------

export async function listCyclesForProjects(
	tx: Queryable,
	workspaceId: string,
	projectIds: readonly string[]
): Promise<CycleDto[]> {
	if (projectIds.length === 0) return []
	return tx<CycleDto[]>`
		SELECT
			id, workspace_id AS "workspaceId", project_id AS "projectId",
			name, description, status,
			starts_at::text AS "startsAt", ends_at::text AS "endsAt",
			created_at::text AS "createdAt", updated_at::text AS "updatedAt", version
		FROM cycles
		WHERE workspace_id = ${workspaceId} AND project_id = ANY(${[...projectIds]}::uuid[])
		ORDER BY starts_at DESC, id ASC
	`
}

export async function getCycleById(
	tx: Queryable,
	workspaceId: string,
	cycleId: string
): Promise<CycleDto | null> {
	const [row] = await tx<CycleDto[]>`
		SELECT
			id, workspace_id AS "workspaceId", project_id AS "projectId",
			name, description, status,
			starts_at::text AS "startsAt", ends_at::text AS "endsAt",
			created_at::text AS "createdAt", updated_at::text AS "updatedAt", version
		FROM cycles
		WHERE workspace_id = ${workspaceId} AND id = ${cycleId}
	`
	return row ?? null
}

export async function insertCycleRow(
	tx: Queryable,
	args: {
		readonly workspaceId: string
		readonly projectId: string
		readonly name: string
		readonly description: string
		readonly status: CycleDto['status']
		readonly startsAt: string
		readonly endsAt: string
	}
): Promise<CycleDto> {
	const [row] = await tx<CycleDto[]>`
		INSERT INTO cycles (workspace_id, project_id, name, description, status, starts_at, ends_at)
		VALUES (${args.workspaceId}, ${args.projectId}, ${args.name}, ${args.description}, ${args.status}, ${args.startsAt}::date, ${args.endsAt}::date)
		RETURNING
			id, workspace_id AS "workspaceId", project_id AS "projectId",
			name, description, status,
			starts_at::text AS "startsAt", ends_at::text AS "endsAt",
			created_at::text AS "createdAt", updated_at::text AS "updatedAt", version
	`
	if (!row) throw new Error('Failed to insert cycle')
	return row
}

export async function updateCycleRow(
	tx: Queryable,
	args: {
		readonly workspaceId: string
		readonly cycleId: string
		readonly expectedVersion: number
		readonly name: string
		readonly description: string
		readonly status: CycleDto['status']
		readonly startsAt: string
		readonly endsAt: string
	}
): Promise<CycleDto | null> {
	const [row] = await tx<CycleDto[]>`
		UPDATE cycles
		SET name = ${args.name},
			description = ${args.description},
			status = ${args.status},
			starts_at = ${args.startsAt}::date,
			ends_at = ${args.endsAt}::date,
			version = version + 1
		WHERE workspace_id = ${args.workspaceId} AND id = ${args.cycleId} AND version = ${args.expectedVersion}
		RETURNING
			id, workspace_id AS "workspaceId", project_id AS "projectId",
			name, description, status,
			starts_at::text AS "startsAt", ends_at::text AS "endsAt",
			created_at::text AS "createdAt", updated_at::text AS "updatedAt", version
	`
	return row ?? null
}

// ---------- Issues ----------

interface RawIssueRow {
	readonly id: string
	readonly workspaceId: string
	readonly projectId: string
	readonly projectKey: string
	readonly number: number
	readonly parentId: string | null
	readonly cycleId: string | null
	readonly title: string
	readonly description: unknown | null
	readonly descriptionText: string
	readonly statusId: string
	readonly priority: number
	readonly assigneeType: 'user' | 'agent' | null
	readonly assigneeId: string | null
	readonly creatorId: string
	readonly position: string
	readonly startDate: string | null
	readonly dueDate: string | null
	readonly estimate: number | null
	readonly closedAt: string | null
	readonly createdAt: string
	readonly updatedAt: string
	readonly deletedAt: string | null
	readonly version: number
}

function toIssueDto(row: RawIssueRow, labelIds: string[]): IssueDto {
	return {
		...row,
		identifier: `${row.projectKey}-${row.number}`,
		labelIds
	}
}

export async function getLabelMapForIssues(
	tx: Queryable,
	workspaceId: string,
	issueIds: readonly string[]
): Promise<Map<string, string[]>> {
	const map = new Map<string, string[]>()
	if (issueIds.length === 0) return map
	const rows = await tx<{ issueId: string; labelId: string }[]>`
		SELECT issue_id AS "issueId", label_id AS "labelId"
		FROM issue_labels
		WHERE workspace_id = ${workspaceId} AND issue_id = ANY(${[...issueIds]}::uuid[])
		ORDER BY created_at ASC
	`
	for (const r of rows) {
		const list = map.get(r.issueId)
		if (list) list.push(r.labelId)
		else map.set(r.issueId, [r.labelId])
	}
	return map
}

export async function allocateIssueNumber(
	tx: Queryable,
	workspaceId: string,
	projectId: string
): Promise<number> {
	const [row] = await tx<{ number: number }[]>`
		UPDATE issue_counters
		SET next_number = next_number + 1
		WHERE workspace_id = ${workspaceId} AND project_id = ${projectId}
		RETURNING next_number - 1 AS number
	`
	if (!row) throw new Error(`Missing issue_counters row for project ${projectId}`)
	return row.number
}

export async function getIssueById(
	tx: Queryable,
	workspaceId: string,
	issueId: string,
	includeDeleted = false
): Promise<IssueDto | null> {
	const [row] = await tx<RawIssueRow[]>`
		SELECT
			i.id,
			i.workspace_id AS "workspaceId",
			i.project_id AS "projectId",
			p.key AS "projectKey",
			i.number,
			i.parent_id AS "parentId",
			i.cycle_id AS "cycleId",
			i.title,
			i.description,
			i.description_text AS "descriptionText",
			i.status_id AS "statusId",
			i.priority,
			i.assignee_type AS "assigneeType",
			i.assignee_id AS "assigneeId",
			i.creator_id AS "creatorId",
			i.position,
			i.start_date::text AS "startDate",
			i.due_date::text AS "dueDate",
			i.estimate::float8 AS estimate,
			i.closed_at::text AS "closedAt",
			i.created_at::text AS "createdAt",
			i.updated_at::text AS "updatedAt",
			i.deleted_at::text AS "deletedAt",
			i.version
		FROM issues i
		JOIN projects p ON p.workspace_id = i.workspace_id AND p.id = i.project_id
		WHERE i.workspace_id = ${workspaceId}
			AND i.id = ${issueId}
			${includeDeleted ? tx`` : tx`AND i.deleted_at IS NULL`}
	`
	if (!row) return null
	const labelsMap = await getLabelMapForIssues(tx, workspaceId, [row.id])
	return toIssueDto(row, labelsMap.get(row.id) ?? [])
}

export async function getIssueByKey(
	tx: Queryable,
	workspaceId: string,
	projectKey: string,
	number: number
): Promise<IssueDto | null> {
	const [row] = await tx<RawIssueRow[]>`
		SELECT
			i.id,
			i.workspace_id AS "workspaceId",
			i.project_id AS "projectId",
			p.key AS "projectKey",
			i.number,
			i.parent_id AS "parentId",
			i.cycle_id AS "cycleId",
			i.title,
			i.description,
			i.description_text AS "descriptionText",
			i.status_id AS "statusId",
			i.priority,
			i.assignee_type AS "assigneeType",
			i.assignee_id AS "assigneeId",
			i.creator_id AS "creatorId",
			i.position,
			i.start_date::text AS "startDate",
			i.due_date::text AS "dueDate",
			i.estimate::float8 AS estimate,
			i.closed_at::text AS "closedAt",
			i.created_at::text AS "createdAt",
			i.updated_at::text AS "updatedAt",
			i.deleted_at::text AS "deletedAt",
			i.version
		FROM issues i
		JOIN projects p ON p.workspace_id = i.workspace_id AND p.id = i.project_id
		WHERE i.workspace_id = ${workspaceId}
			AND p.key = ${projectKey.toUpperCase()}
			AND i.number = ${number}
			AND i.deleted_at IS NULL
	`
	if (!row) return null
	const labelsMap = await getLabelMapForIssues(tx, workspaceId, [row.id])
	return toIssueDto(row, labelsMap.get(row.id) ?? [])
}

export async function listIssuesFiltered(
	tx: Queryable,
	args: {
		readonly workspaceId: string
		readonly visibleProjectIds: readonly string[]
		readonly projectId?: string | undefined
		readonly statusId?: string | undefined
		readonly assigneeId?: string | undefined
		readonly cycleId?: string | undefined
		readonly parentId?: string | undefined
		readonly priority?: number | undefined
		readonly mineUserId?: string | undefined
		readonly q?: string | undefined
		readonly cursorPos?: { readonly position: string; readonly id: string } | undefined
		readonly limit: number
	}
): Promise<{ readonly items: IssueDto[]; readonly hasMore: boolean }> {
	if (args.visibleProjectIds.length === 0) return { items: [], hasMore: false }
	const projectFilter = args.projectId
		? args.visibleProjectIds.includes(args.projectId)
			? [args.projectId]
			: []
		: [...args.visibleProjectIds]
	if (projectFilter.length === 0) return { items: [], hasMore: false }

	const rows = await tx<RawIssueRow[]>`
		SELECT
			i.id,
			i.workspace_id AS "workspaceId",
			i.project_id AS "projectId",
			p.key AS "projectKey",
			i.number,
			i.parent_id AS "parentId",
			i.cycle_id AS "cycleId",
			i.title,
			i.description,
			i.description_text AS "descriptionText",
			i.status_id AS "statusId",
			i.priority,
			i.assignee_type AS "assigneeType",
			i.assignee_id AS "assigneeId",
			i.creator_id AS "creatorId",
			i.position,
			i.start_date::text AS "startDate",
			i.due_date::text AS "dueDate",
			i.estimate::float8 AS estimate,
			i.closed_at::text AS "closedAt",
			i.created_at::text AS "createdAt",
			i.updated_at::text AS "updatedAt",
			i.deleted_at::text AS "deletedAt",
			i.version
		FROM issues i
		JOIN projects p ON p.workspace_id = i.workspace_id AND p.id = i.project_id
		WHERE i.workspace_id = ${args.workspaceId}
			AND i.deleted_at IS NULL
			AND i.project_id = ANY(${projectFilter}::uuid[])
			${args.statusId ? tx`AND i.status_id = ${args.statusId}` : tx``}
			${args.assigneeId ? tx`AND i.assignee_id = ${args.assigneeId}` : tx``}
			${args.cycleId ? tx`AND i.cycle_id = ${args.cycleId}` : tx``}
			${args.parentId ? tx`AND i.parent_id = ${args.parentId}` : tx``}
			${args.priority !== undefined ? tx`AND i.priority = ${args.priority}` : tx``}
			${args.mineUserId ? tx`AND i.assignee_type = 'user' AND i.assignee_id = ${args.mineUserId}` : tx``}
			${args.q ? tx`AND (i.title ILIKE ${`%${args.q}%`} OR i.description_text ILIKE ${`%${args.q}%`})` : tx``}
			${
				args.cursorPos
					? tx`AND (i.position COLLATE "C", i.id) > (${args.cursorPos.position} COLLATE "C", ${args.cursorPos.id}::uuid)`
					: tx``
			}
		ORDER BY i.position COLLATE "C" ASC, i.id ASC
		LIMIT ${args.limit + 1}
	`

	const hasMore = rows.length > args.limit
	const sliced = hasMore ? rows.slice(0, args.limit) : rows
	const labelMap = await getLabelMapForIssues(
		tx,
		args.workspaceId,
		sliced.map((r) => r.id)
	)
	return {
		items: sliced.map((r) => toIssueDto(r, labelMap.get(r.id) ?? [])),
		hasMore
	}
}

export async function getLastIssuePositionInColumn(
	tx: Queryable,
	workspaceId: string,
	projectId: string,
	statusId: string
): Promise<string | null> {
	const [row] = await tx<{ position: string }[]>`
		SELECT position FROM issues
		WHERE workspace_id = ${workspaceId}
			AND project_id = ${projectId}
			AND status_id = ${statusId}
			AND deleted_at IS NULL
		ORDER BY position COLLATE "C" DESC, id DESC
		LIMIT 1
	`
	return row?.position ?? null
}

export async function listColumnIssueIdsAndPositions(
	tx: Queryable,
	workspaceId: string,
	projectId: string,
	statusId: string
): Promise<{ readonly id: string; readonly position: string }[]> {
	return tx<{ id: string; position: string }[]>`
		SELECT id, position FROM issues
		WHERE workspace_id = ${workspaceId}
			AND project_id = ${projectId}
			AND status_id = ${statusId}
			AND deleted_at IS NULL
		ORDER BY position COLLATE "C" ASC, id ASC
	`
}

export async function insertIssueRow(
	tx: Queryable,
	args: {
		readonly id?: string | undefined
		readonly workspaceId: string
		readonly projectId: string
		readonly projectKey: string
		readonly number: number
		readonly parentId: string | null
		readonly cycleId: string | null
		readonly title: string
		readonly description: unknown | null
		readonly descriptionText: string
		readonly statusId: string
		readonly priority: number
		readonly assigneeType: 'user' | 'agent' | null
		readonly assigneeId: string | null
		readonly creatorId: string
		readonly position: string
		readonly startDate: string | null
		readonly dueDate: string | null
		readonly estimate: number | null
		readonly closedAt: string | null
		readonly labelIds: readonly string[]
	}
): Promise<IssueDto> {
	const descJson = args.description === null ? null : tx.json(args.description as never)
	const rows = args.id
		? await tx<RawIssueRow[]>`
			INSERT INTO issues (
				id, workspace_id, project_id, number, parent_id, cycle_id, title,
				description, description_text, status_id, priority,
				assignee_type, assignee_id, creator_id, position,
				start_date, due_date, estimate, closed_at
			)
			VALUES (
				${args.id}, ${args.workspaceId}, ${args.projectId}, ${args.number},
				${args.parentId}, ${args.cycleId}, ${args.title},
				${descJson}, ${args.descriptionText}, ${args.statusId}, ${args.priority},
				${args.assigneeType}, ${args.assigneeId}, ${args.creatorId}, ${args.position},
				${args.startDate}::date, ${args.dueDate}::date, ${args.estimate}, ${args.closedAt}::timestamptz
			)
			RETURNING
				id, workspace_id AS "workspaceId", project_id AS "projectId", ${args.projectKey}::text AS "projectKey",
				number, parent_id AS "parentId", cycle_id AS "cycleId", title, description,
				description_text AS "descriptionText", status_id AS "statusId", priority,
				assignee_type AS "assigneeType", assignee_id AS "assigneeId", creator_id AS "creatorId",
				position, start_date::text AS "startDate", due_date::text AS "dueDate",
				estimate::float8 AS estimate, closed_at::text AS "closedAt",
				created_at::text AS "createdAt", updated_at::text AS "updatedAt",
				deleted_at::text AS "deletedAt", version
		`
		: await tx<RawIssueRow[]>`
			INSERT INTO issues (
				workspace_id, project_id, number, parent_id, cycle_id, title,
				description, description_text, status_id, priority,
				assignee_type, assignee_id, creator_id, position,
				start_date, due_date, estimate, closed_at
			)
			VALUES (
				${args.workspaceId}, ${args.projectId}, ${args.number},
				${args.parentId}, ${args.cycleId}, ${args.title},
				${descJson}, ${args.descriptionText}, ${args.statusId}, ${args.priority},
				${args.assigneeType}, ${args.assigneeId}, ${args.creatorId}, ${args.position},
				${args.startDate}::date, ${args.dueDate}::date, ${args.estimate}, ${args.closedAt}::timestamptz
			)
			RETURNING
				id, workspace_id AS "workspaceId", project_id AS "projectId", ${args.projectKey}::text AS "projectKey",
				number, parent_id AS "parentId", cycle_id AS "cycleId", title, description,
				description_text AS "descriptionText", status_id AS "statusId", priority,
				assignee_type AS "assigneeType", assignee_id AS "assigneeId", creator_id AS "creatorId",
				position, start_date::text AS "startDate", due_date::text AS "dueDate",
				estimate::float8 AS estimate, closed_at::text AS "closedAt",
				created_at::text AS "createdAt", updated_at::text AS "updatedAt",
				deleted_at::text AS "deletedAt", version
		`

	const row = rows[0]
	if (!row) throw new Error('Failed to insert issue')

	if (args.labelIds.length > 0) {
		await replaceIssueLabelsRows(tx, args.workspaceId, row.id, args.labelIds)
	}
	return toIssueDto(row, [...args.labelIds])
}

export async function replaceIssueLabelsRows(
	tx: Queryable,
	workspaceId: string,
	issueId: string,
	labelIds: readonly string[]
): Promise<void> {
	await tx`
		DELETE FROM issue_labels WHERE workspace_id = ${workspaceId} AND issue_id = ${issueId}
	`
	for (const labelId of new Set(labelIds)) {
		await tx`
			INSERT INTO issue_labels (workspace_id, issue_id, label_id)
			VALUES (${workspaceId}, ${issueId}, ${labelId})
			ON CONFLICT (workspace_id, issue_id, label_id) DO NOTHING
		`
	}
}

export async function updateIssueRow(
	tx: Queryable,
	args: {
		readonly workspaceId: string
		readonly issueId: string
		readonly expectedVersion: number
		readonly projectId?: string | undefined
		readonly number?: number | undefined
		readonly projectKey: string
		readonly parentId: string | null
		readonly cycleId: string | null
		readonly title: string
		readonly description: unknown | null
		readonly descriptionText: string
		readonly statusId: string
		readonly priority: number
		readonly assigneeType: 'user' | 'agent' | null
		readonly assigneeId: string | null
		readonly position: string
		readonly startDate: string | null
		readonly dueDate: string | null
		readonly estimate: number | null
		readonly closedAt: string | null
		readonly labelIds: readonly string[]
	}
): Promise<IssueDto | null> {
	const descJson = args.description === null ? null : tx.json(args.description as never)
	const [row] = await tx<RawIssueRow[]>`
		UPDATE issues
		SET project_id = COALESCE(${args.projectId ?? null}::uuid, project_id),
			number = COALESCE(${args.number ?? null}::int, number),
			parent_id = ${args.parentId},
			cycle_id = ${args.cycleId},
			title = ${args.title},
			description = ${descJson},
			description_text = ${args.descriptionText},
			status_id = ${args.statusId},
			priority = ${args.priority},
			assignee_type = ${args.assigneeType},
			assignee_id = ${args.assigneeId},
			position = ${args.position},
			start_date = ${args.startDate}::date,
			due_date = ${args.dueDate}::date,
			estimate = ${args.estimate},
			closed_at = ${args.closedAt}::timestamptz,
			version = version + 1
		WHERE workspace_id = ${args.workspaceId}
			AND id = ${args.issueId}
			AND version = ${args.expectedVersion}
			AND deleted_at IS NULL
		RETURNING
			id, workspace_id AS "workspaceId", project_id AS "projectId", ${args.projectKey}::text AS "projectKey",
			number, parent_id AS "parentId", cycle_id AS "cycleId", title, description,
			description_text AS "descriptionText", status_id AS "statusId", priority,
			assignee_type AS "assigneeType", assignee_id AS "assigneeId", creator_id AS "creatorId",
			position, start_date::text AS "startDate", due_date::text AS "dueDate",
			estimate::float8 AS estimate, closed_at::text AS "closedAt",
			created_at::text AS "createdAt", updated_at::text AS "updatedAt",
			deleted_at::text AS "deletedAt", version
	`
	if (!row) return null
	return toIssueDto(row, [...args.labelIds])
}

export async function updateIssuePositionOnly(
	tx: Queryable,
	workspaceId: string,
	issueId: string,
	position: string
): Promise<IssueDto | null> {
	const [row] = await tx<RawIssueRow[]>`
		UPDATE issues i
		SET position = ${position}, version = i.version + 1
		FROM projects p
		WHERE i.workspace_id = ${workspaceId}
			AND i.id = ${issueId}
			AND p.workspace_id = i.workspace_id
			AND p.id = i.project_id
			AND i.deleted_at IS NULL
		RETURNING
			i.id, i.workspace_id AS "workspaceId", i.project_id AS "projectId", p.key AS "projectKey",
			i.number, i.parent_id AS "parentId", i.cycle_id AS "cycleId", i.title, i.description,
			i.description_text AS "descriptionText", i.status_id AS "statusId", i.priority,
			i.assignee_type AS "assigneeType", i.assignee_id AS "assigneeId", i.creator_id AS "creatorId",
			i.position, i.start_date::text AS "startDate", i.due_date::text AS "dueDate",
			i.estimate::float8 AS estimate, i.closed_at::text AS "closedAt",
			i.created_at::text AS "createdAt", i.updated_at::text AS "updatedAt",
			i.deleted_at::text AS "deletedAt", i.version
	`
	if (!row) return null
	const labelMap = await getLabelMapForIssues(tx, workspaceId, [row.id])
	return toIssueDto(row, labelMap.get(row.id) ?? [])
}

export async function softDeleteIssueRow(
	tx: Queryable,
	workspaceId: string,
	issueId: string,
	expectedVersion: number | undefined
): Promise<{ id: string; projectId: string } | null> {
	const [row] = await tx<{ id: string; projectId: string }[]>`
		UPDATE issues
		SET deleted_at = now(), version = version + 1
		WHERE workspace_id = ${workspaceId}
			AND id = ${issueId}
			AND deleted_at IS NULL
			${expectedVersion !== undefined ? tx`AND version = ${expectedVersion}` : tx``}
		RETURNING id, project_id AS "projectId"
	`
	return row ?? null
}

// ---------- Relations & Comments ----------

export async function listIssueRelations(
	tx: Queryable,
	workspaceId: string,
	issueId: string
): Promise<IssueRelationDto[]> {
	return tx<IssueRelationDto[]>`
		SELECT
			id, workspace_id AS "workspaceId", source_issue_id AS "sourceIssueId",
			target_issue_id AS "targetIssueId", kind, created_by AS "createdBy",
			created_at::text AS "createdAt"
		FROM issue_relations
		WHERE workspace_id = ${workspaceId}
			AND (source_issue_id = ${issueId} OR target_issue_id = ${issueId})
		ORDER BY created_at ASC
	`
}

export async function insertIssueRelationRow(
	tx: Queryable,
	args: {
		readonly workspaceId: string
		readonly sourceIssueId: string
		readonly targetIssueId: string
		readonly kind: IssueRelationDto['kind']
		readonly createdBy: string
	}
): Promise<IssueRelationDto> {
	const [row] = await tx<IssueRelationDto[]>`
		INSERT INTO issue_relations (workspace_id, source_issue_id, target_issue_id, kind, created_by)
		VALUES (${args.workspaceId}, ${args.sourceIssueId}, ${args.targetIssueId}, ${args.kind}, ${args.createdBy})
		RETURNING
			id, workspace_id AS "workspaceId", source_issue_id AS "sourceIssueId",
			target_issue_id AS "targetIssueId", kind, created_by AS "createdBy",
			created_at::text AS "createdAt"
	`
	if (!row) throw new Error('Failed to insert issue_relation')
	return row
}

export async function deleteIssueRelationRow(
	tx: Queryable,
	workspaceId: string,
	relationId: string
): Promise<IssueRelationDto | null> {
	const [row] = await tx<IssueRelationDto[]>`
		DELETE FROM issue_relations
		WHERE workspace_id = ${workspaceId} AND id = ${relationId}
		RETURNING
			id, workspace_id AS "workspaceId", source_issue_id AS "sourceIssueId",
			target_issue_id AS "targetIssueId", kind, created_by AS "createdBy",
			created_at::text AS "createdAt"
	`
	return row ?? null
}

export async function listIssueComments(
	tx: Queryable,
	workspaceId: string,
	issueId: string
): Promise<IssueCommentDto[]> {
	return tx<IssueCommentDto[]>`
		SELECT
			id, workspace_id AS "workspaceId", issue_id AS "issueId",
			author_type AS "authorType", author_id AS "authorId",
			body, body_text AS "bodyText",
			created_at::text AS "createdAt", updated_at::text AS "updatedAt",
			deleted_at::text AS "deletedAt", version
		FROM issue_comments
		WHERE workspace_id = ${workspaceId} AND issue_id = ${issueId} AND deleted_at IS NULL
		ORDER BY created_at ASC, id ASC
	`
}

export async function getIssueCommentById(
	tx: Queryable,
	workspaceId: string,
	commentId: string
): Promise<IssueCommentDto | null> {
	const [row] = await tx<IssueCommentDto[]>`
		SELECT
			id, workspace_id AS "workspaceId", issue_id AS "issueId",
			author_type AS "authorType", author_id AS "authorId",
			body, body_text AS "bodyText",
			created_at::text AS "createdAt", updated_at::text AS "updatedAt",
			deleted_at::text AS "deletedAt", version
		FROM issue_comments
		WHERE workspace_id = ${workspaceId} AND id = ${commentId} AND deleted_at IS NULL
	`
	return row ?? null
}

export async function insertIssueCommentRow(
	tx: Queryable,
	args: {
		readonly id?: string | undefined
		readonly workspaceId: string
		readonly issueId: string
		readonly authorType: 'user' | 'agent'
		readonly authorId: string
		readonly body: unknown | null
		readonly bodyText: string
	}
): Promise<IssueCommentDto> {
	const bodyJson = args.body === null ? null : tx.json(args.body as never)
	const rows = args.id
		? await tx<IssueCommentDto[]>`
			INSERT INTO issue_comments (id, workspace_id, issue_id, author_type, author_id, body, body_text)
			VALUES (${args.id}, ${args.workspaceId}, ${args.issueId}, ${args.authorType}, ${args.authorId}, ${bodyJson}, ${args.bodyText})
			RETURNING
				id, workspace_id AS "workspaceId", issue_id AS "issueId",
				author_type AS "authorType", author_id AS "authorId",
				body, body_text AS "bodyText",
				created_at::text AS "createdAt", updated_at::text AS "updatedAt",
				deleted_at::text AS "deletedAt", version
		`
		: await tx<IssueCommentDto[]>`
			INSERT INTO issue_comments (workspace_id, issue_id, author_type, author_id, body, body_text)
			VALUES (${args.workspaceId}, ${args.issueId}, ${args.authorType}, ${args.authorId}, ${bodyJson}, ${args.bodyText})
			RETURNING
				id, workspace_id AS "workspaceId", issue_id AS "issueId",
				author_type AS "authorType", author_id AS "authorId",
				body, body_text AS "bodyText",
				created_at::text AS "createdAt", updated_at::text AS "updatedAt",
				deleted_at::text AS "deletedAt", version
		`
	const row = rows[0]
	if (!row) throw new Error('Failed to insert issue_comment')
	return row
}

export async function updateIssueCommentRow(
	tx: Queryable,
	args: {
		readonly workspaceId: string
		readonly commentId: string
		readonly expectedVersion: number
		readonly body: unknown | null
		readonly bodyText: string
	}
): Promise<IssueCommentDto | null> {
	const bodyJson = args.body === null ? null : tx.json(args.body as never)
	const [row] = await tx<IssueCommentDto[]>`
		UPDATE issue_comments
		SET body = ${bodyJson}, body_text = ${args.bodyText}, version = version + 1
		WHERE workspace_id = ${args.workspaceId}
			AND id = ${args.commentId}
			AND version = ${args.expectedVersion}
			AND deleted_at IS NULL
		RETURNING
			id, workspace_id AS "workspaceId", issue_id AS "issueId",
			author_type AS "authorType", author_id AS "authorId",
			body, body_text AS "bodyText",
			created_at::text AS "createdAt", updated_at::text AS "updatedAt",
			deleted_at::text AS "deletedAt", version
	`
	return row ?? null
}

// ---------- Saved views ----------

export async function listSavedViewsForUser(
	tx: Queryable,
	workspaceId: string,
	userId: string,
	visibleProjectIds: readonly string[]
): Promise<SavedViewDto[]> {
	return tx<SavedViewDto[]>`
		SELECT
			id, workspace_id AS "workspaceId", project_id AS "projectId",
			owner_user_id AS "ownerUserId", name, layout, filters, sort,
			is_shared AS "isShared", position,
			created_at::text AS "createdAt", updated_at::text AS "updatedAt", version
		FROM saved_views
		WHERE workspace_id = ${workspaceId}
			AND (is_shared = true OR owner_user_id = ${userId})
			AND (project_id IS NULL OR project_id = ANY(${[...visibleProjectIds]}::uuid[]))
		ORDER BY position COLLATE "C" ASC, id ASC
	`
}

export async function getSavedViewById(
	tx: Queryable,
	workspaceId: string,
	viewId: string
): Promise<SavedViewDto | null> {
	const [row] = await tx<SavedViewDto[]>`
		SELECT
			id, workspace_id AS "workspaceId", project_id AS "projectId",
			owner_user_id AS "ownerUserId", name, layout, filters, sort,
			is_shared AS "isShared", position,
			created_at::text AS "createdAt", updated_at::text AS "updatedAt", version
		FROM saved_views
		WHERE workspace_id = ${workspaceId} AND id = ${viewId}
	`
	return row ?? null
}

export async function insertSavedViewRow(
	tx: Queryable,
	args: {
		readonly id?: string | undefined
		readonly workspaceId: string
		readonly projectId: string | null
		readonly ownerUserId: string
		readonly name: string
		readonly layout: 'list' | 'board'
		readonly filters: Record<string, unknown>
		readonly sort: Record<string, unknown>
		readonly isShared: boolean
		readonly position: string
	}
): Promise<SavedViewDto> {
	const rows = args.id
		? await tx<SavedViewDto[]>`
			INSERT INTO saved_views (id, workspace_id, project_id, owner_user_id, name, layout, filters, sort, is_shared, position)
			VALUES (
				${args.id}, ${args.workspaceId}, ${args.projectId}, ${args.ownerUserId},
				${args.name}, ${args.layout}, ${tx.json(args.filters as never)}, ${tx.json(args.sort as never)},
				${args.isShared}, ${args.position}
			)
			RETURNING
				id, workspace_id AS "workspaceId", project_id AS "projectId",
				owner_user_id AS "ownerUserId", name, layout, filters, sort,
				is_shared AS "isShared", position,
				created_at::text AS "createdAt", updated_at::text AS "updatedAt", version
		`
		: await tx<SavedViewDto[]>`
			INSERT INTO saved_views (workspace_id, project_id, owner_user_id, name, layout, filters, sort, is_shared, position)
			VALUES (
				${args.workspaceId}, ${args.projectId}, ${args.ownerUserId},
				${args.name}, ${args.layout}, ${tx.json(args.filters as never)}, ${tx.json(args.sort as never)},
				${args.isShared}, ${args.position}
			)
			RETURNING
				id, workspace_id AS "workspaceId", project_id AS "projectId",
				owner_user_id AS "ownerUserId", name, layout, filters, sort,
				is_shared AS "isShared", position,
				created_at::text AS "createdAt", updated_at::text AS "updatedAt", version
		`
	const row = rows[0]
	if (!row) throw new Error('Failed to insert saved_view')
	return row
}

export async function updateSavedViewRow(
	tx: Queryable,
	args: {
		readonly workspaceId: string
		readonly viewId: string
		readonly expectedVersion: number
		readonly name: string
		readonly layout: 'list' | 'board'
		readonly filters: Record<string, unknown>
		readonly sort: Record<string, unknown>
		readonly isShared: boolean
	}
): Promise<SavedViewDto | null> {
	const [row] = await tx<SavedViewDto[]>`
		UPDATE saved_views
		SET name = ${args.name},
			layout = ${args.layout},
			filters = ${tx.json(args.filters as never)},
			sort = ${tx.json(args.sort as never)},
			is_shared = ${args.isShared},
			version = version + 1
		WHERE workspace_id = ${args.workspaceId} AND id = ${args.viewId} AND version = ${args.expectedVersion}
		RETURNING
			id, workspace_id AS "workspaceId", project_id AS "projectId",
			owner_user_id AS "ownerUserId", name, layout, filters, sort,
			is_shared AS "isShared", position,
			created_at::text AS "createdAt", updated_at::text AS "updatedAt", version
	`
	return row ?? null
}

export async function deleteSavedViewRow(
	tx: Queryable,
	workspaceId: string,
	viewId: string
): Promise<boolean> {
	const rows = await tx<{ id: string }[]>`
		DELETE FROM saved_views WHERE workspace_id = ${workspaceId} AND id = ${viewId} RETURNING id
	`
	return rows.length > 0
}

// ---------- Outbox & Audit helpers ----------

export async function emitTasksEvent(
	tx: Queryable,
	args: {
		readonly workspaceId: string
		readonly aggregate: string
		readonly aggregateId: string
		readonly eventType: string
		readonly payload: Record<string, unknown>
	}
): Promise<void> {
	await tx`
		INSERT INTO outbox (workspace_id, aggregate, aggregate_id, event_type, payload)
		VALUES (${args.workspaceId}, ${args.aggregate}, ${args.aggregateId}, ${args.eventType}, ${tx.json(args.payload as never)})
	`
}

export async function auditTasksAction(
	tx: Queryable,
	args: {
		readonly workspaceId: string
		readonly actorType: 'user' | 'agent' | 'system'
		readonly actorId: string
		readonly action: string
		readonly targetType: string
		readonly targetId: string
		readonly metadata?: Record<string, unknown>
	}
): Promise<void> {
	await tx`
		INSERT INTO audit_log (workspace_id, actor_type, actor_id, action, target_type, target_id, metadata)
		VALUES (
			${args.workspaceId}, ${args.actorType}, ${args.actorId}, ${args.action},
			${args.targetType}, ${args.targetId}, ${tx.json((args.metadata ?? {}) as never)}
		)
	`
}

export { PROJECT_COLS }
