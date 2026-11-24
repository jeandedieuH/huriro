import type { BillingPriceQuoteDto } from '@huriro/contracts'
import { type DnsResolver, safeEgressFetch } from '../../api/egress'
import { HttpError } from '../../api/error'

export interface FxRateResult {
	readonly rate: number
	readonly source: 'live' | 'cache' | 'fallback'
	readonly fetchedAt: string
}

export interface FxConverterOptions {
	readonly fxApiUrl?: string | undefined
	readonly fallbackRate?: number | undefined
	readonly cacheTtlMs?: number | undefined
	readonly fetchImpl?: typeof fetch | undefined
	readonly resolver?: DnsResolver | undefined
}

const DEFAULT_FX_API_URL = 'https://open.er-api.com/v6/latest/USD'
const DEFAULT_FALLBACK_RWF_RATE = 1400
const DEFAULT_CACHE_TTL_MS = 6 * 60 * 60 * 1000

export function convertUsdCentsToRwf(usdCents: number, usdToRwfRate: number): number {
	return Math.max(1, Math.round((usdCents / 100) * usdToRwfRate))
}

/**
 * Normalizes Rwandan phone numbers (MTN 078/079 and Airtel 072/073) to
 * canonical `2507xxxxxxxx` 12-digit MSISDN format expected by local gateways.
 */
export function normalizeRwandaPhone(raw: string): string {
	const cleaned = raw.replace(/[\s()-]/g, '').replace(/^\+/, '')
	const normalized = cleaned.startsWith('07') && cleaned.length === 10 ? `250${cleaned.slice(1)}` : cleaned
	if (!/^2507[2389]\d{7}$/.test(normalized)) {
		throw new HttpError(
			422,
			'validation_failed',
			'Invalid Rwandan Mobile Money number',
			'Enter a valid MTN (078/079) or Airtel (072/073) Rwanda number.'
		)
	}
	return normalized
}

export class UsdToRwfConverter {
	private readonly fxApiUrl: string
	private readonly fallbackRate: number
	private readonly cacheTtlMs: number
	private readonly fetchImpl: typeof fetch | undefined
	private readonly resolver: DnsResolver | undefined
	private cached: { rate: number; fetchedAtMs: number; fetchedAtIso: string } | null = null

	constructor(opts: FxConverterOptions = {}) {
		this.fxApiUrl = opts.fxApiUrl ?? DEFAULT_FX_API_URL
		this.fallbackRate = opts.fallbackRate ?? DEFAULT_FALLBACK_RWF_RATE
		this.cacheTtlMs = opts.cacheTtlMs ?? DEFAULT_CACHE_TTL_MS
		this.fetchImpl = opts.fetchImpl
		this.resolver = opts.resolver
	}

	async getUsdToRwfRate(nowMs = Date.now()): Promise<FxRateResult> {
		if (this.cached && nowMs - this.cached.fetchedAtMs < this.cacheTtlMs) {
			return {
				rate: this.cached.rate,
				source: 'cache',
				fetchedAt: this.cached.fetchedAtIso
			}
		}

		try {
			const res = await safeEgressFetch(this.fxApiUrl, {
				method: 'GET',
				headers: { accept: 'application/json' },
				timeoutMs: 5_000,
				maxBytes: 262_144,
				...(this.fetchImpl ? { fetcher: this.fetchImpl } : {}),
				...(this.resolver ? { resolver: this.resolver } : {})
			})
			if (res.status >= 200 && res.status < 300) {
				const body = JSON.parse(new TextDecoder().decode(res.bodyBytes)) as {
					rates?: { RWF?: unknown }
					conversion_rates?: { RWF?: unknown }
				}
				const candidate = Number(body.rates?.RWF ?? body.conversion_rates?.RWF)
				if (Number.isFinite(candidate) && candidate > 100 && candidate < 100_000) {
					const fetchedAtIso = new Date(nowMs).toISOString()
					this.cached = { rate: candidate, fetchedAtMs: nowMs, fetchedAtIso }
					return { rate: candidate, source: 'live', fetchedAt: fetchedAtIso }
				}
			}
		} catch {
			// Fall back to cached or configured fallback rate when offline / upstream unreachable.
		}

		if (this.cached) {
			return {
				rate: this.cached.rate,
				source: 'cache',
				fetchedAt: this.cached.fetchedAtIso
			}
		}

		return {
			rate: this.fallbackRate,
			source: 'fallback',
			fetchedAt: new Date(nowMs).toISOString()
		}
	}

	async quoteProPlan(usdCents: number): Promise<BillingPriceQuoteDto> {
		const fx = await this.getUsdToRwfRate()
		return {
			plan: 'pro',
			usdCents,
			usdAmount: Number((usdCents / 100).toFixed(2)),
			rwfAmount: convertUsdCentsToRwf(usdCents, fx.rate),
			exchangeRateUsdToRwf: Number(fx.rate.toFixed(2)),
			exchangeRateSource: fx.source,
			exchangeRateFetchedAt: fx.fetchedAt
		}
	}
}
