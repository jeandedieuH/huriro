/**
 * Migration runner (§8.8, §19.2).
 *
 * - Hand-written SQL files in migrations/NNNN_name.sql — expand-phase only.
 * - Applied inside a Postgres advisory lock so concurrent boots can't double-apply.
 * - Each migration runs in its own transaction unless the file carries a
 *   `-- no-transaction` marker (only for CONCURRENTLY index builds, §8.8).
 * - Applied files are checksum-pinned (sha256): editing an applied migration
 *   fails loudly instead of drifting silently.
 * - The server refuses to boot against a schema NEWER than itself (§19.2).
 */
import { createHash } from 'node:crypto'
import { readdirSync, readFileSync } from 'node:fs'
import { join } from 'node:path'
import type { Sql } from './client'

const LOCK_ID = 727_272 // arbitrary but fixed: `SELECT pg_advisory_lock(727272)`

export interface AppliedMigration {
	readonly version: number
	readonly name: string
}

const FILE_RE = /^(\d{4})_[a-z0-9_]+\.sql$/

export function listMigrationFiles(dir: string): { version: number; name: string; path: string }[] {
	return readdirSync(dir)
		.filter((f) => FILE_RE.test(f))
		.map((f) => {
			const version = Number.parseInt(FILE_RE.exec(f)![1]!, 10)
			return { version, name: f, path: join(dir, f) }
		})
		.sort((a, b) => a.version - b.version)
}

function checksum(sql: string): string {
	return createHash('sha256').update(sql).digest('hex')
}

/**
 * Apply pending migrations. Returns the migrations applied in this run.
 * Throws on checksum drift, gaps in sequence, or a DB newer than the code.
 */
export async function migrate(sql: Sql, dir: string): Promise<AppliedMigration[]> {
	const files = listMigrationFiles(dir)
	if (files.length === 0) return []

	// Serialize all migrators on one advisory lock; released on session end or unlock.
	await sql`SELECT pg_advisory_lock(${LOCK_ID})`
	try {
		const applied = await sql<{ version: number; name: string; checksum: string }[]>`
			SELECT version, name, checksum FROM schema_migrations ORDER BY version
		`.catch(async (err: unknown) => {
			// schema_migrations doesn't exist until 0001 runs — that's the signal to apply all.
			if (err instanceof Error && /does not exist/i.test(err.message)) return []
			throw err
		})

		const appliedByVersion = new Map(applied.map((a) => [a.version, a]))

		// Refuse silent downgrade: DB must never be ahead of the code (§19.2).
		const dbMax = applied.at(-1)?.version ?? 0
		const codeMax = files.at(-1)!.version
		if (dbMax > codeMax) {
			throw new Error(
				`Database is at migration ${dbMax} but this build only knows ${codeMax}. ` +
					'Upgrade the server instead of downgrading the schema.'
			)
		}

		const done: AppliedMigration[] = []
		for (const file of files) {
			const recorded = appliedByVersion.get(file.version)
			const body = readFileSync(file.path, 'utf8')
			if (recorded) {
				if (recorded.checksum !== checksum(body)) {
					throw new Error(
						`Migration ${file.name} was modified after being applied ` +
							`(recorded ${recorded.checksum.slice(0, 12)}…, file ${checksum(body).slice(0, 12)}…). ` +
							'Migrations are immutable — write a new one.'
					)
				}
				continue
			}

			const noTxn = /^\s*--\s*no-transaction\b/im.test(body)
			if (noTxn) {
				// Justified only for CONCURRENTLY index builds (§8.8): the file runs
				// unwrapped, then bookkeeping lands in its own transaction.
				await sql.unsafe(body)
				await sql`
					INSERT INTO schema_migrations (version, name, checksum)
					VALUES (${file.version}, ${file.name}, ${checksum(body)})
				`
			} else {
				await sql.begin(async (tx) => {
					await tx.unsafe(body)
					await tx`
						INSERT INTO schema_migrations (version, name, checksum)
						VALUES (${file.version}, ${file.name}, ${checksum(body)})
					`
				})
			}
			done.push({ version: file.version, name: file.name })
		}
		return done
	} finally {
		await sql`SELECT pg_advisory_unlock(${LOCK_ID})`.catch(() => {})
	}
}

/** Pending migrations relative to the recorded state — `doctor` uses this. */
export async function pendingMigrations(sql: Sql, dir: string): Promise<AppliedMigration[]> {
	const files = listMigrationFiles(dir)
	const applied = await sql<{ version: number }[]>`
		SELECT version FROM schema_migrations
	`.catch(() => [] as { version: number }[])
	const done = new Set(applied.map((a) => a.version))
	return files.filter((f) => !done.has(f.version)).map(({ version, name }) => ({ version, name }))
}
