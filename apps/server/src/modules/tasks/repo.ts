/**
 * Tasks persistence layer (§7.3). Explicit column lists everywhere (no SELECT *),
 * composite workspace scopes, and SQL-enforced visibility/ACL predicates.
 */
import type {
	CycleDailySnapshotDto,
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
	archived_at::text AS "archivedAt", triage_enabled AS "triageEnabled",
			cycle_enabled AS "cycleEnabled", cycle_duration_days AS "cycleDurationDays",
			cycle_cooldown_days AS "cycleCooldownDays",
			cycle_auto_rollover_mode AS "cycleAutoRolloverMode",
			cycle_start_weekday AS "cycleStartWeekday",
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
				archived_at::text AS "archivedAt", triage_enabled AS "triageEnabled",
			cycle_enabled AS "cycleEnabled", cycle_duration_days AS "cycleDurationDays",
			cycle_cooldown_days AS "cycleCooldownDays",
			cycle_auto_rollover_mode AS "cycleAutoRolloverMode",
			cycle_start_weekday AS "cycleStartWeekday", created_by AS "createdBy",
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
				archived_at::text AS "archivedAt", triage_enabled AS "triageEnabled",
			cycle_enabled AS "cycleEnabled", cycle_duration_days AS "cycleDurationDays",
			cycle_cooldown_days AS "cycleCooldownDays",
			cycle_auto_rollover_mode AS "cycleAutoRolloverMode",
			cycle_start_weekday AS "cycleStartWeekday", created_by AS "createdBy",
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
			archived_at::text AS "archivedAt", triage_enabled AS "triageEnabled",
			cycle_enabled AS "cycleEnabled", cycle_duration_days AS "cycleDurationDays",
			cycle_cooldown_days AS "cycleCooldownDays",
			cycle_auto_rollover_mode AS "cycleAutoRolloverMode",
			cycle_start_weekday AS "cycleStartWeekday", created_by AS "createdBy",
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
			archived_at::text AS "archivedAt", triage_enabled AS "triageEnabled",
			cycle_enabled AS "cycleEnabled", cycle_duration_days AS "cycleDurationDays",
			cycle_cooldown_days AS "cycleCooldownDays",
			cycle_auto_rollover_mode AS "cycleAutoRolloverMode",
			cycle_start_weekday AS "cycleStartWeekday", created_by AS "createdBy",
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
			archived_at::text AS "archivedAt", triage_enabled AS "triageEnabled",
			cycle_enabled AS "cycleEnabled", cycle_duration_days AS "cycleDurationDays",
			cycle_cooldown_days AS "cycleCooldownDays",
			cycle_auto_rollover_mode AS "cycleAutoRolloverMode",
			cycle_start_weekday AS "cycleStartWeekday", created_by AS "createdBy",
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
		readonly triageEnabled?: boolean | undefined
		readonly cycleEnabled?: boolean | undefined
		readonly cycleDurationDays?: number | undefined
		readonly cycleCooldownDays?: number | undefined
		readonly cycleAutoRolloverMode?: string | undefined
		readonly cycleStartWeekday?: number | undefined
	}
): Promise<ProjectDto> {
	const rows = args.id
		? await tx<ProjectDto[]>`
			INSERT INTO projects (id, workspace_id, key, name, description, visibility, position, created_by,
				triage_enabled, cycle_enabled, cycle_duration_days, cycle_cooldown_days,
				cycle_auto_rollover_mode, cycle_start_weekday)
			VALUES (${args.id}, ${args.workspaceId}, ${args.key}, ${args.name}, ${args.description}, ${args.visibility}, ${args.position}, ${args.createdBy},
				${args.triageEnabled ?? false}, ${args.cycleEnabled ?? false}, ${args.cycleDurationDays ?? 14},
				${args.cycleCooldownDays ?? 0}, ${args.cycleAutoRolloverMode ?? 'next_cycle'}, ${args.cycleStartWeekday ?? 1})
			RETURNING
				id, workspace_id AS "workspaceId", key, name, description, visibility, position,
				archived_at::text AS "archivedAt", triage_enabled AS "triageEnabled",
			cycle_enabled AS "cycleEnabled", cycle_duration_days AS "cycleDurationDays",
			cycle_cooldown_days AS "cycleCooldownDays",
			cycle_auto_rollover_mode AS "cycleAutoRolloverMode",
			cycle_start_weekday AS "cycleStartWeekday", created_by AS "createdBy",
				created_at::text AS "createdAt", updated_at::text AS "updatedAt", version
		`
		: await tx<ProjectDto[]>`
			INSERT INTO projects (workspace_id, key, name, description, visibility, position, created_by,
				triage_enabled, cycle_enabled, cycle_duration_days, cycle_cooldown_days,
				cycle_auto_rollover_mode, cycle_start_weekday)
			VALUES (${args.workspaceId}, ${args.key}, ${args.name}, ${args.description}, ${args.visibility}, ${args.position}, ${args.createdBy},
				${args.triageEnabled ?? false}, ${args.cycleEnabled ?? false}, ${args.cycleDurationDays ?? 14},
				${args.cycleCooldownDays ?? 0}, ${args.cycleAutoRolloverMode ?? 'next_cycle'}, ${args.cycleStartWeekday ?? 1})
			RETURNING
				id, workspace_id AS "workspaceId", key, name, description, visibility, position,
				archived_at::text AS "archivedAt", triage_enabled AS "triageEnabled",
			cycle_enabled AS "cycleEnabled", cycle_duration_days AS "cycleDurationDays",
			cycle_cooldown_days AS "cycleCooldownDays",
			cycle_auto_rollover_mode AS "cycleAutoRolloverMode",
			cycle_start_weekday AS "cycleStartWeekday", created_by AS "createdBy",
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
		readonly triageEnabled?: boolean | undefined
		readonly cycleEnabled?: boolean | undefined
		readonly cycleDurationDays?: number | undefined
		readonly cycleCooldownDays?: number | undefined
		readonly cycleAutoRolloverMode?: string | undefined
		readonly cycleStartWeekday?: number | undefined
	}
): Promise<ProjectDto | null> {
	const [row] = await tx<ProjectDto[]>`
		UPDATE projects
		SET name = ${args.name},
			description = ${args.description},
			visibility = ${args.visibility},
			archived_at = ${args.archivedAt}::timestamptz,
			triage_enabled = COALESCE(${args.triageEnabled ?? null}::boolean, triage_enabled),
			cycle_enabled = COALESCE(${args.cycleEnabled ?? null}::boolean, cycle_enabled),
			cycle_duration_days = COALESCE(${args.cycleDurationDays ?? null}::int, cycle_duration_days),
			cycle_cooldown_days = COALESCE(${args.cycleCooldownDays ?? null}::int, cycle_cooldown_days),
			cycle_auto_rollover_mode = COALESCE(${args.cycleAutoRolloverMode ?? null}::text, cycle_auto_rollover_mode),
			cycle_start_weekday = COALESCE(${args.cycleStartWeekday ?? null}::smallint, cycle_start_weekday),
			version = version + 1
		WHERE workspace_id = ${args.workspaceId}
			AND id = ${args.projectId}
			AND version = ${args.expectedVersion}
		RETURNING
			id, workspace_id AS "workspaceId", key, name, description, visibility, position,
			archived_at::text AS "archivedAt", triage_enabled AS "triageEnabled",
			cycle_enabled AS "cycleEnabled", cycle_duration_days AS "cycleDurationDays",
			cycle_cooldown_days AS "cycleCooldownDays",
			cycle_auto_rollover_mode AS "cycleAutoRolloverMode",
			cycle_start_weekday AS "cycleStartWeekday", created_by AS "createdBy",
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
	readonly milestoneId: string | null
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
	readonly triageStatus: 'none' | 'pending' | 'accepted' | 'snoozed' | 'declined' | 'merged'
	readonly triageSnoozedUntil: string | null
	readonly triageDeclinedReason: string | null
	readonly sourceKind: 'manual' | 'mail' | 'chat' | 'form' | 'github' | 'gitlab' | 'api' | 'agent'
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
			i.milestone_id AS "milestoneId",
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
			i.triage_status AS "triageStatus",
			i.triage_snoozed_until::text AS "triageSnoozedUntil",
			i.triage_declined_reason AS "triageDeclinedReason",
			i.source_kind AS "sourceKind",
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
			i.milestone_id AS "milestoneId",
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
			i.triage_status AS "triageStatus",
			i.triage_snoozed_until::text AS "triageSnoozedUntil",
			i.triage_declined_reason AS "triageDeclinedReason",
			i.source_kind AS "sourceKind",
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
		readonly triageStatus?: readonly string[] | undefined
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
			i.milestone_id AS "milestoneId",
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
			i.triage_status AS "triageStatus",
			i.triage_snoozed_until::text AS "triageSnoozedUntil",
			i.triage_declined_reason AS "triageDeclinedReason",
			i.source_kind AS "sourceKind",
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
			${args.triageStatus === undefined ? tx`AND i.triage_status NOT IN ('pending', 'snoozed')` : tx`AND i.triage_status = ANY(${[...args.triageStatus]}::text[])`}
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

// Shared SELECT list for issue rows (same projection as listIssuesFiltered).
const ISSUE_COLS = `
		i.id,
		i.workspace_id AS "workspaceId",
		i.project_id AS "projectId",
		p.key AS "projectKey",
		i.number,
		i.parent_id AS "parentId",
		i.cycle_id AS "cycleId",
			i.milestone_id AS "milestoneId",
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
		i.triage_status AS "triageStatus",
		i.triage_snoozed_until::text AS "triageSnoozedUntil",
		i.triage_declined_reason AS "triageDeclinedReason",
		i.source_kind AS "sourceKind",
		i.closed_at::text AS "closedAt",
		i.created_at::text AS "createdAt",
		i.updated_at::text AS "updatedAt",
		i.deleted_at::text AS "deletedAt",
		i.version
`

/**
 * Sync Engine v2 tier-1 core issue set (§8.1, ADR-0031): every NON-deleted
 * issue in the given projects except those closed more than 30 days ago —
 * closed-over-30d rows are the tier-2 `issue_hist` lazy scope instead. No
 * row cap and NO triage filter: sync feeds ship all rows and clients filter
 * (unlike `listIssues`, which hides pending/snoozed triage by default).
 *
 * Index note: per-project scans ride `idx_issues_board (workspace_id,
 * project_id, status_id, position) WHERE deleted_at IS NULL` — workspace +
 * project + the partial deleted_at predicate all match. The closed_at cutoff
 * is applied as a heap filter inside those per-project scans (no closed_at
 * index exists yet; acceptable at M7 scale because only active-project rows
 * are scanned — see slice S6 report).
 */
export async function listCoreSnapshotIssues(
	tx: Queryable,
	args: {
		readonly workspaceId: string
		readonly visibleProjectIds: readonly string[]
	}
): Promise<IssueDto[]> {
	if (args.visibleProjectIds.length === 0) return []
	const rows = await tx<RawIssueRow[]>`
		SELECT ${tx.unsafe(ISSUE_COLS)}
		FROM issues i
		JOIN projects p ON p.workspace_id = i.workspace_id AND p.id = i.project_id
		WHERE i.workspace_id = ${args.workspaceId}
			AND i.deleted_at IS NULL
			AND i.project_id = ANY(${[...args.visibleProjectIds]}::uuid[])
			AND (i.closed_at IS NULL OR i.closed_at >= now() - interval '30 days')
		ORDER BY i.project_id ASC, i.position COLLATE "C" ASC, i.id ASC
	`
	const labelMap = await getLabelMapForIssues(
		tx,
		args.workspaceId,
		rows.map((r) => r.id)
	)
	return rows.map((r) => toIssueDto(r, labelMap.get(r.id) ?? []))
}

/**
 * Tier-2 `issue_hist:<projectId>` page (§8.1): issues that are tier-2 eligible —
 * closed more than 30 days ago OR soft-deleted more than 30 days ago — keyset-
 * paginated by (closed_at DESC NULLS LAST, id ASC). NULLS LAST because rows
 * deleted without ever being closed carry `closed_at IS NULL`; the keyset
 * predicate mirrors that ordering exactly so pages never overlap or gap:
 * given a non-null key (c0, i0), everything after it is either a NULL row, a
 * strictly older closed_at, or the same closed_at at a larger id; given a NULL
 * key, only NULL rows at larger ids follow.
 */
export async function listIssueHistoryPage(
	tx: Queryable,
	args: {
		readonly workspaceId: string
		readonly projectId: string
		readonly after: { readonly closedAt: string | null; readonly id: string } | null
		readonly limit: number
	}
): Promise<{ readonly items: IssueDto[]; readonly hasMore: boolean }> {
	const keyset = args.after
		? args.after.closedAt !== null
			? tx`AND (
					i.closed_at IS NULL
					OR i.closed_at < ${args.after.closedAt}::timestamptz
					OR (i.closed_at = ${args.after.closedAt}::timestamptz AND i.id > ${args.after.id}::uuid)
				)`
			: tx`AND (i.closed_at IS NULL AND i.id > ${args.after.id}::uuid)`
		: tx``
	const rows = await tx<RawIssueRow[]>`
		SELECT ${tx.unsafe(ISSUE_COLS)}
		FROM issues i
		JOIN projects p ON p.workspace_id = i.workspace_id AND p.id = i.project_id
		WHERE i.workspace_id = ${args.workspaceId}
			AND i.project_id = ${args.projectId}
			AND (
				(i.closed_at IS NOT NULL AND i.closed_at < now() - interval '30 days')
				OR (i.deleted_at IS NOT NULL AND i.deleted_at < now() - interval '30 days')
			)
			${keyset}
		ORDER BY i.closed_at DESC NULLS LAST, i.id ASC
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
		readonly milestoneId: string | null
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
		readonly triageStatus?: string | undefined
		readonly triageSnoozedUntil?: string | null | undefined
		readonly triageDeclinedReason?: string | null | undefined
		readonly sourceKind?: string | undefined
	}
): Promise<IssueDto> {
	const descJson = args.description === null ? null : tx.json(args.description as never)
	const rows = args.id
		? await tx<RawIssueRow[]>`
			INSERT INTO issues (
				id, workspace_id, project_id, number, parent_id, cycle_id, milestone_id, title,
				description, description_text, status_id, priority,
				assignee_type, assignee_id, creator_id, position,
				start_date, due_date, estimate, closed_at,
				source_kind, triage_status, triage_snoozed_until, triage_declined_reason
			)
			VALUES (
				${args.id}, ${args.workspaceId}, ${args.projectId}, ${args.number},
				${args.parentId}, ${args.cycleId}, ${args.milestoneId}, ${args.title},
				${descJson}, ${args.descriptionText}, ${args.statusId}, ${args.priority},
				${args.assigneeType}, ${args.assigneeId}, ${args.creatorId}, ${args.position},
				${args.startDate}::date, ${args.dueDate}::date, ${args.estimate}, ${args.closedAt}::timestamptz,
				${args.sourceKind ?? 'manual'}, ${args.triageStatus ?? 'none'},
				${args.triageSnoozedUntil ?? null}::timestamptz, ${args.triageDeclinedReason ?? null}
			)
			RETURNING
				id, workspace_id AS "workspaceId", project_id AS "projectId", ${args.projectKey}::text AS "projectKey",
				number, parent_id AS "parentId", cycle_id AS "cycleId", milestone_id AS "milestoneId", title, description,
				description_text AS "descriptionText", status_id AS "statusId", priority,
				assignee_type AS "assigneeType", assignee_id AS "assigneeId", creator_id AS "creatorId",
				position, start_date::text AS "startDate", due_date::text AS "dueDate",
				estimate::float8 AS estimate, triage_status AS "triageStatus",
			triage_snoozed_until::text AS "triageSnoozedUntil",
			triage_declined_reason AS "triageDeclinedReason",
			source_kind AS "sourceKind", closed_at::text AS "closedAt",
				created_at::text AS "createdAt", updated_at::text AS "updatedAt",
				deleted_at::text AS "deletedAt", version
		`
		: await tx<RawIssueRow[]>`
			INSERT INTO issues (
				workspace_id, project_id, number, parent_id, cycle_id, milestone_id, title,
				description, description_text, status_id, priority,
				assignee_type, assignee_id, creator_id, position,
				start_date, due_date, estimate, closed_at,
				source_kind, triage_status, triage_snoozed_until, triage_declined_reason
			)
			VALUES (
				${args.workspaceId}, ${args.projectId}, ${args.number},
				${args.parentId}, ${args.cycleId}, ${args.milestoneId}, ${args.title},
				${descJson}, ${args.descriptionText}, ${args.statusId}, ${args.priority},
				${args.assigneeType}, ${args.assigneeId}, ${args.creatorId}, ${args.position},
				${args.startDate}::date, ${args.dueDate}::date, ${args.estimate}, ${args.closedAt}::timestamptz,
				${args.sourceKind ?? 'manual'}, ${args.triageStatus ?? 'none'},
				${args.triageSnoozedUntil ?? null}::timestamptz, ${args.triageDeclinedReason ?? null}
			)
			RETURNING
				id, workspace_id AS "workspaceId", project_id AS "projectId", ${args.projectKey}::text AS "projectKey",
				number, parent_id AS "parentId", cycle_id AS "cycleId", milestone_id AS "milestoneId", title, description,
				description_text AS "descriptionText", status_id AS "statusId", priority,
				assignee_type AS "assigneeType", assignee_id AS "assigneeId", creator_id AS "creatorId",
				position, start_date::text AS "startDate", due_date::text AS "dueDate",
				estimate::float8 AS estimate, triage_status AS "triageStatus",
			triage_snoozed_until::text AS "triageSnoozedUntil",
			triage_declined_reason AS "triageDeclinedReason",
			source_kind AS "sourceKind", closed_at::text AS "closedAt",
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
		readonly milestoneId: string | null
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
		readonly sourceKind?: string
		readonly triageStatus?: string
		readonly triageSnoozedUntil?: string | null
		readonly triageDeclinedReason?: string | null
	}
): Promise<IssueDto | null> {
	const descJson = args.description === null ? null : tx.json(args.description as never)
	const [row] = await tx<RawIssueRow[]>`
		UPDATE issues
		SET project_id = COALESCE(${args.projectId ?? null}::uuid, project_id),
			number = COALESCE(${args.number ?? null}::int, number),
			parent_id = ${args.parentId},
			cycle_id = ${args.cycleId},
			milestone_id = ${args.milestoneId},
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
			triage_status = COALESCE(${args.triageStatus ?? null}::text, triage_status),
			triage_snoozed_until = CASE WHEN ${args.triageSnoozedUntil !== undefined}
				THEN ${args.triageSnoozedUntil ?? null}::timestamptz ELSE triage_snoozed_until END,
			triage_declined_reason = CASE WHEN ${args.triageDeclinedReason !== undefined}
				THEN ${args.triageDeclinedReason ?? null}::text ELSE triage_declined_reason END,
			version = version + 1
		WHERE workspace_id = ${args.workspaceId}
			AND id = ${args.issueId}
			AND version = ${args.expectedVersion}
			AND deleted_at IS NULL
		RETURNING
			id, workspace_id AS "workspaceId", project_id AS "projectId", ${args.projectKey}::text AS "projectKey",
			number, parent_id AS "parentId", cycle_id AS "cycleId", milestone_id AS "milestoneId", title, description,
			description_text AS "descriptionText", status_id AS "statusId", priority,
			assignee_type AS "assigneeType", assignee_id AS "assigneeId", creator_id AS "creatorId",
			position, start_date::text AS "startDate", due_date::text AS "dueDate",
			estimate::float8 AS estimate, triage_status AS "triageStatus",
			triage_snoozed_until::text AS "triageSnoozedUntil",
			triage_declined_reason AS "triageDeclinedReason",
			source_kind AS "sourceKind", closed_at::text AS "closedAt",
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
			i.estimate::float8 AS estimate, i.triage_status AS "triageStatus",
			i.triage_snoozed_until::text AS "triageSnoozedUntil",
			i.triage_declined_reason AS "triageDeclinedReason",
			i.source_kind AS "sourceKind", i.closed_at::text AS "closedAt",
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

export async function softDeleteIssueCommentRow(
	tx: Queryable,
	args: { readonly workspaceId: string; readonly commentId: string }
): Promise<IssueCommentDto | null> {
	const rows = await tx<IssueCommentDto[]>`
		UPDATE issue_comments SET deleted_at = now()
		WHERE workspace_id = ${args.workspaceId} AND id = ${args.commentId} AND deleted_at IS NULL
		RETURNING
			id, workspace_id AS "workspaceId", issue_id AS "issueId",
			author_type AS "authorType", author_id AS "authorId",
			body, body_text AS "bodyText",
			created_at::text AS "createdAt", updated_at::text AS "updatedAt",
			deleted_at::text AS "deletedAt", version
	`
	return rows[0] ?? null
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
			owner_user_id AS "ownerUserId", name, layout, filters,
			filter_expr AS "filterExpr", display_options AS "displayOptions", sort,
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
			owner_user_id AS "ownerUserId", name, layout, filters,
			filter_expr AS "filterExpr", display_options AS "displayOptions", sort,
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
		readonly layout: 'list' | 'board' | 'timeline' | 'calendar' | 'table'
		readonly filters: Record<string, unknown>
		readonly filterExpr: unknown | null
		readonly displayOptions: Record<string, unknown>
		readonly sort: Record<string, unknown>
		readonly isShared: boolean
		readonly position: string
	}
): Promise<SavedViewDto> {
	const rows = args.id
		? await tx<SavedViewDto[]>`
			INSERT INTO saved_views (id, workspace_id, project_id, owner_user_id, name, layout, filters, filter_expr, display_options, sort, is_shared, position)
			VALUES (
				${args.id}, ${args.workspaceId}, ${args.projectId}, ${args.ownerUserId},
				${args.name}, ${args.layout}, ${tx.json(args.filters as never)},
				${args.filterExpr === null ? null : tx.json(args.filterExpr as never)},
				${tx.json(args.displayOptions as never)}, ${tx.json(args.sort as never)},
				${args.isShared}, ${args.position}
			)
			RETURNING
				id, workspace_id AS "workspaceId", project_id AS "projectId",
				owner_user_id AS "ownerUserId", name, layout, filters,
			filter_expr AS "filterExpr", display_options AS "displayOptions", sort,
				is_shared AS "isShared", position,
				created_at::text AS "createdAt", updated_at::text AS "updatedAt", version
		`
		: await tx<SavedViewDto[]>`
			INSERT INTO saved_views (workspace_id, project_id, owner_user_id, name, layout, filters, filter_expr, display_options, sort, is_shared, position)
			VALUES (
				${args.workspaceId}, ${args.projectId}, ${args.ownerUserId},
				${args.name}, ${args.layout}, ${tx.json(args.filters as never)},
				${args.filterExpr === null ? null : tx.json(args.filterExpr as never)},
				${tx.json(args.displayOptions as never)}, ${tx.json(args.sort as never)},
				${args.isShared}, ${args.position}
			)
			RETURNING
				id, workspace_id AS "workspaceId", project_id AS "projectId",
				owner_user_id AS "ownerUserId", name, layout, filters,
			filter_expr AS "filterExpr", display_options AS "displayOptions", sort,
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
		readonly layout: 'list' | 'board' | 'timeline' | 'calendar' | 'table'
		readonly filters: Record<string, unknown>
		readonly filterExpr: unknown | null
		readonly displayOptions: Record<string, unknown>
		readonly sort: Record<string, unknown>
		readonly isShared: boolean
	}
): Promise<SavedViewDto | null> {
	const [row] = await tx<SavedViewDto[]>`
		UPDATE saved_views
		SET name = ${args.name},
			layout = ${args.layout},
			filters = ${tx.json(args.filters as never)},
			filter_expr = ${args.filterExpr === null ? null : tx.json(args.filterExpr as never)},
			display_options = ${tx.json(args.displayOptions as never)},
			sort = ${tx.json(args.sort as never)},
			is_shared = ${args.isShared},
			version = version + 1
		WHERE workspace_id = ${args.workspaceId} AND id = ${args.viewId} AND version = ${args.expectedVersion}
		RETURNING
			id, workspace_id AS "workspaceId", project_id AS "projectId",
			owner_user_id AS "ownerUserId", name, layout, filters,
			filter_expr AS "filterExpr", display_options AS "displayOptions", sort,
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

// ---------- M7: FilterExpr query, triage queue, bulk ----------

type SqlFrag = ReturnType<Queryable>

export interface IssueFilterFragment {
	readonly where: SqlFrag
	readonly needsStatusJoin: boolean
}

export type IssueSortBy = 'position' | 'priority' | 'due_date' | 'updated_at' | 'created_at' | 'estimate'
export type IssueSortDir = 'asc' | 'desc'

function sortExpr(tx: Queryable, sortBy: IssueSortBy): SqlFrag {
	switch (sortBy) {
		case 'position':
			return tx`i.position COLLATE "C"`
		case 'priority':
			return tx`i.priority`
		case 'due_date':
			return tx`i.due_date`
		case 'updated_at':
			return tx`i.updated_at`
		case 'created_at':
			return tx`i.created_at`
		case 'estimate':
			return tx`i.estimate`
	}
}

function sortKeyExpr(tx: Queryable, sortBy: IssueSortBy): SqlFrag {
	switch (sortBy) {
		case 'position':
			return tx`i.position`
		case 'priority':
			return tx`i.priority`
		case 'due_date':
			return tx`i.due_date::text`
		case 'updated_at':
			return tx`i.updated_at::text`
		case 'created_at':
			return tx`i.created_at::text`
		case 'estimate':
			return tx`i.estimate::float8`
	}
}

function cursorVal(tx: Queryable, sortBy: IssueSortBy, k: string | number): SqlFrag {
	switch (sortBy) {
		case 'priority':
			return tx`${k}::int`
		case 'due_date':
			return tx`${k}::date`
		case 'updated_at':
		case 'created_at':
			return tx`${k}::timestamptz`
		case 'estimate':
			return tx`${k}::float8`
		default:
			return tx`${k}`
	}
}

/**
 * FilterExpr-driven issue listing for POST /issues/query. Keyset-paginates on
 * (sortExpr, id) with explicit NULLS LAST/FIRST so the cursor stays stable.
 */
export async function queryIssuesExpr(
	tx: Queryable,
	args: {
		readonly workspaceId: string
		readonly visibleProjectIds: readonly string[]
		readonly filter?: IssueFilterFragment | undefined
		readonly sortBy: IssueSortBy
		readonly sortDir: IssueSortDir
		readonly cursor?: { readonly k: string | number | null; readonly id: string } | undefined
		readonly limit: number
	}
): Promise<{ readonly items: IssueDto[]; readonly hasMore: boolean }> {
	if (args.visibleProjectIds.length === 0) return { items: [], hasMore: false }
	const expr = sortExpr(tx, args.sortBy)
	const keyExpr = sortKeyExpr(tx, args.sortBy)
	const cur = args.cursor
	const cursorFrag = !cur
		? tx``
		: args.sortDir === 'asc'
			? cur.k === null
				? tx`AND ${expr} IS NULL AND i.id > ${cur.id}::uuid`
				: tx`AND (${expr} > ${cursorVal(tx, args.sortBy, cur.k)} OR ${expr} IS NULL OR (${expr} = ${cursorVal(tx, args.sortBy, cur.k)} AND i.id > ${cur.id}::uuid))`
			: cur.k === null
				? tx`AND ${expr} IS NOT NULL`
				: tx`AND ((${expr} < ${cursorVal(tx, args.sortBy, cur.k)} AND ${expr} IS NOT NULL) OR (${expr} = ${cursorVal(tx, args.sortBy, cur.k)} AND i.id > ${cur.id}::uuid))`

	const rows = await tx<(RawIssueRow & { sortKey: string | number | null })[]>`
		SELECT
			i.id,
			i.workspace_id AS "workspaceId",
			i.project_id AS "projectId",
			p.key AS "projectKey",
			i.number,
			i.parent_id AS "parentId",
			i.cycle_id AS "cycleId",
			i.milestone_id AS "milestoneId",
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
			i.triage_status AS "triageStatus",
			i.triage_snoozed_until::text AS "triageSnoozedUntil",
			i.triage_declined_reason AS "triageDeclinedReason",
			i.source_kind AS "sourceKind",
			i.closed_at::text AS "closedAt",
			i.created_at::text AS "createdAt",
			i.updated_at::text AS "updatedAt",
			i.deleted_at::text AS "deletedAt",
			i.version,
			${keyExpr} AS "sortKey"
		FROM issues i
		JOIN projects p ON p.workspace_id = i.workspace_id AND p.id = i.project_id
		${args.filter?.needsStatusJoin ? tx`LEFT JOIN project_statuses s ON s.workspace_id = i.workspace_id AND s.id = i.status_id` : tx``}
		WHERE i.workspace_id = ${args.workspaceId}
			AND i.deleted_at IS NULL
			AND i.project_id = ANY(${[...args.visibleProjectIds]}::uuid[])
			${args.filter ? tx`AND (${args.filter.where})` : tx``}
			${cursorFrag}
		ORDER BY ${expr} ${args.sortDir === 'asc' ? tx`ASC NULLS LAST` : tx`DESC NULLS FIRST`}, i.id ASC
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
		items: sliced.map((r) => ({
			...toIssueDto(r, labelMap.get(r.id) ?? []),
			// sortKey is stashed on the DTO so the service can build the cursor.
			sortKey: r.sortKey
		})),
		hasMore
	}
}

