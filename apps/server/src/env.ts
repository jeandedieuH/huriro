/**
 * Environment schema (§7.5): the process refuses to boot on a missing/invalid
 * variable and prints exactly which and why. `*_FILE` indirection so secrets
 * never appear in `docker inspect`. `.env['example']` is GENERATED from this
 * schema by `cli/genenv['ts']` — update the schema, never the file.
 */
import { type Static, Type } from 'typebox'

export const EnvSchema = Type.Object({
	// ---- identity of the instance ----
	HURIRO_URL: Type.String({
		description: 'Public base URL, e.g. https://app.example.com',
		default: 'http://localhost:3000'
	}),
	HURIRO_DOMAIN: Type.Optional(
		Type.String({ description: 'Public hostname (Caddyfile/ingress). Set by `huriro init`.' })
	),
	HURIRO_ENV: Type.Union([Type.Literal('development'), Type.Literal('production'), Type.Literal('test')], {
		default: 'development',
		description: 'development | production | test'
	}),
	HURIRO_MODE: Type.Union([Type.Literal('selfhost'), Type.Literal('cloud')], {
		default: 'selfhost',
		description: 'Cloud-only code paths (billing, abuse controls) require `cloud` (§2.5)'
	}),

	// ---- data ----
	DATABASE_URL: Type.Optional(Type.String({ description: 'postgres://… as role huriro_app (or use _FILE)' })),
	DATABASE_URL_FILE: Type.Optional(
		Type.String({ description: 'Path to file containing DATABASE_URL (Docker secret)' })
	),
	DATABASE_ADMIN_URL: Type.Optional(
		Type.String({ description: 'postgres://… privileged role for migrations/pg-boss/CLI' })
	),
	DATABASE_ADMIN_URL_FILE: Type.Optional(Type.String()),

	HURIRO_SECRET_KEY: Type.Optional(
		Type.String({ description: 'Root key; per-purpose keys derived via HKDF' })
	),
	HURIRO_SECRET_KEY_FILE: Type.Optional(Type.String()),

	// ---- storage ----
	BLOB_STORE: Type.Union([Type.Literal('fs'), Type.Literal('s3')], {
		default: 'fs',
		description: 'fs (local volume) | s3'
	}),
	BLOB_DIR: Type.String({
		default: '/var/lib/huriro/files',
		description: 'Filesystem blob root when BLOB_STORE=fs'
	}),
	S3_ENDPOINT: Type.Optional(Type.String()),
	S3_BUCKET: Type.Optional(Type.String()),
	S3_ACCESS_KEY: Type.Optional(Type.String()),
	S3_SECRET_KEY: Type.Optional(Type.String()),

	// ---- service ----
	PORT: Type.Integer({ default: 3000, description: 'HTTP port for the api role' }),
	WS_PORT: Type.Integer({ default: 3001, description: 'WebSocket port for the realtime role' }),
	LOG_LEVEL: Type.Union(
		[Type.Literal('debug'), Type.Literal('info'), Type.Literal('warn'), Type.Literal('error')],
		{
			default: 'info'
		}
	),

	// ---- optional observability (ADR-0014: never required on self-host) ----
	OTEL_ENDPOINT: Type.Optional(
		Type.String({ description: 'OTLP collector endpoint; unset = no tracing export' })
	),
	ERROR_DSN: Type.Optional(Type.String({ description: 'GlitchTip/Sentry DSN; unset = no error reporting' })),
	HEARTBEAT_URL: Type.Optional(
		Type.String({ description: 'Dead-man-switch URL the worker pings on job health' })
	)
})

export type Env = Static<typeof EnvSchema>

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
	readonly secretKey: string | undefined
}

let cached: Config | null = null

/**
 * Load + validate env. Fail-fast with a precise message — a bad boot is better
 * than a misconfigured service (§7.5).
 */
