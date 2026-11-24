/**
 * Agent principal resolution (§13.1a, §13.3). The ONLY constructor of a
 * kind:'agent' ActorContext — called by the REST agent surface now and by
 * /mcp in stage 3.
 *
 * Effective permission is re-resolved EVERY call from three live sources:
 *   token scopes ∩ principal.scope_ceiling ∩ owner's CURRENT membership/role
 * so revocation, suspension, and role changes take effect on the next call —
 * never trusting stale claims (§13.2 confused-deputy defense).
 */
import type { Queryable } from '@huriro/db'
import { type Action, type ActorContext, actionsForScopes, isAgentScope } from '@huriro/domain'
import { HttpError } from '../../api/error'
import type { VerifiedAgentCredential } from '../identity'
import { HURIRO_CLI_CLIENT_ID } from '../identity'
import {
	getPrincipalByClient,
	getPrincipalById,
	insertPrincipal,
	resolveOwnerActor,
	touchLastActive
} from './repo'

export interface ResolvedAgent {
	readonly actor: ActorContext
	readonly principal: {
		readonly id: string
		readonly name: string
		readonly kind: string
		readonly ownerUserId: string
		readonly scopeCeiling: readonly string[]
		readonly tierOverrides: Record<string, string>
		readonly requireApprovalAllWrites: boolean
	}
	readonly credential: VerifiedAgentCredential
	/** Agent scopes present in both the token and the ceiling. */
	readonly effectiveScopes: readonly string[]
}

/**
 * Resolve (or lazily connect) the principal for a verified credential and
 * produce its ActorContext for this workspace. Throws problem+json 401/403.
 */
export async function resolveAgentActor(
	tx: Queryable,
	credential: VerifiedAgentCredential,
	workspaceId: string,
	requestId?: string
): Promise<ResolvedAgent> {
	// API-key credentials carry their bound principal (ADR-0021); OAuth tokens
	// resolve by (owner, clientId). Both are re-read live every call.
	let principal = credential.principalId
		? await getPrincipalById(tx, workspaceId, credential.principalId)
		: await getPrincipalByClient(tx, workspaceId, credential.userId, credential.clientId)

	if (!principal) {
		// First-party huriro-cli lazily auto-connects (§13.1a): an owner who is
		// an active member gets an 'automation' principal with ceiling = token
		// scopes. Any other client must go through connect/consent first.
		if (credential.clientId === HURIRO_CLI_CLIENT_ID && !credential.principalId) {
			const ownerActor = await resolveOwnerActor(tx, workspaceId, credential.userId, requestId)
			if (ownerActor.membership !== 'active') {
				throw new HttpError(403, 'not_workspace_member', 'Owner is not an active workspace member')
			}
			const ownerName = await ownerDisplayName(tx, credential.userId)
			const ceiling = credential.scopes.filter(isAgentScope)
			principal = await insertPrincipal(tx, {
				workspaceId,
				ownerUserId: credential.userId,
				oauthClientId: credential.clientId,
				kind: 'automation',
				name: `CLI · ${ownerName}`,
				scopeCeiling: ceiling
			})
		} else {
			throw new HttpError(
				403,
				'agent_not_connected',
				'Agent is not connected to this workspace',
				'Connect the agent via consent or POST /api/v1/agents first'
			)
		}
	}

	if (principal.status === 'suspended') {
		throw new HttpError(403, 'agent_suspended', 'Agent principal is suspended')
	}
	if (principal.status === 'revoked') {
		throw new HttpError(403, 'agent_revoked', 'Agent principal is revoked')
	}

	// Owner state is re-resolved live — never from the token (§13.2).
	const ownerActor = await resolveOwnerActor(tx, workspaceId, principal.ownerUserId, requestId)
	if (ownerActor.membership === 'suspended') {
		throw new HttpError(403, 'not_workspace_member', 'Agent owner membership is suspended')
	}
	if (ownerActor.membership !== 'active') {
		throw new HttpError(403, 'not_workspace_member', 'Agent owner is not an active member')
	}

	const effectiveScopes = credential.scopes.filter(
		(s) => isAgentScope(s) && principal.scopeCeiling.includes(s)
	)
	const ceilingActions = actionsForScopes(credential.scopes, principal.scopeCeiling) as ReadonlySet<Action>

	const actor: ActorContext = {
		principalId: principal.id,
		userId: principal.ownerUserId,
		agentId: principal.id,
		workspaceId,
		kind: 'agent',
		membership: ownerActor.membership,
		roleKey: ownerActor.roleKey,
		roleRank: ownerActor.roleRank,
		permissions: ownerActor.permissions,
		agentScopeCeiling: ceilingActions,
		requestId
	}

	await touchLastActive(tx, workspaceId, principal.id)

	return { actor, principal, credential, effectiveScopes }
}

async function ownerDisplayName(tx: Queryable, userId: string): Promise<string> {
	const rows = await tx<
		{ n: string }[]
	>`SELECT COALESCE(NULLIF(display_name,''), email::text) AS n FROM users WHERE id = ${userId}`
	return String(rows[0]?.['n'] ?? 'agent')
}
