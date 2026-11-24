/**
 * Agent bearer credential verification (§13.1, ADR-0019).
 *
 * Two audiences, never interchangeable:
 *   - 'mcp'  → `${HURIRO_URL}/mcp`            accepted only on /mcp (stage 3)
 *   - 'rest' → `${HURIRO_URL}/api/v1/agent`   accepted only on /api/v1/agent/*
 * Cookie sessions stay session-only and vice versa: this function validates
 * ONLY the Authorization bearer credential — a request with both credentials
 * is rejected earlier by requireWorkspaceRequest (credential_type_mismatch).
 *
 * Verification runs better-auth's resource-server machinery in-process:
 * issuer + audience + expiry + azp claims, signature against the instance
 * JWKS, and the DB-backed DPoP replay store (single-node default, ADR-0019).
 * Opaque tokens and tokens minted for the other audience fail the
 * signature/audience check → 401 with an RFC 6750/9728 WWW-Authenticate
 * challenge carried on the HttpError.
 */
import { requireMcpAuth } from '@better-auth/mcp'
import { AGENT_SCOPES } from '@huriro/domain'
import { HttpError } from '../../api/error'
import { log } from '../../api/observability'
import type { Auth } from './auth'

/** First-party public client for `huriro` CLI device-flow login (ADR-0019). */
export const HURIRO_CLI_CLIENT_ID = 'huriro-cli'

const OIDC_SCOPES = ['openid', 'profile', 'email', 'offline_access'] as const

export type AgentAudience = 'mcp' | 'rest'

export interface VerifiedAgentCredential {
	/** users.id of the user the token was issued to (the agent's owner). */
	readonly userId: string
	readonly clientId: string
	readonly scopes: readonly string[]
	/** JWT `jti` — used for per-tool-call audit (§13.6). */
	readonly tokenId: string | undefined
	readonly audience: AgentAudience
	/**
	 * API-key credentials carry their bound principal directly (`hrk_` keys
	 * are verified inside the tenant tx, ADR-0021) — OAuth credentials leave
	 * this undefined and resolve by (user, client) instead.
	 */
	readonly principalId?: string | undefined
}

export function agentAudienceUris(baseUrl: string): Record<AgentAudience, string> {
	const origin = baseUrl.replace(/\/+$/, '')
	return {
		mcp: `${origin}/mcp`,
		rest: `${origin}/api/v1/agent`
	}
}

export async function verifyAgentBearer(
	auth: Auth,
	request: Request,
	opts: { audience: AgentAudience }
): Promise<VerifiedAgentCredential> {
	const resource = agentAudienceUris(auth.options.baseURL ?? '')[opts.audience]
	const expectedAudience = new URL(resource).toString()

	let claims: Record<string, unknown> | undefined
	const gate = requireMcpAuth(
		auth as never,
		(_req, accessTokenClaims) => {
			claims = accessTokenClaims as unknown as Record<string, unknown>
			return new Response(null, { status: 204 })
		},
		{ resource: expectedAudience }
	)
	const res = await gate(request)

	if (res.status !== 204 || !claims) {
		const challenge = res.headers.get('www-authenticate')
		const headers = challenge ? { 'www-authenticate': challenge } : undefined
		if (res.status === 403) {
			throw new HttpError(
				403,
				'forbidden',
				'Agent credential lacks the required scope',
				undefined,
				undefined,
				headers
			)
		}
		throw new HttpError(
			401,
			'token_audience_mismatch',
			'Missing or invalid agent access token for this resource',
			undefined,
			undefined,
			headers
		)
	}

	const scopeClaim = claims['scope']
	const clientId = (claims['azp'] ?? claims['client_id']) as string | undefined
	const userId = claims['sub'] as string | undefined
	if (!userId || !clientId) {
		throw new HttpError(401, 'unauthorized', 'Agent access token is missing required claims')
	}
	return {
		userId,
		clientId,
		scopes: typeof scopeClaim === 'string' ? scopeClaim.split(' ').filter(Boolean) : [],
		tokenId: claims['jti'] as string | undefined,
		audience: opts.audience
	}
}

