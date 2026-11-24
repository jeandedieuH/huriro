import { createHmac, randomUUID, timingSafeEqual } from 'node:crypto'
import type { BillingPaymentMethod, CheckoutSessionDto } from '@huriro/contracts'
import { type DnsResolver, safeEgressFetch } from '../../api/egress'
import { HttpError } from '../../api/error'

export interface PolarCheckoutArgs {
	readonly workspaceId: string
	readonly productId: string
	readonly successUrl: string
	readonly customerId?: string | null | undefined
	readonly billingEmail?: string | null | undefined
	readonly usdCents: number
}

export interface PolarPortalArgs {
	readonly workspaceId: string
	readonly customerId?: string | null | undefined
	readonly returnUrl: string
}

export interface PolarBillingProvider {
	createCheckoutSession(args: PolarCheckoutArgs): Promise<CheckoutSessionDto>
	createPortalSession(args: PolarPortalArgs): Promise<{ url: string }>
	verifyWebhookSignature(rawBody: string, headers: Headers): boolean
}

export interface IremboPayCheckoutArgs {
	readonly workspaceId: string
	readonly rwfAmount: number
	readonly exchangeRateUsdToRwf: number
	readonly paymentMethod: Exclude<BillingPaymentMethod, 'card'>
	readonly phoneNumber?: string | null | undefined
	readonly billingEmail?: string | null | undefined
	readonly billingName?: string | null | undefined
	readonly successUrl: string
}

export interface IremboPayBillingProvider {
	createCheckoutSession(args: IremboPayCheckoutArgs): Promise<CheckoutSessionDto>
	verifyWebhookSignature(rawBody: string, signatureHeader: string | null | undefined): boolean
}

export interface PolarProviderOptions {
	readonly apiUrl?: string | undefined
	readonly accessToken?: string | undefined
	readonly webhookSecret?: string | undefined
	readonly fetchImpl?: typeof fetch | undefined
	readonly resolver?: DnsResolver | undefined
}

export interface IremboPayProviderOptions {
	readonly apiUrl?: string | undefined
	readonly secretKey?: string | undefined
	readonly webhookSecret?: string | undefined
	readonly webhookDelimiter?: '#' | '.' | undefined
	readonly paymentAccountId?: string | undefined
	readonly productCode?: string | undefined
	readonly fetchImpl?: typeof fetch | undefined
	readonly resolver?: DnsResolver | undefined
}

function constantTimeEqualsBuf(a: Buffer, b: Buffer): boolean {
	return a.length > 0 && a.length === b.length && timingSafeEqual(a, b)
}

/**
 * Verifies Polar webhooks implementing the Standard Webhooks HMAC-SHA256
 * specification (`webhook-id`, `webhook-timestamp`, `webhook-signature`).
 */
export function verifyPolarStandardWebhook(
	secret: string,
	rawBody: string,
	headers: Headers,
	maxSkewSec = 300,
	nowSec = Math.floor(Date.now() / 1000)
): boolean {
	if (!secret) return false
	const webhookId = headers.get('webhook-id')?.trim() ?? ''
	const webhookTsRaw = headers.get('webhook-timestamp')?.trim() ?? ''
	const webhookSigRaw = headers.get('webhook-signature')?.trim() ?? ''
	if (!webhookId || !webhookTsRaw || !webhookSigRaw) return false

	const ts = Number.parseInt(webhookTsRaw, 10)
	if (!Number.isFinite(ts) || Math.abs(nowSec - ts) > maxSkewSec) return false

	const signedContent = `${webhookId}.${webhookTsRaw}.${rawBody}`
	const secretCandidates: Buffer[] = [Buffer.from(secret, 'utf8')]
	if (secret.startsWith('whsec_') || secret.startsWith('polar_whs_')) {
		const rawKey = secret.startsWith('whsec_')
			? secret.slice('whsec_'.length)
			: secret.slice('polar_whs_'.length)
		const decoded = Buffer.from(rawKey, 'base64')
		if (decoded.length > 0) secretCandidates.push(decoded)
	}

	const sigEntries = webhookSigRaw
		.split(/\s+/)
		.map((entry) => entry.trim())
		.filter((entry) => entry.startsWith('v1,'))
		.map((entry) => entry.slice(3))
	if (sigEntries.length === 0) return false

	for (const keyBuf of secretCandidates) {
		const expected = createHmac('sha256', keyBuf).update(signedContent, 'utf8').digest()
		for (const b64Sig of sigEntries) {
			const provided = Buffer.from(b64Sig, 'base64')
			if (constantTimeEqualsBuf(expected, provided)) return true
		}
	}
	return false
}

/**
 * Verifies IremboPay `irembopay-signature` (`t=<epoch>,s=<hex-hmac-sha256>`).
 */