export async function loadEnv(source: Record<string, string | undefined> = process.env): Promise<Config> {
	if (cached) return cached

	const problems: string[] = []
	const env: Record<string, string | undefined> = {}
	for (const key of Object.keys(EnvSchema.properties)) {
		env[key] = source[key]
	}

	// Apply defaults and required checks manually (TypeBox Value would also work;
	// manual keeps error messages operator-friendly).
	const parsed = {
		HURIRO_URL: env['HURIRO_URL'] ?? 'http://localhost:3000',
		HURIRO_DOMAIN: env['HURIRO_DOMAIN'],
		HURIRO_ENV: env['HURIRO_ENV'] ?? 'development',
		HURIRO_MODE: env['HURIRO_MODE'] ?? 'selfhost',
		DATABASE_URL: env['DATABASE_URL'],
		DATABASE_URL_FILE: env['DATABASE_URL_FILE'],
		DATABASE_ADMIN_URL: env['DATABASE_ADMIN_URL'],
		DATABASE_ADMIN_URL_FILE: env['DATABASE_ADMIN_URL_FILE'],
		HURIRO_SECRET_KEY: env['HURIRO_SECRET_KEY'],
		HURIRO_SECRET_KEY_FILE: env['HURIRO_SECRET_KEY_FILE'],
		BLOB_STORE: env['BLOB_STORE'] ?? 'fs',
		BLOB_DIR: env['BLOB_DIR'] ?? '/var/lib/huriro/files',
		S3_ENDPOINT: env['S3_ENDPOINT'],
		S3_BUCKET: env['S3_BUCKET'],
		S3_ACCESS_KEY: env['S3_ACCESS_KEY'],
		S3_SECRET_KEY: env['S3_SECRET_KEY'],
		PORT: env['PORT'] ? Number.parseInt(env['PORT'], 10) : 3000,
		WS_PORT: env['WS_PORT'] ? Number.parseInt(env['WS_PORT'], 10) : 3001,
		LOG_LEVEL: env['LOG_LEVEL'] ?? 'info',
		OTEL_ENDPOINT: env['OTEL_ENDPOINT'],
		ERROR_DSN: env['ERROR_DSN'],
		HEARTBEAT_URL: env['HEARTBEAT_URL']
	} satisfies Record<string, string | number | undefined>

	if (!['development', 'production', 'test'].includes(String(parsed.HURIRO_ENV))) {
		problems.push(`HURIRO_ENV must be development|production|test, got "${parsed.HURIRO_ENV}"`)
	}
	if (!['selfhost', 'cloud'].includes(String(parsed.HURIRO_MODE))) {
		problems.push(`HURIRO_MODE must be selfhost|cloud, got "${parsed.HURIRO_MODE}"`)
	}

	const databaseUrl =
		parsed.DATABASE_URL ?? (await readSecretFile(parsed.DATABASE_URL_FILE as string | undefined))
	const databaseAdminUrl =
		parsed.DATABASE_ADMIN_URL ??
		(await readSecretFile(parsed.DATABASE_ADMIN_URL_FILE as string | undefined)) ??
		databaseUrl // minimal self-host: one privileged URL acceptable, doctor warns
	const secretKey =
		parsed.HURIRO_SECRET_KEY ?? (await readSecretFile(parsed.HURIRO_SECRET_KEY_FILE as string | undefined))

	if (!databaseUrl) problems.push('DATABASE_URL or DATABASE_URL_FILE is required')
	if (parsed.HURIRO_ENV === 'production' && !secretKey) {
		problems.push('HURIRO_SECRET_KEY or HURIRO_SECRET_KEY_FILE is required in production')
	}
	if (parsed.BLOB_STORE === 's3' && (!parsed.S3_ENDPOINT || !parsed.S3_BUCKET)) {
		problems.push('S3_ENDPOINT and S3_BUCKET are required when BLOB_STORE=s3')
	}

	if (problems.length > 0) {
		throw new Error(
			`Invalid environment:\n  - ${problems.join('\n  - ')}\nSee .env['example'] for the full schema.`
		)
	}

	cached = { ...(parsed as Env), databaseUrl: databaseUrl!, databaseAdminUrl: databaseAdminUrl!, secretKey }
	return cached
}

/** Test hook — reset the cached config. */
export function resetEnvCache(): void {
	cached = null
}
