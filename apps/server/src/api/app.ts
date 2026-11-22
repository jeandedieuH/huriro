/**
 * The Elysia app composition (api role). Chained construction preserves the
 * app type for Eden — per elysiajs skill: hooks/plugins before routes,
 * `.listen()` lives in the process entrypoint only.
 */
import { openapi } from '@elysia/openapi'
import { pendingMigrations, type Sql } from '@huriro/db'
import { Elysia } from 'elysia'
import type { Auth } from '../modules/identity'
import { tenancyGroup } from '../modules/tenancy'
import { HttpError, toProblem } from './error'
import { log, metrics, observability } from './observability'

export interface AppDeps {
	readonly sql: Sql
	readonly migrationsDir: string
	readonly mode: 'selfhost' | 'cloud'
	readonly auth: Auth | null
}

export function createApp(deps: AppDeps) {
	const { sql, migrationsDir, mode, auth } = deps

	const base = new Elysia({ name: 'huriro.api' })
		.use(observability)
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
					tags: [{ name: 'tenancy', description: 'Workspaces, membership, bootstrap' }]
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
			const rows = await sql<{ key: string; enabled: boolean; rollout: number }[]>`
				SELECT key, enabled, rollout FROM feature_flags ORDER BY key
			`
			return Object.fromEntries(rows.map((r) => [r.key, { enabled: r.enabled, rollout: r.rollout }]))
		})
		.group('/api/v1', tenancyGroup(sql, mode, auth))

	// better-auth mounts its own router at /api/auth/* when configured — it
	// owns its response shapes there; /api/v1 keeps the problem+json contract.
	return auth ? base.mount('/api/auth', auth.handler) : base
}

export type ApiApp = ReturnType<typeof createApp>
