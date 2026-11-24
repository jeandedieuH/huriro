/**
 * Real PostgreSQL 18 M6 integration tests:
 *   - Mobile push token CRUD + Expo hint dispatch + DeviceNotRegistered auto-revoke + RLS
 *   - Cloud Billing (mode='cloud'): Polar ($10 USD) + IremboPay (Rwanda RWF + MTN MoMo / Airtel Money)
 *   - Live/cache/fallback USD->RWF currency conversion + web-only billing guard (`403 web_only_billing`)
 *   - Governance: GDPR JSON workspace export + download CSP headers + `erase_user_identity`
 */
import { beforeAll, describe, expect, it } from 'bun:test'
import { createHmac, randomUUID } from 'node:crypto'
import type { TestDb } from '@huriro/test-utils'
import { captureDailyBillingUsageOnce } from '../modules/billing'
import { UsdToRwfConverter } from '../modules/billing/fx'
import { dispatchMobilePushNotifications } from '../modules/notifications'
import {
	apiRequest,
	createIntegrationServer,
	getTestDb,
	type M1SeededFixture,
	seedM1Fixture
} from './test-harness'

let db: TestDb | null = null
let fx: M1SeededFixture

const POLAR_WEBHOOK_SECRET = 'whsec_polar_m6_integration_secret'
const IREMBOPAY_WEBHOOK_SECRET = 'irembopay_m6_integration_secret'

function signPolarWebhook(rawBody: string, webhookId: string): Headers {
	const ts = String(Math.floor(Date.now() / 1000))
	const sig = createHmac('sha256', Buffer.from(POLAR_WEBHOOK_SECRET, 'utf8'))
		.update(`${webhookId}.${ts}.${rawBody}`, 'utf8')
		.digest('base64')
	return new Headers({
		'content-type': 'application/json',
		'webhook-id': webhookId,
		'webhook-timestamp': ts,
		'webhook-signature': `v1,${sig}`
	})
}

function signIremboPayWebhook(rawBody: string, secret = IREMBOPAY_WEBHOOK_SECRET): string {
	const ts = String(Date.now())
	const sig = createHmac('sha256', secret).update(`${ts}#${rawBody}`, 'utf8').digest('hex')
	return `t=${ts},s=${sig}`
}

const publicDnsResolver = async () => [{ address: '93.184.216.34', family: 4 as const }]

