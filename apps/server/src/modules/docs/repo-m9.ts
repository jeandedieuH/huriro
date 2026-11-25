/**
 * M9 Docs persistence layer: Teamspaces, Synced Blocks, Suggestions,
 * Wiki Verification, and Public Shares. Explicit column lists everywhere.
 */
import type {
	DocPublicShareDto,
	DocSuggestionDto,
	DocSuggestionKind,
	DocSuggestionStatus,
	DocSyncedBlockDto,
	DocVerificationDto,
	DocVerificationStatus,
	TeamspaceDefaultAclEntryDto,
	TeamspaceDto,
	TeamspaceMemberDto,
	TeamspaceRole,
	TeamspaceVisibility
} from '@huriro/contracts'
import type { Queryable } from '@huriro/db'

// ---------- Teamspaces ----------

interface RawTeamspaceRow {
	readonly id: string
	readonly workspaceId: string
	readonly name: string
	readonly slug: string
	readonly icon: string | null
	readonly description: string
	readonly visibility: TeamspaceVisibility
	readonly defaultAcl: TeamspaceDefaultAclEntryDto[]
	readonly position: string
	readonly archivedAt: string | null
	readonly createdBy: string | null
	readonly createdAt: string
	readonly updatedAt: string
	readonly version: number
}

function mapTeamspaceRow(row: RawTeamspaceRow): TeamspaceDto {
	return {
		id: row.id,
		workspaceId: row.workspaceId,
		name: row.name,
		slug: row.slug,
		icon: row.icon,
		description: row.description,
		visibility: row.visibility,
		defaultAcl: Array.isArray(row.defaultAcl) ? row.defaultAcl : [],
		position: row.position,
		archivedAt: row.archivedAt,
		createdBy: row.createdBy,
		createdAt: row.createdAt,
		updatedAt: row.updatedAt,
		version: Number(row.version)
	}
}

export async function listVisibleTeamspacesRows(
	tx: Queryable,
	args: {
		readonly workspaceId: string
		readonly userId: string
		readonly bypassAcl: boolean
		readonly includeArchived?: boolean | undefined
	}
): Promise<TeamspaceDto[]> {
	const archiveFilter = args.includeArchived ? tx`` : tx`AND ts.archived_at IS NULL`
	if (args.bypassAcl) {
		const rows = await tx<RawTeamspaceRow[]>`
			SELECT
				ts.id,
				ts.workspace_id AS "workspaceId",
				ts.name,
				ts.slug,
				ts.icon,
				ts.description,
				ts.visibility,
				ts.default_acl AS "defaultAcl",
				ts.position,
				ts.archived_at::text AS "archivedAt",
				ts.created_by AS "createdBy",
				ts.created_at::text AS "createdAt",
				ts.updated_at::text AS "updatedAt",
				ts.version
			FROM teamspaces ts
			WHERE ts.workspace_id = ${args.workspaceId}
				${archiveFilter}
			ORDER BY ts.position COLLATE "C" ASC, ts.id ASC
		`
		return rows.map(mapTeamspaceRow)
	}

	const rows = await tx<RawTeamspaceRow[]>`
		SELECT
			ts.id,
			ts.workspace_id AS "workspaceId",
			ts.name,
			ts.slug,
			ts.icon,
			ts.description,
			ts.visibility,
			ts.default_acl AS "defaultAcl",
			ts.position,
			ts.archived_at::text AS "archivedAt",
			ts.created_by AS "createdBy",
			ts.created_at::text AS "createdAt",
			ts.updated_at::text AS "updatedAt",
			ts.version
		FROM teamspaces ts
		WHERE ts.workspace_id = ${args.workspaceId}
			${archiveFilter}
			AND (
				ts.visibility IN ('open', 'closed')
				OR EXISTS (
					SELECT 1 FROM teamspace_members tm
					WHERE tm.workspace_id = ts.workspace_id
						AND tm.teamspace_id = ts.id
						AND tm.user_id = ${args.userId}
				)
				OR can_read(ts.workspace_id, 'teamspace', ts.id, ${args.userId}, 'read')
			)
		ORDER BY ts.position COLLATE "C" ASC, ts.id ASC
	`
	return rows.map(mapTeamspaceRow)
}

export async function getTeamspaceById(
	tx: Queryable,
	workspaceId: string,
	teamspaceId: string
): Promise<TeamspaceDto | null> {
	const [row] = await tx<RawTeamspaceRow[]>`
		SELECT
			id,
			workspace_id AS "workspaceId",
			name,
			slug,
			icon,
			description,
			visibility,
			default_acl AS "defaultAcl",
			position,
			archived_at::text AS "archivedAt",
			created_by AS "createdBy",
			created_at::text AS "createdAt",
			updated_at::text AS "updatedAt",
			version
		FROM teamspaces
		WHERE workspace_id = ${workspaceId} AND id = ${teamspaceId}
	`
	return row ? mapTeamspaceRow(row) : null
}

