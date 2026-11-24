import type {
	BillingCheckoutProvider,
	BillingCurrency,
	BillingPaymentMethod,
	BillingPlan,
	BillingStatus,
	BillingSubscriptionDto,
	BillingUsageDto
} from '@huriro/contracts'
import type { Queryable } from '@huriro/db'

export async function getBillingSubscriptionRow(
	tx: Queryable,
	workspaceId: string
): Promise<BillingSubscriptionDto | null> {
	const [row] = await tx<BillingSubscriptionDto[]>`
		SELECT
			id,
			workspace_id AS "workspaceId",
			plan,
			status,
			provider,
			provider_customer_id AS "providerCustomerId",
			provider_subscription_id AS "providerSubscriptionId",
			billing_email AS "billingEmail",
			billing_phone AS "billingPhone",
			currency,
			amount_charged::int AS "amountCharged",
			payment_method AS "paymentMethod",
			seat_limit AS "seatLimit",
			storage_limit_bytes::double precision AS "storageLimitBytes",
			current_period_start::text AS "currentPeriodStart",
			current_period_end::text AS "currentPeriodEnd",
			cancel_at_period_end AS "cancelAtPeriodEnd",
			created_at::text AS "createdAt",
			updated_at::text AS "updatedAt",
			version
		FROM billing_subscriptions
		WHERE workspace_id = ${workspaceId}
	`
	return row ?? null
}

export async function ensureBillingSubscriptionRow(
	tx: Queryable,
	workspaceId: string,
	billingEmail?: string | null
): Promise<BillingSubscriptionDto> {
	const existing = await getBillingSubscriptionRow(tx, workspaceId)
	if (existing) return existing

	const [row] = await tx<BillingSubscriptionDto[]>`
		INSERT INTO billing_subscriptions (workspace_id, plan, status, provider, currency, billing_email)
		VALUES (${workspaceId}, 'free', 'active', 'polar', 'USD', ${billingEmail ?? null})
		ON CONFLICT (workspace_id) DO UPDATE
		SET workspace_id = EXCLUDED.workspace_id
		RETURNING
			id,
			workspace_id AS "workspaceId",
			plan,
			status,
			provider,
			provider_customer_id AS "providerCustomerId",
			provider_subscription_id AS "providerSubscriptionId",
			billing_email AS "billingEmail",
			billing_phone AS "billingPhone",
			currency,
			amount_charged::int AS "amountCharged",
			payment_method AS "paymentMethod",
			seat_limit AS "seatLimit",
			storage_limit_bytes::double precision AS "storageLimitBytes",
			current_period_start::text AS "currentPeriodStart",
			current_period_end::text AS "currentPeriodEnd",
			cancel_at_period_end AS "cancelAtPeriodEnd",
			created_at::text AS "createdAt",
			updated_at::text AS "updatedAt",
			version
	`
	if (!row) throw new Error('Failed to initialize billing subscription')
	return row
}

export async function recordPendingCheckoutInvoice(
	tx: Queryable,
	args: {
		readonly workspaceId: string
		readonly provider: BillingCheckoutProvider
		readonly subscriptionOrInvoiceId: string
		readonly billingEmail: string | null
		readonly billingPhone: string | null
		readonly currency: BillingCurrency
		readonly amountCharged: number
		readonly paymentMethod: BillingPaymentMethod
	}
): Promise<BillingSubscriptionDto> {
	const [row] = await tx<BillingSubscriptionDto[]>`
		INSERT INTO billing_subscriptions (
			workspace_id, plan, status, provider, provider_subscription_id,
			billing_email, billing_phone, currency, amount_charged, payment_method
		)
		VALUES (
			${args.workspaceId},
			'free',
			'incomplete',
			${args.provider},
			${args.subscriptionOrInvoiceId},
			${args.billingEmail},
			${args.billingPhone},
			${args.currency},
			${args.amountCharged},
			${args.paymentMethod}
		)
		ON CONFLICT (workspace_id) DO UPDATE
		SET
			provider = EXCLUDED.provider,
			provider_subscription_id = EXCLUDED.provider_subscription_id,
			billing_email = COALESCE(EXCLUDED.billing_email, billing_subscriptions.billing_email),
			billing_phone = COALESCE(EXCLUDED.billing_phone, billing_subscriptions.billing_phone),
			currency = EXCLUDED.currency,
			amount_charged = EXCLUDED.amount_charged,
			payment_method = EXCLUDED.payment_method,
			version = billing_subscriptions.version + 1
		RETURNING
			id,
			workspace_id AS "workspaceId",
			plan,
			status,
			provider,
			provider_customer_id AS "providerCustomerId",
			provider_subscription_id AS "providerSubscriptionId",
			billing_email AS "billingEmail",
			billing_phone AS "billingPhone",
			currency,
			amount_charged::int AS "amountCharged",
			payment_method AS "paymentMethod",
			seat_limit AS "seatLimit",
			storage_limit_bytes::double precision AS "storageLimitBytes",
			current_period_start::text AS "currentPeriodStart",
			current_period_end::text AS "currentPeriodEnd",
			cancel_at_period_end AS "cancelAtPeriodEnd",
			created_at::text AS "createdAt",
			updated_at::text AS "updatedAt",
			version
	`
	if (!row) throw new Error('Failed to record pending checkout')
	return row
}

