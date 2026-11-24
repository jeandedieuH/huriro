/**
 * Agent authorization + risk policy (§13.3, §13.5): scope check, tier math,
 * per-principal/per-tool token buckets, and a rolling per-credential
 * read-volume cap. Pure/in-process — single-node default (ADR-0019 note on
 * shared state applies here too).
 */

import type { ToolSpec } from '@huriro/agent-tools'
import type { RiskTier } from '@huriro/domain'
import { effectiveRisk } from '@huriro/domain'
import { HttpError } from '../../api/error'

export interface PrincipalPolicyRow {
	readonly scopeCeiling: readonly string[]
	readonly tierOverrides: Record<string, string>
	readonly requireApprovalAllWrites: boolean
}

/** Scope gate: 'any' tools pass; otherwise the scope must be in token ∩ ceiling. */
export function assertToolScope(
	tool: ToolSpec,
	tokenScopes: readonly string[],
	effectiveScopes: readonly string[]
): void {
	if (tool.scope === 'any') return
	if (!tokenScopes.includes(tool.scope) || !effectiveScopes.includes(tool.scope)) {
		throw new HttpError(
			403,
			'insufficient_scope',
			`Tool ${tool.name} requires the ${tool.scope} scope`,
			'Request a token with this scope and ensure the principal ceiling includes it',
			{ requiredScope: tool.scope },
			{
				'WWW-Authenticate': `Bearer error="insufficient_scope", scope="${tool.scope}"`
			}
		)
	}
}

const TIER_RANK: Record<RiskTier, number> = { R0: 0, R1: 1, R2: 2, R3: 3 }

/**
 * Effective tier for a concrete call: base tier (+input-dependent raise, e.g.
 * bulk size) → workspace per-tool raise → require_approval_all_writes raises
 * every write to R2. Raises only — nothing here can lower a tier (§13.5).
 */
export function toolTierForCall(
	tool: ToolSpec,
	input: unknown,
	principal: PrincipalPolicyRow
): { readonly requested: RiskTier; readonly effective: RiskTier } {
	const requested = tool.tierForInput?.(input) ?? tool.tier
	const raise = (principal.tierOverrides[tool.name] as RiskTier | undefined) ?? null
	let effective = effectiveRisk(requested, raise)
	if (principal.requireApprovalAllWrites && tool.kind === 'write' && TIER_RANK[effective] < 2) {
		effective = 'R2'
	}
	return { requested, effective }
}

/** Validate a tier_overrides patch: raise-only relative to tool base tiers. */
export function assertRaiseOnlyTierOverrides(
	overrides: Record<string, string>,
	resolveBaseTier: (toolName: string) => RiskTier | undefined
): void {
	for (const [toolName, tier] of Object.entries(overrides)) {
		const base = resolveBaseTier(toolName)
		if (!base) throw new HttpError(422, 'validation_failed', `Unknown tool in tier_overrides: ${toolName}`)
		if (!(tier in TIER_RANK)) {
			throw new HttpError(422, 'validation_failed', `Invalid tier for ${toolName}: ${tier}`)
		}
		if (TIER_RANK[tier as RiskTier] < TIER_RANK[base]) {
			throw new HttpError(
				422,
				'validation_failed',
				`tier_overrides may only raise ${toolName} (base ${base}), got ${tier}`
			)
		}
	}
}

// ---------- rate limiting (§13.7) ----------

interface Bucket {
	tokens: number
	refillAt: number
	inFlight: number
}

export interface AgentRateLimits {
	readonly callsPerMinute: number
	readonly maxConcurrent: number
	/** Result bytes a credential may read per rolling hour. */
	readonly readBytesPerHour: number
}

export const DEFAULT_AGENT_RATE_LIMITS: AgentRateLimits = {
	callsPerMinute: 60,
	maxConcurrent: 4,
	readBytesPerHour: 5 * 1024 * 1024
}

export class AgentRateLimiter {
	private readonly buckets = new Map<string, Bucket>()
	private readonly volumes = new Map<string, { windowStart: number; bytes: number }>()
	private readonly limits: AgentRateLimits

	constructor(limits: AgentRateLimits = DEFAULT_AGENT_RATE_LIMITS) {
		this.limits = limits
	}

	/** Consume one call slot; throws 429 tool_rate_limited with Retry-After. */
	acquire(key: string): { readonly release: () => void } {
		const now = Date.now()
		let b = this.buckets.get(key)
		if (!b || now >= b.refillAt) {
			b = { tokens: this.limits.callsPerMinute, refillAt: now + 60_000, inFlight: b?.inFlight ?? 0 }
			this.buckets.set(key, b)
		}
		if (b.inFlight >= this.limits.maxConcurrent || b.tokens <= 0) {
			const retryAfter = Math.max(1, Math.ceil((b.refillAt - now) / 1000))
			throw new HttpError(429, 'tool_rate_limited', 'Agent tool rate limit exceeded', undefined, undefined, {
				'Retry-After': String(retryAfter)
			})
		}
		b.tokens--
		b.inFlight++
		return {
			release: () => {
				b.inFlight = Math.max(0, b.inFlight - 1)
			}
		}
	}

	/** Account result bytes read; over the rolling-hour cap → 429. */
	chargeRead(key: string, bytes: number): void {
		const now = Date.now()
		let v = this.volumes.get(key)
		if (!v || now - v.windowStart >= 3_600_000) {
			v = { windowStart: now, bytes: 0 }
			this.volumes.set(key, v)
		}
		if (v.bytes + bytes > this.limits.readBytesPerHour) {
			const retryAfter = Math.ceil((v.windowStart + 3_600_000 - now) / 1000)
			throw new HttpError(
				429,
				'tool_rate_limited',
				'Agent read-volume cap exceeded (hourly)',
				undefined,
				{ limitBytes: this.limits.readBytesPerHour },
				{ 'Retry-After': String(retryAfter) }
			)
		}
		v.bytes += bytes
	}
}

/** Process-wide singleton — one bucket set per node (single-node default). */
export const agentRateLimiter = new AgentRateLimiter({
	callsPerMinute: Number(process.env['AGENT_CALLS_PER_MINUTE']) || DEFAULT_AGENT_RATE_LIMITS.callsPerMinute,
	maxConcurrent: Number(process.env['AGENT_MAX_CONCURRENT']) || DEFAULT_AGENT_RATE_LIMITS.maxConcurrent,
	readBytesPerHour:
		Number(process.env['AGENT_READ_BYTES_PER_HOUR']) || DEFAULT_AGENT_RATE_LIMITS.readBytesPerHour
})
