/**
 * Docs module authorization helpers (§7.3, §10.3, §12.3).
 * Delegates all permission math to the pure policy function `@huriro/domain.can()`.
 */
import type { TeamspaceRole, TeamspaceVisibility } from '@huriro/contracts'
import type { Queryable } from '@huriro/db'
import {
	type AclLevel,
	type Action,
	type ActorContext,
	ADMIN_BYPASS_RANK,
	aclSatisfies,
	can
} from '@huriro/domain'
import { HttpError } from '../../api/error'

export function isAdminDocBypass(actor: ActorContext): boolean {
	return (
		actor.roleKey !== 'guest' &&
		actor.membership === 'active' &&
		(actor.roleRank >= ADMIN_BYPASS_RANK || actor.permissions.has('doc.share'))
	)
}

export function isAdminTeamspaceBypass(actor: ActorContext): boolean {
	return (
		actor.roleKey !== 'guest' &&
		actor.membership === 'active' &&
		(actor.roleRank >= ADMIN_BYPASS_RANK || actor.permissions.has('teamspace.manage'))
	)
}

function teamspaceRoleToAcl(role: TeamspaceRole | null): AclLevel | null {
	if (role === 'owner') return 'manage'
	if (role === 'member') return 'write'
	if (role === 'viewer') return 'read'
	return null
}

function higherAcl(a: AclLevel | null, b: AclLevel | null): AclLevel | null {
	if (!a) return b
	if (!b) return a
	return aclSatisfies(a, b) ? a : b
}

export async function authorizeTeamspace(
	tx: Queryable,
	actor: ActorContext,
	action: Action,
	teamspace: { readonly id: string; readonly visibility: TeamspaceVisibility },
	acl: AclLevel | null,
	memberRole: TeamspaceRole | null
): Promise<void> {
	const effectiveAcl = higherAcl(acl, teamspaceRoleToAcl(memberRole))
	const decision = can(actor, action, {
		type: 'teamspace',
		id: teamspace.id,
		visibility: teamspace.visibility === 'private' ? 'private' : 'workspace',
		acl: effectiveAcl
	})
	if (decision.effect === 'deny') {
		if (decision.reason === 'not_member' || decision.reason === 'suspended') {
			throw new HttpError(403, 'not_workspace_member', 'Active workspace membership is required')
		}
		if (decision.reason === 'no_acl') {
			throw new HttpError(403, 'resource_private', 'Private teamspace access denied')
		}
		if (decision.reason === 'agent_scope') {
			throw new HttpError(403, 'agent_scope_exceeded', 'Action exceeds agent scope ceiling')
		}
		throw new HttpError(403, 'insufficient_role', `Missing permission for ${action}`)
	}

	if (decision.auditedBypass) {
		await tx`
			INSERT INTO audit_log (workspace_id, actor_type, actor_id, action, target_type, target_id, metadata)
			VALUES (
				${actor.workspaceId},
				${actor.kind === 'agent' ? 'agent' : 'user'},
				${actor.principalId},
				${`policy.admin_bypass.${action}`},
				'teamspace',
				${teamspace.id},
				${tx.json({ reason: 'admin_bypass', requestId: actor.requestId ?? null })}
			)
		`
	}
}

export function canActorDocPage(
	actor: ActorContext,
	action: Action,
	page: { readonly id: string; readonly visibility: 'workspace' | 'private' },
	acl: AclLevel | null
): boolean {
	const decision = can(actor, action, {
		type: 'doc_page',
		id: page.id,
		visibility: page.visibility,
		acl
	})
	return decision.effect === 'allow'
}

export async function authorizeDocPage(
	tx: Queryable,
	actor: ActorContext,
	action: Action,
	page: { readonly id: string; readonly visibility: 'workspace' | 'private' },
	acl: AclLevel | null
): Promise<void> {
	const decision = can(actor, action, {
		type: 'doc_page',
		id: page.id,
		visibility: page.visibility,
		acl
	})
	if (decision.effect === 'deny') {
		if (decision.reason === 'not_member' || decision.reason === 'suspended') {
			throw new HttpError(403, 'not_workspace_member', 'Active workspace membership is required')
		}
		if (decision.reason === 'no_acl') {
			throw new HttpError(403, 'resource_private', 'Private document access denied')
		}
		if (decision.reason === 'agent_scope') {
			throw new HttpError(403, 'agent_scope_exceeded', 'Action exceeds agent scope ceiling')
		}
		throw new HttpError(403, 'insufficient_role', `Missing permission for ${action}`)
	}

	if (decision.auditedBypass) {
		await tx`
			INSERT INTO audit_log (workspace_id, actor_type, actor_id, action, target_type, target_id, metadata)
			VALUES (
				${actor.workspaceId},
				${actor.kind === 'agent' ? 'agent' : 'user'},
				${actor.principalId},
				${`policy.admin_bypass.${action}`},
				'doc_page',
				${page.id},
				${tx.json({ reason: 'admin_bypass', requestId: actor.requestId ?? null })}
			)
		`
	}
}
