// Availability tables — owned by the `availability` module (ADR-0035).
import { sql } from 'drizzle-orm'
import { boolean, integer, jsonb, pgTable, primaryKey, text, timestamp, unique, uuid } from 'drizzle-orm/pg-core'
import { users } from './identity'
import { workspaces } from './tenancy'

export const userWorkspaceProfiles = pgTable(
	'user_workspace_profiles',
	{
		workspaceId: uuid('workspace_id')
			.notNull()
			.references(() => workspaces.id, { onDelete: 'cascade' }),
		userId: uuid('user_id')
			.notNull()
			.references(() => users.id, { onDelete: 'cascade' }),
		statusEmoji: text('status_emoji'),
		statusText: text('status_text').notNull().default(''),
		statusExpiresAt: timestamp('status_expires_at', { withTimezone: true }),
		dndUntil: timestamp('dnd_until', { withTimezone: true }),
		workingHours: jsonb('working_hours').notNull().default({}),
		lastSeenAt: timestamp('last_seen_at', { withTimezone: true }),
		manualState: text('manual_state', {
			enum: ['auto', 'available', 'busy', 'dnd', 'away', 'ooo']
		})
			.notNull()
			.default('auto'),
		manualStateExpiresAt: timestamp('manual_state_expires_at', { withTimezone: true }),
		timezone: text('timezone').notNull().default('UTC'),
		suppressNotificationsOffHours: boolean('suppress_notifications_off_hours').notNull().default(false),
		allowUrgentOverride: boolean('allow_urgent_override').notNull().default(true),
		version: integer('version').notNull().default(1),
		createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
		updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow()
	},
	(t) => [primaryKey({ columns: [t.workspaceId, t.userId] })]
)

export const userAvailabilityWindows = pgTable(
	'user_availability_windows',
	{
		id: uuid('id').primaryKey().default(sql`uuidv7()`),
		workspaceId: uuid('workspace_id')
			.notNull()
			.references(() => workspaces.id, { onDelete: 'cascade' }),
		userId: uuid('user_id')
			.notNull()
			.references(() => users.id, { onDelete: 'cascade' }),
		kind: text('kind', { enum: ['ooo', 'focus', 'dnd'] })
			.notNull()
			.default('ooo'),
		title: text('title').notNull().default(''),
		message: text('message').notNull().default(''),
		startsAt: timestamp('starts_at', { withTimezone: true }).notNull(),
		endsAt: timestamp('ends_at', { withTimezone: true }).notNull(),
		delegateUserId: uuid('delegate_user_id').references(() => users.id, { onDelete: 'set null' }),
		autoDeclineRouting: boolean('auto_decline_routing').notNull().default(true),
		suppressNotifications: boolean('suppress_notifications').notNull().default(true),
		startedEventEmittedAt: timestamp('started_event_emitted_at', { withTimezone: true }),
		endedEventEmittedAt: timestamp('ended_event_emitted_at', { withTimezone: true }),
		createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
		updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
		version: integer('version').notNull().default(1)
	},
	(t) => [
		unique('uq_uaw_ws_id').on(t.workspaceId, t.id)
	]
)
