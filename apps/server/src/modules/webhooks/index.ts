import type { Sql } from '@huriro/db'
import { Elysia } from 'elysia'
import type { Auth } from '../identity'
import { workspaceDerive } from '../tenancy'
import {
	CreateWebhookBody,
	DeliveryIdParam,
	ListDeliveriesQuery,
	UpdateWebhookBody,
	WebhookIdParam
} from './schema'
import {
	createWebhookEndpoint,
	deleteWebhookEndpoint,
	enqueueWebhookDeliveriesForOutboxEvent,
	listWebhookDeliveries,
	listWebhookEndpoints,
	processDueWebhookDeliveriesOnce,
	replayWebhookDelivery,
	updateWebhookEndpoint,
	type WebhookRuntimeOptions
} from './service'

export { enqueueWebhookDeliveriesForOutboxEvent, processDueWebhookDeliveriesOnce, type WebhookRuntimeOptions }

export function webhooksModule(sql: Sql, auth: Auth | null, opts: WebhookRuntimeOptions) {
	return new Elysia({ name: 'huriro.webhooks' })
		.derive(workspaceDerive(sql, auth))
		.get('/webhooks', ({ inWorkspace }) =>
			inWorkspace(async (tx, actor) => ({ data: await listWebhookEndpoints(tx, actor) }))
		)
		.post('/webhooks', { body: CreateWebhookBody }, async ({ body, inWorkspace, set }) => {
			const res = await inWorkspace((tx, actor) => createWebhookEndpoint(tx, actor, body, opts))
			set.status = 201
			return res
		})
		.patch(
			'/webhooks/:id',
			{ params: WebhookIdParam, body: UpdateWebhookBody },
			({ params, body, inWorkspace }) =>
				inWorkspace((tx, actor) => updateWebhookEndpoint(tx, actor, params.id, body, opts))
		)
		.delete('/webhooks/:id', { params: WebhookIdParam }, async ({ params, inWorkspace }) => {
			await inWorkspace((tx, actor) => deleteWebhookEndpoint(tx, actor, params.id))
			return { deleted: true, id: params.id }
		})
		.get(
			'/webhooks/:id/deliveries',
			{ params: WebhookIdParam, query: ListDeliveriesQuery },
			({ params, query, inWorkspace }) =>
				inWorkspace(async (tx, actor) => ({
					data: await listWebhookDeliveries(tx, actor, params.id, query.limit ?? 50)
				}))
		)
		.post(
			'/webhooks/deliveries/:deliveryId/replay',
			{ params: DeliveryIdParam },
			async ({ params, inWorkspace }) => {
				// Validate actor permissions & resolve actor context first, then run replay outside open tx.
				const actor = await inWorkspace(async (_tx, resolved) => resolved)
				return replayWebhookDelivery(sql, actor, params.deliveryId, opts)
			}
		)
}