export async function teamspaceSlugExists(
	tx: Queryable,
	workspaceId: string,
	slug: string,
	excludeId?: string
): Promise<boolean> {
	const rows = excludeId
		? await tx<{ id: string }[]>`
				SELECT id FROM teamspaces WHERE workspace_id = ${workspaceId} AND slug = ${slug} AND id <> ${excludeId}
			`
		: await tx<{ id: string }[]>`
				SELECT id FROM teamspaces WHERE workspace_id = ${workspaceId} AND slug = ${slug}
			`
	return rows.length > 0
}

export async function getLastTeamspacePosition(tx: Queryable, workspaceId: string): Promise<string | null> {
	const [row] = await tx<{ position: string }[]>`
		SELECT position FROM teamspaces
		WHERE workspace_id = ${workspaceId} AND archived_at IS NULL
		ORDER BY position COLLATE "C" DESC, id DESC
		LIMIT 1
	`
	return row?.position ?? null
}

export async function insertTeamspaceRow(
	tx: Queryable,
	args: {
		readonly workspaceId: string
		readonly name: string
		readonly slug: string
		readonly icon: string | null
		readonly description: string
		readonly visibility: TeamspaceVisibility
		readonly defaultAcl: readonly TeamspaceDefaultAclEntryDto[]
		readonly position: string
		readonly createdBy: string
	}
): Promise<TeamspaceDto> {
	const [row] = await tx<RawTeamspaceRow[]>`
		INSERT INTO teamspaces (
			workspace_id, name, slug, icon, description, visibility, default_acl, position, created_by
		)
		VALUES (
			${args.workspaceId},
			${args.name},
			${args.slug},
			${args.icon},
			${args.description},
			${args.visibility},
			${tx.json(args.defaultAcl as never)},
			${args.position},
			${args.createdBy}
		)
		RETURNING
			id,
			workspace_id AS "workspaceId",
			name,
			slug,
			icon,
			description,
			visibility,
			default_acl AS "defaultAcl",
			position,
			archived_at::text AS "archivedAt",
			created_by AS "createdBy",
			created_at::text AS "createdAt",
			updated_at::text AS "updatedAt",
			version
	`
	if (!row) throw new Error('Failed to insert teamspace')
	return mapTeamspaceRow(row)
}

export async function updateTeamspaceRow(
	tx: Queryable,
	args: {
		readonly workspaceId: string
		readonly teamspaceId: string
		readonly expectedVersion: number
		readonly name: string
		readonly slug: string
		readonly icon: string | null
		readonly description: string
		readonly visibility: TeamspaceVisibility
		readonly defaultAcl: readonly TeamspaceDefaultAclEntryDto[]
		readonly archivedAt: string | null
	}
): Promise<TeamspaceDto | null> {
	const [row] = await tx<RawTeamspaceRow[]>`
		UPDATE teamspaces
		SET name = ${args.name},
			slug = ${args.slug},
			icon = ${args.icon},
			description = ${args.description},
			visibility = ${args.visibility},
			default_acl = ${tx.json(args.defaultAcl as never)},
			archived_at = ${args.archivedAt ? tx`${args.archivedAt}::timestamptz` : tx`NULL`},
			version = version + 1
		WHERE workspace_id = ${args.workspaceId}
			AND id = ${args.teamspaceId}
			AND version = ${args.expectedVersion}
		RETURNING
			id,
			workspace_id AS "workspaceId",
			name,
			slug,
			icon,
			description,
			visibility,
			default_acl AS "defaultAcl",
			position,
			archived_at::text AS "archivedAt",
			created_by AS "createdBy",
			created_at::text AS "createdAt",
			updated_at::text AS "updatedAt",
			version
	`
	return row ? mapTeamspaceRow(row) : null
}

export async function listTeamspaceMemberRows(
	tx: Queryable,
	workspaceId: string,
	teamspaceId: string
): Promise<TeamspaceMemberDto[]> {
	return tx<TeamspaceMemberDto[]>`
		SELECT
			workspace_id AS "workspaceId",
			teamspace_id AS "teamspaceId",
			user_id AS "userId",
			role,
			created_at::text AS "createdAt"
		FROM teamspace_members
		WHERE workspace_id = ${workspaceId} AND teamspace_id = ${teamspaceId}
		ORDER BY created_at ASC, user_id ASC
	`
}

export async function getTeamspaceMemberRole(
	tx: Queryable,
	workspaceId: string,
	teamspaceId: string,
	userId: string
): Promise<TeamspaceRole | null> {
	const [row] = await tx<{ role: TeamspaceRole }[]>`
		SELECT role FROM teamspace_members
		WHERE workspace_id = ${workspaceId}
			AND teamspace_id = ${teamspaceId}
			AND user_id = ${userId}
	`
	return row?.role ?? null
}

