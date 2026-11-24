import { type ActorContext, can, ROLE_RANKS } from '@huriro/domain'
import { HttpError } from '../../api/error'

/** GDPR Art. 20 workspace export is owner-only (§22.2). */
export function authorizeWorkspaceExport(actor: ActorContext): void {
	if (actor.membership !== 'active') {
		throw new HttpError(403, 'not_workspace_member', 'Active workspace membership is required')
	}
	const decision = can(actor, 'workspace.manage', { type: 'workspace' })
	if (decision.effect === 'deny') {
		if (decision.reason === 'agent_scope') {
			throw new HttpError(403, 'agent_scope_exceeded', 'Action exceeds agent scope ceiling')
		}
		throw new HttpError(403, 'insufficient_role', 'Workspace owner permission required for exports')
	}
	if (actor.kind !== 'user' || actor.roleRank < ROLE_RANKS.owner) {
		throw new HttpError(403, 'insufficient_role', 'Only a workspace owner may export workspace data')
	}
}
