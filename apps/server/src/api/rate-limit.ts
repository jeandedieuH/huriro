/**
 * In-memory fixed/sliding-window API rate limiter (§19, M6 hardening).
 *
 * Bounded memory: sweeps expired buckets lazily when the map exceeds
 * `maxTrackedKeys`, preventing unbounded memory growth under IP-spray attacks.
 */

export interface RateLimitResult {
	readonly allowed: boolean
	readonly limit: number
	readonly remaining: number
	readonly resetSeconds: number
}

interface Bucket {
	count: number
	resetAtMs: number
}

export class ApiRateLimiter {
	private readonly limit: number
	private readonly windowMs: number
	private readonly maxTrackedKeys: number
	private readonly buckets = new Map<string, Bucket>()

	constructor(opts?: {
		readonly limitPerMinute?: number | undefined
		readonly windowMs?: number | undefined
		readonly maxTrackedKeys?: number | undefined
	}) {
		this.limit = Math.max(1, opts?.limitPerMinute ?? 600)
		this.windowMs = opts?.windowMs ?? 60_000
		this.maxTrackedKeys = opts?.maxTrackedKeys ?? 10_000
	}

	check(key: string, nowMs = Date.now()): RateLimitResult {
		const current = this.buckets.get(key)
		if (!current || current.resetAtMs <= nowMs) {
			if (this.buckets.size >= this.maxTrackedKeys) {
				for (const [k, b] of this.buckets.entries()) {
					if (b.resetAtMs <= nowMs) this.buckets.delete(k)
				}
				if (this.buckets.size >= this.maxTrackedKeys) {
					const oldestKey = this.buckets.keys().next().value
					if (oldestKey !== undefined) this.buckets.delete(oldestKey)
				}
			}
			const next: Bucket = { count: 1, resetAtMs: nowMs + this.windowMs }
			this.buckets.set(key, next)
			return {
				allowed: true,
				limit: this.limit,
				remaining: Math.max(0, this.limit - 1),
				resetSeconds: Math.max(1, Math.ceil(this.windowMs / 1000))
			}
		}

		current.count += 1
		const resetSeconds = Math.max(1, Math.ceil((current.resetAtMs - nowMs) / 1000))
		if (current.count > this.limit) {
			return {
				allowed: false,
				limit: this.limit,
				remaining: 0,
				resetSeconds
			}
		}
		return {
			allowed: true,
			limit: this.limit,
			remaining: Math.max(0, this.limit - current.count),
			resetSeconds
		}
	}

	clear(): void {
		this.buckets.clear()
	}
}
