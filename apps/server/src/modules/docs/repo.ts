/**
 * Docs persistence layer (§7.3, §8.4, §10): explicit column lists everywhere
 * (no SELECT *), composite workspace predicates, room lease fencing, and
 * version checkpoint retention.
 */
import type {
	DocCommentDto,
	DocHeadingDto,
	DocPageDto,
	DocVersionDto,
	DocVersionKind,
	DocVisibility
} from '@huriro/contracts'
import type { Queryable } from '@huriro/db'

export interface RawDocStateRow {
	readonly workspaceId: string
	readonly pageId: string
	readonly state: Buffer
	readonly stateVector: Buffer
	readonly byteSize: number
	readonly leaseEpoch: number
	readonly plainText: string
	readonly headings: DocHeadingDto[]
	readonly createdAt: string
	readonly updatedAt: string
}

export async function listVisibleDocPages(
	tx: Queryable,
	args: {
		readonly workspaceId: string
		readonly userId: string
		readonly isGuest: boolean
		readonly bypassAcl: boolean
		readonly includeArchived: boolean
		readonly includeTemplates: boolean
		readonly parentId?: string | undefined
	}
): Promise<DocPageDto[]> {
	const archiveFilter = args.includeArchived ? tx`` : tx`AND dp.archived_at IS NULL`
	const templateFilter = args.includeTemplates ? tx`` : tx`AND dp.is_template = false`
	const parentFilter = args.parentId ? tx`AND dp.parent_id = ${args.parentId}` : tx``

	if (args.bypassAcl) {
		return tx<DocPageDto[]>`
			SELECT
				dp.id,
				dp.workspace_id AS "workspaceId",
				dp.parent_id AS "parentId",
				dp.path,
				dp.depth,
				dp.slug,
				dp.title,
				dp.icon,
				dp.visibility,
				dp.is_template AS "isTemplate",
				EXISTS(
					SELECT 1 FROM doc_favorites df
					WHERE df.workspace_id = dp.workspace_id AND df.page_id = dp.id AND df.user_id = ${args.userId}
				) AS "isFavorite",
				dp.position,
				dp.created_by AS "createdBy",
				dp.archived_at::text AS "archivedAt",
				dp.created_at::text AS "createdAt",
				dp.updated_at::text AS "updatedAt",
				dp.version,
				COALESCE(ds.byte_size, 0) AS "byteSize"
			FROM doc_pages dp
			LEFT JOIN doc_state ds ON ds.workspace_id = dp.workspace_id AND ds.page_id = dp.id
			WHERE dp.workspace_id = ${args.workspaceId}
				${archiveFilter}
				${templateFilter}
				${parentFilter}
			ORDER BY dp.depth ASC, dp.position COLLATE "C" ASC, dp.id ASC
		`
	}

	const aclFilter = args.isGuest
		? tx`AND can_read(dp.workspace_id, 'doc_page', dp.id, ${args.userId}, 'read')`
		: tx`AND (dp.visibility = 'workspace' OR can_read(dp.workspace_id, 'doc_page', dp.id, ${args.userId}, 'read'))`

	return tx<DocPageDto[]>`
		SELECT
			dp.id,
			dp.workspace_id AS "workspaceId",
			dp.parent_id AS "parentId",
			dp.path,
			dp.depth,
			dp.slug,
			dp.title,
			dp.icon,
			dp.visibility,
			dp.is_template AS "isTemplate",
			EXISTS(
				SELECT 1 FROM doc_favorites df
				WHERE df.workspace_id = dp.workspace_id AND df.page_id = dp.id AND df.user_id = ${args.userId}
			) AS "isFavorite",
			dp.position,
			dp.created_by AS "createdBy",
			dp.archived_at::text AS "archivedAt",
			dp.created_at::text AS "createdAt",
			dp.updated_at::text AS "updatedAt",
			dp.version,
			COALESCE(ds.byte_size, 0) AS "byteSize"
		FROM doc_pages dp
		LEFT JOIN doc_state ds ON ds.workspace_id = dp.workspace_id AND ds.page_id = dp.id
		WHERE dp.workspace_id = ${args.workspaceId}
			${archiveFilter}
			${templateFilter}
			${parentFilter}
			${aclFilter}
		ORDER BY dp.depth ASC, dp.position COLLATE "C" ASC, dp.id ASC
	`
}