export async function upsertBillingSubscriptionFromWebhook(
	tx: Queryable,
	args: {
		readonly workspaceId: string
		readonly provider: BillingCheckoutProvider
		readonly plan: BillingPlan
		readonly status: BillingStatus
		readonly providerCustomerId: string | null
		readonly providerSubscriptionId: string | null
		readonly billingEmail: string | null
		readonly billingPhone: string | null
		readonly currency: BillingCurrency
		readonly amountCharged: number
		readonly paymentMethod: BillingPaymentMethod | null
		readonly seatLimit: number
		readonly storageLimitBytes: number
		readonly currentPeriodStart: string | null
		readonly currentPeriodEnd: string | null
		readonly cancelAtPeriodEnd: boolean
	}
): Promise<BillingSubscriptionDto> {
	const [row] = await tx<BillingSubscriptionDto[]>`
		INSERT INTO billing_subscriptions (
			workspace_id, plan, status, provider, provider_customer_id, provider_subscription_id,
			billing_email, billing_phone, currency, amount_charged, payment_method,
			seat_limit, storage_limit_bytes, current_period_start, current_period_end,
			cancel_at_period_end
		)
		VALUES (
			${args.workspaceId},
			${args.plan},
			${args.status},
			${args.provider},
			${args.providerCustomerId},
			${args.providerSubscriptionId},
			${args.billingEmail},
			${args.billingPhone},
			${args.currency},
			${args.amountCharged},
			${args.paymentMethod},
			${args.seatLimit},
			${args.storageLimitBytes},
			${args.currentPeriodStart}::timestamptz,
			${args.currentPeriodEnd}::timestamptz,
			${args.cancelAtPeriodEnd}
		)
		ON CONFLICT (workspace_id) DO UPDATE
		SET
			plan = EXCLUDED.plan,
			status = EXCLUDED.status,
			provider = EXCLUDED.provider,
			provider_customer_id = COALESCE(EXCLUDED.provider_customer_id, billing_subscriptions.provider_customer_id),
			provider_subscription_id = COALESCE(EXCLUDED.provider_subscription_id, billing_subscriptions.provider_subscription_id),
			billing_email = COALESCE(EXCLUDED.billing_email, billing_subscriptions.billing_email),
			billing_phone = COALESCE(EXCLUDED.billing_phone, billing_subscriptions.billing_phone),
			currency = EXCLUDED.currency,
			amount_charged = EXCLUDED.amount_charged,
			payment_method = COALESCE(EXCLUDED.payment_method, billing_subscriptions.payment_method),
			seat_limit = EXCLUDED.seat_limit,
			storage_limit_bytes = EXCLUDED.storage_limit_bytes,
			current_period_start = COALESCE(EXCLUDED.current_period_start, billing_subscriptions.current_period_start),
			current_period_end = COALESCE(EXCLUDED.current_period_end, billing_subscriptions.current_period_end),
			cancel_at_period_end = EXCLUDED.cancel_at_period_end,
			version = billing_subscriptions.version + 1
		RETURNING
			id,
			workspace_id AS "workspaceId",
			plan,
			status,
			provider,
			provider_customer_id AS "providerCustomerId",
			provider_subscription_id AS "providerSubscriptionId",
			billing_email AS "billingEmail",
			billing_phone AS "billingPhone",
			currency,
			amount_charged::int AS "amountCharged",
			payment_method AS "paymentMethod",
			seat_limit AS "seatLimit",
			storage_limit_bytes::double precision AS "storageLimitBytes",
			current_period_start::text AS "currentPeriodStart",
			current_period_end::text AS "currentPeriodEnd",
			cancel_at_period_end AS "cancelAtPeriodEnd",
			created_at::text AS "createdAt",
			updated_at::text AS "updatedAt",
			version
	`
	if (!row) throw new Error('Failed to upsert billing subscription')

	await tx`
		UPDATE workspaces
		SET plan = ${args.plan}
		WHERE id = ${args.workspaceId}
	`
	return row
}

