// @huriro/db public surface — all schema lives here (§7.2); apps never define tables.

// Re-exported so consumers build drizzle instances without carrying their own
// drizzle-orm dependency — one version source of truth lives in this package.
export { drizzle as drizzlePg } from 'drizzle-orm/postgres-js'
export type { PoolOptions, Queryable, Sql } from './client'
export { createAppPool, createOwnerPool, resolveSecret } from './client'
export type { WorkspaceContext } from './context'
export { currentContext, NIL_UUID, TenantContextError, withSystem, withWorkspace } from './context'
export { isAcceptableClientId, isUuid, isUuidV7, uuid7, uuid7TimestampMs } from './ids'
export type { AppliedMigration } from './migrate'
export { listMigrationFiles, migrate, pendingMigrations } from './migrate'
export { agentPrincipals } from './schema/agents'
export {
	authAccounts,
	authPasskeys,
	authSchema as authPgSchema,
	authSessions,
	authTwoFactors,
	authVerifications,
	betterAuthSchema
} from './schema/auth'
export { users } from './schema/identity'
export {
	auditLog,
	changeLog,
	featureFlagOverrides,
	featureFlags,
	files,
	idempotencyKeys,
	instanceSettings,
	outbox,
	processedEvents,
	syncCursors,
	workspaceSeq
} from './schema/system'
export { aclEntries, invitations, memberships, rolePermissions, roles, workspaces } from './schema/tenancy'
