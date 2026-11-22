// Docs tables — owned by the `docs` module (§5.4, §8.4, §10).
import { sql } from 'drizzle-orm'
import {
	bigint,
	boolean,
	customType,
	foreignKey,
	integer,
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

const bytea = customType<{ data: Buffer; driverData: Buffer }>({
	dataType() {
		return 'bytea'
	}
})

export const docPages = pgTable(
	'doc_pages',
	{
		id: uuid('id').primaryKey().default(sql`uuidv7()`),
		workspaceId: uuid('workspace_id')
			.notNull()
			.references(() => workspaces.id, { onDelete: 'cascade' }),
		parentId: uuid('parent_id'),
		path: text('path').notNull(),
		depth: integer('depth').notNull().default(0),
		slug: text('slug').notNull(),
		title: text('title').notNull(),
		icon: text('icon'),
		visibility: text('visibility', { enum: ['workspace', 'private'] })
			.notNull()
			.default('workspace'),
		isTemplate: boolean('is_template').notNull().default(false),
		position: text('position').notNull(),
		createdBy: uuid('created_by')
			.notNull()
			.references(() => users.id),
		archivedAt: timestamp('archived_at', { withTimezone: true }),
		createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
		updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
		version: integer('version').notNull().default(1)
	},
	(t) => [
		unique('uq_doc_pages_ws_id').on(t.workspaceId, t.id),
		unique('uq_doc_pages_ws_slug').on(t.workspaceId, t.slug)
	]
)

// One live CRDT row per page — uses lease_epoch fencing instead of version (§8.4).
export const docState = pgTable(
	'doc_state',
	{
		workspaceId: uuid('workspace_id')
			.notNull()
			.references(() => workspaces.id, { onDelete: 'cascade' }),
		pageId: uuid('page_id').primaryKey(),
		state: bytea('state').notNull(),
		stateVector: bytea('state_vector').notNull(),
		byteSize: integer('byte_size').notNull(),
		leaseEpoch: bigint('lease_epoch', { mode: 'number' }).notNull().default(0),
		plainText: text('plain_text').notNull().default(''),
		headings: jsonb('headings').notNull().default([]),
		createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
		updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow()
	},
	(t) => [
		unique('uq_doc_state_ws_page').on(t.workspaceId, t.pageId),
		foreignKey({
			columns: [t.workspaceId, t.pageId],
			foreignColumns: [docPages.workspaceId, docPages.id],
			name: 'fk_doc_state_page'
		}).onDelete('cascade')
	]
)

// Immutable version checkpoints (exempt from updated_at/version per §4.2).
export const docVersions = pgTable(
	'doc_versions',
	{
		id: uuid('id').primaryKey().default(sql`uuidv7()`),
		workspaceId: uuid('workspace_id')
			.notNull()
			.references(() => workspaces.id, { onDelete: 'cascade' }),
		pageId: uuid('page_id').notNull(),
		kind: text('kind', { enum: ['auto', 'named', 'pre_restore'] }).notNull(),
		label: text('label'),
		state: bytea('state').notNull(),
		byteSize: integer('byte_size').notNull(),
		plainText: text('plain_text').notNull().default(''),
		authors: uuid('authors').array().notNull().default([]),
		createdBy: uuid('created_by').references(() => users.id, { onDelete: 'set null' }),
		createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow()
	},
	(t) => [
		unique('uq_doc_versions_ws_id').on(t.workspaceId, t.id),
		foreignKey({
			columns: [t.workspaceId, t.pageId],
			foreignColumns: [docPages.workspaceId, docPages.id],
			name: 'fk_doc_versions_page'
		}).onDelete('cascade')
	]
)

// Single-homed room leases (§10.5) — fenced by epoch instead of version.
export const docRoomLeases = pgTable(
	'doc_room_leases',
	{
		workspaceId: uuid('workspace_id')
			.notNull()
			.references(() => workspaces.id, { onDelete: 'cascade' }),
		pageId: uuid('page_id').primaryKey(),
		nodeId: text('node_id').notNull(),
		epoch: bigint('epoch', { mode: 'number' }).notNull().default(1),
		expiresAt: timestamp('expires_at', { withTimezone: true }).notNull(),
		createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
		updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow()
	},
	(t) => [
		unique('uq_doc_room_leases_ws_page').on(t.workspaceId, t.pageId),
		foreignKey({
			columns: [t.workspaceId, t.pageId],
			foreignColumns: [docPages.workspaceId, docPages.id],
			name: 'fk_doc_room_leases_page'
		}).onDelete('cascade')
	]
)

// Single-use collab WS tickets (§10.3; exempt from updated_at/version).
export const collabTickets = pgTable(
	'collab_tickets',
	{
		id: uuid('id').primaryKey().default(sql`uuidv7()`),
		workspaceId: uuid('workspace_id')
			.notNull()
			.references(() => workspaces.id, { onDelete: 'cascade' }),
		pageId: uuid('page_id').notNull(),
		userId: uuid('user_id')
			.notNull()
			.references(() => users.id, { onDelete: 'cascade' }),
		permission: text('permission', { enum: ['read', 'write'] }).notNull(),
		tokenHash: text('token_hash').notNull().unique(),
		expiresAt: timestamp('expires_at', { withTimezone: true }).notNull(),
		consumedAt: timestamp('consumed_at', { withTimezone: true }),
		createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow()
	},
	(t) => [
		unique('uq_collab_tickets_ws_id').on(t.workspaceId, t.id),
		foreignKey({
			columns: [t.workspaceId, t.pageId],
			foreignColumns: [docPages.workspaceId, docPages.id],
			name: 'fk_collab_tickets_page'
		}).onDelete('cascade')
	]
)

export const docComments = pgTable(
	'doc_comments',
	{
		id: uuid('id').primaryKey().default(sql`uuidv7()`),
		workspaceId: uuid('workspace_id')
			.notNull()
			.references(() => workspaces.id, { onDelete: 'cascade' }),
		pageId: uuid('page_id').notNull(),
		parentId: uuid('parent_id'),
		authorType: text('author_type', { enum: ['user', 'agent'] })
			.notNull()
			.default('user'),
		authorId: uuid('author_id').notNull(),
		anchorFrom: text('anchor_from'),
		anchorTo: text('anchor_to'),
		anchorQuote: text('anchor_quote').notNull().default(''),
		anchorBlockId: text('anchor_block_id'),
		anchorOrphaned: boolean('anchor_orphaned').notNull().default(false),
		body: jsonb('body'),
		bodyText: text('body_text').notNull(),
		resolvedAt: timestamp('resolved_at', { withTimezone: true }),
		resolvedBy: uuid('resolved_by').references(() => users.id, { onDelete: 'set null' }),
		createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
		updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
		deletedAt: timestamp('deleted_at', { withTimezone: true }),
		version: integer('version').notNull().default(1)
	},
	(t) => [
		unique('uq_doc_comments_ws_id').on(t.workspaceId, t.id),
		foreignKey({
			columns: [t.workspaceId, t.pageId],
			foreignColumns: [docPages.workspaceId, docPages.id],
			name: 'fk_doc_comments_page'
		}).onDelete('cascade')
	]
)

// Pure join table for user favorites (exempt from updated_at/version per §4.2).
export const docFavorites = pgTable(
	'doc_favorites',
	{
		workspaceId: uuid('workspace_id')
			.notNull()
			.references(() => workspaces.id, { onDelete: 'cascade' }),
		userId: uuid('user_id')
			.notNull()
			.references(() => users.id, { onDelete: 'cascade' }),
		pageId: uuid('page_id').notNull(),
		createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow()
	},
	(t) => [
		primaryKey({ columns: [t.workspaceId, t.userId, t.pageId] }),
		foreignKey({
			columns: [t.workspaceId, t.pageId],
			foreignColumns: [docPages.workspaceId, docPages.id],
			name: 'fk_doc_favorites_page'
		}).onDelete('cascade')
	]
)
