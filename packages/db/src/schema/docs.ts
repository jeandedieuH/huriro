// Docs tables — owned by the `docs` module (§5.4, §8.4, §10, M9 §4.2–§4.5).
import { sql } from 'drizzle-orm'
import {
	bigint,
	boolean,
	check,
	customType,
	foreignKey,
	integer,
	jsonb,
	numeric,
	pgTable,
	primaryKey,
	text,
	timestamp,
	unique,
	uuid
} from 'drizzle-orm/pg-core'
import { files } from './files'
import { users } from './identity'
import { workspaces } from './tenancy'

const bytea = customType<{ data: Buffer; driverData: Buffer }>({
	dataType() {
		return 'bytea'
	}
})

export const teamspaces = pgTable(
	'teamspaces',
	{
		id: uuid('id').primaryKey().default(sql`uuidv7()`),
		workspaceId: uuid('workspace_id')
			.notNull()
			.references(() => workspaces.id, { onDelete: 'cascade' }),
		name: text('name').notNull(),
		slug: text('slug').notNull(),
		icon: text('icon'),
		description: text('description').notNull().default(''),
		visibility: text('visibility', { enum: ['open', 'closed', 'private'] })
			.notNull()
			.default('open'),
		defaultAcl: jsonb('default_acl').notNull().default([]),
		position: text('position').notNull(),
		archivedAt: timestamp('archived_at', { withTimezone: true }),
		createdBy: uuid('created_by').references(() => users.id, { onDelete: 'set null' }),
		createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
		updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
		version: integer('version').notNull().default(1)
	},
	(t) => [
		unique('uq_teamspaces_ws_id').on(t.workspaceId, t.id),
		unique('uq_teamspaces_ws_slug').on(t.workspaceId, t.slug)
	]
)

export const teamspaceMembers = pgTable(
	'teamspace_members',
	{
		workspaceId: uuid('workspace_id')
			.notNull()
			.references(() => workspaces.id, { onDelete: 'cascade' }),
		teamspaceId: uuid('teamspace_id').notNull(),
		userId: uuid('user_id')
			.notNull()
			.references(() => users.id, { onDelete: 'cascade' }),
		role: text('role', { enum: ['owner', 'member', 'viewer'] })
			.notNull()
			.default('member'),
		createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow()
	},
	(t) => [
		primaryKey({ columns: [t.workspaceId, t.teamspaceId, t.userId] }),
		foreignKey({
			columns: [t.workspaceId, t.teamspaceId],
			foreignColumns: [teamspaces.workspaceId, teamspaces.id],
			name: 'fk_teamspace_members_teamspace'
		}).onDelete('cascade')
	]
)

export const docPages = pgTable(
	'doc_pages',
	{
		id: uuid('id').primaryKey().default(sql`uuidv7()`),
		workspaceId: uuid('workspace_id')
			.notNull()
			.references(() => workspaces.id, { onDelete: 'cascade' }),
		parentId: uuid('parent_id'),
		teamspaceId: uuid('teamspace_id'),
		path: text('path').notNull(),
		depth: integer('depth').notNull().default(0),
		slug: text('slug').notNull(),
		title: text('title').notNull(),
		icon: text('icon'),
		coverFileId: uuid('cover_file_id'),
		coverGradient: text('cover_gradient'),
		coverPositionY: integer('cover_position_y').notNull().default(50),
		fontStyle: text('font_style', { enum: ['sans', 'serif', 'mono'] })
			.notNull()
			.default('sans'),
		fullWidth: boolean('full_width').notNull().default(false),
		smallText: boolean('small_text').notNull().default(false),
		isDatabaseRow: boolean('is_database_row').notNull().default(false),
		isLocked: boolean('is_locked').notNull().default(false),
		lockedBy: uuid('locked_by').references(() => users.id, { onDelete: 'set null' }),
		lockedAt: timestamp('locked_at', { withTimezone: true }),
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
		unique('uq_doc_pages_ws_slug').on(t.workspaceId, t.slug),
		foreignKey({
			columns: [t.workspaceId, t.teamspaceId],
			foreignColumns: [teamspaces.workspaceId, teamspaces.id],
			name: 'fk_doc_pages_teamspace'
		}).onDelete('set null'),
		foreignKey({
			columns: [t.workspaceId, t.coverFileId],
			foreignColumns: [files.workspaceId, files.id],
			name: 'fk_doc_pages_cover_file'
		}).onDelete('set null')
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
		roomKind: text('room_kind', { enum: ['doc_page', 'synced_block'] })
			.notNull()
			.default('doc_page'),
		pageId: uuid('page_id'),
		syncedBlockId: uuid('synced_block_id'),
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
		}).onDelete('cascade'),
		foreignKey({
			columns: [t.workspaceId, t.syncedBlockId],
			foreignColumns: [docSyncedBlocks.workspaceId, docSyncedBlocks.id],
			name: 'fk_collab_tickets_synced_block'
		}).onDelete('cascade'),
		check(
			'ck_collab_tickets_room_target',
			sql`(room_kind = 'doc_page' AND page_id IS NOT NULL AND synced_block_id IS NULL) OR (room_kind = 'synced_block' AND synced_block_id IS NOT NULL AND page_id IS NULL)`
		)
	]
)

