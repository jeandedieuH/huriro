/**
 * Docs module authorization helpers (§7.3, §10.3, §12.3).
 * Delegates all permission math to the pure policy function `@huriro/domain.can()`.
 */
import type { Queryable } from '@huriro/db'
import { type AclLevel, type Action, type ActorContext, ADMIN_BYPASS_RANK, can } from '@huriro/domain'
import { HttpError } from '../../api/error'

export function isAdminDocBypass(actor: ActorContext): boolean {
	return (
		actor.roleKey !== 'guest' &&
		actor.membership === 'active' &&
		(actor.roleRank >= ADMIN_BYPASS_RANK || actor.permissions.has('doc.share'))
	)
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
