import { type ActorContext, can } from '@huriro/domain'
import { HttpError } from '../../api/error'

/** Cloud billing operations require `workspace.billing` (owner-only in §12.3). */
export function authorizeBillingManage(actor: ActorContext): void {
	const decision = can(actor, 'workspace.billing', { type: 'workspace' })
	if (decision.effect === 'deny') {
		if (decision.reason === 'not_member' || decision.reason === 'suspended') {
			throw new HttpError(403, 'not_workspace_member', 'Active workspace membership is required')
		}
		if (decision.reason === 'agent_scope') {
			throw new HttpError(403, 'agent_scope_exceeded', 'Action exceeds agent scope ceiling')
		}
		throw new HttpError(403, 'insufficient_role', 'Workspace billing permission required')
	}
}
