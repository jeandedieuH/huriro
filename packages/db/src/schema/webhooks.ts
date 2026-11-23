// Outbound webhook tables — owned by the `webhooks` module (§5.4, §16.5).
import { sql } from 'drizzle-orm'
import {
	boolean,
	foreignKey,
	integer,
	jsonb,
	pgTable,
	text,
	timestamp,
	unique,
	uuid
} from 'drizzle-orm/pg-core'
import { users } from './identity'
import { workspaces } from './tenancy'

export const webhookEndpoints = pgTable(
	'webhook_endpoints',
	{
		id: uuid('id').primaryKey().default(sql`uuidv7()`),
		workspaceId: uuid('workspace_id')
			.notNull()
			.references(() => workspaces.id, { onDelete: 'cascade' }),
		name: text('name').notNull(),
		url: text('url').notNull(),
		secretEncrypted: text('secret_encrypted').notNull(),
		secretPrefix: text('secret_prefix').notNull(),
		events: text('events').array().notNull().default([]),
		enabled: boolean('enabled').notNull().default(true),
		createdBy: uuid('created_by').references(() => users.id, { onDelete: 'set null' }),
		createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
		updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
		version: integer('version').notNull().default(1)
	},
	(t) => [unique('uq_webhook_endpoints_ws_id').on(t.workspaceId, t.id)]
)

export const webhookDeliveries = pgTable(
	'webhook_deliveries',
	{
		id: uuid('id').primaryKey().default(sql`uuidv7()`),
		workspaceId: uuid('workspace_id')
			.notNull()
			.references(() => workspaces.id, { onDelete: 'cascade' }),
		endpointId: uuid('endpoint_id').notNull(),
		eventId: uuid('event_id'),
		eventType: text('event_type').notNull(),
		payload: jsonb('payload').notNull(),
		status: text('status', { enum: ['pending', 'delivered', 'retrying', 'failed'] })
			.notNull()
			.default('pending'),
		attempts: integer('attempts').notNull().default(0),
		maxAttempts: integer('max_attempts').notNull().default(8),
		nextAttemptAt: timestamp('next_attempt_at', { withTimezone: true }).notNull().defaultNow(),
		lastStatusCode: integer('last_status_code'),
		lastResponseBody: text('last_response_body'),
		lastError: text('last_error'),
		deliveredAt: timestamp('delivered_at', { withTimezone: true }),
		createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
		updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow()
	},
	(t) => [
		unique('uq_webhook_deliveries_ws_id').on(t.workspaceId, t.id),
		foreignKey({
			columns: [t.workspaceId, t.endpointId],
			foreignColumns: [webhookEndpoints.workspaceId, webhookEndpoints.id],
			name: 'fk_webhook_deliveries_endpoint'
		}).onDelete('cascade')
	]
)