export async function listTriageQueueRows(
	tx: Queryable,
	args: {
		readonly workspaceId: string
		readonly projectId: string
		readonly state: 'pending' | 'snoozed' | 'resolved'
		readonly limit: number
	}
): Promise<IssueDto[]> {
	const stateFrag =
		args.state === 'resolved'
			? tx`i.triage_status IN ('accepted', 'declined', 'merged')
				AND i.updated_at > now() - interval '30 days'`
			: args.state === 'snoozed'
				? tx`i.triage_status = 'snoozed'`
				: tx`i.triage_status = 'pending'`
	const rows = await tx<RawIssueRow[]>`
		SELECT
			i.id,
			i.workspace_id AS "workspaceId",
			i.project_id AS "projectId",
			p.key AS "projectKey",
			i.number,
			i.parent_id AS "parentId",
			i.cycle_id AS "cycleId",
			i.milestone_id AS "milestoneId",
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
			i.triage_status AS "triageStatus",
			i.triage_snoozed_until::text AS "triageSnoozedUntil",
			i.triage_declined_reason AS "triageDeclinedReason",
			i.source_kind AS "sourceKind",
			i.closed_at::text AS "closedAt",
			i.created_at::text AS "createdAt",
			i.updated_at::text AS "updatedAt",
			i.deleted_at::text AS "deletedAt",
			i.version
		FROM issues i
		JOIN projects p ON p.workspace_id = i.workspace_id AND p.id = i.project_id
		WHERE i.workspace_id = ${args.workspaceId}
			AND i.project_id = ${args.projectId}
			AND i.deleted_at IS NULL
			AND ${stateFrag}
		ORDER BY i.created_at ASC, i.id ASC
		LIMIT ${args.limit}
	`
	const labelMap = await getLabelMapForIssues(
		tx,
		args.workspaceId,
		rows.map((r) => r.id)
	)
	return rows.map((r) => toIssueDto(r, labelMap.get(r.id) ?? []))
}

