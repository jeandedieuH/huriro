/**
 * Policy matrix test (§12.3: "a matrix test of roles × resources × actions
 * runs on every PR"). Table-driven: add a row whenever a rule changes —
 * the test asserts the WHOLE decision, not just allow/deny.
 */
import { describe, expect, test } from 'bun:test'
import { ACTIONS, ROLE_RANKS } from './permissions'
import { type AclLevel, type ActorContext, can, type Decision, type ResourceRef } from './policy'

const WS = '018f7c9e-7b2a-7c3d-8e4f-5a6b7c8d9e0f'

function actor(over: Partial<ActorContext> = {}): ActorContext {
	return {
		principalId: 'user-1',
		workspaceId: WS,
		kind: 'user',
		membership: 'active',
		roleKey: 'member',
		roleRank: ROLE_RANKS.member,
		permissions: new Set([
			'member.read',
			'project.read',
			'project.write',
			'issue.read',
			'issue.write',
			'doc.read',
			'doc.comment',
			'doc.write',
			'channel.read',
			'channel.post',
			'file.read',
			'file.write',
			'approval.decide'
		]),
		...over
	}
}

function adminActor(over: Partial<ActorContext> = {}): ActorContext {
	return actor({
		roleKey: 'admin',
		roleRank: ROLE_RANKS.admin,
		permissions: new Set(ACTIONS.filter((a) => a !== 'workspace.billing')),
		...over
	})
}

const wsResource: ResourceRef = { type: 'workspace' }
const publicDoc: ResourceRef = { type: 'doc_page', id: 'doc-1', visibility: 'workspace', acl: null }
const privateDoc = (acl: AclLevel | null): ResourceRef => ({
	type: 'doc_page',
	id: 'doc-2',
	visibility: 'private',
	acl
})
const privateChannel = (acl: AclLevel | null): ResourceRef => ({
	type: 'channel',
	id: 'chan-1',
	visibility: 'private',
	acl
})

interface Case {
	readonly name: string
	readonly actor: ActorContext
	readonly action: (typeof ACTIONS)[number]
	readonly resource: ResourceRef
	readonly expect: Decision
}

