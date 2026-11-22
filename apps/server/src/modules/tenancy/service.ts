/**
 * Tenancy write paths (§5.3): domain rows + outbox event + audit row + the
 * sync cursor allocated LAST — all inside one withWorkspace transaction.
 */

import { createHash, randomBytes } from 'node:crypto'
import type { Queryable } from '@huriro/db'
import {
	type AclLevel,
	type AclResourceType,
	type Action,
	type ActorContext,
	aclSatisfies,
	isAction,
	SYSTEM_ROLES
} from '@huriro/domain'
import { appendChange } from '../../api/changelog'
import { HttpError } from '../../api/error'
import { TENANCY_EVENTS } from './events'
import {
	type AclEntryRow,
	audit,
	deleteAclEntryById,
	emitEvent,
	findPendingInvitation,
	getActorMembershipAndPermissions,
	insertAclEntry,
	insertInvitation,
	insertMembership,
	insertRole,
	insertRolePermission,
	insertWorkspace,
	listMembers,
	listResourceAclEntries,
	listResourceAclLevelsForUser,
	type MembershipSummaryRow,
	markInvitationAccepted
} from './repo'
// insertMembership is used by seedWorkspace; the accept path needs ON CONFLICT
// so it inlines its own INSERT below.

export interface CreatedWorkspace {
	id: string
	slug: string
	ownerRoleId: string
}

/**
 * Create a workspace with its system roles + owner membership.
 * Runs inside the caller's transaction; establishes the tenant context itself
 * (insert workspace row → set_config → tenant writes — see setup.ts header).
 */
export async function createWorkspace(
	tx: Queryable,
	args: { slug: string; name: string; ownerUserId: string }
): Promise<CreatedWorkspace> {
	const ws = await insertWorkspace(tx, { slug: args.slug, name: args.name })
	// The workspace didn't exist when the tx began, so no tenant context is set;
	// establish it now (same tx) so tenant-scoped writes satisfy FORCE RLS.
	await tx`SELECT set_config('app.workspace_id', ${ws.id}, true)`
	return seedWorkspace(tx, ws, args.ownerUserId)
}

/**
 * Seed roles, membership, sync cursor, outbox + audit for an already-inserted
 * workspace row. `app.workspace_id` must already be set in this transaction
 * (callers that bootstrap set it; normal paths enter via withWorkspace).
 */
export async function seedWorkspace(
	tx: Queryable,
	ws: { id: string; slug: string },
	ownerUserId: string
): Promise<CreatedWorkspace> {
	// Seed the system role set — roles are per-workspace rows so admins can add
	// custom roles later without a shared-role coupling (§12.3).
	const roleIds: Record<string, string> = {}
	for (const role of SYSTEM_ROLES) {
		const roleId = await insertRole(tx, {
			workspaceId: ws.id,
			key: role.key,
			name: role.name,
			rank: role.rank
		})
		roleIds[role.key] = roleId
		for (const permission of role.permissions) {
			await insertRolePermission(tx, { workspaceId: ws.id, roleId, permission })
		}
	}

	// Every workspace owns a sync cursor row — allocated before first change (§8.5).
	await tx`INSERT INTO workspace_seq (workspace_id) VALUES (${ws.id})`

	const ownerRoleId = roleIds['owner']!
	await insertMembership(tx, { workspaceId: ws.id, userId: ownerUserId, roleId: ownerRoleId })

	await emitEvent(tx, {
		aggregate: 'workspace',
		aggregateId: ws.id,
		eventType: TENANCY_EVENTS.WorkspaceCreated,
		workspaceId: ws.id,
		payload: { workspaceId: ws.id, slug: ws.slug, ownerUserId }
	})
	await audit(tx, {
		workspaceId: ws.id,
		actorType: 'user',
		actorId: ownerUserId,
		action: 'workspace.create',
		targetType: 'workspace',
		targetId: ws.id,
		metadata: { slug: ws.slug }
	})

	return { id: ws.id, slug: ws.slug, ownerRoleId }
}

// ---------- invitations (§12.3: role-gated create, token-gated accept) ----------

const INVITE_TTL_MS = 7 * 24 * 60 * 60 * 1000 // 7 days

export class InvitationError extends Error {
	readonly code: 'invalid' | 'email_mismatch' | 'already_member' | 'not_pending'
	constructor(code: InvitationError['code'], message: string) {
		super(message)
		this.name = 'InvitationError'
		this.code = code
	}
}

function hashToken(token: string): string {
	return createHash('sha256').update(token, 'utf8').digest('hex')
}

/**
 * Create an invite inside the caller's tenant transaction.
 * Returns the plaintext token ONCE — only the sha256 hash is persisted.
 */