/**
 * Workspaces with snoozed issues past their wake time — for the 60s sweep.
 * Called under `withSystem`, so it goes through the SECURITY DEFINER
 * function (0021) rather than a tenant-scoped query.
 */
export async function listWorkspacesWithSnoozedDue(
	tx: Queryable,
	now: string
): Promise<{ readonly workspaceId: string }[]> {
	return tx<{ workspaceId: string }[]>`
		SELECT workspace_id AS "workspaceId"
		FROM list_workspaces_with_snoozed_triage(${now}::timestamptz)
	`
}

/** Flips due snoozed issues back to pending; idempotent, capped batch. */
export async function wakeSnoozedIssues(
	tx: Queryable,
	workspaceId: string,
	now: string,
	limit = 500
): Promise<RawIssueRow[]> {
	return tx<RawIssueRow[]>`
		WITH due AS (
			SELECT i.id, p.key AS project_key
			FROM issues i
			JOIN projects p ON p.workspace_id = i.workspace_id AND p.id = i.project_id
			WHERE i.workspace_id = ${workspaceId}
				AND i.triage_status = 'snoozed'
				AND i.triage_snoozed_until IS NOT NULL
				AND i.triage_snoozed_until <= ${now}::timestamptz
				AND i.deleted_at IS NULL
			ORDER BY i.triage_snoozed_until ASC, i.id ASC
			LIMIT ${limit}
			FOR UPDATE OF i SKIP LOCKED
		)
		UPDATE issues i
		SET triage_status = 'pending',
			triage_snoozed_until = NULL,
			version = i.version + 1
		FROM due
		WHERE i.workspace_id = ${workspaceId} AND i.id = due.id
		RETURNING
			i.id,
			i.workspace_id AS "workspaceId",
			i.project_id AS "projectId",
			due.project_key AS "projectKey",
			i.number,
			i.parent_id AS "parentId",
			i.cycle_id AS "cycleId",
			i.milestone_id AS "milestoneId",
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
			i.triage_status AS "triageStatus",
			i.triage_snoozed_until::text AS "triageSnoozedUntil",
			i.triage_declined_reason AS "triageDeclinedReason",
			i.source_kind AS "sourceKind",
			i.closed_at::text AS "closedAt",
			i.created_at::text AS "createdAt",
			i.updated_at::text AS "updatedAt",
			i.deleted_at::text AS "deletedAt",
			i.version
	`
}

