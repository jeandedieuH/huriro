import type { AutomationAction, AutomationRunDto, AutomationRunStepDto } from '@huriro/contracts'
import { type Queryable, type Sql, setAutomationDepth, withSystem, withWorkspace } from '@huriro/db'
import { compileFilter, type FilterableIssue, validateFilter } from '@huriro/domain'
import { Cron } from 'croner'
import { log } from '../../api/observability'
import { resolveAutomationActor } from '../agents'
import { sendMessage } from '../chat'
import { createNote, updateConversation } from '../mail'
import { createIssue, getIssueDetail, updateIssue } from '../tasks'
import {
	type AutomationRuleRow,
	type AutomationRunRow,
	countRunsSince,
	finishRun,
	getRule,
	getRun,
	insertRun,
	insertStep,
	listEnabledEventRules,
	listSteps,
	touchRuleLastRun,
	workspaceAutomationSettings
} from './repo'

export const AUTOMATION_MAX_DEPTH = 5

export interface AutomationOutboxRow {
	readonly id: string
	readonly workspaceId: string | null
	readonly eventType: string
	readonly payload: Record<string, unknown>
	readonly changedAt?: string | undefined
}

export interface AutomationRunRef {
	readonly workspaceId: string
	readonly runId: string
}

function asDepth(value: unknown): number {
	if (typeof value !== 'number' || !Number.isFinite(value)) return 0
	return Math.max(0, Math.floor(value))
}

function errorMessage(error: unknown): string {
	const message = error instanceof Error ? error.message : String(error)
	return message.slice(0, 1000)
}

function eventTypesOf(rule: AutomationRuleRow): readonly string[] {
	const values = rule.triggerConfig['eventTypes']
	return Array.isArray(values) ? values.filter((v): v is string => typeof v === 'string') : []
}

function terminalRunSnapshot(row: AutomationOutboxRow): Record<string, unknown> {
	return {
		eventType: row.eventType,
		payload: row.payload,
		changedAt: row.changedAt ?? new Date().toISOString()
	}
}

/**
 * Outbox matcher. It runs inside the drain transaction so run rows commit or
 * roll back with the event's processed_events bookkeeping. Execution is always
 * post-commit (see drainOutboxOnce), keeping action writes out of the outbox
 * consumer transaction and preserving the retry/dead-letter semantics of the
 * original event.
 */
export async function processAutomationOutboxEvent(
	tx: Queryable,
	row: AutomationOutboxRow
): Promise<AutomationRunRef[]> {
	if (!row.workspaceId) return []
	const settings = await workspaceAutomationSettings(tx, row.workspaceId)
	if (!settings.enabled) return []

	const rules = (await listEnabledEventRules(tx, row.workspaceId)).filter((rule) =>
		eventTypesOf(rule).includes(row.eventType)
	)
	if (rules.length === 0) return []

	const depth = asDepth(row.payload['x_automation_depth'])
	const since = new Date(Date.now() - 60_000).toISOString()
	let used = await countRunsSince(tx, row.workspaceId, since)
	const refs: AutomationRunRef[] = []
	for (const rule of rules) {
		const base = {
			workspaceId: row.workspaceId,
			ruleId: rule.id,
			triggerEventId: row.id,
			depth,
			dryRun: false,
			triggerSnapshot: terminalRunSnapshot(row),
			finishedAt: new Date().toISOString(),
			durationMs: 0
		}
		if (depth >= AUTOMATION_MAX_DEPTH) {
			await insertRun(tx, {
				...base,
				status: 'loop_guard_tripped',
				errorDetail: `automation depth ${depth} reached limit ${AUTOMATION_MAX_DEPTH}`
			})
			continue
		}
		if (used >= settings.maxRunsPerMinute) {
			await insertRun(tx, {
				...base,
				status: 'quota_exceeded',
				errorDetail: `workspace automation quota ${settings.maxRunsPerMinute}/minute exceeded`
			})
			continue
		}
		const inserted = await insertRun(tx, {
			workspaceId: row.workspaceId,
			ruleId: rule.id,
			triggerEventId: row.id,
			status: 'running',
			depth,
			dryRun: false,
			triggerSnapshot: terminalRunSnapshot(row)
		})
		if (inserted) {
			used++
			refs.push({ workspaceId: row.workspaceId, runId: inserted.id })
		}
	}
	return refs
}

