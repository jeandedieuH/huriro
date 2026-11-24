/**
 * Better Auth instance (ADR-0003, §8.3).
 *
 * Boundary: better-auth owns IDENTITY ONLY — credential verification, sessions,
 * passkeys, TOTP. Tenancy and authorization stay ours (memberships, roles, ACL,
 * RLS). The adapter runs on a dedicated `huriro_auth` pool: its reads precede
 * tenant context, so that role alone gets context-free `users` visibility —
 * and zero grants on tenant tables in return.
 *
 * Field mapping puts better-auth's `user` model directly on public.users
 * (name→display_name, image→avatar_url, emailVerified→email_verified,
 * twoFactorEnabled→mfa_enabled) — no shadow user table, no sync drift.
 */

import { cimd } from '@better-auth/cimd'
import { drizzleAdapter } from '@better-auth/drizzle-adapter'
import { mcp } from '@better-auth/mcp'
import { oauthDeviceAuthorization } from '@better-auth/oauth-provider'
import { passkey } from '@better-auth/passkey'
import { betterAuthSchema, createAppPool, drizzlePg, uuid7 } from '@huriro/db'
import { AGENT_SCOPES } from '@huriro/domain'
import { betterAuth } from 'better-auth'
import { jwt, twoFactor } from 'better-auth/plugins'
import { log } from '../../api/observability'
import { createEmailPipelineFromConfig, type EmailPipeline } from '../../email'
import type { Config } from '../../env'
import { createCimdFetch } from './cimd-transport'

export const SOCIAL_PROVIDER_IDS = ['google', 'github', 'apple'] as const
export type SocialProviderId = (typeof SOCIAL_PROVIDER_IDS)[number]

