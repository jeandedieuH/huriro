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
	Type.Literal('doc.verification_expiring'),
	Type.Literal('doc.suggestion_created'),
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
	mobilePushEnabled: Type.Boolean(),
	emailInstantEnabled: Type.Boolean(),
	alertKeywords: Type.Array(Type.String()),
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
	webPushEnabled: Type.Optional(Type.Boolean()),
	mobilePushEnabled: Type.Optional(Type.Boolean()),
	emailInstantEnabled: Type.Optional(Type.Boolean()),
	alertKeywords: Type.Optional(Type.Array(Type.String({ minLength: 1, maxLength: 80 }), { maxItems: 50 }))
})
export type UpdateNotificationPreferencesBody = Static<typeof UpdateNotificationPreferencesBody>

export const MobilePushPlatform = Type.Union([
	Type.Literal('ios'),
	Type.Literal('android'),
	Type.Literal('expo')
])
export type MobilePushPlatform = Static<typeof MobilePushPlatform>

export const MobilePushTokenDto = Type.Object({
	id: Type.String({ format: 'uuid' }),
	workspaceId: Type.String({ format: 'uuid' }),
	userId: Type.String({ format: 'uuid' }),
	token: Type.String(),
	platform: MobilePushPlatform,
	deviceId: Type.String(),
	deviceName: Type.String(),
	lastUsedAt: Type.Union([Type.String(), Type.Null()]),
	revokedAt: Type.Union([Type.String(), Type.Null()]),
	createdAt: Type.String()
})
export type MobilePushTokenDto = Static<typeof MobilePushTokenDto>

export const RegisterMobilePushTokenBody = Type.Object({
	token: Type.String({ minLength: 10, maxLength: 512 }),
	platform: MobilePushPlatform,
	deviceId: Type.String({ minLength: 1, maxLength: 128 }),
	deviceName: Type.Optional(Type.String({ maxLength: 200 }))
})
export type RegisterMobilePushTokenBody = Static<typeof RegisterMobilePushTokenBody>

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
	channel: Type.Union([
		Type.Literal('in_app'),
		Type.Literal('email_digest'),
		Type.Literal('email_instant'),
		Type.Literal('web_push'),
		Type.Literal('mobile_push')
	]),
	status: Type.Union([
		Type.Literal('pending'),
		Type.Literal('sent'),
		Type.Literal('skipped_quiet_hours'),
		Type.Literal('skipped_dnd'),
		Type.Literal('skipped_ooo'),
		Type.Literal('skipped_off_hours'),
		Type.Literal('failed')
	]),
	dedupeKey: Type.Union([Type.String(), Type.Null()]),
	detail: Type.Union([Type.String(), Type.Null()]),
	createdAt: Type.String()
})
export type NotificationDeliveryLogDto = Static<typeof NotificationDeliveryLogDto>

export const EmailProviderName = Type.Union([
	Type.Literal('emailit'),
	Type.Literal('resend'),
	Type.Literal('smtp'),
	Type.Literal('noop'),
	Type.Literal('custom')
])
export type EmailProviderName = Static<typeof EmailProviderName>

export const EmailPipelineStatusDto = Type.Object({
	configured: Type.Boolean(),
	mode: Type.Union([Type.Literal('selfhost'), Type.Literal('cloud')]),
	provider: EmailProviderName,
	from: Type.String(),
	emailVerificationRequired: Type.Boolean()
})
export type EmailPipelineStatusDto = Static<typeof EmailPipelineStatusDto>

export const SendTestEmailBody = Type.Object({
	to: Type.Optional(Type.String({ format: 'email' }))
})
export type SendTestEmailBody = Static<typeof SendTestEmailBody>

export const SendTestEmailResponse = Type.Object({
	sent: Type.Boolean(),
	provider: EmailProviderName,
	messageId: Type.Union([Type.String(), Type.Null()]),
	to: Type.String()
})
export type SendTestEmailResponse = Static<typeof SendTestEmailResponse>
