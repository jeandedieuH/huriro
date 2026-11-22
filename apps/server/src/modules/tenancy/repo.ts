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
): Promise<string> {
	const [row] = await tx<{ id: string }[]>`
		INSERT INTO memberships (workspace_id, user_id, role_id)
		VALUES (${args.workspaceId}, ${args.userId}, ${args.roleId})
		RETURNING id
	`
	return row!.id
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
