/**
 * Filter query service (§3.4): POST /issues/query interprets domain
 * FilterExpr to SQL. Same discipline as service.ts: authorize →
 * validate/version → domain rows + outbox events + batched change_log —
 * all inside the caller's `withWorkspace` tx.
 */
import { decodeCursor, encodeCursor, type IssueDto, type QueryIssuesBody } from '@huriro/contracts'
import type { Queryable } from '@huriro/db'
import type { ActorContext } from '@huriro/domain'
import { HttpError } from '../../api/error'
import { buildIssueFilterSql } from './filter-sql'
import { queryIssuesExpr } from './repo'
import { listAccessibleProjects } from './service'

// ---------- POST /issues/query (§3.4) ----------

export async function queryIssues(
	tx: Queryable,
	actor: ActorContext,
	body: QueryIssuesBody
): Promise<{ readonly data: IssueDto[]; readonly nextCursor: string | null; readonly hasMore: boolean }> {
	if (actor.membership !== 'active') {
		throw new HttpError(403, 'not_workspace_member', 'Active workspace membership required')
	}
	const projects = await listAccessibleProjects(tx, actor)
	const visibleIds = projects.map((p) => p.id)
	const filter = body.filter ? buildIssueFilterSql(tx, body.filter, { now: new Date() }) : undefined
	const sortBy = body.sortBy === 'manual' || body.sortBy === undefined ? 'position' : body.sortBy
	const sortDir = body.sortDirection ?? 'asc'
	const cursor = decodeCursor<{ k: string | number | null; id: string }>(body.cursor)
	const limit = body.limit ?? 50

	const res = await queryIssuesExpr(tx, {
		workspaceId: actor.workspaceId,
		visibleProjectIds: visibleIds,
		filter,
		sortBy,
		sortDir,
		cursor,
		limit
	})
	const last = res.items.at(-1) as (IssueDto & { sortKey?: string | number | null }) | undefined
	const nextCursor = res.hasMore && last ? encodeCursor({ k: last.sortKey ?? null, id: last.id }) : null
	return {
		data: res.items.map(({ ...i }) => i as IssueDto),
		nextCursor,
		hasMore: res.hasMore
	}
}