function substituteTemplates(value: unknown, vars: Record<string, unknown>): unknown {
	if (typeof value === 'string') {
		const match = /^\{\{\s*(issueId|projectId|actorId)\s*\}\}$/.exec(value)
		if (match?.[1]) return vars[match[1]]
		return value
	}
	if (Array.isArray(value)) return value.map((item) => substituteTemplates(item, vars))
	if (value && typeof value === 'object') {
		return Object.fromEntries(
			Object.entries(value as Record<string, unknown>).map(([key, item]) => [
				key,
				substituteTemplates(item, vars)
			])
		)
	}
	return value
}

async function executeAction(
	tx: Queryable,
	actor: NonNullable<Awaited<ReturnType<typeof resolveAutomationActor>>>,
	action: AutomationAction
): Promise<Record<string, unknown>> {
	switch (action.kind) {
		case 'issue.create': {
			const result = await createIssue(tx, actor, {
				projectId: action.projectId,
				title: action.title,
				...(action.descriptionText !== undefined ? { descriptionText: action.descriptionText } : {}),
				...(action.priority !== undefined ? { priority: action.priority } : {}),
				...(action.statusId !== undefined ? { statusId: action.statusId } : {}),
				...(action.assigneeUserId !== undefined
					? { assigneeId: action.assigneeUserId, assigneeType: 'user' as const }
					: {}),
				...(action.labelIds !== undefined ? { labelIds: action.labelIds } : {})
			})
			return { issueId: result.data.id, identifier: result.data.identifier }
		}
		case 'issue.update': {
			if (
				action.statusId === undefined &&
				action.priority === undefined &&
				action.assigneeUserId === undefined &&
				action.cycleId === undefined
			) {
				throw new Error('issue.update requires at least one mutable field')
			}
			const detail = await getIssueDetail(tx, actor, action.issueId)
			const result = await updateIssue(tx, actor, action.issueId, {
				version: detail.issue.version,
				...(action.statusId !== undefined ? { statusId: action.statusId } : {}),
				...(action.priority !== undefined ? { priority: action.priority } : {}),
				...(action.assigneeUserId !== undefined
					? {
							assigneeId: action.assigneeUserId,
							assigneeType: action.assigneeUserId ? ('user' as const) : null
						}
					: {}),
				...(action.cycleId !== undefined ? { cycleId: action.cycleId } : {})
			})
			return { issueId: result.data.id, version: result.data.version }
		}
		case 'issue.add_labels':
		case 'issue.remove_labels': {
			const detail = await getIssueDetail(tx, actor, action.issueId)
			const current = new Set(detail.issue.labelIds)
			if (action.kind === 'issue.add_labels') for (const id of action.labelIds) current.add(id)
			else for (const id of action.labelIds) current.delete(id)
			const result = await updateIssue(tx, actor, action.issueId, {
				version: detail.issue.version,
				labelIds: [...current]
			})
			return { issueId: result.data.id, labelIds: result.data.labelIds }
		}
		case 'chat.post_message': {
			const result = await sendMessage(tx, actor, action.channelId, { bodyText: action.bodyText })
			return { messageId: result.data.id, channelId: action.channelId }
		}
		case 'mail.add_note': {
			const note = await createNote(tx, actor, action.conversationId, { bodyText: action.bodyText })
			return { noteId: note.id, conversationId: action.conversationId }
		}
		case 'mail.assign': {
			const result = await updateConversation(tx, actor, action.conversationId, {
				assigneeId: action.assigneeUserId
			})
			return { conversationId: action.conversationId, version: result.data.version }
		}
	}
}

/** Isolate one action's partial writes without rolling back earlier completed
 * steps. Module services rely on transaction rollback for atomicity; catching a
 * step error without a savepoint would otherwise commit half-written rows. */
async function executeActionWithSavepoint(
	tx: Queryable,
	actor: NonNullable<Awaited<ReturnType<typeof resolveAutomationActor>>>,
	action: AutomationAction
): Promise<Record<string, unknown>> {
	await tx`SAVEPOINT automation_action`
	try {
		const output = await executeAction(tx, actor, action)
		await tx`RELEASE SAVEPOINT automation_action`
		return output
	} catch (error) {
		await tx`ROLLBACK TO SAVEPOINT automation_action`
		throw error
	}
}

