import type {
	GithubInstallationDto,
	GithubSourceOfTruth,
	GithubSyncState,
	IssueGithubLinkDto
} from '@huriro/contracts'
import type { Queryable } from '@huriro/db'

export interface GithubInstallationSecretRow {
	readonly installation: GithubInstallationDto
	readonly webhookSecretEncrypted: string
	readonly accessTokenEncrypted: string | null
	readonly createdBy: string | null
}

function mapInstallationRow(row: GithubInstallationDto): GithubInstallationDto {
	return {
		...row,
		installationId: Number(row.installationId)
	}
}

function mapLinkRow(row: IssueGithubLinkDto): IssueGithubLinkDto {
	return {
		...row,
		githubIssueNumber: Number(row.githubIssueNumber),
		githubIssueId: Number(row.githubIssueId)
	}
}

export async function listGithubInstallationRows(
	tx: Queryable,
	workspaceId: string
): Promise<GithubInstallationDto[]> {
	const rows = await tx<GithubInstallationDto[]>`
		SELECT
			id,
			workspace_id AS "workspaceId",
			installation_id::int AS "installationId",
			account_login AS "accountLogin",
			repo_full_name AS "repoFullName",
			project_id AS "projectId",
			sync_enabled AS "syncEnabled",
			last_synced_at::text AS "lastSyncedAt",
			created_at::text AS "createdAt",
			updated_at::text AS "updatedAt",
			version
		FROM github_installations
		WHERE workspace_id = ${workspaceId}
		ORDER BY created_at DESC
	`
	return rows.map(mapInstallationRow)
}

export async function getGithubInstallationWithSecrets(
	tx: Queryable,
	workspaceId: string,
	id: string
): Promise<GithubInstallationSecretRow | null> {
	const [row] = await tx<
		(GithubInstallationDto & {
			readonly webhookSecretEncrypted: string
			readonly accessTokenEncrypted: string | null
			readonly createdBy: string | null
		})[]
	>`
		SELECT
			id,
			workspace_id AS "workspaceId",
			installation_id::int AS "installationId",
			account_login AS "accountLogin",
			repo_full_name AS "repoFullName",
			project_id AS "projectId",
			sync_enabled AS "syncEnabled",
			last_synced_at::text AS "lastSyncedAt",
			created_at::text AS "createdAt",
			updated_at::text AS "updatedAt",
			version,
			webhook_secret_encrypted AS "webhookSecretEncrypted",
			access_token_encrypted AS "accessTokenEncrypted",
			created_by AS "createdBy"
		FROM github_installations
		WHERE workspace_id = ${workspaceId} AND id = ${id}
	`
	if (!row) return null
	const { webhookSecretEncrypted, accessTokenEncrypted, createdBy, ...rest } = row
	return {
		installation: mapInstallationRow(rest),
		webhookSecretEncrypted,
		accessTokenEncrypted,
		createdBy
	}
}

export async function insertGithubInstallationRow(
	tx: Queryable,
	args: {
		readonly id: string
		readonly workspaceId: string
		readonly installationId: number
		readonly accountLogin: string
		readonly repoFullName: string
		readonly projectId: string
		readonly webhookSecretEncrypted: string
		readonly accessTokenEncrypted: string | null
		readonly syncEnabled: boolean
		readonly createdBy: string
	}
): Promise<GithubInstallationDto> {
	const [row] = await tx<GithubInstallationDto[]>`
		INSERT INTO github_installations (
			id, workspace_id, installation_id, account_login, repo_full_name,
			project_id, webhook_secret_encrypted, access_token_encrypted, sync_enabled, created_by
		)
		VALUES (
			${args.id}, ${args.workspaceId}, ${args.installationId}, ${args.accountLogin},
			${args.repoFullName}, ${args.projectId}, ${args.webhookSecretEncrypted},
			${args.accessTokenEncrypted}, ${args.syncEnabled}, ${args.createdBy}
		)
		RETURNING
			id,
			workspace_id AS "workspaceId",
			installation_id::int AS "installationId",
			account_login AS "accountLogin",
			repo_full_name AS "repoFullName",
			project_id AS "projectId",
			sync_enabled AS "syncEnabled",
			last_synced_at::text AS "lastSyncedAt",
			created_at::text AS "createdAt",
			updated_at::text AS "updatedAt",
			version
	`
	if (!row) throw new Error('Failed to create github installation')
	return mapInstallationRow(row)
}

