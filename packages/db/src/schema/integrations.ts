// GitHub integration tables — owned by the `integrations` module (§5.4, §16.6).
import { sql } from 'drizzle-orm'
import {
	bigint,
	boolean,
	foreignKey,
	integer,
	jsonb,
	pgTable,
	text,
	timestamp,
	unique,
	uuid
} from 'drizzle-orm/pg-core'
import { users } from './identity'
import { issues, projects } from './tasks'
import { workspaces } from './tenancy'

export const githubInstallations = pgTable(
	'github_installations',
	{
		id: uuid('id').primaryKey().default(sql`uuidv7()`),
		workspaceId: uuid('workspace_id')
			.notNull()
			.references(() => workspaces.id, { onDelete: 'cascade' }),
		installationId: bigint('installation_id', { mode: 'number' }).notNull(),
		accountLogin: text('account_login').notNull(),
		repoFullName: text('repo_full_name').notNull(),
		projectId: uuid('project_id').notNull(),
		webhookSecretEncrypted: text('webhook_secret_encrypted').notNull(),
		accessTokenEncrypted: text('access_token_encrypted'),
		syncEnabled: boolean('sync_enabled').notNull().default(true),
		lastSyncedAt: timestamp('last_synced_at', { withTimezone: true }),
		createdBy: uuid('created_by').references(() => users.id, { onDelete: 'set null' }),
		createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
		updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
		version: integer('version').notNull().default(1)
	},
	(t) => [
		unique('uq_github_installations_ws_id').on(t.workspaceId, t.id),
		unique('uq_github_installations_ws_repo').on(t.workspaceId, t.repoFullName),
		foreignKey({
			columns: [t.workspaceId, t.projectId],
			foreignColumns: [projects.workspaceId, projects.id],
			name: 'fk_github_installations_project'
		}).onDelete('cascade')
	]
)

export const issueGithubLinks = pgTable(
	'issue_github_links',
	{
		id: uuid('id').primaryKey().default(sql`uuidv7()`),
		workspaceId: uuid('workspace_id')
			.notNull()
			.references(() => workspaces.id, { onDelete: 'cascade' }),
		issueId: uuid('issue_id').notNull(),
		installationId: uuid('installation_id').notNull(),
		repoFullName: text('repo_full_name').notNull(),
		githubIssueNumber: integer('github_issue_number').notNull(),
		githubIssueId: bigint('github_issue_id', { mode: 'number' }).notNull(),
		githubNodeId: text('github_node_id'),
		githubUrl: text('github_url').notNull(),
		sourceOfTruth: text('source_of_truth', { enum: ['huriro', 'github', 'bidirectional'] })
			.notNull()
			.default('bidirectional'),
		lastSyncedAt: timestamp('last_synced_at', { withTimezone: true }),
		lastSyncHash: text('last_sync_hash'),
		syncState: text('sync_state', { enum: ['synced', 'pending_push', 'push_failed'] })
			.notNull()
			.default('synced'),
		lastSyncError: text('last_sync_error'),
		createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
		updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow()
	},
	(t) => [
		unique('uq_issue_github_links_ws_id').on(t.workspaceId, t.id),
		unique('uq_issue_github_links_repo_num').on(t.workspaceId, t.repoFullName, t.githubIssueNumber),
		unique('uq_issue_github_links_issue_repo').on(t.workspaceId, t.issueId, t.repoFullName),
		foreignKey({
			columns: [t.workspaceId, t.issueId],
			foreignColumns: [issues.workspaceId, issues.id],
			name: 'fk_issue_github_links_issue'
		}).onDelete('cascade'),
		foreignKey({
			columns: [t.workspaceId, t.installationId],
			foreignColumns: [githubInstallations.workspaceId, githubInstallations.id],
			name: 'fk_issue_github_links_installation'
		}).onDelete('cascade')
	]
)

// System table: raw inbound webhook deliveries before workspace resolution (§16.6).
export const githubWebhookEvents = pgTable('github_webhook_events', {
	id: uuid('id').primaryKey().default(sql`uuidv7()`),
	deliveryId: text('delivery_id').notNull().unique(),
	installationId: bigint('installation_id', { mode: 'number' }),
	repoFullName: text('repo_full_name'),
	eventName: text('event_name').notNull(),
	payload: jsonb('payload').notNull(),
	status: text('status', { enum: ['pending', 'processed', 'ignored', 'failed'] })
		.notNull()
		.default('pending'),
	errorDetail: text('error_detail'),
	receivedAt: timestamp('received_at', { withTimezone: true }).notNull().defaultNow(),
	processedAt: timestamp('processed_at', { withTimezone: true })
})