export async function createInvitation(
	tx: Queryable,
	args: { workspaceId: string; email: string; roleId: string; invitedBy: string }
): Promise<{ id: string; token: string }> {
	const token = randomBytes(32).toString('base64url')
	const id = await insertInvitation(tx, {
		workspaceId: args.workspaceId,
		email: args.email.toLowerCase(),
		roleId: args.roleId,
		tokenHash: hashToken(token),
		invitedBy: args.invitedBy,
		expiresAt: new Date(Date.now() + INVITE_TTL_MS)
	})
	await emitEvent(tx, {
		aggregate: 'invitation',
		aggregateId: id,
		eventType: TENANCY_EVENTS.InvitationCreated,
		workspaceId: args.workspaceId,
		payload: { invitationId: id, email: args.email.toLowerCase(), roleId: args.roleId }
	})
	await audit(tx, {
		workspaceId: args.workspaceId,
		actorType: 'user',
		actorId: args.invitedBy,
		action: 'invitation.create',
		targetType: 'invitation',
		targetId: id,
		metadata: { email: args.email.toLowerCase() }
	})
	return { id, token }
}

/**
 * Accept an invite. Context bootstrap is the interesting part: the invitee
 * can't read invitations under tenant RLS until they have a workspace context,
 * and they can't get a context until they read the invite. The policy's
 * email-scoped escape (`email = app.user_email`) breaks the cycle — set
 * user/email context first, read the pending invite under the email clause,
 * then pin the workspace context in the same tx for the membership write.
 */
export async function acceptInvitation(
	tx: Queryable,
	args: { token: string; userId: string; userEmail: string }
): Promise<{ workspaceId: string; membershipCreated: boolean }> {
	await tx`
		SELECT
			set_config('app.user_id', ${args.userId}, true),
			set_config('app.user_email', ${args.userEmail}, true)
	`
	const invite = await findPendingInvitation(tx, hashToken(args.token))
	if (!invite) throw new InvitationError('invalid', 'Invitation is invalid, expired, or already used')
	if (invite.email.toLowerCase() !== args.userEmail.toLowerCase()) {
		// Token valid for another email — reveal nothing beyond "invalid".
		throw new InvitationError('email_mismatch', 'This invitation was issued to a different email')
	}

	await tx`SELECT set_config('app.workspace_id', ${invite.workspaceId}, true)`
	// Idempotent under re-acceptance: a user already seated by another path
	// doesn't fail — the invite still burns.
	const inserted = await tx`
		INSERT INTO memberships (workspace_id, user_id, role_id)
		VALUES (${invite.workspaceId}, ${args.userId}, ${invite.roleId})
		ON CONFLICT (workspace_id, user_id) DO NOTHING
		RETURNING user_id
	`
	await markInvitationAccepted(tx, invite.id)

	await emitEvent(tx, {
		aggregate: 'invitation',
		aggregateId: invite.id,
		eventType: TENANCY_EVENTS.InvitationAccepted,
		workspaceId: invite.workspaceId,
		payload: { invitationId: invite.id, userId: args.userId, membershipCreated: inserted.length > 0 }
	})
	await audit(tx, {
		workspaceId: invite.workspaceId,
		actorType: 'user',
		actorId: args.userId,
		action: 'invitation.accept',
		targetType: 'invitation',
		targetId: invite.id,
		metadata: { membershipCreated: inserted.length > 0 }
	})

	return { workspaceId: invite.workspaceId, membershipCreated: inserted.length > 0 }
}

// ---------- Actor, ACL & member resolution ----------

export async function resolveActor(
	tx: Queryable,
	args: { readonly workspaceId: string; readonly userId: string; readonly requestId?: string | undefined }
): Promise<ActorContext> {
	const row = await getActorMembershipAndPermissions(tx, args.workspaceId, args.userId)
	if (!row) {
		return {
			principalId: args.userId,
			workspaceId: args.workspaceId,
			kind: 'user',
			membership: 'none',
			roleKey: null,
			roleRank: 0,
			permissions: new Set<Action>(),
			requestId: args.requestId
		}
	}

	const permissions = new Set<Action>()
	for (const perm of row.permissions) {
		if (isAction(perm)) permissions.add(perm)
	}

	return {
		principalId: args.userId,
		workspaceId: args.workspaceId,
		kind: 'user',
		membership: row.status,
		roleKey: row.roleKey,
		roleRank: row.roleRank,
		permissions,
		requestId: args.requestId
	}
}