export async function updateGithubInstallationRow(
	tx: Queryable,
	args: {
		readonly workspaceId: string
		readonly id: string
		readonly expectedVersion: number
		readonly projectId: string
		readonly syncEnabled: boolean
		readonly webhookSecretEncrypted: string
		readonly accessTokenEncrypted: string | null
	}
): Promise<GithubInstallationDto | null> {
	const [row] = await tx<GithubInstallationDto[]>`
		UPDATE github_installations
		SET
			project_id = ${args.projectId},
			sync_enabled = ${args.syncEnabled},
			webhook_secret_encrypted = ${args.webhookSecretEncrypted},
			access_token_encrypted = ${args.accessTokenEncrypted},
			version = version + 1
		WHERE workspace_id = ${args.workspaceId}
			AND id = ${args.id}
			AND version = ${args.expectedVersion}
		RETURNING
			id,
			workspace_id AS "workspaceId",
			installation_id::int AS "installationId",
			account_login AS "accountLogin",
			repo_full_name AS "repoFullName",
			project_id AS "projectId",
			sync_enabled AS "syncEnabled",
			last_synced_at::text AS "lastSyncedAt",
			created_at::text AS "createdAt",
			updated_at::text AS "updatedAt",
			version
	`
	return row ? mapInstallationRow(row) : null
}

export async function touchInstallationSyncedAt(
	tx: Queryable,
	workspaceId: string,
	id: string
): Promise<void> {
	await tx`
		UPDATE github_installations
		SET last_synced_at = now()
		WHERE workspace_id = ${workspaceId} AND id = ${id}
	`
}

export async function deleteGithubInstallationRow(
	tx: Queryable,
	workspaceId: string,
	id: string
): Promise<boolean> {
	const rows = await tx<{ id: string }[]>`
		DELETE FROM github_installations
		WHERE workspace_id = ${workspaceId} AND id = ${id}
		RETURNING id
	`
	return rows.length > 0
}

// ---------- Issue Links ----------

export interface IssueLinkWithInstallation {
	readonly link: IssueGithubLinkDto
	readonly syncEnabled: boolean
	readonly accessTokenEncrypted: string | null
}

export async function listIssueGithubLinkRows(
	tx: Queryable,
	workspaceId: string,
	issueId: string
): Promise<IssueGithubLinkDto[]> {
	const rows = await tx<IssueGithubLinkDto[]>`
		SELECT
			id,
			workspace_id AS "workspaceId",
			issue_id AS "issueId",
			installation_id AS "installationId",
			repo_full_name AS "repoFullName",
			github_issue_number AS "githubIssueNumber",
			github_issue_id::bigint AS "githubIssueId",
			github_url AS "githubUrl",
			source_of_truth AS "sourceOfTruth",
			last_synced_at::text AS "lastSyncedAt",
			last_sync_hash AS "lastSyncHash",
			sync_state AS "syncState",
			last_sync_error AS "lastSyncError",
			created_at::text AS "createdAt",
			updated_at::text AS "updatedAt"
		FROM issue_github_links
		WHERE workspace_id = ${workspaceId} AND issue_id = ${issueId}
		ORDER BY created_at DESC
	`
	return rows.map(mapLinkRow)
}

export async function listIssueLinksWithInstallation(
	tx: Queryable,
	workspaceId: string,
	issueId: string
): Promise<IssueLinkWithInstallation[]> {
	const rows = await tx<
		(IssueGithubLinkDto & {
			readonly syncEnabled: boolean
			readonly accessTokenEncrypted: string | null
		})[]
	>`
		SELECT
			l.id,
			l.workspace_id AS "workspaceId",
			l.issue_id AS "issueId",
			l.installation_id AS "installationId",
			l.repo_full_name AS "repoFullName",
			l.github_issue_number AS "githubIssueNumber",
			l.github_issue_id::bigint AS "githubIssueId",
			l.github_url AS "githubUrl",
			l.source_of_truth AS "sourceOfTruth",
			l.last_synced_at::text AS "lastSyncedAt",
			l.last_sync_hash AS "lastSyncHash",
			l.sync_state AS "syncState",
			l.last_sync_error AS "lastSyncError",
			l.created_at::text AS "createdAt",
			l.updated_at::text AS "updatedAt",
			gi.sync_enabled AS "syncEnabled",
			gi.access_token_encrypted AS "accessTokenEncrypted"
		FROM issue_github_links l
		JOIN github_installations gi
			ON gi.workspace_id = l.workspace_id AND gi.id = l.installation_id
		WHERE l.workspace_id = ${workspaceId} AND l.issue_id = ${issueId}
	`
	return rows.map((r) => {
		const { syncEnabled, accessTokenEncrypted, ...link } = r
		return { link: mapLinkRow(link), syncEnabled, accessTokenEncrypted }
	})
}

