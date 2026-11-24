import type {
	BillingPaymentMethod,
	BillingPlan,
	BillingPortalDto,
	BillingStatus,
	BillingSummaryResponse,
	CheckoutSessionDto,
	CreateBillingPortalBody,
	CreateCheckoutBody
} from '@huriro/contracts'
import { isUuid, type Queryable, type Sql, withSystem, withWorkspace } from '@huriro/db'
import type { ActorContext } from '@huriro/domain'
import { withIdempotency } from '../../api/context'
import type { DnsResolver } from '../../api/egress'
import { HttpError } from '../../api/error'
import { BILLING_EVENTS } from './events'
import { normalizeRwandaPhone, UsdToRwfConverter } from './fx'
import { authorizeBillingManage } from './policy'
import {
	createIremboPayBillingProvider,
	createPolarBillingProvider,
	type IremboPayBillingProvider,
	type PolarBillingProvider
} from './provider'
import {
	computeWorkspaceBillingUsage,
	emitBillingOutbox,
	ensureBillingSubscriptionRow,
	insertBillingAudit,
	markBillingWebhookProcessed,
	recordBillingWebhookEvent,
	recordPendingCheckoutInvoice,
	resolveWorkspaceByProviderIds,
	upsertBillingSubscriptionFromWebhook,
	upsertBillingUsageSnapshotRow
} from './repo'

export interface BillingModuleConfig {
	readonly mode: 'selfhost' | 'cloud'
	readonly workspacePriceUsdCents?: number | undefined
	readonly fxApiUrl?: string | undefined
	readonly usdToRwfFallback?: number | undefined
	readonly fxConverter?: UsdToRwfConverter | undefined
	readonly polarProvider?: PolarBillingProvider | undefined
	readonly polarApiUrl?: string | undefined
	readonly polarAccessToken?: string | undefined
	readonly polarWebhookSecret?: string | undefined
	readonly polarProductId?: string | undefined
	readonly iremboPayProvider?: IremboPayBillingProvider | undefined
	readonly iremboPayApiUrl?: string | undefined
	readonly iremboPaySecretKey?: string | undefined
	readonly iremboPayWebhookSecret?: string | undefined
	readonly iremboPayWebhookDelimiter?: '#' | '.' | undefined
	readonly iremboPayPaymentAccountId?: string | undefined
	readonly iremboPayProductCode?: string | undefined
	readonly fetchImpl?: typeof fetch | undefined
	readonly resolver?: DnsResolver | undefined
}

const PLAN_LIMITS: Record<BillingPlan, { readonly seatLimit: number; readonly storageLimitBytes: number }> = {
	free: { seatLimit: 5, storageLimitBytes: 1_073_741_824 },
	pro: { seatLimit: 100, storageLimitBytes: 107_374_182_400 },
	enterprise: { seatLimit: 10_000, storageLimitBytes: 10_995_116_277_760 }
}

const DEFAULT_USD_CENTS = 1000 // $10 USD / workspace / month
const converterCache = new WeakMap<BillingModuleConfig, UsdToRwfConverter>()

function assertCloudMode(cfg: BillingModuleConfig): void {
	if (cfg.mode !== 'cloud') {
		throw new HttpError(404, 'billing_disabled', 'Billing is only enabled in Huriro Cloud mode')
	}
}

export function assertWebOnlyBillingClient(headers: {
	readonly clientName: string | null
	readonly platform: string | null
}): void {
	const client = headers.clientName?.toLowerCase().trim() ?? ''
	const platform = headers.platform?.toLowerCase().trim() ?? ''
	if (
		client.startsWith('huriro-mobile') ||
		client.includes('expo') ||
		platform === 'ios' ||
		platform === 'android'
	) {
		throw new HttpError(
			403,
			'web_only_billing',
			'Billing and checkout are web-only',
			'Please open the Huriro web app to upgrade or manage workspace billing.'
		)
	}
}

