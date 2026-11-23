export const WEBHOOKS_CONSUMER = 'webhooks-enqueue'

export const WEBHOOK_EVENTS = {
	EndpointCreated: 'webhooks.endpoint.created.v1',
	EndpointUpdated: 'webhooks.endpoint.updated.v1',
	EndpointDeleted: 'webhooks.endpoint.deleted.v1'
} as const
