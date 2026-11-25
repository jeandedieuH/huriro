import {
	type AutomationAction,
	AutomationActionSchema,
	type AutomationRuleDto,
	CreateAutomationRuleBody,
	type UpdateAutomationRuleBody
} from '@huriro/contracts'
import type { Queryable } from '@huriro/db'
import { type Action, type ActorContext, can, validateFilter } from '@huriro/domain'
import { Cron } from 'croner'
import { Value } from 'typebox/value'
import { parse as parseYaml, stringify as stringifyYaml } from 'yaml'
import { HttpError } from '../../api/error'
import { findActiveAutomationPrincipalByName, getPrincipalById, insertPrincipal } from '../agents'
import {
	type AutomationRuleRow,
	deleteRule,
	getRule,
	getRuleByName,
	insertRule,
	listRules,
	updateRule
} from './repo'

const DEFAULT_AUTOMATION_SCOPES = [
	'tasks.read',
	'tasks.write',
	'chat.read',
	'chat.write',
	'mail.read',
	'mail.write'
] as const

export function requireAutomationPermission(actor: ActorContext, action: Action): void {
	const decision = can(actor, action, { type: 'workspace' })
	if (decision.effect === 'allow') return
	if (decision.reason === 'not_member' || decision.reason === 'suspended') {
		throw new HttpError(403, 'not_workspace_member', 'Active workspace membership is required')
	}
	if (decision.reason === 'agent_scope') {
		throw new HttpError(403, 'agent_scope_exceeded', 'Action exceeds agent scope ceiling')
	}
	throw new HttpError(403, 'insufficient_role', `Missing permission: ${action}`)
}

async function recordRuleMutation(
	tx: Queryable,
	actor: ActorContext,
	rule: Pick<AutomationRuleRow, 'id' | 'name' | 'enabled' | 'triggerKind'>,
	auditAction: string,
	eventType: string
): Promise<void> {
	const metadata = { ruleId: rule.id, name: rule.name, enabled: rule.enabled, triggerKind: rule.triggerKind }
	await tx`
		INSERT INTO audit_log (workspace_id, actor_type, actor_id, action, target_type, target_id, metadata)
		VALUES (
			${actor.workspaceId}, ${actor.kind}, ${actor.principalId}, ${auditAction},
			'automation_rule', ${rule.id}, ${tx.json(metadata as never)}
		)
	`
	await tx`
		INSERT INTO outbox (workspace_id, aggregate, aggregate_id, event_type, payload)
		VALUES (
			${actor.workspaceId}, 'automation_rule', ${rule.id}, ${eventType}, ${tx.json(metadata as never)}
		)
	`
}

function assertValidActions(actions: readonly AutomationAction[]): void {
	if (actions.length === 0) throw new HttpError(422, 'validation_failed', 'At least one action is required')
	for (const [index, action] of actions.entries()) {
		if (Value.Check(AutomationActionSchema, action)) continue
		const [first] = [...Value.Errors(AutomationActionSchema, action)]
		throw new HttpError(
			422,
			'validation_failed',
			`Invalid action at index ${index}${first ? `: ${first.message}` : ''}`
		)
	}
}

function assertValidCondition(condition: unknown | null | undefined): unknown | null {
	if (condition === undefined || condition === null) return null
	const validation = validateFilter(condition)
	if (validation.ok) return validation.expr
	const detail = validation.errors.map((e) => `${e.path}: ${e.message}`).join('; ')
	throw new HttpError(422, 'validation_failed', `Invalid automation condition: ${detail}`)
}

export function nextCronRunAt(triggerConfig: Record<string, unknown>, from: Date = new Date()): string {
	const cron = typeof triggerConfig['cron'] === 'string' ? triggerConfig['cron'] : ''
	const timezone = typeof triggerConfig['timezone'] === 'string' ? triggerConfig['timezone'] : 'UTC'
	try {
		// paused:true makes this a pure evaluator — constructing Cron must never
		// create a process-local timer for workspace rules.
		const next = new Cron(cron, { paused: true, timezone }).nextRun(from)
		if (!next) throw new Error('no future occurrence')
		return next.toISOString()
	} catch (error) {
		throw new HttpError(
			422,
			'automation_invalid_cron',
			`Invalid cron trigger: ${error instanceof Error ? error.message : 'no future occurrence'}`
		)
	}
}