export async function getDocPageById(
	tx: Queryable,
	workspaceId: string,
	pageId: string,
	userId: string
): Promise<DocPageDto | null> {
	const [row] = await tx<DocPageDto[]>`
		SELECT
			dp.id,
			dp.workspace_id AS "workspaceId",
			dp.parent_id AS "parentId",
			dp.path,
			dp.depth,
			dp.slug,
			dp.title,
			dp.icon,
			dp.visibility,
			dp.is_template AS "isTemplate",
			EXISTS(
				SELECT 1 FROM doc_favorites df
				WHERE df.workspace_id = dp.workspace_id AND df.page_id = dp.id AND df.user_id = ${userId}
			) AS "isFavorite",
			dp.position,
			dp.created_by AS "createdBy",
			dp.archived_at::text AS "archivedAt",
			dp.created_at::text AS "createdAt",
			dp.updated_at::text AS "updatedAt",
			dp.version,
			COALESCE(ds.byte_size, 0) AS "byteSize"
		FROM doc_pages dp
		LEFT JOIN doc_state ds ON ds.workspace_id = dp.workspace_id AND ds.page_id = dp.id
		WHERE dp.workspace_id = ${workspaceId} AND dp.id = ${pageId}
	`
	return row ?? null
}

export async function getDocPageBySlug(
	tx: Queryable,
	workspaceId: string,
	slug: string,
	userId: string
): Promise<DocPageDto | null> {
	const [row] = await tx<DocPageDto[]>`
		SELECT
			dp.id,
			dp.workspace_id AS "workspaceId",
			dp.parent_id AS "parentId",
			dp.path,
			dp.depth,
			dp.slug,
			dp.title,
			dp.icon,
			dp.visibility,
			dp.is_template AS "isTemplate",
			EXISTS(
				SELECT 1 FROM doc_favorites df
				WHERE df.workspace_id = dp.workspace_id AND df.page_id = dp.id AND df.user_id = ${userId}
			) AS "isFavorite",
			dp.position,
			dp.created_by AS "createdBy",
			dp.archived_at::text AS "archivedAt",
			dp.created_at::text AS "createdAt",
			dp.updated_at::text AS "updatedAt",
			dp.version,
			COALESCE(ds.byte_size, 0) AS "byteSize"
		FROM doc_pages dp
		LEFT JOIN doc_state ds ON ds.workspace_id = dp.workspace_id AND ds.page_id = dp.id
		WHERE dp.workspace_id = ${workspaceId} AND dp.slug = ${slug}
	`
	return row ?? null
}

export async function docSlugExists(
	tx: Queryable,
	workspaceId: string,
	slug: string,
	excludeId?: string
): Promise<boolean> {
	const rows = excludeId
		? await tx<{ id: string }[]>`
				SELECT id FROM doc_pages WHERE workspace_id = ${workspaceId} AND slug = ${slug} AND id <> ${excludeId}
			`
		: await tx<{ id: string }[]>`
				SELECT id FROM doc_pages WHERE workspace_id = ${workspaceId} AND slug = ${slug}
			`
	return rows.length > 0
}

export async function getLastSiblingDocPosition(
	tx: Queryable,
	workspaceId: string,
	parentId: string | null
): Promise<string | null> {
	const [row] = parentId
		? await tx<{ position: string }[]>`
				SELECT position FROM doc_pages
				WHERE workspace_id = ${workspaceId} AND parent_id = ${parentId} AND archived_at IS NULL
				ORDER BY position COLLATE "C" DESC, id DESC
				LIMIT 1
			`
		: await tx<{ position: string }[]>`
				SELECT position FROM doc_pages
				WHERE workspace_id = ${workspaceId} AND parent_id IS NULL AND archived_at IS NULL
				ORDER BY position COLLATE "C" DESC, id DESC
				LIMIT 1
			`
	return row?.position ?? null
}

export async function listSiblingDocPositions(
	tx: Queryable,
	workspaceId: string,
	parentId: string | null
): Promise<Array<{ readonly id: string; readonly position: string }>> {
	return parentId
		? tx<Array<{ id: string; position: string }>>`
				SELECT id, position FROM doc_pages
				WHERE workspace_id = ${workspaceId} AND parent_id = ${parentId} AND archived_at IS NULL
				ORDER BY position COLLATE "C" ASC, id ASC
			`
		: tx<Array<{ id: string; position: string }>>`
				SELECT id, position FROM doc_pages
				WHERE workspace_id = ${workspaceId} AND parent_id IS NULL AND archived_at IS NULL
				ORDER BY position COLLATE "C" ASC, id ASC
			`
}

export async function updateDocPositionOnly(
	tx: Queryable,
	workspaceId: string,
	pageId: string,
	position: string
): Promise<void> {
	await tx`
		UPDATE doc_pages
		SET position = ${position}
		WHERE workspace_id = ${workspaceId} AND id = ${pageId}
	`
}

