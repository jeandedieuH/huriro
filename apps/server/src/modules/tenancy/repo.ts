/**
 * Tenancy persistence. Every function takes the transaction handle from
 * withWorkspace/withSystem — never a raw pool — so queries can't escape tenant
 * scoping (§12.4).
 */
import type { Queryable } from '@huriro/db'

export interface WorkspaceRow {
	id: string
	slug: string
	name: string
}

export async function insertWorkspace(
	tx: Queryable,
	args: { slug: string; name: string }
): Promise<WorkspaceRow> {
	const [row] = await tx<WorkspaceRow[]>`
		INSERT INTO workspaces (slug, name) VALUES (${args.slug}, ${args.name})
		RETURNING id, slug, name
	`
	return row!
}

export async function insertRole(
	tx: Queryable,
	args: { workspaceId: string; key: string; name: string; rank: number }
): Promise<string> {
	const [row] = await tx<{ id: string }[]>`
		INSERT INTO roles (workspace_id, key, name, is_system, rank)
		VALUES (${args.workspaceId}, ${args.key}, ${args.name}, true, ${args.rank})
		RETURNING id
	`
	return row!.id
}

export async function insertRolePermission(
	tx: Queryable,
	args: { workspaceId: string; roleId: string; permission: string }
) {
	await tx`
		INSERT INTO role_permissions (workspace_id, role_id, permission)
		VALUES (${args.workspaceId}, ${args.roleId}, ${args.permission})
	`
}

export async function insertMembership(
	tx: Queryable,
	args: { workspaceId: string; userId: string; roleId: string }
): Promise<void> {
	// memberships' PK is (workspace_id, user_id) — no surrogate id to return.
	await tx`
		INSERT INTO memberships (workspace_id, user_id, role_id)
		VALUES (${args.workspaceId}, ${args.userId}, ${args.roleId})
	`
}

export async function insertUser(
	tx: Queryable,
	args: { email: string; displayName: string }
): Promise<string> {
	const [row] = await tx<{ id: string }[]>`
		INSERT INTO users (email, display_name)
		VALUES (${args.email}, ${args.displayName})
		RETURNING id
	`
	return row!.id
}

export async function findUserByEmail(tx: Queryable, email: string): Promise<{ id: string } | undefined> {
	const [row] = await tx<{ id: string }[]>`SELECT id FROM users WHERE email = ${email}`
	return row
}

// ---------- invitations ----------

export interface InvitationRow {
	id: string
	workspaceId: string
	email: string
	roleId: string
	status: string
	expiresAt: Date
}

export async function insertInvitation(
	tx: Queryable,
	args: {
		workspaceId: string
		email: string
		roleId: string
		tokenHash: string
		invitedBy: string
		expiresAt: Date
	}
): Promise<string> {
	const [row] = await tx<{ id: string }[]>`
		INSERT INTO invitations (workspace_id, email, role_id, token_hash, invited_by, expires_at)
		VALUES (${args.workspaceId}, ${args.email}, ${args.roleId}, ${args.tokenHash}, ${args.invitedBy}, ${args.expiresAt})
		RETURNING id
	`
	return row!.id
}

/** Pending, unexpired invite by token hash — the accept path's only lookup. */
export async function findPendingInvitation(
	tx: Queryable,
	tokenHash: string
): Promise<InvitationRow | undefined> {
	const [row] = await tx<InvitationRow[]>`
		SELECT id, workspace_id AS "workspaceId", email, role_id AS "roleId",
			status, expires_at AS "expiresAt"
		FROM invitations
		WHERE token_hash = ${tokenHash} AND status = 'pending' AND expires_at > now()
		FOR UPDATE
	`
	return row
}

export async function markInvitationAccepted(tx: Queryable, id: string) {
	await tx`
		UPDATE invitations SET status = 'accepted', accepted_at = now()
		WHERE id = ${id} AND status = 'pending'
	`
}

export async function getRoleIdByKey(tx: Queryable, workspaceId: string, key: string) {
	const [row] = await tx<{ id: string }[]>`
		SELECT id FROM roles WHERE workspace_id = ${workspaceId} AND key = ${key}
	`
	return row!.id
}

export async function getMembershipRoleKey(tx: Queryable, workspaceId: string, userId: string) {
	const [row] = await tx<{ key: string }[]>`
		SELECT r.key FROM memberships m JOIN roles r ON r.id = m.role_id
		WHERE m.workspace_id = ${workspaceId} AND m.user_id = ${userId} AND m.status = 'active'
	`
	return row?.key
}

