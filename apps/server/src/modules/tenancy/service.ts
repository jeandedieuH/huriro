/**
 * Tenancy write paths (§5.3): domain rows + outbox event + audit row + the
 * sync cursor allocated LAST — all inside one withWorkspace transaction.
 */

import type { Queryable } from '@huriro/db'
import { SYSTEM_ROLES } from '@huriro/domain'
import { TENANCY_EVENTS } from './events'
import { audit, emitEvent, insertMembership, insertRole, insertRolePermission, insertWorkspace } from './repo'

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