export async function getIssueGithubLinkWithInstallation(
	tx: Queryable,
	workspaceId: string,
	linkId: string
): Promise<IssueLinkWithInstallation | null> {
	const [row] = await tx<
		(IssueGithubLinkDto & {
			readonly syncEnabled: boolean
			readonly accessTokenEncrypted: string | null
		})[]
	>`
		SELECT
			l.id,
			l.workspace_id AS "workspaceId",
			l.issue_id AS "issueId",
			l.installation_id AS "installationId",
			l.repo_full_name AS "repoFullName",
			l.github_issue_number AS "githubIssueNumber",
			l.github_issue_id::bigint AS "githubIssueId",
			l.github_url AS "githubUrl",
			l.source_of_truth AS "sourceOfTruth",
			l.last_synced_at::text AS "lastSyncedAt",
			l.last_sync_hash AS "lastSyncHash",
			l.sync_state AS "syncState",
			l.last_sync_error AS "lastSyncError",
			l.created_at::text AS "createdAt",
			l.updated_at::text AS "updatedAt",
			gi.sync_enabled AS "syncEnabled",
			gi.access_token_encrypted AS "accessTokenEncrypted"
		FROM issue_github_links l
		JOIN github_installations gi
			ON gi.workspace_id = l.workspace_id AND gi.id = l.installation_id
		WHERE l.workspace_id = ${workspaceId} AND l.id = ${linkId}
	`
	if (!row) return null
	const { syncEnabled, accessTokenEncrypted, ...link } = row
	return { link: mapLinkRow(link), syncEnabled, accessTokenEncrypted }
}

export async function getIssueGithubLinkByRepoNumber(
	tx: Queryable,
	workspaceId: string,
	repoFullName: string,
	githubIssueNumber: number
): Promise<IssueGithubLinkDto | null> {
	const [row] = await tx<IssueGithubLinkDto[]>`
		SELECT
			id,
			workspace_id AS "workspaceId",
			issue_id AS "issueId",
			installation_id AS "installationId",
			repo_full_name AS "repoFullName",
			github_issue_number AS "githubIssueNumber",
			github_issue_id::bigint AS "githubIssueId",
			github_url AS "githubUrl",
			source_of_truth AS "sourceOfTruth",
			last_synced_at::text AS "lastSyncedAt",
			last_sync_hash AS "lastSyncHash",
			sync_state AS "syncState",
			last_sync_error AS "lastSyncError",
			created_at::text AS "createdAt",
			updated_at::text AS "updatedAt"
		FROM issue_github_links
		WHERE workspace_id = ${workspaceId}
			AND lower(repo_full_name) = lower(${repoFullName})
			AND github_issue_number = ${githubIssueNumber}
	`
	return row ? mapLinkRow(row) : null
}

export async function insertIssueGithubLinkRow(
	tx: Queryable,
	args: {
		readonly workspaceId: string
		readonly issueId: string
		readonly installationId: string
		readonly repoFullName: string
		readonly githubIssueNumber: number
		readonly githubIssueId: number
		readonly githubNodeId?: string | null
		readonly githubUrl: string
		readonly sourceOfTruth: GithubSourceOfTruth
		readonly lastSyncHash?: string | null
		readonly syncState?: GithubSyncState
	}
): Promise<IssueGithubLinkDto> {
	const [row] = await tx<IssueGithubLinkDto[]>`
		INSERT INTO issue_github_links (
			workspace_id, issue_id, installation_id, repo_full_name,
			github_issue_number, github_issue_id, github_node_id, github_url,
			source_of_truth, last_synced_at, last_sync_hash, sync_state
		)
		VALUES (
			${args.workspaceId}, ${args.issueId}, ${args.installationId}, ${args.repoFullName},
			${args.githubIssueNumber}, ${args.githubIssueId}, ${args.githubNodeId ?? null}, ${args.githubUrl},
			${args.sourceOfTruth}, now(), ${args.lastSyncHash ?? null}, ${args.syncState ?? 'synced'}
		)
		ON CONFLICT (workspace_id, repo_full_name, github_issue_number) DO UPDATE
		SET
			issue_id = EXCLUDED.issue_id,
			last_sync_hash = COALESCE(EXCLUDED.last_sync_hash, issue_github_links.last_sync_hash),
			sync_state = EXCLUDED.sync_state,
			last_synced_at = now()
		RETURNING
			id,
			workspace_id AS "workspaceId",
			issue_id AS "issueId",
			installation_id AS "installationId",
			repo_full_name AS "repoFullName",
			github_issue_number AS "githubIssueNumber",
			github_issue_id::bigint AS "githubIssueId",
			github_url AS "githubUrl",
			source_of_truth AS "sourceOfTruth",
			last_synced_at::text AS "lastSyncedAt",
			last_sync_hash AS "lastSyncHash",
			sync_state AS "syncState",
			last_sync_error AS "lastSyncError",
			created_at::text AS "createdAt",
			updated_at::text AS "updatedAt"
	`
	if (!row) throw new Error('Failed to create issue GitHub link')
	return mapLinkRow(row)
}