/** Locks the requested issues (id-ordered to avoid deadlocks). */
export async function lockIssuesByIds(
	tx: Queryable,
	args: {
		readonly workspaceId: string
		readonly issueIds: readonly string[]
		readonly includeDeleted?: boolean
	}
): Promise<RawIssueRow[]> {
	return tx<RawIssueRow[]>`
		SELECT
			i.id,
			i.workspace_id AS "workspaceId",
			i.project_id AS "projectId",
			p.key AS "projectKey",
			i.number,
			i.parent_id AS "parentId",
			i.cycle_id AS "cycleId",
			i.milestone_id AS "milestoneId",
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
			i.triage_status AS "triageStatus",
			i.triage_snoozed_until::text AS "triageSnoozedUntil",
			i.triage_declined_reason AS "triageDeclinedReason",
			i.source_kind AS "sourceKind",
			i.closed_at::text AS "closedAt",
			i.created_at::text AS "createdAt",
			i.updated_at::text AS "updatedAt",
			i.deleted_at::text AS "deletedAt",
			i.version
		FROM issues i
		JOIN projects p ON p.workspace_id = i.workspace_id AND p.id = i.project_id
		WHERE i.workspace_id = ${args.workspaceId}
			AND i.id = ANY(${[...args.issueIds]}::uuid[])
			${args.includeDeleted ? tx`` : tx`AND i.deleted_at IS NULL`}
		ORDER BY i.id ASC
		FOR UPDATE OF i
	`
}

