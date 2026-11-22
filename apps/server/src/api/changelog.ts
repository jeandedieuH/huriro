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
	readonly entityType: SyncEntityType
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

	for (let i = 0; i < entries.length; i++) {
		const entry = entries[i]
		if (!entry) continue
		const cursor = startCursor + i
		const scope = entry.scope ? [...entry.scope] : []
		await tx`
			INSERT INTO change_log (workspace_id, cursor, entity_type, entity_id, action, scope, payload, actor_id)
			VALUES (
				${workspaceId},
				${cursor},
				${entry.entityType},
				${entry.entityId},
				${entry.action},
				${scope}::text[],
				${entry.payload === null ? null : tx.json(entry.payload as never)},
				${entry.actorId ?? null}
			)
		`
	}

	changeLogWriteMs.observe(performance.now() - start)
	return endCursor
}

export function appendChange(tx: Queryable, workspaceId: string, entry: ChangeLogEntry): Promise<number> {
	return appendChanges(tx, workspaceId, [entry])
}
