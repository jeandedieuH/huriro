/**
 * The permission catalog (§12.3). Permissions are DATA — stored in
 * `role_permissions` rows, matched here as a closed set. New actions are added
 * here; the DB CHECK constraint is generated from this list in migrations, so
 * catalog and schema can't drift.
 */
export const ACTIONS = [
	// workspace administration
	'workspace.manage',
	'workspace.billing',
	// membership & roles
	'member.read',
	'member.invite',
	'member.manage',
	'role.manage',
	// projects & issues
	'project.read',
	'project.write',
	'project.manage',
	'issue.read',
	'issue.write',
	'issue.delete',
	// M8 planning: cross-project initiative administration (§3.2, §8.2)
	'initiative.manage',
	// docs
	'doc.read',
	'doc.comment',
	'doc.write',
	'doc.share',
	'doc.verify',
	'doc.publish',
	'teamspace.manage',
	// chat
	'channel.read',
	'channel.post',
	'channel.manage',
	// mail
	'mail.read',
	'mail.assign',
	'mail.send',
	// files
	'file.read',
	'file.write',
	// agents & approvals
	'agent.manage',
	'approval.decide',
	// AI gateway (§11.3): use AI features vs manage provider config
	'ai.use',
	'ai.manage',
	// audit & admin
	'audit.read',
	'settings.manage',
	// imports
	'import.run',
	// workflow automations (§7.2): inspect rules/runs vs create & manage them
	'automation.read',
	'automation.manage'
] as const

export type Action = (typeof ACTIONS)[number]

const actionSet = new Set<string>(ACTIONS)
export function isAction(value: string): value is Action {
	return actionSet.has(value)
}

/** System role keys — seeded per workspace at creation (§8.3, §12.3). */
export const SYSTEM_ROLE_KEYS = ['owner', 'admin', 'member', 'guest'] as const
export type SystemRoleKey = (typeof SYSTEM_ROLE_KEYS)[number]

/** Rank ordering for ">= admin" style checks; higher is more powerful. */
export const ROLE_RANKS: Record<SystemRoleKey, number> = {
	owner: 100,
	admin: 80,
	member: 50,
	guest: 10
}

/** Rank at or above which a member bypasses resource ACLs (audited — §12.3). */
export const ADMIN_BYPASS_RANK = ROLE_RANKS.admin

interface SystemRole {
	readonly key: SystemRoleKey
	readonly name: string
	readonly rank: number
	readonly permissions: readonly Action[]
}

const ALL_ACTIONS_MINUS_ADMIN: readonly Action[] = ACTIONS.filter((a) => a !== 'workspace.billing')

/**
 * Default permission sets per system role. Guests hold NO workspace-level
 * permissions — they only reach resources via explicit ACL grants (§12.3).
 */
export const SYSTEM_ROLES: readonly SystemRole[] = [
	{ key: 'owner', name: 'Owner', rank: ROLE_RANKS.owner, permissions: ACTIONS },
	{ key: 'admin', name: 'Admin', rank: ROLE_RANKS.admin, permissions: ALL_ACTIONS_MINUS_ADMIN },
	{
		key: 'member',
		name: 'Member',
		rank: ROLE_RANKS.member,
		permissions: [
			'member.read',
			'project.read',
			'project.write',
			'issue.read',
			'issue.write',
			'doc.read',
			'doc.comment',
			'doc.write',
			'doc.verify',
			'channel.read',
			'channel.post',
			'mail.read',
			'mail.assign',
			'mail.send',
			'file.read',
			'file.write',
			'approval.decide',
			'ai.use',
			'automation.read'
		]
	},
	{ key: 'guest', name: 'Guest', rank: ROLE_RANKS.guest, permissions: [] }
]