/**
 * One set-based UPDATE for the uniform bulk patch (status / priority /
 * assignee / cycle). All patched issues must share the project when statusId
 * or cycleId is set — enforced by the service.
 */
export async function updateIssuesSetColumns(
	tx: Queryable,
	args: {
		readonly workspaceId: string
		readonly issueIds: readonly string[]
		readonly statusId?: string | undefined
		readonly closedAt?: string | null | undefined
		readonly priority?: number | undefined
		readonly setAssignee?: boolean | undefined
		readonly assigneeType?: string | null | undefined
		readonly assigneeId?: string | null | undefined
		readonly setCycle?: boolean | undefined
		readonly cycleId?: string | null | undefined
	}
): Promise<RawIssueRow[]> {
	return tx<RawIssueRow[]>`
		UPDATE issues i
		SET status_id = COALESCE(${args.statusId ?? null}::uuid, i.status_id),
			closed_at = CASE WHEN ${args.statusId !== undefined}
				THEN ${args.closedAt ?? null}::timestamptz ELSE i.closed_at END,
			priority = COALESCE(${args.priority ?? null}::int, i.priority),
			assignee_type = CASE WHEN ${args.setAssignee === true}
				THEN ${args.assigneeType ?? null}::text ELSE i.assignee_type END,
			assignee_id = CASE WHEN ${args.setAssignee === true}
				THEN ${args.assigneeId ?? null}::uuid ELSE i.assignee_id END,
			cycle_id = CASE WHEN ${args.setCycle === true}
				THEN ${args.cycleId ?? null}::uuid ELSE i.cycle_id END,
			version = i.version + 1
		FROM projects p
		WHERE i.workspace_id = ${args.workspaceId}
			AND i.id = ANY(${[...args.issueIds]}::uuid[])
			AND i.deleted_at IS NULL
			AND p.workspace_id = i.workspace_id AND p.id = i.project_id
		RETURNING
			i.id,
			i.workspace_id AS "workspaceId",
			i.project_id AS "projectId",
			p.key AS "projectKey",
			i.number,
			i.parent_id AS "parentId",
			i.cycle_id AS "cycleId",
			i.milestone_id AS "milestoneId",
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
			i.triage_status AS "triageStatus",
			i.triage_snoozed_until::text AS "triageSnoozedUntil",
			i.triage_declined_reason AS "triageDeclinedReason",
			i.source_kind AS "sourceKind",
			i.closed_at::text AS "closedAt",
			i.created_at::text AS "createdAt",
			i.updated_at::text AS "updatedAt",
			i.deleted_at::text AS "deletedAt",
			i.version
	`
}

