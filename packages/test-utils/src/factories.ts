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

export interface SeedProject {
	readonly id: string
	readonly workspaceId: string
	readonly key: string
	readonly name: string
	readonly visibility: 'workspace' | 'private'
	readonly statusIds: Record<string, string>
}

export async function aProject(
	sql: Sql,
	args: {
		workspaceId: string
		key?: string
		name?: string
		visibility?: 'workspace' | 'private'
		createdBy?: string
	}
): Promise<SeedProject> {
	const n = seq()
	const key = args.key ?? `PRJ${n}`
	const name = args.name ?? `Project ${n}`
	const visibility = args.visibility ?? 'workspace'
	const [proj] = await sql<{ id: string }[]>`
		INSERT INTO projects (workspace_id, key, name, visibility, position, created_by)
		VALUES (${args.workspaceId}, ${key}, ${name}, ${visibility}, ${`V${n}`}, ${args.createdBy ?? null})
		RETURNING id
	`
	const projectId = proj!.id
	await sql`INSERT INTO issue_counters (workspace_id, project_id, next_number) VALUES (${args.workspaceId}, ${projectId}, 1)`

	const defaults = [
		{ name: 'Backlog', category: 'backlog', color: 'neutral', pos: 'B', isDefault: false },
		{ name: 'Todo', category: 'unstarted', color: 'info', pos: 'F', isDefault: true },
		{ name: 'In Progress', category: 'started', color: 'warning', pos: 'N', isDefault: false },
		{ name: 'Done', category: 'completed', color: 'success', pos: 'V', isDefault: false },
		{ name: 'Canceled', category: 'cancelled', color: 'danger', pos: 'd', isDefault: false }
	] as const
	const statusIds: Record<string, string> = {}
	for (const s of defaults) {
		const [st] = await sql<{ id: string }[]>`
			INSERT INTO project_statuses (workspace_id, project_id, name, category, color, position, is_default)
			VALUES (${args.workspaceId}, ${projectId}, ${s.name}, ${s.category}, ${s.color}, ${s.pos}, ${s.isDefault})
			RETURNING id
		`
		statusIds[s.name] = st!.id
	}
	return { id: projectId, workspaceId: args.workspaceId, key, name, visibility, statusIds }
}

export async function aProjectStatus(
	sql: Sql,
	args: {
		workspaceId: string
		projectId: string
		name?: string
		category?: 'backlog' | 'unstarted' | 'started' | 'completed' | 'cancelled'
		position?: string
		isDefault?: boolean
	}
): Promise<string> {
	const n = seq()
	const [row] = await sql<{ id: string }[]>`
		INSERT INTO project_statuses (workspace_id, project_id, name, category, position, is_default)
		VALUES (
			${args.workspaceId},
			${args.projectId},
			${args.name ?? `Status ${n}`},
			${args.category ?? 'unstarted'},
			${args.position ?? `Z${n}`},
			${args.isDefault ?? false}
		)
		RETURNING id
	`
	return row!.id
}

export async function aLabel(
	sql: Sql,
	args: { workspaceId: string; name?: string; color?: string }
): Promise<string> {
	const n = seq()
	const [row] = await sql<{ id: string }[]>`
		INSERT INTO labels (workspace_id, name, color)
		VALUES (${args.workspaceId}, ${args.name ?? `label-${n}`}, ${args.color ?? 'info'})
		RETURNING id
	`
	return row!.id
}

export async function aCycle(
	sql: Sql,
	args: { workspaceId: string; projectId: string; name?: string; startsAt?: string; endsAt?: string }
): Promise<string> {
	const n = seq()
	const [row] = await sql<{ id: string }[]>`
		INSERT INTO cycles (workspace_id, project_id, name, starts_at, ends_at)
		VALUES (
			${args.workspaceId},
			${args.projectId},
			${args.name ?? `Cycle ${n}`},
			${args.startsAt ?? '2026-11-01'},
			${args.endsAt ?? '2026-11-15'}
		)
		RETURNING id
	`
	return row!.id
}

export async function anIssue(
	sql: Sql,
	args: {
		workspaceId: string
		projectId: string
		statusId: string
		creatorId: string
		title?: string
		priority?: number
		assigneeId?: string | null
		assigneeType?: 'user' | 'agent' | null
		position?: string
	}
): Promise<{ id: string; number: number }> {
	const n = seq()
	const [cnt] = await sql<{ num: number }[]>`
		UPDATE issue_counters SET next_number = next_number + 1
		WHERE workspace_id = ${args.workspaceId} AND project_id = ${args.projectId}
		RETURNING next_number - 1 AS num
	`
	const num = cnt!.num
	const [row] = await sql<{ id: string }[]>`
		INSERT INTO issues (
			workspace_id, project_id, number, title, status_id, priority,
			assignee_type, assignee_id, creator_id, position
		)
		VALUES (
			${args.workspaceId},
			${args.projectId},
			${num},
			${args.title ?? `Test issue ${n}`},
			${args.statusId},
			${args.priority ?? 0},
			${args.assigneeType ?? null},
			${args.assigneeId ?? null},
			${args.creatorId},
			${args.position ?? `V${n}`}
		)
		RETURNING id
	`
	return { id: row!.id, number: num }
}

export async function anIssueComment(
	sql: Sql,
	args: { workspaceId: string; issueId: string; authorId: string; bodyText?: string }
): Promise<string> {
	const n = seq()
	const [row] = await sql<{ id: string }[]>`
		INSERT INTO issue_comments (workspace_id, issue_id, author_type, author_id, body_text)
		VALUES (${args.workspaceId}, ${args.issueId}, 'user', ${args.authorId}, ${args.bodyText ?? `Comment ${n}`})
		RETURNING id
	`
	return row!.id
}

export async function aNotification(
	sql: Sql,
	args: {
		workspaceId: string
		recipientUserId: string
		entityType: string
		entityId: string
		title?: string
		kind?:
			| 'issue.assigned'
			| 'issue.mentioned'
			| 'issue.commented'
			| 'issue.status_changed'
			| 'project.access_granted'
	}
): Promise<string> {
	const n = seq()
	const [row] = await sql<{ id: string }[]>`
		INSERT INTO notifications (
			workspace_id, recipient_user_id, actor_type, kind, entity_type, entity_id, title
		)
		VALUES (
			${args.workspaceId},
			${args.recipientUserId},
			'system',
			${args.kind ?? 'issue.assigned'},
			${args.entityType},
			${args.entityId},
			${args.title ?? `Notification ${n}`}
		)
		RETURNING id
	`
	return row!.id
}
