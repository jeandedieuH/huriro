/**
 * `huriro doctor` — preflight + fix hints (§12.2, §19.2). Exit code 1 when any
 * required check fails so scripts and CI can gate on it.
 */
import { readdir } from 'node:fs/promises'
import net from 'node:net'
import { migrationsDir, pendingMigrations, type Sql } from '@huriro/db'
import postgres from 'postgres'
import { createEmailPipelineFromConfig, parseSmtpConfig } from '../email'
import { loadEnv } from '../env'

interface Check {
	name: string
	ok: boolean
	detail: string
	hint?: string | undefined
}

export async function doctor(args: string[]): Promise<void> {
	const dir = flag(args, '--migrations') ?? migrationsDir
	const checks: Check[] = []
	let sql: Sql | null = null

	// --- env schema (fail-fast is itself a check) ---
	try {
		const env = await loadEnv()
		checks.push({ name: 'environment', ok: true, detail: 'schema valid' })
		sql = postgres(env.databaseAdminUrl, { max: 1 })
		if (env.databaseAdminUrl === env.databaseUrl) {
			checks.push({
				name: 'role separation',
				ok: false,
				detail: 'DATABASE_ADMIN_URL == DATABASE_URL — app traffic would run as a privileged role',
				hint: 'give the app a dedicated huriro_app URL (see `huriro init`)'
			})
		} else {
			checks.push({ name: 'role separation', ok: true, detail: 'app + admin URLs differ' })
		}
	} catch (err) {
		checks.push({
			name: 'environment',
			ok: false,
			detail: String(err),
			hint: 'run `huriro init` or fix .env'
		})
		report(checks)
		process.exit(1)
	}

	// --- connectivity + version ---
	try {
		const [row] = await sql!<{ v: string }[]>`SELECT version() AS v`
		const m = row?.v.match(/PostgreSQL (\d+)\.(\d+)/)
		const major = m ? Number(m[1]) : 0
		const minor = m ? Number(m[2]) : 0
		const ok = major > 18 || (major === 18 && minor >= 7)
		checks.push({
			name: 'postgres',
			ok,
			detail: row?.v.split(',')[0] ?? 'unknown',
			hint: ok ? undefined : 'PostgreSQL ≥ 18.7 required (uuidv7, RLS) — see infra/postgres image'
		})
	} catch (err) {
		checks.push({
			name: 'postgres',
			ok: false,
			detail: `unreachable: ${err}`,
			hint: 'is the database up? check DATABASE_*_URL'
		})
		report(checks)
		process.exit(1)
	}

	// --- migrations pending ---
	try {
		const pending = await pendingMigrations(sql!, dir)
		checks.push({
			name: 'migrations',
			ok: pending.length === 0,
			detail:
				pending.length === 0
					? 'schema current'
					: `${pending.length} pending: ${pending.map((p) => p.name).join(', ')}`,
			hint: pending.length ? 'run `huriro migrate`' : undefined
		})
	} catch (err) {
		checks.push({ name: 'migrations', ok: false, detail: String(err), hint: 'run `huriro migrate` once' })
	}

	// --- huriro_app role exists + has a password ---
	try {
		const [r] = await sql!<
			{ ok: boolean }[]
		>`SELECT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'huriro_app' AND rolcanlogin) AS ok`
		checks.push({
			name: 'huriro_app role',
			ok: r?.ok === true,
			detail: r?.ok ? 'login role present' : 'missing',
			hint: r?.ok ? undefined : 'run migrations (0001 creates it), then ALTER ROLE … PASSWORD via init'
		})
	} catch (err) {
		checks.push({ name: 'huriro_app role', ok: false, detail: String(err) })
	}

	// --- blob dir writable ---
	try {
		const env = await loadEnv()
		if (env.BLOB_STORE === 'fs') {
			const probe = Bun.file(`${env.BLOB_DIR}/.doctor`)
			await Bun.write(probe, 'ok')
			await probe.delete().catch(() => {})
			checks.push({ name: 'blob store', ok: true, detail: `${env.BLOB_DIR} writable` })
		} else {
			checks.push({ name: 'blob store', ok: !!env.S3_ENDPOINT && !!env.S3_BUCKET, detail: 's3 configured' })
		}
	} catch (err) {
		checks.push({
			name: 'blob store',
			ok: false,
			detail: String(err),
			hint: 'create BLOB_DIR or mount the volume'
		})
	}

	// --- read-only maintenance mode + optional Valkey + backup freshness (§19.2, §20.3) ---
	try {
		const env = await loadEnv()
		checks.push({
			name: 'write mode',
			ok: !env.HURIRO_READ_ONLY,
			detail: env.HURIRO_READ_ONLY ? 'HURIRO_READ_ONLY=true (writes return 503)' : 'read-write',
			hint: env.HURIRO_READ_ONLY ? 'unset HURIRO_READ_ONLY after maintenance completes' : undefined
		})

		if (env.VALKEY_URL) {
			const valkeyOk = await checkTcpPort(env.VALKEY_URL)
			checks.push({
				name: 'valkey',
				ok: valkeyOk,
				detail: valkeyOk ? 'reachable' : 'unreachable',
				hint: valkeyOk ? undefined : 'check VALKEY_URL or `--profile valkey` service'
			})
		}

		const emailPipeline = createEmailPipelineFromConfig(env)
		if (emailPipeline.provider === 'smtp') {
			const smtpCfg = parseSmtpConfig({
				smtpUrl: env.smtpUrl,
				smtpHost: env.SMTP_HOST,
				smtpPort: env.SMTP_PORT,
				smtpSecure: env.SMTP_SECURE,
				smtpUser: env.SMTP_USER,
				smtpPass: env.smtpPass
			})
			const smtpReachable = smtpCfg ? await checkTcpPort(`smtp://${smtpCfg.host}:${smtpCfg.port}`) : false
			checks.push({
				name: 'email',
				ok: smtpReachable,
				detail: smtpReachable
					? `smtp (${smtpCfg?.host}:${smtpCfg?.port}, from ${emailPipeline.from})`
					: `smtp unreachable (${smtpCfg?.host ?? 'unknown'}:${smtpCfg?.port ?? 587})`,
				hint: smtpReachable ? undefined : 'verify SMTP_URL / SMTP_HOST and network egress'
			})
		} else if (emailPipeline.configured) {
			checks.push({
				name: 'email',
				ok: true,
				detail: `${emailPipeline.provider} (${emailPipeline.mode}, from ${emailPipeline.from})`
			})
		} else {
			checks.push({
				name: 'email',
				ok: false,
				detail: `unconfigured (${emailPipeline.mode}, provider=${emailPipeline.provider})`,
				hint:
					env.HURIRO_MODE === 'cloud'
						? 'set EMAILIT_API_KEY or EMAILIT_API_KEY_FILE'
						: 'set RESEND_API_KEY_FILE (recommended) or SMTP_URL_FILE / SMTP_HOST'
			})
		}

		const backupsDir = flag(args, '--backups-dir')
		if (backupsDir) {
			const files = await readdir(backupsDir).catch(() => [] as string[])
			const manifests = files.filter((f) => f.endsWith('.manifest.json')).sort()
			const latest = manifests.at(-1)
			checks.push({
				name: 'backup manifest',
				ok: Boolean(latest),
				detail: latest ? `latest: ${latest}` : `no backup manifests in ${backupsDir}`,
				hint: latest ? undefined : 'run `huriro backup --verify`'
			})
		}
	} catch {
		// Environment failure was already reported above.
	}

	report(checks)
	await sql?.end()
	process.exit(checks.every((c) => c.ok) ? 0 : 1)
}

async function checkTcpPort(rawUrl: string): Promise<boolean> {
	try {
		const u = new URL(rawUrl)
		const host = u.hostname || '127.0.0.1'
		const port = u.port ? Number.parseInt(u.port, 10) : 6379
		return await new Promise<boolean>((resolve) => {
			const sock = net.createConnection({ host, port })
			const timer = setTimeout(() => {
				sock.destroy()
				resolve(false)
			}, 2_000)
			sock.once('connect', () => {
				clearTimeout(timer)
				sock.destroy()
				resolve(true)
			})
			sock.once('error', () => {
				clearTimeout(timer)
				sock.destroy()
				resolve(false)
			})
		})
	} catch {
		return false
	}
}

function report(checks: Check[]) {
	for (const c of checks) {
		console.log(`  ${c.ok ? '✓' : '✗'} ${c.name.padEnd(18)} ${c.detail}`)
		if (!c.ok && c.hint) console.log(`    → ${c.hint}`)
	}
}

function flag(args: string[], name: string): string | undefined {
	const i = args.indexOf(name)
	return i >= 0 ? args[i + 1] : undefined
}