export async function upsertTeamspaceMemberRow(
	tx: Queryable,
	args: {
		readonly workspaceId: string
		readonly teamspaceId: string
		readonly userId: string
		readonly role: TeamspaceRole
	}
): Promise<TeamspaceMemberDto> {
	const [row] = await tx<TeamspaceMemberDto[]>`
		INSERT INTO teamspace_members (workspace_id, teamspace_id, user_id, role)
		VALUES (${args.workspaceId}, ${args.teamspaceId}, ${args.userId}, ${args.role})
		ON CONFLICT (workspace_id, teamspace_id, user_id) DO UPDATE SET
			role = EXCLUDED.role
		RETURNING
			workspace_id AS "workspaceId",
			teamspace_id AS "teamspaceId",
			user_id AS "userId",
			role,
			created_at::text AS "createdAt"
	`
	if (!row) throw new Error('Failed to upsert teamspace member')
	return row
}

export async function deleteTeamspaceMemberRow(
	tx: Queryable,
	workspaceId: string,
	teamspaceId: string,
	userId: string
): Promise<boolean> {
	const rows = await tx<{ userId: string }[]>`
		DELETE FROM teamspace_members
		WHERE workspace_id = ${workspaceId}
			AND teamspace_id = ${teamspaceId}
			AND user_id = ${userId}
		RETURNING user_id AS "userId"
	`
	return rows.length > 0
}

// ---------- Synced Blocks ----------

export interface RawSyncedBlockRow {
	readonly id: string
	readonly workspaceId: string
	readonly title: string
	readonly sourcePageId: string | null
	readonly state: Buffer
	readonly stateVector: Buffer
	readonly byteSize: number
	readonly leaseNodeId: string | null
	readonly leaseEpoch: number
	readonly leaseExpiresAt: string | null
	readonly plainText: string
	readonly createdBy: string | null
	readonly archivedAt: string | null
	readonly createdAt: string
	readonly updatedAt: string
	readonly version: number
}

export function mapSyncedBlockRow(row: RawSyncedBlockRow): DocSyncedBlockDto {
	return {
		id: row.id,
		workspaceId: row.workspaceId,
		title: row.title,
		sourcePageId: row.sourcePageId,
		stateBase64: Buffer.from(row.state).toString('base64'),
		stateVectorBase64: Buffer.from(row.stateVector).toString('base64'),
		byteSize: Number(row.byteSize),
		plainText: row.plainText,
		createdBy: row.createdBy,
		archivedAt: row.archivedAt,
		createdAt: row.createdAt,
		updatedAt: row.updatedAt,
		version: Number(row.version)
	}
}

export async function listSyncedBlockRows(
	tx: Queryable,
	workspaceId: string,
	includeArchived = false
): Promise<RawSyncedBlockRow[]> {
	const filter = includeArchived ? tx`` : tx`AND archived_at IS NULL`
	const rows = await tx<(Omit<RawSyncedBlockRow, 'leaseEpoch'> & { leaseEpoch: string | number })[]>`
		SELECT
			id,
			workspace_id AS "workspaceId",
			title,
			source_page_id AS "sourcePageId",
			state,
			state_vector AS "stateVector",
			byte_size AS "byteSize",
			lease_node_id AS "leaseNodeId",
			lease_epoch AS "leaseEpoch",
			lease_expires_at::text AS "leaseExpiresAt",
			plain_text AS "plainText",
			created_by AS "createdBy",
			archived_at::text AS "archivedAt",
			created_at::text AS "createdAt",
			updated_at::text AS "updatedAt",
			version
		FROM doc_synced_blocks
		WHERE workspace_id = ${workspaceId} ${filter}
		ORDER BY updated_at DESC, id DESC
		LIMIT 200
	`
	return rows.map((r) => ({ ...r, leaseEpoch: Number(r.leaseEpoch) }))
}

export async function getSyncedBlockRow(
	tx: Queryable,
	workspaceId: string,
	blockId: string
): Promise<RawSyncedBlockRow | null> {
	const [row] = await tx<(Omit<RawSyncedBlockRow, 'leaseEpoch'> & { leaseEpoch: string | number })[]>`
		SELECT
			id,
			workspace_id AS "workspaceId",
			title,
			source_page_id AS "sourcePageId",
			state,
			state_vector AS "stateVector",
			byte_size AS "byteSize",
			lease_node_id AS "leaseNodeId",
			lease_epoch AS "leaseEpoch",
			lease_expires_at::text AS "leaseExpiresAt",
			plain_text AS "plainText",
			created_by AS "createdBy",
			archived_at::text AS "archivedAt",
			created_at::text AS "createdAt",
			updated_at::text AS "updatedAt",
			version
		FROM doc_synced_blocks
		WHERE workspace_id = ${workspaceId} AND id = ${blockId}
	`
	if (!row) return null
	return { ...row, leaseEpoch: Number(row.leaseEpoch) }
}

