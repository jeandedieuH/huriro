// Cross-pillar workflow automation engine — owned by the `automations` module
// (§5.4, §7.2, ADR-0028). Every rule executes under an explicit
// agent_principals(kind='automation') principal; runs record depth for the
// loop guard and are deduplicated per (rule, trigger event).
import { sql } from 'drizzle-orm'
import {
	boolean,
	check,
	foreignKey,
	index,
	integer,
	jsonb,
	pgTable,
	text,
	timestamp,
	unique,
	uniqueIndex,
	uuid
} from 'drizzle-orm/pg-core'
import { agentPrincipals } from './agents'
import { users } from './identity'
import { workspaces } from './tenancy'

export const automationRules = pgTable(
	'automation_rules',
	{
		id: uuid('id').primaryKey().default(sql`uuidv7()`),
		workspaceId: uuid('workspace_id')
			.notNull()
			.references(() => workspaces.id, { onDelete: 'cascade' }),
		name: text('name').notNull(),
		description: text('description').notNull().default(''),
		enabled: boolean('enabled').notNull().default(false),
		principalId: uuid('principal_id').notNull(),
		triggerKind: text('trigger_kind', { enum: ['event', 'cron'] }).notNull(),
		triggerConfig: jsonb('trigger_config').notNull().default({}),
		conditionAst: jsonb('condition_ast'),
		actions: jsonb('actions').notNull().default([]),
		nextRunAt: timestamp('next_run_at', { withTimezone: true }),
		lastRunAt: timestamp('last_run_at', { withTimezone: true }),
		createdBy: uuid('created_by').references(() => users.id, { onDelete: 'set null' }),
		createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
		updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
		version: integer('version').notNull().default(1)
	},
	(t) => [
		unique('uq_automation_rules_ws_id').on(t.workspaceId, t.id),
		unique('uq_automation_rules_ws_name').on(t.workspaceId, t.name),
		foreignKey({
			columns: [t.workspaceId, t.principalId],
			foreignColumns: [agentPrincipals.workspaceId, agentPrincipals.id],
			name: 'fk_automation_rules_principal'
		}),
		index('idx_automation_rules_next_run').on(t.nextRunAt).where(sql`enabled AND trigger_kind = 'cron'`),
		index('idx_automation_rules_ws_enabled').on(t.workspaceId, t.enabled)
	]
)

export const automationRuns = pgTable(
	'automation_runs',
	{
		id: uuid('id').primaryKey().default(sql`uuidv7()`),
		workspaceId: uuid('workspace_id')
			.notNull()
			.references(() => workspaces.id, { onDelete: 'cascade' }),
		ruleId: uuid('rule_id').notNull(),
		triggerEventId: uuid('trigger_event_id'),
		status: text('status', {
			enum: ['running', 'succeeded', 'failed', 'skipped', 'loop_guard_tripped', 'quota_exceeded', 'dry_run']
		}).notNull(),
		depth: integer('depth').notNull().default(0),
		dryRun: boolean('dry_run').notNull().default(false),
		triggerSnapshot: jsonb('trigger_snapshot').notNull().default({}),
		startedAt: timestamp('started_at', { withTimezone: true }).notNull().defaultNow(),
		finishedAt: timestamp('finished_at', { withTimezone: true }),
		durationMs: integer('duration_ms'),
		errorDetail: text('error_detail'),
		createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow()
	},
	(t) => [
		unique('uq_automation_runs_ws_id').on(t.workspaceId, t.id),
		foreignKey({
			columns: [t.workspaceId, t.ruleId],
			foreignColumns: [automationRules.workspaceId, automationRules.id],
			name: 'fk_automation_runs_rule'
		}).onDelete('cascade'),
		check('ck_automation_runs_depth', sql`depth >= 0`),
		// Idempotency: one real run per (rule, event); dry runs are exempt.
		uniqueIndex('uq_automation_runs_event')
			.on(t.workspaceId, t.ruleId, t.triggerEventId)
			.where(sql`trigger_event_id IS NOT NULL AND dry_run = false`),
		index('idx_automation_runs_rule').on(t.workspaceId, t.ruleId, t.startedAt),
		index('idx_automation_runs_ws_started').on(t.workspaceId, t.startedAt)
	]
)

export const automationRunSteps = pgTable(
	'automation_run_steps',
	{
		id: uuid('id').primaryKey().default(sql`uuidv7()`),
		workspaceId: uuid('workspace_id')
			.notNull()
			.references(() => workspaces.id, { onDelete: 'cascade' }),
		runId: uuid('run_id').notNull(),
		stepIndex: integer('step_index').notNull(),
		actionKind: text('action_kind').notNull(),
		status: text('status', { enum: ['succeeded', 'failed', 'skipped', 'simulated'] }).notNull(),
		input: jsonb('input').notNull().default({}),
		output: jsonb('output'),
		errorDetail: text('error_detail'),
		createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow()
	},
	(t) => [
		unique('uq_automation_run_steps_ws_id').on(t.workspaceId, t.id),
		unique('uq_automation_run_steps_seq').on(t.workspaceId, t.runId, t.stepIndex),
		foreignKey({
			columns: [t.workspaceId, t.runId],
			foreignColumns: [automationRuns.workspaceId, automationRuns.id],
			name: 'fk_automation_run_steps_run'
		}).onDelete('cascade')
	]
)
