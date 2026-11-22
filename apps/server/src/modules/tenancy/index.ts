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
import { HttpError } from '../../api/error'
import { CompleteSetupBody, CompleteSetupResponse, SetupStatusResponse } from './schema'
import { completeSetup, SetupError, setupStatus } from './setup'

export function tenancyGroup(sql: Sql, mode: 'selfhost' | 'cloud') {
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
						return await completeSetup(sql, body)
					} catch (err) {
						if (err instanceof SetupError) {
							const map = {
								already_configured: { status: 409, code: 'setup_completed' },
								invalid_token: { status: 403, code: 'forbidden' },
								slug_taken: { status: 409, code: 'conflict' }
							} as const
							const { status, code } = map[err.code]
							throw new HttpError(status, code, err.message)
						}
						throw err
					}
				}
			)
			// Auth seam — wired to Better Auth sessions in the auth increment.
			.get('/workspaces/current', () => {
				throw new HttpError(501, 'not_implemented', 'Sessions land with the auth increment')
			})
}
