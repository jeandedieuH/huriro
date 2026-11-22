// Search materialized index table — owned by the `search` module (§5.4, §11.1).
import { foreignKey, jsonb, pgTable, primaryKey, text, timestamp, uuid } from 'drizzle-orm/pg-core'
import { projects } from './tasks'
import { workspaces } from './tenancy'

export const searchDocuments = pgTable(
	'search_documents',
	{
		workspaceId: uuid('workspace_id')
			.notNull()
			.references(() => workspaces.id, { onDelete: 'cascade' }),
		entityType: text('entity_type', {
			enum: ['issue', 'project', 'comment', 'doc_page', 'message', 'mail_message']
		}).notNull(),
		entityId: uuid('entity_id').notNull(),
		projectId: uuid('project_id'),
		containerId: uuid('container_id'),
		identifier: text('identifier'),
		title: text('title').notNull().default(''),
		body: text('body').notNull().default(''),
		lang: text('lang').notNull().default('simple'),
		metadata: jsonb('metadata').notNull().default({}),
		createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
		updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow()
	},
	(t) => [
		primaryKey({ columns: [t.workspaceId, t.entityType, t.entityId] }),
		foreignKey({
			columns: [t.workspaceId, t.projectId],
			foreignColumns: [projects.workspaceId, projects.id],
			name: 'fk_search_documents_project'
		}).onDelete('cascade')
	]
)
