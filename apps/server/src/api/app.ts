/**
 * The Elysia app composition (api role). Chained construction preserves the
 * app type for Eden — per elysiajs skill: hooks/plugins before routes,
 * `.listen()` lives in the process entrypoint only.
 */
import { createHash, randomUUID } from 'node:crypto'
import { openapi } from '@elysia/openapi'
import { problem } from '@huriro/contracts'
import { pendingMigrations, type Sql, withSystem } from '@huriro/db'
import { Elysia } from 'elysia'
import type { EmailPipeline } from '../email'
import { agentsModule } from '../modules/agents'
import { mcpEndpoint } from '../modules/agents/mcp'
import { aiModule } from '../modules/ai'
import { type BillingModuleConfig, billingModule, billingWebhookPublicModule } from '../modules/billing'
import { chatModule } from '../modules/chat'
import { type CollabDirectBridge, docsModule } from '../modules/docs'
import { type BlobStorage, filesModule, MemoryBlobStorage } from '../modules/files'
import { governanceModule } from '../modules/governance'
import { type Auth, identityModule } from '../modules/identity'
import { importsModule } from '../modules/imports'
import { type GithubApiClient, githubWebhookPublicModule, integrationsModule } from '../modules/integrations'
import { type MailModuleConfig, mailModule } from '../modules/mail'
import { notificationsModule, type VapidConfig } from '../modules/notifications'
import { searchModule } from '../modules/search'
import { syncModule } from '../modules/sync'
import { tasksModule } from '../modules/tasks'
import { setupStatus, tenancyModule } from '../modules/tenancy'
import { webhooksModule } from '../modules/webhooks'
import type { RealtimePubSub } from '../realtime/pubsub'
import { assertCookieCsrf } from './context'
import { resolveRootEnvelopeSecret } from './crypto'
import type { DnsResolver } from './egress'
import { HttpError, toProblem } from './error'
import { LLMS_TXT } from './llms-txt.gen'
import { log, metrics, observability } from './observability'
import { ApiRateLimiter } from './rate-limit'

export interface AppDeps {
	readonly sql: Sql
	readonly migrationsDir: string
	readonly mode: 'selfhost' | 'cloud'
	readonly auth: Auth | null
	readonly pubsub?: RealtimePubSub
	readonly collabBridge?: CollabDirectBridge
	readonly collabTicketSecret?: string
	/** Public origins allowed to call cookie-authed mutations — [HURIRO_URL]. */
	readonly allowedOrigins?: readonly string[]
	readonly blobStorage?: BlobStorage
	readonly clamavHost?: string | undefined
	readonly clamavPort?: number | undefined
	readonly rootSecret?: string | undefined
	readonly githubAppWebhookSecret?: string | undefined
	readonly githubClient?: GithubApiClient | undefined
	readonly vapid?: VapidConfig | undefined
	readonly egressFetch?: typeof fetch | undefined
	readonly egressResolver?: DnsResolver | undefined
	readonly mail?: Partial<MailModuleConfig> | undefined
	readonly billing?: Partial<BillingModuleConfig> | undefined
	readonly email?: EmailPipeline | undefined
	readonly readOnly?: boolean | undefined
	readonly isReadOnly?: (() => boolean) | undefined
	readonly rateLimitPerMinute?: number | undefined
}

function rateLimitKeyForRequest(request: Request): string {
	const testUser = request.headers.get('x-test-user-id')
	if (testUser) return `test:${testUser}`
	const authHeader = request.headers.get('authorization')
	if (authHeader) {
		return `auth:${createHash('sha256').update(authHeader).digest('hex').slice(0, 16)}`
	}
	const cookie = request.headers.get('cookie')
	if (cookie) {
		return `cookie:${createHash('sha256').update(cookie).digest('hex').slice(0, 16)}`
	}
	const fwd = request.headers.get('x-forwarded-for')?.split(',')[0]?.trim()
	const realIp = request.headers.get('x-real-ip')?.trim()
	return `ip:${fwd || realIp || 'local'}`
}

