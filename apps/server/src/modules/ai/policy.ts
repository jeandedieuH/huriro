import type { ActorContext } from '@huriro/domain'
import { HttpError } from '../../api/error'

export function requirePerm(actor: ActorContext, action: 'ai.use' | 'ai.manage'): void {
	if (actor.membership !== 'active') {
		throw new HttpError(403, 'not_workspace_member', 'Active membership required')
	}
	if (!actor.permissions.has(action)) {
		throw new HttpError(403, 'insufficient_role', `Missing ${action} permission`)
	}
}

export class AiDisabledError extends HttpError {
	constructor() {
		super(403, 'ai_disabled', 'AI features are disabled for this workspace')
	}
}