export async function insertDocPageRow(
	tx: Queryable,
	args: {
		readonly id?: string | undefined
		readonly workspaceId: string
		readonly parentId: string | null
		readonly path: string
		readonly depth: number
		readonly slug: string
		readonly title: string
		readonly icon: string | null
		readonly visibility: DocVisibility
		readonly isTemplate: boolean
		readonly position: string
		readonly createdBy: string
		readonly byteSize: number
	}
): Promise<DocPageDto> {
	const [row] = await tx<Omit<DocPageDto, 'isFavorite' | 'byteSize'>[]>`
		INSERT INTO doc_pages (
			${args.id ? tx`id, ` : tx``}
			workspace_id, parent_id, path, depth, slug, title, icon, visibility, is_template, position, created_by
		)
		VALUES (
			${args.id ? tx`${args.id}, ` : tx``}
			${args.workspaceId},
			${args.parentId},
			${args.path},
			${args.depth},
			${args.slug},
			${args.title},
			${args.icon},
			${args.visibility},
			${args.isTemplate},
			${args.position},
			${args.createdBy}
		)
		RETURNING
			id,
			workspace_id AS "workspaceId",
			parent_id AS "parentId",
			path,
			depth,
			slug,
			title,
			icon,
			visibility,
			is_template AS "isTemplate",
			position,
			created_by AS "createdBy",
			archived_at::text AS "archivedAt",
			created_at::text AS "createdAt",
			updated_at::text AS "updatedAt",
			version
	`
	if (!row) throw new Error('Failed to insert doc_pages row')
	return { ...row, isFavorite: false, byteSize: args.byteSize }
}

export async function insertDocStateRow(
	tx: Queryable,
	args: {
		readonly workspaceId: string
		readonly pageId: string
		readonly state: Uint8Array
		readonly stateVector: Uint8Array
		readonly byteSize: number
		readonly plainText: string
		readonly headings: readonly DocHeadingDto[]
	}
): Promise<void> {
	await tx`
		INSERT INTO doc_state (
			workspace_id, page_id, state, state_vector, byte_size, lease_epoch, plain_text, headings
		)
		VALUES (
			${args.workspaceId},
			${args.pageId},
			${Buffer.from(args.state)},
			${Buffer.from(args.stateVector)},
			${args.byteSize},
			0,
			${args.plainText},
			${tx.json(args.headings as never)}
		)
	`
}

export async function getDocStateRow(
	tx: Queryable,
	workspaceId: string,
	pageId: string
): Promise<RawDocStateRow | null> {
	const [row] = await tx<(Omit<RawDocStateRow, 'leaseEpoch'> & { leaseEpoch: string | number })[]>`
		SELECT
			workspace_id AS "workspaceId",
			page_id AS "pageId",
			state,
			state_vector AS "stateVector",
			byte_size AS "byteSize",
			lease_epoch AS "leaseEpoch",
			plain_text AS "plainText",
			headings,
			created_at::text AS "createdAt",
			updated_at::text AS "updatedAt"
		FROM doc_state
		WHERE workspace_id = ${workspaceId} AND page_id = ${pageId}
	`
	if (!row) return null
	return { ...row, leaseEpoch: Number(row.leaseEpoch) }
}

export async function saveUnfencedDocState(
	tx: Queryable,
	args: {
		readonly workspaceId: string
		readonly pageId: string
		readonly state: Uint8Array
		readonly stateVector: Uint8Array
		readonly byteSize: number
		readonly plainText: string
		readonly headings: readonly DocHeadingDto[]
	}
): Promise<void> {
	await tx`
		UPDATE doc_state
		SET state = ${Buffer.from(args.state)},
			state_vector = ${Buffer.from(args.stateVector)},
			byte_size = ${args.byteSize},
			plain_text = ${args.plainText},
			headings = ${tx.json(args.headings as never)}
		WHERE workspace_id = ${args.workspaceId} AND page_id = ${args.pageId}
	`
	await tx`
		UPDATE doc_pages
		SET updated_at = now()
		WHERE workspace_id = ${args.workspaceId} AND id = ${args.pageId}
	`
}

