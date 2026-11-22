// Identity tables — owned by the `identity` module (§5.4).
// `users` is instance-level: Better Auth adopts this table in the auth
// increment (§8.3); until then the identity module is the only writer.

import { sql } from 'drizzle-orm'
import { boolean, pgTable, text, timestamp, uuid } from 'drizzle-orm/pg-core'

export const users = pgTable('users', {
	id: uuid('id').primaryKey().default(sql`uuidv7()`),
	email: text('email').notNull(), // citext in SQL
	displayName: text('display_name').notNull(),
	avatarUrl: text('avatar_url'),
	locale: text('locale').notNull().default('en'),
	timezone: text('timezone').notNull().default('UTC'),
	mfaEnabled: boolean('mfa_enabled').notNull().default(false),
	createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
	updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
	deletedAt: timestamp('deleted_at', { withTimezone: true })
})
