import { type Static, Type } from 'typebox'

export const NotificationKind = Type.Union([
	Type.Literal('issue.assigned'),
	Type.Literal('issue.mentioned'),
	Type.Literal('issue.commented'),
	Type.Literal('issue.status_changed'),
	Type.Literal('project.access_granted')
])
export type NotificationKind = Static<typeof NotificationKind>

export const NotificationDto = Type.Object({
	id: Type.String({ format: 'uuid' }),
	workspaceId: Type.String({ format: 'uuid' }),
	recipientUserId: Type.String({ format: 'uuid' }),
	actorType: Type.Union([Type.Literal('user'), Type.Literal('agent'), Type.Literal('system')]),
	actorId: Type.Union([Type.String({ format: 'uuid' }), Type.Null()]),
	kind: NotificationKind,
	entityType: Type.String(),
	entityId: Type.String({ format: 'uuid' }),
	title: Type.String(),
	body: Type.String(),
	metadata: Type.Record(Type.String(), Type.Unknown()),
	readAt: Type.Union([Type.String(), Type.Null()]),
	archivedAt: Type.Union([Type.String(), Type.Null()]),
	createdAt: Type.String()
})
export type NotificationDto = Static<typeof NotificationDto>

export const NotificationsListQuery = Type.Object({
	unreadOnly: Type.Optional(Type.Boolean()),
	limit: Type.Optional(Type.Integer({ minimum: 1, maximum: 100, default: 50 })),
	cursor: Type.Optional(Type.String())
})
export type NotificationsListQuery = Static<typeof NotificationsListQuery>

export const NotificationsListResponse = Type.Object({
	data: Type.Array(NotificationDto),
	unreadCount: Type.Integer({ minimum: 0 }),
	nextCursor: Type.Union([Type.String(), Type.Null()]),
	hasMore: Type.Boolean()
})
export type NotificationsListResponse = Static<typeof NotificationsListResponse>