export async function saveFencedDocState(
	tx: Queryable,
	args: {
		readonly workspaceId: string
		readonly pageId: string
		readonly nodeId: string
		readonly leaseEpoch: number
		readonly state: Uint8Array
		readonly stateVector: Uint8Array
		readonly byteSize: number
		readonly plainText: string
		readonly headings: readonly DocHeadingDto[]
	}
): Promise<{ readonly fenced: boolean; readonly currentEpoch: number }> {
	const [lease] = await tx<{ nodeId: string; epoch: string | number }[]>`
		SELECT node_id AS "nodeId", epoch
		FROM doc_room_leases
		WHERE workspace_id = ${args.workspaceId} AND page_id = ${args.pageId}
		FOR SHARE
	`
	if (lease && (lease.nodeId !== args.nodeId || Number(lease.epoch) !== args.leaseEpoch)) {
		return { fenced: true, currentEpoch: Number(lease.epoch) }
	}

	const updated = await tx<{ leaseEpoch: string | number }[]>`
		UPDATE doc_state
		SET state = ${Buffer.from(args.state)},
			state_vector = ${Buffer.from(args.stateVector)},
			byte_size = ${args.byteSize},
			lease_epoch = ${args.leaseEpoch},
			plain_text = ${args.plainText},
			headings = ${tx.json(args.headings as never)}
		WHERE workspace_id = ${args.workspaceId}
			AND page_id = ${args.pageId}
			AND lease_epoch <= ${args.leaseEpoch}
		RETURNING lease_epoch AS "leaseEpoch"
	`
	if (updated.length === 0) {
		const [existing] = await tx<{ leaseEpoch: string | number }[]>`
			SELECT lease_epoch AS "leaseEpoch"
			FROM doc_state
			WHERE workspace_id = ${args.workspaceId} AND page_id = ${args.pageId}
		`
		return { fenced: true, currentEpoch: existing ? Number(existing.leaseEpoch) : args.leaseEpoch }
	}

	await tx`
		UPDATE doc_pages
		SET updated_at = now()
		WHERE workspace_id = ${args.workspaceId} AND id = ${args.pageId}
	`
	return { fenced: false, currentEpoch: args.leaseEpoch }
}

export async function updateDocPageRow(
	tx: Queryable,
	args: {
		readonly workspaceId: string
		readonly pageId: string
		readonly userId: string
		readonly expectedVersion: number
		readonly title: string
		readonly slug: string
		readonly icon: string | null
		readonly visibility: DocVisibility
		readonly isTemplate: boolean
		readonly archivedAt: string | null
	}
): Promise<DocPageDto | null> {
	const rows = await tx<{ id: string }[]>`
		UPDATE doc_pages
		SET title = ${args.title},
			slug = ${args.slug},
			icon = ${args.icon},
			visibility = ${args.visibility},
			is_template = ${args.isTemplate},
			archived_at = ${args.archivedAt ? tx`${args.archivedAt}::timestamptz` : tx`NULL`},
			version = version + 1
		WHERE workspace_id = ${args.workspaceId}
			AND id = ${args.pageId}
			AND version = ${args.expectedVersion}
		RETURNING id
	`
	if (rows.length === 0) return null
	return getDocPageById(tx, args.workspaceId, args.pageId, args.userId)
}

export async function updateDocPageParentAndPosition(
	tx: Queryable,
	args: {
		readonly workspaceId: string
		readonly pageId: string
		readonly userId: string
		readonly expectedVersion: number
		readonly newParentId: string | null
		readonly newPosition: string
		readonly oldPath: string
		readonly newPath: string
		readonly oldDepth: number
		readonly newDepth: number
	}
): Promise<{ readonly updated: DocPageDto | null; readonly movedIds: string[] }> {
	const [root] = await tx<{ id: string }[]>`
		UPDATE doc_pages
		SET parent_id = ${args.newParentId},
			path = ${args.newPath},
			depth = ${args.newDepth},
			position = ${args.newPosition},
			version = version + 1
		WHERE workspace_id = ${args.workspaceId}
			AND id = ${args.pageId}
			AND version = ${args.expectedVersion}
		RETURNING id
	`
	if (!root) return { updated: null, movedIds: [] }

	const movedIds = [args.pageId]
	if (args.oldPath !== args.newPath || args.oldDepth !== args.newDepth) {
		const prefix = `${args.oldPath}/`
		const depthDelta = args.newDepth - args.oldDepth
		const descendants = await tx<{ id: string; path: string; depth: number }[]>`
			SELECT id, path, depth
			FROM doc_pages
			WHERE workspace_id = ${args.workspaceId}
				AND path LIKE ${`${prefix}%`}
			ORDER BY depth ASC
		`
		for (const desc of descendants) {
			const updatedPath = `${args.newPath}${desc.path.slice(args.oldPath.length)}`
			const updatedDepth = desc.depth + depthDelta
			await tx`
				UPDATE doc_pages
				SET path = ${updatedPath},
					depth = ${updatedDepth},
					version = version + 1
				WHERE workspace_id = ${args.workspaceId} AND id = ${desc.id}
			`
			movedIds.push(desc.id)
		}
	}

	const updated = await getDocPageById(tx, args.workspaceId, args.pageId, args.userId)
	return { updated, movedIds }
}

