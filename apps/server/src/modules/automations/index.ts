import type { AutomationRunDto, AutomationRunStepDto } from '@huriro/contracts'
import type { Sql } from '@huriro/db'
import { Elysia } from 'elysia'
import { HttpError } from '../../api/error'
import type { Auth } from '../identity'
import { workspaceDerive } from '../tenancy'
import {
	executeDueAutomationRuns,
	processAutomationOutboxEvent,
	runAutomationCronOnce,
	simulateAutomationRun
} from './executor'
import { type AutomationRunRow, type AutomationRunStepRow, getRun, listRuns, listSteps } from './repo'
import {
	AutomationRuleIdParam,
	AutomationRunIdParam,
	CreateAutomationRuleBody,
	DeleteAutomationRuleQuery,
	ImportAutomationRuleBody,
	ListAutomationRulesQuery,
	ListAutomationRunsQuery,
	SimulateAutomationRuleBody,
	UpdateAutomationRuleBody
} from './schema'
import {
	createAutomationRule,
	deleteAutomationRule,
	exportAutomationRuleYaml,
	getAutomationRuleDetail,
	importAutomationRuleYaml,
	listAutomationRules,
	requireAutomationPermission,
	updateAutomationRule
} from './service'

export { automationRuleToDto, createAutomationRule, importAutomationRuleYaml } from './service'
export {
	executeDueAutomationRuns,
	processAutomationOutboxEvent,
	runAutomationCronOnce,
	simulateAutomationRun
}

function runToDto(row: AutomationRunRow): AutomationRunDto {
	return {
		id: row.id,
		workspaceId: row.workspaceId,
		ruleId: row.ruleId,
		triggerEventId: row.triggerEventId,
		status: row.status as AutomationRunDto['status'],
		depth: row.depth,
		dryRun: row.dryRun,
		triggerSnapshot: row.triggerSnapshot,
		startedAt: row.startedAt,
		finishedAt: row.finishedAt,
		durationMs: row.durationMs,
		errorDetail: row.errorDetail,
		createdAt: row.createdAt
	}
}

function stepToDto(row: AutomationRunStepRow): AutomationRunStepDto {
	return {
		id: row.id,
		workspaceId: row.workspaceId,
		runId: row.runId,
		stepIndex: row.stepIndex,
		actionKind: row.actionKind,
		status: row.status as AutomationRunStepDto['status'],
		input: row.input,
		output: row.output,
		errorDetail: row.errorDetail,
		createdAt: row.createdAt
	}
}

/** Automations controller. Rule management is session/workspace scoped; the
 * worker imports only the executor functions exported above, never routes. */
export function automationsModule(sql: Sql, auth: Auth | null) {
	return new Elysia({ name: 'huriro.automations' })
		.derive(workspaceDerive(sql, auth))
		.get('/automations/rules', { query: ListAutomationRulesQuery }, ({ query, inWorkspace }) =>
			inWorkspace((tx, actor) =>
				listAutomationRules(tx, actor, query.enabled === undefined ? undefined : query.enabled === 'true')
			).then((data) => ({ data }))
		)
		.post('/automations/rules', { body: CreateAutomationRuleBody }, async ({ body, inWorkspace, set }) => {
			const data = await inWorkspace((tx, actor) => createAutomationRule(tx, actor, body))
			set.status = 201
			return data
		})
		.post(
			'/automations/rules/import',
			{ body: ImportAutomationRuleBody },
			async ({ body, inWorkspace, set }) => {
				const data = await inWorkspace((tx, actor) => importAutomationRuleYaml(tx, actor, body.yaml))
				set.status = 201
				return data
			}
		)
		.get('/automations/rules/:id', { params: AutomationRuleIdParam }, ({ params, inWorkspace }) =>
			inWorkspace((tx, actor) => getAutomationRuleDetail(tx, actor, params.id))
		)
		.patch(
			'/automations/rules/:id',
			{ params: AutomationRuleIdParam, body: UpdateAutomationRuleBody },
			({ params, body, inWorkspace }) =>
				inWorkspace((tx, actor) => updateAutomationRule(tx, actor, params.id, body))
		)
		.delete(
			'/automations/rules/:id',
			{ params: AutomationRuleIdParam, query: DeleteAutomationRuleQuery },
			async ({ params, query, inWorkspace, set }) => {
				await inWorkspace((tx, actor) => deleteAutomationRule(tx, actor, params.id, query.version))
				set.status = 204
			}
		)
		.get(
			'/automations/rules/:id/yaml',
			{ params: AutomationRuleIdParam },
			async ({ params, inWorkspace, set }) => {
				const yaml = await inWorkspace((tx, actor) => exportAutomationRuleYaml(tx, actor, params.id))
				set.headers['content-type'] = 'text/yaml; charset=utf-8'
				return yaml
			}
		)
		.post(
			'/automations/rules/:id/simulate',
			{ params: AutomationRuleIdParam, body: SimulateAutomationRuleBody },
			async ({ params, body, workspaceCtx, inWorkspace }) => {
				await inWorkspace(async (tx, actor) => {
					requireAutomationPermission(actor, 'automation.read')
					const detail = await getAutomationRuleDetail(tx, actor, params.id)
					if (!detail) throw new HttpError(404, 'not_found', 'Automation rule not found')
				})
				return simulateAutomationRun(sql, workspaceCtx.workspaceId, params.id, body)
			}
		)
		.get('/automations/runs', { query: ListAutomationRunsQuery }, ({ query, inWorkspace }) =>
			inWorkspace(async (tx, actor) => {
				requireAutomationPermission(actor, 'automation.read')
				const rows = await listRuns(tx, actor.workspaceId, {
					...(query.ruleId ? { ruleId: query.ruleId } : {}),
					...(query.status ? { status: query.status } : {}),
					limit: query.limit ?? 50
				})
				return { data: rows.map(runToDto) }
			})
		)
		.get('/automations/runs/:runId', { params: AutomationRunIdParam }, ({ params, inWorkspace }) =>
			inWorkspace(async (tx, actor) => {
				requireAutomationPermission(actor, 'automation.read')
				const run = await getRun(tx, actor.workspaceId, params.runId)
				if (!run) throw new HttpError(404, 'not_found', 'Automation run not found')
				const steps = await listSteps(tx, actor.workspaceId, params.runId)
				return { ...runToDto(run), steps: steps.map(stepToDto) }
			})
		)
}