export async function insertSyncedBlockRow(
	tx: Queryable,
	args: {
		readonly workspaceId: string
		readonly title: string
		readonly sourcePageId: string | null
		readonly state: Uint8Array
		readonly stateVector: Uint8Array
		readonly byteSize: number
		readonly plainText: string
		readonly createdBy: string
	}
): Promise<RawSyncedBlockRow> {
	const [row] = await tx<(Omit<RawSyncedBlockRow, 'leaseEpoch'> & { leaseEpoch: string | number })[]>`
		INSERT INTO doc_synced_blocks (
			workspace_id, title, source_page_id, state, state_vector, byte_size, plain_text, created_by
		)
		VALUES (
			${args.workspaceId},
			${args.title},
			${args.sourcePageId},
			${Buffer.from(args.state)},
			${Buffer.from(args.stateVector)},
			${args.byteSize},
			${args.plainText},
			${args.createdBy}
		)
		RETURNING
			id,
			workspace_id AS "workspaceId",
			title,
			source_page_id AS "sourcePageId",
			state,
			state_vector AS "stateVector",
			byte_size AS "byteSize",
			lease_node_id AS "leaseNodeId",
			lease_epoch AS "leaseEpoch",
			lease_expires_at::text AS "leaseExpiresAt",
			plain_text AS "plainText",
			created_by AS "createdBy",
			archived_at::text AS "archivedAt",
			created_at::text AS "createdAt",
			updated_at::text AS "updatedAt",
			version
	`
	if (!row) throw new Error('Failed to insert synced block')
	return { ...row, leaseEpoch: Number(row.leaseEpoch) }
}

export async function updateSyncedBlockMetaRow(
	tx: Queryable,
	args: {
		readonly workspaceId: string
		readonly blockId: string
		readonly expectedVersion: number
		readonly title: string
		readonly archivedAt: string | null
	}
): Promise<RawSyncedBlockRow | null> {
	const [row] = await tx<(Omit<RawSyncedBlockRow, 'leaseEpoch'> & { leaseEpoch: string | number })[]>`
		UPDATE doc_synced_blocks
		SET title = ${args.title},
			archived_at = ${args.archivedAt ? tx`${args.archivedAt}::timestamptz` : tx`NULL`},
			version = version + 1
		WHERE workspace_id = ${args.workspaceId}
			AND id = ${args.blockId}
			AND version = ${args.expectedVersion}
		RETURNING
			id,
			workspace_id AS "workspaceId",
			title,
			source_page_id AS "sourcePageId",
			state,
			state_vector AS "stateVector",
			byte_size AS "byteSize",
			lease_node_id AS "leaseNodeId",
			lease_epoch AS "leaseEpoch",
			lease_expires_at::text AS "leaseExpiresAt",
			plain_text AS "plainText",
			created_by AS "createdBy",
			archived_at::text AS "archivedAt",
			created_at::text AS "createdAt",
			updated_at::text AS "updatedAt",
			version
	`
	if (!row) return null
	return { ...row, leaseEpoch: Number(row.leaseEpoch) }
}

export async function acquireOrRenewSyncedBlockLease(
	tx: Queryable,
	args: {
		readonly workspaceId: string
		readonly blockId: string
		readonly nodeId: string
		readonly ttlMs: number
	}
): Promise<{
	readonly acquired: boolean
	readonly nodeId: string
	readonly epoch: number
	readonly expiresAt: string
}> {
	const expiresAt = new Date(Date.now() + args.ttlMs).toISOString()
	const [row] = await tx<{ nodeId: string; epoch: string | number; expiresAt: string }[]>`
		UPDATE doc_synced_blocks
		SET lease_node_id = CASE
				WHEN lease_expires_at IS NULL OR lease_expires_at < now() OR lease_node_id = ${args.nodeId}
				THEN ${args.nodeId}
				ELSE lease_node_id
			END,
			lease_epoch = CASE
				WHEN lease_expires_at IS NULL OR lease_expires_at < now() THEN lease_epoch + 1
				ELSE lease_epoch
			END,
			lease_expires_at = CASE
				WHEN lease_expires_at IS NULL OR lease_expires_at < now() OR lease_node_id = ${args.nodeId}
				THEN ${expiresAt}::timestamptz
				ELSE lease_expires_at
			END
		WHERE workspace_id = ${args.workspaceId} AND id = ${args.blockId}
		RETURNING lease_node_id AS "nodeId", lease_epoch AS "epoch", lease_expires_at::text AS "expiresAt"
	`
	if (!row) throw new Error('Synced block not found for lease acquisition')
	return {
		acquired: row.nodeId === args.nodeId,
		nodeId: row.nodeId,
		epoch: Number(row.epoch),
		expiresAt: row.expiresAt
	}
}

