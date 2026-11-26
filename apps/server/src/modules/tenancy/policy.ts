/**
 * Workspace-level action guards. Thin wrappers over @huriro/domain.can() —
 * the pure policy function stays the single source of truth (§12.3).
 *
 * Note: "create a workspace" is deliberately NOT a `can()` call — can()
 * requires membership, and a user's first workspace precedes any membership.
 * Workspace creation is an instance-level entitlement (authenticated user +
 * feature flag on cloud), enforced in the setup service.
 */
import {
	type AclLevel,
	type AclResourceType,
	type Action,
	type ActorContext,
	can,
	type Decision
} from '@huriro/domain'

export function canManageWorkspace(actor: ActorContext): boolean {
	return can(actor, 'workspace.manage', { type: 'workspace' }).effect === 'allow'
}

export function canReadMembers(actor: ActorContext): Decision {
	return can(actor, 'member.read', { type: 'workspace' })
}

const MANAGE_ACTION_FOR_RESOURCE: Record<AclResourceType, Action> = {
	project: 'project.manage',
	doc_page: 'doc.share',
	teamspace: 'teamspace.manage',
	channel: 'channel.manage',
	mail_account: 'mail.assign',
	mail_inbox: 'mail.assign',
	doc_database: 'database.manage'
}

export function canManageResourceAcl(
	actor: ActorContext,
	resourceType: AclResourceType,
	resourceId: string,
	acl: AclLevel | null
): Decision {
	return can(actor, MANAGE_ACTION_FOR_RESOURCE[resourceType], {
		type: resourceType,
		id: resourceId,
		visibility: 'private',
		acl
	})
}
