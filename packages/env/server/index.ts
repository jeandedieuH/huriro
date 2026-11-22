/**
 * Server environment contract (§7.5): zod schemas parsed via t3-env — boot
 * refuses to start on a missing/invalid variable and reports exactly which and
 * why. `apps/server/.env.example` is GENERATED from this file by `huriro
 * genenv`, and `apps/server/src/env.ts` layers `_FILE` secret indirection +
 * cross-field rules on top of `createServerEnv`.
 *
 * `.describe()` always goes LAST on a schema — the doc walker reads it for the
 * `.env.example` comments.
 */
import { createEnv } from '@t3-oss/env-core'
import { z } from 'zod'

export const serverSchemas = {
	// ---- identity of the instance ----
	HURIRO_URL: z
		.url()
		.default('http://localhost:3000')
		.describe('Public base URL, e.g. https://app.example.com'),
	HURIRO_DOMAIN: z.string().optional().describe('Public hostname (Caddyfile/ingress). Set by `huriro init`.'),
	HURIRO_ENV: z
		.enum(['development', 'production', 'test'])
		.default('development')
		.describe('development | production | test'),
	HURIRO_MODE: z
		.enum(['selfhost', 'cloud'])
		.default('selfhost')
		.describe('Cloud-only code paths (billing, abuse controls) require `cloud` (§2.5)'),

	// ---- data ----
	DATABASE_URL: z.url().optional().describe('postgres://… as role huriro_app (or use _FILE)'),
	DATABASE_URL_FILE: z.string().optional().describe('Path to file containing DATABASE_URL (Docker secret)'),
	DATABASE_ADMIN_URL: z.url().optional().describe('postgres://… privileged role for migrations/pg-boss/CLI'),
	DATABASE_ADMIN_URL_FILE: z.string().optional(),
	DATABASE_AUTH_URL: z
		.url()
		.optional()
		.describe('postgres://… as role huriro_auth — identity/session lookups only'),
	DATABASE_AUTH_URL_FILE: z.string().optional(),

	// ---- auth (better-auth: email/password + passkey + TOTP, ADR-0003) ----
	BETTER_AUTH_SECRET: z
		.string()
		.min(32)
		.optional()
		.describe('Cookie/session signing secret (≥32 chars); falls back to HKDF of HURIRO_SECRET_KEY'),
	BETTER_AUTH_SECRET_FILE: z.string().optional(),
	PASSKEY_RP_ID: z
		.string()
		.optional()
		.describe('WebAuthn relying-party id — defaults to HURIRO_URL hostname'),
	PASSKEY_RP_NAME: z.string().default('Huriro').describe('Shown in the authenticator prompt'),
	PASSKEY_ORIGIN: z
		.string()
		.optional()
		.describe('Allowed passkey origin(s), comma-separated — defaults to HURIRO_URL'),

	// ---- social OAuth providers (optional — configured per provider pair) ----
	GOOGLE_CLIENT_ID: z
		.string()
		.optional()
		.describe('Google OAuth client ID (enables Sign in with Google when paired with secret)'),
	GOOGLE_CLIENT_SECRET: z.string().optional().describe('Google OAuth client secret (or use _FILE)'),
	GOOGLE_CLIENT_SECRET_FILE: z
		.string()
		.optional()
		.describe('Path to file containing GOOGLE_CLIENT_SECRET (Docker secret)'),
	GITHUB_CLIENT_ID: z
		.string()
		.optional()
		.describe('GitHub OAuth app client ID (enables Sign in with GitHub when paired with secret)'),
	GITHUB_CLIENT_SECRET: z.string().optional().describe('GitHub OAuth app client secret (or use _FILE)'),
	GITHUB_CLIENT_SECRET_FILE: z
		.string()
		.optional()
		.describe('Path to file containing GITHUB_CLIENT_SECRET (Docker secret)'),
	APPLE_CLIENT_ID: z
		.string()
		.optional()
		.describe('Apple Services ID (enables Sign in with Apple when paired with secret)'),
	APPLE_CLIENT_SECRET: z.string().optional().describe('Apple client secret JWT (or use _FILE)'),
	APPLE_CLIENT_SECRET_FILE: z
		.string()
		.optional()
		.describe('Path to file containing APPLE_CLIENT_SECRET (Docker secret)'),
	APPLE_APP_BUNDLE_IDENTIFIER: z
		.string()
		.optional()
		.describe('Optional iOS/macOS bundle ID for native Sign in with Apple'),

	HURIRO_SECRET_KEY: z.string().min(32).optional().describe('Root key; per-purpose keys derived via HKDF'),
	HURIRO_SECRET_KEY_FILE: z.string().optional(),

	// ---- storage ----
	BLOB_STORE: z.enum(['fs', 's3']).default('fs').describe('fs (local volume) | s3'),
	BLOB_DIR: z.string().default('/var/lib/huriro/files').describe('Filesystem blob root when BLOB_STORE=fs'),
	S3_ENDPOINT: z.string().optional(),
	S3_BUCKET: z.string().optional(),
	S3_ACCESS_KEY: z.string().optional(),
	S3_SECRET_KEY: z.string().optional(),

	// ---- service ----
	PORT: z.coerce.number().int().min(1).max(65535).default(3001).describe('HTTP port for the api role'),
	WS_PORT: z.coerce
		.number()
		.int()
		.min(1)
		.max(65535)
		.default(3005)
		.describe('WebSocket port for the realtime role'),
	LOG_LEVEL: z.enum(['debug', 'info', 'warn', 'error']).default('info'),

	// ---- optional observability (ADR-0014: never required on self-host) ----
	OTEL_ENDPOINT: z.string().optional().describe('OTLP collector endpoint; unset = no tracing export'),
	ERROR_DSN: z.string().optional().describe('GlitchTip/Sentry DSN; unset = no error reporting'),
	HEARTBEAT_URL: z.url().optional().describe('Dead-man-switch URL the worker pings on job health')
}

/**
 * Validate `runtimeEnv` against the server contract. Throws listing every bad
 * variable — that's the desired fail-fast boot (§7.5).
 */
export function createServerEnv(runtimeEnv: Record<string, string | undefined> = process.env) {
	return createEnv({
		server: serverSchemas,
		runtimeEnv,
		// `.env` files carry `KEY=` blanks for unset optionals — treat as unset.
		emptyStringAsUndefined: true,
		// Escape hatch for image builds where runtime env doesn't exist yet.
		skipValidation: !!runtimeEnv['SKIP_ENV_VALIDATION']
	})
}

export type ServerEnv = ReturnType<typeof createServerEnv>