async function statusCategoryResolver(
	tx: Queryable,
	workspaceId: string
): Promise<(statusId: string) => string | undefined> {
	const rows = await tx<{ id: string; category: string }[]>`
		SELECT id, category
		FROM project_statuses
		WHERE workspace_id = ${workspaceId}
	`
	const categories = new Map(rows.map((row) => [row.id, row.category]))
	return (statusId) => categories.get(statusId)
}

async function resolveConditionIssue(
	tx: Queryable,
	actor: NonNullable<Awaited<ReturnType<typeof resolveAutomationActor>>>,
	snapshot: Record<string, unknown>
): Promise<FilterableIssue | undefined> {
	const payload = snapshot['payload']
	if (!payload || typeof payload !== 'object' || Array.isArray(payload)) return undefined
	const issueId = (payload as Record<string, unknown>)['issueId']
	if (typeof issueId !== 'string') return undefined
	try {
		const detail = await getIssueDetail(tx, actor, issueId)
		return detail.issue
	} catch {
		return undefined
	}
}

interface StepRecord {
	readonly stepIndex: number
	readonly actionKind: string
	readonly status: 'succeeded' | 'failed' | 'skipped' | 'simulated'
	readonly input: Record<string, unknown>
	readonly output: Record<string, unknown> | null
	readonly errorDetail: string | null
}

interface ExecutionResult {
	readonly status: 'succeeded' | 'failed' | 'skipped' | 'quota_exceeded'
	readonly errorDetail: string | null
	readonly durationMs: number
	readonly steps: StepRecord[]
}

