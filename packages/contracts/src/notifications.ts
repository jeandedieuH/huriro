import { type Static, Type } from 'typebox'

export const NotificationKind = Type.Union([
	Type.Literal('issue.assigned'),
	Type.Literal('issue.mentioned'),
	Type.Literal('issue.commented'),
	Type.Literal('issue.status_changed'),
	Type.Literal('project.access_granted'),
	Type.Literal('doc.mentioned'),
	Type.Literal('doc.commented'),
	Type.Literal('doc.comment_resolved'),
	Type.Literal('doc.access_granted'),
	Type.Literal('chat.mentioned'),
	Type.Literal('chat.dm'),
	Type.Literal('chat.reply'),
	Type.Literal('chat.message'),
	Type.Literal('channel.access_granted'),
	Type.Literal('approval.requested'),
	Type.Literal('mail.assigned'),
	Type.Literal('mail.mentioned'),
	Type.Literal('mail.reply_needed')
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

export const ChatNotificationLevel = Type.Union([
	Type.Literal('all'),
	Type.Literal('mentions'),
	Type.Literal('none')
])
export type ChatNotificationLevel = Static<typeof ChatNotificationLevel>

export const EmailDigestFrequency = Type.Union([
	Type.Literal('off'),
	Type.Literal('hourly'),
	Type.Literal('daily')
])
export type EmailDigestFrequency = Static<typeof EmailDigestFrequency>

export const NotificationPreferencesDto = Type.Object({
	workspaceId: Type.String({ format: 'uuid' }),
	userId: Type.String({ format: 'uuid' }),
	chatLevel: ChatNotificationLevel,
	emailDigestFrequency: EmailDigestFrequency,
	quietHoursStart: Type.Union([Type.String(), Type.Null()]),
	quietHoursEnd: Type.Union([Type.String(), Type.Null()]),
	timezone: Type.String(),
	webPushEnabled: Type.Boolean(),
	lastDigestSentAt: Type.Union([Type.String(), Type.Null()]),
	updatedAt: Type.String()
})
export type NotificationPreferencesDto = Static<typeof NotificationPreferencesDto>

export const UpdateNotificationPreferencesBody = Type.Object({
	chatLevel: Type.Optional(ChatNotificationLevel),
	emailDigestFrequency: Type.Optional(EmailDigestFrequency),
	quietHoursStart: Type.Optional(Type.Union([Type.String({ pattern: '^\\d{2}:\\d{2}$' }), Type.Null()])),
	quietHoursEnd: Type.Optional(Type.Union([Type.String({ pattern: '^\\d{2}:\\d{2}$' }), Type.Null()])),
	timezone: Type.Optional(Type.String({ minLength: 1, maxLength: 80 })),
	webPushEnabled: Type.Optional(Type.Boolean())
})
export type UpdateNotificationPreferencesBody = Static<typeof UpdateNotificationPreferencesBody>

export const WebPushSubscriptionDto = Type.Object({
	id: Type.String({ format: 'uuid' }),
	workspaceId: Type.String({ format: 'uuid' }),
	userId: Type.String({ format: 'uuid' }),
	endpoint: Type.String(),
	userAgent: Type.String(),
	lastUsedAt: Type.Union([Type.String(), Type.Null()]),
	revokedAt: Type.Union([Type.String(), Type.Null()]),
	createdAt: Type.String()
})
export type WebPushSubscriptionDto = Static<typeof WebPushSubscriptionDto>

export const CreateWebPushSubscriptionBody = Type.Object({
	endpoint: Type.String({ minLength: 1, maxLength: 2048 }),
	keys: Type.Object({
		p256dh: Type.String({ minLength: 1, maxLength: 512 }),
		auth: Type.String({ minLength: 1, maxLength: 512 })
	}),
	userAgent: Type.Optional(Type.String({ maxLength: 500 }))
})
export type CreateWebPushSubscriptionBody = Static<typeof CreateWebPushSubscriptionBody>

export const NotificationDeliveryLogDto = Type.Object({
	id: Type.String({ format: 'uuid' }),
	workspaceId: Type.String({ format: 'uuid' }),
	notificationId: Type.Union([Type.String({ format: 'uuid' }), Type.Null()]),
	userId: Type.String({ format: 'uuid' }),
	channel: Type.Union([Type.Literal('in_app'), Type.Literal('email_digest'), Type.Literal('web_push')]),
	status: Type.Union([
		Type.Literal('pending'),
		Type.Literal('sent'),
		Type.Literal('skipped_quiet_hours'),
		Type.Literal('failed')
	]),
	dedupeKey: Type.Union([Type.String(), Type.Null()]),
	detail: Type.Union([Type.String(), Type.Null()]),
	createdAt: Type.String()
})
export type NotificationDeliveryLogDto = Static<typeof NotificationDeliveryLogDto>
