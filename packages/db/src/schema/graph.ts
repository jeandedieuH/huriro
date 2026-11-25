// Unified cross-entity link graph — owned by the `graph` module (§5.4, §7.1,
// ADR-0033). One typed edge table replaces the per-pillar link tables; source
// and target are polymorphic (no FK) — referential integrity lives in the
// service layer + transactional cleanup on entity delete.
import { sql } from 'drizzle-orm'
import { check, index, pgTable, text, timestamp, unique, uuid } from 'drizzle-orm/pg-core'
import { users } from './identity'
import { workspaces } from './tenancy'

const ENTITY_TYPES = [
	'issue',
	'doc_page',
	'doc_database_row',
	'chat_message',
	'mail_conversation',
	'contact_org',
	'vcs_pr'
] as const

export const entityLinks = pgTable(
	'entity_links',
	{
		id: uuid('id').primaryKey().default(sql`uuidv7()`),
		workspaceId: uuid('workspace_id')
			.notNull()
			.references(() => workspaces.id, { onDelete: 'cascade' }),
		sourceType: text('source_type', { enum: ENTITY_TYPES }).notNull(),
		sourceId: uuid('source_id').notNull(),
		targetType: text('target_type', { enum: ENTITY_TYPES }).notNull(),
		targetId: uuid('target_id').notNull(),
		relationKind: text('relation_kind', {
			enum: ['references', 'blocks', 'duplicates', 'originated_from', 'tracked_by', 'requested_by']
		})
			.notNull()
			.default('references'),
		createdBy: uuid('created_by').references(() => users.id, { onDelete: 'set null' }),
		createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow()
	},
	(t) => [
		unique('uq_entity_links_ws_id').on(t.workspaceId, t.id),
		unique('uq_entity_links_edge').on(
			t.workspaceId,
			t.sourceType,
			t.sourceId,
			t.targetType,
			t.targetId,
			t.relationKind
		),
		check('ck_entity_links_no_self', sql`NOT (source_type = target_type AND source_id = target_id)`),
		index('idx_entity_links_src').on(t.workspaceId, t.sourceType, t.sourceId),
		index('idx_entity_links_tgt').on(t.workspaceId, t.targetType, t.targetId)
	]
)
