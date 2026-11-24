/**
 * Dual-audience agent bearer integration test (§13.1, ADR-0019).
 *
 * A real better-auth instance over a migrated Testcontainers DB mints OAuth
 * access tokens through the provider's own issueTokens path, then
 * verifyAgentBearer enforces the audience split:
 *   ${HURIRO_URL}/mcp          ⇄   ${HURIRO_URL}/api/v1/agent
 * A token minted for one audience MUST be rejected by the other, in both
 * directions; opaque/expired/foreign-issuer/cookie credentials all fail.
 */
import { describe, expect, test } from 'bun:test'
import { getOAuthProviderApi } from '@better-auth/oauth-provider'
import { getTestDb } from '@huriro/test-utils'
import { HttpError } from '../api/error'
import type { Config } from '../env'
import {
	type Auth,
	agentAudienceUris,
	createAuth,
	ensureAgentOAuthSeed,
	HURIRO_CLI_CLIENT_ID,
	verifyAgentBearer
} from '../modules/identity'

const BASE = 'http://localhost:3000'
const DEVICE_GRANT = 'urn:ietf:params:oauth:grant-type:device_code'

function config(databaseAuthUrl: string, huriroUrl = BASE): Config {
	return {
		HURIRO_URL: huriroUrl,
		HURIRO_ENV: 'test',
		HURIRO_MODE: 'selfhost',
		databaseUrl: databaseAuthUrl,
		databaseAdminUrl: databaseAuthUrl,
		databaseAuthUrl,
		secretKey: 'a'.repeat(48),
		betterAuthSecret: 'b'.repeat(48),
		PASSKEY_RP_NAME: 'Huriro',
		PORT: 3001,
		WS_PORT: 3005,
		LOG_LEVEL: 'error',
		BLOB_STORE: 'fs',
		BLOB_DIR: '/tmp'
	} as Config
}

async function mintToken(
	auth: Auth,
	opts: { userId: string; scopes: string[]; resources: string[] }
): Promise<string> {
	const authContext = (await auth.$context) as never as Record<string, unknown>
	const plugins = (auth.options.plugins ?? []) as { id: string; options?: unknown }[]
	const provider = plugins.find((p) => p.id === 'oauth-provider')
	if (!provider?.options) throw new Error('oauth-provider plugin missing')
	const adapter = authContext['adapter'] as {
		findOne<T>(args: { model: string; where: { field: string; value: string }[] }): Promise<T>
	}
	const client = await adapter.findOne<Record<string, unknown>>({
		model: 'oauthClient',
		where: [{ field: 'clientId', value: HURIRO_CLI_CLIENT_ID }]
	})
	if (!client) throw new Error('huriro-cli client not seeded')
	const api = getOAuthProviderApi(
		{ context: authContext, json: (body: unknown) => body } as never,
		provider.options as never,
		DEVICE_GRANT as never
	)
	const issued = await api.issueTokens({
		client: client as never,
		user: { id: opts.userId } as never,
		scopes: opts.scopes,
		resources: opts.resources
	})
	return issued.access_token
}

function bearerRequest(token: string, headers: Record<string, string> = {}): Request {
	return new Request(`${BASE}/api/v1/agent/tools`, {
		method: 'POST',
		headers: { authorization: `Bearer ${token}`, ...headers }
	})
}

