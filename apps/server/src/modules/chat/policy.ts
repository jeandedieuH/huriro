/**
 * Chat authorization guards (§12.3, §15.1).
 *
 * Security invariants:
 *  - Public & private channels delegate through `@huriro/domain.can()`.
 *  - Direct messages (`kind === 'dm'`) are strictly participant-only:
 *    non-participants (including workspace owners/admins) receive 403
 *    without admin bypass.
 */
import type { Queryable } from '@huriro/db'
import { type AclLevel, type Action, type ActorContext, can } from '@huriro/domain'
import { HttpError } from '../../api/error'

const ACL_RANK: Record<AclLevel, number> = {
	read: 1,
	comment: 2,
	write: 3,
	manage: 4
}

function maxAcl(a: AclLevel | null, b: AclLevel | null): AclLevel | null {
	if (!a) return b
	if (!b) return a
	return ACL_RANK[a] >= ACL_RANK[b] ? a : b
}

export interface ChannelPolicyTarget {
	readonly id: string
	readonly kind: 'public' | 'private' | 'dm'
	readonly isMember: boolean
	readonly memberRole: 'member' | 'admin' | null
}

function throwDenyReason(reason: string, action: Action, kind: ChannelPolicyTarget['kind']): never {
	if (reason === 'not_member' || reason === 'suspended') {
		throw new HttpError(403, 'not_workspace_member', 'Active workspace membership is required')
	}
	if (reason === 'agent_scope') {
		throw new HttpError(403, 'agent_scope_exceeded', 'Action exceeds agent scope ceiling')
	}
	if (reason === 'no_acl') {
		const detail =
			kind === 'dm' ? 'Direct message access is restricted to participants' : 'Private channel access denied'
		throw new HttpError(403, 'resource_private', detail)
	}
	throw new HttpError(403, 'insufficient_role', `Missing permission for ${action}`)
}

export async function authorizeChannel(
	tx: Queryable,
	actor: ActorContext,
	action: 'channel.read' | 'channel.post' | 'channel.manage',
	channel: ChannelPolicyTarget,
	resourceAcl: AclLevel | null
): Promise<void> {
	// Participant-only isolation on DMs: NO owner/admin bypass allowed (§15.1).
	if (channel.kind === 'dm') {
		if (!channel.isMember) {
			if (actor.membership !== 'active') {
				throw new HttpError(403, 'not_workspace_member', 'Active workspace membership is required')
			}
			throw new HttpError(403, 'resource_private', 'Direct message access is restricted to participants')
		}
		const dmAcl: AclLevel = action === 'channel.manage' ? 'manage' : 'write'
		const decision = can(actor, action, {
			type: 'channel',
			id: channel.id,
			visibility: 'private',
			acl: dmAcl
		})
		if (decision.effect === 'deny') {
			throwDenyReason(decision.reason, action, 'dm')
		}
		return
	}

	const memberAcl: AclLevel | null =
		channel.memberRole === 'admin' ? 'manage' : channel.isMember ? 'write' : null
	const effectiveAcl = maxAcl(memberAcl, resourceAcl)

	// Channel creators/admins on public channels can manage their own channel even with member role.
	const visibility: 'workspace' | 'private' =
		channel.kind === 'private' || (action === 'channel.manage' && effectiveAcl === 'manage')
			? 'private'
			: 'workspace'

	const decision = can(actor, action, {
		type: 'channel',
		id: channel.id,
		visibility,
		acl: effectiveAcl
	})

	if (decision.effect === 'deny') {
		throwDenyReason(decision.reason, action, channel.kind)
	}

	if (decision.auditedBypass) {
		await tx`
			INSERT INTO audit_log (workspace_id, actor_type, actor_id, action, target_type, target_id, metadata)
			VALUES (
				${actor.workspaceId},
				${actor.kind === 'agent' ? 'agent' : 'user'},
				${actor.principalId},
				${`policy.admin_bypass.${action}`},
				'channel',
				${channel.id},
				${tx.json({ reason: 'admin_bypass', requestId: actor.requestId ?? null })}
			)
		`
	}
}

export function authorizeCreateChannel(actor: ActorContext): void {
	const decision = can(actor, 'channel.post', {
		type: 'channel',
		id: actor.workspaceId,
		visibility: 'workspace',
		acl: null
	})
	if (decision.effect === 'deny') {
		throwDenyReason(decision.reason, 'channel.post', 'public')
	}
}