const CASES: Case[] = [
	// --- membership gates ---------------------------------------------------
	{
		name: 'non-member is denied everything',
		actor: actor({ membership: 'none', roleKey: null, roleRank: 0, permissions: new Set() }),
		action: 'issue.read',
		resource: publicDoc,
		expect: { effect: 'deny', reason: 'not_member' }
	},
	{
		name: 'non-member denied even with public resource',
		actor: actor({ membership: 'none', roleKey: null, roleRank: 0, permissions: new Set() }),
		action: 'doc.read',
		resource: publicDoc,
		expect: { effect: 'deny', reason: 'not_member' }
	},
	{
		name: 'suspended member cannot read',
		actor: actor({ membership: 'suspended' }),
		action: 'issue.read',
		resource: { type: 'project', id: 'p1', visibility: 'workspace', acl: null },
		expect: { effect: 'deny', reason: 'suspended' }
	},
	{
		name: 'suspended admin cannot manage',
		actor: adminActor({ membership: 'suspended' }),
		action: 'workspace.manage',
		resource: wsResource,
		expect: { effect: 'deny', reason: 'suspended' }
	},

	// --- workspace-level actions --------------------------------------------
	{
		name: 'member cannot invite members',
		actor: actor(),
		action: 'member.invite',
		resource: wsResource,
		expect: { effect: 'deny', reason: 'insufficient_role' }
	},
	{
		name: 'admin can invite members',
		actor: adminActor(),
		action: 'member.invite',
		resource: wsResource,
		expect: { effect: 'allow', via: 'role' }
	},
	{
		name: 'admin cannot touch billing (owner only)',
		actor: adminActor(),
		action: 'workspace.billing',
		resource: wsResource,
		expect: { effect: 'deny', reason: 'insufficient_role' }
	},
	{
		name: 'owner can manage billing',
		actor: actor({
			roleKey: 'owner',
			roleRank: ROLE_RANKS.owner,
			permissions: new Set(ACTIONS)
		}),
		action: 'workspace.billing',
		resource: wsResource,
		expect: { effect: 'allow', via: 'role' }
	},
	{
		name: 'member can read members',
		actor: actor(),
		action: 'member.read',
		resource: wsResource,
		expect: { effect: 'allow', via: 'role' }
	},

	// --- workspace-visible resources ----------------------------------------
	{
		name: 'member reads a workspace-visible doc',
		actor: actor(),
		action: 'doc.read',
		resource: publicDoc,
		expect: { effect: 'allow', via: 'role' }
	},
	{
		name: 'member writes a workspace-visible doc',
		actor: actor(),
		action: 'doc.write',
		resource: publicDoc,
		expect: { effect: 'allow', via: 'role' }
	},
	{
		name: 'member comments on a workspace-visible doc',
		actor: actor(),
		action: 'doc.comment',
		resource: publicDoc,
		expect: { effect: 'allow', via: 'role' }
	},
	{
		name: 'member cannot share a doc (no doc.share perm)',
		actor: actor(),
		action: 'doc.share',
		resource: publicDoc,
		expect: { effect: 'deny', reason: 'insufficient_role' }
	},
	{
		name: 'admin shares a doc',
		actor: adminActor(),
		action: 'doc.share',
		resource: publicDoc,
		expect: { effect: 'allow', via: 'role' }
	},
	{
		name: 'member cannot delete issues (manage-level action)',
		actor: actor(),
		action: 'issue.delete',
		resource: { type: 'project', id: 'p1', visibility: 'workspace', acl: null },
		expect: { effect: 'deny', reason: 'insufficient_role' }
	},
	{
		name: 'member cannot post to channel without channel.post',
		actor: actor({ permissions: new Set(['channel.read']) }),
		action: 'channel.post',
		resource: { type: 'channel', id: 'c1', visibility: 'workspace', acl: null },
		expect: { effect: 'deny', reason: 'insufficient_role' }
	},

	// --- private resources & ACLs -------------------------------------------
	{
		name: 'member with write ACL writes a private doc',
		actor: actor(),
		action: 'doc.write',
		resource: privateDoc('write'),
		expect: { effect: 'allow', via: 'acl' }
	},
	{
		name: 'member with read ACL cannot write a private doc',
		actor: actor(),
		action: 'doc.write',
		resource: privateDoc('read'),
		expect: { effect: 'deny', reason: 'no_acl' }
	},
	{
		name: 'member with no ACL cannot read a private doc',
		actor: actor(),
		action: 'doc.read',
		resource: privateDoc(null),
		expect: { effect: 'deny', reason: 'no_acl' }
	},
	{
		name: 'member with manage ACL can share a private doc',
		actor: actor({ permissions: new Set(ACTIONS) }),
		action: 'doc.share',
		resource: privateDoc('manage'),
		expect: { effect: 'allow', via: 'acl' }
	},
	{
		name: 'member with write ACL cannot share (needs manage)',
		actor: actor(),
		action: 'doc.share',
		resource: privateDoc('write'),
		expect: { effect: 'deny', reason: 'no_acl' }
	},
	{
		name: 'member posts to a private channel with write ACL',
		actor: actor(),
		action: 'channel.post',
		resource: privateChannel('write'),
		expect: { effect: 'allow', via: 'acl' }
	},
	{
		name: 'member with comment ACL cannot post to private channel',
		actor: actor(),
		action: 'channel.post',
		resource: privateChannel('comment'),
		expect: { effect: 'deny', reason: 'no_acl' }
	},

	// --- admin bypass (explicit, audited) ------------------------------------
	{
		name: 'admin bypasses private doc ACL — flagged for audit',
		actor: adminActor(),
		action: 'doc.read',
		resource: privateDoc(null),
		expect: { effect: 'allow', via: 'role', auditedBypass: true }
	},
	{
		name: 'holder of the resource manage-permission bypasses — flagged',
		actor: actor({ permissions: new Set(['channel.manage']) }),
		action: 'channel.read',
		resource: privateChannel(null),
		expect: { effect: 'allow', via: 'role', auditedBypass: true }
	},
	{
		name: 'member without manage-perm does NOT bypass',
		actor: actor(),
		action: 'channel.read',
		resource: privateChannel(null),
		expect: { effect: 'deny', reason: 'no_acl' }
	},

	// --- guests --------------------------------------------------------------
	{
		name: 'guest with ACL can read shared doc',
		actor: actor({ roleKey: 'guest', roleRank: ROLE_RANKS.guest, permissions: new Set() }),
		action: 'doc.read',
		resource: privateDoc('read'),
		expect: { effect: 'allow', via: 'acl' }
	},
	{
		name: 'guest with read ACL cannot comment on private doc',
		actor: actor({ roleKey: 'guest', roleRank: ROLE_RANKS.guest, permissions: new Set() }),
		action: 'doc.comment',
		resource: privateDoc('read'),
		expect: { effect: 'deny', reason: 'no_acl' }
	},
	{
		name: 'guest with comment ACL can comment on private doc',
		actor: actor({ roleKey: 'guest', roleRank: ROLE_RANKS.guest, permissions: new Set() }),
		action: 'doc.comment',
		resource: privateDoc('comment'),
		expect: { effect: 'allow', via: 'acl' }
	},
	{
		name: 'guest with comment ACL cannot write private doc',
		actor: actor({ roleKey: 'guest', roleRank: ROLE_RANKS.guest, permissions: new Set() }),
		action: 'doc.write',
		resource: privateDoc('comment'),
		expect: { effect: 'deny', reason: 'no_acl' }
	},
	{
		name: 'member with no ACL cannot comment on private doc',
		actor: actor(),
		action: 'doc.comment',
		resource: privateDoc(null),
		expect: { effect: 'deny', reason: 'no_acl' }
	},
	{
		name: 'admin bypasses private doc ACL for doc.comment — flagged for audit',
		actor: adminActor(),
		action: 'doc.comment',
		resource: privateDoc(null),
		expect: { effect: 'allow', via: 'role', auditedBypass: true }
	},
	{
		name: 'guest cannot read workspace-visible doc without ACL',
		actor: actor({ roleKey: 'guest', roleRank: ROLE_RANKS.guest, permissions: new Set() }),
		action: 'doc.read',
		resource: publicDoc,
		expect: { effect: 'deny', reason: 'no_acl' }
	},
	{
		name: 'guest cannot invite members',
		actor: actor({ roleKey: 'guest', roleRank: ROLE_RANKS.guest, permissions: new Set() }),
		action: 'member.invite',
		resource: wsResource,
		expect: { effect: 'deny', reason: 'insufficient_role' }
	},
	{
		name: 'guest gets no admin bypass even with manage-looking state',
		actor: actor({
			roleKey: 'guest',
			roleRank: ROLE_RANKS.guest,
			permissions: new Set(['doc.share'])
		}),
		action: 'doc.share',
		resource: privateDoc(null),
		expect: { effect: 'deny', reason: 'no_acl' }
	},

	// --- agents ---------------------------------------------------------------
	{
		name: 'agent within scope ceiling acts normally',
		actor: actor({
			kind: 'agent',
			agentScopeCeiling: new Set(['issue.read', 'issue.write'])
		}),
		action: 'issue.write',
		resource: { type: 'project', id: 'p1', visibility: 'workspace', acl: null },
		expect: { effect: 'allow', via: 'role' }
	},
	{
		name: 'agent beyond scope ceiling is denied despite role perms',
		actor: actor({
			kind: 'agent',
			agentScopeCeiling: new Set(['issue.read'])
		}),
		action: 'issue.write',
		resource: { type: 'project', id: 'p1', visibility: 'workspace', acl: null },
		expect: { effect: 'deny', reason: 'agent_scope' }
	},
	{
		name: 'agent ceiling blocks workspace admin actions',
		actor: adminActor({ kind: 'agent', agentScopeCeiling: new Set(['issue.read']) }),
		action: 'member.manage',
		resource: wsResource,
		expect: { effect: 'deny', reason: 'agent_scope' }
	},

	// --- imports -------------------------------------------------------------
	{
		name: 'owner can run bulk imports',
		actor: actor({ roleKey: 'owner', roleRank: ROLE_RANKS.owner, permissions: new Set(ACTIONS) }),
		action: 'import.run',
		resource: wsResource,
		expect: { effect: 'allow', via: 'role' }
	},
	{
		name: 'admin can run bulk imports',
		actor: adminActor(),
		action: 'import.run',
		resource: wsResource,
		expect: { effect: 'allow', via: 'role' }
	},
	{
		name: 'member cannot run bulk imports',
		actor: actor(),
		action: 'import.run',
		resource: wsResource,
		expect: { effect: 'deny', reason: 'insufficient_role' }
	},
	{
		name: 'guest cannot run bulk imports',
		actor: actor({ roleKey: 'guest', roleRank: ROLE_RANKS.guest, permissions: new Set() }),
		action: 'import.run',
		resource: wsResource,
		expect: { effect: 'deny', reason: 'insufficient_role' }
	},
	{
		name: 'agent ceiling blocks import.run unless explicitly granted',
		actor: adminActor({ kind: 'agent', agentScopeCeiling: new Set(['issue.read']) }),
		action: 'import.run',
		resource: wsResource,
		expect: { effect: 'deny', reason: 'agent_scope' }
	},

	// --- M4 chat, files & webhooks/integrations settings ----------------------
	{
		name: 'member reads and posts in workspace-visible channel',
		actor: actor(),
		action: 'channel.post',
		resource: { type: 'channel', id: 'c1', visibility: 'workspace', acl: null },
		expect: { effect: 'allow', via: 'role' }
	},
	{
		name: 'member cannot manage channel without channel.manage perm',
		actor: actor(),
		action: 'channel.manage',
		resource: { type: 'channel', id: 'c1', visibility: 'workspace', acl: null },
		expect: { effect: 'deny', reason: 'insufficient_role' }
	},
	{
		name: 'member with manage ACL manages private channel',
		actor: actor(),
		action: 'channel.manage',
		resource: privateChannel('manage'),
		expect: { effect: 'allow', via: 'acl' }
	},
	{
		name: 'member with write ACL cannot manage private channel',
		actor: actor(),
		action: 'channel.manage',
		resource: privateChannel('write'),
		expect: { effect: 'deny', reason: 'no_acl' }
	},
	{
		name: 'guest with read ACL can read private channel but cannot post',
		actor: actor({ roleKey: 'guest', roleRank: ROLE_RANKS.guest, permissions: new Set() }),
		action: 'channel.post',
		resource: privateChannel('read'),
		expect: { effect: 'deny', reason: 'no_acl' }
	},
	{
		name: 'guest with write ACL can post to private channel',
		actor: actor({ roleKey: 'guest', roleRank: ROLE_RANKS.guest, permissions: new Set() }),
		action: 'channel.post',
		resource: privateChannel('write'),
		expect: { effect: 'allow', via: 'acl' }
	},
	{
		name: 'member cannot manage webhooks or GitHub installations (settings.manage)',
		actor: actor(),
		action: 'settings.manage',
		resource: wsResource,
		expect: { effect: 'deny', reason: 'insufficient_role' }
	},
	{
		name: 'admin can manage webhooks and GitHub installations (settings.manage)',
		actor: adminActor(),
		action: 'settings.manage',
		resource: wsResource,
		expect: { effect: 'allow', via: 'role' }
	},
	{
		name: 'member can upload and read workspace files',
		actor: actor(),
		action: 'file.write',
		resource: { type: 'channel', id: 'c1', visibility: 'workspace', acl: null },
		expect: { effect: 'allow', via: 'role' }
	}
]

describe('policy can()', () => {
	test.each(CASES)('$name', ({ actor: a, action, resource, expect: expected }) => {
		expect(can(a, action, resource)).toEqual(expected)
	})

	test('deny-by-default: every action is denied for a member with zero permissions', () => {
		const nobody = actor({ permissions: new Set() })
		for (const action of ACTIONS) {
			for (const resource of [wsResource, publicDoc] as const) {
				const d = can(nobody, action, resource)
				expect(d.effect).toBe('deny')
			}
		}
	})
})