export async function listUserWorkspaces(tx: Queryable, userId: string) {
	return tx<{ id: string; slug: string; name: string; roleKey: string }[]>`
		SELECT w.id, w.slug, w.name, r.key AS "roleKey"
		FROM memberships m
		JOIN workspaces w ON w.id = m.workspace_id
		JOIN roles r ON r.id = m.role_id
		WHERE m.user_id = ${userId} AND m.status = 'active' AND w.deleted_at IS NULL
		ORDER BY w.name
	`
}

/** Append to the transactional outbox — same tx as the domain write (§4.3). */
export async function emitEvent(
	tx: Queryable,
	args: {
		aggregate: string
		aggregateId?: string
		eventType: string
		workspaceId?: string
		payload: Record<string, unknown>
	}
) {
	await tx`
		INSERT INTO outbox (workspace_id, aggregate, aggregate_id, event_type, payload)
		VALUES (
			${args.workspaceId ?? null}, ${args.aggregate}, ${args.aggregateId ?? null},
			${args.eventType}, ${tx.json(args.payload)}
		)
	`
}

/** Append-only audit row (§12.8). Never update or delete these. */
export async function audit(
	tx: Queryable,
	args: {
		workspaceId?: string
		actorType: 'user' | 'api_key' | 'agent' | 'system'
		actorId?: string
		action: string
		targetType?: string
		targetId?: string
		metadata?: Record<string, unknown>
	}
) {
	await tx`
		INSERT INTO audit_log (workspace_id, actor_type, actor_id, action, target_type, target_id, metadata)
		VALUES (
			${args.workspaceId ?? null}, ${args.actorType}, ${args.actorId ?? null}, ${args.action},
			${args.targetType ?? null}, ${args.targetId ?? null}, ${tx.json(args.metadata ?? {})}
		)
	`
}

export async function getSetting(tx: Queryable, key: string): Promise<unknown> {
	const [row] = await tx<{ value: unknown }[]>`SELECT value FROM instance_settings WHERE key = ${key}`
	return row?.value
}

export async function putSetting(tx: Queryable, key: string, value: unknown) {
	await tx`
		INSERT INTO instance_settings (key, value) VALUES (${key}, ${tx.json(value as never)})
		ON CONFLICT (key) DO UPDATE SET value = EXCLUDED.value, updated_at = now()
	`
}

// ---------- Actor & ACL resolution (§12.3, §12.5) ----------

export interface MembershipSummaryRow {
	readonly userId: string
	readonly email: string
	readonly displayName: string
	readonly avatarUrl: string | null
	readonly roleId: string
	readonly roleKey: string
	readonly roleRank: number
	readonly status: 'active' | 'suspended'
}

export async function getActorMembershipAndPermissions(
	tx: Queryable,
	workspaceId: string,
	userId: string
): Promise<{
	roleId: string
	roleKey: string
	roleRank: number
	status: 'active' | 'suspended'
	permissions: string[]
} | null> {
	const [row] = await tx<
		{
			roleId: string
			roleKey: string
			roleRank: number
			status: 'active' | 'suspended'
		}[]
	>`
		SELECT m.role_id AS "roleId", r.key AS "roleKey", r.rank AS "roleRank", m.status
		FROM memberships m
		JOIN roles r ON r.workspace_id = m.workspace_id AND r.id = m.role_id
		WHERE m.workspace_id = ${workspaceId} AND m.user_id = ${userId}
	`
	if (!row) return null

	const perms = await tx<{ permission: string }[]>`
		SELECT permission FROM role_permissions
		WHERE workspace_id = ${workspaceId} AND role_id = ${row.roleId}
	`
	return {
		...row,
		permissions: perms.map((p) => p.permission)
	}
}

export async function listResourceAclLevelsForUser(
	tx: Queryable,
	args: {
		workspaceId: string
		resourceType: 'project' | 'doc_page' | 'channel' | 'mail_account'
		resourceId: string
		userId: string
	}
): Promise<('read' | 'comment' | 'write' | 'manage')[]> {
	const rows = await tx<{ permission: 'read' | 'comment' | 'write' | 'manage' }[]>`
		SELECT a.permission
		FROM acl_entries a
		WHERE a.workspace_id = ${args.workspaceId}
			AND a.resource_type = ${args.resourceType}
			AND a.resource_id = ${args.resourceId}
			AND (
				(a.principal_type = 'user' AND a.principal_id = ${args.userId})
				OR a.principal_type = 'workspace'
				OR (
					a.principal_type = 'role'
					AND a.principal_id = (
						SELECT m.role_id FROM memberships m
						WHERE m.workspace_id = ${args.workspaceId}
							AND m.user_id = ${args.userId}
							AND m.status = 'active'
					)
				)
			)
	`
	return rows.map((r) => r.permission)
}

