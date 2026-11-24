/** Route schemas for the agents module (§13). */
import {
	AgentIdParam,
	CreateAgentBody,
	DecideApprovalBody,
	ListAgentActivityQuery,
	ListApprovalsQuery,
	UpdateAgentBody
} from '@huriro/contracts'
import { Type } from 'typebox'

export {
	AgentIdParam,
	CreateAgentBody,
	DecideApprovalBody,
	ListAgentActivityQuery,
	ListApprovalsQuery,
	UpdateAgentBody
}

export const ToolNameParam = Type.Object(
	{ name: Type.String({ minLength: 1, maxLength: 120 }) },
	{ additionalProperties: false }
)

export const UndoIdParam = Type.Object(
	{ undoId: Type.String({ format: 'uuid' }) },
	{ additionalProperties: false }
)

export const ApprovalIdParam = Type.Object(
	{ id: Type.String({ format: 'uuid' }) },
	{ additionalProperties: false }
)
