/**
 * Test database harness (§21.3).
 *
 * Resolution order:
 *   1. `DATABASE_URL` (CI postgres service, or `docker compose --profile dev up`)
 *   2. Testcontainers `postgres:18-alpine` when `HURIRO_TESTCONTAINERS` is set
 *   3. null → the caller skips (unit runs never require Docker)
 *
 * The harness migrates the DB once per process and hands out two pools:
 *   - owner pool (superuser → bypasses RLS): fixture setup only
 *   - app pool (`huriro_app` → FORCE-RLS subject): everything under test.
 *     The app-role password is set at provision time (`ALTER ROLE`), never in
 *     the migration — secrets don't live in migration files.
 */

import { join } from 'node:path'
import { createAppPool, createOwnerPool, listMigrationFiles, migrate, type Sql } from '@huriro/db'
import { PostgreSqlContainer, type StartedPostgreSqlContainer } from '@testcontainers/postgresql'

const MIGRATIONS_DIR = join(import.meta.dir, '..', '..', 'db', 'migrations')

export interface TestDb {
	/** Superuser pool — fixture writes bypass RLS; never use in assertions paths. */
	readonly owner: Sql
	/** `huriro_app` pool — the role under test. */
	readonly app: Sql
	readonly url: string
	readonly migrated: { version: number; name: string }[]
	stop(): Promise<void>
}

let cached: Promise<TestDb | null> | null = null

/** True when a test DB is reachable in this environment. */
export function testDbAvailable(): Promise<TestDb | null> {
	return getTestDb()
}

export async function getTestDb(): Promise<TestDb | null> {
	if (cached) return cached
	cached = (async () => {
		const envUrl = process.env['DATABASE_URL']
		if (envUrl) {
			const db = await prepare(envUrl, null)
			return db
		}
		if (!process.env['HURIRO_TESTCONTAINERS']) return null
		const container = await new PostgreSqlContainer('postgres:18-alpine')
			.withDatabase('huriro_test')
			.withUsername('postgres')
			.withPassword('postgres')
			.start()
		const db = await prepare(container.getConnectionUri(), container)
		return db
	})()
	return cached
}

async function prepare(url: string, container: StartedPostgreSqlContainer | null): Promise<TestDb> {
	const owner = createOwnerPool(url, { max: 4 })

	// Migrate first (0001 creates huriro_app), then provision the role's password —
	// secrets live in provision-time env, never in migration files (§12.7).
	const migrated = await migrate(owner, MIGRATIONS_DIR)
	await owner`ALTER ROLE huriro_app LOGIN PASSWORD 'huriro-test'`

	const u = new URL(url)
	const appUrl = `${u.protocol}//huriro_app:huriro-test@${u.host}${u.pathname}`
	const app = createAppPool(appUrl, { max: 4 })

	return {
		owner,
		app,
		url,
		migrated,
		stop: async () => {
			await app.end()
			await owner.end()
			if (container) await container.stop()
			cached = null
		}
	}
}

export function migrationsDir(): string {
	return MIGRATIONS_DIR
}

export { listMigrationFiles }
