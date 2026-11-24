// Agent principals + M3 agent surfaces — owned by the `agents` module
// (§5.4, §8.3, §13.1a). Agents are revocable principals with an accountable
// human owner and a scope ceiling — not users with a flag.
import { sql } from 'drizzle-orm'
import {
	boolean,
	check,
	integer,
	jsonb,
	pgTable,
	text,
	timestamp,
	unique,
	uniqueIndex,
	uuid
} from 'drizzle-orm/pg-core'
import { users } from './identity'
import { workspaces } from './tenancy'

export const agentPrincipals = pgTable(
	'agent_principals',
	{
		id: uuid('id').primaryKey().default(sql`uuidv7()`),
		workspaceId: uuid('workspace_id')
			.notNull()
			.references(() => workspaces.id, { onDelete: 'cascade' }),
		kind: text('kind', { enum: ['external_mcp', 'builtin_assistant', 'automation'] }).notNull(),
		name: text('name').notNull(),
		ownerUserId: uuid('owner_user_id')
			.notNull()
			.references(() => users.id),
		oauthClientId: text('oauth_client_id'),
		scopeCeiling: text('scope_ceiling').array().notNull().default([]),
		/** Admin tier raises per tool — raise-only is enforced by the service layer. */
		tierOverrides: jsonb('tier_overrides').notNull().default({}),
		requireApprovalAllWrites: boolean('require_approval_all_writes').notNull().default(false),
		status: text('status', { enum: ['active', 'suspended', 'revoked'] })
			.notNull()
			.default('active'),
		lastActiveAt: timestamp('last_active_at', { withTimezone: true }),
		createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow()
	},
	(t) => [
		unique('uq_agent_principals_ws_id').on(t.workspaceId, t.id),
		uniqueIndex('uq_agent_principals_ws_owner_client')
			.on(t.workspaceId, t.ownerUserId, t.oauthClientId)
			.where(sql`${t.oauthClientId} IS NOT NULL`),
		check('ck_agent_principals_status', sql`status IN ('active', 'suspended', 'revoked')`)
	]
)

export const agentApprovals = pgTable(
	'agent_approvals',
	{
		id: uuid('id').primaryKey().default(sql`uuidv7()`),
		workspaceId: uuid('workspace_id')
			.notNull()
			.references(() => workspaces.id, { onDelete: 'cascade' }),
		agentId: uuid('agent_id').notNull(),
		ownerUserId: uuid('owner_user_id')
			.notNull()
			.references(() => users.id, { onDelete: 'cascade' }),
		tool: text('tool').notNull(),
		args: jsonb('args').notNull(),
		argsHash: text('args_hash').notNull(),
		previewMd: text('preview_md').notNull().default(''),
		tier: text('tier', { enum: ['R0', 'R1', 'R2', 'R3'] }).notNull(),
		status: text('status', {
			enum: ['pending', 'approved', 'denied', 'expired', 'executing', 'executed', 'failed']
		})
			.notNull()
			.default('pending'),
		requestId: text('request_id'),
		tokenId: text('token_id'),
		tokenScopes: text('token_scopes').array().notNull().default([]),
		idempotencyKey: text('idempotency_key'),
		decidedBy: uuid('decided_by').references(() => users.id),
		decidedAt: timestamp('decided_at', { withTimezone: true }),
		decisionReason: text('decision_reason'),
		expiresAt: timestamp('expires_at', { withTimezone: true })
			.notNull()
			.default(sql`now() + interval '24 hours'`),
		result: jsonb('result'),
		errorCode: text('error_code'),
		createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
		updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow()
	},
	(t) => [
		unique('uq_agent_approvals_ws_id').on(t.workspaceId, t.id),
		uniqueIndex('uq_agent_approvals_idem')
			.on(t.workspaceId, t.idempotencyKey)
			.where(sql`${t.idempotencyKey} IS NOT NULL`),
		check('ck_agent_approvals_pending_decider', sql`status <> 'pending' OR decided_by IS NULL`)
	]
)

