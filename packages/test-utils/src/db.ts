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

import {
	createAppPool,
	createOwnerPool,
	migrationsDir as dbMigrationsDir,
	listMigrationFiles,
	migrate,
	type Sql
} from '@huriro/db'
import { PostgreSqlContainer, type StartedPostgreSqlContainer } from '@testcontainers/postgresql'

export interface TestDb {
	/** Superuser pool — fixture writes bypass RLS; never use in assertions paths. */
	readonly owner: Sql
	/** `huriro_app` pool — the role under test. */
	readonly app: Sql
	readonly url: string
	readonly appUrl: string
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
		if (process.env['HURIRO_TESTCONTAINERS']) {
			const container = await new PostgreSqlContainer('postgres:18-alpine')
				.withDatabase('huriro_test')
				.withUsername('postgres')
				.withPassword('postgres')
				.start()
			const db = await prepare(container.getConnectionUri(), container, null)
			return db
		}
		const adminUrl = process.env['DATABASE_ADMIN_URL']
		const envUrl = process.env['DATABASE_URL']
		if (adminUrl) {
			let explicitAppUrl: string | null = null
			if (envUrl) {
				try {
					if (new URL(envUrl).username === 'huriro_app') {
						explicitAppUrl = envUrl
					}
				} catch {
					explicitAppUrl = null
				}
			}
			const db = await prepare(adminUrl, null, explicitAppUrl)
			return db
		}
		if (envUrl) {
			const db = await prepare(envUrl, null, null)
			return db
		}
		return null
	})()
	return cached
}

async function prepare(
	ownerUrl: string,
	container: StartedPostgreSqlContainer | null,
	explicitAppUrl: string | null
): Promise<TestDb> {
	const owner = createOwnerPool(ownerUrl, { max: 4 })

	// Migrate first (0001 creates huriro_app), then provision the role's password —
	// secrets live in provision-time env, never in migration files (§12.7).
	const migrated = await migrate(owner, dbMigrationsDir)
	let appUrl: string
	if (explicitAppUrl !== null) {
		appUrl = explicitAppUrl
	} else {
		await owner`ALTER ROLE huriro_app LOGIN PASSWORD 'huriro-test'`
		const u = new URL(ownerUrl)
		appUrl = `${u.protocol}//huriro_app:huriro-test@${u.host}${u.pathname}`
	}
	const app = createAppPool(appUrl, { max: 4 })

	return {
		owner,
		app,
		url: ownerUrl,
		appUrl,
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
	return dbMigrationsDir
}

export { listMigrationFiles }
