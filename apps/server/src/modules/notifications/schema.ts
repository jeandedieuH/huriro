import { Type } from 'typebox'

export {
	CreateWebPushSubscriptionBody,
	NotificationsListQuery,
	UpdateNotificationPreferencesBody
} from '@huriro/contracts'

export const NotificationIdParam = Type.Object({
	id: Type.String({ format: 'uuid' })
})

export const SubscriptionIdParam = Type.Object({
	id: Type.String({ format: 'uuid' })
})

export const DeliveryLogQuery = Type.Object({
	limit: Type.Optional(Type.Integer({ minimum: 1, maximum: 200, default: 50 }))
})
