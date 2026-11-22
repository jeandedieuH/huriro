// Sync tables — owned by the `sync` module (§9.4).
import { sql } from 'drizzle-orm'
import { pgTable, text, timestamp, unique, uuid } from 'drizzle-orm/pg-core'
import { users } from './identity'
import { workspaces } from './tenancy'

export const realtimeTickets = pgTable(
	'realtime_tickets',
	{
		id: uuid('id').primaryKey().default(sql`uuidv7()`),
		workspaceId: uuid('workspace_id')
			.notNull()
			.references(() => workspaces.id, { onDelete: 'cascade' }),
		userId: uuid('user_id')
			.notNull()
			.references(() => users.id, { onDelete: 'cascade' }),
		deviceId: text('device_id').notNull(),
		tokenHash: text('token_hash').notNull(),
		expiresAt: timestamp('expires_at', { withTimezone: true }).notNull(),
		consumedAt: timestamp('consumed_at', { withTimezone: true }),
		createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow()
	},
	(t) => [
		unique('uq_realtime_tickets_ws_id').on(t.workspaceId, t.id),
		unique('uq_realtime_tickets_token_hash').on(t.tokenHash)
	]
)
