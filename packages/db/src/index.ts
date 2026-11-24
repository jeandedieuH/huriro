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
export { listMigrationFiles, migrate, migrationsDir, pendingMigrations } from './migrate'
export { agentPrincipals } from './schema/agents'
export { aiCache, aiProviders, aiRuns, chunkEmbeddings, embeddingModels } from './schema/ai'
export {
	authAccounts,
	authPasskeys,
	authSchema as authPgSchema,
	authSessions,
	authTwoFactors,
	authVerifications,
	betterAuthSchema
} from './schema/auth'
export { billingSubscriptions, billingUsageSnapshots, billingWebhookEvents } from './schema/billing'
export {
	chatChannelMembers,
	chatChannels,
	chatLinkPreviews,
	chatMessageAttachments,
	chatMessageLinkPreviews,
	chatMessageReactions,
	chatMessages,
	chatReadState,
	chatThreadReadState
} from './schema/chat'
export {
	collabTickets,
	docComments,
	docFavorites,
	docPages,
	docRoomLeases,
	docState,
	docVersions
} from './schema/docs'
export { files } from './schema/files'
export { workspaceExports } from './schema/governance'
export { users } from './schema/identity'
export { importJobs, importMappings } from './schema/imports'
export { githubInstallations, githubWebhookEvents, issueGithubLinks } from './schema/integrations'
export {
	mailAccounts,
	mailConversationComments,
	mailConversationDocs,
	mailConversationEvents,
	mailConversations,
	mailConversationTasks,
	mailDrafts,
	mailIdentities,
	mailInboxes,
	mailMessageAttachments,
	mailMessages
} from './schema/mail'
export {
	mobilePushTokens,
	notificationDeliveryLog,
	notificationPreferences,
	notifications,
	webPushSubscriptions
} from './schema/notifications'
export { searchDocuments } from './schema/search'
export { realtimeTickets } from './schema/sync'
export {
	auditLog,
	changeLog,
	featureFlagOverrides,
	featureFlags,
	idempotencyKeys,
	instanceSettings,
	outbox,
	processedEvents,
	syncCursors,
	workspaceSeq
} from './schema/system'
export {
	cycles,
	issueComments,
	issueCounters,
	issueLabels,
	issueRelations,
	issues,
	labels,
	projectStatuses,
	projects,
	savedViews
} from './schema/tasks'
export { aclEntries, invitations, memberships, rolePermissions, roles, workspaces } from './schema/tenancy'
export { webhookDeliveries, webhookEndpoints } from './schema/webhooks'
