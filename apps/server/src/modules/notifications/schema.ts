import { Type } from 'typebox'

export { NotificationsListQuery } from '@huriro/contracts'

export const NotificationIdParam = Type.Object({
	id: Type.String({ format: 'uuid' })
})
