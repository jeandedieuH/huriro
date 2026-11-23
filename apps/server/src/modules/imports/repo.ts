import type { ImportJobDto, ImportSource } from '@huriro/contracts'
import type { Queryable } from '@huriro/db'

export async function insertImportJobRow(
	tx: Queryable,
	args: {
		readonly workspaceId: string
		readonly source: ImportSource
		readonly status: ImportJobDto['status']
		readonly targetProjectId: string | null
		readonly createdBy: string
		readonly config: Record<string, unknown>
		readonly preview: Record<string, unknown>
	}
): Promise<ImportJobDto> {
	const [row] = await tx<ImportJobDto[]>`
		INSERT INTO import_jobs (
			workspace_id, source, status, target_project_id, created_by, config, preview
		)
		VALUES (
			${args.workspaceId},
			${args.source},
			${args.status},
			${args.targetProjectId},
			${args.createdBy},
			${tx.json(args.config as never)},
			${tx.json(args.preview as never)}
		)
		RETURNING
			id,
			workspace_id AS "workspaceId",
			source,
			status,
			target_project_id AS "targetProjectId",
			preview,
			report,
			created_at::text AS "createdAt",
			updated_at::text AS "updatedAt",
			completed_at::text AS "completedAt",
			version
	`
	if (!row) throw new Error('Failed to insert import_job')
	return row
}

export async function getImportJobById(
	tx: Queryable,
	workspaceId: string,
	jobId: string
): Promise<(ImportJobDto & { config: Record<string, unknown> }) | null> {
	const [row] = await tx<(ImportJobDto & { config: Record<string, unknown> })[]>`
		SELECT
			id,
			workspace_id AS "workspaceId",
			source,
			status,
			target_project_id AS "targetProjectId",
			config,
			preview,
			report,
			created_at::text AS "createdAt",
			updated_at::text AS "updatedAt",
			completed_at::text AS "completedAt",
			version
		FROM import_jobs
		WHERE workspace_id = ${workspaceId} AND id = ${jobId}
	`
	return row ?? null
}

export async function listImportJobsForWorkspace(
	tx: Queryable,
	workspaceId: string
): Promise<ImportJobDto[]> {
	return tx<ImportJobDto[]>`
		SELECT
			id,
			workspace_id AS "workspaceId",
			source,
			status,
			target_project_id AS "targetProjectId",
			preview,
			report,
			created_at::text AS "createdAt",
			updated_at::text AS "updatedAt",
			completed_at::text AS "completedAt",
			version
		FROM import_jobs
		WHERE workspace_id = ${workspaceId}
		ORDER BY created_at DESC
		LIMIT 50
	`
}

export async function markImportJobCompleted(
	tx: Queryable,
	args: {
		readonly workspaceId: string
		readonly jobId: string
		readonly targetProjectId: string | null
		readonly report: Record<string, unknown>
	}
): Promise<ImportJobDto> {
	const [row] = await tx<ImportJobDto[]>`
		UPDATE import_jobs
		SET status = 'completed',
			target_project_id = ${args.targetProjectId},
			report = ${tx.json(args.report as never)},
			completed_at = now(),
			version = version + 1
		WHERE workspace_id = ${args.workspaceId} AND id = ${args.jobId}
		RETURNING
			id,
			workspace_id AS "workspaceId",
			source,
			status,
			target_project_id AS "targetProjectId",
			preview,
			report,
			created_at::text AS "createdAt",
			updated_at::text AS "updatedAt",
			completed_at::text AS "completedAt",
			version
	`
	if (!row) throw new Error('Failed to update import_job')
	return row
}

export async function findMappedRemoteIds(
	tx: Queryable,
	workspaceId: string,
	source: ImportSource,
	remoteType: 'issue' | 'comment' | 'doc_page' | 'channel' | 'message'
): Promise<Map<string, string>> {
	const rows = await tx<{ remoteId: string; localId: string }[]>`
		SELECT remote_id AS "remoteId", local_id AS "localId"
		FROM import_mappings
		WHERE workspace_id = ${workspaceId}
			AND source = ${source}
			AND remote_type = ${remoteType}
	`
	return new Map(rows.map((r) => [r.remoteId, r.localId]))
}

export async function insertImportMapping(
	tx: Queryable,
	args: {
		readonly workspaceId: string
		readonly importJobId: string
		readonly source: ImportSource
		readonly remoteType:
			| 'project'
			| 'issue'
			| 'comment'
			| 'label'
			| 'cycle'
			| 'status'
			| 'doc_page'
			| 'channel'
			| 'message'
		readonly remoteId: string
		readonly remoteIdentifier: string | null
		readonly remoteUrl: string | null
		readonly localType: string
		readonly localId: string
	}
): Promise<void> {
	await tx`
		INSERT INTO import_mappings (
			workspace_id, import_job_id, source, remote_type,
			remote_id, remote_identifier, remote_url, local_type, local_id
		)
		VALUES (
			${args.workspaceId}, ${args.importJobId}, ${args.source}, ${args.remoteType},
			${args.remoteId}, ${args.remoteIdentifier}, ${args.remoteUrl}, ${args.localType}, ${args.localId}
		)
		ON CONFLICT (workspace_id, source, remote_type, remote_id) DO NOTHING
	`
}

export async function findMappingByRemoteIdentifier(
	tx: Queryable,
	workspaceId: string,
	identifier: string
): Promise<{
	readonly remoteIdentifier: string
	readonly localType: string
	readonly localId: string
} | null> {
	const [row] = await tx<{ remoteIdentifier: string; localType: string; localId: string }[]>`
		SELECT remote_identifier AS "remoteIdentifier", local_type AS "localType", local_id AS "localId"
		FROM import_mappings
		WHERE workspace_id = ${workspaceId}
			AND upper(remote_identifier) = upper(${identifier})
		ORDER BY created_at DESC
		LIMIT 1
	`
	return row ?? null
}