function getFxConverter(cfg: BillingModuleConfig): UsdToRwfConverter {
	if (cfg.fxConverter) return cfg.fxConverter
	let cached = converterCache.get(cfg)
	if (!cached) {
		cached = new UsdToRwfConverter({
			fxApiUrl: cfg.fxApiUrl,
			fallbackRate: cfg.usdToRwfFallback,
			fetchImpl: cfg.fetchImpl,
			resolver: cfg.resolver
		})
		converterCache.set(cfg, cached)
	}
	return cached
}

function resolvePolarProvider(cfg: BillingModuleConfig): PolarBillingProvider {
	return (
		cfg.polarProvider ??
		createPolarBillingProvider({
			apiUrl: cfg.polarApiUrl,
			accessToken: cfg.polarAccessToken,
			webhookSecret: cfg.polarWebhookSecret,
			fetchImpl: cfg.fetchImpl,
			resolver: cfg.resolver
		})
	)
}

function resolveIremboPayProvider(cfg: BillingModuleConfig): IremboPayBillingProvider {
	return (
		cfg.iremboPayProvider ??
		createIremboPayBillingProvider({
			apiUrl: cfg.iremboPayApiUrl,
			secretKey: cfg.iremboPaySecretKey,
			webhookSecret: cfg.iremboPayWebhookSecret,
			webhookDelimiter: cfg.iremboPayWebhookDelimiter,
			paymentAccountId: cfg.iremboPayPaymentAccountId,
			productCode: cfg.iremboPayProductCode,
			fetchImpl: cfg.fetchImpl,
			resolver: cfg.resolver
		})
	)
}

export async function getWorkspaceBillingSummary(
	tx: Queryable,
	actor: ActorContext,
	cfg: BillingModuleConfig
): Promise<BillingSummaryResponse> {
	assertCloudMode(cfg)
	authorizeBillingManage(actor)
	const subscription = await ensureBillingSubscriptionRow(tx, actor.workspaceId)
	const usage = await computeWorkspaceBillingUsage(tx, actor.workspaceId)
	const quote = await getFxConverter(cfg).quoteProPlan(cfg.workspacePriceUsdCents ?? DEFAULT_USD_CENTS)
	return {
		subscription,
		usage,
		quote,
		webOnlyCheckout: true,
		providers: {
			polar: Boolean(cfg.polarProvider || cfg.polarAccessToken),
			irembopay: Boolean(cfg.iremboPayProvider || cfg.iremboPaySecretKey)
		}
	}
}

