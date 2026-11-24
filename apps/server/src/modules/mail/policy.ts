/**
 * Mail module authorization (§7.3, §12.3, §14.2–14.3).
 *
 * `mail.read`, `mail.assign`, `mail.send` are the three permissions; the
 * `mail_account` ACL restricts per-account visibility the way `project` does
 * for issues. A conversation inherits its owning account's ACL — there is no
 * per-conversation ACL (§14.3 keeps assignment a status, not a grant).
 */
import type { Queryable } from '@huriro/db'
import { type AclLevel, type Action, type ActorContext, ADMIN_BYPASS_RANK, can } from '@huriro/domain'
import { HttpError } from '../../api/error'
import { resolveResourceAcl } from '../tenancy'

export function isAdminMailBypass(actor: ActorContext): boolean {
	return (
		actor.roleKey !== 'guest' &&
		actor.membership === 'active' &&
		(actor.roleRank >= ADMIN_BYPASS_RANK || actor.permissions.has('mail.assign'))
	)
}

/**
 * Authorize an action against a mail account (or a conversation → its account).
 * `account` must carry `id` + `visibility`; pass visibility 'workspace' when the
 * account is shared with all members, 'private' when ACL-gated.
 */
export async function authorizeMailAccountAction(
	tx: Queryable,
	actor: ActorContext,
	action: Action,
	account: { readonly id: string; readonly visibility: 'workspace' | 'private' }
): Promise<void> {
	const acl: AclLevel | null =
		account.visibility === 'private' || actor.roleKey === 'guest'
			? await resolveResourceAcl(tx, {
					workspaceId: actor.workspaceId,
					resourceType: 'mail_account',
					resourceId: account.id,
					userId: actor.userId
				})
			: null

	const decision = can(actor, action, {
		type: 'mail_account',
		id: account.id,
		visibility: account.visibility,
		acl
	})
	if (decision.effect === 'deny') {
		if (decision.reason === 'not_member' || decision.reason === 'suspended') {
			throw new HttpError(403, 'not_workspace_member', 'Active workspace membership is required')
		}
		if (decision.reason === 'no_acl') {
			throw new HttpError(403, 'resource_private', 'Mail account access denied')
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
				'mail_account',
				${account.id},
				${tx.json({ reason: 'admin_bypass', requestId: actor.requestId ?? null })}
			)
		`
	}
}

/** Workspace-wide mail actions (list inboxes, read any account's mail when accounts are workspace-visible). */
export function authorizeMailWorkspaceAction(actor: ActorContext, action: Action): void {
	const decision = can(actor, action, {
		type: 'mail_account',
		id: actor.workspaceId,
		visibility: 'workspace',
		acl: null
	})
	if (decision.effect === 'deny') {
		if (decision.reason === 'not_member' || decision.reason === 'suspended') {
			throw new HttpError(403, 'not_workspace_member', 'Active workspace membership is required')
		}
		if (decision.reason === 'agent_scope') {
			throw new HttpError(403, 'agent_scope_exceeded', 'Action exceeds agent scope ceiling')
		}
		throw new HttpError(403, 'insufficient_role', `Missing permission for ${action}`)
	}
}
