/**
 * Request-scoped workspace context — the shared `derive` transform every
 * workspace-scoped controller chains before its routes (§7.2, §12.4).
 *
 * Resolves the caller's session + `X-Workspace-Id` once per request and exposes:
 *
 *   - `workspaceCtx` — `{ session, workspaceId, requestId }` for pubsub and
 *     other post-transaction work.
 *   - `inWorkspace(fn)` — runs `fn(tx, actor)` inside a `withWorkspace`
 *     transaction with `resolveActor` applied; the only door to tenant
 *     queries in request paths.
 *
 * Registered per-module via `.derive(workspaceDerive(sql, auth))`: it runs
 * after validation (a 422 still beats the auth gate's problem+json) and
 * applies only to routes registered after it — session-only routes in the
 * same controller stay unaffected (see tenancy/index.ts ordering).
 */
import { type Queryable, type Sql, withWorkspace } from '@huriro/db'
import type { ActorContext } from '@huriro/domain'
import { requireWorkspaceRequest, type WorkspaceRequestContext } from '../../api/context'
import type { Auth } from '../identity'
import { resolveActor } from './service'

export type WorkspaceScope = {
	readonly workspaceCtx: WorkspaceRequestContext
	readonly inWorkspace: <T>(fn: (tx: Queryable, actor: ActorContext) => T | Promise<T>) => Promise<T>
}

export function workspaceDerive(sql: Sql, auth: Auth | null) {
	return async ({ request, store }: { request: Request; store: unknown }): Promise<WorkspaceScope> => {
		// requestId is written by the app's observability hooks (onRequest);
		// the store isn't in this transform's parameter type, hence the cast.
		const requestId = (store as { requestId?: string } | undefined)?.requestId ?? 'req_unknown'
		const workspaceCtx = await requireWorkspaceRequest(auth, request, requestId)
		const { workspaceId, session } = workspaceCtx
		return {
			workspaceCtx,
			inWorkspace: (fn) =>
				withWorkspace(sql, { workspaceId, userId: session.userId, requestId }, async (tx) =>
					fn(tx, await resolveActor(tx, { workspaceId, userId: session.userId, requestId }))
				)
		}
	}
}
