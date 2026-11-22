// Better Auth tables — owned by the `identity` module, living in the `auth`
// PG schema (§8.3, ADR-0003). Only the `huriro_auth` role may touch them:
// session/token lookups happen before any tenant context exists, so these
// tables are deliberately outside the tenant-RLS perimeter — and the auth
// role gets NO grants on tenant tables in return.
//
// `users` itself stays in public (tenancy joins on it); better-auth maps onto
// it via field mapping — see 0005_auth.sql.

import { boolean, integer, pgSchema, text, timestamp, uuid } from 'drizzle-orm/pg-core'
import { users } from './identity'

export const authSchema = pgSchema('auth')

export const authSessions = authSchema.table('session', {
	id: text('id').primaryKey(),
	userId: uuid('user_id')
		.notNull()
		.references(() => users.id, { onDelete: 'cascade' }),
	token: text('token').notNull().unique(),
	expiresAt: timestamp('expires_at', { withTimezone: true }).notNull(),
	ipAddress: text('ip_address'),
	userAgent: text('user_agent'),
	createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
	updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow()
})

export const authAccounts = authSchema.table('account', {
	id: text('id').primaryKey(),
	userId: uuid('user_id')
		.notNull()
		.references(() => users.id, { onDelete: 'cascade' }),
	accountId: text('account_id').notNull(),
	providerId: text('provider_id').notNull(),
	accessToken: text('access_token'),
	refreshToken: text('refresh_token'),
	idToken: text('id_token'),
	accessTokenExpiresAt: timestamp('access_token_expires_at', { withTimezone: true }),
	refreshTokenExpiresAt: timestamp('refresh_token_expires_at', { withTimezone: true }),
	scope: text('scope'),
	password: text('password'), // argon2/bcrypt hash for providerId='credential'
	createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
	updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow()
})

export const authVerifications = authSchema.table('verification', {
	id: text('id').primaryKey(),
	identifier: text('identifier').notNull(),
	value: text('value').notNull(),
	expiresAt: timestamp('expires_at', { withTimezone: true }).notNull(),
	createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
	updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow()
})

export const authPasskeys = authSchema.table('passkey', {
	id: text('id').primaryKey(),
	userId: uuid('user_id')
		.notNull()
		.references(() => users.id, { onDelete: 'cascade' }),
	name: text('name'),
	publicKey: text('public_key').notNull(),
	// better-auth 1.7 names this model field `credentialID` (capital D); the
	// drizzle property must match — the adapter schema check resolves by
	// property name, not column name.
	credentialID: text('credential_id').notNull(),
	counter: integer('counter').notNull().default(0),
	deviceType: text('device_type').notNull(),
	backedUp: boolean('backed_up').notNull().default(false),
	transports: text('transports'),
	aaguid: text('aaguid'),
	createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow()
})

export const authTwoFactors = authSchema.table('two_factor', {
	id: text('id').primaryKey(),
	userId: uuid('user_id')
		.notNull()
		.references(() => users.id, { onDelete: 'cascade' }),
	secret: text('secret').notNull(),
	backupCodes: text('backup_codes').notNull(),
	// better-auth 1.7 lockout bookkeeping (migration 0008).
	verified: boolean('verified').notNull().default(true),
	failedVerificationCount: integer('failed_verification_count').notNull().default(0),
	lockedUntil: timestamp('locked_until', { withTimezone: true })
})

// Adapter mapping bundle — consumed by identity/auth.ts only.
export const betterAuthSchema = {
	user: users,
	session: authSessions,
	account: authAccounts,
	verification: authVerifications,
	passkey: authPasskeys,
	twoFactor: authTwoFactors
}
