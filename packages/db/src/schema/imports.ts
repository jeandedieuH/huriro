// Importers tables — owned by the `imports` module (§5.4, §17.13b).
import { sql } from 'drizzle-orm'
import { foreignKey, integer, jsonb, pgTable, text, timestamp, unique, uuid } from 'drizzle-orm/pg-core'
import { users } from './identity'
import { projects } from './tasks'
import { workspaces } from './tenancy'

export const importJobs = pgTable(
	'import_jobs',
	{
		id: uuid('id').primaryKey().default(sql`uuidv7()`),
		workspaceId: uuid('workspace_id')
			.notNull()
			.references(() => workspaces.id, { onDelete: 'cascade' }),
		source: text('source', { enum: ['linear', 'github', 'notion', 'markdown'] }).notNull(),
		status: text('status', {
			enum: ['dry_run', 'pending', 'running', 'completed', 'failed', 'cancelled']
		})
			.notNull()
			.default('dry_run'),
		targetProjectId: uuid('target_project_id'),
		createdBy: uuid('created_by').references(() => users.id, { onDelete: 'set null' }),
		config: jsonb('config').notNull().default({}),
		preview: jsonb('preview').notNull().default({}),
		report: jsonb('report').notNull().default({}),
		cursor: text('cursor'),
		createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
		updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
		completedAt: timestamp('completed_at', { withTimezone: true }),
		version: integer('version').notNull().default(1)
	},
	(t) => [
		unique('uq_import_jobs_ws_id').on(t.workspaceId, t.id),
		foreignKey({
			columns: [t.workspaceId, t.targetProjectId],
			foreignColumns: [projects.workspaceId, projects.id],
			name: 'fk_import_jobs_project'
		}).onDelete('set null')
	]
)

export const importMappings = pgTable(
	'import_mappings',
	{
		id: uuid('id').primaryKey().default(sql`uuidv7()`),
		workspaceId: uuid('workspace_id')
			.notNull()
			.references(() => workspaces.id, { onDelete: 'cascade' }),
		importJobId: uuid('import_job_id').notNull(),
		source: text('source', { enum: ['linear', 'github', 'notion', 'markdown'] }).notNull(),
		remoteType: text('remote_type', {
			enum: ['project', 'issue', 'comment', 'label', 'cycle', 'status', 'doc_page']
		}).notNull(),
		remoteId: text('remote_id').notNull(),
		remoteIdentifier: text('remote_identifier'),
		remoteUrl: text('remote_url'),
		localType: text('local_type').notNull(),
		localId: uuid('local_id').notNull(),
		createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow()
	},
	(t) => [
		unique('uq_import_mappings_ws_id').on(t.workspaceId, t.id),
		unique('uq_import_mappings_remote').on(t.workspaceId, t.source, t.remoteType, t.remoteId),
		foreignKey({
			columns: [t.workspaceId, t.importJobId],
			foreignColumns: [importJobs.workspaceId, importJobs.id],
			name: 'fk_import_mappings_job'
		}).onDelete('cascade')
	]
)
