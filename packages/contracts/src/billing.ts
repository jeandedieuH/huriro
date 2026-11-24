import { type Static, Type } from 'typebox'

export const BillingPlan = Type.Union([Type.Literal('free'), Type.Literal('pro'), Type.Literal('enterprise')])
export type BillingPlan = Static<typeof BillingPlan>

export const BillingStatus = Type.Union([
	Type.Literal('active'),
	Type.Literal('trialing'),
	Type.Literal('past_due'),
	Type.Literal('canceled'),
	Type.Literal('incomplete')
])
export type BillingStatus = Static<typeof BillingStatus>

export const BillingProviderKind = Type.Union([
	Type.Literal('polar'),
	Type.Literal('irembopay'),
	Type.Literal('manual')
])
export type BillingProviderKind = Static<typeof BillingProviderKind>

export const BillingCheckoutProvider = Type.Union([Type.Literal('polar'), Type.Literal('irembopay')])
export type BillingCheckoutProvider = Static<typeof BillingCheckoutProvider>

export const BillingCurrency = Type.Union([Type.Literal('USD'), Type.Literal('RWF')])
export type BillingCurrency = Static<typeof BillingCurrency>

export const BillingPaymentMethod = Type.Union([
	Type.Literal('card'),
	Type.Literal('mtn_momo'),
	Type.Literal('airtel_money'),
	Type.Literal('irembopay_hosted')
])
export type BillingPaymentMethod = Static<typeof BillingPaymentMethod>

export const BillingPriceQuoteDto = Type.Object({
	plan: Type.Literal('pro'),
	usdCents: Type.Integer({ minimum: 100 }),
	usdAmount: Type.Number({ minimum: 1 }),
	rwfAmount: Type.Integer({ minimum: 1 }),
	exchangeRateUsdToRwf: Type.Number({ exclusiveMinimum: 0 }),
	exchangeRateSource: Type.Union([Type.Literal('live'), Type.Literal('cache'), Type.Literal('fallback')]),
	exchangeRateFetchedAt: Type.String()
})
export type BillingPriceQuoteDto = Static<typeof BillingPriceQuoteDto>

export const BillingSubscriptionDto = Type.Object({
	id: Type.String({ format: 'uuid' }),
	workspaceId: Type.String({ format: 'uuid' }),
	plan: BillingPlan,
	status: BillingStatus,
	provider: BillingProviderKind,
	providerCustomerId: Type.Union([Type.String(), Type.Null()]),
	providerSubscriptionId: Type.Union([Type.String(), Type.Null()]),
	billingEmail: Type.Union([Type.String(), Type.Null()]),
	billingPhone: Type.Union([Type.String(), Type.Null()]),
	currency: BillingCurrency,
	amountCharged: Type.Integer({ minimum: 0 }),
	paymentMethod: Type.Union([BillingPaymentMethod, Type.Null()]),
	seatLimit: Type.Integer({ minimum: 1 }),
	storageLimitBytes: Type.Number({ minimum: 0 }),
	currentPeriodStart: Type.Union([Type.String(), Type.Null()]),
	currentPeriodEnd: Type.Union([Type.String(), Type.Null()]),
	cancelAtPeriodEnd: Type.Boolean(),
	createdAt: Type.String(),
	updatedAt: Type.String(),
	version: Type.Integer({ minimum: 1 })
})
export type BillingSubscriptionDto = Static<typeof BillingSubscriptionDto>

export const BillingUsageDto = Type.Object({
	activeSeats: Type.Integer({ minimum: 0 }),
	storageBytes: Type.Number({ minimum: 0 }),
	aiTokensUsed: Type.Number({ minimum: 0 })
})
export type BillingUsageDto = Static<typeof BillingUsageDto>

export const BillingSummaryResponse = Type.Object({
	subscription: BillingSubscriptionDto,
	usage: BillingUsageDto,
	quote: BillingPriceQuoteDto,
	webOnlyCheckout: Type.Literal(true),
	providers: Type.Object({
		polar: Type.Boolean(),
		irembopay: Type.Boolean()
	})
})
export type BillingSummaryResponse = Static<typeof BillingSummaryResponse>

export const CreateCheckoutBody = Type.Object({
	plan: Type.Literal('pro'),
	provider: BillingCheckoutProvider,
	successUrl: Type.String({ minLength: 1, maxLength: 2048 }),
	cancelUrl: Type.String({ minLength: 1, maxLength: 2048 }),
	billingEmail: Type.Optional(Type.String({ format: 'email' })),
	billingName: Type.Optional(Type.String({ minLength: 1, maxLength: 120 })),
	paymentMethod: Type.Optional(BillingPaymentMethod),
	phoneNumber: Type.Optional(Type.String({ minLength: 9, maxLength: 20 }))
})
export type CreateCheckoutBody = Static<typeof CreateCheckoutBody>

export const CheckoutSessionDto = Type.Object({
	provider: BillingCheckoutProvider,
	sessionId: Type.String(),
	url: Type.Union([Type.String(), Type.Null()]),
	currency: BillingCurrency,
	amount: Type.Number({ minimum: 0 }),
	exchangeRateUsdToRwf: Type.Union([Type.Number({ exclusiveMinimum: 0 }), Type.Null()]),
	paymentMethod: BillingPaymentMethod,
	invoiceNumber: Type.Union([Type.String(), Type.Null()]),
	mobileMoneyPromptSent: Type.Boolean(),
	instructions: Type.Union([Type.String(), Type.Null()])
})
export type CheckoutSessionDto = Static<typeof CheckoutSessionDto>

export const CreateBillingPortalBody = Type.Object({
	returnUrl: Type.String({ minLength: 1, maxLength: 2048 })
})
export type CreateBillingPortalBody = Static<typeof CreateBillingPortalBody>

export const BillingPortalDto = Type.Object({
	url: Type.String()
})
export type BillingPortalDto = Static<typeof BillingPortalDto>
