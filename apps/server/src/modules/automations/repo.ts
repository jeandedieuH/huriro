import type { Queryable } from '@huriro/db'

export interface AutomationRuleRow {
	readonly id: string
	readonly workspaceId: string
	readonly name: string
	readonly description: string
	readonly enabled: boolean
	readonly principalId: string
	readonly triggerKind: 'event' | 'cron'
	readonly triggerConfig: Record<string, unknown>
	readonly conditionAst: unknown | null
	readonly actions: Record<string, unknown>[]
	readonly nextRunAt: string | null
	readonly lastRunAt: string | null
	readonly createdBy: string | null
	readonly createdAt: string
	readonly updatedAt: string
	readonly version: number
}

export interface AutomationRunRow {
	readonly id: string
	readonly workspaceId: string
	readonly ruleId: string
	readonly triggerEventId: string | null
	readonly status: string
	readonly depth: number
	readonly dryRun: boolean
	readonly triggerSnapshot: Record<string, unknown>
	readonly startedAt: string
	readonly finishedAt: string | null
	readonly durationMs: number | null
	readonly errorDetail: string | null
	readonly createdAt: string
}

export interface AutomationRunStepRow {
	readonly id: string
	readonly workspaceId: string
	readonly runId: string
	readonly stepIndex: number
	readonly actionKind: string
	readonly status: string
	readonly input: Record<string, unknown>
	readonly output: Record<string, unknown> | null
	readonly errorDetail: string | null
	readonly createdAt: string
}

// SELECT projections intentionally repeat explicit columns instead of using
// SELECT * — tenant tables must never leak newly added internals by accident.
export async function insertRule(
	tx: Queryable,
	args: {
		readonly workspaceId: string
		readonly name: string
		readonly description: string
		readonly enabled: boolean
		readonly principalId: string
		readonly triggerKind: 'event' | 'cron'
		readonly triggerConfig: Record<string, unknown>
		readonly conditionAst: unknown | null
		readonly actions: Record<string, unknown>[]
		readonly nextRunAt: string | null
		readonly createdBy: string | null
	}
): Promise<AutomationRuleRow> {
	const [row] = await tx<AutomationRuleRow[]>`
		INSERT INTO automation_rules (
			workspace_id, name, description, enabled, principal_id, trigger_kind,
			trigger_config, condition_ast, actions, next_run_at, created_by
		)
		VALUES (
			${args.workspaceId}, ${args.name}, ${args.description}, ${args.enabled},
			${args.principalId}, ${args.triggerKind}, ${tx.json(args.triggerConfig as never)},
			${args.conditionAst === null ? null : tx.json(args.conditionAst as never)},
			${tx.json(args.actions as never)}, ${args.nextRunAt}, ${args.createdBy}
		)
		RETURNING id, workspace_id AS "workspaceId", name, description, enabled,
			principal_id AS "principalId", trigger_kind AS "triggerKind",
			trigger_config AS "triggerConfig", condition_ast AS "conditionAst", actions,
			next_run_at::text AS "nextRunAt", last_run_at::text AS "lastRunAt",
			created_by AS "createdBy", created_at::text AS "createdAt",
			updated_at::text AS "updatedAt", version
	`
	if (!row) throw new Error('automation rule insert returned no row')
	return row
}

export async function updateRule(
	tx: Queryable,
	workspaceId: string,
	ruleId: string,
	version: number,
	args: {
		readonly name: string
		readonly description: string
		readonly enabled: boolean
		readonly principalId: string
		readonly triggerKind: 'event' | 'cron'
		readonly triggerConfig: Record<string, unknown>
		readonly conditionAst: unknown | null
		readonly actions: Record<string, unknown>[]
		readonly nextRunAt: string | null
	}
): Promise<AutomationRuleRow | undefined> {
	const [row] = await tx<AutomationRuleRow[]>`
		UPDATE automation_rules
		SET name = ${args.name}, description = ${args.description}, enabled = ${args.enabled},
			principal_id = ${args.principalId}, trigger_kind = ${args.triggerKind},
			trigger_config = ${tx.json(args.triggerConfig as never)},
			condition_ast = ${args.conditionAst === null ? null : tx.json(args.conditionAst as never)},
			actions = ${tx.json(args.actions as never)}, next_run_at = ${args.nextRunAt},
			version = version + 1
		WHERE workspace_id = ${workspaceId} AND id = ${ruleId} AND version = ${version}
		RETURNING id, workspace_id AS "workspaceId", name, description, enabled,
			principal_id AS "principalId", trigger_kind AS "triggerKind",
			trigger_config AS "triggerConfig", condition_ast AS "conditionAst", actions,
			next_run_at::text AS "nextRunAt", last_run_at::text AS "lastRunAt",
			created_by AS "createdBy", created_at::text AS "createdAt",
			updated_at::text AS "updatedAt", version
	`
	return row
}