export async function addIssueLabelsToMany(
	tx: Queryable,
	workspaceId: string,
	issueIds: readonly string[],
	labelIds: readonly string[]
): Promise<void> {
	if (labelIds.length === 0) return
	await tx`
		INSERT INTO issue_labels (workspace_id, issue_id, label_id)
		SELECT ${workspaceId}, ii, ll
		FROM unnest(${[...issueIds]}::uuid[]) ii
		CROSS JOIN unnest(${[...labelIds]}::uuid[]) ll
		ON CONFLICT (workspace_id, issue_id, label_id) DO NOTHING
	`
}

export async function removeIssueLabelsFromMany(
	tx: Queryable,
	workspaceId: string,
	issueIds: readonly string[],
	labelIds: readonly string[]
): Promise<void> {
	if (labelIds.length === 0) return
	await tx`
		DELETE FROM issue_labels
		WHERE workspace_id = ${workspaceId}
			AND issue_id = ANY(${[...issueIds]}::uuid[])
			AND label_id = ANY(${[...labelIds]}::uuid[])
	`
}

/** Replaces the label set for each issue in one delete + one multi-row insert. */
export async function replaceIssueLabelsForMany(
	tx: Queryable,
	workspaceId: string,
	pairs: readonly { readonly issueId: string; readonly labelId: string }[]
): Promise<void> {
	const issueIds = [...new Set(pairs.map((p) => p.issueId))]
	if (issueIds.length === 0) return
	await tx`
		DELETE FROM issue_labels
		WHERE workspace_id = ${workspaceId} AND issue_id = ANY(${issueIds}::uuid[])
	`
	if (pairs.length === 0) return
	await tx`
		INSERT INTO issue_labels (workspace_id, issue_id, label_id)
		SELECT ${workspaceId}, p.iid, p.lid
		FROM unnest(${pairs.map((p) => p.issueId)}::uuid[], ${pairs.map((p) => p.labelId)}::uuid[]) AS p(iid, lid)
		ON CONFLICT (workspace_id, issue_id, label_id) DO NOTHING
	`
}

/** Soft-deletes a set of issues in one UPDATE; used by bulk delete. */
export async function softDeleteIssuesRows(
	tx: Queryable,
	workspaceId: string,
	issueIds: readonly string[]
): Promise<RawIssueRow[]> {
	return tx<RawIssueRow[]>`
		UPDATE issues i
		SET deleted_at = now(), version = i.version + 1
		FROM projects p
		WHERE i.workspace_id = ${workspaceId}
			AND i.id = ANY(${[...issueIds]}::uuid[])
			AND i.deleted_at IS NULL
			AND p.workspace_id = i.workspace_id AND p.id = i.project_id
		RETURNING
			i.id,
			i.workspace_id AS "workspaceId",
			i.project_id AS "projectId",
			p.key AS "projectKey",
			i.number,
			i.parent_id AS "parentId",
			i.cycle_id AS "cycleId",
			i.milestone_id AS "milestoneId",
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
			i.triage_status AS "triageStatus",
			i.triage_snoozed_until::text AS "triageSnoozedUntil",
			i.triage_declined_reason AS "triageDeclinedReason",
			i.source_kind AS "sourceKind",
			i.closed_at::text AS "closedAt",
			i.created_at::text AS "createdAt",
			i.updated_at::text AS "updatedAt",
			i.deleted_at::text AS "deletedAt",
			i.version
	`
}

/** Restore-applies per-issue snapshots in one UPDATE ... FROM unnest. */
export async function restoreIssueRows(
	tx: Queryable,
	args: {
		readonly workspaceId: string
		readonly items: readonly {
			readonly id: string
			readonly statusId: string
			readonly priority: number
			readonly assigneeType: string | null
			readonly assigneeId: string | null
			readonly cycleId: string | null
			readonly projectKey: string
		}[]
	}
): Promise<RawIssueRow[]> {
	const { items, workspaceId } = args
	if (items.length === 0) return []
	return tx<RawIssueRow[]>`
		UPDATE issues i
		SET status_id = v.status_id,
			priority = v.priority,
			assignee_type = v.assignee_type,
			assignee_id = v.assignee_id,
			cycle_id = v.cycle_id,
			deleted_at = NULL,
			closed_at = CASE WHEN s.category IN ('completed', 'cancelled')
				THEN COALESCE(i.closed_at, now()) ELSE NULL END,
			version = i.version + 1
		FROM unnest(
			${items.map((it) => it.id)}::uuid[],
			${items.map((it) => it.statusId)}::uuid[],
			${items.map((it) => it.priority)}::int[],
			${items.map((it) => it.assigneeType)}::text[],
			${items.map((it) => it.assigneeId)}::uuid[],
			${items.map((it) => it.cycleId)}::uuid[],
			${items.map((it) => it.projectKey)}::text[]
		) AS v(id, status_id, priority, assignee_type, assignee_id, cycle_id, project_key)
		JOIN project_statuses s ON s.workspace_id = ${workspaceId} AND s.id = v.status_id
		WHERE i.workspace_id = ${workspaceId} AND i.id = v.id
		RETURNING
			i.id,
			i.workspace_id AS "workspaceId",
			i.project_id AS "projectId",
			v.project_key AS "projectKey",
			i.number,
			i.parent_id AS "parentId",
			i.cycle_id AS "cycleId",
			i.milestone_id AS "milestoneId",
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
			i.triage_status AS "triageStatus",
			i.triage_snoozed_until::text AS "triageSnoozedUntil",
			i.triage_declined_reason AS "triageDeclinedReason",
			i.source_kind AS "sourceKind",
			i.closed_at::text AS "closedAt",
			i.created_at::text AS "createdAt",
			i.updated_at::text AS "updatedAt",
			i.deleted_at::text AS "deletedAt",
			i.version
	`
}

