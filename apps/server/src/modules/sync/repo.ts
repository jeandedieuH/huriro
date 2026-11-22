import type { SyncAction, SyncEntityType } from '@huriro/contracts'
import type { Queryable } from '@huriro/db'

export interface RawChangeLogRow {
	readonly cursor: number
	readonly entityType: SyncEntityType
	readonly entityId: string
	readonly action: SyncAction
	readonly scope: string[]
	readonly payload: Record<string, unknown> | null
	readonly changedAt: string
}

export async function getWorkspaceCursorBounds(
	tx: Queryable,
	workspaceId: string
): Promise<{ readonly lastCursor: number; readonly minLogCursor: number | null }> {
	const [seq] = await tx<{ lastCursor: string | number }[]>`
		SELECT last_cursor AS "lastCursor"
		FROM workspace_seq
		WHERE workspace_id = ${workspaceId}
	`
	const [minRow] = await tx<{ minCursor: string | number | null }[]>`
		SELECT MIN(cursor) AS "minCursor"
		FROM change_log
		WHERE workspace_id = ${workspaceId}
	`
	return {
		lastCursor: seq ? Number(seq.lastCursor) : 0,
		minLogCursor: minRow && minRow.minCursor !== null ? Number(minRow.minCursor) : null
	}
}

export async function readChangeLogAfter(
	tx: Queryable,
	workspaceId: string,
	since: number,
	limit: number
): Promise<{ readonly rows: RawChangeLogRow[]; readonly hasMore: boolean }> {
	const raw = await tx<
		{
			cursor: string | number
			entityType: SyncEntityType
			entityId: string
			action: SyncAction
			scope: string[]
			payload: Record<string, unknown> | null
			changedAt: string
		}[]
	>`
		SELECT
			cursor,
			entity_type AS "entityType",
			entity_id AS "entityId",
			action,
			scope,
			payload,
			changed_at::text AS "changedAt"
		FROM change_log
		WHERE workspace_id = ${workspaceId} AND cursor > ${since}
		ORDER BY cursor ASC
		LIMIT ${limit + 1}
	`
	const hasMore = raw.length > limit
	const sliced = hasMore ? raw.slice(0, limit) : raw
	return {
		rows: sliced.map((r) => ({ ...r, cursor: Number(r.cursor) })),
		hasMore
	}
}

export async function recordClientSyncCursor(
	tx: Queryable,
	workspaceId: string,
	clientId: string,
	cursor: number
): Promise<void> {
	await tx`
		INSERT INTO sync_cursors (workspace_id, client_id, cursor)
		VALUES (${workspaceId}, ${clientId}, ${cursor})
		ON CONFLICT (workspace_id, client_id) DO UPDATE
		SET cursor = GREATEST(sync_cursors.cursor, EXCLUDED.cursor),
			updated_at = now()
	`
}

export async function insertRealtimeTicketRow(
	tx: Queryable,
	args: {
		readonly workspaceId: string
		readonly userId: string
		readonly deviceId: string
		readonly tokenHash: string
		readonly expiresAt: Date
	}
): Promise<void> {
	await tx`
		INSERT INTO realtime_tickets (workspace_id, user_id, device_id, token_hash, expires_at)
		VALUES (${args.workspaceId}, ${args.userId}, ${args.deviceId}, ${args.tokenHash}, ${args.expiresAt.toISOString()}::timestamptz)
	`
}

export async function consumeRealtimeTicketRow(
	tx: Queryable,
	workspaceId: string,
	tokenHash: string
): Promise<{ readonly userId: string; readonly deviceId: string } | null> {
	const [row] = await tx<{ userId: string; deviceId: string }[]>`
		UPDATE realtime_tickets
		SET consumed_at = now()
		WHERE workspace_id = ${workspaceId}
			AND token_hash = ${tokenHash}
			AND consumed_at IS NULL
			AND expires_at > now()
		RETURNING user_id AS "userId", device_id AS "deviceId"
	`
	return row ?? null
}