export async function getRule(
	tx: Queryable,
	workspaceId: string,
	ruleId: string
): Promise<AutomationRuleRow | undefined> {
	const [row] = await tx<AutomationRuleRow[]>`
		SELECT id, workspace_id AS "workspaceId", name, description, enabled,
			principal_id AS "principalId", trigger_kind AS "triggerKind",
			trigger_config AS "triggerConfig", condition_ast AS "conditionAst", actions,
			next_run_at::text AS "nextRunAt", last_run_at::text AS "lastRunAt",
			created_by AS "createdBy", created_at::text AS "createdAt",
			updated_at::text AS "updatedAt", version
		FROM automation_rules
		WHERE workspace_id = ${workspaceId} AND id = ${ruleId}
	`
	return row
}

export async function getRuleByName(
	tx: Queryable,
	workspaceId: string,
	name: string
): Promise<AutomationRuleRow | undefined> {
	const [row] = await tx<AutomationRuleRow[]>`
		SELECT id, workspace_id AS "workspaceId", name, description, enabled,
			principal_id AS "principalId", trigger_kind AS "triggerKind",
			trigger_config AS "triggerConfig", condition_ast AS "conditionAst", actions,
			next_run_at::text AS "nextRunAt", last_run_at::text AS "lastRunAt",
			created_by AS "createdBy", created_at::text AS "createdAt",
			updated_at::text AS "updatedAt", version
		FROM automation_rules
		WHERE workspace_id = ${workspaceId} AND lower(name) = lower(${name})
	`
	return row
}

export async function listRules(
	tx: Queryable,
	workspaceId: string,
	enabled?: boolean
): Promise<AutomationRuleRow[]> {
	return tx<AutomationRuleRow[]>`
		SELECT id, workspace_id AS "workspaceId", name, description, enabled,
			principal_id AS "principalId", trigger_kind AS "triggerKind",
			trigger_config AS "triggerConfig", condition_ast AS "conditionAst", actions,
			next_run_at::text AS "nextRunAt", last_run_at::text AS "lastRunAt",
			created_by AS "createdBy", created_at::text AS "createdAt",
			updated_at::text AS "updatedAt", version
		FROM automation_rules
		WHERE workspace_id = ${workspaceId}
			${enabled === undefined ? tx`` : tx`AND enabled = ${enabled}`}
		ORDER BY created_at ASC
	`
}

export async function listEnabledEventRules(
	tx: Queryable,
	workspaceId: string
): Promise<AutomationRuleRow[]> {
	return tx<AutomationRuleRow[]>`
		SELECT id, workspace_id AS "workspaceId", name, description, enabled,
			principal_id AS "principalId", trigger_kind AS "triggerKind",
			trigger_config AS "triggerConfig", condition_ast AS "conditionAst", actions,
			next_run_at::text AS "nextRunAt", last_run_at::text AS "lastRunAt",
			created_by AS "createdBy", created_at::text AS "createdAt",
			updated_at::text AS "updatedAt", version
		FROM automation_rules
		WHERE workspace_id = ${workspaceId} AND enabled AND trigger_kind = 'event'
		ORDER BY created_at ASC
	`
}

export async function deleteRule(
	tx: Queryable,
	workspaceId: string,
	ruleId: string,
	version?: number
): Promise<boolean> {
	const rows = await (version === undefined
		? tx<{ id: string }[]>`
			DELETE FROM automation_rules
			WHERE workspace_id = ${workspaceId} AND id = ${ruleId}
			RETURNING id
		`
		: tx<{ id: string }[]>`
			DELETE FROM automation_rules
			WHERE workspace_id = ${workspaceId} AND id = ${ruleId} AND version = ${version}
			RETURNING id
		`)
	return rows.length > 0
}

export async function touchRuleLastRun(
	tx: Queryable,
	workspaceId: string,
	ruleId: string,
	at: string
): Promise<void> {
	await tx`
		UPDATE automation_rules
		SET last_run_at = ${at}
		WHERE workspace_id = ${workspaceId} AND id = ${ruleId}
	`
}

export async function insertRun(
	tx: Queryable,
	args: {
		readonly workspaceId: string
		readonly ruleId: string
		readonly triggerEventId: string | null
		readonly status: string
		readonly depth: number
		readonly dryRun: boolean
		readonly triggerSnapshot: Record<string, unknown>
		readonly startedAt?: string
		readonly finishedAt?: string | null
		readonly durationMs?: number | null
		readonly errorDetail?: string | null
	}
): Promise<AutomationRunRow | undefined> {
	const [row] = await tx<AutomationRunRow[]>`
		INSERT INTO automation_runs (
			workspace_id, rule_id, trigger_event_id, status, depth, dry_run,
			trigger_snapshot, started_at, finished_at, duration_ms, error_detail
		)
		VALUES (
			${args.workspaceId}, ${args.ruleId}, ${args.triggerEventId}, ${args.status},
			${args.depth}, ${args.dryRun}, ${tx.json(args.triggerSnapshot as never)},
			${args.startedAt ?? new Date().toISOString()}, ${args.finishedAt ?? null},
			${args.durationMs ?? null}, ${args.errorDetail ?? null}
		)
		ON CONFLICT DO NOTHING
		RETURNING id, workspace_id AS "workspaceId", rule_id AS "ruleId",
			trigger_event_id AS "triggerEventId", status, depth, dry_run AS "dryRun",
			trigger_snapshot AS "triggerSnapshot", started_at::text AS "startedAt",
			finished_at::text AS "finishedAt", duration_ms AS "durationMs",
			error_detail AS "errorDetail", created_at::text AS "createdAt"
	`
	return row
}