/** Append-only call audit (§13.3) — huriro_app has SELECT+INSERT only. */
export const agentToolCalls = pgTable(
	'agent_tool_calls',
	{
		id: uuid('id').primaryKey().default(sql`uuidv7()`),
		workspaceId: uuid('workspace_id')
			.notNull()
			.references(() => workspaces.id, { onDelete: 'cascade' }),
		agentId: uuid('agent_id').notNull(),
		ownerUserId: uuid('owner_user_id')
			.notNull()
			.references(() => users.id, { onDelete: 'cascade' }),
		oauthClientId: text('oauth_client_id'),
		tokenId: text('token_id'),
		tool: text('tool').notNull(),
		argsHash: text('args_hash').notNull(),
		requestedScopes: text('requested_scopes').array().notNull().default([]),
		effectiveScopes: text('effective_scopes').array().notNull().default([]),
		requestedTier: text('requested_tier').notNull(),
		effectiveTier: text('effective_tier').notNull(),
		status: text('status', {
			enum: ['ok', 'denied', 'error', 'needs_confirmation', 'approval_required', 'rate_limited']
		}).notNull(),
		errorCode: text('error_code'),
		durationMs: integer('duration_ms').notNull().default(0),
		approvalId: uuid('approval_id'),
		requestId: text('request_id'),
		createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow()
	},
	(t) => [unique('uq_agent_tool_calls_ws_id').on(t.workspaceId, t.id)]
)

export const agentStatusReports = pgTable(
	'agent_status_reports',
	{
		id: uuid('id').primaryKey().default(sql`uuidv7()`),
		workspaceId: uuid('workspace_id')
			.notNull()
			.references(() => workspaces.id, { onDelete: 'cascade' }),
		issueId: uuid('issue_id').notNull(),
		agentId: uuid('agent_id').notNull(),
		state: text('state', { enum: ['working', 'needs_input', 'done', 'failed'] }).notNull(),
		message: text('message').notNull(),
		links: jsonb('links').notNull().default([]),
		createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow()
	},
	(t) => [unique('uq_agent_status_reports_ws_id').on(t.workspaceId, t.id)]
)

/**
 * Workspace-bound API keys (ADR-0021): `hrk_<prefix>_<secret>` credentials for
 * automation principals. `secret_hash` is sha256 of the full key — the raw key
 * is returned once at creation and never stored. No DELETE grant: keys are
 * revoked (revoked_at), not erased.
 */
export const agentApiKeys = pgTable(
	'agent_api_keys',
	{
		id: uuid('id').primaryKey().default(sql`uuidv7()`),
		workspaceId: uuid('workspace_id')
			.notNull()
			.references(() => workspaces.id, { onDelete: 'cascade' }),
		agentId: uuid('agent_id').notNull(),
		createdBy: uuid('created_by')
			.notNull()
			.references(() => users.id, { onDelete: 'cascade' }),
		name: text('name').notNull(),
		prefix: text('prefix').notNull(),
		secretHash: text('secret_hash').notNull(),
		scopes: text('scopes').array().notNull().default([]),
		expiresAt: timestamp('expires_at', { withTimezone: true }),
		lastUsedAt: timestamp('last_used_at', { withTimezone: true }),
		revokedAt: timestamp('revoked_at', { withTimezone: true }),
		createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow()
	},
	(t) => [
		unique('uq_agent_api_keys_ws_id').on(t.workspaceId, t.id),
		uniqueIndex('uq_agent_api_keys_prefix').on(t.prefix)
	]
)

export const agentUndoLog = pgTable(
	'agent_undo_log',
	{
		id: uuid('id').primaryKey().default(sql`uuidv7()`),
		workspaceId: uuid('workspace_id')
			.notNull()
			.references(() => workspaces.id, { onDelete: 'cascade' }),
		agentId: uuid('agent_id').notNull(),
		toolCallId: uuid('tool_call_id').notNull(),
		tool: text('tool').notNull(),
		entityType: text('entity_type').notNull(),
		entityId: uuid('entity_id').notNull(),
		before: jsonb('before'),
		expiresAt: timestamp('expires_at', { withTimezone: true })
			.notNull()
			.default(sql`now() + interval '7 days'`),
		undoneAt: timestamp('undone_at', { withTimezone: true }),
		undoneBy: uuid('undone_by').references(() => users.id),
		createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow()
	},
	(t) => [
		unique('uq_agent_undo_log_ws_id').on(t.workspaceId, t.id),
		uniqueIndex('uq_agent_undo_tool_call').on(t.workspaceId, t.toolCallId),
		check('ck_agent_undo_undone_by', sql`undone_at IS NULL OR undone_by IS NOT NULL`)
	]
)
