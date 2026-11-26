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
import { ADMIN_BYPASS_RANK, can } from '@huriro/domain'
import { Elysia } from 'elysia'
import { HttpError } from '../../api/error'
import { log } from '../../api/observability'
import type { EmailPipeline } from '../../email'
import type { RealtimePubSub } from '../../realtime/pubsub'
import { type Auth, requireSession } from '../identity/index'
import { canManageResourceAcl, canReadMembers } from './policy'
import { audit, getRoleIdByKey, listUserWorkspaces } from './repo'
import {
	AcceptBody,
	AclIdParam,
	AclListQuery,
	AgentsSettingsBody,
	AgentsSettingsResponse,
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
import {
	type BootstrapTokenEnsureResult,
	completeSetup,
	ensureBootstrapSetupToken,
	hashSetupToken,
	rotateBootstrapSetupToken,
	SetupError,
	setupStatus
} from './setup'
import { workspaceDerive } from './workspace'

export { TENANCY_EVENTS } from './events'
export type { WorkspaceScope } from './workspace'
export { workspaceDerive } from './workspace'
export {
	type BootstrapTokenEnsureResult,
	ensureBootstrapSetupToken,
	grantAcl,
	hashSetupToken,
	listAclEntriesForResource,
	listWorkspaceMembers,
	resolveActor,
	resolveResourceAcl,
	revokeAcl,
	rotateBootstrapSetupToken,
	SetupError,
	setupStatus
}

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

/**
 * Authorize ACL read/grant/revoke for a resource.
 * Private `mail_inbox` resources cannot rely on `canManageResourceAcl` alone because workspace
 * members hold `mail.assign`, which `can()` treats as a manage-level bypass for `mail_inbox`.
 * Only the inbox owner, explicit `'manage'` ACL holders, or non-guest workspace admins (audited,
 * respecting agent scope ceilings) may manage private mail inbox ACLs.
 */
async function authorizeResourceAclManagement(
	tx: Parameters<typeof resolveResourceAcl>[0],
	actor: Parameters<typeof canManageResourceAcl>[0],
	workspaceId: string,
	userId: string,
	resourceType: AclResourceType,
	resourceId: string,
	auditAction: 'acl.admin_bypass.read' | 'acl.admin_bypass.grant' | 'acl.admin_bypass.revoke',
	denyMessage: string
): Promise<void> {
	const acl = await resolveResourceAcl(tx, {
		workspaceId,
		resourceType,
		resourceId,
		userId
	})
	const decision = canManageResourceAcl(actor, resourceType, resourceId, acl)
	if (decision.effect !== 'allow') {
		throw new HttpError(403, 'insufficient_role', denyMessage)
	}
	let auditedBypass = Boolean(decision.auditedBypass)
	if (resourceType === 'mail_inbox') {
		const [inbox] = await tx<{ visibility: string; ownerUserId: string | null }[]>`
			SELECT visibility, owner_user_id AS "ownerUserId"
			FROM mail_inboxes
			WHERE workspace_id = ${workspaceId} AND id = ${resourceId}
		`
		if (!inbox) {
			throw new HttpError(404, 'not_found', 'Mail inbox not found')
		}
		if (inbox.visibility === 'private') {
			if (actor.kind === 'agent' && actor.agentScopeCeiling && !actor.agentScopeCeiling.has('mail.assign')) {
				throw new HttpError(403, 'insufficient_role', denyMessage)
			}
			const isActiveNonGuest = actor.membership === 'active' && actor.roleKey !== 'guest'
			const isOwner = isActiveNonGuest && inbox.ownerUserId === actor.userId
			const hasManageAcl = acl === 'manage' && actor.membership === 'active'
			const canAdminBypass = isActiveNonGuest && actor.roleRank >= ADMIN_BYPASS_RANK
			auditedBypass = false
			if (!isOwner && !hasManageAcl) {
				if (!canAdminBypass) {
					throw new HttpError(403, 'resource_private', denyMessage)
				}
				auditedBypass = true
			}
		}
	}
	if (auditedBypass) {
		await audit(tx, {
			workspaceId,
			actorType: actor.kind === 'agent' ? 'agent' : 'user',
			actorId: actor.principalId,
			action: auditAction,
			targetType: resourceType,
			targetId: resourceId
		})
	}
}

export function tenancyModule(
	sql: Sql,
	mode: 'selfhost' | 'cloud',
	auth: Auth | null,
	pubsub?: RealtimePubSub,
	opts?: { readonly email?: EmailPipeline | undefined }
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
				const created = await sql
					.begin(async (tx) => {
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
						const invite = await createInvitation(tx, {
							workspaceId: body.workspaceId,
							email: body.email,
							roleId,
							invitedBy: session.userId
						})
						const [wsRow] = await tx<{ name: string }[]>`
						SELECT name FROM workspaces WHERE id = ${body.workspaceId}
					`
						const [inviterRow] = await tx<{ displayName: string }[]>`
						SELECT display_name AS "displayName" FROM users WHERE id = ${session.userId}
					`
						return {
							...invite,
							workspaceName: wsRow?.name ?? 'Huriro Workspace',
							inviterName: inviterRow?.displayName ?? session.email
						}
					})
					// Domain failures (e.g. inviting a seated member) become problem+json;
					// anything else still hits the global mapper as an unhandled 500.
					.catch((err) => {
						if (err instanceof InvitationError) {
							const { status, code } = InvitationErrorMap[err.code]
							throw new HttpError(status, code, err.message)
						}
						throw err
					})

				// Tri-state so clients can tell "no provider configured" apart from
				// "provider configured but delivery failed" — the failure detail stays
				// in server logs (§16.2); the wire only carries the coarse status.
				let emailStatus: 'sent' | 'not_configured' | 'failed' = 'not_configured'
				if (opts?.email?.configured) {
					try {
						const res = await opts.email.sendWorkspaceInvitation({
							to: body.email.toLowerCase(),
							workspaceName: created.workspaceName,
							inviterName: created.inviterName,
							role: body.role,
							inviteToken: created.token
						})
						emailStatus = res.skipped ? 'not_configured' : 'sent'
					} catch (err) {
						emailStatus = 'failed'
						log.warn({ err, invitationId: created.id }, 'workspace invitation email delivery failed')
					}
				}

				return {
					id: created.id,
					token: created.token,
					resent: created.resent,
					emailStatus,
					emailProvider: opts?.email?.provider ?? 'noop'
				}
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
			// Workspace kill switch for agent surfaces (§13.1b): mcp_enabled
			// lives in workspaces.settings, gated on settings.manage.
			.patch(
				'/settings/agents',
				{ body: AgentsSettingsBody, response: AgentsSettingsResponse },
				async ({ body, workspaceCtx, inWorkspace }) =>
					inWorkspace(async (tx, actor) => {
						if (can(actor, 'settings.manage', { type: 'workspace' }).effect !== 'allow') {
							throw new HttpError(403, 'insufficient_role', 'settings.manage required')
						}
						await tx`
							UPDATE workspaces
							SET settings = settings || jsonb_build_object('mcp_enabled', ${body.mcpEnabled}::boolean)
							WHERE id = ${workspaceCtx.workspaceId}
						`
						await audit(tx, {
							workspaceId: workspaceCtx.workspaceId,
							actorType: 'user',
							actorId: workspaceCtx.session.userId,
							action: 'settings.agents.update',
							targetType: 'workspace',
							metadata: { mcpEnabled: body.mcpEnabled }
						})
						return { mcpEnabled: body.mcpEnabled }
					})
			)
			.get('/acl', { query: AclListQuery }, ({ query, workspaceCtx, inWorkspace }) =>
				inWorkspace(async (tx, actor) => {
					await authorizeResourceAclManagement(
						tx,
						actor,
						workspaceCtx.workspaceId,
						workspaceCtx.session.userId,
						query.resourceType,
						query.resourceId,
						'acl.admin_bypass.read',
						'Cannot inspect ACLs for this resource'
					)
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
					await authorizeResourceAclManagement(
						tx,
						actor,
						workspaceCtx.workspaceId,
						workspaceCtx.session.userId,
						body.resourceType,
						body.resourceId,
						'acl.admin_bypass.grant',
						'Cannot manage ACLs for this resource'
					)
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

					await authorizeResourceAclManagement(
						tx,
						actor,
						workspaceCtx.workspaceId,
						workspaceCtx.session.userId,
						target.resourceType,
						target.resourceId,
						'acl.admin_bypass.revoke',
						'Cannot revoke ACLs for this resource'
					)
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
