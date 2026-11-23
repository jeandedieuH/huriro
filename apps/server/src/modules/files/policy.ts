import { type ActorContext, can } from '@huriro/domain'
import { HttpError } from '../../api/error'

export function authorizeFileAction(actor: ActorContext, action: 'file.read' | 'file.write'): void {
	if (actor.membership !== 'active') {
		throw new HttpError(403, 'not_workspace_member', 'Active workspace membership is required')
	}
	const decision = can(actor, action, {
		type: 'channel',
		id: actor.workspaceId,
		visibility: actor.roleKey === 'guest' ? 'private' : 'workspace',
		acl: actor.roleKey === 'guest' ? 'write' : null
	})
	if (decision.effect !== 'allow') {
		throw new HttpError(403, 'insufficient_role', `Missing permission for ${action}`)
	}
}