export async function createBillingCheckout(
	sql: Sql,
	actor: ActorContext,
	body: CreateCheckoutBody,
	cfg: BillingModuleConfig,
	requestMeta: {
		readonly idempotencyKey?: string | null | undefined
		readonly clientName: string | null
		readonly platform: string | null
	}
): Promise<{ readonly status: number; readonly body: CheckoutSessionDto }> {
	assertCloudMode(cfg)
	assertWebOnlyBillingClient(requestMeta)
	authorizeBillingManage(actor)

	const usdCents = cfg.workspacePriceUsdCents ?? DEFAULT_USD_CENTS
	const existing = await withWorkspace(sql, { workspaceId: actor.workspaceId, userId: actor.userId }, (tx) =>
		ensureBillingSubscriptionRow(tx, actor.workspaceId, body.billingEmail ?? null)
	)

	let session: CheckoutSessionDto
	let normalizedPhone: string | null = null
	let resolvedMethod: BillingPaymentMethod

	if (body.provider === 'polar') {
		if (body.paymentMethod && body.paymentMethod !== 'card') {
			throw new HttpError(422, 'validation_failed', 'Polar checkout supports international card payments')
		}
		resolvedMethod = 'card'
		const polar = resolvePolarProvider(cfg)
		session = await polar.createCheckoutSession({
			workspaceId: actor.workspaceId,
			productId: cfg.polarProductId ?? 'polar_huriro_pro',
			successUrl: body.successUrl,
			customerId: existing.provider === 'polar' ? existing.providerCustomerId : null,
			billingEmail: body.billingEmail ?? existing.billingEmail,
			usdCents
		})
	} else {
		resolvedMethod = body.paymentMethod && body.paymentMethod !== 'card' ? body.paymentMethod : 'mtn_momo'
		if (resolvedMethod === 'mtn_momo' || resolvedMethod === 'airtel_money') {
			if (!body.phoneNumber?.trim()) {
				throw new HttpError(
					422,
					'validation_failed',
					'A Rwandan Mobile Money phone number is required for MTN MoMo / Airtel Money payments'
				)
			}
			normalizedPhone = normalizeRwandaPhone(body.phoneNumber)
		} else if (body.phoneNumber?.trim()) {
			normalizedPhone = normalizeRwandaPhone(body.phoneNumber)
		}

		const quote = await getFxConverter(cfg).quoteProPlan(usdCents)
		const irembo = resolveIremboPayProvider(cfg)
		session = await irembo.createCheckoutSession({
			workspaceId: actor.workspaceId,
			rwfAmount: quote.rwfAmount,
			exchangeRateUsdToRwf: quote.exchangeRateUsdToRwf,
			paymentMethod: resolvedMethod,
			phoneNumber: normalizedPhone,
			billingEmail: body.billingEmail ?? existing.billingEmail,
			billingName: body.billingName ?? 'Huriro Workspace',
			successUrl: body.successUrl
		})
	}

	return withWorkspace(sql, { workspaceId: actor.workspaceId, userId: actor.userId }, (tx) =>
		withIdempotency(tx, {
			workspaceId: actor.workspaceId,
			key: requestMeta.idempotencyKey,
			endpoint: 'POST /billing/checkout',
			requestBody: body,
			successStatus: 201,
			execute: async () => {
				const recorded = await recordPendingCheckoutInvoice(tx, {
					workspaceId: actor.workspaceId,
					provider: body.provider,
					subscriptionOrInvoiceId: session.invoiceNumber ?? session.sessionId,
					billingEmail: body.billingEmail ?? existing.billingEmail,
					billingPhone: normalizedPhone,
					currency: session.currency,
					amountCharged: session.currency === 'USD' ? usdCents : session.amount,
					paymentMethod: resolvedMethod
				})
				await insertBillingAudit(tx, {
					workspaceId: actor.workspaceId,
					actorType: 'user',
					actorId: actor.userId,
					action: 'billing.checkout.created',
					targetId: recorded.id,
					metadata: {
						provider: body.provider,
						paymentMethod: resolvedMethod,
						currency: session.currency,
						amount: session.amount,
						sessionId: session.sessionId
					}
				})
				await emitBillingOutbox(tx, {
					workspaceId: actor.workspaceId,
					aggregateId: recorded.id,
					eventType: BILLING_EVENTS.CheckoutCreated,
					payload: {
						workspaceId: actor.workspaceId,
						provider: body.provider,
						currency: session.currency,
						amount: session.amount,
						sessionId: session.sessionId
					}
				})
				return session
			}
		})
	)
}

export async function createBillingPortal(
	sql: Sql,
	actor: ActorContext,
	body: CreateBillingPortalBody,
	cfg: BillingModuleConfig,
	requestMeta: { readonly clientName: string | null; readonly platform: string | null }
): Promise<BillingPortalDto> {
	assertCloudMode(cfg)
	assertWebOnlyBillingClient(requestMeta)
	authorizeBillingManage(actor)

	const sub = await withWorkspace(sql, { workspaceId: actor.workspaceId, userId: actor.userId }, (tx) =>
		ensureBillingSubscriptionRow(tx, actor.workspaceId)
	)
	if (sub.provider === 'irembopay') {
		throw new HttpError(
			409,
			'conflict',
			'IremboPay Mobile Money subscriptions do not use an external portal — initiate renewal directly in Web Billing.'
		)
	}
	if (!sub.providerCustomerId) {
		throw new HttpError(409, 'conflict', 'Workspace has no active Polar customer account yet')
	}

	const polar = resolvePolarProvider(cfg)
	const portal = await polar.createPortalSession({
		workspaceId: actor.workspaceId,
		customerId: sub.providerCustomerId,
		returnUrl: body.returnUrl
	})

	await withWorkspace(sql, { workspaceId: actor.workspaceId, userId: actor.userId }, (tx) =>
		insertBillingAudit(tx, {
			workspaceId: actor.workspaceId,
			actorType: 'user',
			actorId: actor.userId,
			action: 'billing.portal.opened',
			targetId: sub.id
		})
	)
	return portal
}

