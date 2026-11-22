/**
 * withWorkspace — the single door into tenant-scoped queries (§12.4).
 *
 * Every tenant query runs inside a transaction that sets transaction-local
 * `app.workspace_id` / `app.user_id` via `set_config(name, value, true)` —
 * parameterizable, unlike `SET LOCAL`. Session-scoped `SET` would leak across
 * tenants on a pooled connection; transaction-local cannot.
 *
 * Unset settings make `current_setting(…, true)` return NULL → policies yield
 * NULL → zero rows. The system fails closed by construction.
 */
import type { Queryable, Sql } from './client'

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i

/** Written as `app.user_id` when a system actor has no user (nil-uuid parses cleanly). */
export const NIL_UUID = '00000000-0000-7000-8000-000000000000'

export interface WorkspaceContext {
	readonly workspaceId: string
	/** users.id for attribution and user-scoped policies; nil for system jobs. */
	readonly userId?: string | undefined
	/** Optional: the caller's email (invite-acceptance policy). */
	readonly userEmail?: string | undefined
	readonly requestId?: string | undefined
}

export class TenantContextError extends Error {
	constructor(message: string) {
		super(message)
		this.name = 'TenantContextError'
	}
}

/**
 * Run `fn` inside a transaction pinned to `ctx.workspaceId`.
 * `tx` is a TransactionSql — pass it to repos, never the pool `sql`.
 */
export function withWorkspace<T>(
	sql: Sql,
	ctx: WorkspaceContext,
	fn: (tx: Queryable) => Promise<T>
): Promise<T> {
	if (!UUID_RE.test(ctx.workspaceId)) {
		throw new TenantContextError(`workspace_id must be a uuid, got: ${ctx.workspaceId}`)
	}
	const userId = ctx.userId ?? NIL_UUID
	if (!UUID_RE.test(userId)) {
		throw new TenantContextError(`user_id must be a uuid, got: ${userId}`)
	}
	return sql.begin(async (tx) => {
		// `true` = transaction-local (§12.4). These two calls are the ONLY place
		// tenant context is set — lint forbids raw set_config elsewhere.
		await tx`
			SELECT
				set_config('app.workspace_id', ${ctx.workspaceId}, true),
				set_config('app.user_id', ${userId}, true),
				set_config('app.user_email', ${ctx.userEmail ?? ''}, true),
				set_config('app.request_id', ${ctx.requestId ?? ''}, true)
		`
		return fn(tx)
	})
}

/**
 * Instance-level operations only (auth bootstrap, migrations, admin CLI).
 * Tenant tables return zero rows here — that is the point.
 */
export function withSystem<T>(sql: Sql, fn: (tx: Queryable) => Promise<T>): Promise<T> {
	return sql.begin(async (tx) => {
		await tx`SELECT set_config('app.user_id', ${NIL_UUID}, true)`
		return fn(tx)
	})
}

/** Read the tenant context of the current transaction (diagnostics/tests). */
export async function currentContext(
	tx: Queryable
): Promise<{ workspaceId: string | null; userId: string | null }> {
	const [row] = await tx<{ workspaceId: string | null; userId: string | null }[]>`
		SELECT
			NULLIF(current_setting('app.workspace_id', true), '')::uuid AS "workspaceId",
			NULLIF(current_setting('app.user_id', true), '')::uuid AS "userId"
	`
	return row ?? { workspaceId: null, userId: null }
}