export async function getSubtreeMaxDepth(
	tx: Queryable,
	workspaceId: string,
	rootPath: string
): Promise<number> {
	const [row] = await tx<{ maxDepth: number }[]>`
		SELECT COALESCE(MAX(depth), 0)::int AS "maxDepth"
		FROM doc_pages
		WHERE workspace_id = ${workspaceId}
			AND (path = ${rootPath} OR path LIKE ${`${rootPath}/%`})
	`
	return row?.maxDepth ?? 0
}

export async function archiveDocSubtreeRows(
	tx: Queryable,
	workspaceId: string,
	rootPath: string
): Promise<Array<{ readonly id: string; readonly title: string; readonly slug: string }>> {
	return tx<Array<{ id: string; title: string; slug: string }>>`
		UPDATE doc_pages
		SET archived_at = now(),
			version = version + 1
		WHERE workspace_id = ${workspaceId}
			AND (path = ${rootPath} OR path LIKE ${`${rootPath}/%`})
			AND archived_at IS NULL
		RETURNING id, title, slug
	`
}

export async function setDocFavoriteRow(
	tx: Queryable,
	workspaceId: string,
	userId: string,
	pageId: string,
	favorite: boolean
): Promise<void> {
	if (favorite) {
		await tx`
			INSERT INTO doc_favorites (workspace_id, user_id, page_id)
			VALUES (${workspaceId}, ${userId}, ${pageId})
			ON CONFLICT (workspace_id, user_id, page_id) DO NOTHING
		`
	} else {
		await tx`
			DELETE FROM doc_favorites
			WHERE workspace_id = ${workspaceId} AND user_id = ${userId} AND page_id = ${pageId}
		`
	}
}

// ---------- Room leases (§10.5) ----------

