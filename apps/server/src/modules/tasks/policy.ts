/**
 * Tasks module authorization helpers (§7.3, §12.3).
 * Every check delegates to the pure policy function `@huriro/domain.can()`.
 */
import type { Queryable } from '@huriro/db'
import { type AclLevel, type Action, type ActorContext, ADMIN_BYPASS_RANK, can } from '@huriro/domain'
import { HttpError } from '../../api/error'

export function isAdminProjectBypass(actor: ActorContext): boolean {
	return (
		actor.roleKey !== 'guest' &&
		actor.membership === 'active' &&
		(actor.roleRank >= ADMIN_BYPASS_RANK || actor.permissions.has('project.manage'))
	)
}

export async function authorizeProject(
	tx: Queryable,
	actor: ActorContext,
	action: Action,
	project: { readonly id: string; readonly visibility: 'workspace' | 'private' },
	acl: AclLevel | null
): Promise<void> {
	const decision = can(actor, action, {
		type: 'project',
		id: project.id,
		visibility: project.visibility,
		acl
	})
	if (decision.effect === 'deny') {
		if (decision.reason === 'not_member' || decision.reason === 'suspended') {
			throw new HttpError(403, 'not_workspace_member', 'Active workspace membership is required')
		}
		if (decision.reason === 'no_acl') {
			throw new HttpError(403, 'resource_private', 'Private project access denied')
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
				'project',
				${project.id},
				${tx.json({ reason: 'admin_bypass', requestId: actor.requestId ?? null })}
			)
		`
	}
}

export function authorizeWorkspaceTaskAction(actor: ActorContext, action: Action): void {
	// Labels and workspace-level saved views check workspace membership + role permission.
	const decision = can(actor, action, {
		type: 'project',
		id: actor.workspaceId,
		visibility: 'workspace',
		acl: null
	})
	if (decision.effect === 'deny') {
		if (decision.reason === 'not_member' || decision.reason === 'suspended') {
			throw new HttpError(403, 'not_workspace_member', 'Active workspace membership is required')
		}
		if (decision.reason === 'no_acl') {
			throw new HttpError(403, 'resource_private', 'Workspace permission required')
		}
		throw new HttpError(403, 'insufficient_role', `Missing permission for ${action}`)
	}
}