export function createApp(deps: AppDeps) {
	const { sql, migrationsDir, mode, auth, pubsub, collabBridge, collabTicketSecret } = deps
	const blobStorage = deps.blobStorage ?? new MemoryBlobStorage()
	const rootSecret = deps.rootSecret ?? resolveRootEnvelopeSecret()
	const scanOpts = {
		...(deps.clamavHost ? { clamavHost: deps.clamavHost } : {}),
		...(deps.clamavPort ? { clamavPort: deps.clamavPort } : {})
	}
	const integrationOpts = {
		rootSecret,
		...(deps.githubAppWebhookSecret ? { globalWebhookSecret: deps.githubAppWebhookSecret } : {}),
		...(deps.githubClient ? { githubClient: deps.githubClient } : {}),
		...(deps.egressFetch ? { fetchImpl: deps.egressFetch } : {}),
		...(deps.egressResolver ? { resolver: deps.egressResolver } : {})
	}
	const webhookOpts = {
		rootSecret,
		...(deps.egressFetch ? { fetchImpl: deps.egressFetch } : {}),
		...(deps.egressResolver ? { resolver: deps.egressResolver } : {})
	}
	const mailCfg: MailModuleConfig = {
		rootSecret,
		maxMessageBytes: deps.mail?.maxMessageBytes ?? 52_428_800,
		undoSendSeconds: deps.mail?.undoSendSeconds ?? 10,
		inboundDomain: deps.mail?.inboundDomain,
		publicBaseUrl: deps.mail?.publicBaseUrl ?? deps.allowedOrigins?.[0],
		gmailClientId: deps.mail?.gmailClientId,
		gmailClientSecret: deps.mail?.gmailClientSecret,
		msClientId: deps.mail?.msClientId,
		msClientSecret: deps.mail?.msClientSecret,
		smtpRelay: deps.mail?.smtpRelay
	}
	const billingCfg: BillingModuleConfig = {
		mode,
		...(deps.billing?.workspacePriceUsdCents !== undefined
			? { workspacePriceUsdCents: deps.billing.workspacePriceUsdCents }
			: {}),
		...(deps.billing?.fxApiUrl ? { fxApiUrl: deps.billing.fxApiUrl } : {}),
		...(deps.billing?.usdToRwfFallback !== undefined
			? { usdToRwfFallback: deps.billing.usdToRwfFallback }
			: {}),
		...(deps.billing?.fxConverter ? { fxConverter: deps.billing.fxConverter } : {}),
		...(deps.billing?.polarProvider ? { polarProvider: deps.billing.polarProvider } : {}),
		...(deps.billing?.polarApiUrl ? { polarApiUrl: deps.billing.polarApiUrl } : {}),
		...(deps.billing?.polarAccessToken ? { polarAccessToken: deps.billing.polarAccessToken } : {}),
		...(deps.billing?.polarWebhookSecret ? { polarWebhookSecret: deps.billing.polarWebhookSecret } : {}),
		...(deps.billing?.polarProductId ? { polarProductId: deps.billing.polarProductId } : {}),
		...(deps.billing?.iremboPayProvider ? { iremboPayProvider: deps.billing.iremboPayProvider } : {}),
		...(deps.billing?.iremboPayApiUrl ? { iremboPayApiUrl: deps.billing.iremboPayApiUrl } : {}),
		...(deps.billing?.iremboPaySecretKey ? { iremboPaySecretKey: deps.billing.iremboPaySecretKey } : {}),
		...(deps.billing?.iremboPayWebhookSecret
			? { iremboPayWebhookSecret: deps.billing.iremboPayWebhookSecret }
			: {}),
		...(deps.billing?.iremboPayWebhookDelimiter
			? { iremboPayWebhookDelimiter: deps.billing.iremboPayWebhookDelimiter }
			: {}),
		...(deps.billing?.iremboPayPaymentAccountId
			? { iremboPayPaymentAccountId: deps.billing.iremboPayPaymentAccountId }
			: {}),
		...(deps.billing?.iremboPayProductCode
			? { iremboPayProductCode: deps.billing.iremboPayProductCode }
			: {}),
		...(deps.egressFetch ? { fetchImpl: deps.egressFetch } : {}),
		...(deps.egressResolver ? { resolver: deps.egressResolver } : {})
	}
	const rateLimiter = new ApiRateLimiter({ limitPerMinute: deps.rateLimitPerMinute ?? 600 })

	async function checkReadiness() {
		let database = false
		let migrationsPending = -1
		try {
			await sql`SELECT 1`
			database = true
			migrationsPending = (await pendingMigrations(sql, migrationsDir)).length
		} catch (err) {
			log.warn({ err }, 'readiness check failed')
		}
		const ready = database && migrationsPending === 0
		if (!ready) throw new HttpError(503, 'internal', 'Not ready', 'See /metrics and logs')
		return { ready, checks: { database, migrationsPending } }
	}

	const base = new Elysia({ name: 'huriro.api' })
		.use(observability)
		.onAfterHandle(({ set }) => {
			// Security headers closing M0 threat-model open risk #4 (§12.6).
			set.headers['x-content-type-options'] = 'nosniff'
			set.headers['x-frame-options'] = 'DENY'
			set.headers['referrer-policy'] = 'strict-origin-when-cross-origin'
			set.headers['permissions-policy'] = 'camera=(), microphone=(), geolocation=()'
		})
		// ---- error contract: everything out the door is problem+json (§16.2) ----
		.onError(({ error, store, request, set }) => {
			const path = new URL(request.url).pathname
			const { status, body } = toProblem(
				error,
				(store as { requestId?: string }).requestId ?? 'req_unknown',
				path,
				log
			)
			set.status = status
			set.headers['content-type'] = 'application/problem+json'
			if (error instanceof HttpError && error.headers) {
				for (const [name, value] of Object.entries(error.headers)) {
					set.headers[name] = value
				}
			}
			return body
		})
		.use(
			openapi({
				documentation: {
					info: { title: 'Huriro API', version: '0.1.0', description: 'Workspace platform API (v1)' },
					tags: [
						{ name: 'identity', description: 'Authentication providers and sessions' },
						{ name: 'tenancy', description: 'Workspaces, membership, bootstrap, ACLs' },
						{ name: 'tasks', description: 'Projects, statuses, labels, cycles, issues, views' },
						{
							name: 'docs',
							description: 'Collaborative doc tree, CRDT tickets, versions, anchored comments'
						},
						{ name: 'sync', description: 'Change log delta, snapshots, batch mutations, realtime tickets' },
						{ name: 'search', description: 'Unified workspace FTS + trigram search' },
						{ name: 'notifications', description: 'In-app, email digest, and Web Push notifications' },
						{ name: 'imports', description: 'Linear, GitHub, Notion, Markdown, Slack, Jira importers' },
						{ name: 'chat', description: 'Channels, DMs, threads, reactions, and per-channel feeds' },
						{ name: 'files', description: 'Two-phase malware-quarantined attachment uploads' },
						{ name: 'webhooks', description: 'Signed outbound webhooks with retry and replay' },
						{ name: 'integrations', description: 'GitHub App two-way issue synchronization' },
						{ name: 'agents', description: 'Agent principals (human-managed)' },
						{ name: 'approvals', description: 'Human approval decisions for R2 agent calls' },
						{ name: 'agent', description: 'Agent tool surface — OAuth bearer, audience-separated (§13)' },
						{ name: 'ai', description: 'AI gateway — provider config, summaries, semantic search (§11)' },
						{ name: 'mail', description: 'Shared inbox — accounts, conversations, drafts (§14)' },
						{ name: 'governance', description: 'GDPR workspace exports and self-service erasure (§22.2)' },
						{ name: 'billing', description: 'Cloud workspace subscriptions and metering (§2.5, §23 M6)' }
					]
				}
			})
		)
		// ---- infra endpoints (no auth, no tenant context) ----
		.get('/health', { detail: { hide: true } }, () => ({ status: 'ok' as const }))
		.get('/healthz', { detail: { hide: true } }, () => ({ status: 'ok' as const }))
		.get('/ready', checkReadiness)
		.get('/readyz', { detail: { hide: true } }, checkReadiness)
		.get('/metrics', async ({ set }) => {
			set.headers['content-type'] = metrics.contentType
			return await metrics.metrics()
		})
		// ---- feature flags (ADR-0013: typed, server-evaluated; read-only here) ----
		.get('/api/v1/flags', async () => {
			const rows = await withSystem(
				sql,
				(tx) =>
					tx<{ key: string; enabled: boolean; rollout: number }[]>`
						SELECT key, enabled, rollout FROM feature_flags ORDER BY key
					`
			)
			return Object.fromEntries(rows.map((r) => [r.key, { enabled: r.enabled, rollout: r.rollout }]))
		})
		// 1 Elysia instance = 1 controller (elysiajs.com/essential/best-practice):
		// each module derives its workspace context via `workspaceDerive`.
		.group('/api/v1', (api) =>
			api
				// Unauthenticated webhook receivers verify HMAC signatures before CSRF/workspace guards.
				.use(githubWebhookPublicModule(sql, integrationOpts))
				.use(billingWebhookPublicModule(sql, billingCfg))
				// Global read-only maintenance guard, rate limiting, and CSRF gate (§12.6, §20.3).
				.onBeforeHandle(({ request, set }) => {
					const path = new URL(request.url).pathname
					const method = request.method.toUpperCase()
					if ((deps.readOnly || deps.isReadOnly?.()) && !['GET', 'HEAD', 'OPTIONS'].includes(method)) {
						throw new HttpError(
							503,
							'read_only_mode',
							'Instance is in read-only maintenance mode',
							'Writes are temporarily paused while maintenance completes.',
							undefined,
							{ 'retry-after': '60' }
						)
					}
					const rl = rateLimiter.check(rateLimitKeyForRequest(request))
					set.headers['x-ratelimit-limit'] = String(rl.limit)
					set.headers['x-ratelimit-remaining'] = String(rl.remaining)
					if (!rl.allowed) {
						throw new HttpError(
							429,
							'rate_limited',
							'Too many requests',
							'API rate limit exceeded; retry after the window resets.',
							undefined,
							{
								'retry-after': String(rl.resetSeconds),
								'x-ratelimit-limit': String(rl.limit),
								'x-ratelimit-remaining': '0'
							}
						)
					}
					if (
						path === '/api/v1/integrations/github/webhook' ||
						path === '/api/v1/billing/webhooks/polar' ||
						path === '/api/v1/billing/webhooks/irembopay'
					) {
						return
					}
					// Mail webhooks are token-authed pre-tenant routes (§14.2) — no cookies involved.
					if (path.startsWith('/api/v1/mail/inbound/') || path.startsWith('/api/v1/mail/webhook/')) return
					assertCookieCsrf(request, deps.allowedOrigins)
				})
				.use(identityModule(auth))
				.use(tenancyModule(sql, mode, auth, pubsub, { email: deps.email }))
				.use(tasksModule(sql, auth, pubsub))
				.use(docsModule(sql, auth, pubsub, collabBridge, collabTicketSecret))
				.use(syncModule(sql, auth, pubsub))
				.use(searchModule(sql, auth))
				.use(filesModule(sql, auth, blobStorage, scanOpts))
				.use(chatModule(sql, auth, pubsub))
				.use(
					notificationsModule(sql, auth, pubsub, {
						...(deps.vapid ? { vapid: deps.vapid } : {}),
						...(deps.egressResolver ? { resolver: deps.egressResolver } : {}),
						...(deps.email ? { email: deps.email } : {})
					})
				)
				.use(importsModule(sql, auth, pubsub))
				.use(webhooksModule(sql, auth, webhookOpts))
				.use(integrationsModule(sql, auth, integrationOpts))
				.use(
					agentsModule(sql, auth, {
						baseUrl: (auth?.options?.baseURL as string | undefined) ?? deps.allowedOrigins?.[0] ?? '',
						...(collabBridge ? { collabBridge } : {})
					})
				)
				.use(
					aiModule(sql, auth, {
						sql,
						rootSecret,
						...(deps.egressFetch ? { fetcher: deps.egressFetch } : {}),
						...(deps.egressResolver ? { resolver: deps.egressResolver } : {})
					})
				)
				.use(mailModule(sql, auth, blobStorage, mailCfg, pubsub))
				.use(governanceModule(sql, auth, blobStorage, pubsub, { email: deps.email }))
				.use(billingModule(sql, auth, billingCfg))
		)

	// /mcp lives at the app root (not under /api/v1): the OAuth resource URI is
	// <base>/mcp and the MCP transport is a JSON-RPC surface, not REST.
	const withMcp = auth
		? base.use(
				mcpEndpoint(sql, auth, {
					baseUrl: (auth.options?.baseURL as string | undefined) ?? deps.allowedOrigins?.[0] ?? '',
					requestStateSecret: collabTicketSecret ?? '',
					hasCollabBridge: collabBridge !== undefined
				})
			)
		: base

	// Public agent-facing manifest: the generated llms.txt (§16.4, genapi).
	const llmsRoute = new Elysia({ name: 'huriro.llms' }).get(
		'/llms.txt',
		() => new Response(LLMS_TXT, { headers: { 'content-type': 'text/plain; charset=utf-8' } })
	)
	const withLlms = withMcp.use(llmsRoute)

	// better-auth mounts its own router at /api/auth/* when configured — it
	// owns its response shapes there; /api/v1 keeps the problem+json contract.
	// Mount at root: Elysia .mount strips the mount prefix from the forwarded
	// path, while better-auth's router matches its own basePath (/api/auth).
	if (!auth) return withLlms

	const authHandler = async (request: Request): Promise<Response> => {
		const { pathname } = new URL(request.url)
		if (request.method === 'POST' && pathname.startsWith('/api/auth/sign-up')) {
			const { configured } = await setupStatus(sql)
			if (!configured) {
				const requestId = request.headers.get('x-request-id') ?? `req_${randomUUID()}`
				const body = problem({
					status: 403,
					code: 'setup_required',
					title: 'Instance setup must be completed before creating accounts',
					detail: 'Complete first-run setup at /setup with the one-time setup token first.',
					instance: pathname,
					requestId
				})
				return new Response(JSON.stringify(body), {
					status: 403,
					headers: {
						'content-type': 'application/problem+json',
						'x-request-id': requestId,
						'x-content-type-options': 'nosniff',
						'x-frame-options': 'DENY',
						'referrer-policy': 'strict-origin-when-cross-origin',
						'permissions-policy': 'camera=(), microphone=(), geolocation=()'
					}
				})
			}
		}
		return auth.handler(request)
	}

	return withLlms.mount(authHandler)
}

export type ApiApp = ReturnType<typeof createApp>