export async function finishRun(
	tx: Queryable,
	workspaceId: string,
	runId: string,
	status: string,
	errorDetail: string | null,
	durationMs: number
): Promise<void> {
	await tx`
		UPDATE automation_runs
		SET status = ${status}, finished_at = now(), duration_ms = ${durationMs}, error_detail = ${errorDetail}
		WHERE workspace_id = ${workspaceId} AND id = ${runId}
	`
}

export async function getRun(
	tx: Queryable,
	workspaceId: string,
	runId: string
): Promise<AutomationRunRow | undefined> {
	const [row] = await tx<AutomationRunRow[]>`
		SELECT id, workspace_id AS "workspaceId", rule_id AS "ruleId",
			trigger_event_id AS "triggerEventId", status, depth, dry_run AS "dryRun",
			trigger_snapshot AS "triggerSnapshot", started_at::text AS "startedAt",
			finished_at::text AS "finishedAt", duration_ms AS "durationMs",
			error_detail AS "errorDetail", created_at::text AS "createdAt"
		FROM automation_runs
		WHERE workspace_id = ${workspaceId} AND id = ${runId}
	`
	return row
}

export async function listRuns(
	tx: Queryable,
	workspaceId: string,
	opts: { readonly ruleId?: string; readonly status?: string; readonly limit: number }
): Promise<AutomationRunRow[]> {
	return tx<AutomationRunRow[]>`
		SELECT id, workspace_id AS "workspaceId", rule_id AS "ruleId",
			trigger_event_id AS "triggerEventId", status, depth, dry_run AS "dryRun",
			trigger_snapshot AS "triggerSnapshot", started_at::text AS "startedAt",
			finished_at::text AS "finishedAt", duration_ms AS "durationMs",
			error_detail AS "errorDetail", created_at::text AS "createdAt"
		FROM automation_runs
		WHERE workspace_id = ${workspaceId}
			${opts.ruleId ? tx`AND rule_id = ${opts.ruleId}` : tx``}
			${opts.status ? tx`AND status = ${opts.status}` : tx``}
		ORDER BY started_at DESC
		LIMIT ${opts.limit}
	`
}

export async function insertStep(
	tx: Queryable,
	args: {
		readonly workspaceId: string
		readonly runId: string
		readonly stepIndex: number
		readonly actionKind: string
		readonly status: string
		readonly input: Record<string, unknown>
		readonly output: Record<string, unknown> | null
		readonly errorDetail: string | null
	}
): Promise<void> {
	await tx`
		INSERT INTO automation_run_steps (
			workspace_id, run_id, step_index, action_kind, status, input, output, error_detail
		)
		VALUES (
			${args.workspaceId}, ${args.runId}, ${args.stepIndex}, ${args.actionKind},
			${args.status}, ${tx.json(args.input as never)},
			${args.output === null ? null : tx.json(args.output as never)}, ${args.errorDetail}
		)
	`
}

export async function listSteps(
	tx: Queryable,
	workspaceId: string,
	runId: string
): Promise<AutomationRunStepRow[]> {
	return tx<AutomationRunStepRow[]>`
		SELECT id, workspace_id AS "workspaceId", run_id AS "runId", step_index AS "stepIndex",
			action_kind AS "actionKind", status, input, output,
			error_detail AS "errorDetail", created_at::text AS "createdAt"
		FROM automation_run_steps
		WHERE workspace_id = ${workspaceId} AND run_id = ${runId}
		ORDER BY step_index ASC
	`
}

export async function workspaceAutomationSettings(
	tx: Queryable,
	workspaceId: string
): Promise<{ readonly enabled: boolean; readonly maxRunsPerMinute: number }> {
	const [row] = await tx<{ enabled: boolean; maxRunsPerMinute: number }[]>`
		SELECT
			COALESCE((settings->>'automations_enabled')::boolean, true) AS enabled,
			COALESCE((settings->>'automation_max_runs_per_minute')::int, 60) AS "maxRunsPerMinute"
		FROM workspaces
		WHERE id = ${workspaceId}
	`
	return row ?? { enabled: true, maxRunsPerMinute: 60 }
}

export async function countRunsSince(
	tx: Queryable,
	workspaceId: string,
	sinceIso: string,
	excludeRunId?: string
): Promise<number> {
	const [row] = await tx<{ count: number }[]>`
		SELECT count(*)::int AS count
		FROM automation_runs
		WHERE workspace_id = ${workspaceId}
			AND dry_run = false
			-- Rejected quota rows did not execute work and must not consume the quota themselves.
			AND status <> 'quota_exceeded'
			AND started_at >= ${sinceIso}
			AND (${excludeRunId ?? null}::uuid IS NULL OR id <> ${excludeRunId ?? null}::uuid)
	`
	return row?.count ?? 0
}
