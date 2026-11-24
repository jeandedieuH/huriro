// GDPR governance tables — owned by the `governance` module (§22.2).
import { sql } from 'drizzle-orm'
import { bigint, jsonb, pgTable, text, timestamp, unique, uuid } from 'drizzle-orm/pg-core'
import { users } from './identity'
import { workspaces } from './tenancy'

export const workspaceExports = pgTable(
	'workspace_exports',
	{
		id: uuid('id').primaryKey().default(sql`uuidv7()`),
		workspaceId: uuid('workspace_id')
			.notNull()
			.references(() => workspaces.id, { onDelete: 'cascade' }),
		requestedBy: uuid('requested_by').references(() => users.id, { onDelete: 'set null' }),
		status: text('status', { enum: ['pending', 'processing', 'completed', 'failed'] })
			.notNull()
			.default('pending'),
		storageKey: text('storage_key'),
		byteSize: bigint('byte_size', { mode: 'number' }).notNull().default(0),
		manifest: jsonb('manifest').notNull().default({}),
		expiresAt: timestamp('expires_at', { withTimezone: true }),
		errorDetail: text('error_detail'),
		createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
		updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow()
	},
	(t) => [unique('uq_workspace_exports_ws_id').on(t.workspaceId, t.id)]
)
