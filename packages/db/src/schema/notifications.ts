// Notifications tables — owned by the `notifications` module (§5.4, §15).
import { sql } from 'drizzle-orm'
import { jsonb, pgTable, text, timestamp, unique, uuid } from 'drizzle-orm/pg-core'
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
				'doc.access_granted'
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