export async function deleteIssueGithubLinkRow(
	tx: Queryable,
	workspaceId: string,
	linkId: string
): Promise<boolean> {
	const rows = await tx<{ id: string }[]>`
		DELETE FROM issue_github_links
		WHERE workspace_id = ${workspaceId} AND id = ${linkId}
		RETURNING id
	`
	return rows.length > 0
}

export async function updateIssueGithubLinkSyncState(
	tx: Queryable,
	args: {
		readonly workspaceId: string
		readonly linkId: string
		readonly syncState: GithubSyncState
		readonly lastSyncHash?: string | null | undefined
		readonly lastSyncError: string | null
		readonly synced: boolean
	}
): Promise<IssueGithubLinkDto | null> {
	const [row] = await tx<IssueGithubLinkDto[]>`
		UPDATE issue_github_links
		SET
			sync_state = ${args.syncState},
			last_sync_hash = COALESCE(${args.lastSyncHash ?? null}, last_sync_hash),
			last_sync_error = ${args.lastSyncError},
			last_synced_at = CASE WHEN ${args.synced} THEN now() ELSE last_synced_at END
		WHERE workspace_id = ${args.workspaceId} AND id = ${args.linkId}
		RETURNING
			id,
			workspace_id AS "workspaceId",
			issue_id AS "issueId",
			installation_id AS "installationId",
			repo_full_name AS "repoFullName",
			github_issue_number AS "githubIssueNumber",
			github_issue_id::bigint AS "githubIssueId",
			github_url AS "githubUrl",
			source_of_truth AS "sourceOfTruth",
			last_synced_at::text AS "lastSyncedAt",
			last_sync_hash AS "lastSyncHash",
			sync_state AS "syncState",
			last_sync_error AS "lastSyncError",
			created_at::text AS "createdAt",
			updated_at::text AS "updatedAt"
	`
	return row ? mapLinkRow(row) : null
}

// ---------- Pre-tenant Webhook Routing & Queue ----------

export interface ResolvedGithubRoute {
	readonly id: string
	readonly workspaceId: string
	readonly webhookSecretEncrypted: string
	readonly syncEnabled: boolean
}

export async function resolveGithubInstallationRoutes(
	tx: Queryable,
	repoFullName: string,
	installationId?: number | null
): Promise<ResolvedGithubRoute[]> {
	return tx<ResolvedGithubRoute[]>`
		SELECT
			id,
			workspace_id AS "workspaceId",
			webhook_secret_encrypted AS "webhookSecretEncrypted",
			sync_enabled AS "syncEnabled"
		FROM resolve_github_installation_route(${repoFullName}, ${installationId ?? null})
	`
}

export async function insertGithubWebhookEventRow(
	tx: Queryable,
	args: {
		readonly deliveryId: string
		readonly installationId: number | null
		readonly repoFullName: string | null
		readonly eventName: string
		readonly payload: Record<string, unknown>
	}
): Promise<boolean> {
	const inserted = await tx<{ id: string }[]>`
		INSERT INTO github_webhook_events (
			delivery_id, installation_id, repo_full_name, event_name, payload
		)
		VALUES (
			${args.deliveryId}, ${args.installationId}, ${args.repoFullName},
			${args.eventName}, ${tx.json(args.payload as never)}
		)
		ON CONFLICT (delivery_id) DO NOTHING
		RETURNING id
	`
	return inserted.length > 0
}

export interface PendingGithubWebhookRow {
	readonly id: string
	readonly deliveryId: string
	readonly installationId: number | null
	readonly repoFullName: string | null
	readonly eventName: string
	readonly payload: Record<string, unknown>
}

export async function claimPendingGithubWebhookRows(
	tx: Queryable,
	limit = 50
): Promise<PendingGithubWebhookRow[]> {
	const rows = await tx<PendingGithubWebhookRow[]>`
		SELECT
			id,
			delivery_id AS "deliveryId",
			installation_id::int AS "installationId",
			repo_full_name AS "repoFullName",
			event_name AS "eventName",
			payload
		FROM github_webhook_events
		WHERE status = 'pending'
		ORDER BY received_at ASC
		LIMIT ${limit}
		FOR UPDATE SKIP LOCKED
	`
	return rows.map((r) => ({
		...r,
		installationId: r.installationId === null ? null : Number(r.installationId)
	}))
}

export async function markGithubWebhookEventStatus(
	tx: Queryable,
	id: string,
	status: 'processed' | 'ignored' | 'failed',
	errorDetail?: string | null
): Promise<void> {
	await tx`
		UPDATE github_webhook_events
		SET
			status = ${status},
			error_detail = ${errorDetail ?? null},
			processed_at = now()
		WHERE id = ${id}
	`
}