async function executeRunInTx(
	tx: Queryable,
	workspaceId: string,
	runId: string,
	opts: { readonly dryRun?: boolean }
): Promise<ExecutionResult> {
	const started = Date.now()
	const run = await getRun(tx, workspaceId, runId)
	if (!run) throw new Error('automation run not found')
	if (!opts.dryRun && run.status !== 'running') {
		return { status: 'skipped', errorDetail: `run status is ${run.status}`, durationMs: 0, steps: [] }
	}

	// Actions taken by a depth-N run are depth-(N+1) effects. The trigger from
	// migration 0024 copies this transaction-local value into every emitted
	// outbox payload; no producer module needs automation-specific code. Set it
	// before any rule action can write.
	await setAutomationDepth(tx, run.depth + 1)
	const rule = await getRule(tx, workspaceId, run.ruleId)
	if (!rule || (!rule.enabled && !opts.dryRun)) {
		const result = {
			status: 'skipped' as const,
			errorDetail: 'rule missing or disabled',
			durationMs: Date.now() - started,
			steps: []
		}
		if (!opts.dryRun)
			await finishRun(tx, workspaceId, runId, result.status, result.errorDetail, result.durationMs)
		return result
	}

	// The workspace kill switch and per-minute quota are re-checked at execution
	// time: a run may have been legitimately queued before an operator disabled
	// automations or before a burst consumed the quota.
	const settings = await workspaceAutomationSettings(tx, workspaceId)
	if (!settings.enabled) {
		const result = {
			status: 'skipped' as const,
			errorDetail: 'workspace automations are disabled',
			durationMs: Date.now() - started,
			steps: []
		}
		if (!opts.dryRun)
			await finishRun(tx, workspaceId, runId, result.status, result.errorDetail, result.durationMs)
		return result
	}
	const used = await countRunsSince(tx, workspaceId, new Date(Date.now() - 60_000).toISOString(), runId)
	if (used >= settings.maxRunsPerMinute) {
		const result = {
			status: 'quota_exceeded' as const,
			errorDetail: `workspace automation quota ${settings.maxRunsPerMinute}/minute exceeded`,
			durationMs: Date.now() - started,
			steps: []
		}
		if (!opts.dryRun)
			await finishRun(tx, workspaceId, runId, result.status, result.errorDetail, result.durationMs)
		return result
	}

	const actor = await resolveAutomationActor(tx, workspaceId, rule.principalId)
	if (!actor) {
		const result = {
			status: 'failed' as const,
			errorDetail: 'automation principal is unavailable',
			durationMs: Date.now() - started,
			steps: []
		}
		if (!opts.dryRun)
			await finishRun(tx, workspaceId, runId, result.status, result.errorDetail, result.durationMs)
		return result
	}

	if (rule.conditionAst) {
		const validation = validateFilter(rule.conditionAst)
		const issue = validation.ok ? await resolveConditionIssue(tx, actor, run.triggerSnapshot) : undefined
		let matches = false
		if (validation.ok && issue) {
			const categories = await statusCategoryResolver(tx, workspaceId)
			matches = compileFilter(validation.expr, { now: new Date(), statusCategoryOf: categories })(issue)
		}
		if (!validation.ok || !matches) {
			const result = {
				status: 'skipped' as const,
				errorDetail: validation.ok ? 'condition did not match' : 'stored condition is invalid',
				durationMs: Date.now() - started,
				steps: []
			}
			if (!opts.dryRun)
				await finishRun(tx, workspaceId, runId, result.status, result.errorDetail, result.durationMs)
			return result
		}
	}

	const payload = run.triggerSnapshot['payload']
	const vars = {
		issueId:
			payload && typeof payload === 'object' ? (payload as Record<string, unknown>)['issueId'] : undefined,
		projectId:
			payload && typeof payload === 'object' ? (payload as Record<string, unknown>)['projectId'] : undefined,
		actorId:
			payload && typeof payload === 'object' ? (payload as Record<string, unknown>)['actorId'] : undefined
	}
	const steps: StepRecord[] = []
	let finalStatus: ExecutionResult['status'] = 'succeeded'
	let finalError: string | null = null
	let failedIndex: number | null = null
	for (const [index, rawAction] of rule.actions.entries()) {
		const input = substituteTemplates(rawAction, vars) as AutomationAction
		const baseInput = typeof input === 'object' && input !== null ? (input as Record<string, unknown>) : {}
		try {
			const output = await executeActionWithSavepoint(tx, actor, input)
			const record: StepRecord = {
				stepIndex: index,
				actionKind: String(baseInput['kind'] ?? 'unknown'),
				status: opts.dryRun ? 'simulated' : 'succeeded',
				input: baseInput,
				output,
				errorDetail: null
			}
			steps.push(record)
			await insertStep(tx, { workspaceId, runId, ...record })
		} catch (error) {
			const record: StepRecord = {
				stepIndex: index,
				actionKind: String(baseInput['kind'] ?? 'unknown'),
				status: 'failed',
				input: baseInput,
				output: null,
				errorDetail: errorMessage(error)
			}
			steps.push(record)
			await insertStep(tx, { workspaceId, runId, ...record })
			finalStatus = 'failed'
			finalError = `step ${index} (${record.actionKind}) failed: ${record.errorDetail}`
			failedIndex = index
			break
		}
	}
	if (failedIndex !== null) {
		for (let index = failedIndex + 1; index < rule.actions.length; index++) {
			const input = substituteTemplates(rule.actions[index], vars) as AutomationAction
			const record: StepRecord = {
				stepIndex: index,
				actionKind: input.kind,
				status: 'skipped',
				input: input as unknown as Record<string, unknown>,
				output: null,
				errorDetail: 'aborted after earlier step failure'
			}
			steps.push(record)
			await insertStep(tx, { workspaceId, runId, ...record })
		}
	}
	const result = { status: finalStatus, errorDetail: finalError, durationMs: Date.now() - started, steps }
	if (!opts.dryRun) {
		await finishRun(tx, workspaceId, runId, result.status, result.errorDetail, result.durationMs)
		await touchRuleLastRun(tx, workspaceId, rule.id, new Date().toISOString())
	}
	return result
}

async function tryRunLock(tx: Queryable, workspaceId: string, runId: string): Promise<boolean> {
	const [row] = await tx<{ locked: boolean }[]>`
		SELECT pg_try_advisory_xact_lock(hashtext(${workspaceId}), hashtext(${runId})) AS locked
	`
	return row?.locked === true
}

export interface ExecuteAutomationRunsOptions {
	readonly runIds?: readonly AutomationRunRef[] | undefined
	readonly workspaceId?: string | undefined
	readonly batchSize?: number | undefined
}

