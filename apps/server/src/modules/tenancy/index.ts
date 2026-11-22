/**
 * Tenancy routes (§7.2 shape: index routes + schema/service/repo/policy/events).
 *
 * Session-gated endpoints return 501 until Better Auth lands in the auth
 * increment — the routes exist so the seam is visible and deny-path tests can
 * pin the behavior now.
 *
 * Exported as a `.group()` callback, not a plugin: Elysia v2 scopes plugin
 * hooks, and the app's request-id/error hooks must cover these routes.
 */

import type { Sql } from '@huriro/db'
import type { Elysia } from 'elysia'
import { Type } from 'typebox'
import { HttpError } from '../../api/error'
import { type Auth, requireSession } from '../identity/index'
import { getRoleIdByKey, listUserWorkspaces } from './repo'
import { CompleteSetupBody, CompleteSetupResponse, SetupStatusResponse } from './schema'
import { acceptInvitation, createInvitation, InvitationError } from './service'
import { completeSetup, SetupError, setupStatus } from './setup'

const InviteBody = Type.Object({
	workspaceId: Type.String({ format: 'uuid' }),
	email: Type.String({ format: 'email' }),
	role: Type.Union([Type.Literal('admin'), Type.Literal('member'), Type.Literal('guest')])
})

const AcceptBody = Type.Object({ token: Type.String({ minLength: 20 }) })

export function tenancyGroup(sql: Sql, mode: 'selfhost' | 'cloud', auth: Auth | null) {
	// `.group()` hands a prefix-parameterized Elysia whose generics don't
	// re-declare cleanly — accept unknown and narrow once inside. The inferred
	// chain return stays an Elysia, satisfying the group's AnyElysia contract.
	return (app: unknown) =>
		(app as Elysia)
			.get('/setup/status', { response: SetupStatusResponse }, async () => {
				const { configured } = await setupStatus(sql)
				return { configured, mode }
			})
			.post(
				'/setup',
				{ body: CompleteSetupBody, response: CompleteSetupResponse },
				async ({ body }: { body: import('typebox').Static<typeof CompleteSetupBody> }) => {
					try {
						return await completeSetup(sql, auth, body)
					} catch (err) {
						if (err instanceof SetupError) {
							const map = {
								already_configured: { status: 409, code: 'setup_completed' },
								invalid_token: { status: 403, code: 'forbidden' },
								slug_taken: { status: 409, code: 'conflict' },
								auth_failed: { status: 502, code: 'internal' }
							} as const
							const { status, code } = map[err.code]
							throw new HttpError(status, code, err.message)
						}
						throw err
					}
				}
			)
			// "My workspaces" — memberships' self-visibility clause serves this
			// before any tenant context exists; only user context is set.
			.get('/workspaces/current', async ({ request }: { request: Request }) => {
				if (!auth) throw new HttpError(501, 'not_implemented', 'Auth not configured')
				const session = await requireSession(auth, request)
				return sql.begin(async (tx) => {
					await tx`SELECT set_config('app.user_id', ${session.userId}, true)`
					return { data: await listUserWorkspaces(tx, session.userId) }
				})
			})
			// Invite a member — returns the token ONCE (mail pipeline is M3;
			// self-host operators share the link out-of-band until then).
			.post(
				'/invitations',
				{ body: InviteBody },
				async ({
					body,
					request
				}: {
					body: { workspaceId: string; email: string; role: 'admin' | 'member' | 'guest' }
					request: Request
				}) => {
					if (!auth) throw new HttpError(501, 'not_implemented', 'Auth not configured')
					const session = await requireSession(auth, request)
					return sql.begin(async (tx) => {
						await tx`SELECT set_config('app.workspace_id', ${body.workspaceId}, true)`
						await tx`SELECT set_config('app.user_id', ${session.userId}, true)`
						// Role-gate: only owner/admin (roles carrying workspace.manage)
						// may invite. Checked at the DB layer via the inviter's role.
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
				}
			)
			// Accept an invite — the token IS the capability; session pins identity.
			.post(
				'/invitations/accept',
				{ body: AcceptBody },
				async ({ body, request }: { body: { token: string }; request: Request }) => {
					if (!auth) throw new HttpError(501, 'not_implemented', 'Auth not configured')
					const session = await requireSession(auth, request)
					try {
						return await sql.begin((tx) =>
							acceptInvitation(tx, { token: body.token, userId: session.userId, userEmail: session.email })
						)
					} catch (err) {
						if (err instanceof InvitationError) {
							const map = {
								invalid: { status: 404, code: 'not_found' },
								email_mismatch: { status: 403, code: 'forbidden' },
								already_member: { status: 409, code: 'conflict' },
								not_pending: { status: 410, code: 'not_found' }
							} as const
							const { status, code } = map[err.code]
							throw new HttpError(status, code, err.message)
						}
						throw err
					}
				}
			)
}