export function verifyIremboPayHmac(
	secret: string,
	signatureHeader: string | null | undefined,
	rawBody: string,
	delimiter: '#' | '.' = '#',
	maxSkewSec = 300,
	nowSec = Math.floor(Date.now() / 1000)
): boolean {
	if (!secret || !signatureHeader) return false
	let tRaw = ''
	let sHex = ''
	for (const part of signatureHeader.split(',')) {
		const eqIdx = part.indexOf('=')
		if (eqIdx === -1) continue
		const k = part.slice(0, eqIdx).trim()
		const v = part.slice(eqIdx + 1).trim()
		if (k === 't') tRaw = v
		else if (k === 's') sHex = v
	}
	if (!tRaw || !sHex || !/^[0-9a-f]{64}$/i.test(sHex)) return false

	const parsedTs = Number.parseInt(tRaw, 10)
	if (!Number.isFinite(parsedTs)) return false
	const tsSec = parsedTs > 1_000_000_000_000 ? Math.floor(parsedTs / 1000) : parsedTs
	if (Math.abs(nowSec - tsSec) > maxSkewSec) return false

	const signedPayload = `${tRaw}${delimiter}${rawBody}`
	const expected = createHmac('sha256', secret).update(signedPayload, 'utf8').digest()
	const provided = Buffer.from(sHex, 'hex')
	return constantTimeEqualsBuf(expected, provided)
}

export function createPolarBillingProvider(opts: PolarProviderOptions): PolarBillingProvider {
	const apiUrl = (opts.apiUrl ?? 'https://api.polar.sh').replace(/\/$/, '')

	return {
		async createCheckoutSession(args) {
			if (!opts.accessToken) {
				throw new HttpError(503, 'not_implemented', 'Polar billing access token is not configured')
			}
			const payload: Record<string, unknown> = {
				products: [args.productId],
				external_customer_id: args.workspaceId,
				success_url: args.successUrl,
				metadata: {
					workspace_id: args.workspaceId,
					plan: 'pro'
				}
			}
			if (args.customerId) {
				payload['customer_id'] = args.customerId
			} else if (args.billingEmail) {
				payload['customer_email'] = args.billingEmail
			}

			const res = await safeEgressFetch(`${apiUrl}/v1/checkouts/`, {
				method: 'POST',
				headers: {
					authorization: `Bearer ${opts.accessToken}`,
					'content-type': 'application/json'
				},
				body: JSON.stringify(payload),
				timeoutMs: 8_000,
				maxBytes: 131_072,
				...(opts.fetchImpl ? { fetcher: opts.fetchImpl } : {}),
				...(opts.resolver ? { resolver: opts.resolver } : {})
			})
			const body = JSON.parse(new TextDecoder().decode(res.bodyBytes)) as {
				id?: string
				url?: string
				detail?: unknown
			}
			if (res.status < 200 || res.status >= 300 || !body.id || !body.url) {
				throw new HttpError(502, 'internal', 'Failed to create Polar checkout session')
			}
			return {
				provider: 'polar',
				sessionId: body.id,
				url: body.url,
				currency: 'USD',
				amount: Number((args.usdCents / 100).toFixed(2)),
				exchangeRateUsdToRwf: null,
				paymentMethod: 'card',
				invoiceNumber: null,
				mobileMoneyPromptSent: false,
				instructions: 'Complete card or international payment on Polar hosted checkout.'
			}
		},

		async createPortalSession(args) {
			if (!opts.accessToken) {
				throw new HttpError(503, 'not_implemented', 'Polar billing access token is not configured')
			}
			const payload = args.customerId
				? { customer_id: args.customerId, return_url: args.returnUrl }
				: { external_customer_id: args.workspaceId, return_url: args.returnUrl }

			const res = await safeEgressFetch(`${apiUrl}/v1/customer-sessions/`, {
				method: 'POST',
				headers: {
					authorization: `Bearer ${opts.accessToken}`,
					'content-type': 'application/json'
				},
				body: JSON.stringify(payload),
				timeoutMs: 8_000,
				maxBytes: 65_536,
				...(opts.fetchImpl ? { fetcher: opts.fetchImpl } : {}),
				...(opts.resolver ? { resolver: opts.resolver } : {})
			})
			const body = JSON.parse(new TextDecoder().decode(res.bodyBytes)) as {
				customer_portal_url?: string
			}
			if (res.status < 200 || res.status >= 300 || !body.customer_portal_url) {
				throw new HttpError(502, 'internal', 'Failed to create Polar customer portal session')
			}
			return { url: body.customer_portal_url }
		},

		verifyWebhookSignature(rawBody, headers) {
			if (!opts.webhookSecret) return false
			return verifyPolarStandardWebhook(opts.webhookSecret, rawBody, headers)
		}
	}
}