/** Batched outbox insert — one multi-row INSERT for all per-issue events. */
export async function emitTasksEvents(
	tx: Queryable,
	workspaceId: string,
	events: readonly {
		readonly aggregate: string
		readonly aggregateId: string
		readonly eventType: string
		readonly payload: Record<string, unknown>
	}[]
): Promise<void> {
	if (events.length === 0) return
	await tx`
		INSERT INTO outbox (workspace_id, aggregate, aggregate_id, event_type, payload)
		SELECT ${workspaceId}, a.aggregate, a.aggregate_id, a.event_type, p.pl
		FROM unnest(
			${events.map((e) => e.aggregate)}::text[],
			${events.map((e) => e.aggregateId)}::uuid[],
			${events.map((e) => e.eventType)}::text[]
		) WITH ORDINALITY AS a(aggregate, aggregate_id, event_type, ord)
		JOIN jsonb_array_elements(${tx.json(events.map((e) => e.payload) as never)}) WITH ORDINALITY AS p(pl, ord)
			ON p.ord = a.ord
	`
}

/** FTS candidates for triage duplicate-suggestions (§3.1). */
export async function searchSimilarIssues(
	tx: Queryable,
	args: {
		readonly workspaceId: string
		readonly projectIds: readonly string[]
		readonly excludeIssueId: string
		readonly queryText: string
		readonly limit: number
	}
): Promise<
	{
		readonly id: string
		readonly identifier: string
		readonly title: string
		readonly statusCategory: string
		readonly rank: number
	}[]
> {
	return tx<{ id: string; identifier: string; title: string; statusCategory: string; rank: number }[]>`
		SELECT
			i.id,
			p.key || '-' || i.number AS identifier,
			i.title,
			COALESCE(s.category, 'unstarted') AS "statusCategory",
			ts_rank_cd(
				to_tsvector('english', i.title || ' ' || i.description_text),
				websearch_to_tsquery('english', ${args.queryText})
			)::float8 AS rank
		FROM issues i
		JOIN projects p ON p.workspace_id = i.workspace_id AND p.id = i.project_id
		LEFT JOIN project_statuses s ON s.workspace_id = i.workspace_id AND s.id = i.status_id
		WHERE i.workspace_id = ${args.workspaceId}
			AND i.deleted_at IS NULL
			AND i.id <> ${args.excludeIssueId}::uuid
			AND i.triage_status NOT IN ('declined', 'merged')
			AND i.project_id = ANY(${[...args.projectIds]}::uuid[])
			AND to_tsvector('english', i.title || ' ' || i.description_text)
				@@ websearch_to_tsquery('english', ${args.queryText})
		ORDER BY rank DESC, i.id ASC
		LIMIT ${args.limit}
	`
}

/** Idempotent duplicates-link insert for triage merge (§3.1). */
export async function ensureIssueRelationRow(
	tx: Queryable,
	args: {
		readonly workspaceId: string
		readonly sourceIssueId: string
		readonly targetIssueId: string
		readonly kind: IssueRelationDto['kind']
		readonly createdBy: string
	}
): Promise<void> {
	await tx`
		INSERT INTO issue_relations (workspace_id, source_issue_id, target_issue_id, kind, created_by)
		VALUES (${args.workspaceId}, ${args.sourceIssueId}, ${args.targetIssueId}, ${args.kind}, ${args.createdBy})
		ON CONFLICT (workspace_id, source_issue_id, target_issue_id, kind) DO NOTHING
	`
}

// ---------- M7: Cycle maintenance engine (§3.3) ----------

/**
 * Projects with the cycle engine enabled — for the nightly sweep. Called
 * under `withSystem`, so it goes through the SECURITY DEFINER function
 * (0022) rather than a tenant-scoped query.
 */
export async function listCycleMaintenanceProjects(
	tx: Queryable
): Promise<{ readonly workspaceId: string; readonly projectId: string }[]> {
	return tx<{ workspaceId: string; projectId: string }[]>`
		SELECT workspace_id AS "workspaceId", project_id AS "projectId"
		FROM list_cycle_maintenance_projects()
	`
}

/** All cycles of a project in chronological order — the maintenance input. */
export async function listProjectCyclesAscending(
	tx: Queryable,
	workspaceId: string,
	projectId: string
): Promise<CycleDto[]> {
	return tx<CycleDto[]>`
		SELECT
			id, workspace_id AS "workspaceId", project_id AS "projectId",
			name, description, status,
			starts_at::text AS "startsAt", ends_at::text AS "endsAt",
			created_at::text AS "createdAt", updated_at::text AS "updatedAt", version
		FROM cycles
		WHERE workspace_id = ${workspaceId} AND project_id = ${projectId}
		ORDER BY starts_at ASC, id ASC
	`
}

/**
 * Guarded status flip — the WHERE clause on `status` makes the transition
 * idempotent (a second run matches nothing and returns null).
 */
export async function transitionCycleStatus(
	tx: Queryable,
	args: {
		readonly workspaceId: string
		readonly cycleId: string
		readonly fromStatus: CycleDto['status']
		readonly toStatus: CycleDto['status']
	}
): Promise<CycleDto | null> {
	const [row] = await tx<CycleDto[]>`
		UPDATE cycles
		SET status = ${args.toStatus}, version = version + 1
		WHERE workspace_id = ${args.workspaceId}
			AND id = ${args.cycleId}
			AND status = ${args.fromStatus}
		RETURNING
			id, workspace_id AS "workspaceId", project_id AS "projectId",
			name, description, status,
			starts_at::text AS "startsAt", ends_at::text AS "endsAt",
			created_at::text AS "createdAt", updated_at::text AS "updatedAt", version
	`
	return row ?? null
}

/**
 * Set-based rollover: every non-deleted issue of `cycleId` whose status
 * category is NOT completed/cancelled moves to `targetCycleId` (null = the
 * backlog). One UPDATE, full rows back for change_log payloads.
 */
