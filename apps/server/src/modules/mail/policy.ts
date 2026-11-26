/**
 * Mail module authorization (§7.3, §12.3, §14.2–14.3).
 *
 * `mail.read`, `mail.assign`, `mail.send` are the three permissions; the
 * `mail_account` ACL restricts per-account visibility the way `project` does
 * for issues. A conversation inherits its owning account's ACL — there is no
 * per-conversation ACL (§14.3 keeps assignment a status, not a grant).
 */
import type { Queryable } from '@huriro/db'
import { type AclLevel, type Action, type ActorContext, ADMIN_BYPASS_RANK, can } from '@huriro/domain'
import { HttpError } from '../../api/error'
import { resolveResourceAcl } from '../tenancy'
import * as repo from './repo'

const ACL_RANK: Record<AclLevel, number> = { read: 1, comment: 2, write: 3, manage: 4 }
const MAIL_ACTION_ACL_LEVEL = {
	'mail.read': 'read',
	'mail.assign': 'write',
	'mail.send': 'write'
} as const satisfies Record<'mail.read' | 'mail.assign' | 'mail.send', AclLevel>

export type MailInboxAction = keyof typeof MAIL_ACTION_ACL_LEVEL

export function isAdminMailBypass(actor: ActorContext): boolean {
	return (
		actor.roleKey !== 'guest' &&
		actor.membership === 'active' &&
		(actor.roleRank >= ADMIN_BYPASS_RANK || actor.permissions.has('mail.assign'))
	)
}

/**
 * Strict workspace admin bypass for private `mail_inbox` resources.
 * Unlike `mail_account` or `isAdminMailBypass`, ordinary members holding
 * `mail.assign` must NEVER bypass private inbox isolation.
 */
export function isWorkspaceAdminBypass(actor: ActorContext): boolean {
	return actor.roleKey !== 'guest' && actor.membership === 'active' && actor.roleRank >= ADMIN_BYPASS_RANK
}

export interface MailInboxAccessDecision {
	readonly allowed: boolean
	readonly reason?: 'not_member' | 'agent_scope' | 'no_acl' | 'insufficient_role'
	readonly auditedBypass: boolean
}

export async function canAccessMailInbox(
	tx: Queryable,
	actor: ActorContext,
	action: MailInboxAction,
	inbox: {
		readonly id: string
		readonly visibility?: string | undefined
		readonly ownerUserId?: string | null | undefined
	}
): Promise<MailInboxAccessDecision> {
	if (actor.membership !== 'active') {
		return { allowed: false, reason: 'not_member', auditedBypass: false }
	}
	if (actor.kind === 'agent' && actor.agentScopeCeiling && !actor.agentScopeCeiling.has(action)) {
		return { allowed: false, reason: 'agent_scope', auditedBypass: false }
	}
	const requiredLevel = MAIL_ACTION_ACL_LEVEL[action]
	const isGuest = actor.roleKey === 'guest'

	if (inbox.visibility !== 'private') {
		if (!isGuest) {
			return actor.permissions.has(action)
				? { allowed: true, auditedBypass: false }
				: { allowed: false, reason: 'insufficient_role', auditedBypass: false }
		}
		const acl = await resolveResourceAcl(tx, {
			workspaceId: actor.workspaceId,
			resourceType: 'mail_inbox',
			resourceId: inbox.id,
			userId: actor.userId
		})
		return acl !== null && ACL_RANK[acl] >= ACL_RANK[requiredLevel]
			? { allowed: true, auditedBypass: false }
			: { allowed: false, reason: 'insufficient_role', auditedBypass: false }
	}

	if (!isGuest && inbox.ownerUserId && inbox.ownerUserId === actor.userId) {
		return { allowed: true, auditedBypass: false }
	}
	const acl = await resolveResourceAcl(tx, {
		workspaceId: actor.workspaceId,
		resourceType: 'mail_inbox',
		resourceId: inbox.id,
		userId: actor.userId
	})
	if (acl !== null && ACL_RANK[acl] >= ACL_RANK[requiredLevel]) {
		return { allowed: true, auditedBypass: false }
	}
	if (isWorkspaceAdminBypass(actor)) {
		return { allowed: true, auditedBypass: true }
	}
	return { allowed: false, reason: 'no_acl', auditedBypass: false }
}

