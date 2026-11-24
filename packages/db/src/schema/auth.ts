// Better Auth tables — owned by the `identity` module, living in the `auth`
// PG schema (§8.3, ADR-0003). Only the `huriro_auth` role may touch them:
// session/token lookups happen before any tenant context exists, so these
// tables are deliberately outside the tenant-RLS perimeter — and the auth
// role gets NO grants on tenant tables in return.
//
// `users` itself stays in public (tenancy joins on it); better-auth maps onto
// it via field mapping — see 0005_auth.sql.

import { boolean, integer, jsonb, pgSchema, text, timestamp, uuid } from 'drizzle-orm/pg-core'
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

// ---------- M3: OAuth provider / JWKS / device grant (migration 0012) ----------
// Column set mirrors the better-auth plugin schema (oauth-provider, jwt,
// device-authorization @ 1.7.25); drizzle property names must equal the
// better-auth camelCase field names — the adapter resolves by property name.

export const authJwks = authSchema.table('jwks', {
	id: text('id').primaryKey(),
	publicKey: text('public_key').notNull(),
	privateKey: text('private_key').notNull(),
	createdAt: timestamp('created_at', { withTimezone: true }).notNull(),
	expiresAt: timestamp('expires_at', { withTimezone: true }),
	alg: text('alg'),
	crv: text('crv')
})

export const authOauthClients = authSchema.table('oauth_client', {
	id: text('id').primaryKey(),
	clientId: text('client_id').notNull().unique(),
	clientSecret: text('client_secret'),
	clientDiscoveryId: text('client_discovery_id'),
	disabled: boolean('disabled'),
	skipConsent: boolean('skip_consent'),
	enableEndSession: boolean('enable_end_session'),
	subjectType: text('subject_type'),
	scopes: jsonb('scopes'),
	clientCredentialsScopes: jsonb('client_credentials_scopes'),
	userId: uuid('user_id').references(() => users.id, { onDelete: 'cascade' }),
	createdAt: timestamp('created_at', { withTimezone: true }),
	updatedAt: timestamp('updated_at', { withTimezone: true }),
	name: text('name'),
	uri: text('uri'),
	icon: text('icon'),
	contacts: jsonb('contacts'),
	tos: text('tos'),
	policy: text('policy'),
	softwareId: text('software_id'),
	softwareVersion: text('software_version'),
	softwareStatement: text('software_statement'),
	redirectUris: jsonb('redirect_uris').notNull(),
	postLogoutRedirectUris: jsonb('post_logout_redirect_uris'),
	backchannelLogoutUri: text('backchannel_logout_uri'),
	backchannelLogoutSessionRequired: boolean('backchannel_logout_session_required'),
	tokenEndpointAuthMethod: text('token_endpoint_auth_method'),
	applicationType: text('application_type'),
	jwks: text('jwks'),
	jwksUri: text('jwks_uri'),
	grantTypes: jsonb('grant_types'),
	responseTypes: jsonb('response_types'),
	requirePKCE: boolean('require_pkce'),
	dpopBoundAccessTokens: boolean('dpop_bound_access_tokens'),
	referenceId: text('reference_id'),
	metadata: jsonb('metadata')
})

export const authOauthResources = authSchema.table('oauth_resource', {
	id: text('id').primaryKey(),
	identifier: text('identifier').notNull().unique(),
	name: text('name').notNull(),
	accessTokenTtl: integer('access_token_ttl'),
	refreshTokenTtl: integer('refresh_token_ttl'),
	signingAlgorithm: text('signing_algorithm'),
	signingKeyId: text('signing_key_id'),
	allowedScopes: jsonb('allowed_scopes'),
	customClaims: jsonb('custom_claims'),
	dpopBoundAccessTokensRequired: boolean('dpop_bound_access_tokens_required'),
	disabled: boolean('disabled'),
	createdAt: timestamp('created_at', { withTimezone: true }),
	updatedAt: timestamp('updated_at', { withTimezone: true }),
	policyVersion: integer('policy_version'),
	metadata: jsonb('metadata')
})

export const authOauthClientResources = authSchema.table('oauth_client_resource', {
	id: text('id').primaryKey(),
	clientId: text('client_id')
		.notNull()
		.references(() => authOauthClients.clientId, { onDelete: 'cascade' }),
	resourceId: text('resource_id')
		.notNull()
		.references(() => authOauthResources.identifier, { onDelete: 'cascade' }),
	metadata: jsonb('metadata'),
	createdAt: timestamp('created_at', { withTimezone: true })
})