export async function expireSyncedBlockLease(
	tx: Queryable,
	args: {
		readonly workspaceId: string
		readonly blockId: string
		readonly nodeId: string
		readonly epoch: number
	}
): Promise<void> {
	await tx`
		UPDATE doc_synced_blocks
		SET lease_expires_at = now() - interval '1 second'
		WHERE workspace_id = ${args.workspaceId}
			AND id = ${args.blockId}
			AND lease_node_id = ${args.nodeId}
			AND lease_epoch = ${args.epoch}
	`
}

export async function saveFencedSyncedBlockState(
	tx: Queryable,
	args: {
		readonly workspaceId: string
		readonly blockId: string
		readonly nodeId: string
		readonly leaseEpoch: number
		readonly state: Uint8Array
		readonly stateVector: Uint8Array
		readonly byteSize: number
		readonly plainText: string
	}
): Promise<{ readonly fenced: boolean; readonly currentEpoch: number }> {
	const updated = await tx<{ leaseEpoch: string | number }[]>`
		UPDATE doc_synced_blocks
		SET state = ${Buffer.from(args.state)},
			state_vector = ${Buffer.from(args.stateVector)},
			byte_size = ${args.byteSize},
			plain_text = ${args.plainText},
			version = version + 1
		WHERE workspace_id = ${args.workspaceId}
			AND id = ${args.blockId}
			AND (lease_node_id = ${args.nodeId} OR lease_node_id IS NULL)
			AND lease_epoch = ${args.leaseEpoch}
		RETURNING lease_epoch AS "leaseEpoch"
	`
	if (updated.length === 0) {
		const [existing] = await tx<{ leaseEpoch: string | number }[]>`
			SELECT lease_epoch AS "leaseEpoch"
			FROM doc_synced_blocks
			WHERE workspace_id = ${args.workspaceId} AND id = ${args.blockId}
		`
		return { fenced: true, currentEpoch: existing ? Number(existing.leaseEpoch) : args.leaseEpoch }
	}
	return { fenced: false, currentEpoch: args.leaseEpoch }
}

export async function saveUnfencedSyncedBlockState(
	tx: Queryable,
	args: {
		readonly workspaceId: string
		readonly blockId: string
		readonly state: Uint8Array
		readonly stateVector: Uint8Array
		readonly byteSize: number
		readonly plainText: string
	}
): Promise<void> {
	await tx`
		UPDATE doc_synced_blocks
		SET state = ${Buffer.from(args.state)},
			state_vector = ${Buffer.from(args.stateVector)},
			byte_size = ${args.byteSize},
			plain_text = ${args.plainText},
			version = version + 1
		WHERE workspace_id = ${args.workspaceId} AND id = ${args.blockId}
	`
}

// ---------- Suggestion Mode Index ----------

export async function listDocSuggestionRows(
	tx: Queryable,
	workspaceId: string,
	pageId: string
): Promise<DocSuggestionDto[]> {
	return tx<DocSuggestionDto[]>`
		SELECT
			id,
			workspace_id AS "workspaceId",
			page_id AS "pageId",
			group_id AS "groupId",
			kind,
			author_type AS "authorType",
			author_id AS "authorId",
			anchor_block_id AS "anchorBlockId",
			before_text AS "beforeText",
			after_text AS "afterText",
			status,
			resolved_by AS "resolvedBy",
			resolved_at::text AS "resolvedAt",
			created_at::text AS "createdAt",
			updated_at::text AS "updatedAt",
			version
		FROM doc_suggestions
		WHERE workspace_id = ${workspaceId} AND page_id = ${pageId}
		ORDER BY created_at DESC, id DESC
		LIMIT 300
	`
}

export async function upsertDocSuggestionRow(
	tx: Queryable,
	args: {
		readonly workspaceId: string
		readonly pageId: string
		readonly groupId: string
		readonly kind: DocSuggestionKind
		readonly authorType: 'user' | 'agent'
		readonly authorId: string
		readonly anchorBlockId: string | null
		readonly beforeText: string
		readonly afterText: string
		readonly status?: DocSuggestionStatus | undefined
	}
): Promise<{ readonly row: DocSuggestionDto; readonly inserted: boolean }> {
	const existing = await tx<{ id: string }[]>`
		SELECT id FROM doc_suggestions
		WHERE workspace_id = ${args.workspaceId} AND page_id = ${args.pageId} AND group_id = ${args.groupId}
	`
	const status = args.status ?? 'open'
	const [row] = await tx<DocSuggestionDto[]>`
		INSERT INTO doc_suggestions (
			workspace_id, page_id, group_id, kind, author_type, author_id,
			anchor_block_id, before_text, after_text, status
		)
		VALUES (
			${args.workspaceId},
			${args.pageId},
			${args.groupId},
			${args.kind},
			${args.authorType},
			${args.authorId},
			${args.anchorBlockId},
			${args.beforeText},
			${args.afterText},
			${status}
		)
		ON CONFLICT (workspace_id, page_id, group_id) DO UPDATE SET
			kind = EXCLUDED.kind,
			anchor_block_id = EXCLUDED.anchor_block_id,
			before_text = EXCLUDED.before_text,
			after_text = EXCLUDED.after_text,
			status = CASE WHEN doc_suggestions.status = 'open' THEN EXCLUDED.status ELSE doc_suggestions.status END,
			version = doc_suggestions.version + 1
		RETURNING
			id,
			workspace_id AS "workspaceId",
			page_id AS "pageId",
			group_id AS "groupId",
			kind,
			author_type AS "authorType",
			author_id AS "authorId",
			anchor_block_id AS "anchorBlockId",
			before_text AS "beforeText",
			after_text AS "afterText",
			status,
			resolved_by AS "resolvedBy",
			resolved_at::text AS "resolvedAt",
			created_at::text AS "createdAt",
			updated_at::text AS "updatedAt",
			version
	`
	if (!row) throw new Error('Failed to upsert doc_suggestions row')
	return { row, inserted: existing.length === 0 }
}

