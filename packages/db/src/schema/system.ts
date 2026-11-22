// System & infrastructure tables (§8.5–8.7, ADR-0013).
// Classification: tenant RLS = workspace_seq, change_log, sync_cursors,
// idempotency_keys, files. Instance/system = outbox, processed_events,
// audit_log (scoped select), feature_flags(+overrides), instance_settings —
// see migrations/0004_security.sql.
import { sql } from 'drizzle-orm'
import {
	bigint,
	boolean,
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

export const workspaceSeq = pgTable('workspace_seq', {
	workspaceId: uuid('workspace_id')
		.primaryKey()
		.references(() => workspaces.id, { onDelete: 'cascade' }),
	lastCursor: bigint('last_cursor', { mode: 'bigint' }).notNull().default(0n)
})

export const changeLog = pgTable(
	'change_log',
	{
		workspaceId: uuid('workspace_id')
			.notNull()
			.references(() => workspaces.id, { onDelete: 'cascade' }),
		cursor: bigint('cursor', { mode: 'bigint' }).notNull(),
		entityType: text('entity_type').notNull(),
		entityId: uuid('entity_id').notNull(),
		action: text('action', { enum: ['upsert', 'delete', 'reorder', 'revoke'] }).notNull(),
		scope: text('scope').array().notNull().default([]),
		payload: jsonb('payload'),
		actorId: uuid('actor_id'),
		changedAt: timestamp('changed_at', { withTimezone: true }).notNull().defaultNow()
	},
	(t) => [primaryKey({ columns: [t.workspaceId, t.cursor] })]
)

export const syncCursors = pgTable(
	'sync_cursors',
	{
		workspaceId: uuid('workspace_id')
			.notNull()
			.references(() => workspaces.id, { onDelete: 'cascade' }),
		clientId: text('client_id').notNull(),
		cursor: bigint('cursor', { mode: 'bigint' }).notNull().default(0n),
		updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow()
	},
	(t) => [primaryKey({ columns: [t.workspaceId, t.clientId] })]
)

export const outbox = pgTable('outbox', {
	id: uuid('id').primaryKey().default(sql`uuidv7()`),
	workspaceId: uuid('workspace_id'),
	aggregate: text('aggregate').notNull(),
	aggregateId: uuid('aggregate_id'),
	eventType: text('event_type').notNull(),
	payload: jsonb('payload').notNull(),
	createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
	publishedAt: timestamp('published_at', { withTimezone: true }),
	attempts: integer('attempts').notNull().default(0),
	lastError: text('last_error')
})

export const processedEvents = pgTable(
	'processed_events',
	{
		consumer: text('consumer').notNull(),
		eventId: uuid('event_id').notNull(),
		processedAt: timestamp('processed_at', { withTimezone: true }).notNull().defaultNow()
	},
	(t) => [primaryKey({ columns: [t.consumer, t.eventId] })]
)

export const auditLog = pgTable('audit_log', {
	id: uuid('id').primaryKey().default(sql`uuidv7()`),
	workspaceId: uuid('workspace_id'),
	actorType: text('actor_type', { enum: ['user', 'api_key', 'agent', 'system'] }).notNull(),
	actorId: uuid('actor_id'),
	action: text('action').notNull(),
	targetType: text('target_type'),
	targetId: uuid('target_id'),
	ipHash: text('ip_hash'),
	userAgent: text('user_agent'),
	metadata: jsonb('metadata').notNull().default({}),
	createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow()
})

export const idempotencyKeys = pgTable(
	'idempotency_keys',
	{
		workspaceId: uuid('workspace_id').notNull(),
		key: text('key').notNull(),
		endpoint: text('endpoint').notNull(),
		requestHash: text('request_hash').notNull(),
		responseCode: integer('response_code'),
		responseBody: jsonb('response_body'),
		status: text('status', { enum: ['in_flight', 'completed', 'failed'] })
			.notNull()
			.default('in_flight'),
		createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
		expiresAt: timestamp('expires_at', { withTimezone: true }).notNull()
	},
	(t) => [primaryKey({ columns: [t.workspaceId, t.key] })]
)

export const files = pgTable(
	'files',
	{
		id: uuid('id').primaryKey().default(sql`uuidv7()`),
		workspaceId: uuid('workspace_id')
			.notNull()
			.references(() => workspaces.id, { onDelete: 'cascade' }),
		uploadedBy: uuid('uploaded_by').references(() => users.id, { onDelete: 'set null' }),
		storageKey: text('storage_key').notNull(),
		filename: text('filename').notNull(),
		contentType: text('content_type').notNull(),
		byteSize: bigint('byte_size', { mode: 'bigint' }).notNull(),
		checksum: text('checksum').notNull(),
		scanStatus: text('scan_status', {
			enum: ['pending', 'clean', 'infected', 'failed', 'unscanned']
		})
			.notNull()
			.default('pending'),
		isPublic: boolean('is_public').notNull().default(false),
		createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow()
	},
	(t) => [unique('uq_files_ws_id').on(t.workspaceId, t.id), unique('uq_files_storage_key').on(t.storageKey)]
)

export const featureFlags = pgTable('feature_flags', {
	key: text('key').primaryKey(),
	description: text('description').notNull().default(''),
	enabled: boolean('enabled').notNull().default(false),
	rollout: integer('rollout').notNull().default(0),
	createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
	updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow()
})

export const featureFlagOverrides = pgTable(
	'feature_flag_overrides',
	{
		flagKey: text('flag_key')
			.notNull()
			.references(() => featureFlags.key, { onDelete: 'cascade' }),
		scopeType: text('scope_type', { enum: ['workspace', 'user'] }).notNull(),
		scopeId: uuid('scope_id').notNull(),
		enabled: boolean('enabled').notNull(),
		createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow()
	},
	(t) => [primaryKey({ columns: [t.flagKey, t.scopeType, t.scopeId] })]
)

export const instanceSettings = pgTable('instance_settings', {
	key: text('key').primaryKey(),
	value: jsonb('value').notNull(),
	updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow()
})
