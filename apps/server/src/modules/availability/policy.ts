/**
 * Availability authorization (ADR-0035).
 *
 * Durable availability is workspace-visible to active non-guest members.
 * Guests see only their own row plus co-members sharing an accessible
 * project/channel/teamspace — never the workspace directory. Writes are
 * strictly self-scoped (`member.manage` may not edit another user's status).
 */
import type { ActorContext } from '@huriro/domain'
import { HttpError } from '../../api/error'

export function assertActiveMember(actor: ActorContext): void {
	if (actor.membership !== 'active') {
		throw new HttpError(403, 'not_workspace_member', 'Active workspace membership required')
	}
}

export function assertSelfOrManager(actor: ActorContext, targetUserId: string): void {
	if (actor.userId === targetUserId) return
	if (!actor.permissions.has('member.manage')) {
		throw new HttpError(403, 'insufficient_role', 'Only the user or a member manager may do this')
	}
}

export function canReadWorkspaceDirectory(actor: ActorContext): boolean {
	return actor.membership === 'active' && actor.roleKey !== 'guest'
}
