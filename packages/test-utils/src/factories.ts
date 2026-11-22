/**
 * Typed factories (§21.3): `aUser()`, `aWorkspace()`, `aMembership()`…
 * Deterministic — a per-process counter seeds ids/slugs; the seed prints in
 * test output on failure.
 *
 * Factories write through the OWNER pool (superuser → bypasses RLS) because
 * fixture rows must exist before a tenant context can. Assertions always run
 * through the APP pool.
 */

import { randomUUID } from 'node:crypto'
import type { Sql } from '@huriro/db'
import { SYSTEM_ROLES } from '@huriro/domain'

let counter = 0
const seq = () => ++counter

export interface SeedUser {
	readonly id: string
	readonly email: string
}

export interface SeedWorkspace {
	readonly id: string
	readonly slug: string
	readonly roleIds: Record<string, string>
}

export async function aUser(
	sql: Sql,
	over: { email?: string; displayName?: string } = {}
): Promise<SeedUser> {
	const n = seq()
	const [row] = await sql<{ id: string; email: string }[]>`
		INSERT INTO users (email, display_name)
		VALUES (${over.email ?? `user-${n}@test.huriro.dev`}, ${over.displayName ?? `Test User ${n}`})
		RETURNING id, email
	`
	return row!
}

export async function aWorkspace(
	sql: Sql,
	over: { slug?: string; name?: string } = {}
): Promise<SeedWorkspace> {
	const n = seq()
	const [ws] = await sql<{ id: string; slug: string }[]>`
		INSERT INTO workspaces (slug, name)
		VALUES (${over.slug ?? `ws-${n}`}, ${over.name ?? `Workspace ${n}`})
		RETURNING id, slug
	`
	const roleIds: Record<string, string> = {}
	for (const role of SYSTEM_ROLES) {
		const [r] = await sql<{ id: string }[]>`
			INSERT INTO roles (workspace_id, key, name, is_system, rank)
			VALUES (${ws!.id}, ${role.key}, ${role.name}, true, ${role.rank})
			RETURNING id
		`
		roleIds[role.key] = r!.id
		for (const perm of role.permissions) {
			await sql`
				INSERT INTO role_permissions (workspace_id, role_id, permission)
				VALUES (${ws!.id}, ${r!.id}, ${perm})
			`
		}
	}
	// Every workspace owns a cursor row for sync (§8.5).
	await sql`INSERT INTO workspace_seq (workspace_id) VALUES (${ws!.id})`
	return { id: ws!.id, slug: ws!.slug, roleIds }
}

export async function aMembership(
	sql: Sql,
	args: { workspaceId: string; userId: string; roleId: string; status?: 'active' | 'suspended' }
): Promise<void> {
	await sql`
		INSERT INTO memberships (workspace_id, user_id, role_id, status)
		VALUES (${args.workspaceId}, ${args.userId}, ${args.roleId}, ${args.status ?? 'active'})
	`
}

export async function anAclEntry(
	sql: Sql,
	args: {
		workspaceId: string
		resourceType: 'project' | 'doc_page' | 'channel' | 'mail_account'
		resourceId?: string
		principalType: 'user' | 'role' | 'workspace'
		principalId?: string | null
		permission: 'read' | 'comment' | 'write' | 'manage'
		grantedBy?: string | null
	}
): Promise<string> {
	const [row] = await sql<{ id: string }[]>`
		INSERT INTO acl_entries
			(workspace_id, resource_type, resource_id, principal_type, principal_id, permission, granted_by)
		VALUES (
			${args.workspaceId}, ${args.resourceType}, ${args.resourceId ?? randomUUID()},
			${args.principalType}, ${args.principalId ?? null}, ${args.permission}, ${args.grantedBy ?? null}
		)
		RETURNING id
	`
	return row!.id
}

/** The canonical two-tenant fixture: user+workspace per tenant, member in both optionally. */
export async function seedTwoTenants(sql: Sql) {
	const userA = await aUser(sql)
	const wsA = await aWorkspace(sql)
	await aMembership(sql, { workspaceId: wsA.id, userId: userA.id, roleId: wsA.roleIds['owner']! })

	const userB = await aUser(sql)
	const wsB = await aWorkspace(sql)
	await aMembership(sql, { workspaceId: wsB.id, userId: userB.id, roleId: wsB.roleIds['owner']! })

	return { userA, wsA, userB, wsB }
}
