/**
 * Shared entity-link write helpers (§7.1, ADR-0033).
 *
 * They live in `api/` — not the graph module — because task/doc/mail services
 * must dual-write edges without importing `modules/graph` (the graph reads back
 * through their seams, so that import would be circular). SQL stays raw here:
 * `packages/db/src/schema/graph.ts` is owned by the graph module.
 */
import type { EntityLinkDto, EntityLinkRelationKind, EntityType } from '@huriro/contracts'
import type { Queryable } from '@huriro/db'
import { appendChange, appendChanges } from './changelog'

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

function linkScope(row: EntityLinkDto): readonly string[] {
	return [`links:${row.sourceType}:${row.sourceId}`, `links:${row.targetType}:${row.targetId}`]
}

export interface EntityLinkInsert {
	readonly workspaceId: string
	readonly sourceType: EntityType
	readonly sourceId: string
	readonly targetType: EntityType
	readonly targetId: string
	readonly relationKind?: EntityLinkRelationKind | undefined
	readonly createdBy?: string | null | undefined
	readonly actorId?: string | null | undefined
}

export interface EntityLinkWriteResult {
	readonly data: EntityLinkDto
	readonly created: boolean
	/** Cursor allocated for the edge write; null when the edge already existed. */
	readonly cursor: number | null
}

/** Idempotently insert one edge and emit its dual-scoped sync change only on creation. */
export async function insertEntityLink(
	tx: Queryable,
	args: EntityLinkInsert
): Promise<EntityLinkWriteResult> {
	const relationKind = args.relationKind ?? 'references'
	const [inserted] = await tx<EntityLinkDto[]>`
		INSERT INTO entity_links (
			workspace_id, source_type, source_id, target_type, target_id, relation_kind, created_by
		)
		VALUES (
			${args.workspaceId}, ${args.sourceType}, ${args.sourceId},
			${args.targetType}, ${args.targetId}, ${relationKind}, ${args.createdBy ?? null}
		)
		ON CONFLICT (workspace_id, source_type, source_id, target_type, target_id, relation_kind)
		DO NOTHING
		RETURNING ${tx.unsafe(LINK_COLUMNS)}
	`

	let row = inserted ?? null
	if (!row) {
		const [existing] = await tx<EntityLinkDto[]>`
			SELECT ${tx.unsafe(LINK_COLUMNS)}
			FROM entity_links
			WHERE workspace_id = ${args.workspaceId}
				AND source_type = ${args.sourceType}
				AND source_id = ${args.sourceId}
				AND target_type = ${args.targetType}
				AND target_id = ${args.targetId}
				AND relation_kind = ${relationKind}
		`
		row = existing ?? null
	}
	if (!row) throw new Error('Failed to insert or read entity_link')
	if (inserted === undefined) {
		return { data: row, created: false, cursor: null }
	}

	const cursor = await appendChange(tx, args.workspaceId, {
		entityType: 'entity_link',
		entityId: row.id,
		action: 'upsert',
		scope: linkScope(row),
		payload: row as unknown as Record<string, unknown>,
		actorId: args.actorId ?? args.createdBy ?? null
	})
	return { data: row, created: true, cursor }
}

async function getEntityLinkForUpdate(
	tx: Queryable,
	workspaceId: string,
	linkId: string
): Promise<EntityLinkDto | null> {
	const [row] = await tx<EntityLinkDto[]>`
		SELECT ${tx.unsafe(LINK_COLUMNS)}
		FROM entity_links
		WHERE workspace_id = ${workspaceId} AND id = ${linkId}
		FOR UPDATE
	`
	return row ?? null
}

/** Delete one edge by id; emits the delete change with both endpoint scopes. */
export async function deleteEntityLink(
	tx: Queryable,
	args: {
		readonly workspaceId: string
		readonly linkId: string
		readonly actorId?: string | null | undefined
	}
): Promise<boolean> {
	const existing = await getEntityLinkForUpdate(tx, args.workspaceId, args.linkId)
	if (!existing) return false
	await tx`
		DELETE FROM entity_links
		WHERE workspace_id = ${args.workspaceId} AND id = ${args.linkId}
	`
	await appendChange(tx, args.workspaceId, {
		entityType: 'entity_link',
		entityId: existing.id,
		action: 'delete',
		scope: linkScope(existing),
		payload: null,
		actorId: args.actorId ?? null
	})
	return true
}

/** Exact-endpoint deletion used by V1 unlink paths during the dual-write window. */
export async function deleteEntityLinkByEndpoints(
	tx: Queryable,
	args: {
		readonly workspaceId: string
		readonly sourceType: EntityType
		readonly sourceId: string
		readonly targetType: EntityType
		readonly targetId: string
		readonly relationKind: EntityLinkRelationKind
		readonly actorId?: string | null | undefined
	}
): Promise<boolean> {
	const [row] = await tx<{ id: string }[]>`
		SELECT id FROM entity_links
		WHERE workspace_id = ${args.workspaceId}
			AND source_type = ${args.sourceType}
			AND source_id = ${args.sourceId}
			AND target_type = ${args.targetType}
			AND target_id = ${args.targetId}
			AND relation_kind = ${args.relationKind}
	`
	if (!row) return false
	return deleteEntityLink(tx, {
		workspaceId: args.workspaceId,
		linkId: row.id,
		actorId: args.actorId ?? null
	})
}

/**
 * Transactional referential cleanup for a polymorphic endpoint (ADR-0033):
 * entity delete paths call this in the same tenant transaction as the entity write.
 */
export async function deleteEntityLinksFor(
	tx: Queryable,
	args: {
		readonly workspaceId: string
		readonly entityType: EntityType
		readonly entityId: string
		readonly actorId?: string | null | undefined
	}
): Promise<number> {
	const rows = await tx<EntityLinkDto[]>`
		SELECT ${tx.unsafe(LINK_COLUMNS)}
		FROM entity_links
		WHERE workspace_id = ${args.workspaceId}
			AND (
				(source_type = ${args.entityType} AND source_id = ${args.entityId})
				OR (target_type = ${args.entityType} AND target_id = ${args.entityId})
			)
		ORDER BY created_at ASC, id ASC
		FOR UPDATE
	`
	if (rows.length === 0) return 0

	await tx`
		DELETE FROM entity_links
		WHERE workspace_id = ${args.workspaceId}
			AND id = ANY(${rows.map((r) => r.id)}::uuid[])
	`
	await appendChanges(
		tx,
		args.workspaceId,
		rows.map((row) => ({
			entityType: 'entity_link' as const,
			entityId: row.id,
			action: 'delete' as const,
			scope: linkScope(row),
			payload: null,
			actorId: args.actorId ?? null
		}))
	)
	return rows.length
}

/** Query existing outgoing edges from a single source entity. */
export async function listEntityLinksBySource(
	tx: Queryable,
	args: {
		readonly workspaceId: string
		readonly sourceType: EntityType
		readonly sourceId: string
		readonly relationKind?: EntityLinkRelationKind | undefined
	}
): Promise<EntityLinkDto[]> {
	const kindFilter = args.relationKind ? tx`AND relation_kind = ${args.relationKind}` : tx``
	return tx<EntityLinkDto[]>`
		SELECT ${tx.unsafe(LINK_COLUMNS)}
		FROM entity_links
		WHERE workspace_id = ${args.workspaceId}
			AND source_type = ${args.sourceType}
			AND source_id = ${args.sourceId}
			${kindFilter}
		ORDER BY created_at ASC, id ASC
	`
}