export async function authorizeMailInboxAction(
	tx: Queryable,
	actor: ActorContext,
	action: MailInboxAction,
	inboxOrId:
		| string
		| {
				readonly id: string
				readonly visibility?: string | undefined
				readonly ownerUserId?: string | null | undefined
		  }
): Promise<void> {
	const inbox =
		typeof inboxOrId === 'string' ? await repo.getMailInbox(tx, actor.workspaceId, inboxOrId) : inboxOrId
	if (!inbox) throw new HttpError(404, 'not_found', 'Mail inbox not found')
	const decision = await canAccessMailInbox(tx, actor, action, inbox)
	if (!decision.allowed) {
		if (decision.reason === 'not_member') {
			throw new HttpError(403, 'not_workspace_member', 'Active workspace membership is required')
		}
		if (decision.reason === 'agent_scope') {
			throw new HttpError(403, 'agent_scope_exceeded', 'Action exceeds agent scope ceiling')
		}
		if (decision.reason === 'no_acl') {
			throw new HttpError(403, 'resource_private', 'Private inbox access denied')
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
				'mail_inbox',
				${inbox.id},
				${tx.json({ reason: 'admin_bypass', requestId: actor.requestId ?? null })}
			)
		`
	}
}

/** Inbox IDs the actor can read (`null` only when workspace admin bypass applies across all inboxes). */
export async function accessibleInboxIds(tx: Queryable, actor: ActorContext): Promise<string[] | null> {
	if (
		isWorkspaceAdminBypass(actor) &&
		(actor.kind !== 'agent' || !actor.agentScopeCeiling || actor.agentScopeCeiling.has('mail.read'))
	) {
		return null
	}
	const inboxes = await repo.listMailInboxes(tx, actor.workspaceId)
	const out: string[] = []
	for (const inbox of inboxes) {
		const decision = await canAccessMailInbox(tx, actor, 'mail.read', inbox)
		if (decision.allowed) out.push(inbox.id)
	}
	return out
}

/**
 * Authorize an action against a mail account (or a conversation → its account).
 * `account` must carry `id` + `visibility`; pass visibility 'workspace' when the
 * account is shared with all members, 'private' when ACL-gated.
 */
export async function authorizeMailAccountAction(
	tx: Queryable,
	actor: ActorContext,
	action: Action,
	account: { readonly id: string; readonly visibility: 'workspace' | 'private' }
): Promise<void> {
	const acl: AclLevel | null =
		account.visibility === 'private' || actor.roleKey === 'guest'
			? await resolveResourceAcl(tx, {
					workspaceId: actor.workspaceId,
					resourceType: 'mail_account',
					resourceId: account.id,
					userId: actor.userId
				})
			: null

	const decision = can(actor, action, {
		type: 'mail_account',
		id: account.id,
		visibility: account.visibility,
		acl
	})
	if (decision.effect === 'deny') {
		if (decision.reason === 'not_member' || decision.reason === 'suspended') {
			throw new HttpError(403, 'not_workspace_member', 'Active workspace membership is required')
		}
		if (decision.reason === 'no_acl') {
			throw new HttpError(403, 'resource_private', 'Mail account access denied')
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
				'mail_account',
				${account.id},
				${tx.json({ reason: 'admin_bypass', requestId: actor.requestId ?? null })}
			)
		`
	}
}

/** Workspace-wide mail actions (list inboxes, read any account's mail when accounts are workspace-visible). */
export function authorizeMailWorkspaceAction(actor: ActorContext, action: Action): void {
	const decision = can(actor, action, {
		type: 'mail_account',
		id: actor.workspaceId,
		visibility: 'workspace',
		acl: null
	})
	if (decision.effect === 'deny') {
		if (decision.reason === 'not_member' || decision.reason === 'suspended') {
			throw new HttpError(403, 'not_workspace_member', 'Active workspace membership is required')
		}
		if (decision.reason === 'agent_scope') {
			throw new HttpError(403, 'agent_scope_exceeded', 'Action exceeds agent scope ceiling')
		}
		throw new HttpError(403, 'insufficient_role', `Missing permission for ${action}`)
	}
}
