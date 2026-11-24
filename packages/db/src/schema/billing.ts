// Cloud billing tables — owned by the `billing` module (HURIRO_MODE=cloud, §2.5, §23 M6).
import { sql } from 'drizzle-orm'
import {
	bigint,
	boolean,
	date,
	integer,
	jsonb,
	pgTable,
	text,
	timestamp,
	unique,
	uuid
} from 'drizzle-orm/pg-core'
import { workspaces } from './tenancy'

export const billingSubscriptions = pgTable(
	'billing_subscriptions',
	{
		id: uuid('id').primaryKey().default(sql`uuidv7()`),
		workspaceId: uuid('workspace_id')
			.notNull()
			.references(() => workspaces.id, { onDelete: 'cascade' }),
		plan: text('plan', { enum: ['free', 'pro', 'enterprise'] })
			.notNull()
			.default('free'),
		status: text('status', { enum: ['active', 'trialing', 'past_due', 'canceled', 'incomplete'] })
			.notNull()
			.default('active'),
		provider: text('provider', { enum: ['polar', 'irembopay', 'manual'] })
			.notNull()
			.default('polar'),
		providerCustomerId: text('provider_customer_id'),
		providerSubscriptionId: text('provider_subscription_id'),
		billingEmail: text('billing_email'),
		billingPhone: text('billing_phone'),
		currency: text('currency', { enum: ['USD', 'RWF'] })
			.notNull()
			.default('USD'),
		amountCharged: integer('amount_charged').notNull().default(0),
		paymentMethod: text('payment_method', {
			enum: ['card', 'mtn_momo', 'airtel_money', 'irembopay_hosted']
		}),
		seatLimit: integer('seat_limit').notNull().default(5),
		storageLimitBytes: bigint('storage_limit_bytes', { mode: 'number' }).notNull().default(1_073_741_824),
		currentPeriodStart: timestamp('current_period_start', { withTimezone: true }),
		currentPeriodEnd: timestamp('current_period_end', { withTimezone: true }),
		cancelAtPeriodEnd: boolean('cancel_at_period_end').notNull().default(false),
		metadata: jsonb('metadata').notNull().default({}),
		createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
		updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
		version: integer('version').notNull().default(1)
	},
	(t) => [
		unique('uq_billing_subscriptions_ws_id').on(t.workspaceId, t.id),
		unique('uq_billing_subscriptions_ws').on(t.workspaceId)
	]
)

export const billingUsageSnapshots = pgTable(
	'billing_usage_snapshots',
	{
		id: uuid('id').primaryKey().default(sql`uuidv7()`),
		workspaceId: uuid('workspace_id')
			.notNull()
			.references(() => workspaces.id, { onDelete: 'cascade' }),
		periodDate: date('period_date').notNull(),
		activeSeats: integer('active_seats').notNull().default(0),
		storageBytes: bigint('storage_bytes', { mode: 'number' }).notNull().default(0),
		aiTokensUsed: bigint('ai_tokens_used', { mode: 'number' }).notNull().default(0),
		createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow()
	},
	(t) => [
		unique('uq_billing_usage_snapshots_ws_id').on(t.workspaceId, t.id),
		unique('uq_billing_usage_snapshots_ws_date').on(t.workspaceId, t.periodDate)
	]
)

// System table: Polar / IremboPay webhook deliveries arrive pre-tenant before routing.
export const billingWebhookEvents = pgTable('billing_webhook_events', {
	providerEventId: text('provider_event_id').primaryKey(),
	provider: text('provider', { enum: ['polar', 'irembopay'] })
		.notNull()
		.default('polar'),
	eventType: text('event_type').notNull(),
	workspaceId: uuid('workspace_id').references(() => workspaces.id, { onDelete: 'set null' }),
	payload: jsonb('payload').notNull(),
	receivedAt: timestamp('received_at', { withTimezone: true }).notNull().defaultNow(),
	processedAt: timestamp('processed_at', { withTimezone: true }),
	lastError: text('last_error')
})
