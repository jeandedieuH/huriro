import { Type } from 'typebox'

export { CreateWebhookBody, UpdateWebhookBody } from '@huriro/contracts'

export const WebhookIdParam = Type.Object({
	id: Type.String({ format: 'uuid' })
})

export const DeliveryIdParam = Type.Object({
	deliveryId: Type.String({ format: 'uuid' })
})

export const ListDeliveriesQuery = Type.Object({
	limit: Type.Optional(Type.Integer({ minimum: 1, maximum: 200, default: 50 }))
})