describe('agent bearer audience separation (M3 stage 1)', () => {
	test('audience split + rejection matrix', async () => {
		const db = await getTestDb()
		if (!db) return // no DATABASE_URL / testcontainers — skip
		let originalRestTtl: number | null = null
		let restoreAuth: Awaited<Auth['$context']> | null = null
		try {
			const auth = createAuth(config(db.url))
			await ensureAgentOAuthSeed(auth)
			const ctx = await auth.$context
			restoreAuth = ctx
			const user = await ctx.adapter.create<Record<string, unknown>>({
				model: 'user',
				data: { email: `owner-${Date.now()}@example.test`, name: 'Owner', emailVerified: true }
			})
			const userId = user['id'] as string

			const aud = agentAudienceUris(BASE)
			expect(aud.mcp).toBe(`${BASE}/mcp`)
			expect(aud.rest).toBe(`${BASE}/api/v1/agent`)

			// enforcePerClientResources is on: link the CLI to /mcp for this
			// test so it can mint an MCP-audience token too (an admin-link
			// equivalent — the seed deliberately grants it only /api/v1/agent).
			const mcpLink = await ctx.adapter.findOne({
				model: 'oauthClientResource',
				where: [
					{ field: 'clientId', value: HURIRO_CLI_CLIENT_ID },
					{ field: 'resourceId', value: aud.mcp }
				]
			})
			if (!mcpLink)
				await ctx.adapter.create({
					model: 'oauthClientResource',
					data: { clientId: HURIRO_CLI_CLIENT_ID, resourceId: aud.mcp, createdAt: new Date() }
				})

			const restToken = await mintToken(auth, {
				userId,
				scopes: ['tasks.read'],
				resources: [aud.rest]
			})
			const mcpToken = await mintToken(auth, {
				userId,
				scopes: ['tasks.read'],
				resources: [aud.mcp]
			})

			// --- accepts -------------------------------------------------------
			const restCred = await verifyAgentBearer(auth, bearerRequest(restToken), { audience: 'rest' })
			expect(restCred.userId).toBe(userId)
			expect(restCred.clientId).toBe(HURIRO_CLI_CLIENT_ID)
			expect(restCred.scopes).toContain('tasks.read')
			expect(restCred.audience).toBe('rest')

			const mcpCred = await verifyAgentBearer(auth, bearerRequest(mcpToken), { audience: 'mcp' })
			expect(mcpCred.audience).toBe('mcp')

			// --- cross-audience rejection, both directions ---------------------
			const cross = async (token: string, audience: 'mcp' | 'rest') => {
				const err = await verifyAgentBearer(auth, bearerRequest(token), { audience }).then(
					() => null,
					(e) => e as HttpError
				)
				expect(err).toBeInstanceOf(HttpError)
				expect(err?.status).toBe(401)
				expect(err?.headers?.['www-authenticate']).toBeTruthy()
			}
			await cross(mcpToken, 'rest')
			await cross(restToken, 'mcp')

			// --- opaque / missing aud ------------------------------------------
			const opaqueErr = await verifyAgentBearer(auth, bearerRequest('huriro-opaque-not-a-jwt'), {
				audience: 'rest'
			}).then(
				() => null,
				(e) => e as HttpError
			)
			expect(opaqueErr?.status).toBe(401)

			// --- expired -------------------------------------------------------
			const expiredToken = await mintToken(auth, {
				userId,
				scopes: ['tasks.read'],
				resources: [aud.rest]
			})
			// Re-minted with identical claims shares iat/exp — shrink the
			// resource TTL, mint a second token, and let it lapse.
			const restResource = await ctx.adapter.findOne<{ accessTokenTtl?: number | null }>({
				model: 'oauthResource',
				where: [{ field: 'identifier', value: aud.rest }]
			})
			originalRestTtl = restResource?.accessTokenTtl ?? null
			await ctx.adapter.update({
				model: 'oauthResource',
				where: [{ field: 'identifier', value: aud.rest }],
				update: { accessTokenTtl: 1 }
			})
			const shortLived = await mintToken(auth, {
				userId,
				scopes: ['tasks.read'],
				resources: [aud.rest]
			})
			void expiredToken
			await new Promise((r) => setTimeout(r, 1_300))
			const expiredErr = await verifyAgentBearer(auth, bearerRequest(shortLived), {
				audience: 'rest'
			}).then(
				() => null,
				(e) => e as HttpError
			)
			expect(expiredErr?.status).toBe(401)

			// --- wrong issuer --------------------------------------------------
			const foreign = createAuth(config(db.url, 'http://localhost:9999'))
			await ensureAgentOAuthSeed(foreign)
			const foreignToken = await mintToken(foreign, {
				userId,
				scopes: ['tasks.read'],
				resources: [`http://localhost:9999/api/v1/agent`]
			})
			const foreignErr = await verifyAgentBearer(auth, bearerRequest(foreignToken), {
				audience: 'rest'
			}).then(
				() => null,
				(e) => e as HttpError
			)
			expect(foreignErr?.status).toBe(401)

			// --- cookie sessions cannot act as agent bearer --------------------
			const signup = (await auth.api.signUpEmail({
				body: { email: `sess-${Date.now()}@example.test`, password: 'huriro-test-pw-123', name: 'Sess' }
			})) as { token?: string | null }
			expect(signup.token).toBeTruthy()
			const sessionAsBearer = await verifyAgentBearer(auth, bearerRequest(signup.token as string), {
				audience: 'rest'
			}).then(
				() => null,
				(e) => e as HttpError
			)
			expect(sessionAsBearer?.status).toBe(401)

			// --- cookie-only request is not an agent credential ----------------
			const cookieOnly = new Request(`${BASE}/api/v1/agent/tools`, {
				method: 'POST',
				headers: { cookie: 'better-auth.session_token=abc' }
			})
			const cookieErr = await verifyAgentBearer(auth, cookieOnly, { audience: 'rest' }).then(
				() => null,
				(e) => e as HttpError
			)
			expect(cookieErr?.status).toBe(401)
		} finally {
			// The test DB is shared with other suites in one `bun test` process: restore the
			// shortened resource TTL instead of stopping the pool.
			if (restoreAuth)
				await restoreAuth.adapter.update({
					model: 'oauthResource',
					where: [{ field: 'identifier', value: agentAudienceUris(BASE).rest }],
					update: { accessTokenTtl: originalRestTtl }
				})
		}
	}, 60_000)
})
