import {
	CreateAutomationRuleBody,
	ImportAutomationRuleBody,
	ListAutomationRulesQuery,
	ListAutomationRunsQuery,
	SimulateAutomationRuleBody,
	UpdateAutomationRuleBody
} from '@huriro/contracts'
import { Type } from 'typebox'

export {
	CreateAutomationRuleBody,
	ImportAutomationRuleBody,
	ListAutomationRulesQuery,
	ListAutomationRunsQuery,
	SimulateAutomationRuleBody,
	UpdateAutomationRuleBody
}

export const AutomationRuleIdParam = Type.Object({
	id: Type.String({ format: 'uuid' })
})

export const AutomationRunIdParam = Type.Object({
	runId: Type.String({ format: 'uuid' })
})

export const DeleteAutomationRuleQuery = Type.Object({
	version: Type.Optional(Type.Integer({ minimum: 1 }))
})