/**
 * Idempotent boot seed: the two resource identifiers plus the first-party
 * `huriro-cli` public client (device grant only, no consent skip). No DCR —
 * every client row is either this seed or a CIMD document.
 */
export async function ensureAgentOAuthSeed(auth: Auth): Promise<void> {
	const ctx = await auth.$context
	const adapter = ctx.adapter
	const audiences = agentAudienceUris(auth.options.baseURL ?? '')

	const resources: { identifier: string; name: string; allowedScopes: string[] }[] = [
		{
			identifier: audiences.mcp,
			name: 'Huriro MCP',
			allowedScopes: [...OIDC_SCOPES, ...AGENT_SCOPES]
		},
		{ identifier: audiences.rest, name: 'Huriro Agent API', allowedScopes: [...AGENT_SCOPES] }
	]
	for (const res of resources) {
		const existing = await adapter.findOne<Record<string, unknown>>({
			model: 'oauthResource',
			where: [{ field: 'identifier', value: res.identifier }]
		})
		if (!existing) {
			await adapter.create({
				model: 'oauthResource',
				data: {
					identifier: res.identifier,
					name: res.name,
					allowedScopes: res.allowedScopes,
					createdAt: new Date(),
					updatedAt: new Date()
				}
			})
		}
	}

	const existingClient = await adapter.findOne<Record<string, unknown>>({
		model: 'oauthClient',
		where: [{ field: 'clientId', value: HURIRO_CLI_CLIENT_ID }]
	})
	if (!existingClient) {
		await adapter.create({
			model: 'oauthClient',
			data: {
				clientId: HURIRO_CLI_CLIENT_ID,
				name: 'Huriro CLI',
				tokenEndpointAuthMethod: 'none',
				// Device grant only — public client, no secret, no consent skip.
				grantTypes: ['urn:ietf:params:oauth:grant-type:device_code', 'refresh_token'],
				scopes: [...OIDC_SCOPES, ...AGENT_SCOPES],
				redirectUris: [],
				disabled: false,
				skipConsent: false,
				createdAt: new Date(),
				updatedAt: new Date()
			}
		})
	}

	// enforcePerClientResources: the CLI may mint for the REST agent surface
	// (its sole purpose); it is deliberately NOT linked to /mcp.
	for (const identifier of [audiences.rest]) {
		const linked = await adapter.findOne<Record<string, unknown>>({
			model: 'oauthClientResource',
			where: [
				{ field: 'clientId', value: HURIRO_CLI_CLIENT_ID },
				{ field: 'resourceId', value: identifier }
			]
		})
		if (!linked) {
			await adapter.create({
				model: 'oauthClientResource',
				data: { clientId: HURIRO_CLI_CLIENT_ID, resourceId: identifier, createdAt: new Date() }
			})
		}
	}
	log.info({ clientId: HURIRO_CLI_CLIENT_ID }, 'agent OAuth seed ensured')
}

/**
 * Revoke every OAuth artifact tying a user to an agent client: consent
 * grants plus refresh + access tokens (SS13.1b, connected-apps). Called when
 * a principal is revoked or an owner disconnects a connected app.
 */
export async function revokeAgentGrants(auth: Auth, userId: string, clientId: string): Promise<void> {
	const ctx = await auth.$context
	const adapter = ctx.adapter as unknown as {
		deleteMany(args: { model: string; where: { field: string; value: string }[] }): Promise<unknown>
	}
	const where = [
		{ field: 'userId', value: userId },
		{ field: 'clientId', value: clientId }
	]
	for (const model of ['oauthConsent', 'oauthRefreshToken', 'oauthAccessToken']) {
		await adapter.deleteMany({ model, where })
	}
}