export function createIremboPayBillingProvider(opts: IremboPayProviderOptions): IremboPayBillingProvider {
	const apiUrl = (opts.apiUrl ?? 'https://api.irembopay.com').replace(/\/$/, '')
	const delimiter = opts.webhookDelimiter ?? '#'

	return {
		async createCheckoutSession(args) {
			if (!opts.secretKey) {
				throw new HttpError(503, 'not_implemented', 'IremboPay secret key is not configured')
			}
			const transactionId = `HURIRO-${randomUUID()}`
			const invoicePayload: Record<string, unknown> = {
				transactionId,
				paymentAccountIdentifier: opts.paymentAccountId ?? 'HURIRO-DEFAULT',
				customer: {
					email: args.billingEmail ?? 'billing@huriro.local',
					name: args.billingName ?? 'Huriro Workspace',
					...(args.phoneNumber ? { phoneNumber: args.phoneNumber } : {})
				},
				paymentItems: [
					{
						unitAmount: args.rwfAmount,
						quantity: 1,
						code: opts.productCode ?? 'HURIRO_CLOUD_PRO'
					}
				],
				description: `Huriro Cloud Workspace ($10 USD = ${args.rwfAmount.toLocaleString('en-US')} RWF)`,
				currency: 'RWF',
				language: 'EN',
				returnUrl: args.successUrl
			}

			const invoiceRes = await safeEgressFetch(`${apiUrl}/payments/invoices`, {
				method: 'POST',
				headers: {
					'irembopay-secretkey': opts.secretKey,
					'x-api-version': '2',
					'content-type': 'application/json'
				},
				body: JSON.stringify(invoicePayload),
				timeoutMs: 8_000,
				maxBytes: 131_072,
				...(opts.fetchImpl ? { fetcher: opts.fetchImpl } : {}),
				...(opts.resolver ? { resolver: opts.resolver } : {})
			})
			const invoiceBody = JSON.parse(new TextDecoder().decode(invoiceRes.bodyBytes)) as {
				data?: {
					invoiceNumber?: string
					paymentLinkUrl?: string
				}
				invoiceNumber?: string
				paymentLinkUrl?: string
			}
			const invoiceNumber = invoiceBody.data?.invoiceNumber ?? invoiceBody.invoiceNumber ?? null
			const paymentLinkUrl = invoiceBody.data?.paymentLinkUrl ?? invoiceBody.paymentLinkUrl ?? null
			if (invoiceRes.status < 200 || invoiceRes.status >= 300 || !invoiceNumber) {
				throw new HttpError(502, 'internal', 'Failed to create IremboPay invoice')
			}

			let mobileMoneyPromptSent = false
			let instructions =
				paymentLinkUrl !== null
					? 'Complete payment via the IremboPay web checkout link.'
					: `Invoice ${invoiceNumber} created.`

			if ((args.paymentMethod === 'mtn_momo' || args.paymentMethod === 'airtel_money') && args.phoneNumber) {
				const mobileProvider = args.paymentMethod === 'mtn_momo' ? 'MTN' : 'AIRTEL'
				try {
					const pushRes = await safeEgressFetch(`${apiUrl}/payments/transactions/initiate`, {
						method: 'POST',
						headers: {
							'irembopay-secretkey': opts.secretKey,
							'x-api-version': '2',
							'content-type': 'application/json'
						},
						body: JSON.stringify({
							accountIdentifier: args.phoneNumber,
							paymentProvider: mobileProvider,
							invoiceNumber
						}),
						timeoutMs: 8_000,
						maxBytes: 65_536,
						...(opts.fetchImpl ? { fetcher: opts.fetchImpl } : {}),
						...(opts.resolver ? { resolver: opts.resolver } : {})
					})
					if (pushRes.status >= 200 && pushRes.status < 300) {
						mobileMoneyPromptSent = true
						const label = args.paymentMethod === 'mtn_momo' ? 'MTN Mobile Money' : 'Airtel Money'
						instructions = `A ${label} USSD prompt for ${args.rwfAmount.toLocaleString('en-US')} RWF has been sent to ${args.phoneNumber}. Enter your MoMo PIN to confirm.`
					}
				} catch {
					// Fall back to hosted web payment link if USSD initiation temporarily fails.
				}
			}

			return {
				provider: 'irembopay',
				sessionId: invoiceNumber,
				url: paymentLinkUrl,
				currency: 'RWF',
				amount: args.rwfAmount,
				exchangeRateUsdToRwf: args.exchangeRateUsdToRwf,
				paymentMethod: args.paymentMethod,
				invoiceNumber,
				mobileMoneyPromptSent,
				instructions
			}
		},

		verifyWebhookSignature(rawBody, signatureHeader) {
			if (!opts.webhookSecret) return false
			return verifyIremboPayHmac(opts.webhookSecret, signatureHeader, rawBody, delimiter)
		}
	}
}
