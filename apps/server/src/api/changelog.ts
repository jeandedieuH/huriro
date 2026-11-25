/**
 * Commit-ordered workspace change log writer (§8.5, §9.2).
 *
 * MUST be invoked as the LAST write inside a `withWorkspace` transaction:
 * the single-row UPDATE on `workspace_seq` serializes workspace writers until
 * COMMIT, ensuring cursor order === commit order and gap-free incremental sync.
 */
import type { SyncAction, SyncEntityType } from '@huriro/contracts'
import type { Queryable } from '@huriro/db'
import { changeLogWriteMs } from './observability'

export interface ChangeLogEntry {
	// `entity_link` is written for ADR-0033 graph edges ahead of the sync-v2
	// consumer (slice S6); the column is unconstrained text and sync filters it out.
	readonly entityType: SyncEntityType | 'entity_link'
	readonly entityId: string
	readonly action: SyncAction
	readonly scope?: readonly string[]
	readonly payload: Record<string, unknown> | null
	readonly actorId?: string | null
}

export async function appendChanges(
	tx: Queryable,
	workspaceId: string,
	entries: readonly ChangeLogEntry[]
): Promise<number> {
	if (entries.length === 0) {
		const [row] = await tx<{ lastCursor: string | number }[]>`
			SELECT last_cursor AS "lastCursor" FROM workspace_seq WHERE workspace_id = ${workspaceId}
		`
		return row ? Number(row.lastCursor) : 0
	}

	const start = performance.now()
	// Bound lock wait under serialization contention (§9.2).
	await tx`SET LOCAL lock_timeout = '2s'`

	const [seq] = await tx<{ lastCursor: string | number }[]>`
		UPDATE workspace_seq
		SET last_cursor = last_cursor + ${entries.length}
		WHERE workspace_id = ${workspaceId}
		RETURNING last_cursor AS "lastCursor"
	`
	if (!seq) {
		throw new Error(`Missing workspace_seq row for workspace ${workspaceId}`)
	}

	const endCursor = Number(seq.lastCursor)
	const startCursor = endCursor - entries.length + 1

	// ONE multi-row INSERT: cursors map 1:1 to entry order via WITH ORDINALITY.
	await tx`
		INSERT INTO change_log (workspace_id, cursor, entity_type, entity_id, action, scope, payload, actor_id)
		SELECT
			${workspaceId},
			${startCursor} + a.ord - 1,
			a.et,
			a.eid,
			a.act,
			COALESCE(ARRAY(SELECT jsonb_array_elements_text(sc.el)), '{}'::text[]),
			p.pl,
			a.actor
		FROM unnest(
			${entries.map((e) => e.entityType)}::text[],
			${entries.map((e) => e.entityId)}::uuid[],
			${entries.map((e) => e.action)}::text[],
			${entries.map((e) => e.actorId ?? null)}::uuid[]
		) WITH ORDINALITY AS a(et, eid, act, actor, ord)
		JOIN jsonb_array_elements(${tx.json(entries.map((e) => (e.scope ? [...e.scope] : [])) as never)})
			WITH ORDINALITY AS sc(el, ord) ON sc.ord = a.ord
		JOIN jsonb_array_elements(${tx.json(entries.map((e) => e.payload) as never)})
			WITH ORDINALITY AS p(pl, ord) ON p.ord = a.ord
	`

	changeLogWriteMs.observe(performance.now() - start)
	return endCursor
}

export function appendChange(tx: Queryable, workspaceId: string, entry: ChangeLogEntry): Promise<number> {
	return appendChanges(tx, workspaceId, [entry])
}
