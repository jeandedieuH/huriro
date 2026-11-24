/**
 * Operator commands: migrate, create-admin, backup, restore, health (§19.2).
 * Backup/restore shell out to pg_dump/pg_restore — the honest tools, streamed
 * to a timestamped file with a manifest (§19.3).
 */

import { mkdir } from 'node:fs/promises'
import { migrate, migrationsDir } from '@huriro/db'
import postgres from 'postgres'
import { loadEnv } from '../env'
import { rotateBootstrapSetupToken, SetupError } from '../modules/tenancy'

export async function migrateCmd(args: string[]): Promise<void> {
	const dir = flag(args, '--dir') ?? migrationsDir
	const env = await loadEnv()
	const sql = postgres(env.databaseAdminUrl, { max: 1 })
	try {
		const applied = await migrate(sql, dir)
		if (applied.length === 0) console.log('schema is current')
		for (const m of applied) console.log(`  applied ${m.version}_${m.name}`)
	} finally {
		await sql.end()
	}
}

export async function createAdmin(args: string[]): Promise<void> {
	const email = flag(args, '--email')
	const name = flag(args, '--name') ?? 'Instance Admin'
	if (!email) {
		console.error('usage: huriro create-admin --email <email> [--name <name>]')
		process.exit(1)
	}
	const env = await loadEnv()
	const sql = postgres(env.databaseAdminUrl, { max: 1 })
	try {
		const [row] = await sql<{ id: string }[]>`
			INSERT INTO users (email, display_name) VALUES (${email.toLowerCase()}, ${name})
			ON CONFLICT (email) DO UPDATE SET display_name = EXCLUDED.display_name
			RETURNING id
		`
		await sql`
			INSERT INTO instance_settings (key, value) VALUES ('instance_admin_user_id', to_jsonb(${row!.id}::text))
			ON CONFLICT (key) DO UPDATE SET value = EXCLUDED.value
		`
		console.log(`instance admin: ${row!.id} <${email}>`)
	} finally {
		await sql.end()
	}
}

export async function setupTokenCmd(): Promise<void> {
	const env = await loadEnv()
	const sql = postgres(env.databaseAdminUrl, { max: 1 })
	try {
		const { token } = await rotateBootstrapSetupToken(sql)
		console.log(
			[
				'First-run setup URL:',
				`  ${env.HURIRO_URL}/setup`,
				'',
				'ONE-TIME SETUP TOKEN (shown once; only its sha256 is stored):',
				`  ${token}`
			].join('\n')
		)
	} catch (err) {
		if (err instanceof SetupError && err.code === 'already_configured') {
			console.error(err.message)
			process.exit(1)
		}
		throw err
	} finally {
		await sql.end()
	}
}

export async function backup(args: string[]): Promise<void> {
	const outDir = flag(args, '--out') ?? 'backups'
	const env = await loadEnv()
	await mkdir(outDir, { recursive: true })
	const stamp = new Date().toISOString().replace(/[:.]/g, '-')
	const file = `${outDir}/huriro-${stamp}.dump`

	// --format=custom restores selectively + compresses; --no-owner keeps
	// restores portable across role names (§19.3).
	const proc = Bun.spawn(
		['pg_dump', '--format=custom', '--compress=6', '--no-owner', '--file', file, env.databaseAdminUrl],
		{ stdout: 'inherit', stderr: 'inherit' }
	)
	const code = await proc.exited
	if (code !== 0) {
		console.error(`pg_dump failed (exit ${code})`)
		process.exit(code)
	}
	await Bun.write(`${file}.manifest.json`, JSON.stringify({ file, at: stamp, format: 'custom' }, null, 2))
	console.log(`backup: ${file}`)

	if (args.includes('--verify')) {
		// Restore into a scratch DB — a backup that can't restore isn't a backup.
		const scratch = `huriro_verify_${Date.now()}`
		const admin = postgres(env.databaseAdminUrl, { max: 1 })
		try {
			await admin.unsafe(`CREATE DATABASE ${scratch}`)
			const u = new URL(env.databaseAdminUrl)
			const scratchUrl = `${u.protocol}//${u.username}:${u.password}@${u.host}/${scratch}`
			const rp = Bun.spawn(['pg_restore', '--no-owner', '--dbname', scratchUrl, file], {
				stdout: 'inherit',
				stderr: 'inherit'
			})
			if ((await rp.exited) !== 0) throw new Error('pg_restore failed')
			const s = postgres(scratchUrl, { max: 1 })
			const [n] = await s<{ n: number }[]>`SELECT count(*)::int AS n FROM workspaces`
			await s.end()
			console.log(`verify: restored into ${scratch} (${n?.n} workspaces)`)
		} finally {
			await admin.unsafe(`DROP DATABASE IF EXISTS ${scratch}`).catch(() => {})
			await admin.end()
		}
	}
}

export async function restore(args: string[]): Promise<void> {
	const file = args.find((a) => !a.startsWith('--'))
	if (!file) {
		console.error('usage: huriro restore <file.dump> [--yes]')
		process.exit(1)
	}
	if (!args.includes('--yes')) {
		console.error(`This restores over the database in DATABASE_ADMIN_URL. Re-run with --yes to proceed.`)
		process.exit(1)
	}
	const env = await loadEnv()
	const proc = Bun.spawn(
		['pg_restore', '--clean', '--if-exists', '--no-owner', '--dbname', env.databaseAdminUrl, file],
		{
			stdout: 'inherit',
			stderr: 'inherit'
		}
	)
	const code = await proc.exited
	if (code !== 0) {
		console.error(`pg_restore failed (exit ${code})`)
		process.exit(code)
	}
	console.log('restore complete — run `huriro doctor` to verify')
}

export async function health(): Promise<void> {
	const env = await loadEnv()
	const sql = postgres(env.databaseUrl, { max: 1, connect_timeout: 5 })
	try {
		await sql`SELECT 1`
		process.exit(0)
	} catch {
		process.exit(1)
	}
}

function flag(args: string[], name: string): string | undefined {
	const i = args.indexOf(name)
	return i >= 0 ? args[i + 1] : undefined
}