/** Execute due runs outside the outbox transaction; concurrency-safe via a
 * transaction-scoped advisory lock per run. Crashes roll back the whole run tx,
 * leaving status='running' for the 30s spillover job to retry. */
export async function executeDueAutomationRuns(
	app: Sql,
	opts: ExecuteAutomationRunsOptions = {}
): Promise<{ readonly discovered: number; readonly executed: number; readonly skippedLocked: number }> {
	const batchSize = Math.max(1, Math.min(opts.batchSize ?? 20, 100))
	const refs =
		opts.runIds ??
		(
			await withSystem(
				app,
				(tx) =>
					tx<{ workspaceId: string; runId: string }[]>`
					SELECT workspace_id AS "workspaceId", run_id AS "runId"
					FROM list_due_automation_runs(${batchSize}, ${opts.workspaceId ?? null})
				`
			)
		).map((row) => ({ workspaceId: row.workspaceId, runId: row.runId }))

	let executed = 0
	let skippedLocked = 0
	for (const ref of refs.slice(0, batchSize)) {
		const outcome = await withWorkspace(app, { workspaceId: ref.workspaceId }, async (tx) => {
			if (!(await tryRunLock(tx, ref.workspaceId, ref.runId))) return 'locked'
			const result = await executeRunInTx(tx, ref.workspaceId, ref.runId, { dryRun: false })
			return result.status === 'skipped' && result.errorDetail?.startsWith('run status is')
				? 'not-running'
				: 'executed'
		}).catch((error) => {
			// A failure outside the managed executor path must not poison the whole
			// batch. The transaction rolled back, so the row remains running and the
			// spillover job will retry it.
			log.warn({ err: error }, 'automation run execution failed')
			return 'error'
		})
		if (outcome === 'executed') executed++
		if (outcome === 'locked') skippedLocked++
	}
	return { discovered: refs.length, executed, skippedLocked }
}

function nextRunIso(triggerConfig: Record<string, unknown>, now: Date): string | null {
	const cron = typeof triggerConfig['cron'] === 'string' ? triggerConfig['cron'] : ''
	const timezone = typeof triggerConfig['timezone'] === 'string' ? triggerConfig['timezone'] : 'UTC'
	try {
		return new Cron(cron, { paused: true, timezone }).nextRun(now)?.toISOString() ?? null
	} catch {
		return null
	}
}

/** Cron tick: ids are discovered through SECURITY DEFINER, but each schedule
 * advance + run insert happens in its tenant tx. The UPDATE is the optimistic
 * claim; duplicate workers cannot both fire the same occurrence. */
export async function runAutomationCronOnce(
	app: Sql,
	now: Date = new Date()
): Promise<{ readonly due: number; readonly fired: number; readonly runIds: AutomationRunRef[] }> {
	const due = await withSystem(
		app,
		(tx) =>
			tx<{ workspaceId: string; ruleId: string }[]>`
			SELECT workspace_id AS "workspaceId", rule_id AS "ruleId"
			FROM list_due_automation_cron_rules(${now.toISOString()})
		`
	)
	const refs: AutomationRunRef[] = []
	for (const item of due) {
		const ref = await withWorkspace(app, { workspaceId: item.workspaceId }, async (tx) => {
			const rule = await getRule(tx, item.workspaceId, item.ruleId)
			if (!rule?.enabled || rule.triggerKind !== 'cron' || !rule.nextRunAt) return null
			const next = nextRunIso(rule.triggerConfig, now)
			const claimed = await tx<{ id: string }[]>`
				UPDATE automation_rules
				SET next_run_at = ${next}
				WHERE workspace_id = ${item.workspaceId}
					AND id = ${item.ruleId}
					AND next_run_at IS NOT NULL
					AND next_run_at <= ${now.toISOString()}
				RETURNING id
			`
			if (claimed.length === 0) return null
			const settings = await workspaceAutomationSettings(tx, item.workspaceId)
			if (!settings.enabled) return null
			const used = await countRunsSince(tx, item.workspaceId, new Date(now.getTime() - 60_000).toISOString())
			const snapshot = { cron: true, scheduledFor: rule.nextRunAt }
			const status = used >= settings.maxRunsPerMinute ? 'quota_exceeded' : 'running'
			const inserted = await insertRun(tx, {
				workspaceId: item.workspaceId,
				ruleId: rule.id,
				triggerEventId: null,
				status,
				depth: 0,
				dryRun: false,
				triggerSnapshot: snapshot,
				...(status === 'quota_exceeded'
					? {
							finishedAt: now.toISOString(),
							durationMs: 0,
							errorDetail: `workspace automation quota ${settings.maxRunsPerMinute}/minute exceeded`
						}
					: {})
			})
			return inserted && status === 'running' ? { workspaceId: item.workspaceId, runId: inserted.id } : null
		})
		if (ref) refs.push(ref)
	}
	if (refs.length > 0) await executeDueAutomationRuns(app, { runIds: refs, batchSize: refs.length })
	return { due: due.length, fired: refs.length, runIds: refs }
}