export async function rolloverCycleIssues(
	tx: Queryable,
	args: {
		readonly workspaceId: string
		readonly cycleId: string
		readonly targetCycleId: string | null
	}
): Promise<RawIssueRow[]> {
	return tx<RawIssueRow[]>`
		UPDATE issues i
		SET cycle_id = ${args.targetCycleId}::uuid,
			version = i.version + 1
		FROM projects p
		WHERE i.workspace_id = ${args.workspaceId}
			AND i.cycle_id = ${args.cycleId}
			AND i.deleted_at IS NULL
			AND p.workspace_id = i.workspace_id AND p.id = i.project_id
			AND i.status_id IN (
				SELECT s.id FROM project_statuses s
				WHERE s.workspace_id = ${args.workspaceId}
					AND s.project_id = i.project_id
					AND s.category NOT IN ('completed', 'cancelled')
			)
		RETURNING
			i.id,
			i.workspace_id AS "workspaceId",
			i.project_id AS "projectId",
			p.key AS "projectKey",
			i.number,
			i.parent_id AS "parentId",
			i.cycle_id AS "cycleId",
			i.milestone_id AS "milestoneId",
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
			i.triage_status AS "triageStatus",
			i.triage_snoozed_until::text AS "triageSnoozedUntil",
			i.triage_declined_reason AS "triageDeclinedReason",
			i.source_kind AS "sourceKind",
			i.closed_at::text AS "closedAt",
			i.created_at::text AS "createdAt",
			i.updated_at::text AS "updatedAt",
			i.deleted_at::text AS "deletedAt",
			i.version
	`
}

/** Count of all cycles in a project — the base for `Cycle <n>` naming. */
export async function countProjectCycles(
	tx: Queryable,
	workspaceId: string,
	projectId: string
): Promise<number> {
	const [row] = await tx<{ n: number }[]>`
		SELECT count(*)::int AS n
		FROM cycles
		WHERE workspace_id = ${workspaceId} AND project_id = ${projectId}
	`
	return row?.n ?? 0
}

export interface CycleScopeCounts {
	readonly totalIssues: number
	readonly completedIssues: number
	readonly startedIssues: number
	readonly cancelledIssues: number
	readonly totalEstimate: number
	readonly completedEstimate: number
}

/** One grouped scope query over the cycle's non-deleted issues (§3.3). */
export async function cycleScopeCounts(
	tx: Queryable,
	workspaceId: string,
	cycleId: string
): Promise<CycleScopeCounts> {
	const [row] = await tx<CycleScopeCounts[]>`
		SELECT
			count(*)::int AS "totalIssues",
			count(*) FILTER (WHERE s.category = 'completed')::int AS "completedIssues",
			count(*) FILTER (WHERE s.category = 'started')::int AS "startedIssues",
			count(*) FILTER (WHERE s.category = 'cancelled')::int AS "cancelledIssues",
			COALESCE(sum(i.estimate), 0)::float8 AS "totalEstimate",
			COALESCE(sum(i.estimate) FILTER (WHERE s.category = 'completed'), 0)::float8 AS "completedEstimate"
		FROM issues i
		JOIN project_statuses s ON s.workspace_id = i.workspace_id AND s.id = i.status_id
		WHERE i.workspace_id = ${workspaceId}
			AND i.cycle_id = ${cycleId}
			AND i.deleted_at IS NULL
	`
	return (
		row ?? {
			totalIssues: 0,
			completedIssues: 0,
			startedIssues: 0,
			cancelledIssues: 0,
			totalEstimate: 0,
			completedEstimate: 0
		}
	)
}

/** total_issues of the most recent snapshot strictly before `beforeDate`. */
export async function priorSnapshotTotalIssues(
	tx: Queryable,
	workspaceId: string,
	cycleId: string,
	beforeDate: string
): Promise<number | null> {
	const [row] = await tx<{ totalIssues: number }[]>`
		SELECT total_issues AS "totalIssues"
		FROM cycle_daily_snapshots
		WHERE workspace_id = ${workspaceId}
			AND cycle_id = ${cycleId}
			AND snapshot_date < ${beforeDate}::date
		ORDER BY snapshot_date DESC
		LIMIT 1
	`
	return row?.totalIssues ?? null
}

/**
 * Snapshot upsert keyed on (workspace_id, cycle_id, snapshot_date). The DO
 * UPDATE WHERE clause skips no-op rewrites, so a second identical run writes
 * nothing and RETURNING yields zero rows — that is the idempotency signal.
 */
export async function upsertCycleSnapshotRow(
	tx: Queryable,
	args: {
		readonly workspaceId: string
		readonly cycleId: string
		readonly snapshotDate: string
		readonly totalIssues: number
		readonly completedIssues: number
		readonly startedIssues: number
		readonly cancelledIssues: number
		readonly totalEstimate: number
		readonly completedEstimate: number
		readonly scopeAddedCount: number
		readonly scopeRemovedCount: number
	}
): Promise<boolean> {
	const rows = await tx<{ cycleId: string }[]>`
		INSERT INTO cycle_daily_snapshots (
			workspace_id, cycle_id, snapshot_date,
			total_issues, completed_issues, started_issues, cancelled_issues,
			total_estimate, completed_estimate, scope_added_count, scope_removed_count
		) VALUES (
			${args.workspaceId}, ${args.cycleId}, ${args.snapshotDate}::date,
			${args.totalIssues}, ${args.completedIssues}, ${args.startedIssues}, ${args.cancelledIssues},
			${args.totalEstimate}, ${args.completedEstimate}, ${args.scopeAddedCount}, ${args.scopeRemovedCount}
		)
		ON CONFLICT (workspace_id, cycle_id, snapshot_date) DO UPDATE SET
			total_issues = excluded.total_issues,
			completed_issues = excluded.completed_issues,
			started_issues = excluded.started_issues,
			cancelled_issues = excluded.cancelled_issues,
			total_estimate = excluded.total_estimate,
			completed_estimate = excluded.completed_estimate,
			scope_added_count = excluded.scope_added_count,
			scope_removed_count = excluded.scope_removed_count
		WHERE
			cycle_daily_snapshots.total_issues IS DISTINCT FROM excluded.total_issues
			OR cycle_daily_snapshots.completed_issues IS DISTINCT FROM excluded.completed_issues
			OR cycle_daily_snapshots.started_issues IS DISTINCT FROM excluded.started_issues
			OR cycle_daily_snapshots.cancelled_issues IS DISTINCT FROM excluded.cancelled_issues
			OR cycle_daily_snapshots.total_estimate IS DISTINCT FROM excluded.total_estimate
			OR cycle_daily_snapshots.completed_estimate IS DISTINCT FROM excluded.completed_estimate
			OR cycle_daily_snapshots.scope_added_count IS DISTINCT FROM excluded.scope_added_count
			OR cycle_daily_snapshots.scope_removed_count IS DISTINCT FROM excluded.scope_removed_count
		RETURNING cycle_id AS "cycleId"
	`
	return rows.length > 0
}

/** Snapshot rows of one cycle ascending by date — the burnup chart series. */
export async function listCycleSnapshotRows(
	tx: Queryable,
	workspaceId: string,
	cycleId: string
): Promise<CycleDailySnapshotDto[]> {
	return tx<CycleDailySnapshotDto[]>`
		SELECT
			workspace_id AS "workspaceId",
			cycle_id AS "cycleId",
			snapshot_date::text AS "snapshotDate",
			total_issues AS "totalIssues",
			completed_issues AS "completedIssues",
			started_issues AS "startedIssues",
			cancelled_issues AS "cancelledIssues",
			total_estimate::float8 AS "totalEstimate",
			completed_estimate::float8 AS "completedEstimate",
			scope_added_count AS "scopeAddedCount",
			scope_removed_count AS "scopeRemovedCount",
			created_at::text AS "createdAt"
		FROM cycle_daily_snapshots
		WHERE workspace_id = ${workspaceId} AND cycle_id = ${cycleId}
		ORDER BY snapshot_date ASC
	`
}