function assertTriggerMatchesKind(
	triggerKind: 'event' | 'cron',
	triggerConfig: Record<string, unknown>
): void {
	if (triggerKind === 'event') {
		const eventTypes = triggerConfig['eventTypes']
		if (
			!Array.isArray(eventTypes) ||
			eventTypes.length === 0 ||
			eventTypes.some((v) => typeof v !== 'string' || !v)
		) {
			throw new HttpError(
				422,
				'validation_failed',
				'event triggerConfig requires a non-empty eventTypes array'
			)
		}
		return
	}
	if (typeof triggerConfig['cron'] !== 'string' || triggerConfig['cron'].trim().length === 0) {
		throw new HttpError(422, 'validation_failed', 'cron triggerConfig requires a cron expression')
	}
	nextCronRunAt(triggerConfig)
}

async function resolveRulePrincipal(
	tx: Queryable,
	actor: ActorContext,
	principalId: string | undefined
): Promise<string> {
	if (principalId) {
		const principal = await getPrincipalById(tx, actor.workspaceId, principalId)
		if (principal?.kind !== 'automation') {
			throw new HttpError(422, 'validation_failed', 'principalId must reference an automation principal')
		}
		if (principal.status !== 'active') {
			throw new HttpError(422, 'validation_failed', 'Automation principal is not active')
		}
		return principal.id
	}

	const name = 'Workflow automations'
	const existing = await findActiveAutomationPrincipalByName(tx, actor.workspaceId, actor.userId, name)
	if (existing) return existing.id
	const created = await insertPrincipal(tx, {
		workspaceId: actor.workspaceId,
		ownerUserId: actor.userId,
		oauthClientId: null,
		kind: 'automation',
		name,
		scopeCeiling: [...DEFAULT_AUTOMATION_SCOPES]
	})
	return created.id
}

