import type { Sql } from '@huriro/db'
import { Elysia } from 'elysia'
import type { Auth } from '../identity'
import { workspaceDerive } from '../tenancy'
import { SearchQuery } from './schema'
import { processSearchOutboxEvent, searchWorkspace } from './service'

export { processSearchOutboxEvent }

export function searchModule(sql: Sql, auth: Auth | null) {
	return new Elysia({ name: 'huriro.search' })
		.derive(workspaceDerive(sql, auth))
		.get('/search', { query: SearchQuery }, ({ query, inWorkspace }) =>
			inWorkspace((tx, actor) => searchWorkspace(tx, actor, query.q, query.limit ?? 20))
		)
}