export async function acquireOrRenewRoomLease(
	tx: Queryable,
	args: {
		readonly workspaceId: string
		readonly pageId: string
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
		INSERT INTO doc_room_leases (workspace_id, page_id, node_id, epoch, expires_at)
		VALUES (${args.workspaceId}, ${args.pageId}, ${args.nodeId}, 1, ${expiresAt}::timestamptz)
		ON CONFLICT (page_id) DO UPDATE SET
			node_id = CASE
				WHEN doc_room_leases.expires_at < now() OR doc_room_leases.node_id = EXCLUDED.node_id
				THEN EXCLUDED.node_id
				ELSE doc_room_leases.node_id
			END,
			epoch = CASE
				WHEN doc_room_leases.expires_at < now() THEN doc_room_leases.epoch + 1
				ELSE doc_room_leases.epoch
			END,
			expires_at = CASE
				WHEN doc_room_leases.expires_at < now() OR doc_room_leases.node_id = EXCLUDED.node_id
				THEN EXCLUDED.expires_at
				ELSE doc_room_leases.expires_at
			END
		RETURNING node_id AS "nodeId", epoch, expires_at::text AS "expiresAt"
	`
	if (!row) throw new Error('Failed to acquire or renew room lease')
	return {
		acquired: row.nodeId === args.nodeId,
		nodeId: row.nodeId,
		epoch: Number(row.epoch),
		expiresAt: row.expiresAt
	}
}

export async function expireRoomLease(
	tx: Queryable,
	args: {
		readonly workspaceId: string
		readonly pageId: string
		readonly nodeId: string
		readonly epoch: number
	}
): Promise<void> {
	// Mark expired instead of deleting so monotonic epoch never resets to 1.
	await tx`
		UPDATE doc_room_leases
		SET expires_at = now() - interval '1 second'
		WHERE workspace_id = ${args.workspaceId}
			AND page_id = ${args.pageId}
			AND node_id = ${args.nodeId}
			AND epoch = ${args.epoch}
	`
}

// ---------- Collab tickets (§10.3) ----------

export async function insertCollabTicketRow(
	tx: Queryable,
	args: {
		readonly id: string
		readonly workspaceId: string
		readonly pageId: string
		readonly userId: string
		readonly permission: 'read' | 'write'
		readonly tokenHash: string
		readonly expiresAt: Date
	}
): Promise<void> {
	await tx`
		INSERT INTO collab_tickets (id, workspace_id, page_id, user_id, permission, token_hash, expires_at)
		VALUES (
			${args.id},
			${args.workspaceId},
			${args.pageId},
			${args.userId},
			${args.permission},
			${args.tokenHash},
			${args.expiresAt.toISOString()}::timestamptz
		)
	`
}

export async function consumeCollabTicketRow(
	tx: Queryable,
	args: {
		readonly workspaceId: string
		readonly ticketId: string
		readonly pageId: string
		readonly userId: string
		readonly tokenHash: string
	}
): Promise<{ readonly permission: 'read' | 'write' } | null> {
	const [row] = await tx<{ permission: 'read' | 'write' }[]>`
		UPDATE collab_tickets
		SET consumed_at = now()
		WHERE workspace_id = ${args.workspaceId}
			AND id = ${args.ticketId}
			AND page_id = ${args.pageId}
			AND user_id = ${args.userId}
			AND token_hash = ${args.tokenHash}
			AND consumed_at IS NULL
			AND expires_at > now()
		RETURNING permission
	`
	return row ?? null
}

export async function deleteExpiredCollabTickets(tx: Queryable): Promise<number> {
	const rows = await tx<{ id: string }[]>`
		DELETE FROM collab_tickets
		WHERE expires_at < now() - interval '1 hour'
		RETURNING id
	`
	return rows.length
}

// ---------- Versions (§10.4, §8.4) ----------

export async function insertDocVersionRow(
	tx: Queryable,
	args: {
		readonly workspaceId: string
		readonly pageId: string
		readonly kind: DocVersionKind
		readonly label: string | null
		readonly state: Uint8Array
		readonly byteSize: number
		readonly plainText: string
		readonly authors: readonly string[]
		readonly createdBy: string | null
	}
): Promise<DocVersionDto> {
	const [row] = await tx<DocVersionDto[]>`
		INSERT INTO doc_versions (
			workspace_id, page_id, kind, label, state, byte_size, plain_text, authors, created_by
		)
		VALUES (
			${args.workspaceId},
			${args.pageId},
			${args.kind},
			${args.label},
			${Buffer.from(args.state)},
			${args.byteSize},
			${args.plainText},
			${[...args.authors]}::uuid[],
			${args.createdBy}
		)
		RETURNING
			id,
			workspace_id AS "workspaceId",
			page_id AS "pageId",
			kind,
			label,
			byte_size AS "byteSize",
			plain_text AS "plainText",
			authors,
			created_by AS "createdBy",
			created_at::text AS "createdAt"
	`
	if (!row) throw new Error('Failed to insert doc_versions row')
	return row
}

export async function getLatestAutoDocVersion(
	tx: Queryable,
	workspaceId: string,
	pageId: string
): Promise<{ readonly id: string; readonly createdAtMs: number; readonly plainText: string } | null> {
	const [row] = await tx<{ id: string; createdAt: string; plainText: string }[]>`
		SELECT id, created_at::text AS "createdAt", plain_text AS "plainText"
		FROM doc_versions
		WHERE workspace_id = ${workspaceId} AND page_id = ${pageId} AND kind = 'auto'
		ORDER BY created_at DESC, id DESC
		LIMIT 1
	`
	if (!row) return null
	return { id: row.id, createdAtMs: Date.parse(row.createdAt), plainText: row.plainText }
}

export async function listDocVersionRows(
	tx: Queryable,
	workspaceId: string,
	pageId: string
): Promise<DocVersionDto[]> {
	return tx<DocVersionDto[]>`
		SELECT
			id,
			workspace_id AS "workspaceId",
			page_id AS "pageId",
			kind,
			label,
			byte_size AS "byteSize",
			plain_text AS "plainText",
			authors,
			created_by AS "createdBy",
			created_at::text AS "createdAt"
		FROM doc_versions
		WHERE workspace_id = ${workspaceId} AND page_id = ${pageId}
		ORDER BY created_at DESC, id DESC
		LIMIT 200
	`
}

export async function getDocVersionWithState(
	tx: Queryable,
	workspaceId: string,
	pageId: string,
	versionId: string
): Promise<(DocVersionDto & { readonly state: Buffer }) | null> {
	const [row] = await tx<(DocVersionDto & { state: Buffer })[]>`
		SELECT
			id,
			workspace_id AS "workspaceId",
			page_id AS "pageId",
			kind,
			label,
			state,
			byte_size AS "byteSize",
			plain_text AS "plainText",
			authors,
			created_by AS "createdBy",
			created_at::text AS "createdAt"
		FROM doc_versions
		WHERE workspace_id = ${workspaceId} AND page_id = ${pageId} AND id = ${versionId}
	`
	return row ?? null
}

export async function getPreviousDocVersionPlainText(
	tx: Queryable,
	workspaceId: string,
	pageId: string,
	beforeCreatedAt: string,
	excludeId: string
): Promise<string> {
	const [row] = await tx<{ plainText: string }[]>`
		SELECT plain_text AS "plainText"
		FROM doc_versions
		WHERE workspace_id = ${workspaceId}
			AND page_id = ${pageId}
			AND id <> ${excludeId}
			AND created_at <= ${beforeCreatedAt}::timestamptz
		ORDER BY created_at DESC, id DESC
		LIMIT 1
	`
	return row?.plainText ?? ''
}

export async function thinAutoDocVersions(tx: Queryable): Promise<number> {
	// Keep all <7d; keep latest/hour for 7..30d; keep latest/day for >30d.
	// Never thin `named` or `pre_restore` checkpoints (§8.4).
	const deletedHourly = await tx<{ id: string }[]>`
		WITH ranked AS (
			SELECT
				id,
				ROW_NUMBER() OVER (
					PARTITION BY workspace_id, page_id, date_trunc('hour', created_at)
					ORDER BY created_at DESC, id DESC
				) AS rn
			FROM doc_versions
			WHERE kind = 'auto'
				AND created_at < now() - interval '7 days'
				AND created_at >= now() - interval '30 days'
		)
		DELETE FROM doc_versions dv
		USING ranked r
		WHERE dv.id = r.id AND r.rn > 1
		RETURNING dv.id
	`

	const deletedDaily = await tx<{ id: string }[]>`
		WITH ranked AS (
			SELECT
				id,
				ROW_NUMBER() OVER (
					PARTITION BY workspace_id, page_id, date_trunc('day', created_at)
					ORDER BY created_at DESC, id DESC
				) AS rn
			FROM doc_versions
			WHERE kind = 'auto'
				AND created_at < now() - interval '30 days'
		)
		DELETE FROM doc_versions dv
		USING ranked r
		WHERE dv.id = r.id AND r.rn > 1
		RETURNING dv.id
	`

	return deletedHourly.length + deletedDaily.length
}

// ---------- Anchored comments (§10.2) ----------

export async function listDocCommentsForPage(
	tx: Queryable,
	workspaceId: string,
	pageId: string
): Promise<DocCommentDto[]> {
	return tx<DocCommentDto[]>`
		SELECT
			id,
			workspace_id AS "workspaceId",
			page_id AS "pageId",
			parent_id AS "parentId",
			author_type AS "authorType",
			author_id AS "authorId",
			anchor_from AS "anchorFrom",
			anchor_to AS "anchorTo",
			anchor_quote AS "anchorQuote",
			anchor_block_id AS "anchorBlockId",
			anchor_orphaned AS "anchorOrphaned",
			body,
			body_text AS "bodyText",
			resolved_at::text AS "resolvedAt",
			resolved_by AS "resolvedBy",
			created_at::text AS "createdAt",
			updated_at::text AS "updatedAt",
			deleted_at::text AS "deletedAt",
			version
		FROM doc_comments
		WHERE workspace_id = ${workspaceId} AND page_id = ${pageId} AND deleted_at IS NULL
		ORDER BY created_at ASC, id ASC
	`
}

export async function getDocCommentById(
	tx: Queryable,
	workspaceId: string,
	pageId: string,
	commentId: string
): Promise<DocCommentDto | null> {
	const [row] = await tx<DocCommentDto[]>`
		SELECT
			id,
			workspace_id AS "workspaceId",
			page_id AS "pageId",
			parent_id AS "parentId",
			author_type AS "authorType",
			author_id AS "authorId",
			anchor_from AS "anchorFrom",
			anchor_to AS "anchorTo",
			anchor_quote AS "anchorQuote",
			anchor_block_id AS "anchorBlockId",
			anchor_orphaned AS "anchorOrphaned",
			body,
			body_text AS "bodyText",
			resolved_at::text AS "resolvedAt",
			resolved_by AS "resolvedBy",
			created_at::text AS "createdAt",
			updated_at::text AS "updatedAt",
			deleted_at::text AS "deletedAt",
			version
		FROM doc_comments
		WHERE workspace_id = ${workspaceId} AND page_id = ${pageId} AND id = ${commentId}
	`
	return row ?? null
}

export async function insertDocCommentRow(
	tx: Queryable,
	args: {
		readonly id?: string | undefined
		readonly workspaceId: string
		readonly pageId: string
		readonly parentId: string | null
		readonly authorType: 'user' | 'agent'
		readonly authorId: string
		readonly anchorFrom: string | null
		readonly anchorTo: string | null
		readonly anchorQuote: string
		readonly anchorBlockId: string | null
		readonly body: unknown
		readonly bodyText: string
	}
): Promise<DocCommentDto> {
	const [row] = await tx<DocCommentDto[]>`
		INSERT INTO doc_comments (
			${args.id ? tx`id, ` : tx``}
			workspace_id, page_id, parent_id, author_type, author_id,
			anchor_from, anchor_to, anchor_quote, anchor_block_id, body, body_text
		)
		VALUES (
			${args.id ? tx`${args.id}, ` : tx``}
			${args.workspaceId},
			${args.pageId},
			${args.parentId},
			${args.authorType},
			${args.authorId},
			${args.anchorFrom},
			${args.anchorTo},
			${args.anchorQuote},
			${args.anchorBlockId},
			${args.body === undefined || args.body === null ? null : tx.json(args.body as never)},
			${args.bodyText}
		)
		RETURNING
			id,
			workspace_id AS "workspaceId",
			page_id AS "pageId",
			parent_id AS "parentId",
			author_type AS "authorType",
			author_id AS "authorId",
			anchor_from AS "anchorFrom",
			anchor_to AS "anchorTo",
			anchor_quote AS "anchorQuote",
			anchor_block_id AS "anchorBlockId",
			anchor_orphaned AS "anchorOrphaned",
			body,
			body_text AS "bodyText",
			resolved_at::text AS "resolvedAt",
			resolved_by AS "resolvedBy",
			created_at::text AS "createdAt",
			updated_at::text AS "updatedAt",
			deleted_at::text AS "deletedAt",
			version
	`
	if (!row) throw new Error('Failed to insert doc_comments row')
	return row
}

export async function updateDocCommentRow(
	tx: Queryable,
	args: {
		readonly workspaceId: string
		readonly pageId: string
		readonly commentId: string
		readonly expectedVersion: number
		readonly body: unknown
		readonly bodyText: string
	}
): Promise<DocCommentDto | null> {
	const [row] = await tx<DocCommentDto[]>`
		UPDATE doc_comments
		SET body = ${args.body === undefined || args.body === null ? null : tx.json(args.body as never)},
			body_text = ${args.bodyText},
			version = version + 1
		WHERE workspace_id = ${args.workspaceId}
			AND page_id = ${args.pageId}
			AND id = ${args.commentId}
			AND deleted_at IS NULL
			AND version = ${args.expectedVersion}
		RETURNING
			id,
			workspace_id AS "workspaceId",
			page_id AS "pageId",
			parent_id AS "parentId",
			author_type AS "authorType",
			author_id AS "authorId",
			anchor_from AS "anchorFrom",
			anchor_to AS "anchorTo",
			anchor_quote AS "anchorQuote",
			anchor_block_id AS "anchorBlockId",
			anchor_orphaned AS "anchorOrphaned",
			body,
			body_text AS "bodyText",
			resolved_at::text AS "resolvedAt",
			resolved_by AS "resolvedBy",
			created_at::text AS "createdAt",
			updated_at::text AS "updatedAt",
			deleted_at::text AS "deletedAt",
			version
	`
	return row ?? null
}

export async function resolveDocCommentRow(
	tx: Queryable,
	args: {
		readonly workspaceId: string
		readonly pageId: string
		readonly commentId: string
		readonly resolved: boolean
		readonly resolvedBy: string
	}
): Promise<DocCommentDto | null> {
	const [row] = await tx<DocCommentDto[]>`
		UPDATE doc_comments
		SET resolved_at = ${args.resolved ? tx`now()` : tx`NULL`},
			resolved_by = ${args.resolved ? args.resolvedBy : null},
			version = version + 1
		WHERE workspace_id = ${args.workspaceId}
			AND page_id = ${args.pageId}
			AND id = ${args.commentId}
			AND deleted_at IS NULL
		RETURNING
			id,
			workspace_id AS "workspaceId",
			page_id AS "pageId",
			parent_id AS "parentId",
			author_type AS "authorType",
			author_id AS "authorId",
			anchor_from AS "anchorFrom",
			anchor_to AS "anchorTo",
			anchor_quote AS "anchorQuote",
			anchor_block_id AS "anchorBlockId",
			anchor_orphaned AS "anchorOrphaned",
			body,
			body_text AS "bodyText",
			resolved_at::text AS "resolvedAt",
			resolved_by AS "resolvedBy",
			created_at::text AS "createdAt",
			updated_at::text AS "updatedAt",
			deleted_at::text AS "deletedAt",
			version
	`
	return row ?? null
}

export async function softDeleteDocCommentRow(
	tx: Queryable,
	workspaceId: string,
	pageId: string,
	commentId: string
): Promise<boolean> {
	const rows = await tx<{ id: string }[]>`
		UPDATE doc_comments
		SET deleted_at = now(),
			version = version + 1
		WHERE workspace_id = ${workspaceId}
			AND page_id = ${pageId}
			AND id = ${commentId}
			AND deleted_at IS NULL
		RETURNING id
	`
	return rows.length > 0
}

export async function setDocCommentAnchorOrphaned(
	tx: Queryable,
	workspaceId: string,
	commentId: string,
	orphaned: boolean
): Promise<void> {
	await tx`
		UPDATE doc_comments
		SET anchor_orphaned = ${orphaned},
			version = version + 1
		WHERE workspace_id = ${workspaceId}
			AND id = ${commentId}
			AND anchor_orphaned IS DISTINCT FROM ${orphaned}
	`
}

// ---------- Outbox & Audit helpers ----------

export async function emitDocsEvent(
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

export async function auditDocsAction(
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
