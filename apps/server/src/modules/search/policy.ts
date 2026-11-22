import { type ActorContext, ADMIN_BYPASS_RANK, can } from '@huriro/domain'
import { HttpError } from '../../api/error'

export function assertCanSearch(actor: ActorContext): {
	readonly isGuest: boolean
	readonly bypassAcl: boolean
} {
	if (actor.membership !== 'active') {
		throw new HttpError(403, 'not_workspace_member', 'Active workspace membership is required')
	}
	if (actor.roleKey !== 'guest') {
		const decision = can(actor, 'issue.read', {
			type: 'project',
			id: actor.workspaceId,
			visibility: 'workspace',
			acl: null
		})
		if (decision.effect === 'deny') {
			throw new HttpError(403, 'insufficient_role', 'Search permission denied')
		}
	}
	const bypassAcl =
		actor.roleKey !== 'guest' &&
		(actor.roleRank >= ADMIN_BYPASS_RANK || actor.permissions.has('project.manage'))
	return { isGuest: actor.roleKey === 'guest', bypassAcl }
}