interface PolarWebhookPayload {
	readonly type?: string
	readonly data?: {
		readonly id?: string
		readonly status?: string
		readonly amount?: number
		readonly currency?: string
		readonly customer_id?: string
		readonly customer?: {
			readonly id?: string
			readonly email?: string
			readonly external_id?: string | null
		}
		readonly external_customer_id?: string | null
		readonly subscription_id?: string
		readonly current_period_start?: string | null
		readonly current_period_end?: string | null
		readonly cancel_at_period_end?: boolean
		readonly metadata?: Record<string, unknown>
	}
}

export async function ingestPolarWebhook(
	sql: Sql,
	args: {
		readonly rawBody: string
		readonly headers: Headers
		readonly cfg: BillingModuleConfig
	}
): Promise<{ readonly accepted: boolean; readonly deduplicated: boolean }> {
	assertCloudMode(args.cfg)
	const polar = resolvePolarProvider(args.cfg)
	if (!polar.verifyWebhookSignature(args.rawBody, args.headers)) {
		throw new HttpError(401, 'webhook_signature_invalid', 'Invalid Polar webhook signature')
	}

	let parsed: PolarWebhookPayload
	try {
		parsed = JSON.parse(args.rawBody) as PolarWebhookPayload
	} catch {
		throw new HttpError(400, 'validation_failed', 'Malformed Polar webhook payload')
	}

	const eventType = parsed.type?.trim()
	const obj = parsed.data
	if (!eventType || !obj) {
		throw new HttpError(400, 'validation_failed', 'Polar webhook missing type or data')
	}
	const webhookMsgId = args.headers.get('webhook-id')?.trim()
	const eventId = webhookMsgId || `polar:${eventType}:${obj.id ?? 'unknown'}`

	const metaWs =
		typeof obj.metadata?.['workspace_id'] === 'string' && isUuid(obj.metadata['workspace_id'])
			? obj.metadata['workspace_id']
			: typeof obj.external_customer_id === 'string' && isUuid(obj.external_customer_id)
				? obj.external_customer_id
				: typeof obj.customer?.external_id === 'string' && isUuid(obj.customer.external_id)
					? obj.customer.external_id
					: null

	const customerId = obj.customer_id ?? obj.customer?.id ?? null
	const subscriptionId =
		eventType.startsWith('subscription.') && typeof obj.id === 'string'
			? obj.id
			: typeof obj.subscription_id === 'string'
				? obj.subscription_id
				: null

	const resolvedWsId =
		metaWs ?? (await withSystem(sql, (tx) => resolveWorkspaceByProviderIds(tx, customerId, subscriptionId)))

	const inserted = await withSystem(sql, (tx) =>
		recordBillingWebhookEvent(tx, {
			providerEventId: eventId,
			provider: 'polar',
			eventType,
			workspaceId: resolvedWsId,
			payload: parsed as unknown as Record<string, unknown>
		})
	)
	if (!inserted) {
		return { accepted: true, deduplicated: true }
	}

	if (!resolvedWsId) {
		await withSystem(sql, (tx) =>
			markBillingWebhookProcessed(tx, eventId, null, 'No matching workspace found')
		)
		return { accepted: true, deduplicated: false }
	}

	const isRevoked = eventType === 'subscription.revoked' || eventType === 'subscription.canceled'
	const plan: BillingPlan = isRevoked ? 'free' : 'pro'
	const status: BillingStatus = isRevoked
		? 'canceled'
		: obj.status === 'trialing'
			? 'trialing'
			: obj.status === 'past_due'
				? 'past_due'
				: 'active'
	const limits = PLAN_LIMITS[plan]
	const amountCharged =
		typeof obj.amount === 'number' && Number.isFinite(obj.amount)
			? Math.max(0, Math.round(obj.amount))
			: (args.cfg.workspacePriceUsdCents ?? DEFAULT_USD_CENTS)

	await withWorkspace(sql, { workspaceId: resolvedWsId }, async (tx) => {
		const updated = await upsertBillingSubscriptionFromWebhook(tx, {
			workspaceId: resolvedWsId,
			provider: 'polar',
			plan,
			status,
			providerCustomerId: customerId,
			providerSubscriptionId: subscriptionId,
			billingEmail: obj.customer?.email ?? null,
			billingPhone: null,
			currency: 'USD',
			amountCharged,
			paymentMethod: 'card',
			seatLimit: limits.seatLimit,
			storageLimitBytes: limits.storageLimitBytes,
			currentPeriodStart: obj.current_period_start ?? null,
			currentPeriodEnd: obj.current_period_end ?? null,
			cancelAtPeriodEnd: obj.cancel_at_period_end === true
		})

		await insertBillingAudit(tx, {
			workspaceId: resolvedWsId,
			actorType: 'system',
			action: 'billing.subscription.webhook_updated',
			targetId: updated.id,
			metadata: { provider: 'polar', eventId, eventType, plan, status }
		})

		await emitBillingOutbox(tx, {
			workspaceId: resolvedWsId,
			aggregateId: updated.id,
			eventType: BILLING_EVENTS.SubscriptionUpdated,
			payload: { workspaceId: resolvedWsId, provider: 'polar', plan, status, eventId }
		})
	})

	await withSystem(sql, (tx) => markBillingWebhookProcessed(tx, eventId, resolvedWsId, null))
	return { accepted: true, deduplicated: false }
}