export const docSyncedBlocks = pgTable(
	'doc_synced_blocks',
	{
		id: uuid('id').primaryKey().default(sql`uuidv7()`),
		workspaceId: uuid('workspace_id')
			.notNull()
			.references(() => workspaces.id, { onDelete: 'cascade' }),
		title: text('title').notNull().default('Synced block'),
		sourcePageId: uuid('source_page_id'),
		state: bytea('state').notNull(),
		stateVector: bytea('state_vector').notNull(),
		byteSize: integer('byte_size').notNull(),
		leaseNodeId: text('lease_node_id'),
		leaseEpoch: bigint('lease_epoch', { mode: 'number' }).notNull().default(0),
		leaseExpiresAt: timestamp('lease_expires_at', { withTimezone: true }),
		plainText: text('plain_text').notNull().default(''),
		createdBy: uuid('created_by').references(() => users.id, { onDelete: 'set null' }),
		archivedAt: timestamp('archived_at', { withTimezone: true }),
		createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
		updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
		version: integer('version').notNull().default(1)
	},
	(t) => [
		unique('uq_doc_synced_blocks_ws_id').on(t.workspaceId, t.id),
		foreignKey({
			columns: [t.workspaceId, t.sourcePageId],
			foreignColumns: [docPages.workspaceId, docPages.id],
			name: 'fk_doc_synced_blocks_source_page'
		}).onDelete('set null')
	]
)

export const docSuggestions = pgTable(
	'doc_suggestions',
	{
		id: uuid('id').primaryKey().default(sql`uuidv7()`),
		workspaceId: uuid('workspace_id')
			.notNull()
			.references(() => workspaces.id, { onDelete: 'cascade' }),
		pageId: uuid('page_id').notNull(),
		groupId: text('group_id').notNull(),
		kind: text('kind', { enum: ['insert', 'delete', 'replace'] }).notNull(),
		authorType: text('author_type', { enum: ['user', 'agent'] })
			.notNull()
			.default('user'),
		authorId: uuid('author_id').notNull(),
		anchorBlockId: text('anchor_block_id'),
		beforeText: text('before_text').notNull().default(''),
		afterText: text('after_text').notNull().default(''),
		status: text('status', { enum: ['open', 'accepted', 'rejected'] })
			.notNull()
			.default('open'),
		resolvedBy: uuid('resolved_by').references(() => users.id, { onDelete: 'set null' }),
		resolvedAt: timestamp('resolved_at', { withTimezone: true }),
		createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
		updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
		version: integer('version').notNull().default(1)
	},
	(t) => [
		unique('uq_doc_suggestions_ws_id').on(t.workspaceId, t.id),
		unique('uq_doc_suggestions_page_group').on(t.workspaceId, t.pageId, t.groupId),
		foreignKey({
			columns: [t.workspaceId, t.pageId],
			foreignColumns: [docPages.workspaceId, docPages.id],
			name: 'fk_doc_suggestions_page'
		}).onDelete('cascade')
	]
)

