/**
 * Tenancy controller & cross-module seam (§5.4, §7.2).
 *
 * The controller is an Elysia instance — 1 instance = 1 controller. Session-only
 * routes (setup, invitations, workspace discovery) precede the
 * `.derive(workspaceDerive)` call; routes after it get `workspaceCtx` +
 * `inWorkspace` (session + X-Workspace-Id + tenant tx + actor, resolved once
 * per request). The app's request-id/error hooks still cover all routes:
 * parent hooks reach children via `.use()`.
 */

import { type Sql, withSystem } from '@huriro/db'
import type { AclResourceType } from '@huriro/domain'
import { Elysia } from 'elysia'
import { HttpError } from '../../api/error'
import type { RealtimePubSub } from '../../realtime/pubsub'
import { type Auth, requireSession } from '../identity/index'
import { canManageResourceAcl, canReadMembers } from './policy'
import { audit, getRoleIdByKey, listUserWorkspaces } from './repo'
import {
	AcceptBody,
	AclIdParam,
	AclListQuery,
	CompleteSetupBody,
	CompleteSetupResponse,
	CreateWorkspaceBody,
	CreateWorkspaceResponse,
	GrantAclBody,
	InviteBody,
	SetupStatusResponse
} from './schema'
import {
	acceptInvitation,
	createInvitation,
	createWorkspace,
	grantAcl,
	InvitationError,
	listAclEntriesForResource,
	listWorkspaceMembers,
	resolveActor,
	resolveResourceAcl,
	revokeAcl
} from './service'
import { completeSetup, SetupError, setupStatus } from './setup'
import { workspaceDerive } from './workspace'

export { TENANCY_EVENTS } from './events'
export type { WorkspaceScope } from './workspace'
export { workspaceDerive } from './workspace'
export { grantAcl, listWorkspaceMembers, resolveActor, resolveResourceAcl, revokeAcl }

const SetupErrorMap = {
	already_configured: { status: 409, code: 'setup_completed' },
	invalid_token: { status: 403, code: 'forbidden' },
	slug_taken: { status: 409, code: 'conflict' },
	auth_failed: { status: 502, code: 'internal' }
} as const

const InvitationErrorMap = {
	invalid: { status: 404, code: 'not_found' },
	email_mismatch: { status: 403, code: 'forbidden' },
	already_member: { status: 409, code: 'conflict' },
	not_pending: { status: 410, code: 'not_found' }
} as const

