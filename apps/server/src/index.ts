#!/usr/bin/env bun
/**
 * huriro — one binary, three roles, operator CLI (ADR-0018, §19.2).
 *
 *   huriro serve --role=api|worker|realtime|all
 *   huriro init [--domain …]      huriro doctor
 *   huriro migrate                huriro create-admin --email …
 *   huriro backup [--verify]      huriro restore <file> --yes
 *   huriro genenv [--check]       huriro health
 */
import { createAppPool, createOwnerPool, migrate, migrationsDir } from '@huriro/db'
import { createApp } from './api/app'
import { log } from './api/observability'
import { doctor } from './cli/doctor'
import { genenv } from './cli/genenv'
import { init } from './cli/init'
import { backup, createAdmin, health, migrateCmd, restore } from './cli/ops'
import { loadEnv } from './env'
import { createAuth } from './modules/identity'
import { startRealtime } from './realtime'
import { InProcessPubSub, PostgresNotifyPubSub } from './realtime/pubsub'
import { startWorker } from './worker'

const USAGE = `huriro <command>

  serve --role=api|worker|realtime|all   run services (default: all)
  init [--domain D] [--dir P]            write secrets, .env, Caddyfile, setup token
  doctor                                 preflight checks with fix hints
  migrate                                apply pending migrations (advisory-locked)
  create-admin --email E [--name N]      grant instance admin
  backup [--out DIR] [--verify]          pg_dump to file; --verify restores into scratch db
  restore <file> --yes                   pg_restore over DATABASE_ADMIN_URL's db
  genenv [--check]                       emit .env.example from the env schema
  health                                 exit 0 iff the app db answers (container healthcheck)
`

async function main() {
	const [cmd, ...args] = process.argv.slice(2)
	switch (cmd) {
		case 'serve':
			return serve(args)
		case 'init':
			return init(args)
		case 'doctor':
			return doctor(args)
		case 'migrate':
			return migrateCmd(args)
		case 'create-admin':
			return createAdmin(args)
		case 'backup':
			return backup(args)
		case 'restore':
			return restore(args)
		case 'genenv':
			return genenv(args)
		case 'health':
			return health()
		case undefined:
		case 'help':
		case '--help':
			console.log(USAGE)
			return
		default:
			console.error(`unknown command: ${cmd}\n${USAGE}`)
			process.exit(1)
	}
}

async function serve(args: string[]) {
	const roleIdx = args.indexOf('--role')
	const role = (roleIdx >= 0 ? args[roleIdx + 1] : 'all') ?? 'all'
	if (!['api', 'worker', 'realtime', 'all'].includes(role)) {
		console.error(`--role must be api|worker|realtime|all, got "${role}"`)
		process.exit(1)
	}

	const env = await loadEnv()
	log.info({ role, env: env.HURIRO_ENV, mode: env.HURIRO_MODE }, 'huriro starting')

	// Migrations run at boot under an advisory lock (§19.2) — every replica
	// converges; the lock makes concurrent boots safe.
	const admin = createOwnerPool(env.databaseAdminUrl, { max: 2 })
	const applied = await migrate(admin, migrationsDir)
	if (applied.length > 0) log.info({ applied: applied.map((m) => m.name) }, 'migrations applied')

	const app = createAppPool(env.databaseUrl, { max: 10 })
	const stoppers: (() => Promise<void> | void)[] = []

	let pubsub: InProcessPubSub | PostgresNotifyPubSub
	if (role === 'all') {
		pubsub = new InProcessPubSub()
	} else {
		const pgPubSub = new PostgresNotifyPubSub(app)
		if (role === 'realtime') await pgPubSub.startListening()
		pubsub = pgPubSub
	}
	stoppers.push(() => pubsub.close())

	const auth = role === 'api' || role === 'realtime' || role === 'all' ? createAuth(env) : null

	if (role === 'api' || role === 'all') {
		// Identity lives behind a flag-free factory — better-auth needs the
		// DB pool, so it constructs after migration (the auth schema exists).
		createApp({ sql: app, migrationsDir, mode: env.HURIRO_MODE, auth, pubsub }).listen(env.PORT)
		log.info({ port: env.PORT }, 'api listening')
	}
	if (role === 'worker' || role === 'all') {
		const worker = await startWorker({
			adminUrl: env.databaseAdminUrl,
			app,
			pubsub,
			heartbeatUrl: env.HEARTBEAT_URL
		})
		stoppers.push(() => worker.stop())
	}
	if (role === 'realtime' || role === 'all') {
		const rt = startRealtime({
			port: env.WS_PORT,
			sql: app,
			auth,
			pubsub,
			allowedOrigins: [env.HURIRO_URL]
		})
		stoppers.push(() => rt.stop())
	}

	// Graceful shutdown: stop accepting work, drain pools (§19.1).
	const shutdown = async (signal: string) => {
		log.info({ signal }, 'shutting down')
		for (const stop of stoppers) await stop()
		await app.end()
		await admin.end()
		process.exit(0)
	}
	process.on('SIGINT', () => void shutdown('SIGINT'))
	process.on('SIGTERM', () => void shutdown('SIGTERM'))
}

main().catch((err) => {
	console.error(err instanceof Error ? err.message : err)
	process.exit(1)
})