export const docVerifications = pgTable(
	'doc_verifications',
	{
		id: uuid('id').primaryKey().default(sql`uuidv7()`),
		workspaceId: uuid('workspace_id')
			.notNull()
			.references(() => workspaces.id, { onDelete: 'cascade' }),
		pageId: uuid('page_id').notNull(),
		status: text('status', { enum: ['verified', 'stale', 'unverified'] })
			.notNull()
			.default('verified'),
		verifiedBy: uuid('verified_by').references(() => users.id, { onDelete: 'set null' }),
		verifiedAt: timestamp('verified_at', { withTimezone: true }),
		expiresAt: timestamp('expires_at', { withTimezone: true }),
		expiryNotifiedAt: timestamp('expiry_notified_at', { withTimezone: true }),
		note: text('note').notNull().default(''),
		createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
		updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
		version: integer('version').notNull().default(1)
	},
	(t) => [
		unique('uq_doc_verifications_ws_id').on(t.workspaceId, t.id),
		unique('uq_doc_verifications_page').on(t.workspaceId, t.pageId),
		foreignKey({
			columns: [t.workspaceId, t.pageId],
			foreignColumns: [docPages.workspaceId, docPages.id],
			name: 'fk_doc_verifications_page'
		}).onDelete('cascade')
	]
)

