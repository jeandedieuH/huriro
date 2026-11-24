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
import { resolveRootEnvelopeSecret } from './api/crypto'
import { log } from './api/observability'
import { doctor } from './cli/doctor'
import { genenv } from './cli/genenv'
import { init } from './cli/init'
import { backup, createAdmin, deadLettersCmd, health, migrateCmd, restore, setupTokenCmd } from './cli/ops'
import { createEmailPipelineFromConfig } from './email'
import { loadEnv } from './env'
import { FilesystemBlobStorage } from './modules/files'
import { createAuth, ensureAgentOAuthSeed } from './modules/identity'
import { ensureBootstrapSetupToken } from './modules/tenancy'
import { createCollabRuntime, startRealtime } from './realtime'
import {
	InProcessPubSub,
	PostgresNotifyPubSub,
	type RealtimePubSub,
	ResilientPubSub,
	ValkeyPubSub
} from './realtime/pubsub'
import { startWorker } from './worker'

const USAGE = `huriro <command>

  serve --role=api|worker|realtime|all   run services (default: all)
  init [--domain D] [--dir P]            write secrets, .env, Caddyfile, setup token
  doctor                                 preflight checks with fix hints
  migrate                                apply pending migrations (advisory-locked)
  setup-token                            generate/rotate one-time setup token (before setup)
  create-admin --email E [--name N]      grant instance admin
  backup [--out DIR] [--verify]          pg_dump to file; --verify restores into scratch db
  restore <file> --yes                   pg_restore over DATABASE_ADMIN_URL's db
  genenv [--check]                       emit .env.example from the env schema
  health                                 exit 0 iff the app db answers (container healthcheck)
  dead-letters [--limit N]               list outbox events parked in dead-letter state (§5.5)
  dead-letters show <id>                 print one dead letter's full payload + error
  dead-letters replay <id> | --all       re-arm dead letters for another round of draining
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
		case 'setup-token':
			return setupTokenCmd()
		case 'create-admin':
			return createAdmin(args)
		case 'backup':
			return backup(args)
		case 'restore':
			return restore(args)
		case 'genenv':
			return genenv(args)
		case 'dead-letters':
			return deadLettersCmd(args)
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

	if (role === 'api' || role === 'all') {
		const bootstrap = await ensureBootstrapSetupToken(admin)
		if (bootstrap.status === 'generated') {
			console.log(
				[
					'',
					`First-run setup is not complete yet. Open ${env.HURIRO_URL}/setup`,
					'ONE-TIME SETUP TOKEN (shown once; only its sha256 is stored):',
					`  ${bootstrap.token}`,
					''
				].join('\n')
			)
		} else if (bootstrap.status === 'existing') {
			log.info(
				{ setupUrl: `${env.HURIRO_URL}/setup` },
				'first-run setup pending — use the setup token printed by huriro init or initial boot (or run `huriro setup-token` to rotate)'
			)
		}
	}

	const app = createAppPool(env.databaseUrl, { max: 10 })
	const stoppers: (() => Promise<void> | void)[] = []

	let pubsub: RealtimePubSub
	if (role === 'all') {
		pubsub = new InProcessPubSub()
	} else {
		const pgPubSub = new PostgresNotifyPubSub(app)
		if (role === 'realtime') await pgPubSub.startListening()
		pubsub = pgPubSub
	}
	if (env.VALKEY_URL) {
		const valkey = new ValkeyPubSub(env.VALKEY_URL)
		await valkey.connect().catch((err) => {
			log.warn({ err }, 'valkey unavailable on startup; continuing with fallback pubsub')
		})
		pubsub = new ResilientPubSub(valkey, pubsub)
	}
	stoppers.push(() => pubsub.close())

	const auth =
		role === 'api' || role === 'realtime' || role === 'all'
			? createAuth(env, { email: createEmailPipelineFromConfig(env) })
			: null
	if (auth) await ensureAgentOAuthSeed(auth)
	const emailPipeline = createEmailPipelineFromConfig(env)
	const collabTicketSecret = env.betterAuthSecret ?? env.secretKey ?? 'huriro-dev-collab'
	const rootSecret = resolveRootEnvelopeSecret(env.secretKey)
	const blobStorage = new FilesystemBlobStorage(env.BLOB_DIR)
	const vapid =
		env.VAPID_PUBLIC_KEY && env.vapidPrivateKey
			? {
					publicKey: env.VAPID_PUBLIC_KEY,
					privateKey: env.vapidPrivateKey,
					subject: env.VAPID_SUBJECT
				}
			: undefined
	const smtp = (() => {
		if (env.smtpUrl) {
			try {
				const u = new URL(env.smtpUrl)
				return {
					host: env.SMTP_HOST ?? u.hostname,
					port: env.SMTP_PORT ?? (u.port ? Number.parseInt(u.port, 10) : u.protocol === 'smtps:' ? 465 : 587),
					secure: env.SMTP_SECURE ?? u.protocol === 'smtps:',
					...(env.SMTP_USER || u.username ? { user: env.SMTP_USER ?? decodeURIComponent(u.username) } : {}),
					...((env.smtpPass ?? (u.password ? decodeURIComponent(u.password) : undefined))
						? { pass: env.smtpPass ?? decodeURIComponent(u.password) }
						: {}),
					from: env.emailFrom
				}
			} catch {
				return {
					host: env.SMTP_HOST ?? env.smtpUrl,
					...(env.SMTP_PORT !== undefined ? { port: env.SMTP_PORT } : {}),
					...(env.SMTP_SECURE !== undefined ? { secure: env.SMTP_SECURE } : {}),
					...(env.SMTP_USER ? { user: env.SMTP_USER } : {}),
					...(env.smtpPass ? { pass: env.smtpPass } : {}),
					from: env.emailFrom
				}
			}
		}
		if (env.SMTP_HOST) {
			return {
				host: env.SMTP_HOST,
				port: env.SMTP_PORT ?? (env.SMTP_SECURE ? 465 : 587),
				secure: env.SMTP_SECURE ?? env.SMTP_PORT === 465,
				...(env.SMTP_USER ? { user: env.SMTP_USER } : {}),
				...(env.smtpPass ? { pass: env.smtpPass } : {}),
				from: env.emailFrom
			}
		}
		return { from: env.emailFrom }
	})()
	const mailConfig = (() => {
		let smtpRelay: { host: string; port: number; secure: boolean; user?: string; pass?: string } | undefined
		if ('host' in smtp && smtp.host) {
			const secure = smtp.secure ?? smtp.port === 465
			smtpRelay = {
				host: smtp.host,
				port: smtp.port ?? (secure ? 465 : 587),
				secure,
				...(smtp.user ? { user: smtp.user } : {}),
				...(smtp.pass ? { pass: smtp.pass } : {})
			}
		}
		return {
			inboundDomain: env.MAIL_INBOUND_DOMAIN,
			publicBaseUrl: env.HURIRO_URL,
			maxMessageBytes: env.MAIL_MAX_MESSAGE_BYTES,
			undoSendSeconds: env.MAIL_UNDO_SEND_SECONDS,
			...(env.GMAIL_CLIENT_ID || env.GOOGLE_CLIENT_ID
				? { gmailClientId: env.GMAIL_CLIENT_ID ?? env.GOOGLE_CLIENT_ID }
				: {}),
			...(env.gmailClientSecret || env.googleClientSecret
				? { gmailClientSecret: env.gmailClientSecret ?? env.googleClientSecret }
				: {}),
			...(env.MICROSOFT_CLIENT_ID ? { msClientId: env.MICROSOFT_CLIENT_ID } : {}),
			...(env.msClientSecret ? { msClientSecret: env.msClientSecret } : {}),
			...(smtpRelay ? { smtpRelay } : {})
		}
	})()
	const collab =
		role === 'realtime' || role === 'all'
			? createCollabRuntime({ sql: app, pubsub, ticketSecret: collabTicketSecret })
			: undefined
	const expoPush = {
		endpoint: env.EXPO_PUSH_ENDPOINT,
		...(env.expoPushAccessToken ? { accessToken: env.expoPushAccessToken } : {})
	}

	if (role === 'api' || role === 'all') {
		// Identity lives behind a flag-free factory — better-auth needs the
		// DB pool, so it constructs after migration (the auth schema exists).
		createApp({
			sql: app,
			migrationsDir,
			mode: env.HURIRO_MODE,
			auth,
			pubsub,
			collabTicketSecret,
			blobStorage,
			rootSecret,
			email: emailPipeline,
			readOnly: env.HURIRO_READ_ONLY,
			rateLimitPerMinute: env.API_RATE_LIMIT_PER_MINUTE,
			billing: {
				workspacePriceUsdCents: env.BILLING_WORKSPACE_PRICE_USD_CENTS,
				fxApiUrl: env.BILLING_FX_API_URL,
				usdToRwfFallback: env.BILLING_USD_TO_RWF_FALLBACK,
				polarApiUrl: env.POLAR_API_URL,
				polarAccessToken: env.polarAccessToken,
				polarWebhookSecret: env.polarWebhookSecret,
				polarProductId: env.POLAR_PRODUCT_ID,
				iremboPayApiUrl: env.IREMBOPAY_API_URL,
				iremboPaySecretKey: env.iremboPaySecretKey,
				iremboPayWebhookSecret: env.iremboPayWebhookSecret,
				iremboPayWebhookDelimiter: env.IREMBOPAY_WEBHOOK_DELIMITER,
				iremboPayPaymentAccountId: env.IREMBOPAY_PAYMENT_ACCOUNT_ID,
				iremboPayProductCode: env.IREMBOPAY_PRODUCT_CODE
			},
			...(env.CLAMAV_HOST ? { clamavHost: env.CLAMAV_HOST, clamavPort: env.CLAMAV_PORT } : {}),
			...(env.githubAppWebhookSecret ? { githubAppWebhookSecret: env.githubAppWebhookSecret } : {}),
			...(vapid ? { vapid } : {}),
			mail: mailConfig,
			allowedOrigins: [new URL(env.HURIRO_URL).origin],
			...(collab ? { collabBridge: collab.bridge } : {})
		}).listen(env.PORT)
		log.info({ port: env.PORT }, 'api listening')
	}
	if (role === 'worker' || role === 'all') {
		const worker = await startWorker({
			adminUrl: env.databaseAdminUrl,
			app,
			mode: env.HURIRO_MODE,
			pubsub,
			heartbeatUrl: env.HEARTBEAT_URL,
			blobStorage,
			rootSecret,
			email: emailPipeline,
			publicBaseUrl: env.HURIRO_URL,
			smtp,
			mail: mailConfig,
			mailSyncIntervalSeconds: env.MAIL_SYNC_INTERVAL_SECONDS,
			expoPush,
			...(env.CLAMAV_HOST ? { clamavHost: env.CLAMAV_HOST, clamavPort: env.CLAMAV_PORT } : {}),
			...(vapid ? { vapid } : {})
		})
		stoppers.push(() => worker.stop())
	}
	if (role === 'realtime' || role === 'all') {
		const rt = startRealtime({
			port: env.WS_PORT,
			sql: app,
			auth,
			pubsub,
			allowedOrigins: [env.HURIRO_URL],
			...(collab ? { collab } : {})
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