export function tenancyModule(
	sql: Sql,
	mode: 'selfhost' | 'cloud',
	auth: Auth | null,
	pubsub?: RealtimePubSub
) {
	return (
		new Elysia({ name: 'huriro.tenancy' })
			// ---- session-only routes (no X-Workspace-Id) ----
			.get('/setup/status', { response: SetupStatusResponse }, async () => {
				const { configured } = await setupStatus(sql)
				return { configured, mode }
			})
			.post('/setup', { body: CompleteSetupBody, response: CompleteSetupResponse }, async ({ body }) => {
				try {
					return await completeSetup(sql, auth, body)
				} catch (err) {
					if (err instanceof SetupError) {
						const { status, code } = SetupErrorMap[err.code]
						throw new HttpError(status, code, err.message)
					}
					throw err
				}
			})
			.get('/workspaces/current', async ({ request }) => {
				if (!auth) throw new HttpError(501, 'not_implemented', 'Auth not configured')
				const session = await requireSession(auth, request)
				return sql.begin(async (tx) => {
					await tx`SELECT set_config('app.user_id', ${session.userId}, true)`
					return { data: await listUserWorkspaces(tx, session.userId) }
				})
			})
			.post(
				'/workspaces',
				{ body: CreateWorkspaceBody, response: CreateWorkspaceResponse },
				async ({ body, request }) => {
					if (!auth) throw new HttpError(501, 'not_implemented', 'Auth not configured')
					const session = await requireSession(auth, request)
					const { configured } = await setupStatus(sql)
					if (!configured) {
						throw new HttpError(
							403,
							'setup_required',
							'Instance setup must be completed before creating workspaces'
						)
					}
					try {
						const created = await withSystem(sql, async (tx) => {
							await tx`SELECT set_config('app.user_id', ${session.userId}, true)`
							return createWorkspace(tx, {
								slug: body.slug,
								name: body.name,
								ownerUserId: session.userId
							})
						})
						return { id: created.id, slug: created.slug, name: body.name }
					} catch (err) {
						if (err instanceof Error && err.message.includes('workspaces_slug_key')) {
							throw new HttpError(409, 'conflict', 'That workspace slug is already in use')
						}
						throw err
					}
				}
			)
			.post('/invitations', { body: InviteBody }, async ({ body, request }) => {
				if (!auth) throw new HttpError(501, 'not_implemented', 'Auth not configured')
				const session = await requireSession(auth, request)
				return sql.begin(async (tx) => {
					await tx`SELECT set_config('app.workspace_id', ${body.workspaceId}, true)`
					await tx`SELECT set_config('app.user_id', ${session.userId}, true)`
					const roleKey = await tx<{ key: string }[]>`
						SELECT r.key FROM memberships m JOIN roles r ON r.id = m.role_id
						WHERE m.workspace_id = ${body.workspaceId} AND m.user_id = ${session.userId}
							AND m.status = 'active'
					`
					if (!roleKey[0] || !['owner', 'admin'].includes(roleKey[0].key)) {
						throw new HttpError(403, 'insufficient_role', 'Only owner/admin can invite members')
					}
					const roleId = await getRoleIdByKey(tx, body.workspaceId, body.role)
					if (!roleId) throw new HttpError(422, 'validation_failed', `Unknown role "${body.role}"`)
					return createInvitation(tx, {
						workspaceId: body.workspaceId,
						email: body.email,
						roleId,
						invitedBy: session.userId
					})
				})
			})
			.post('/invitations/accept', { body: AcceptBody }, async ({ body, request }) => {
				if (!auth) throw new HttpError(501, 'not_implemented', 'Auth not configured')
				const session = await requireSession(auth, request)
				try {
					return await sql.begin((tx) =>
						acceptInvitation(tx, { token: body.token, userId: session.userId, userEmail: session.email })
					)
				} catch (err) {
					if (err instanceof InvitationError) {
						const { status, code } = InvitationErrorMap[err.code]
						throw new HttpError(status, code, err.message)
					}
					throw err
				}
			})
			// ---- workspace-scoped routes: derived context below this line ----
			.derive(workspaceDerive(sql, auth))
			.get('/members', ({ workspaceCtx, inWorkspace }) =>
				inWorkspace(async (tx, actor) => {
					const decision = canReadMembers(actor)
					if (decision.effect !== 'allow') {
						throw new HttpError(403, 'insufficient_role', 'Membership read access denied')
					}
					return { data: await listWorkspaceMembers(tx, workspaceCtx.workspaceId) }
				})
			)
			.get('/acl', { query: AclListQuery }, ({ query, workspaceCtx, inWorkspace }) =>
				inWorkspace(async (tx, actor) => {
					const acl = await resolveResourceAcl(tx, {
						workspaceId: workspaceCtx.workspaceId,
						resourceType: query.resourceType,
						resourceId: query.resourceId,
						userId: workspaceCtx.session.userId
					})
					const decision = canManageResourceAcl(actor, query.resourceType, query.resourceId, acl)
					if (decision.effect !== 'allow') {
						throw new HttpError(403, 'insufficient_role', 'Cannot inspect ACLs for this resource')
					}
					if (decision.auditedBypass) {
						await audit(tx, {
							workspaceId: workspaceCtx.workspaceId,
							actorType: 'user',
							actorId: workspaceCtx.session.userId,
							action: 'acl.admin_bypass.read',
							targetType: query.resourceType,
							targetId: query.resourceId
						})
					}
					return {
						data: await listAclEntriesForResource(
							tx,
							workspaceCtx.workspaceId,
							query.resourceType,
							query.resourceId
						)
					}
				})
			)
			.post('/acl', { body: GrantAclBody }, async ({ body, workspaceCtx, inWorkspace }) => {
				const result = await inWorkspace(async (tx, actor) => {
					const acl = await resolveResourceAcl(tx, {
						workspaceId: workspaceCtx.workspaceId,
						resourceType: body.resourceType,
						resourceId: body.resourceId,
						userId: workspaceCtx.session.userId
					})
					const decision = canManageResourceAcl(actor, body.resourceType, body.resourceId, acl)
					if (decision.effect !== 'allow') {
						throw new HttpError(403, 'insufficient_role', 'Cannot manage ACLs for this resource')
					}
					if (decision.auditedBypass) {
						await audit(tx, {
							workspaceId: workspaceCtx.workspaceId,
							actorType: 'user',
							actorId: workspaceCtx.session.userId,
							action: 'acl.admin_bypass.grant',
							targetType: body.resourceType,
							targetId: body.resourceId
						})
					}
					return grantAcl(tx, {
						workspaceId: workspaceCtx.workspaceId,
						resourceType: body.resourceType,
						resourceId: body.resourceId,
						principalType: body.principalType,
						principalId: body.principalId ?? null,
						permission: body.permission,
						grantedBy: workspaceCtx.session.userId
					})
				})
				if (pubsub) await pubsub.publishCursor(workspaceCtx.workspaceId, result.cursor)
				return result.entry
			})
			.delete('/acl/:id', { params: AclIdParam }, async ({ params, workspaceCtx, inWorkspace }) => {
				const result = await inWorkspace(async (tx, actor) => {
					const [target] = await tx<{ resourceType: AclResourceType; resourceId: string }[]>`
							SELECT resource_type AS "resourceType", resource_id AS "resourceId"
							FROM acl_entries
							WHERE workspace_id = ${workspaceCtx.workspaceId} AND id = ${params.id}
						`
					if (!target) throw new HttpError(404, 'not_found', 'ACL entry not found')

					const acl = await resolveResourceAcl(tx, {
						workspaceId: workspaceCtx.workspaceId,
						resourceType: target.resourceType,
						resourceId: target.resourceId,
						userId: workspaceCtx.session.userId
					})
					const decision = canManageResourceAcl(actor, target.resourceType, target.resourceId, acl)
					if (decision.effect !== 'allow') {
						throw new HttpError(403, 'insufficient_role', 'Cannot revoke ACLs for this resource')
					}
					return revokeAcl(tx, {
						workspaceId: workspaceCtx.workspaceId,
						aclId: params.id,
						revokedBy: workspaceCtx.session.userId
					})
				})
				if (pubsub) {
					if (result.entry.principalType === 'user' && result.entry.principalId) {
						await pubsub.publishRevoke(workspaceCtx.workspaceId, result.entry.principalId, 'acl_revoked')
					}
					await pubsub.publishCursor(workspaceCtx.workspaceId, result.cursor)
				}
				return { revoked: true, id: params.id }
			})
	)
}