export const authOauthRefreshTokens = authSchema.table('oauth_refresh_token', {
	id: text('id').primaryKey(),
	token: text('token').notNull().unique(),
	clientId: text('client_id')
		.notNull()
		.references(() => authOauthClients.clientId, { onDelete: 'cascade' }),
	sessionId: text('session_id').references(() => authSessions.id, { onDelete: 'set null' }),
	userId: uuid('user_id')
		.notNull()
		.references(() => users.id, { onDelete: 'cascade' }),
	referenceId: text('reference_id'),
	authorizationCodeId: text('authorization_code_id'),
	resources: jsonb('resources'),
	requestedUserInfoClaims: jsonb('requested_user_info_claims'),
	expiresAt: timestamp('expires_at', { withTimezone: true }).notNull(),
	createdAt: timestamp('created_at', { withTimezone: true }).notNull(),
	revoked: timestamp('revoked', { withTimezone: true }),
	rotatedAt: timestamp('rotated_at', { withTimezone: true }),
	rotationReplayResponse: text('rotation_replay_response'),
	rotationReplayExpiresAt: timestamp('rotation_replay_expires_at', { withTimezone: true }),
	authTime: timestamp('auth_time', { withTimezone: true }),
	confirmation: jsonb('confirmation'),
	scopes: jsonb('scopes').notNull()
})

export const authOauthAccessTokens = authSchema.table('oauth_access_token', {
	id: text('id').primaryKey(),
	token: text('token').notNull().unique(),
	clientId: text('client_id')
		.notNull()
		.references(() => authOauthClients.clientId, { onDelete: 'cascade' }),
	sessionId: text('session_id').references(() => authSessions.id, { onDelete: 'set null' }),
	userId: uuid('user_id').references(() => users.id, { onDelete: 'cascade' }),
	referenceId: text('reference_id'),
	authorizationCodeId: text('authorization_code_id'),
	resources: jsonb('resources'),
	requestedUserInfoClaims: jsonb('requested_user_info_claims'),
	refreshId: text('refresh_id').references(() => authOauthRefreshTokens.id, { onDelete: 'cascade' }),
	expiresAt: timestamp('expires_at', { withTimezone: true }).notNull(),
	createdAt: timestamp('created_at', { withTimezone: true }).notNull(),
	revoked: timestamp('revoked', { withTimezone: true }),
	confirmation: jsonb('confirmation'),
	scopes: jsonb('scopes').notNull()
})

export const authOauthConsents = authSchema.table('oauth_consent', {
	id: text('id').primaryKey(),
	clientId: text('client_id')
		.notNull()
		.references(() => authOauthClients.clientId, { onDelete: 'cascade' }),
	userId: uuid('user_id').references(() => users.id, { onDelete: 'cascade' }),
	referenceId: text('reference_id'),
	resources: jsonb('resources'),
	requestedUserInfoClaims: jsonb('requested_user_info_claims'),
	scopes: jsonb('scopes').notNull(),
	createdAt: timestamp('created_at', { withTimezone: true }).notNull(),
	updatedAt: timestamp('updated_at', { withTimezone: true }).notNull()
})

export const authOauthClientAssertions = authSchema.table('oauth_client_assertion', {
	id: text('id').primaryKey(),
	expiresAt: timestamp('expires_at', { withTimezone: true }).notNull()
})

export const authDeviceCodes = authSchema.table('device_code', {
	id: text('id').primaryKey(),
	deviceCode: text('device_code').notNull().unique(),
	userCode: text('user_code').notNull().unique(),
	userId: text('user_id'),
	expiresAt: timestamp('expires_at', { withTimezone: true }).notNull(),
	status: text('status').notNull(),
	lastPolledAt: timestamp('last_polled_at', { withTimezone: true }),
	pollingInterval: integer('polling_interval'),
	clientId: text('client_id'),
	scope: text('scope'),
	resources: jsonb('resources'),
	oauthClientId: text('oauth_client_id')
})

// Adapter mapping bundle — consumed by identity/auth.ts only. Keys are the
// better-auth model names; values are the drizzle tables in schema `auth`.
export const betterAuthSchema = {
	user: users,
	session: authSessions,
	account: authAccounts,
	verification: authVerifications,
	passkey: authPasskeys,
	twoFactor: authTwoFactors,
	jwks: authJwks,
	oauthClient: authOauthClients,
	oauthResource: authOauthResources,
	oauthClientResource: authOauthClientResources,
	oauthRefreshToken: authOauthRefreshTokens,
	oauthAccessToken: authOauthAccessTokens,
	oauthConsent: authOauthConsents,
	oauthClientAssertion: authOauthClientAssertions,
	deviceCode: authDeviceCodes
}
