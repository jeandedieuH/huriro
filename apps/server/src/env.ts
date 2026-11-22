/**
 * Server config loader (§7.5): the zod contract lives in @huriro/env/server
 * (parsed via t3-env — a bad boot lists every invalid variable); this module
 * adds `*_FILE` indirection so secrets never appear in `docker inspect`, plus
 * the cross-field rules a schema can't express. `.env['example']` is GENERATED
 * by `cli/genenv['ts']` — update @huriro/env, never the file.
 */
import { createServerEnv, type ServerEnv } from '@huriro/env/server'

export type Env = ServerEnv

async function readSecretFile(path: string | undefined): Promise<string | undefined> {
	if (!path) return undefined
	const f = Bun.file(path)
	if (!(await f.exists())) throw new Error(`secret file not found: ${path}`)
	const v = (await f.text()).trim()
	if (!v) throw new Error(`secret file is empty: ${path}`)
	return v
}

export interface Config extends Env {
	/** Resolved after _FILE indirection. */
	readonly databaseUrl: string
	readonly databaseAdminUrl: string
	readonly databaseAuthUrl: string
	readonly secretKey: string | undefined
	readonly betterAuthSecret: string | undefined
	readonly googleClientSecret: string | undefined
	readonly githubClientSecret: string | undefined
	readonly appleClientSecret: string | undefined
}

let cached: Config | null = null

/**
 * Load + validate env. Fail-fast with a precise message — a bad boot is better
 * than a misconfigured service (§7.5).
 */
export async function loadEnv(source: Record<string, string | undefined> = process.env): Promise<Config> {
	if (cached) return cached

	// t3-env + zod does per-variable validation (types, enums, formats,
	// defaults); what remains here is _FILE resolution and cross-field rules.
	const env = createServerEnv(source)
	const problems: string[] = []

	const databaseUrl = env.DATABASE_URL ?? (await readSecretFile(env.DATABASE_URL_FILE))
	const databaseAdminUrl =
		env.DATABASE_ADMIN_URL ?? (await readSecretFile(env.DATABASE_ADMIN_URL_FILE)) ?? databaseUrl // minimal self-host: one privileged URL acceptable, doctor warns
	const databaseAuthUrl =
		env.DATABASE_AUTH_URL ?? (await readSecretFile(env.DATABASE_AUTH_URL_FILE)) ?? databaseUrl // dev fallback: session lookups through the app role's own URL
	const secretKey = env.HURIRO_SECRET_KEY ?? (await readSecretFile(env.HURIRO_SECRET_KEY_FILE))
	const betterAuthSecret = env.BETTER_AUTH_SECRET ?? (await readSecretFile(env.BETTER_AUTH_SECRET_FILE))
	const googleClientSecret = env.GOOGLE_CLIENT_SECRET ?? (await readSecretFile(env.GOOGLE_CLIENT_SECRET_FILE))
	const githubClientSecret = env.GITHUB_CLIENT_SECRET ?? (await readSecretFile(env.GITHUB_CLIENT_SECRET_FILE))
	const appleClientSecret = env.APPLE_CLIENT_SECRET ?? (await readSecretFile(env.APPLE_CLIENT_SECRET_FILE))

	if (!databaseUrl) problems.push('DATABASE_URL or DATABASE_URL_FILE is required')
	if (env.HURIRO_ENV === 'production' && !secretKey) {
		problems.push('HURIRO_SECRET_KEY or HURIRO_SECRET_KEY_FILE is required in production')
	}
	if (env.BLOB_STORE === 's3' && (!env.S3_ENDPOINT || !env.S3_BUCKET)) {
		problems.push('S3_ENDPOINT and S3_BUCKET are required when BLOB_STORE=s3')
	}
	if (Boolean(env.GOOGLE_CLIENT_ID) !== Boolean(googleClientSecret)) {
		problems.push(
			'GOOGLE_CLIENT_ID and GOOGLE_CLIENT_SECRET (or GOOGLE_CLIENT_SECRET_FILE) must be set together'
		)
	}
	if (Boolean(env.GITHUB_CLIENT_ID) !== Boolean(githubClientSecret)) {
		problems.push(
			'GITHUB_CLIENT_ID and GITHUB_CLIENT_SECRET (or GITHUB_CLIENT_SECRET_FILE) must be set together'
		)
	}
	if (Boolean(env.APPLE_CLIENT_ID) !== Boolean(appleClientSecret)) {
		problems.push(
			'APPLE_CLIENT_ID and APPLE_CLIENT_SECRET (or APPLE_CLIENT_SECRET_FILE) must be set together'
		)
	}

	if (problems.length > 0) {
		throw new Error(
			`Invalid environment:\n  - ${problems.join('\n  - ')}\nSee .env['example'] for the full schema.`
		)
	}

	cached = {
		...env,
		databaseUrl: databaseUrl!,
		databaseAdminUrl: databaseAdminUrl!,
		databaseAuthUrl: databaseAuthUrl!,
		secretKey,
		betterAuthSecret,
		googleClientSecret,
		githubClientSecret,
		appleClientSecret
	}
	return cached
}

/** Test hook — reset the cached config. */
export function resetEnvCache(): void {
	cached = null
}
