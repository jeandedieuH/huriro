/**
 * Agent credential model (§13.1a, §13.3): OAuth scopes carried by agent tokens
 * and the risk tiers that gate tool execution.
 *
 * Pure data + total functions — the effective-permission rule everywhere is
 *   token scopes ∩ principal scope ceiling ∩ owner's current role permissions
 * and this file owns the scope→Action half of that intersection; `can()` owns
 * the ceiling/role half.
 */
import type { Action } from './permissions'

/**
 * The closed set of scopes an agent credential may carry (§13.3). OIDC scopes
 * (`openid`, `profile`, `email`, `offline_access`) are allowed on the wire but
 * grant no workspace actions — `actionsForScopes` ignores them.
 */
export const AGENT_SCOPES = [
	'tasks.read',
	'tasks.write',
	'docs.read',
	'docs.write',
	'chat.read',
	'chat.write',
	'mail.read',
	'mail.write',
	'mail.draft',
	'search.read',
	'members.read',
	'availability.write'
] as const

export type AgentScope = (typeof AGENT_SCOPES)[number]

const agentScopeSet = new Set<string>(AGENT_SCOPES)
export function isAgentScope(value: string): value is AgentScope {
	return agentScopeSet.has(value)
}

/**
 * Scope → the workspace Actions it unlocks. Read scopes must never imply a
 * write action. `mail.draft` and `search.read` map to no Action — they gate
 * tools at the scope level only (mail ships in M5; search checks scopes at the
 * tool registry, not the permission layer).
 */
export const SCOPE_ACTIONS: Record<AgentScope, readonly Action[]> = {
	'tasks.read': ['project.read', 'issue.read'],
	'tasks.write': ['issue.read', 'issue.write', 'project.read'],
	'docs.read': ['doc.read'],
	'docs.write': ['doc.read', 'doc.comment', 'doc.write'],
	'chat.read': ['channel.read'],
	'chat.write': ['channel.read', 'channel.post'],
	'mail.read': ['mail.read'],
	'mail.write': ['mail.read', 'mail.assign'],
	'mail.draft': [],
	'search.read': [],
	'members.read': ['member.read'],
	// Self-scoped: the handler always targets the agent owner's own profile.
	'availability.write': []
}

/**
 * Effective Action set for an agent call:
 *   actionsForScopes(tokenScopes, principalCeilingScopes)
 * = mapped actions of every agent scope present in BOTH sets. Anything outside
 * AGENT_SCOPES (OIDC, unknown) is ignored, never an error — scope grants are
 * additive, unknown strings simply unlock nothing.
 */
export function actionsForScopes(
	scopes: readonly string[],
	ceilingScopes: readonly string[]
): ReadonlySet<Action> {
	const granted = new Set<Action>()
	for (const scope of ceilingScopes) {
		if (!isAgentScope(scope) || !scopes.includes(scope)) continue
		for (const action of SCOPE_ACTIONS[scope]) granted.add(action)
	}
	return granted
}

// ---------- risk tiers (§13.5) ----------

export const RISK_TIERS = ['R0', 'R1', 'R2', 'R3'] as const
export type RiskTier = (typeof RISK_TIERS)[number]

const TIER_RANK: Record<RiskTier, number> = { R0: 0, R1: 1, R2: 2, R3: 3 }

/**
 * A workspace admin may raise a tool's confirmation tier but never lower it
 * (§13.5). `R3` exists so privileged tools can be catalogued without ever
 * becoming executable by an agent.
 */
export function effectiveRisk(toolBaseTier: RiskTier, workspaceRaise?: RiskTier | null): RiskTier {
	const raise = workspaceRaise ?? 'R0'
	return TIER_RANK[raise] > TIER_RANK[toolBaseTier] ? raise : toolBaseTier
}

/** R3 tools are never exposed to agents — the registry refuses them (§13.5). */
export function isAgentExecutable(tier: RiskTier): boolean {
	return tier !== 'R3'
}