export interface AclEntryRow {
	readonly id: string
	readonly workspaceId: string
	readonly resourceType: 'project' | 'doc_page' | 'channel' | 'mail_account'
	readonly resourceId: string
	readonly principalType: 'user' | 'role' | 'workspace'
	readonly principalId: string | null
	readonly permission: 'read' | 'comment' | 'write' | 'manage'
	readonly grantedBy: string | null
	readonly createdAt: string
}

export async function insertAclEntry(
	tx: Queryable,
	args: {
		workspaceId: string
		resourceType: 'project' | 'doc_page' | 'channel' | 'mail_account'
		resourceId: string
		principalType: 'user' | 'role' | 'workspace'
		principalId: string | null
		permission: 'read' | 'comment' | 'write' | 'manage'
		grantedBy: string
	}
): Promise<AclEntryRow> {
	const [existing] = await tx<AclEntryRow[]>`
		SELECT
			id,
			workspace_id AS "workspaceId",
			resource_type AS "resourceType",
			resource_id AS "resourceId",
			principal_type AS "principalType",
			principal_id AS "principalId",
			permission,
			granted_by AS "grantedBy",
			created_at::text AS "createdAt"
		FROM acl_entries
		WHERE workspace_id = ${args.workspaceId}
			AND resource_type = ${args.resourceType}
			AND resource_id = ${args.resourceId}
			AND principal_type = ${args.principalType}
			AND COALESCE(principal_id, '00000000-0000-7000-8000-000000000000'::uuid) =
				COALESCE(${args.principalId}::uuid, '00000000-0000-7000-8000-000000000000'::uuid)
			AND permission = ${args.permission}
	`
	if (existing) return existing

	const [row] = await tx<AclEntryRow[]>`
		INSERT INTO acl_entries (
			workspace_id, resource_type, resource_id, principal_type, principal_id, permission, granted_by
		)
		VALUES (
			${args.workspaceId}, ${args.resourceType}, ${args.resourceId},
			${args.principalType}, ${args.principalId}, ${args.permission}, ${args.grantedBy}
		)
		RETURNING
			id,
			workspace_id AS "workspaceId",
			resource_type AS "resourceType",
			resource_id AS "resourceId",
			principal_type AS "principalType",
			principal_id AS "principalId",
			permission,
			granted_by AS "grantedBy",
			created_at::text AS "createdAt"
	`
	if (!row) throw new Error('Failed to insert acl_entries row')
	return row
}

export async function listResourceAclEntries(
	tx: Queryable,
	workspaceId: string,
	resourceType: string,
	resourceId: string
): Promise<AclEntryRow[]> {
	return tx<AclEntryRow[]>`
		SELECT
			id,
			workspace_id AS "workspaceId",
			resource_type AS "resourceType",
			resource_id AS "resourceId",
			principal_type AS "principalType",
			principal_id AS "principalId",
			permission,
			granted_by AS "grantedBy",
			created_at::text AS "createdAt"
		FROM acl_entries
		WHERE workspace_id = ${workspaceId}
			AND resource_type = ${resourceType}
			AND resource_id = ${resourceId}
		ORDER BY created_at ASC
	`
}

export async function deleteAclEntryById(
	tx: Queryable,
	workspaceId: string,
	aclId: string
): Promise<AclEntryRow | null> {
	const [row] = await tx<AclEntryRow[]>`
		DELETE FROM acl_entries
		WHERE workspace_id = ${workspaceId} AND id = ${aclId}
		RETURNING
			id,
			workspace_id AS "workspaceId",
			resource_type AS "resourceType",
			resource_id AS "resourceId",
			principal_type AS "principalType",
			principal_id AS "principalId",
			permission,
			granted_by AS "grantedBy",
			created_at::text AS "createdAt"
	`
	return row ?? null
}

export async function listMembers(tx: Queryable, workspaceId: string): Promise<MembershipSummaryRow[]> {
	return tx<MembershipSummaryRow[]>`
		SELECT
			m.user_id AS "userId",
			u.email::text AS email,
			u.display_name AS "displayName",
			u.avatar_url AS "avatarUrl",
			m.role_id AS "roleId",
			r.key AS "roleKey",
			r.rank AS "roleRank",
			m.status
		FROM memberships m
		JOIN users u ON u.id = m.user_id AND u.deleted_at IS NULL
		JOIN roles r ON r.workspace_id = m.workspace_id AND r.id = m.role_id
		WHERE m.workspace_id = ${workspaceId}
		ORDER BY u.display_name ASC, u.email ASC
	`
}
