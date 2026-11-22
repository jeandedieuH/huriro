/**
 * Connection pools (§12.4 role separation).
 *
 * Two pools, two roles, two purposes:
 *   - app pool   → `huriro_app` (NOBYPASSRLS). All request/job traffic, always
 *                  inside `withWorkspace()` for tenant tables.
 *   - owner pool → the migration role (owns the schema). Used ONLY by
 *                  `migrate`, `doctor`, `create-admin`, backup verify —
 *                  never reachable from a request path.
 *
 * PgBouncer transaction mode is compatible because `withWorkspace` uses
 * `set_config(…, true)` (transaction-local), never session `SET` (§12.4).
 */
import postgres from 'postgres'

export type Sql = ReturnType<typeof postgres>

/**
 * The callable query fragment shared by a pool and a transaction.
 * `postgres().begin(tx => …)` hands out a TransactionSql — same tagged-template
 * surface, no pool lifecycle. Repo/service code always takes this type so a tx
 * handle is interchangeable with the pool for query purposes (§12.4).
 */
export type Queryable = Sql | import('postgres').TransactionSql

export interface PoolOptions {
	/** Max connections; API default 10, CLI/worker lower. */
	readonly max?: number | undefined
	/** Statement timeout in ms — a hung query must not hold a pooled conn. */
	readonly statementTimeoutMs?: number | undefined
}

export function createAppPool(databaseUrl: string, opts: PoolOptions = {}): Sql {
	return postgres(databaseUrl, {
		max: opts.max ?? 10,
		prepare: true,
		idle_timeout: 20,
		connect_timeout: 10,
		...(opts.statementTimeoutMs !== undefined
			? { connection: { statement_timeout: opts.statementTimeoutMs } }
			: {})
	})
}

export function createOwnerPool(databaseUrl: string, opts: PoolOptions = {}): Sql {
	return postgres(databaseUrl, {
		max: opts.max ?? 2,
		prepare: true,
		connect_timeout: 10
	})
}

/** Read a `*_FILE` indirection or return the value (§7.5 secrets rule). */
export async function resolveSecret(
	value: string | undefined,
	filePath: string | undefined
): Promise<string> {
	if (filePath) {
		const file = Bun.file(filePath)
		if (await file.exists()) return (await file.text()).trim()
	}
	return value ?? ''
}