describe('M6 Mobile Push, Cloud Billing (Polar + IremboPay), & Governance (PG18)', () => {
	beforeAll(async () => {
		db = await getTestDb()
		if (db) fx = await seedM1Fixture(db.owner)
	})

	it('manages mobile push tokens, dispatches sanitized Expo hints, revokes gone devices, and enforces RLS', async () => {
		if (!db) return
		const { app } = createIntegrationServer(db)

		// Enable mobile push in notification preferences
		const prefRes = await apiRequest(app, {
			method: 'PATCH',
			path: '/api/v1/notifications/preferences',
			workspaceId: fx.workspaceId,
			userId: fx.ownerId,
			body: { mobilePushEnabled: true }
		})
		expect(prefRes.status).toBe(200)
		expect(prefRes.json['mobilePushEnabled']).toBe(true)

		// Register Expo push token
		const regRes = await apiRequest(app, {
			method: 'POST',
			path: '/api/v1/notifications/push/mobile-tokens',
			workspaceId: fx.workspaceId,
			userId: fx.ownerId,
			body: {
				token: 'ExponentPushToken[huriro-m6-device-1]',
				platform: 'ios',
				deviceId: 'ios-device-m6-1',
				deviceName: 'iPhone 16 Pro'
			}
		})
		expect(regRes.status).toBe(201)
		const tokenId = String(regRes.json['id'])

		// Two-tenant RLS isolation: otherTenantUserId cannot list or delete owner's token
		const otherList = await apiRequest(app, {
			path: '/api/v1/notifications/push/mobile-tokens',
			workspaceId: fx.otherWorkspaceId,
			userId: fx.otherTenantUserId
		})
		expect(otherList.status).toBe(200)
		const otherTokens = otherList.json as unknown as { id: string }[]
		expect(otherTokens.some((t) => t.id === tokenId)).toBe(false)

		const crossDelete = await apiRequest(app, {
			method: 'DELETE',
			path: `/api/v1/notifications/push/mobile-tokens/${tokenId}`,
			workspaceId: fx.otherWorkspaceId,
			userId: fx.otherTenantUserId
		})
		expect(crossDelete.status).toBe(404)

		// Dispatch hint payload + verify DeviceNotRegistered triggers revocation
		const sentBodies: string[] = []
		let callCount = 0
		const expoFetch = (async (_url: string | URL | Request, init?: RequestInit) => {
			callCount += 1
			sentBodies.push(String(init?.body ?? ''))
			if (callCount === 1) {
				return new Response(JSON.stringify({ data: { status: 'ok', id: 'expo-ticket-1' } }), {
					status: 200,
					headers: { 'content-type': 'application/json' }
				})
			}
			return new Response(
				JSON.stringify({
					data: {
						status: 'error',
						message: 'Device not registered',
						details: { error: 'DeviceNotRegistered' }
					}
				}),
				{ status: 200, headers: { 'content-type': 'application/json' } }
			)
		}) as unknown as typeof fetch

		const notifId = randomUUID()
		const issueEntityId = randomUUID()
		await db.owner`
			INSERT INTO notifications (id, workspace_id, recipient_user_id, actor_type, actor_id, kind, entity_type, entity_id, title, body, metadata)
			VALUES (
				${notifId},
				${fx.workspaceId},
				${fx.ownerId},
				'user',
				${fx.adminId},
				'issue.mentioned',
				'issue',
				${issueEntityId},
				'Mentioned you in ENG-42',
				'Short summary',
				'{"issueKey":"ENG-42"}'::jsonb
			)
		`

		const fakeNotif = {
			id: notifId,
			workspaceId: fx.workspaceId,
			recipientUserId: fx.ownerId,
			actorType: 'user' as const,
			kind: 'issue.mentioned' as const,
			title: 'Mentioned you in ENG-42',
			body: 'Short summary',
			entityType: 'issue' as const,
			entityId: issueEntityId,
			actorId: fx.adminId,
			metadata: { issueKey: 'ENG-42' },
			readAt: null,
			archivedAt: null,
			createdAt: new Date().toISOString()
		}

		await dispatchMobilePushNotifications(
			db.app,
			fx.workspaceId,
			[{ userId: fx.ownerId, notification: fakeNotif }],
			{
				fetchImpl: expoFetch,
				resolver: publicDnsResolver
			}
		)
		expect(sentBodies.length).toBe(1)
		const parsedPush = JSON.parse(sentBodies[0] ?? '{}') as { to?: string; data?: { entityId?: string } }
		expect(parsedPush.to).toBe('ExponentPushToken[huriro-m6-device-1]')
		expect(parsedPush.data?.entityId).toBe(fakeNotif.entityId)

		// Second dispatch returns DeviceNotRegistered -> token auto-revoked
		await dispatchMobilePushNotifications(
			db.app,
			fx.workspaceId,
			[{ userId: fx.ownerId, notification: fakeNotif }],
			{
				fetchImpl: expoFetch,
				resolver: publicDnsResolver
			}
		)

		const afterRevoke = await apiRequest(app, {
			path: '/api/v1/notifications/push/mobile-tokens',
			workspaceId: fx.workspaceId,
			userId: fx.ownerId
		})
		expect(afterRevoke.status).toBe(200)
		const remaining = afterRevoke.json as unknown as { id: string }[]
		expect(remaining.some((t) => t.id === tokenId)).toBe(false)
	})

	it('enforces selfhost 404 billing_disabled and mobile 403 web_only_billing', async () => {
		if (!db) return
		const { app: selfhostApp } = createIntegrationServer(db, { mode: 'selfhost' })
		const shSub = await apiRequest(selfhostApp, {
			path: '/api/v1/billing/subscription',
			workspaceId: fx.workspaceId,
			userId: fx.ownerId
		})
		expect(shSub.status).toBe(404)
		expect(shSub.json['code']).toBe('billing_disabled')

		const { app: cloudApp } = createIntegrationServer(db, {
			mode: 'cloud',
			billing: {
				polarAccessToken: 'polar_test_token',
				polarProductId: 'polar_prod_123',
				polarWebhookSecret: POLAR_WEBHOOK_SECRET,
				iremboPaySecretKey: 'irembo_test_secret',
				iremboPayWebhookSecret: IREMBOPAY_WEBHOOK_SECRET
			}
		})

		// Mobile client must receive 403 web_only_billing on checkout and portal
		const mobCheckout = await apiRequest(cloudApp, {
			method: 'POST',
			path: '/api/v1/billing/checkout',
			workspaceId: fx.workspaceId,
			userId: fx.ownerId,
			headers: {
				'x-huriro-client': 'huriro-mobile',
				'x-huriro-platform': 'ios',
				'idempotency-key': randomUUID()
			},
			body: {
				plan: 'pro',
				provider: 'polar',
				successUrl: 'https://app.huriro.test/settings?billing=success',
				cancelUrl: 'https://app.huriro.test/settings?billing=cancel'
			}
		})
		expect(mobCheckout.status).toBe(403)
		expect(mobCheckout.json['code']).toBe('web_only_billing')

		const androidPortal = await apiRequest(cloudApp, {
			method: 'POST',
			path: '/api/v1/billing/portal',
			workspaceId: fx.workspaceId,
			userId: fx.ownerId,
			headers: { 'x-huriro-platform': 'android' },
			body: { returnUrl: 'https://app.huriro.test/settings' }
		})
		expect(androidPortal.status).toBe(403)
		expect(androidPortal.json['code']).toBe('web_only_billing')

		// Non-owner cannot view or manage billing
		const memberSub = await apiRequest(cloudApp, {
			path: '/api/v1/billing/subscription',
			workspaceId: fx.workspaceId,
			userId: fx.memberAId
		})
		expect(memberSub.status).toBe(403)
	})

	it('supports Polar ($10 USD) + IremboPay (RWF + MTN/Airtel MoMo) checkouts, live FX, and signed webhooks', async () => {
		if (!db) return
		const runTag = randomUUID().slice(0, 8)
		const iremboInvoiceNo = `INV-RW-${runTag}`
		const fxFetch = (async (input: string | URL | Request) => {
			const url = typeof input === 'string' ? input : input instanceof URL ? input.toString() : input.url
			if (url.includes('fx.huriro.test')) {
				return new Response(JSON.stringify({ rates: { RWF: 1425 } }), {
					status: 200,
					headers: { 'content-type': 'application/json' }
				})
			}
			if (url.includes('polar.test/v1/checkouts')) {
				return new Response(
					JSON.stringify({
						id: `polar_chk_${runTag}`,
						url: `https://polar.sh/checkout/polar_chk_${runTag}`
					}),
					{ status: 201, headers: { 'content-type': 'application/json' } }
				)
			}
			if (url.includes('polar.test/v1/customer-sessions')) {
				return new Response(
					JSON.stringify({ customer_portal_url: `https://polar.sh/portal/cus_${runTag}` }),
					{ status: 201, headers: { 'content-type': 'application/json' } }
				)
			}
			if (url.includes('irembopay.test/payments/invoices')) {
				return new Response(
					JSON.stringify({
						data: {
							invoiceNumber: iremboInvoiceNo,
							paymentLinkUrl: `https://payments.irembopay.rw/pay/${iremboInvoiceNo}`
						}
					}),
					{ status: 201, headers: { 'content-type': 'application/json' } }
				)
			}
			if (url.includes('irembopay.test/payments/transactions/initiate')) {
				return new Response(JSON.stringify({ success: true, data: { transactionId: `TX-MOMO-${runTag}` } }), {
					status: 200,
					headers: { 'content-type': 'application/json' }
				})
			}
			return new Response('Not found', { status: 404 })
		}) as unknown as typeof fetch

		// Fallback check when offline FX upstream throws
		const fallbackFx = new UsdToRwfConverter({
			fxApiUrl: 'https://offline-fx.huriro.test/latest',
			fallbackRate: 1400,
			fetchImpl: (async () => {
				throw new Error('network unreachable')
			}) as unknown as typeof fetch,
			resolver: publicDnsResolver
		})
		const fallbackQuote = await fallbackFx.quoteProPlan(1000)
		expect(fallbackQuote.usdAmount).toBe(10)
		expect(fallbackQuote.rwfAmount).toBe(14000)
		expect(fallbackQuote.exchangeRateSource).toBe('fallback')

		const { app } = createIntegrationServer(db, {
			mode: 'cloud',
			egressFetch: fxFetch,
			egressResolver: publicDnsResolver,
			billing: {
				workspacePriceUsdCents: 1000,
				fxApiUrl: 'https://fx.huriro.test/latest',
				usdToRwfFallback: 1400,
				polarApiUrl: 'https://polar.test',
				polarAccessToken: 'polar_live_test_token',
				polarProductId: 'prod_huriro_10_usd',
				polarWebhookSecret: POLAR_WEBHOOK_SECRET,
				iremboPayApiUrl: 'https://irembopay.test',
				iremboPaySecretKey: 'irembo_secret_key',
				iremboPayWebhookSecret: IREMBOPAY_WEBHOOK_SECRET,
				iremboPayWebhookDelimiter: '#'
			}
		})

		// Usage snapshot + live FX quote ($10 USD -> 14,250 RWF)
		const count = await captureDailyBillingUsageOnce(db.app)
		expect(count).toBeGreaterThanOrEqual(2)

		const summaryRes = await apiRequest(app, {
			path: '/api/v1/billing/subscription',
			workspaceId: fx.workspaceId,
			userId: fx.ownerId
		})
		expect(summaryRes.status).toBe(200)
		const quote = summaryRes.json['quote'] as {
			usdAmount: number
			rwfAmount: number
			exchangeRateSource: string
		}
		expect(quote.usdAmount).toBe(10)
		expect(quote.rwfAmount).toBe(14250)
		expect(quote.exchangeRateSource).toBe('live')

		// Second call hits FX cache
		const summaryCached = await apiRequest(app, {
			path: '/api/v1/billing/subscription',
			workspaceId: fx.workspaceId,
			userId: fx.ownerId
		})
		expect((summaryCached.json['quote'] as { exchangeRateSource: string }).exchangeRateSource).toBe('cache')

		// Polar international $10 USD checkout + Standard Webhooks activation
		const polarCheckout = await apiRequest(app, {
			method: 'POST',
			path: '/api/v1/billing/checkout',
			workspaceId: fx.workspaceId,
			userId: fx.ownerId,
			headers: { 'idempotency-key': randomUUID() },
			body: {
				plan: 'pro',
				provider: 'polar',
				billingEmail: fx.ownerEmail,
				successUrl: 'https://app.huriro.test/settings?billing=success',
				cancelUrl: 'https://app.huriro.test/settings?billing=cancel'
			}
		})
		expect(polarCheckout.status).toBe(201)
		expect(polarCheckout.json['provider']).toBe('polar')
		expect(polarCheckout.json['currency']).toBe('USD')
		expect(polarCheckout.json['amount']).toBe(10)

		const polarPayload = JSON.stringify({
			type: 'subscription.active',
			data: {
				id: `sub_polar_${runTag}`,
				customer_id: `cus_polar_${runTag}`,
				external_customer_id: fx.workspaceId,
				status: 'active',
				amount: 1000,
				metadata: { workspace_id: fx.workspaceId },
				customer: { email: fx.ownerEmail }
			}
		})
		const badPolarHook = await app.handle(
			new Request('http://localhost/api/v1/billing/webhooks/polar', {
				method: 'POST',
				headers: new Headers({
					'content-type': 'application/json',
					'webhook-id': `msg_bad_${runTag}`,
					'webhook-timestamp': String(Math.floor(Date.now() / 1000)),
					'webhook-signature': 'v1,aW52YWxpZA=='
				}),
				body: polarPayload
			})
		)
		expect(badPolarHook.status).toBe(401)

		const polarWhHeaders = signPolarWebhook(polarPayload, `msg_polar_${runTag}`)
		const okPolarHook = await app.handle(
			new Request('http://localhost/api/v1/billing/webhooks/polar', {
				method: 'POST',
				headers: polarWhHeaders,
				body: polarPayload
			})
		)
		expect(okPolarHook.status).toBe(200)
		expect(await okPolarHook.json()).toEqual({ accepted: true, deduplicated: false })

		// Replay same webhook-id -> deduplicated
		const replayPolarHook = await app.handle(
			new Request('http://localhost/api/v1/billing/webhooks/polar', {
				method: 'POST',
				headers: polarWhHeaders,
				body: polarPayload
			})
		)
		expect(replayPolarHook.status).toBe(200)
		expect(await replayPolarHook.json()).toEqual({ accepted: true, deduplicated: true })

		// Polar portal succeeds after Polar customer exists
		const portalRes = await apiRequest(app, {
			method: 'POST',
			path: '/api/v1/billing/portal',
			workspaceId: fx.workspaceId,
			userId: fx.ownerId,
			body: { returnUrl: 'https://app.huriro.test/settings' }
		})
		expect(portalRes.status).toBe(200)
		expect(portalRes.json['url']).toBe(`https://polar.sh/portal/cus_${runTag}`)

		// Invalid Rwanda MoMo number fails 422 validation
		const badPhoneRes = await apiRequest(app, {
			method: 'POST',
			path: '/api/v1/billing/checkout',
			workspaceId: fx.workspaceId,
			userId: fx.ownerId,
			headers: { 'idempotency-key': randomUUID() },
			body: {
				plan: 'pro',
				provider: 'irembopay',
				paymentMethod: 'mtn_momo',
				phoneNumber: '1234567890',
				successUrl: 'https://app.huriro.test/settings?billing=success',
				cancelUrl: 'https://app.huriro.test/settings?billing=cancel'
			}
		})
		expect(badPhoneRes.status).toBe(422)

		// IremboPay Rwanda MTN Mobile Money checkout + USSD push + webhook
		const momoCheckout = await apiRequest(app, {
			method: 'POST',
			path: '/api/v1/billing/checkout',
			workspaceId: fx.otherWorkspaceId,
			userId: fx.otherTenantUserId,
			headers: { 'idempotency-key': randomUUID() },
			body: {
				plan: 'pro',
				provider: 'irembopay',
				paymentMethod: 'mtn_momo',
				phoneNumber: '0788123456',
				billingEmail: fx.otherTenantEmail,
				successUrl: 'https://app.huriro.test/settings?billing=success',
				cancelUrl: 'https://app.huriro.test/settings?billing=cancel'
			}
		})
		expect(momoCheckout.status).toBe(201)
		expect(momoCheckout.json['provider']).toBe('irembopay')
		expect(momoCheckout.json['currency']).toBe('RWF')
		expect(momoCheckout.json['amount']).toBe(14250)
		expect(momoCheckout.json['invoiceNumber']).toBe(iremboInvoiceNo)
		expect(momoCheckout.json['mobileMoneyPromptSent']).toBe(true)

		const iremboPayload = JSON.stringify({
			success: true,
			data: {
				invoiceNumber: iremboInvoiceNo,
				transactionId: `TX-MOMO-${runTag}`,
				amount: 14250,
				currency: 'RWF',
				paymentStatus: 'PAID',
				paymentMethod: 'MTN_MOMO',
				customer: { email: fx.otherTenantEmail, phoneNumber: '250788123456' }
			}
		})
		const badIremboHook = await app.handle(
			new Request('http://localhost/api/v1/billing/webhooks/irembopay', {
				method: 'POST',
				headers: {
					'content-type': 'application/json',
					'irembopay-signature': `t=${Date.now()},s=${'0'.repeat(64)}`
				},
				body: iremboPayload
			})
		)
		expect(badIremboHook.status).toBe(401)

		const okIremboHook = await app.handle(
			new Request('http://localhost/api/v1/billing/webhooks/irembopay', {
				method: 'POST',
				headers: {
					'content-type': 'application/json',
					'irembopay-signature': signIremboPayWebhook(iremboPayload)
				},
				body: iremboPayload
			})
		)
		expect(okIremboHook.status).toBe(200)
		expect(await okIremboHook.json()).toEqual({ accepted: true, deduplicated: false })

		const wsBSub = await apiRequest(app, {
			path: '/api/v1/billing/subscription',
			workspaceId: fx.otherWorkspaceId,
			userId: fx.otherTenantUserId
		})
		expect(wsBSub.status).toBe(200)
		const subObj = wsBSub.json['subscription'] as {
			plan: string
			status: string
			provider: string
			currency: string
			paymentMethod: string
		}
		expect(subObj.plan).toBe('pro')
		expect(subObj.status).toBe('active')
		expect(subObj.provider).toBe('irembopay')
		expect(subObj.currency).toBe('RWF')
		expect(subObj.paymentMethod).toBe('mtn_momo')
	})

	it('exports workspace JSON safely with sandbox CSP and erases user identity cleanly (GDPR)', async () => {
		if (!db) return
		const { app } = createIntegrationServer(db)

		// Non-owner cannot export
		const memberExport = await apiRequest(app, {
			method: 'POST',
			path: '/api/v1/governance/exports',
			workspaceId: fx.workspaceId,
			userId: fx.memberAId
		})
		expect(memberExport.status).toBe(403)

		// Owner creates & lists & downloads export
		const createExport = await apiRequest(app, {
			method: 'POST',
			path: '/api/v1/governance/exports',
			workspaceId: fx.workspaceId,
			userId: fx.ownerId
		})
		expect(createExport.status).toBe(201)
		const exportId = String(createExport.json['id'])

		const listExports = await apiRequest(app, {
			path: '/api/v1/governance/exports',
			workspaceId: fx.workspaceId,
			userId: fx.ownerId
		})
		expect(listExports.status).toBe(200)
		expect((listExports.json['data'] as { id: string }[]).some((e) => e.id === exportId)).toBe(true)

		const dlRes = await apiRequest(app, {
			path: `/api/v1/governance/exports/${exportId}/download`,
			workspaceId: fx.workspaceId,
			userId: fx.ownerId
		})
		expect(dlRes.status).toBe(200)
		expect(dlRes.res.headers.get('content-security-policy')).toBe('sandbox')
		expect(dlRes.res.headers.get('x-content-type-options')).toBe('nosniff')
		expect(dlRes.json['workspaceId']).toBe(fx.workspaceId)

		// Cross-tenant download denied (404)
		const otherDl = await apiRequest(app, {
			path: `/api/v1/governance/exports/${exportId}/download`,
			workspaceId: fx.otherWorkspaceId,
			userId: fx.otherTenantUserId
		})
		expect(otherDl.status).toBe(404)

		// Seed mobile push token for guest before self-erasure
		const guestTokenRes = await apiRequest(app, {
			method: 'POST',
			path: '/api/v1/notifications/push/mobile-tokens',
			workspaceId: fx.workspaceId,
			userId: fx.guestId,
			body: {
				token: 'ExponentPushToken[guest-to-erase]',
				platform: 'android',
				deviceId: 'android-device-guest-1'
			}
		})
		expect(guestTokenRes.status).toBe(201)

		// Wrong confirmEmail rejected with 422
		const badErase = await apiRequest(app, {
			method: 'POST',
			path: '/api/v1/governance/erase-me',
			userId: fx.guestId,
			email: fx.guestEmail,
			body: { confirmEmail: 'wrong@example.com' }
		})
		expect(badErase.status).toBe(422)

		// Matching confirmEmail anonymizes user, suspends memberships, revokes tokens
		const okErase = await apiRequest(app, {
			method: 'POST',
			path: '/api/v1/governance/erase-me',
			userId: fx.guestId,
			email: fx.guestEmail,
			body: { confirmEmail: fx.guestEmail }
		})
		expect(okErase.status).toBe(200)
		expect(okErase.json['erased']).toBe(true)
		expect(okErase.json['revokedWorkspaceIds']).toContain(fx.workspaceId)

		const [userRow] = await db.owner<{ email: string; display_name: string }[]>`
			SELECT email::text AS email, display_name FROM users WHERE id = ${fx.guestId}
		`
		expect(userRow?.display_name).toBe('Deleted user')
		expect(userRow?.email).toContain('@erased.invalid')

		const [membershipRow] = await db.owner<{ status: string }[]>`
			SELECT status FROM memberships WHERE user_id = ${fx.guestId} AND workspace_id = ${fx.workspaceId}
		`
		expect(membershipRow?.status).toBe('suspended')

		const remainingTokens = await db.owner<{ id: string }[]>`
			SELECT id FROM mobile_push_tokens WHERE user_id = ${fx.guestId}
		`
		expect(remainingTokens.length).toBe(0)
	})
})
