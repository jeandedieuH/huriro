/**
 * `huriro init` — the self-host bootstrap (§19.2, §12.2):
 *   1. writes secrets/ (0600 files): role passwords, DB URLs, secret_key,
 *      the setup-token HASH (plaintext token is shown once on stdout)
 *   2. writes .env (no secrets — only file references) + Caddyfile
 *   3. prints the one-time setup token for POST /api/v1/setup
 */
import { createHash, randomBytes } from 'node:crypto'
import { join } from 'node:path'

function secret(bytes = 32): string {
	return randomBytes(bytes).toString('base64url')
}

async function writeSecret(dir: string, name: string, value: string) {
	await Bun.write(join(dir, name), value, { mode: 0o600 })
}

export async function init(args: string[]): Promise<void> {
	const domain = flag(args, '--domain') ?? 'localhost'
	const dir = flag(args, '--dir') ?? '.'
	const url = domain === 'localhost' ? 'http://localhost:3000' : `https://${domain}`

	const secretsDir = join(dir, 'secrets')
	const pgPassword = secret(24)
	const appDbPassword = secret(24)
	const maintDbPassword = secret(24)
	const authDbPassword = secret(24)
	const setupToken = secret(32)

	// Secrets stay in files; .env references them via *_FILE (§12.7).
	await writeSecret(secretsDir, 'pg_password', pgPassword)
	await writeSecret(secretsDir, 'app_db_password', appDbPassword)
	await writeSecret(secretsDir, 'maint_db_password', maintDbPassword)
	await writeSecret(secretsDir, 'auth_db_password', authDbPassword)
	await writeSecret(secretsDir, 'secret_key', secret(32))
	await writeSecret(secretsDir, 'database_url', `postgres://huriro_app:${appDbPassword}@postgres:5432/huriro`)
	await writeSecret(secretsDir, 'database_admin_url', `postgres://huriro:${pgPassword}@postgres:5432/huriro`)
	await writeSecret(
		secretsDir,
		'database_auth_url',
		`postgres://huriro_auth:${authDbPassword}@postgres:5432/huriro`
	)
	await writeSecret(secretsDir, 'setup_token_hash', createHash('sha256').update(setupToken).digest('hex'))

	const env = [
		`HURIRO_URL=${url}`,
		`HURIRO_DOMAIN=${domain}`,
		`HURIRO_ENV=production`,
		`DATABASE_URL_FILE=/run/secrets/database_url`,
		`DATABASE_ADMIN_URL_FILE=/run/secrets/database_admin_url`,
		`DATABASE_AUTH_URL_FILE=/run/secrets/database_auth_url`,
		`HURIRO_SECRET_KEY_FILE=/run/secrets/secret_key`,
		`BLOB_DIR=/var/lib/huriro/files`,
		''
	].join('\n')
	await Bun.write(join(dir, '.env'), env, { mode: 0o600 })

	await Bun.write(join(dir, 'Caddyfile'), `${domain} {\n\treverse_proxy huriro:3001\n}\n`)

	console.log(
		[
			`Initialized Huriro for ${domain}`,
			'  secrets/   — passwords, DB URLs, secret_key, setup-token hash (mode 600)',
			'  .env       — configuration (references secrets, contains none)',
			'  Caddyfile  — automatic HTTPS vhost',
			'',
			'Next: docker compose -f infra/compose/compose.yml up -d, then',
			`  ${url}/setup   (or POST /api/v1/setup)`,
			'',
			'ONE-TIME SETUP TOKEN (shown once; only its sha256 is stored):',
			`  ${setupToken}`,
			''
		].join('\n')
	)
}

function flag(args: string[], name: string): string | undefined {
	const i = args.indexOf(name)
	return i >= 0 ? args[i + 1] : undefined
}