export async function resolveResourceAcl(
	tx: Queryable,
	args: {
		readonly workspaceId: string
		readonly resourceType: AclResourceType
		readonly resourceId: string
		readonly userId: string
	}
): Promise<AclLevel | null> {
	const levels = await listResourceAclLevelsForUser(tx, args)
	if (levels.length === 0) return null
	let best: AclLevel = 'read'
	for (const level of levels) {
		if (aclSatisfies(level, best)) best = level
	}
	return best
}

export async function listWorkspaceMembers(
	tx: Queryable,
	workspaceId: string
): Promise<MembershipSummaryRow[]> {
	return listMembers(tx, workspaceId)
}

export async function listAclEntriesForResource(
	tx: Queryable,
	workspaceId: string,
	resourceType: AclResourceType,
	resourceId: string
): Promise<AclEntryRow[]> {
	return listResourceAclEntries(tx, workspaceId, resourceType, resourceId)
}

export async function grantAcl(
	tx: Queryable,
	args: {
		readonly workspaceId: string
		readonly resourceType: AclResourceType
		readonly resourceId: string
		readonly principalType: 'user' | 'role' | 'workspace'
		readonly principalId: string | null
		readonly permission: AclLevel
		readonly grantedBy: string
	}
): Promise<{ readonly entry: AclEntryRow; readonly cursor: number }> {
	if (args.principalType === 'workspace' && args.principalId !== null) {
		throw new HttpError(422, 'validation_failed', 'principalId must be null for workspace ACL')
	}
	if (args.principalType !== 'workspace' && !args.principalId) {
		throw new HttpError(422, 'validation_failed', 'principalId is required for user/role ACL')
	}

	const entry = await insertAclEntry(tx, args)

	await emitEvent(tx, {
		aggregate: 'acl',
		aggregateId: entry.id,
		eventType: TENANCY_EVENTS.AclGranted,
		workspaceId: args.workspaceId,
		payload: {
			aclId: entry.id,
			resourceType: args.resourceType,
			resourceId: args.resourceId,
			principalType: args.principalType,
			principalId: args.principalId,
			permission: args.permission,
			grantedBy: args.grantedBy
		}
	})

	await audit(tx, {
		workspaceId: args.workspaceId,
		actorType: 'user',
		actorId: args.grantedBy,
		action: 'acl.grant',
		targetType: args.resourceType,
		targetId: args.resourceId,
		metadata: {
			principalType: args.principalType,
			principalId: args.principalId,
			permission: args.permission
		}
	})

	// Map resourceType to SyncEntityType for change_log grant event (§9.3).
	const syncEntityType = args.resourceType === 'doc_page' ? 'doc_page' : 'project'
	const scope = [`${args.resourceType}:${args.resourceId}`]
	const cursor = await appendChange(tx, args.workspaceId, {
		entityType: syncEntityType,
		entityId: args.resourceId,
		action: 'grant',
		scope,
		payload: {
			resourceType: args.resourceType,
			resourceId: args.resourceId,
			principalType: args.principalType,
			principalId: args.principalId,
			permission: args.permission
		},
		actorId: args.grantedBy
	})

	return { entry, cursor }
}

export async function revokeAcl(
	tx: Queryable,
	args: {
		readonly workspaceId: string
		readonly aclId: string
		readonly revokedBy: string
	}
): Promise<{ readonly entry: AclEntryRow; readonly cursor: number }> {
	const entry = await deleteAclEntryById(tx, args.workspaceId, args.aclId)
	if (!entry) {
		throw new HttpError(404, 'not_found', 'ACL entry not found')
	}

	await emitEvent(tx, {
		aggregate: 'acl',
		aggregateId: entry.id,
		eventType: TENANCY_EVENTS.AclRevoked,
		workspaceId: args.workspaceId,
		payload: {
			aclId: entry.id,
			resourceType: entry.resourceType,
			resourceId: entry.resourceId,
			principalType: entry.principalType,
			principalId: entry.principalId,
			revokedBy: args.revokedBy
		}
	})

	await audit(tx, {
		workspaceId: args.workspaceId,
		actorType: 'user',
		actorId: args.revokedBy,
		action: 'acl.revoke',
		targetType: entry.resourceType,
		targetId: entry.resourceId,
		metadata: {
			principalType: entry.principalType,
			principalId: entry.principalId,
			permission: entry.permission
		}
	})

	const syncEntityType = entry.resourceType === 'doc_page' ? 'doc_page' : 'project'
	const cursor = await appendChange(tx, args.workspaceId, {
		entityType: syncEntityType,
		entityId: entry.resourceId,
		action: 'revoke',
		scope: [`${entry.resourceType}:${entry.resourceId}`],
		payload: {
			resourceType: entry.resourceType,
			resourceId: entry.resourceId,
			principalType: entry.principalType,
			principalId: entry.principalId
		},
		actorId: args.revokedBy
	})

	return { entry, cursor }
}
