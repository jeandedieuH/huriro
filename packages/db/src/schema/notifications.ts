// Notifications tables — owned by the `notifications` module (§5.4, §15).
import { sql } from 'drizzle-orm'
import {
	boolean,
	foreignKey,
	jsonb,
	pgTable,
	primaryKey,
	text,
	timestamp,
	unique,
	uuid
} from 'drizzle-orm/pg-core'
import { users } from './identity'
import { workspaces } from './tenancy'

export const notifications = pgTable(
	'notifications',
	{
		id: uuid('id').primaryKey().default(sql`uuidv7()`),
		workspaceId: uuid('workspace_id')
			.notNull()
			.references(() => workspaces.id, { onDelete: 'cascade' }),
		recipientUserId: uuid('recipient_user_id')
			.notNull()
			.references(() => users.id, { onDelete: 'cascade' }),
		actorType: text('actor_type', { enum: ['user', 'agent', 'system'] }).notNull(),
		actorId: uuid('actor_id'),
		kind: text('kind', {
			enum: [
				'issue.assigned',
				'issue.mentioned',
				'issue.commented',
				'issue.status_changed',
				'project.access_granted',
				'doc.mentioned',
				'doc.commented',
				'doc.comment_resolved',
				'doc.access_granted',
				'chat.mentioned',
				'chat.dm',
				'chat.reply',
				'chat.message',
				'channel.access_granted'
			]
		}).notNull(),
		entityType: text('entity_type').notNull(),
		entityId: uuid('entity_id').notNull(),
		title: text('title').notNull(),
		body: text('body').notNull().default(''),
		metadata: jsonb('metadata').notNull().default({}),
		readAt: timestamp('read_at', { withTimezone: true }),
		archivedAt: timestamp('archived_at', { withTimezone: true }),
		createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow()
	},
	(t) => [unique('uq_notifications_ws_id').on(t.workspaceId, t.id)]
)

export const notificationPreferences = pgTable(
	'notification_preferences',
	{
		workspaceId: uuid('workspace_id')
			.notNull()
			.references(() => workspaces.id, { onDelete: 'cascade' }),
		userId: uuid('user_id')
			.notNull()
			.references(() => users.id, { onDelete: 'cascade' }),
		chatLevel: text('chat_level', { enum: ['all', 'mentions', 'none'] })
			.notNull()
			.default('mentions'),
		emailDigestFrequency: text('email_digest_frequency', { enum: ['off', 'hourly', 'daily'] })
			.notNull()
			.default('off'),
		quietHoursStart: text('quiet_hours_start'),
		quietHoursEnd: text('quiet_hours_end'),
		timezone: text('timezone').notNull().default('UTC'),
		webPushEnabled: boolean('web_push_enabled').notNull().default(false),
		lastDigestSentAt: timestamp('last_digest_sent_at', { withTimezone: true }),
		createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
		updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow()
	},
	(t) => [primaryKey({ columns: [t.workspaceId, t.userId] })]
)

export const notificationDeliveryLog = pgTable(
	'notification_delivery_log',
	{
		id: uuid('id').primaryKey().default(sql`uuidv7()`),
		workspaceId: uuid('workspace_id')
			.notNull()
			.references(() => workspaces.id, { onDelete: 'cascade' }),
		notificationId: uuid('notification_id'),
		userId: uuid('user_id')
			.notNull()
			.references(() => users.id, { onDelete: 'cascade' }),
		channel: text('channel', { enum: ['in_app', 'email_digest', 'web_push'] }).notNull(),
		status: text('status', { enum: ['pending', 'sent', 'skipped_quiet_hours', 'failed'] }).notNull(),
		dedupeKey: text('dedupe_key'),
		detail: text('detail'),
		createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow()
	},
	(t) => [
		unique('uq_notification_delivery_log_ws_id').on(t.workspaceId, t.id),
		foreignKey({
			columns: [t.workspaceId, t.notificationId],
			foreignColumns: [notifications.workspaceId, notifications.id],
			name: 'fk_notification_delivery_log_notif'
		}).onDelete('set null')
	]
)

export const webPushSubscriptions = pgTable(
	'web_push_subscriptions',
	{
		id: uuid('id').primaryKey().default(sql`uuidv7()`),
		workspaceId: uuid('workspace_id')
			.notNull()
			.references(() => workspaces.id, { onDelete: 'cascade' }),
		userId: uuid('user_id')
			.notNull()
			.references(() => users.id, { onDelete: 'cascade' }),
		endpoint: text('endpoint').notNull(),
		p256dh: text('p256dh').notNull(),
		authSecret: text('auth_secret').notNull(),
		userAgent: text('user_agent').notNull().default(''),
		lastUsedAt: timestamp('last_used_at', { withTimezone: true }),
		revokedAt: timestamp('revoked_at', { withTimezone: true }),
		createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
		updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow()
	},
	(t) => [
		unique('uq_web_push_subscriptions_ws_id').on(t.workspaceId, t.id),
		unique('uq_web_push_subscriptions_ws_user_ep').on(t.workspaceId, t.userId, t.endpoint)
	]
)
