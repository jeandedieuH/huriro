import { type Static, Type } from 'typebox'

export const WebhookDeliveryStatus = Type.Union([
	Type.Literal('pending'),
	Type.Literal('delivered'),
	Type.Literal('retrying'),
	Type.Literal('failed')
])
export type WebhookDeliveryStatus = Static<typeof WebhookDeliveryStatus>

export const WebhookEndpointDto = Type.Object({
	id: Type.String({ format: 'uuid' }),
	workspaceId: Type.String({ format: 'uuid' }),
	name: Type.String(),
	url: Type.String(),
	secretPrefix: Type.String(),
	events: Type.Array(Type.String()),
	enabled: Type.Boolean(),
	createdBy: Type.Union([Type.String({ format: 'uuid' }), Type.Null()]),
	createdAt: Type.String(),
	updatedAt: Type.String(),
	version: Type.Integer({ minimum: 1 })
})
export type WebhookEndpointDto = Static<typeof WebhookEndpointDto>

export const CreateWebhookBody = Type.Object({
	name: Type.String({ minLength: 1, maxLength: 120 }),
	url: Type.String({ minLength: 1, maxLength: 2048 }),
	events: Type.Array(Type.String({ minLength: 1, maxLength: 120 }), { minItems: 1, maxItems: 50 }),
	enabled: Type.Optional(Type.Boolean())
})
export type CreateWebhookBody = Static<typeof CreateWebhookBody>

export const CreateWebhookResponse = Type.Object({
	endpoint: WebhookEndpointDto,
	signingSecret: Type.String()
})
export type CreateWebhookResponse = Static<typeof CreateWebhookResponse>

export const UpdateWebhookBody = Type.Object({
	name: Type.Optional(Type.String({ minLength: 1, maxLength: 120 })),
	url: Type.Optional(Type.String({ minLength: 1, maxLength: 2048 })),
	events: Type.Optional(
		Type.Array(Type.String({ minLength: 1, maxLength: 120 }), { minItems: 1, maxItems: 50 })
	),
	enabled: Type.Optional(Type.Boolean()),
	rotateSecret: Type.Optional(Type.Boolean()),
	version: Type.Integer({ minimum: 1 })
})
export type UpdateWebhookBody = Static<typeof UpdateWebhookBody>

export const WebhookDeliveryDto = Type.Object({
	id: Type.String({ format: 'uuid' }),
	workspaceId: Type.String({ format: 'uuid' }),
	endpointId: Type.String({ format: 'uuid' }),
	eventId: Type.Union([Type.String({ format: 'uuid' }), Type.Null()]),
	eventType: Type.String(),
	payload: Type.Record(Type.String(), Type.Unknown()),
	status: WebhookDeliveryStatus,
	attempts: Type.Integer({ minimum: 0 }),
	maxAttempts: Type.Integer({ minimum: 1 }),
	nextAttemptAt: Type.String(),
	lastStatusCode: Type.Union([Type.Integer(), Type.Null()]),
	lastResponseBody: Type.Union([Type.String(), Type.Null()]),
	lastError: Type.Union([Type.String(), Type.Null()]),
	deliveredAt: Type.Union([Type.String(), Type.Null()]),
	createdAt: Type.String(),
	updatedAt: Type.String()
})
export type WebhookDeliveryDto = Static<typeof WebhookDeliveryDto>
