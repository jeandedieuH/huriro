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

import { drizzleAdapter } from '@better-auth/drizzle-adapter'
import { passkey } from '@better-auth/passkey'
import { betterAuthSchema, createAppPool, drizzlePg, uuid7 } from '@huriro/db'
import { betterAuth } from 'better-auth'
import { twoFactor } from 'better-auth/plugins'
import { log } from '../../api/observability'
import type { Config } from '../../env'

export function createAuth(config: Config) {
	// The adapter's pool: huriro_auth in production, DATABASE_URL fallback in
	// dev (where the URL typically points at the superuser anyway).
	const authSql = createAppPool(config.databaseAuthUrl, { max: 4 })
	const db = drizzlePg(authSql)

	const baseUrl = config.HURIRO_URL
	const rpID = config.PASSKEY_RP_ID ?? new URL(baseUrl).hostname
	const origin = (config.PASSKEY_ORIGIN ?? baseUrl).split(',').map((o) => o.trim())

	return betterAuth({
		appName: config.PASSKEY_RP_NAME,
		baseURL: baseUrl,
		secret: config.betterAuthSecret ?? config.secretKey,
		database: drizzleAdapter(db, {
			provider: 'pg',
			schema: betterAuthSchema,
			// Auth field → drizzle property name on public.users.
			usePlural: false
		}),
		user: {
			// Field mapping: better-auth model field → drizzle property name on
			// public.users (schema bundle key stays `user` — see schema/auth.ts).
			fields: {
				name: 'displayName',
				image: 'avatarUrl',
				emailVerified: 'emailVerified',
				twoFactorEnabled: 'mfaEnabled'
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
			// Mail pipeline lands in M3 — verification/reset sends are stubbed and
			// audited-logged until then; self-host signups still work.
			requireEmailVerification: false,
			sendResetPassword: async ({ user, url }) => {
				log.warn({ userId: user.id }, 'password reset requested — mail pipeline not configured (M3)')
				void url
			}
		},
		plugins: [
			passkey({ rpID, rpName: config.PASSKEY_RP_NAME, origin }),
			twoFactor({ issuer: config.PASSKEY_RP_NAME })
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
		trustedOrigins: [baseUrl],
		logger: { level: 'warn' }
	})
}

export type Auth = ReturnType<typeof createAuth>
