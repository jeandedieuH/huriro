// Tasks tables — owned by the `tasks` module (§5.4, §8.3).
import { sql } from 'drizzle-orm'
import {
	boolean,
	check,
	date,
	foreignKey,
	integer,
	jsonb,
	numeric,
	pgTable,
	primaryKey,
	smallint,
	text,
	timestamp,
	unique,
	uuid
} from 'drizzle-orm/pg-core'
import { users } from './identity'
import { workspaces } from './tenancy'

export const projects = pgTable(
	'projects',
	{
		id: uuid('id').primaryKey().default(sql`uuidv7()`),
		workspaceId: uuid('workspace_id')
			.notNull()
			.references(() => workspaces.id, { onDelete: 'cascade' }),
		key: text('key').notNull(),
		name: text('name').notNull(),
		description: text('description').notNull().default(''),
		visibility: text('visibility', { enum: ['workspace', 'private'] })
			.notNull()
			.default('workspace'),
		position: text('position').notNull(),
		archivedAt: timestamp('archived_at', { withTimezone: true }),
		createdBy: uuid('created_by').references(() => users.id, { onDelete: 'set null' }),
		createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
		updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
		version: integer('version').notNull().default(1)
	},
	(t) => [
		unique('uq_projects_ws_id').on(t.workspaceId, t.id),
		unique('uq_projects_ws_key').on(t.workspaceId, t.key)
	]
)

export const projectStatuses = pgTable(
	'project_statuses',
	{
		id: uuid('id').primaryKey().default(sql`uuidv7()`),
		workspaceId: uuid('workspace_id')
			.notNull()
			.references(() => workspaces.id, { onDelete: 'cascade' }),
		projectId: uuid('project_id').notNull(),
		name: text('name').notNull(),
		category: text('category', {
			enum: ['backlog', 'unstarted', 'started', 'completed', 'cancelled']
		}).notNull(),
		color: text('color').notNull().default('neutral'),
		position: text('position').notNull(),
		isDefault: boolean('is_default').notNull().default(false),
		createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
		updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
		version: integer('version').notNull().default(1)
	},
	(t) => [
		unique('uq_project_statuses_ws_id').on(t.workspaceId, t.id),
		unique('uq_project_statuses_proj_name').on(t.workspaceId, t.projectId, t.name),
		foreignKey({
			columns: [t.workspaceId, t.projectId],
			foreignColumns: [projects.workspaceId, projects.id],
			name: 'fk_project_statuses_project'
		}).onDelete('cascade')
	]
)

export const labels = pgTable(
	'labels',
	{
		id: uuid('id').primaryKey().default(sql`uuidv7()`),
		workspaceId: uuid('workspace_id')
			.notNull()
			.references(() => workspaces.id, { onDelete: 'cascade' }),
		name: text('name').notNull(),
		color: text('color').notNull().default('neutral'),
		createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
		updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
		version: integer('version').notNull().default(1)
	},
	(t) => [
		unique('uq_labels_ws_id').on(t.workspaceId, t.id),
		unique('uq_labels_ws_name').on(t.workspaceId, t.name)
	]
)

export const cycles = pgTable(
	'cycles',
	{
		id: uuid('id').primaryKey().default(sql`uuidv7()`),
		workspaceId: uuid('workspace_id')
			.notNull()
			.references(() => workspaces.id, { onDelete: 'cascade' }),
		projectId: uuid('project_id').notNull(),
		name: text('name').notNull(),
		description: text('description').notNull().default(''),
		status: text('status', { enum: ['planned', 'active', 'completed'] })
			.notNull()
			.default('planned'),
		startsAt: date('starts_at').notNull(),
		endsAt: date('ends_at').notNull(),
		createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
		updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
		version: integer('version').notNull().default(1)
	},
	(t) => [
		unique('uq_cycles_ws_id').on(t.workspaceId, t.id),
		foreignKey({
			columns: [t.workspaceId, t.projectId],
			foreignColumns: [projects.workspaceId, projects.id],
			name: 'fk_cycles_project'
		}).onDelete('cascade')
	]
)

export const issueCounters = pgTable(
	'issue_counters',
	{
		workspaceId: uuid('workspace_id')
			.notNull()
			.references(() => workspaces.id, { onDelete: 'cascade' }),
		projectId: uuid('project_id').primaryKey(),
		nextNumber: integer('next_number').notNull().default(1),
		createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow()
	},
	(t) => [
		foreignKey({
			columns: [t.workspaceId, t.projectId],
			foreignColumns: [projects.workspaceId, projects.id],
			name: 'fk_issue_counters_project'
		}).onDelete('cascade')
	]
)