interface IremboPayWebhookPayload {
	readonly success?: boolean
	readonly data?: {
		readonly invoiceNumber?: string
		readonly transactionId?: string
		readonly amount?: number
		readonly currency?: string
		readonly paymentStatus?: string
		readonly paymentMethod?: string
		readonly customer?: {
			readonly email?: string
			readonly phoneNumber?: string
		}
		readonly paidAt?: string
	}
}

function mapIremboPaymentMethod(raw: string | undefined): BillingPaymentMethod {
	const v = raw?.toUpperCase() ?? ''
	if (v.includes('MTN')) return 'mtn_momo'
	if (v.includes('AIRTEL')) return 'airtel_money'
	return 'irembopay_hosted'
}

export async function ingestIremboPayWebhook(
	sql: Sql,
	args: {
		readonly rawBody: string
		readonly signatureHeader: string | null
		readonly cfg: BillingModuleConfig
	}
): Promise<{ readonly accepted: boolean; readonly deduplicated: boolean }> {
	assertCloudMode(args.cfg)
	const irembo = resolveIremboPayProvider(args.cfg)
	if (!irembo.verifyWebhookSignature(args.rawBody, args.signatureHeader)) {
		throw new HttpError(401, 'webhook_signature_invalid', 'Invalid IremboPay webhook signature')
	}

	let parsed: IremboPayWebhookPayload
	try {
		parsed = JSON.parse(args.rawBody) as IremboPayWebhookPayload
	} catch {
		throw new HttpError(400, 'validation_failed', 'Malformed IremboPay webhook payload')
	}

	const data = parsed.data
	const invoiceNumber = data?.invoiceNumber?.trim()
	const paymentStatus = data?.paymentStatus?.trim().toUpperCase() ?? 'UNKNOWN'
	if (!data || !invoiceNumber) {
		throw new HttpError(400, 'validation_failed', 'IremboPay webhook missing data.invoiceNumber')
	}

	const eventId = `irembo:${invoiceNumber}:${paymentStatus}:${data.transactionId ?? 'tx'}`
	const resolvedWsId = await withSystem(sql, (tx) => resolveWorkspaceByProviderIds(tx, null, invoiceNumber))

	const inserted = await withSystem(sql, (tx) =>
		recordBillingWebhookEvent(tx, {
			providerEventId: eventId,
			provider: 'irembopay',
			eventType: paymentStatus,
			workspaceId: resolvedWsId,
			payload: parsed as unknown as Record<string, unknown>
		})
	)
	if (!inserted) {
		return { accepted: true, deduplicated: true }
	}

	if (!resolvedWsId) {
		await withSystem(sql, (tx) =>
			markBillingWebhookProcessed(tx, eventId, null, 'No matching workspace for invoice')
		)
		return { accepted: true, deduplicated: false }
	}

	const paid = paymentStatus === 'PAID' || paymentStatus === 'SUCCESS'
	const plan: BillingPlan = paid ? 'pro' : 'free'
	const status: BillingStatus = paid ? 'active' : paymentStatus === 'FAILED' ? 'past_due' : 'incomplete'
	const limits = PLAN_LIMITS[plan]
	const now = data.paidAt ? new Date(data.paidAt) : new Date()
	const periodStartIso = Number.isNaN(now.getTime()) ? new Date().toISOString() : now.toISOString()
	const periodEndIso = new Date(Date.parse(periodStartIso) + 30 * 24 * 60 * 60 * 1000).toISOString()
	const amountCharged =
		typeof data.amount === 'number' && Number.isFinite(data.amount) ? Math.max(0, Math.round(data.amount)) : 0

	await withWorkspace(sql, { workspaceId: resolvedWsId }, async (tx) => {
		const updated = await upsertBillingSubscriptionFromWebhook(tx, {
			workspaceId: resolvedWsId,
			provider: 'irembopay',
			plan,
			status,
			providerCustomerId: null,
			providerSubscriptionId: invoiceNumber,
			billingEmail: data.customer?.email ?? null,
			billingPhone: data.customer?.phoneNumber ?? null,
			currency: 'RWF',
			amountCharged,
			paymentMethod: mapIremboPaymentMethod(data.paymentMethod),
			seatLimit: limits.seatLimit,
			storageLimitBytes: limits.storageLimitBytes,
			currentPeriodStart: paid ? periodStartIso : null,
			currentPeriodEnd: paid ? periodEndIso : null,
			cancelAtPeriodEnd: false
		})

		await insertBillingAudit(tx, {
			workspaceId: resolvedWsId,
			actorType: 'system',
			action: 'billing.subscription.webhook_updated',
			targetId: updated.id,
			metadata: { provider: 'irembopay', eventId, paymentStatus, plan, status }
		})

		await emitBillingOutbox(tx, {
			workspaceId: resolvedWsId,
			aggregateId: updated.id,
			eventType: BILLING_EVENTS.SubscriptionUpdated,
			payload: { workspaceId: resolvedWsId, provider: 'irembopay', plan, status, eventId }
		})
	})

	await withSystem(sql, (tx) => markBillingWebhookProcessed(tx, eventId, resolvedWsId, null))
	return { accepted: true, deduplicated: false }
}

/** Daily metering snapshot across active workspaces (worker job in HURIRO_MODE=cloud). */
export async function captureDailyBillingUsageOnce(
	app: Sql,
	periodDate = new Date().toISOString().slice(0, 10)
): Promise<number> {
	const workspaces = await withSystem(
		app,
		(tx) => tx<{ id: string }[]>`SELECT id FROM list_active_workspaces_for_worker()`
	)
	for (const ws of workspaces) {
		await withWorkspace(app, { workspaceId: ws.id }, async (tx) => {
			const usage = await computeWorkspaceBillingUsage(tx, ws.id)
			await upsertBillingUsageSnapshotRow(tx, ws.id, periodDate, usage)
		})
	}
	return workspaces.length
}