export async function markMissingDocSuggestionsStatus(
	tx: Queryable,
	args: {
		readonly workspaceId: string
		readonly pageId: string
		readonly activeGroupIds: readonly string[]
		readonly status: 'accepted' | 'rejected'
		readonly resolvedBy: string | null
	}
): Promise<void> {
	if (args.activeGroupIds.length === 0) {
		await tx`
			UPDATE doc_suggestions
			SET status = ${args.status},
				resolved_by = ${args.resolvedBy},
				resolved_at = now(),
				version = version + 1
			WHERE workspace_id = ${args.workspaceId}
				AND page_id = ${args.pageId}
				AND status = 'open'
		`
		return
	}
	await tx`
		UPDATE doc_suggestions
		SET status = ${args.status},
			resolved_by = ${args.resolvedBy},
			resolved_at = now(),
			version = version + 1
		WHERE workspace_id = ${args.workspaceId}
			AND page_id = ${args.pageId}
			AND status = 'open'
			AND NOT (group_id = ANY(${args.activeGroupIds}))
	`
}

export async function updateDocSuggestionDecisionRow(
	tx: Queryable,
	args: {
		readonly workspaceId: string
		readonly pageId: string
		readonly groupId: string
		readonly status: 'accepted' | 'rejected'
		readonly resolvedBy: string
	}
): Promise<DocSuggestionDto | null> {
	const [row] = await tx<DocSuggestionDto[]>`
		UPDATE doc_suggestions
		SET status = ${args.status},
			resolved_by = ${args.resolvedBy},
			resolved_at = now(),
			version = version + 1
		WHERE workspace_id = ${args.workspaceId}
			AND page_id = ${args.pageId}
			AND group_id = ${args.groupId}
		RETURNING
			id,
			workspace_id AS "workspaceId",
			page_id AS "pageId",
			group_id AS "groupId",
			kind,
			author_type AS "authorType",
			author_id AS "authorId",
			anchor_block_id AS "anchorBlockId",
			before_text AS "beforeText",
			after_text AS "afterText",
			status,
			resolved_by AS "resolvedBy",
			resolved_at::text AS "resolvedAt",
			created_at::text AS "createdAt",
			updated_at::text AS "updatedAt",
			version
	`
	return row ?? null
}

export async function bulkUpdateOpenDocSuggestionsRow(
	tx: Queryable,
	args: {
		readonly workspaceId: string
		readonly pageId: string
		readonly status: 'accepted' | 'rejected'
		readonly resolvedBy: string
	}
): Promise<DocSuggestionDto[]> {
	return tx<DocSuggestionDto[]>`
		UPDATE doc_suggestions
		SET status = ${args.status},
			resolved_by = ${args.resolvedBy},
			resolved_at = now(),
			version = version + 1
		WHERE workspace_id = ${args.workspaceId}
			AND page_id = ${args.pageId}
			AND status = 'open'
		RETURNING
			id,
			workspace_id AS "workspaceId",
			page_id AS "pageId",
			group_id AS "groupId",
			kind,
			author_type AS "authorType",
			author_id AS "authorId",
			anchor_block_id AS "anchorBlockId",
			before_text AS "beforeText",
			after_text AS "afterText",
			status,
			resolved_by AS "resolvedBy",
			resolved_at::text AS "resolvedAt",
			created_at::text AS "createdAt",
			updated_at::text AS "updatedAt",
			version
	`
}

// ---------- Wiki Verification & Freshness ----------

export interface RawDocVerificationRow extends DocVerificationDto {
	readonly expiryNotifiedAt: string | null
}

export async function getDocVerificationRow(
	tx: Queryable,
	workspaceId: string,
	pageId: string
): Promise<RawDocVerificationRow | null> {
	const [row] = await tx<RawDocVerificationRow[]>`
		SELECT
			id,
			workspace_id AS "workspaceId",
			page_id AS "pageId",
			status,
			verified_by AS "verifiedBy",
			verified_at::text AS "verifiedAt",
			expires_at::text AS "expiresAt",
			expiry_notified_at::text AS "expiryNotifiedAt",
			note,
			created_at::text AS "createdAt",
			updated_at::text AS "updatedAt",
			version
		FROM doc_verifications
		WHERE workspace_id = ${workspaceId} AND page_id = ${pageId}
	`
	return row ?? null
}