export const issues = pgTable(
	'issues',
	{
		id: uuid('id').primaryKey().default(sql`uuidv7()`),
		workspaceId: uuid('workspace_id')
			.notNull()
			.references(() => workspaces.id, { onDelete: 'cascade' }),
		projectId: uuid('project_id').notNull(),
		number: integer('number').notNull(),
		parentId: uuid('parent_id'),
		cycleId: uuid('cycle_id'),
		title: text('title').notNull(),
		description: jsonb('description'),
		descriptionText: text('description_text').notNull().default(''),
		statusId: uuid('status_id').notNull(),
		priority: smallint('priority').notNull().default(0),
		assigneeType: text('assignee_type', { enum: ['user', 'agent'] }),
		assigneeId: uuid('assignee_id'),
		creatorId: uuid('creator_id')
			.notNull()
			.references(() => users.id),
		position: text('position').notNull(),
		startDate: date('start_date'),
		dueDate: date('due_date'),
		estimate: numeric('estimate', { precision: 6, scale: 2 }),
		closedAt: timestamp('closed_at', { withTimezone: true }),
		createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
		updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
		deletedAt: timestamp('deleted_at', { withTimezone: true }),
		version: integer('version').notNull().default(1)
	},
	(t) => [
		unique('uq_issues_ws_id').on(t.workspaceId, t.id),
		unique('uq_issues_ws_proj_num').on(t.workspaceId, t.projectId, t.number),
		check('ck_issues_assignee_pair', sql`(assignee_type IS NULL) = (assignee_id IS NULL)`),
		foreignKey({
			columns: [t.workspaceId, t.projectId],
			foreignColumns: [projects.workspaceId, projects.id],
			name: 'fk_issues_project'
		}).onDelete('cascade'),
		foreignKey({
			columns: [t.workspaceId, t.statusId],
			foreignColumns: [projectStatuses.workspaceId, projectStatuses.id],
			name: 'fk_issues_status'
		}),
		foreignKey({
			columns: [t.workspaceId, t.cycleId],
			foreignColumns: [cycles.workspaceId, cycles.id],
			name: 'fk_issues_cycle'
		}).onDelete('set null')
	]
)

export const issueLabels = pgTable(
	'issue_labels',
	{
		workspaceId: uuid('workspace_id')
			.notNull()
			.references(() => workspaces.id, { onDelete: 'cascade' }),
		issueId: uuid('issue_id').notNull(),
		labelId: uuid('label_id').notNull(),
		createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow()
	},
	(t) => [
		primaryKey({ columns: [t.workspaceId, t.issueId, t.labelId] }),
		foreignKey({
			columns: [t.workspaceId, t.issueId],
			foreignColumns: [issues.workspaceId, issues.id],
			name: 'fk_issue_labels_issue'
		}).onDelete('cascade'),
		foreignKey({
			columns: [t.workspaceId, t.labelId],
			foreignColumns: [labels.workspaceId, labels.id],
			name: 'fk_issue_labels_label'
		}).onDelete('cascade')
	]
)

export const issueRelations = pgTable(
	'issue_relations',
	{
		id: uuid('id').primaryKey().default(sql`uuidv7()`),
		workspaceId: uuid('workspace_id')
			.notNull()
			.references(() => workspaces.id, { onDelete: 'cascade' }),
		sourceIssueId: uuid('source_issue_id').notNull(),
		targetIssueId: uuid('target_issue_id').notNull(),
		kind: text('kind', { enum: ['blocks', 'relates_to', 'duplicates'] }).notNull(),
		createdBy: uuid('created_by').references(() => users.id, { onDelete: 'set null' }),
		createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow()
	},
	(t) => [
		unique('uq_issue_relations_ws_id').on(t.workspaceId, t.id),
		unique('uq_issue_relations_edge').on(t.workspaceId, t.sourceIssueId, t.targetIssueId, t.kind),
		foreignKey({
			columns: [t.workspaceId, t.sourceIssueId],
			foreignColumns: [issues.workspaceId, issues.id],
			name: 'fk_issue_relations_source'
		}).onDelete('cascade'),
		foreignKey({
			columns: [t.workspaceId, t.targetIssueId],
			foreignColumns: [issues.workspaceId, issues.id],
			name: 'fk_issue_relations_target'
		}).onDelete('cascade')
	]
)

export const issueComments = pgTable(
	'issue_comments',
	{
		id: uuid('id').primaryKey().default(sql`uuidv7()`),
		workspaceId: uuid('workspace_id')
			.notNull()
			.references(() => workspaces.id, { onDelete: 'cascade' }),
		issueId: uuid('issue_id').notNull(),
		authorType: text('author_type', { enum: ['user', 'agent'] })
			.notNull()
			.default('user'),
		authorId: uuid('author_id').notNull(),
		body: jsonb('body'),
		bodyText: text('body_text').notNull(),
		createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
		updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
		deletedAt: timestamp('deleted_at', { withTimezone: true }),
		version: integer('version').notNull().default(1)
	},
	(t) => [
		unique('uq_issue_comments_ws_id').on(t.workspaceId, t.id),
		foreignKey({
			columns: [t.workspaceId, t.issueId],
			foreignColumns: [issues.workspaceId, issues.id],
			name: 'fk_issue_comments_issue'
		}).onDelete('cascade')
	]
)

export const savedViews = pgTable(
	'saved_views',
	{
		id: uuid('id').primaryKey().default(sql`uuidv7()`),
		workspaceId: uuid('workspace_id')
			.notNull()
			.references(() => workspaces.id, { onDelete: 'cascade' }),
		projectId: uuid('project_id'),
		ownerUserId: uuid('owner_user_id').references(() => users.id, { onDelete: 'cascade' }),
		name: text('name').notNull(),
		layout: text('layout', { enum: ['list', 'board'] })
			.notNull()
			.default('list'),
		filters: jsonb('filters').notNull().default({}),
		sort: jsonb('sort').notNull().default({}),
		isShared: boolean('is_shared').notNull().default(false),
		position: text('position').notNull(),
		createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
		updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
		version: integer('version').notNull().default(1)
	},
	(t) => [
		unique('uq_saved_views_ws_id').on(t.workspaceId, t.id),
		foreignKey({
			columns: [t.workspaceId, t.projectId],
			foreignColumns: [projects.workspaceId, projects.id],
			name: 'fk_saved_views_project'
		}).onDelete('cascade')
	]
)