class SimulationSentinel extends Error {
	readonly result: ExecutionResult

	constructor(result: ExecutionResult) {
		super('automation simulation rollback')
		this.result = result
	}
}

function runToDto(run: AutomationRunRow): AutomationRunDto {
	return {
		id: run.id,
		workspaceId: run.workspaceId,
		ruleId: run.ruleId,
		triggerEventId: run.triggerEventId,
		status: run.status as AutomationRunDto['status'],
		depth: run.depth,
		dryRun: run.dryRun,
		triggerSnapshot: run.triggerSnapshot,
		startedAt: run.startedAt,
		finishedAt: run.finishedAt,
		durationMs: run.durationMs,
		errorDetail: run.errorDetail,
		createdAt: run.createdAt
	}
}

function stepToDto(step: Awaited<ReturnType<typeof listSteps>>[number]): AutomationRunStepDto {
	return {
		id: step.id,
		workspaceId: step.workspaceId,
		runId: step.runId,
		stepIndex: step.stepIndex,
		actionKind: step.actionKind,
		status: step.status as AutomationRunStepDto['status'],
		input: step.input,
		output: step.output,
		errorDetail: step.errorDetail,
		createdAt: step.createdAt
	}
}

/** Dry-run simulator: execute the real action path in a transaction that is
 * deliberately rolled back, then persist only the audit run/step projection.
 * No mutation survives the sentinel rollback; successful steps are 'simulated'. */
export async function simulateAutomationRun(
	app: Sql,
	workspaceId: string,
	ruleId: string,
	input: { readonly eventType: string; readonly payload?: Record<string, unknown> | undefined }
): Promise<{
	readonly run: AutomationRunDto
	readonly steps: AutomationRunStepDto[]
	readonly status: string
}> {
	const snapshot = {
		eventType: input.eventType,
		payload: input.payload ?? {},
		changedAt: new Date().toISOString(),
		simulated: true
	}
	const initial = await withWorkspace(app, { workspaceId }, async (tx) => {
		const rule = await getRule(tx, workspaceId, ruleId)
		if (!rule) throw new Error('automation rule not found')
		return insertRun(tx, {
			workspaceId,
			ruleId,
			triggerEventId: null,
			status: 'dry_run',
			depth: asDepth(input.payload?.['x_automation_depth']),
			dryRun: true,
			triggerSnapshot: snapshot,
			finishedAt: new Date().toISOString(),
			durationMs: 0
		})
	})
	if (!initial) throw new Error('automation simulation insert failed')

	let execution: ExecutionResult
	try {
		await withWorkspace(app, { workspaceId }, async (tx) => {
			const result = await executeRunInTx(tx, workspaceId, initial.id, { dryRun: true })
			throw new SimulationSentinel(result)
		})
		throw new Error('simulation transaction did not roll back')
	} catch (error) {
		if (!(error instanceof SimulationSentinel)) throw error
		execution = error.result
	}

	return withWorkspace(app, { workspaceId }, async (tx) => {
		for (const step of execution.steps) await insertStep(tx, { workspaceId, runId: initial.id, ...step })
		await finishRun(tx, workspaceId, initial.id, 'dry_run', execution.errorDetail, execution.durationMs)
		const [run, steps] = await Promise.all([
			getRun(tx, workspaceId, initial.id),
			listSteps(tx, workspaceId, initial.id)
		])
		if (!run) throw new Error('automation simulation run missing')
		return { run: runToDto(run), steps: steps.map(stepToDto), status: execution.status }
	})
}