export function createAuth(config: Config, deps?: { readonly email?: EmailPipeline | undefined }) {
	const email = deps?.email ?? createEmailPipelineFromConfig(config)
	// The adapter's pool: huriro_auth in production, DATABASE_URL fallback in
	// dev (where the URL typically points at the superuser anyway).
	const authSql = createAppPool(config.databaseAuthUrl, { max: 4 })
	const db = drizzlePg(authSql)

	const baseUrl = config.HURIRO_URL
	const rpID = config.PASSKEY_RP_ID ?? new URL(baseUrl).hostname
	const origin = (config.PASSKEY_ORIGIN ?? baseUrl).split(',').map((o) => o.trim())

	const socialProviders: {
		google?: { clientId: string; clientSecret: string }
		github?: { clientId: string; clientSecret: string }
		apple?: { clientId: string; clientSecret: string; appBundleIdentifier?: string }
	} = {}

	if (config.GOOGLE_CLIENT_ID && config.googleClientSecret) {
		socialProviders.google = { clientId: config.GOOGLE_CLIENT_ID, clientSecret: config.googleClientSecret }
	}
	if (config.GITHUB_CLIENT_ID && config.githubClientSecret) {
		socialProviders.github = { clientId: config.GITHUB_CLIENT_ID, clientSecret: config.githubClientSecret }
	}
	if (config.APPLE_CLIENT_ID && config.appleClientSecret) {
		socialProviders.apple = {
			clientId: config.APPLE_CLIENT_ID,
			clientSecret: config.appleClientSecret,
			...(config.APPLE_APP_BUNDLE_IDENTIFIER
				? { appBundleIdentifier: config.APPLE_APP_BUNDLE_IDENTIFIER }
				: {})
		}
	}

	const publicOrigin = baseUrl.replace(/\/+$/, '')
	const mcpResource = `${publicOrigin}/mcp`
	const agentRestResource = `${publicOrigin}/api/v1/agent`

	return betterAuth({
		appName: config.PASSKEY_RP_NAME,
		baseURL: baseUrl,
		secret: config.betterAuthSecret ?? config.secretKey,
		// The jwt plugin's session-token endpoint stays off — OAuth tokens are
		// minted only through /oauth2/* with a resource audience (ADR-0019).
		disabledPaths: ['/token'],
		database: drizzleAdapter(db, {
			provider: 'pg',
			schema: betterAuthSchema,
			// Auth field → drizzle property name on public.users.
			usePlural: false
		}),
		user: {
			// Field mapping: better-auth model field → drizzle property name on
			// public.users (schema bundle key stays `user` — see schema/auth.ts).
			// NOTE: this map only reaches core user fields — plugin-contributed
			// fields (twoFactorEnabled) must be remapped via the plugin's own
			// `schema` option below.
			fields: {
				name: 'displayName',
				image: 'avatarUrl',
				emailVerified: 'emailVerified'
			},
			changeEmail: {
				enabled: true,
				sendChangeEmailConfirmation: async ({ user, newEmail, url }) => {
					try {
						await email.sendChangeEmailConfirmation({
							to: user.email,
							recipientName: user.name,
							currentEmail: user.email,
							newEmail,
							confirmUrl: url
						})
					} catch (err) {
						log.warn({ err, userId: user.id }, 'failed to deliver change email confirmation')
					}
				}
			}
		},
		advanced: {
			database: {
				// Keep every generated id in the platform's uuidv7 shape (§8.1).
				generateId: () => uuid7()
			}
		},
		emailAndPassword: {
			enabled: true,
			requireEmailVerification: Boolean(config.EMAIL_REQUIRE_VERIFICATION && email.configured),
			revokeSessionsOnPasswordReset: true,
			resetPasswordTokenExpiresIn: 3600,
			sendResetPassword: async ({ user, url }) => {
				try {
					await email.sendPasswordReset({
						to: user.email,
						recipientName: user.name,
						resetUrl: url,
						expiresInLabel: '1 hour'
					})
				} catch (err) {
					log.warn({ err, userId: user.id }, 'failed to deliver password reset email')
				}
			},
			onPasswordReset: async ({ user }) => {
				try {
					await email.sendPasswordChanged({
						to: user.email,
						recipientName: user.name
					})
				} catch (err) {
					log.warn({ err, userId: user.id }, 'failed to deliver password changed email')
				}
			}
		},
		emailVerification: {
			sendOnSignUp: email.configured,
			autoSignInAfterVerification: true,
			expiresIn: 86400,
			sendVerificationEmail: async ({ user, url }) => {
				try {
					await email.sendVerifyEmail({
						to: user.email,
						recipientName: user.name,
						verificationUrl: url,
						expiresInLabel: '24 hours'
					})
				} catch (err) {
					log.warn({ err, userId: user.id }, 'failed to deliver verification email')
				}
			}
		},
		socialProviders,
		account: {
			accountLinking: {
				enabled: true,
				trustedProviders: ['google', 'github', 'apple']
			}
		},
		plugins: [
			// Access-token JWTs are signed with the instance JWKS; session JWT
			// headers stay off (sessions remain cookie-only credentials).
			jwt({ disableSettingJwtHeader: true }),
			// mcp() IS the OAuth provider (a separate oauthProvider() cannot be
			// combined). One issuer, two audiences: the MCP resource plus the
			// REST agent surface — bound to distinct RFC 8707 resources so a
			// token minted for one is rejected by the other (ADR-0019).
			mcp({
				resource: mcpResource,
				loginPage: '/sign-in',
				// Consent screen lands with the OAuth UI in stage 6; the backend
				// redirects here and stage 6 implements it.
				consentPage: '/oauth/consent',
				scopes: ['openid', 'profile', 'email', 'offline_access', ...AGENT_SCOPES],
				resources: [
					{
						identifier: agentRestResource,
						name: 'Huriro Agent API',
						allowedScopes: [...AGENT_SCOPES]
					}
				],
				// No consent skip for anything beyond read — first-party CLI included.
				refreshTokenReuseInterval: 0,
				allowDynamicClientRegistration: false,
				// Clients must be explicitly linked to a resource before they can
				// request tokens for it; CIMD-registered clients get only /mcp.
				enforcePerClientResources: true,
				clientRegistrationDefaultResources: [mcpResource]
			}),
			cimd({
				metadataProfile: 'mcp-2026-07-28',
				fetchClientMetadataResource: createCimdFetch()
			}),
			oauthDeviceAuthorization({
				verificationUri: `${publicOrigin}/device`,
				expiresIn: '15m',
				interval: '5s'
			}),
			passkey({ rpID, rpName: config.PASSKEY_RP_NAME, origin }),
			twoFactor({
				issuer: config.PASSKEY_RP_NAME,
				// Plugin-added user fields bypass options.user.fields — map
				// twoFactorEnabled onto the existing mfa_enabled column here.
				schema: { user: { fields: { twoFactorEnabled: 'mfaEnabled' } } }
			})
		],
		session: {
			expiresIn: 60 * 60 * 24 * 7, // 7 days
			updateAge: 60 * 60 * 24, // roll daily
			cookieCache: { enabled: true, maxAge: 60 * 5 } // short JWS cache; DB stays source of truth
		},
		rateLimit: {
			// 'memory' — a rateLimit table would need a new migration; M0 runs
			// single-node where in-process counters suffice. Multi-replica cloud
			// rate-limiting moves to the shared cache (§13) when it exists.
			enabled: true,
			storage: 'memory'
		},
		// Apple posts form_post callbacks from https://appleid.apple.com — allow that origin only when enabled.
		trustedOrigins: [baseUrl, ...(socialProviders.apple ? ['https://appleid.apple.com'] : [])],
		logger: { level: 'warn' }
	})
}

export type Auth = ReturnType<typeof createAuth>

/** Return the ordered list of OAuth providers currently configured on this auth instance. */
export function getEnabledSocialProviders(auth: Auth | null): SocialProviderId[] {
	const configured = auth?.options.socialProviders
	if (!configured) return []
	return SOCIAL_PROVIDER_IDS.filter((id) => Boolean(configured[id]))
}
