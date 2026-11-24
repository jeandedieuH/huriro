/**
 * Consent backend for the stage-6 consent screen (§13.1b).
 *
 * better-auth's OAuth flow redirects the user to `consentPage` (/oauth/consent)
 * with the FULL authorization query re-signed as `oauth_query` (`?…&sig=…`).
 * That signed query string is what these routes call `consent_code` — the page
 * just forwards `window.location.search`, so the server re-verifies the AS
 * signature on every read and decision and never trusts the page's own claims.
 *
 * Security invariants:
 *  - the client identity is read from the registered `oauthClient` record
 *    (CIMD-fetched through the SSRF-safe transport at authorize time), NEVER
 *    from anything the consent page posts
 *  - granted scopes ⊆ requested scopes, enforced server-side
 *  - write scopes require `allowWriteScopes: true` — a bare checkbox can't
 *    smuggle writes
 *  - `workspaceId` must be an ACTIVE membership of the session user; the
 *    principal is created with ceiling = granted scopes ∩ AGENT_SCOPES
 *  - deny only calls the AS deny path — no principal row, no grant
 */
import { verifyOAuthQueryParams } from '@better-auth/oauth-provider'
import type { Sql } from '@huriro/db'
import { withWorkspace } from '@huriro/db'
import { AGENT_SCOPES } from '@huriro/domain'
import { Elysia } from 'elysia'
import { Type } from 'typebox'
import { HttpError } from '../../api/error'
import type { Auth } from '../identity'
import { connectAgent } from './service'

const WRITE_RE = /\.write$/

interface ConsentParams {
	readonly clientId: string
	readonly requestedScopes: readonly string[]
	readonly raw: string
}

async function sessionOr401(auth: Auth, headers: Headers) {
	const session = await auth.api.getSession({ headers })
	if (!session?.user?.id) throw new HttpError(401, 'unauthorized', 'Sign in to review consent')
	return session
}

async function verifyConsentCode(auth: Auth, code: string): Promise<ConsentParams> {
	const ctx = await auth.$context
	const ok = await verifyOAuthQueryParams(code, ctx.secret)
	if (!ok) throw new HttpError(404, 'not_found', 'Unknown or expired consent request')
	const params = new URLSearchParams(code)
	const clientId = params.get('client_id') ?? ''
	if (!clientId) throw new HttpError(404, 'not_found', 'Unknown or expired consent request')
	return {
		clientId,
		requestedScopes: (params.get('scope') ?? '').split(' ').filter(Boolean),
		raw: code
	}
}

async function clientRecord(auth: Auth, clientId: string) {
	const ctx = await auth.$context
	const client = await ctx.adapter.findOne<{
		name?: string
		clientId?: string
		clientUri?: string
		logoUri?: string
	}>({
		model: 'oauthClient',
		where: [{ field: 'clientId', value: clientId }]
	})
	if (!client) throw new HttpError(404, 'not_found', 'Unknown client')
	const uri = client.clientUri ?? client.clientId ?? ''
	let host = ''
	try {
		host = new URL(uri).host
	} catch {
		host = ''
	}
	return {
		name: client.name ?? client.clientId ?? clientId,
		clientId: client.clientId ?? clientId,
		host,
		// `verified` means "registered record, not self-asserted": seeded or
		// fetched through cimd-transport's pinned-egress path at authorize time.
		verified: true,
		...(client.logoUri ? { logo: client.logoUri } : {})
	}
}

async function membershipsOf(sql: Sql, userId: string) {
	return sql.begin(async (tx) => {
		// Same pattern as mcp.ts: the memberships policy admits the user's own
		// rows under app.user_id; workspaces join rides the member policy.
		await tx`SELECT set_config('app.user_id', ${userId}, true)`
		return tx<{ workspaceId: string; name: string }[]>`
			SELECT m.workspace_id AS "workspaceId", w.name
			FROM memberships m JOIN workspaces w ON w.id = m.workspace_id
			WHERE m.user_id = ${userId} AND m.status = 'active'
			ORDER BY m.joined_at DESC
		`
	})
}

export function consentRoutes(sql: Sql, auth: Auth | null) {
	return new Elysia({ name: 'huriro.agents.consent' })
		.get(
			'/agents/consent/context',
			{ query: Type.Object({ consent_code: Type.String({ minLength: 10 }) }) },
			async ({ query, request }) => {
				if (!auth) throw new HttpError(501, 'not_implemented', 'Auth not configured')
				const session = await sessionOr401(auth, request.headers)
				const consent = await verifyConsentCode(auth, query.consent_code)
				const client = await clientRecord(auth, consent.clientId)
				const workspaces = await membershipsOf(sql, session.user.id)
				return {
					data: {
						client,
						requestedScopes: consent.requestedScopes.map((scope) => ({
							scope,
							description: AGENT_SCOPES.includes(scope as never) ? `${scope} agent scope` : 'OIDC scope',
							risk: WRITE_RE.test(scope) ? 'write' : 'read'
						})),
						workspaces
					}
				}
			}
		)
		.post(
			'/agents/consent/decision',
			{
				body: Type.Object({
					consentCode: Type.String({ minLength: 10 }),
					accept: Type.Boolean(),
					workspaceId: Type.String(),
					scopes: Type.Array(Type.String()),
					allowWriteScopes: Type.Boolean()
				})
			},
			async ({ body, request }) => {
				if (!auth) throw new HttpError(501, 'not_implemented', 'Auth not configured')
				const session = await sessionOr401(auth, request.headers)
				const consent = await verifyConsentCode(auth, body.consentCode)

				// granted ⊆ requested, and write scopes need the explicit opt-in.
				const requested = new Set(consent.requestedScopes)
				for (const scope of body.scopes) {
					if (!requested.has(scope)) {
						throw new HttpError(400, 'validation_failed', `scope not requested: ${scope}`)
					}
					if (WRITE_RE.test(scope) && !body.allowWriteScopes) {
						throw new HttpError(403, 'insufficient_scope', `write scope requires opt-in: ${scope}`)
					}
				}
				const memberships = await membershipsOf(sql, session.user.id)
				if (!memberships.some((m) => m.workspaceId === body.workspaceId)) {
					throw new HttpError(403, 'forbidden', 'Not an active member of that workspace')
				}

				const res = await auth.api.oauth2Consent({
					headers: request.headers,
					body: {
						accept: body.accept,
						scope: body.scopes.join(' '),
						oauth_query: consent.raw
					}
				})
				if (!body.accept) return { data: res }

				const agent = await withWorkspace(
					sql,
					{ workspaceId: body.workspaceId, userId: session.user.id },
					(tx) =>
						connectAgent(tx, {
							workspaceId: body.workspaceId,
							ownerUserId: session.user.id,
							clientId: consent.clientId,
							// name comes from the registered record, never the request.
							name: `Agent · ${consent.clientId}`,
							scopes: body.scopes
						})
				)
				return { data: { ...(res as object), agent } }
			}
		)
}
