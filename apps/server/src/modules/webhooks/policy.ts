import { type ActorContext, can } from '@huriro/domain'
import { HttpError } from '../../api/error'

export function authorizeWebhookManage(actor: ActorContext): void {
	const decision = can(actor, 'settings.manage', { type: 'workspace' })
	if (decision.effect === 'deny') {
		if (decision.reason === 'not_member' || decision.reason === 'suspended') {
			throw new HttpError(403, 'not_workspace_member', 'Active workspace membership is required')
		}
		if (decision.reason === 'agent_scope') {
			throw new HttpError(403, 'agent_scope_exceeded', 'Action exceeds agent scope ceiling')
		}
		throw new HttpError(403, 'insufficient_role', 'Workspace settings permission required to manage webhooks')
	}
}
