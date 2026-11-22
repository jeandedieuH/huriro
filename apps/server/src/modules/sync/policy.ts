import type { ActorContext } from '@huriro/domain'
import { HttpError } from '../../api/error'

export function assertActiveSyncMember(actor: ActorContext): void {
	if (actor.membership !== 'active') {
		throw new HttpError(403, 'not_workspace_member', 'Active workspace membership is required for sync')
	}
}
