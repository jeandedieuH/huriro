// Files table — owned by the `files` module (§5.4, §8.7, §12.6).
import { sql } from 'drizzle-orm'
import { bigint, boolean, pgTable, text, timestamp, unique, uuid } from 'drizzle-orm/pg-core'
import { users } from './identity'
import { workspaces } from './tenancy'

export const files = pgTable(
	'files',
	{
		id: uuid('id').primaryKey().default(sql`uuidv7()`),
		workspaceId: uuid('workspace_id')
			.notNull()
			.references(() => workspaces.id, { onDelete: 'cascade' }),
		uploadedBy: uuid('uploaded_by').references(() => users.id, { onDelete: 'set null' }),
		storageKey: text('storage_key').notNull(),
		quarantineKey: text('quarantine_key'),
		filename: text('filename').notNull(),
		contentType: text('content_type').notNull(),
		declaredContentType: text('declared_content_type'),
		byteSize: bigint('byte_size', { mode: 'bigint' }).notNull(),
		checksum: text('checksum').notNull(),
		scanStatus: text('scan_status', {
			enum: ['pending', 'clean', 'infected', 'failed', 'unscanned']
		})
			.notNull()
			.default('pending'),
		scanDetail: text('scan_detail'),
		scannedAt: timestamp('scanned_at', { withTimezone: true }),
		promotedAt: timestamp('promoted_at', { withTimezone: true }),
		reencoded: boolean('reencoded').notNull().default(false),
		isPublic: boolean('is_public').notNull().default(false),
		createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow()
	},
	(t) => [unique('uq_files_ws_id').on(t.workspaceId, t.id), unique('uq_files_storage_key').on(t.storageKey)]
)
