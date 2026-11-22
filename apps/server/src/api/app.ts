/**
 * The Elysia app composition (api role). Chained construction preserves the
 * app type for Eden — per elysiajs skill: hooks/plugins before routes,
 * `.listen()` lives in the process entrypoint only.
 */
import { openapi } from '@elysia/openapi'
import { pendingMigrations, type Sql, withSystem } from '@huriro/db'
import { Elysia } from 'elysia'
import { type CollabDirectBridge, docsModule } from '../modules/docs'
import { type Auth, identityModule } from '../modules/identity'
import { importsModule } from '../modules/imports'
import { notificationsModule } from '../modules/notifications'
import { searchModule } from '../modules/search'
import { syncModule } from '../modules/sync'
import { tasksModule } from '../modules/tasks'
import { tenancyModule } from '../modules/tenancy'
import type { RealtimePubSub } from '../realtime/pubsub'
import { assertCookieCsrf } from './context'
import { HttpError, toProblem } from './error'
import { log, metrics, observability } from './observability'

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
}

export function createApp(deps: AppDeps) {
	const { sql, migrationsDir, mode, auth, pubsub, collabBridge, collabTicketSecret } = deps

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
						{ name: 'notifications', description: 'In-app triage notifications' },
						{ name: 'imports', description: 'Linear, GitHub, Notion and Markdown importers' }
					]
				}
			})
		)
		// ---- infra endpoints (no auth, no tenant context) ----
		.get('/health', { detail: { hide: true } }, () => ({ status: 'ok' as const }))
		.get('/ready', async () => {
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
		})
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
				// Single CSRF gate for the whole API surface (§12.6): cookie-authed
				// mutations need a trusted Origin, sane Sec-Fetch-Site, and
				// X-Huriro-Client — enforced once here so a route can't forget it.
				.onBeforeHandle(({ request }) => assertCookieCsrf(request, deps.allowedOrigins))
				.use(identityModule(auth))
				.use(tenancyModule(sql, mode, auth, pubsub))
				.use(tasksModule(sql, auth, pubsub))
				.use(docsModule(sql, auth, pubsub, collabBridge, collabTicketSecret))
				.use(syncModule(sql, auth, pubsub))
				.use(searchModule(sql, auth))
				.use(notificationsModule(sql, auth, pubsub))
				.use(importsModule(sql, auth, pubsub))
		)

	// better-auth mounts its own router at /api/auth/* when configured — it
	// owns its response shapes there; /api/v1 keeps the problem+json contract.
	// Mount at root: Elysia .mount strips the mount prefix from the forwarded
	// path, while better-auth's router matches its own basePath (/api/auth).
	return auth ? base.mount(auth.handler) : base
}

export type ApiApp = ReturnType<typeof createApp>
