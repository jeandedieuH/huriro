/**
 * The single authorization policy function (§12.3, §7.3).
 *
 * Pure: every input is resolved by the caller (service layer fetches the
 * membership, role permissions, and effective ACL level for the actor/resource,
 * then calls `can`). No I/O, no clock — table-tested against a matrix of
 * roles × resources × actions on every PR.
 *
 * Layers, in order (§12.3):
 *   1. role permissions — workspace-wide grants held as data
 *   2. resource ACLs — object-level for private/shared resources
 *   3. RLS — the data-layer backstop, outside this function's reach
 *
 * Deny by default. Admins bypass ACLs through an explicit, audited path.
 */
import { ACTIONS, type Action, ADMIN_BYPASS_RANK, ROLE_RANKS, type SystemRoleKey } from './permissions'

export type { Action }
export { ACTIONS }

/** What the request resolved to. Built by a module's service.ts, never by routes. */
export interface ActorContext {
	/** User id (users.id) or agent principal id. */
	readonly principalId: string
	readonly workspaceId: string
	readonly kind: 'user' | 'agent'
	/** Membership status in this workspace; 'none' = not a member. */
	readonly membership: 'active' | 'suspended' | 'none'
	/** Membership role key (system or workspace-custom); null when not a member. */
	readonly roleKey: string | null
	/** Rank of the membership role (ROLE_RANKS, or custom role's own rank). */
	readonly roleRank: number
	/** Resolved permission strings from role_permissions. */
	readonly permissions: ReadonlySet<Action>
	/**
	 * Agents only: the maximum action set this principal may ever exercise
	 * (scope ceiling — §8.3 agent_principals, §13). Checked BEFORE role math.
	 */
	readonly agentScopeCeiling?: ReadonlySet<Action> | undefined
	/** Correlation id for audit trail. */
	readonly requestId?: string | undefined
}

export type AclLevel = 'read' | 'comment' | 'write' | 'manage'

const ACL_ORDER: readonly AclLevel[] = ['read', 'comment', 'write', 'manage']

export function aclSatisfies(granted: AclLevel, required: AclLevel): boolean {
	return ACL_ORDER.indexOf(granted) >= ACL_ORDER.indexOf(required)
}

/** Resources that can carry an ACL (§8.3 acl_entries.resource_type). */
export const ACL_RESOURCE_TYPES = ['project', 'doc_page', 'channel', 'mail_account'] as const
export type AclResourceType = (typeof ACL_RESOURCE_TYPES)[number]

/** What the action targets. `acl` is the actor's effective grant resolved by the service. */
export type ResourceRef =
	| { readonly type: 'workspace' }
	| {
			readonly type: AclResourceType
			readonly id: string
			readonly visibility: 'workspace' | 'private'
			readonly acl: AclLevel | null
	  }

export type DenyReason = 'not_member' | 'insufficient_role' | 'no_acl' | 'suspended' | 'agent_scope'

export type Decision =
	| {
			readonly effect: 'allow'
			readonly via: 'role' | 'acl' | 'owner'
			/** True when a high-rank member bypassed a resource ACL — callers MUST audit (§12.3). */
			readonly auditedBypass?: true
	  }
	| { readonly effect: 'deny'; readonly reason: DenyReason }

/** Actions that operate on workspace state itself (no resource ACL applies). */
const WORKSPACE_ACTIONS = new Set<Action>([
	'workspace.manage',
	'workspace.billing',
	'member.read',
	'member.invite',
	'member.manage',
	'role.manage',
	'agent.manage',
	'approval.decide',
	'audit.read',
	'settings.manage'
])

/** resource_type → the workspace-level permission that manages it (admin bypass key). */
const RESOURCE_MANAGE_PERMISSION: Record<AclResourceType, Action> = {
	project: 'project.manage',
	doc_page: 'doc.share',
	channel: 'channel.manage',
	mail_account: 'mail.assign'
}

/** Action → the ACL level it requires on a resource. */
const ACTION_ACL_LEVEL: Partial<Record<Action, AclLevel>> = {
	'project.read': 'read',
	'project.write': 'write',
	'project.manage': 'manage',
	'issue.read': 'read',
	'issue.write': 'write',
	'issue.delete': 'manage',
	'doc.read': 'read',
	'doc.write': 'write',
	'doc.share': 'manage',
	'channel.read': 'read',
	'channel.post': 'write',
	'channel.manage': 'manage',
	'mail.read': 'read',
	'mail.assign': 'write',
	'mail.send': 'write',
	'file.read': 'read',
	'file.write': 'write'
}

function allow(via: 'role' | 'acl' | 'owner', auditedBypass?: true): Decision {
	return auditedBypass ? { effect: 'allow', via, auditedBypass: true } : { effect: 'allow', via }
}

function deny(reason: DenyReason): Decision {
	return { effect: 'deny', reason }
}

/**
 * The policy. Deny by default; every allow path is explicit.
 * Precondition: `resource.type` matches the action family (routes/services pair them).
 */
export function can(actor: ActorContext, action: Action, resource: ResourceRef): Decision {
	// 1. Membership gates — before any permission math.
	if (actor.membership === 'none' || actor.roleKey === null) return deny('not_member')
	if (actor.membership === 'suspended') return deny('suspended')

	// 2. Agent scope ceiling — a principal can never exceed its ceiling,
	//    regardless of role grants (§13: agents are bounded principals).
	if (actor.kind === 'agent' && actor.agentScopeCeiling && !actor.agentScopeCeiling.has(action)) {
		return deny('agent_scope')
	}

	// 3. Workspace-level actions: role permissions only; ACLs don't apply.
	if (WORKSPACE_ACTIONS.has(action) || resource.type === 'workspace') {
		return actor.permissions.has(action) ? allow('role') : deny('insufficient_role')
	}

	// 4. Guests hold no workspace-level permissions — explicit ACLs only (§12.3).
	const isGuest = actor.roleKey === 'guest'

	// 5. Resource actions on private resources: ACL first, admin bypass second.
	const requiredLevel = ACTION_ACL_LEVEL[action] ?? 'manage'
	if (resource.visibility === 'private' || isGuest) {
		if (resource.acl !== null && aclSatisfies(resource.acl, requiredLevel)) {
			return allow('acl')
		}
		// Explicit audited bypass: rank ≥ admin OR holding the resource's manage
		// permission. Never silent — the caller logs this path (§12.3, §12.8).
		const hasManagePermission = actor.permissions.has(RESOURCE_MANAGE_PERMISSION[resource.type])
		if (!isGuest && (actor.roleRank >= ADMIN_BYPASS_RANK || hasManagePermission)) {
			return allow('role', true)
		}
		return deny('no_acl')
	}

	// 6. Workspace-visible resources: ordinary role permission check.
	return actor.permissions.has(action) ? allow('role') : deny('insufficient_role')
}

/** True when this action needs an ACL lookup (service uses it to decide the query). */
export function needsAcl(action: Action): boolean {
	return !WORKSPACE_ACTIONS.has(action)
}

/** The ACL level a given action requires — exported for repo queries. */
export function requiredAclLevel(action: Action): AclLevel {
	return ACTION_ACL_LEVEL[action] ?? 'manage'
}

export type { SystemRoleKey }
// Re-exported so services can compute ranks without a second import site.
export { ADMIN_BYPASS_RANK, ROLE_RANKS }
