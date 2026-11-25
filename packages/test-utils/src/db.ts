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

/**
 * Dev-database footgun guard. The harness migrates and fills whatever
 * `DATABASE_URL`/`DATABASE_ADMIN_URL` points at with factory fixtures — and
 * Bun auto-loads `apps/server/.env`, so integration tests invoked without
 * explicit env silently target the DEV database (observed: hundreds of
 * `Workspace A <hex>` fixtures and poisoned outbox rows in a dev instance).
 * CI and Testcontainers both use `huriro_test`, so the env-URL branches only
 * accept database names ending in `_test`; anything else is refused loudly
 * unless explicitly overridden.
 */
function assertDisposableTestDatabase(url: string): void {
	if (process.env['HURIRO_TEST_ALLOW_NON_TEST_DB']) return
	let dbName: string | null = null
	try {
		dbName = decodeURIComponent(new URL(url).pathname.replace(/^\//, '')) || null
	} catch {
		// Unparseable URLs fail later at connect time with their own error.
		return
	}
	if (dbName?.endsWith('_test')) return
	throw new Error(
		`getTestDb() refuses to run against database ${JSON.stringify(dbName ?? '(default role db)')}.\n` +
			'The test harness migrates and fills the target database with factory fixtures, so it must be disposable.\n' +
			'Fix one of:\n' +
			'  - point DATABASE_ADMIN_URL/DATABASE_URL at a disposable database, e.g. postgres://…@localhost:5432/huriro_test\n' +
			'  - set HURIRO_TESTCONTAINERS=1 for a throwaway postgres container\n' +
			'  - set HURIRO_TEST_ALLOW_NON_TEST_DB=1 only if you are certain the target is disposable\n' +
			'Hint: Bun auto-loads apps/server/.env — your dev DATABASE_URL is picked up when running tests without explicit env.'
	)
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
			// Migrations require pgvector (halfvec, §11) which stock postgres images don't ship —
			// default to the pgvector build and allow the local infra image as an override.
			const image = process.env['HURIRO_TEST_PG_IMAGE'] ?? 'pgvector/pgvector:0.8.7-pg18'
			const container = await new PostgreSqlContainer(image)
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
			assertDisposableTestDatabase(adminUrl)
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
			assertDisposableTestDatabase(envUrl)
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

	// 0009 scopes users_visibility policy to (`huriro`, `huriro_app`); Testcontainers/CI
	// connect as `postgres`, so ensure `huriro` exists before running migrations.
	await owner.unsafe(`
		DO $$
		BEGIN
			IF NOT EXISTS (SELECT FROM pg_roles WHERE rolname = 'huriro') THEN
				CREATE ROLE huriro NOINHERIT NOBYPASSRLS LOGIN;
			END IF;
		END
		$$;
	`)

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