export const docPublicShares = pgTable(
	'doc_public_shares',
	{
		id: uuid('id').primaryKey().default(sql`uuidv7()`),
		workspaceId: uuid('workspace_id')
			.notNull()
			.references(() => workspaces.id, { onDelete: 'cascade' }),
		pageId: uuid('page_id').notNull(),
		publicSlug: text('public_slug').notNull(),
		includeChildren: boolean('include_children').notNull().default(false),
		allowSearchIndexing: boolean('allow_search_indexing').notNull().default(false),
		passwordHash: text('password_hash'),
		expiresAt: timestamp('expires_at', { withTimezone: true }),
		revokedAt: timestamp('revoked_at', { withTimezone: true }),
		createdBy: uuid('created_by').references(() => users.id, { onDelete: 'set null' }),
		createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
		updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
		version: integer('version').notNull().default(1)
	},
	(t) => [
		unique('uq_doc_public_shares_ws_id').on(t.workspaceId, t.id),
		unique('uq_doc_public_shares_page').on(t.workspaceId, t.pageId),
		unique('uq_doc_public_shares_slug').on(t.workspaceId, t.publicSlug),
		foreignKey({
			columns: [t.workspaceId, t.pageId],
			foreignColumns: [docPages.workspaceId, docPages.id],
			name: 'fk_doc_public_shares_page'
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

// M10 structured databases (§4.1, ADR-0026): relational storage, never CRDT blobs.
export const docDatabases = pgTable(
	'doc_databases',
	{
		id: uuid('id').primaryKey().default(sql`uuidv7()`),
		workspaceId: uuid('workspace_id')
			.notNull()
			.references(() => workspaces.id, { onDelete: 'cascade' }),
		teamspaceId: uuid('teamspace_id'),
		parentPageId: uuid('parent_page_id'),
		title: text('title').notNull(),
		icon: text('icon'),
		isInline: boolean('is_inline').notNull().default(false),
		createdBy: uuid('created_by')
			.notNull()
			.references(() => users.id),
		createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
		updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
		version: integer('version').notNull().default(1)
	},
	(t) => [
		unique('uq_doc_databases_ws_id').on(t.workspaceId, t.id),
		foreignKey({
			columns: [t.workspaceId, t.teamspaceId],
			foreignColumns: [teamspaces.workspaceId, teamspaces.id],
			name: 'fk_doc_databases_teamspace'
		}).onDelete('set null'),
		foreignKey({
			columns: [t.workspaceId, t.parentPageId],
			foreignColumns: [docPages.workspaceId, docPages.id],
			name: 'fk_doc_databases_parent_page'
		}).onDelete('cascade')
	]
)

export const docDatabaseProperties = pgTable(
	'doc_database_properties',
	{
		id: uuid('id').primaryKey().default(sql`uuidv7()`),
		workspaceId: uuid('workspace_id')
			.notNull()
			.references(() => workspaces.id, { onDelete: 'cascade' }),
		databaseId: uuid('database_id').notNull(),
		name: text('name').notNull(),
		propType: text('prop_type', {
			enum: [
				'title',
				'text',
				'number',
				'select',
				'multi_select',
				'status',
				'date',
				'person',
				'checkbox',
				'url',
				'email',
				'phone',
				'file',
				'relation',
				'rollup',
				'formula',
				'created_time',
				'created_by',
				'updated_time',
				'updated_by'
			]
		}).notNull(),
		config: jsonb('config').notNull().default({}),
		position: text('position').notNull(),
		createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
		updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
		version: integer('version').notNull().default(1)
	},
	(t) => [
		unique('uq_doc_database_properties_ws_id').on(t.workspaceId, t.id),
		foreignKey({
			columns: [t.workspaceId, t.databaseId],
			foreignColumns: [docDatabases.workspaceId, docDatabases.id],
			name: 'fk_doc_database_properties_database'
		}).onDelete('cascade')
	]
)

export const docDatabaseRows = pgTable(
	'doc_database_rows',
	{
		id: uuid('id').primaryKey().default(sql`uuidv7()`),
		workspaceId: uuid('workspace_id')
			.notNull()
			.references(() => workspaces.id, { onDelete: 'cascade' }),
		databaseId: uuid('database_id').notNull(),
		pageId: uuid('page_id'),
		title: text('title').notNull().default(''),
		position: text('position').notNull(),
		createdBy: uuid('created_by')
			.notNull()
			.references(() => users.id),
		updatedBy: uuid('updated_by').references(() => users.id, { onDelete: 'set null' }),
		archivedAt: timestamp('archived_at', { withTimezone: true }),
		createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
		updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
		version: integer('version').notNull().default(1)
	},
	(t) => [
		unique('uq_doc_database_rows_ws_id').on(t.workspaceId, t.id),
		foreignKey({
			columns: [t.workspaceId, t.databaseId],
			foreignColumns: [docDatabases.workspaceId, docDatabases.id],
			name: 'fk_doc_database_rows_database'
		}).onDelete('cascade'),
		foreignKey({
			columns: [t.workspaceId, t.pageId],
			foreignColumns: [docPages.workspaceId, docPages.id],
			name: 'fk_doc_database_rows_page'
		}).onDelete('set null')
	]
)

export const docDatabaseCellValues = pgTable(
	'doc_database_cell_values',
	{
		workspaceId: uuid('workspace_id')
			.notNull()
			.references(() => workspaces.id, { onDelete: 'cascade' }),
		databaseId: uuid('database_id').notNull(),
		rowId: uuid('row_id').notNull(),
		propertyId: uuid('property_id').notNull(),
		valText: text('val_text'),
		valNumber: numeric('val_number'),
		valBool: boolean('val_bool'),
		valDateStart: timestamp('val_date_start', { withTimezone: true }),
		valDateEnd: timestamp('val_date_end', { withTimezone: true }),
		valJson: jsonb('val_json'),
		updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow()
	},
	(t) => [
		primaryKey({ columns: [t.workspaceId, t.rowId, t.propertyId] }),
		foreignKey({
			columns: [t.workspaceId, t.databaseId],
			foreignColumns: [docDatabases.workspaceId, docDatabases.id],
			name: 'fk_doc_database_cells_database'
		}).onDelete('cascade'),
		foreignKey({
			columns: [t.workspaceId, t.rowId],
			foreignColumns: [docDatabaseRows.workspaceId, docDatabaseRows.id],
			name: 'fk_doc_database_cells_row'
		}).onDelete('cascade'),
		foreignKey({
			columns: [t.workspaceId, t.propertyId],
			foreignColumns: [docDatabaseProperties.workspaceId, docDatabaseProperties.id],
			name: 'fk_doc_database_cells_property'
		}).onDelete('cascade')
	]
)

export const docDatabaseViews = pgTable(
	'doc_database_views',
	{
		id: uuid('id').primaryKey().default(sql`uuidv7()`),
		workspaceId: uuid('workspace_id')
			.notNull()
			.references(() => workspaces.id, { onDelete: 'cascade' }),
		databaseId: uuid('database_id').notNull(),
		name: text('name').notNull(),
		viewType: text('view_type', {
			enum: ['table', 'board', 'gallery', 'calendar', 'timeline', 'list']
		}).notNull(),
		config: jsonb('config').notNull().default({}),
		position: text('position').notNull(),
		createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
		updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
		version: integer('version').notNull().default(1)
	},
	(t) => [
		unique('uq_doc_database_views_ws_id').on(t.workspaceId, t.id),
		foreignKey({
			columns: [t.workspaceId, t.databaseId],
			foreignColumns: [docDatabases.workspaceId, docDatabases.id],
			name: 'fk_doc_database_views_database'
		}).onDelete('cascade')
	]
)