export async function computeWorkspaceBillingUsage(
	tx: Queryable,
	workspaceId: string
): Promise<BillingUsageDto> {
	const [seatRow] = await tx<{ n: number }[]>`
		SELECT count(*)::int AS n
		FROM memberships
		WHERE workspace_id = ${workspaceId} AND status = 'active'
	`
	const [fileRow] = await tx<{ total: string | number }[]>`
		SELECT COALESCE(sum(byte_size), 0)::double precision AS total
		FROM files
		WHERE workspace_id = ${workspaceId}
	`
	const [aiRow] = await tx<{ total: string | number }[]>`
		SELECT COALESCE(sum(COALESCE(tokens_in, 0) + COALESCE(tokens_out, 0)), 0)::double precision AS total
		FROM ai_runs
		WHERE workspace_id = ${workspaceId}
	`
	return {
		activeSeats: seatRow?.n ?? 0,
		storageBytes: Number(fileRow?.total ?? 0),
		aiTokensUsed: Number(aiRow?.total ?? 0)
	}
}

export async function upsertBillingUsageSnapshotRow(
	tx: Queryable,
	workspaceId: string,
	periodDate: string,
	usage: BillingUsageDto
): Promise<void> {
	await tx`
		INSERT INTO billing_usage_snapshots (
			workspace_id, period_date, active_seats, storage_bytes, ai_tokens_used
		)
		VALUES (
			${workspaceId}, ${periodDate}::date, ${usage.activeSeats},
			${usage.storageBytes}, ${usage.aiTokensUsed}
		)
		ON CONFLICT (workspace_id, period_date) DO UPDATE
		SET
			active_seats = EXCLUDED.active_seats,
			storage_bytes = EXCLUDED.storage_bytes,
			ai_tokens_used = EXCLUDED.ai_tokens_used
	`
}

export async function recordBillingWebhookEvent(
	tx: Queryable,
	args: {
		readonly providerEventId: string
		readonly provider: BillingCheckoutProvider
		readonly eventType: string
		readonly workspaceId: string | null
		readonly payload: Record<string, unknown>
	}
): Promise<boolean> {
	const rows = await tx<{ providerEventId: string }[]>`
		INSERT INTO billing_webhook_events (provider_event_id, provider, event_type, workspace_id, payload)
		VALUES (
			${args.providerEventId},
			${args.provider},
			${args.eventType},
			${args.workspaceId},
			${tx.json(args.payload as never)}
		)
		ON CONFLICT (provider_event_id) DO NOTHING
		RETURNING provider_event_id AS "providerEventId"
	`
	return rows.length > 0
}

export async function markBillingWebhookProcessed(
	tx: Queryable,
	providerEventId: string,
	workspaceId: string | null,
	errorDetail: string | null
): Promise<void> {
	await tx`
		UPDATE billing_webhook_events
		SET
			workspace_id = COALESCE(${workspaceId}, workspace_id),
			processed_at = now(),
			last_error = ${errorDetail}
		WHERE provider_event_id = ${providerEventId}
	`
}

export async function resolveWorkspaceByProviderIds(
	tx: Queryable,
	customerId: string | null,
	subscriptionOrInvoiceId: string | null
): Promise<string | null> {
	const [row] = await tx<{ workspaceId: string | null }[]>`
		SELECT resolve_billing_workspace(${customerId}, ${subscriptionOrInvoiceId}) AS "workspaceId"
	`
	return row?.workspaceId ?? null
}

export async function insertBillingAudit(
	tx: Queryable,
	args: {
		readonly workspaceId: string
		readonly actorType: 'user' | 'system'
		readonly actorId?: string | null
		readonly action: string
		readonly targetId?: string | null
		readonly metadata?: Record<string, unknown>
	}
): Promise<void> {
	await tx`
		INSERT INTO audit_log (workspace_id, actor_type, actor_id, action, target_type, target_id, metadata)
		VALUES (
			${args.workspaceId},
			${args.actorType},
			${args.actorId ?? null},
			${args.action},
			'billing_subscription',
			${args.targetId ?? null},
			${tx.json((args.metadata ?? {}) as never)}
		)
	`
}

export async function emitBillingOutbox(
	tx: Queryable,
	args: {
		readonly workspaceId: string
		readonly aggregateId: string
		readonly eventType: string
		readonly payload: Record<string, unknown>
	}
): Promise<void> {
	await tx`
		INSERT INTO outbox (workspace_id, aggregate, aggregate_id, event_type, payload)
		VALUES (
			${args.workspaceId},
			'billing',
			${args.aggregateId},
			${args.eventType},
			${tx.json(args.payload as never)}
		)
	`
}