export async function listDocVerificationRows(
	tx: Queryable,
	workspaceId: string
): Promise<DocVerificationDto[]> {
	return tx<DocVerificationDto[]>`
		SELECT
			id,
			workspace_id AS "workspaceId",
			page_id AS "pageId",
			status,
			verified_by AS "verifiedBy",
			verified_at::text AS "verifiedAt",
			expires_at::text AS "expiresAt",
			note,
			created_at::text AS "createdAt",
			updated_at::text AS "updatedAt",
			version
		FROM doc_verifications
		WHERE workspace_id = ${workspaceId}
	`
}

export async function upsertDocVerificationRow(
	tx: Queryable,
	args: {
		readonly workspaceId: string
		readonly pageId: string
		readonly status: DocVerificationStatus
		readonly verifiedBy: string | null
		readonly verifiedAt: string | null
		readonly expiresAt: string | null
		readonly note: string
	}
): Promise<DocVerificationDto> {
	const [row] = await tx<DocVerificationDto[]>`
		INSERT INTO doc_verifications (
			workspace_id, page_id, status, verified_by, verified_at, expires_at, expiry_notified_at, note
		)
		VALUES (
			${args.workspaceId},
			${args.pageId},
			${args.status},
			${args.verifiedBy},
			${args.verifiedAt ? tx`${args.verifiedAt}::timestamptz` : tx`NULL`},
			${args.expiresAt ? tx`${args.expiresAt}::timestamptz` : tx`NULL`},
			NULL,
			${args.note}
		)
		ON CONFLICT (workspace_id, page_id) DO UPDATE SET
			status = EXCLUDED.status,
			verified_by = EXCLUDED.verified_by,
			verified_at = EXCLUDED.verified_at,
			expires_at = EXCLUDED.expires_at,
			expiry_notified_at = NULL,
			note = EXCLUDED.note,
			version = doc_verifications.version + 1
		RETURNING
			id,
			workspace_id AS "workspaceId",
			page_id AS "pageId",
			status,
			verified_by AS "verifiedBy",
			verified_at::text AS "verifiedAt",
			expires_at::text AS "expiresAt",
			note,
			created_at::text AS "createdAt",
			updated_at::text AS "updatedAt",
			version
	`
	if (!row) throw new Error('Failed to upsert doc verification')
	return row
}

export async function deleteDocVerificationRow(
	tx: Queryable,
	workspaceId: string,
	pageId: string
): Promise<boolean> {
	const rows = await tx<{ id: string }[]>`
		DELETE FROM doc_verifications
		WHERE workspace_id = ${workspaceId} AND page_id = ${pageId}
		RETURNING id
	`
	return rows.length > 0
}

export async function markDocVerificationStale(
	tx: Queryable,
	workspaceId: string,
	pageId: string
): Promise<DocVerificationDto | null> {
	const [row] = await tx<DocVerificationDto[]>`
		UPDATE doc_verifications
		SET status = 'stale',
			version = version + 1
		WHERE workspace_id = ${workspaceId}
			AND page_id = ${pageId}
			AND status = 'verified'
		RETURNING
			id,
			workspace_id AS "workspaceId",
			page_id AS "pageId",
			status,
			verified_by AS "verifiedBy",
			verified_at::text AS "verifiedAt",
			expires_at::text AS "expiresAt",
			note,
			created_at::text AS "createdAt",
			updated_at::text AS "updatedAt",
			version
	`
	return row ?? null
}

export async function markDocVerificationNotified(
	tx: Queryable,
	workspaceId: string,
	pageId: string
): Promise<boolean> {
	const rows = await tx<{ id: string }[]>`
		UPDATE doc_verifications
		SET expiry_notified_at = now()
		WHERE workspace_id = ${workspaceId}
			AND page_id = ${pageId}
			AND expiry_notified_at IS NULL
		RETURNING id
	`
	return rows.length > 0
}

// ---------- Publish to Web ----------

export async function getDocPublicShareByPageId(
	tx: Queryable,
	workspaceId: string,
	pageId: string
): Promise<DocPublicShareDto | null> {
	const [row] = await tx<DocPublicShareDto[]>`
		SELECT
			id,
			workspace_id AS "workspaceId",
			page_id AS "pageId",
			public_slug AS "publicSlug",
			include_children AS "includeChildren",
			allow_search_indexing AS "allowSearchIndexing",
			(password_hash IS NOT NULL) AS "hasPassword",
			expires_at::text AS "expiresAt",
			revoked_at::text AS "revokedAt",
			created_by AS "createdBy",
			created_at::text AS "createdAt",
			updated_at::text AS "updatedAt",
			version
		FROM doc_public_shares
		WHERE workspace_id = ${workspaceId} AND page_id = ${pageId} AND revoked_at IS NULL
	`
	return row ?? null
}

