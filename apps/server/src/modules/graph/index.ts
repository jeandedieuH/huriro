/**
 * Graph controller & cross-module seam (§7.1, ADR-0033).
 * Reads traverse through each owning module's access seam; writes use the
 * shared `api/entity-links` helper so other modules never import this module.
 */
import type { Sql } from '@huriro/db'
import { Elysia } from 'elysia'
import { withIdempotency } from '../../api/context'
import { HttpError } from '../../api/error'
import type { RealtimePubSub } from '../../realtime/pubsub'
import type { Auth } from '../identity'
import { workspaceDerive } from '../tenancy'
import {
	CreateEntityLinkBody,
	GraphLinksQuery,
	GraphPeekQuery,
	KnowledgeGraphQuery,
	LinkIdParam
} from './schema'
import {
	createEntityLink,
	deleteEntityLinkForActor,
	getKnowledgeGraph,
	listEntityLinksFor,
	peekEntity
} from './service'

export { listEntityLinksFor } from './service'

export function graphModule(sql: Sql, auth: Auth | null, pubsub?: RealtimePubSub) {
	return new Elysia({ name: 'huriro.graph' })
		.derive(workspaceDerive(sql, auth))
		.get('/graph/knowledge', { query: KnowledgeGraphQuery }, ({ query, inWorkspace }) =>
			inWorkspace((tx, actor) => getKnowledgeGraph(tx, actor, query))
		)
		.post(
			'/graph/links',
			{ body: CreateEntityLinkBody },
			async ({ body, headers, workspaceCtx, inWorkspace, set }) => {
				const res = await inWorkspace((tx, actor) =>
					withIdempotency(tx, {
						workspaceId: workspaceCtx.workspaceId,
						key: headers['idempotency-key'],
						endpoint: 'POST /api/v1/graph/links',
						requestBody: body,
						successStatus: 201,
						execute: () => createEntityLink(tx, actor, body)
					})
				)
				set.status = res.status
				if (!res.replayed && res.body.created && res.body.cursor !== null && pubsub) {
					await pubsub.publishCursor(workspaceCtx.workspaceId, res.body.cursor)
				}
				return res.body.data
			}
		)
		.delete('/graph/links/:linkId', { params: LinkIdParam }, async ({ params, inWorkspace }) => {
			const deleted = await inWorkspace((tx, actor) => deleteEntityLinkForActor(tx, actor, params.linkId))
			if (!deleted) throw new HttpError(404, 'not_found', 'Link not found')
			return { deleted: true, id: params.linkId }
		})
		.get('/graph/links', { query: GraphLinksQuery }, ({ query, inWorkspace }) =>
			inWorkspace(async (tx, actor) => ({ data: await listEntityLinksFor(tx, actor, query.type, query.id) }))
		)
		.get('/graph/peek', { query: GraphPeekQuery }, ({ query, inWorkspace }) =>
			inWorkspace((tx, actor) => peekEntity(tx, actor, query.type, query.id))
		)
}
