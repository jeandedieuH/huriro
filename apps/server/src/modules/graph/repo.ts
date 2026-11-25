import type { EntityLinkDto, EntityType } from '@huriro/contracts'
import type { Queryable } from '@huriro/db'

const LINK_COLUMNS = `
	id,
	workspace_id AS "workspaceId",
	source_type AS "sourceType",
	source_id AS "sourceId",
	target_type AS "targetType",
	target_id AS "targetId",
	relation_kind AS "relationKind",
	created_by AS "createdBy",
	created_at::text AS "createdAt"
`

export async function getEntityLinkRow(
	tx: Queryable,
	workspaceId: string,
	linkId: string
): Promise<EntityLinkDto | null> {
	const [row] = await tx<EntityLinkDto[]>`
		SELECT ${tx.unsafe(LINK_COLUMNS)}
		FROM entity_links
		WHERE workspace_id = ${workspaceId} AND id = ${linkId}
	`
	return row ?? null
}

/** Both directions are queried symmetrically — the edge itself is typed, traversal is not. */
export async function listEntityLinksTouching(
	tx: Queryable,
	workspaceId: string,
	type: EntityType,
	id: string
): Promise<EntityLinkDto[]> {
	return tx<EntityLinkDto[]>`
		SELECT ${tx.unsafe(LINK_COLUMNS)}
		FROM entity_links
		WHERE workspace_id = ${workspaceId}
			AND (
				(source_type = ${type} AND source_id = ${id})
				OR (target_type = ${type} AND target_id = ${id})
			)
		ORDER BY created_at ASC, id ASC
	`
}