export async function publicShareSlugExists(
	tx: Queryable,
	workspaceId: string,
	publicSlug: string,
	excludePageId?: string
): Promise<boolean> {
	const rows = excludePageId
		? await tx<{ id: string }[]>`
				SELECT id FROM doc_public_shares
				WHERE workspace_id = ${workspaceId}
					AND public_slug = ${publicSlug}
					AND page_id <> ${excludePageId}
			`
		: await tx<{ id: string }[]>`
				SELECT id FROM doc_public_shares
				WHERE workspace_id = ${workspaceId}
					AND public_slug = ${publicSlug}
			`
	return rows.length > 0
}

export async function upsertDocPublicShareRow(
	tx: Queryable,
	args: {
		readonly workspaceId: string
		readonly pageId: string
		readonly publicSlug: string
		readonly includeChildren: boolean
		readonly allowSearchIndexing: boolean
		readonly passwordHash: string | null | undefined
		readonly keepExistingPassword: boolean
		readonly expiresAt: string | null
		readonly createdBy: string
	}
): Promise<DocPublicShareDto> {
	const passwordExpr = args.keepExistingPassword
		? tx`doc_public_shares.password_hash`
		: args.passwordHash
			? tx`${args.passwordHash}`
			: tx`NULL`

	const [row] = await tx<DocPublicShareDto[]>`
		INSERT INTO doc_public_shares (
			workspace_id, page_id, public_slug, include_children, allow_search_indexing,
			password_hash, expires_at, revoked_at, created_by
		)
		VALUES (
			${args.workspaceId},
			${args.pageId},
			${args.publicSlug},
			${args.includeChildren},
			${args.allowSearchIndexing},
			${args.passwordHash ?? null},
			${args.expiresAt ? tx`${args.expiresAt}::timestamptz` : tx`NULL`},
			NULL,
			${args.createdBy}
		)
		ON CONFLICT (workspace_id, page_id) DO UPDATE SET
			public_slug = EXCLUDED.public_slug,
			include_children = EXCLUDED.include_children,
			allow_search_indexing = EXCLUDED.allow_search_indexing,
			password_hash = ${passwordExpr},
			expires_at = EXCLUDED.expires_at,
			revoked_at = NULL,
			version = doc_public_shares.version + 1
		RETURNING
			id,
			workspace_id AS "workspaceId",
			page_id AS "pageId",
			public_slug AS "publicSlug",
			include_children AS "includeChildren",
			allow_search_indexing AS "allowSearchIndexing",
			(password_hash IS NOT NULL) AS "hasPassword",
			expires_at::text AS "expiresAt",
			revoked_at::text AS "revokedAt",
			created_by AS "createdBy",
			created_at::text AS "createdAt",
			updated_at::text AS "updatedAt",
			version
	`
	if (!row) throw new Error('Failed to upsert public doc share')
	return row
}

export async function revokeDocPublicShareRow(
	tx: Queryable,
	workspaceId: string,
	pageId: string
): Promise<DocPublicShareDto | null> {
	const [row] = await tx<DocPublicShareDto[]>`
		UPDATE doc_public_shares
		SET revoked_at = now(),
			version = version + 1
		WHERE workspace_id = ${workspaceId} AND page_id = ${pageId} AND revoked_at IS NULL
		RETURNING
			id,
			workspace_id AS "workspaceId",
			page_id AS "pageId",
			public_slug AS "publicSlug",
			include_children AS "includeChildren",
			allow_search_indexing AS "allowSearchIndexing",
			(password_hash IS NOT NULL) AS "hasPassword",
			expires_at::text AS "expiresAt",
			revoked_at::text AS "revokedAt",
			created_by AS "createdBy",
			created_at::text AS "createdAt",
			updated_at::text AS "updatedAt",
			version
	`
	return row ?? null
}

export async function listDocDescendantsWithState(
	tx: Queryable,
	workspaceId: string,
	rootPath: string
): Promise<
	Array<{
		readonly id: string
		readonly title: string
		readonly slug: string
		readonly icon: string | null
		readonly state: Buffer | null
	}>
> {
	return tx`
		SELECT
			dp.id,
			dp.title,
			dp.slug,
			dp.icon,
			ds.state
		FROM doc_pages dp
		LEFT JOIN doc_state ds ON ds.workspace_id = dp.workspace_id AND ds.page_id = dp.id
		WHERE dp.workspace_id = ${workspaceId}
			AND dp.archived_at IS NULL
			AND dp.path LIKE ${`${rootPath}/%`}
		ORDER BY dp.depth ASC, dp.position COLLATE "C" ASC, dp.id ASC
		LIMIT 50
	`
}