interface NormalizedRuleInput {
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

async function normalizeCreate(
	tx: Queryable,
	actor: ActorContext,
	body: CreateAutomationRuleBody
): Promise<NormalizedRuleInput> {
	assertTriggerMatchesKind(body.triggerKind, body.triggerConfig)
	assertValidActions(body.actions)
	const conditionAst = assertValidCondition(body.condition)
	const principalId = await resolveRulePrincipal(tx, actor, body.principalId)
	return {
		name: body.name.trim(),
		description: body.description ?? '',
		enabled: body.enabled ?? false,
		principalId,
		triggerKind: body.triggerKind,
		triggerConfig: body.triggerConfig,
		conditionAst,
		actions: body.actions as unknown as Record<string, unknown>[],
		nextRunAt: body.triggerKind === 'cron' ? nextCronRunAt(body.triggerConfig) : null
	}
}

function mergeUpdate(rule: AutomationRuleRow, body: UpdateAutomationRuleBody): CreateAutomationRuleBody {
	return {
		name: body.name ?? rule.name,
		description: body.description ?? rule.description,
		enabled: body.enabled ?? rule.enabled,
		principalId: body.principalId ?? rule.principalId,
		triggerKind: body.triggerKind ?? rule.triggerKind,
		triggerConfig: (body.triggerConfig ?? rule.triggerConfig) as CreateAutomationRuleBody['triggerConfig'],
		condition:
			body.condition === undefined ? (rule.conditionAst ?? undefined) : (body.condition ?? undefined),
		actions: (body.actions ?? rule.actions) as AutomationAction[]
	}
}

export function automationRuleToDto(row: AutomationRuleRow): AutomationRuleDto {
	return {
		id: row.id,
		workspaceId: row.workspaceId,
		name: row.name,
		description: row.description,
		enabled: row.enabled,
		principalId: row.principalId,
		triggerKind: row.triggerKind,
		triggerConfig: row.triggerConfig,
		condition: row.conditionAst,
		actions: row.actions as unknown as AutomationAction[],
		nextRunAt: row.nextRunAt,
		lastRunAt: row.lastRunAt,
		createdBy: row.createdBy,
		createdAt: row.createdAt,
		updatedAt: row.updatedAt,
		version: row.version
	}
}

export async function createAutomationRule(
	tx: Queryable,
	actor: ActorContext,
	body: CreateAutomationRuleBody
): Promise<AutomationRuleDto> {
	requireAutomationPermission(actor, 'automation.manage')
	if (!body.name.trim()) throw new HttpError(422, 'validation_failed', 'name cannot be blank')
	const normalized = await normalizeCreate(tx, actor, body)
	const row = await insertRule(tx, {
		workspaceId: actor.workspaceId,
		...normalized,
		createdBy: actor.userId
	})
	await recordRuleMutation(tx, actor, row, 'automation.rule.create', 'automation.rule.created.v1')
	return automationRuleToDto(row)
}

export async function listAutomationRules(
	tx: Queryable,
	actor: ActorContext,
	enabled?: boolean
): Promise<AutomationRuleDto[]> {
	requireAutomationPermission(actor, 'automation.read')
	return (await listRules(tx, actor.workspaceId, enabled)).map(automationRuleToDto)
}

export async function getAutomationRuleDetail(tx: Queryable, actor: ActorContext, ruleId: string) {
	requireAutomationPermission(actor, 'automation.read')
	const row = await getRule(tx, actor.workspaceId, ruleId)
	if (!row) throw new HttpError(404, 'not_found', 'Automation rule not found')
	const principal = await getPrincipalById(tx, actor.workspaceId, row.principalId)
	const [counts] = await tx<{ total: number; failed: number }[]>`
		SELECT count(*)::int AS total, count(*) FILTER (WHERE status = 'failed')::int AS failed
		FROM automation_runs
		WHERE workspace_id = ${actor.workspaceId} AND rule_id = ${row.id} AND dry_run = false
	`
	return {
		...automationRuleToDto(row),
		principal: principal
			? {
					id: principal.id,
					name: principal.name,
					ownerUserId: principal.ownerUserId,
					status: principal.status,
					scopeCeiling: principal.scopeCeiling
				}
			: null,
		runCounts: { total: counts?.total ?? 0, failed: counts?.failed ?? 0 }
	}
}

export async function updateAutomationRule(
	tx: Queryable,
	actor: ActorContext,
	ruleId: string,
	body: UpdateAutomationRuleBody
): Promise<AutomationRuleDto> {
	requireAutomationPermission(actor, 'automation.manage')
	const existing = await getRule(tx, actor.workspaceId, ruleId)
	if (!existing) throw new HttpError(404, 'not_found', 'Automation rule not found')
	const merged = mergeUpdate(existing, body)
	const normalized = await normalizeCreate(tx, actor, merged)
	const row = await updateRule(tx, actor.workspaceId, ruleId, body.version, normalized)
	if (!row) throw new HttpError(409, 'stale_version', 'Automation rule was modified — reload and retry')
	await recordRuleMutation(tx, actor, row, 'automation.rule.update', 'automation.rule.updated.v1')
	return automationRuleToDto(row)
}

export async function deleteAutomationRule(
	tx: Queryable,
	actor: ActorContext,
	ruleId: string,
	version?: number
): Promise<void> {
	requireAutomationPermission(actor, 'automation.manage')
	const existing = await getRule(tx, actor.workspaceId, ruleId)
	if (!existing) throw new HttpError(404, 'not_found', 'Automation rule not found')
	const deleted = await deleteRule(tx, actor.workspaceId, ruleId, version)
	if (!deleted) {
		throw new HttpError(409, 'stale_version', 'Automation rule was modified — reload and retry')
	}
	await recordRuleMutation(tx, actor, existing, 'automation.rule.delete', 'automation.rule.deleted.v1')
}

function yamlDocument(row: AutomationRuleRow): Record<string, unknown> {
	// YAML is the portable human-editable representation: one `trigger` object,
	// even though the relational/API representation splits kind and config.
	const trigger =
		row.triggerKind === 'event'
			? { kind: 'event', eventTypes: row.triggerConfig['eventTypes'] }
			: {
					kind: 'cron',
					cron: row.triggerConfig['cron'],
					timezone: row.triggerConfig['timezone'] ?? 'UTC'
				}
	return {
		version: 1,
		name: row.name,
		description: row.description,
		enabled: row.enabled,
		trigger,
		condition: row.conditionAst,
		actions: row.actions
	}
}

export async function exportAutomationRuleYaml(
	tx: Queryable,
	actor: ActorContext,
	ruleId: string
): Promise<string> {
	requireAutomationPermission(actor, 'automation.read')
	const row = await getRule(tx, actor.workspaceId, ruleId)
	if (!row) throw new HttpError(404, 'not_found', 'Automation rule not found')
	return stringifyYaml(yamlDocument(row))
}

export async function importAutomationRuleYaml(
	tx: Queryable,
	actor: ActorContext,
	yamlText: string
): Promise<AutomationRuleDto> {
	requireAutomationPermission(actor, 'automation.manage')
	let raw: unknown
	try {
		raw = parseYaml(yamlText)
	} catch (error) {
		throw new HttpError(
			422,
			'automation_invalid_yaml',
			error instanceof Error ? error.message : 'Invalid YAML'
		)
	}
	if (typeof raw !== 'object' || raw === null || Array.isArray(raw)) {
		throw new HttpError(422, 'automation_invalid_yaml', 'Automation YAML must be an object')
	}
	const doc = raw as Record<string, unknown>
	if (doc['version'] !== 1)
		throw new HttpError(422, 'automation_invalid_yaml', 'Unsupported automation YAML version')
	const candidate: Record<string, unknown> = { ...doc }
	delete candidate['version']
	const trigger = candidate['trigger']
	if (trigger && typeof trigger === 'object' && !Array.isArray(trigger)) {
		const t = trigger as Record<string, unknown>
		delete candidate['trigger']
		candidate['triggerKind'] = t['kind']
		if (t['kind'] === 'event') candidate['triggerConfig'] = { eventTypes: t['eventTypes'] }
		if (t['kind'] === 'cron')
			candidate['triggerConfig'] = { cron: t['cron'], timezone: t['timezone'] ?? 'UTC' }
	}
	if (!Value.Check(CreateAutomationRuleBody, candidate)) {
		const [first] = [...Value.Errors(CreateAutomationRuleBody, candidate)]
		throw new HttpError(
			422,
			'automation_invalid_yaml',
			first ? `${first.instancePath || '/'}: ${first.message}` : 'Invalid automation YAML'
		)
	}
	const body = candidate as unknown as CreateAutomationRuleBody
	const normalized = await normalizeCreate(tx, actor, body)
	// automation_rules names are workspace-unique (0020), so GitOps-style YAML
	// import is an upsert by name: first import creates, re-importing the same
	// version-controlled file updates the existing rule rather than failing.
	const existing = await getRuleByName(tx, actor.workspaceId, normalized.name)
	if (!existing) {
		const row = await insertRule(tx, {
			workspaceId: actor.workspaceId,
			...normalized,
			createdBy: actor.userId
		})
		await recordRuleMutation(tx, actor, row, 'automation.rule.import', 'automation.rule.created.v1')
		return automationRuleToDto(row)
	}
	const row = await updateRule(tx, actor.workspaceId, existing.id, existing.version, normalized)
	if (!row) throw new HttpError(409, 'stale_version', 'Automation rule was modified — reload and retry')
	await recordRuleMutation(tx, actor, row, 'automation.rule.import', 'automation.rule.updated.v1')
	return automationRuleToDto(row)
}
