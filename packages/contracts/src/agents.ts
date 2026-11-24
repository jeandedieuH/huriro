/**
 * Agent surface wire contract (§13.1a–13.4): agent principals, approvals,
 * tool-call inputs/results for the REST `/api/v1/agent/*` surface. The
 * `packages/agent-tools` registry references these schemas so one shape
 * serves REST, OpenAPI, MCP and the CLI.
 */
import { type Static, Type } from 'typebox'
import { PaginationQuery } from './pagination'
import { unionOf } from './union'

// ---------- agent principals ----------

export const AGENT_PRINCIPAL_STATUSES = ['active', 'suspended', 'revoked'] as const
export const AgentPrincipalStatus = unionOf(AGENT_PRINCIPAL_STATUSES)
export type AgentPrincipalStatus = Static<typeof AgentPrincipalStatus>

export const AGENT_PRINCIPAL_KINDS = ['external_mcp', 'builtin_assistant', 'automation'] as const
export const AgentPrincipalKind = unionOf(AGENT_PRINCIPAL_KINDS)
export type AgentPrincipalKind = Static<typeof AgentPrincipalKind>

export const AgentPrincipalDto = Type.Object(
	{
		id: Type.String({ format: 'uuid' }),
		workspaceId: Type.String({ format: 'uuid' }),
		kind: AgentPrincipalKind,
		name: Type.String(),
		ownerUserId: Type.String({ format: 'uuid' }),
		oauthClientId: Type.Union([Type.String(), Type.Null()]),
		scopeCeiling: Type.Array(Type.String()),
		tierOverrides: Type.Record(Type.String(), Type.String()),
		requireApprovalAllWrites: Type.Boolean(),
		status: AgentPrincipalStatus,
		lastActiveAt: Type.Union([Type.String({ format: 'date-time' }), Type.Null()]),
		createdAt: Type.String({ format: 'date-time' })
	},
	{ $id: 'AgentPrincipalDto', additionalProperties: false }
)
export type AgentPrincipalDto = Static<typeof AgentPrincipalDto>

export const ConnectAgentBody = Type.Object(
	{
		clientId: Type.String({ minLength: 1 }),
		name: Type.String({ minLength: 1, maxLength: 200 }),
		kind: Type.Optional(AgentPrincipalKind),
		scopes: Type.Array(Type.String(), {
			description: 'Requested agent scopes (§13.3); intersected with AGENT_SCOPES'
		})
	},
	{ $id: 'ConnectAgentBody', additionalProperties: false }
)
export type ConnectAgentBody = Static<typeof ConnectAgentBody>

export const CreateAgentBody = Type.Object(
	{
		ownerUserId: Type.Optional(Type.String({ format: 'uuid' })),
		name: Type.String({ minLength: 1, maxLength: 200 }),
		kind: AgentPrincipalKind,
		scopes: Type.Array(Type.String())
	},
	{ $id: 'CreateAgentBody', additionalProperties: false }
)
export type CreateAgentBody = Static<typeof CreateAgentBody>

export const UpdateAgentBody = Type.Partial(
	Type.Object({
		name: Type.String({ minLength: 1, maxLength: 200 }),
		status: Type.Union([Type.Literal('active'), Type.Literal('suspended')], {
			description: 'suspend/resume; revoke is DELETE'
		}),
		tierOverrides: Type.Record(
			Type.String({ description: 'tool name' }),
			Type.Union([Type.Literal('R0'), Type.Literal('R1'), Type.Literal('R2')], {
				description: 'raise-only tier override per tool'
			})
		),
		requireApprovalAllWrites: Type.Boolean()
	}),
	{ $id: 'UpdateAgentBody', additionalProperties: false }
)
export type UpdateAgentBody = Static<typeof UpdateAgentBody>

export const AgentIdParam = Type.Object(
	{ id: Type.String({ format: 'uuid' }) },
	{ additionalProperties: false }
)

// ---------- approvals ----------

export const APPROVAL_STATUSES = [
	'pending',
	'approved',
	'denied',
	'expired',
	'executing',
	'executed',
	'failed'
] as const
export const ApprovalStatus = unionOf(APPROVAL_STATUSES)
export type ApprovalStatus = Static<typeof ApprovalStatus>

export const AgentApprovalDto = Type.Object(
	{
		id: Type.String({ format: 'uuid' }),
		workspaceId: Type.String({ format: 'uuid' }),
		agentId: Type.String({ format: 'uuid' }),
		agentName: Type.String(),
		ownerUserId: Type.String({ format: 'uuid' }),
		tool: Type.String(),
		argsHash: Type.String(),
		tokenScopes: Type.Array(Type.String()),
		previewMd: Type.String(),
		tier: Type.String(),
		status: ApprovalStatus,
		decidedBy: Type.Union([Type.String({ format: 'uuid' }), Type.Null()]),
		decidedAt: Type.Union([Type.String({ format: 'date-time' }), Type.Null()]),
		decisionReason: Type.Union([Type.String(), Type.Null()]),
		expiresAt: Type.String({ format: 'date-time' }),
		errorCode: Type.Union([Type.String(), Type.Null()]),
		createdAt: Type.String({ format: 'date-time' })
	},
	{ $id: 'AgentApprovalDto', additionalProperties: false }
)
export type AgentApprovalDto = Static<typeof AgentApprovalDto>

export const ListApprovalsQuery = Type.Object(
	{
		status: Type.Optional(ApprovalStatus),
		limit: PaginationQuery.properties.limit,
		cursor: PaginationQuery.properties.cursor
	},
	{ additionalProperties: false }
)
export type ListApprovalsQuery = Static<typeof ListApprovalsQuery>

export const DecideApprovalBody = Type.Object(
	{
		decision: Type.Union([Type.Literal('approve'), Type.Literal('deny')]),
		reason: Type.Optional(Type.String({ maxLength: 2000 }))
	},
	{ $id: 'DecideApprovalBody', additionalProperties: false }
)
export type DecideApprovalBody = Static<typeof DecideApprovalBody>

// ---------- tool calls & results ----------

export const TOOL_CALL_OUTCOMES = [
	'ok',
	'denied',
	'error',
	'needs_confirmation',
	'approval_required',
	'rate_limited'
] as const
export const ToolCallOutcome = unionOf(TOOL_CALL_OUTCOMES)
export type ToolCallOutcome = Static<typeof ToolCallOutcome>

/** A tool result carries structured data plus a sanitized Markdown rendering (§13.6). */
export const ToolResult = Type.Object(
	{
		data: Type.Unknown({ description: 'Structured result (tool-specific output schema)' }),
		markdown: Type.String({ description: 'Sanitized Markdown rendering; untrusted text delimited' }),
		trust: Type.Union([Type.Literal('trusted'), Type.Literal('untrusted')], {
			description: '"untrusted" when the result embeds user-authored text (§13.6)'
		}),
		nextCursor: Type.Optional(Type.Union([Type.String(), Type.Null()])),
		undoId: Type.Optional(Type.String({ format: 'uuid' }))
	},
	{ $id: 'ToolResult', additionalProperties: false }
)
export type ToolResult = Static<typeof ToolResult>

export const AgentToolCallDto = Type.Object(
	{
		id: Type.String({ format: 'uuid' }),
		tool: Type.String(),
		tier: Type.String(),
		status: ToolCallOutcome,
		errorCode: Type.Union([Type.String(), Type.Null()]),
		approvalId: Type.Union([Type.String({ format: 'uuid' }), Type.Null()]),
		durationMs: Type.Integer(),
		createdAt: Type.String({ format: 'date-time' })
	},
	{ $id: 'AgentToolCallDto', additionalProperties: false }
)
export type AgentToolCallDto = Static<typeof AgentToolCallDto>

export const AgentActivityDto = Type.Object(
	{
		kind: Type.Union([Type.Literal('tool_call'), Type.Literal('status_report'), Type.Literal('undo')]),
		id: Type.String({ format: 'uuid' }),
		createdAt: Type.String({ format: 'date-time' }),
		summary: Type.String(),
		detail: Type.Record(Type.String(), Type.Unknown())
	},
	{ $id: 'AgentActivityDto', additionalProperties: false }
)
export type AgentActivityDto = Static<typeof AgentActivityDto>

export const ListAgentActivityQuery = Type.Object(
	{
		limit: PaginationQuery.properties.limit,
		cursor: PaginationQuery.properties.cursor
	},
	{ additionalProperties: false }
)
export type ListAgentActivityQuery = Static<typeof ListAgentActivityQuery>

// ---------- per-tool input schemas (§13.4) ----------

export const Uuid = Type.String({ format: 'uuid' })

/** tasks.search */
export const TasksSearchInput = Type.Object(
	{
		query: Type.Optional(Type.String({ maxLength: 500 })),
		projectId: Type.Optional(Uuid),
		assigneeId: Type.Optional(Uuid),
		statusId: Type.Optional(Uuid),
		limit: PaginationQuery.properties.limit,
		cursor: PaginationQuery.properties.cursor
	},
	{ $id: 'TasksSearchInput', additionalProperties: false }
)
export type TasksSearchInput = Static<typeof TasksSearchInput>

/** tasks.get — accepts a UUID or a human identifier like "ENG-142" (§13.1a). */
export const TasksGetInput = Type.Object(
	{ issue: Type.String({ minLength: 1, maxLength: 64 }) },
	{ $id: 'TasksGetInput', additionalProperties: false }
)
export type TasksGetInput = Static<typeof TasksGetInput>

/** tasks.my_queue — issues assigned to this agent principal, excluding done. */
export const TasksMyQueueInput = Type.Object(
	{
		projectId: Type.Optional(Uuid),
		limit: PaginationQuery.properties.limit,
		cursor: PaginationQuery.properties.cursor
	},
	{ $id: 'TasksMyQueueInput', additionalProperties: false }
)
export type TasksMyQueueInput = Static<typeof TasksMyQueueInput>

export const TasksCreateInput = Type.Object(
	{
		projectId: Uuid,
		title: Type.String({ minLength: 1, maxLength: 500 }),
		description: Type.Optional(Type.String({ maxLength: 100_000 })),
		statusId: Type.Optional(Uuid),
		priority: Type.Optional(Type.Integer({ minimum: 0, maximum: 4 })),
		assigneeId: Type.Optional(Uuid),
		assigneeType: Type.Optional(Type.Union([Type.Literal('user'), Type.Literal('agent')])),
		labelIds: Type.Optional(Type.Array(Uuid)),
		parentId: Type.Optional(Uuid)
	},
	{ $id: 'TasksCreateInput', additionalProperties: false }
)
export type TasksCreateInput = Static<typeof TasksCreateInput>

export const TasksUpdateInput = Type.Object(
	{
		issue: Type.String({ minLength: 1, maxLength: 64, description: 'UUID or identifier (ENG-142)' }),
		title: Type.Optional(Type.String({ minLength: 1, maxLength: 500 })),
		description: Type.Optional(Type.String({ maxLength: 100_000 })),
		statusId: Type.Optional(Uuid),
		priority: Type.Optional(Type.Integer({ minimum: 0, maximum: 4 })),
		assigneeId: Type.Optional(Type.Union([Uuid, Type.Null()])),
		assigneeType: Type.Optional(Type.Union([Type.Literal('user'), Type.Literal('agent'), Type.Null()]))
	},
	{ $id: 'TasksUpdateInput', additionalProperties: false }
)
export type TasksUpdateInput = Static<typeof TasksUpdateInput>

export const TasksCommentInput = Type.Object(
	{
		issue: Type.String({ minLength: 1, maxLength: 64 }),
		body: Type.String({ minLength: 1, maxLength: 50_000 })
	},
	{ $id: 'TasksCommentInput', additionalProperties: false }
)
export type TasksCommentInput = Static<typeof TasksCommentInput>

export const AGENT_REPORT_STATES = ['working', 'needs_input', 'done', 'failed'] as const
export const AgentReportState = unionOf(AGENT_REPORT_STATES)
export type AgentReportState = Static<typeof AgentReportState>

export const TasksReportStatusInput = Type.Object(
	{
		issue: Type.String({ minLength: 1, maxLength: 64 }),
		state: AgentReportState,
		message: Type.String({ minLength: 1, maxLength: 10_000 }),
		links: Type.Optional(Type.Array(Type.String({ format: 'uri' }), { maxItems: 20 }))
	},
	{ $id: 'TasksReportStatusInput', additionalProperties: false }
)
export type TasksReportStatusInput = Static<typeof TasksReportStatusInput>

/** tasks.bulk_update — same patch applied to up to 200 issues (§13.5 R2). */
export const TasksBulkUpdateInput = Type.Object(
	{
		issues: Type.Array(Type.String({ minLength: 1, maxLength: 64 }), {
			minItems: 1,
			maxItems: 200,
			description: 'UUIDs or identifiers; >20 requires human approval (R2)'
		}),
		statusId: Type.Optional(Uuid),
		priority: Type.Optional(Type.Integer({ minimum: 0, maximum: 4 })),
		assigneeId: Type.Optional(Type.Union([Uuid, Type.Null()])),
		assigneeType: Type.Optional(Type.Union([Type.Literal('user'), Type.Literal('agent'), Type.Null()]))
	},
	{ $id: 'TasksBulkUpdateInput', additionalProperties: false }
)
export type TasksBulkUpdateInput = Static<typeof TasksBulkUpdateInput>

export const DocsSearchInput = Type.Object(
	{
		query: Type.String({ minLength: 1, maxLength: 500 }),
		limit: PaginationQuery.properties.limit,
		cursor: PaginationQuery.properties.cursor
	},
	{ $id: 'DocsSearchInput', additionalProperties: false }
)
export type DocsSearchInput = Static<typeof DocsSearchInput>

export const DocsGetInput = Type.Object(
	{ page: Type.String({ minLength: 1, maxLength: 200, description: 'Page UUID or slug' }) },
	{ $id: 'DocsGetInput', additionalProperties: false }
)
export type DocsGetInput = Static<typeof DocsGetInput>

export const DocsAppendInput = Type.Object(
	{
		page: Type.String({ minLength: 1, maxLength: 200 }),
		markdown: Type.String({ minLength: 1, maxLength: 200_000 })
	},
	{ $id: 'DocsAppendInput', additionalProperties: false }
)
export type DocsAppendInput = Static<typeof DocsAppendInput>

export const DocsCreateInput = Type.Object(
	{
		title: Type.String({ minLength: 1, maxLength: 500 }),
		parentId: Type.Optional(Uuid),
		markdown: Type.Optional(Type.String({ maxLength: 200_000 }))
	},
	{ $id: 'DocsCreateInput', additionalProperties: false }
)
export type DocsCreateInput = Static<typeof DocsCreateInput>

export const ChatReadThreadInput = Type.Object(
	{ parentMessageId: Uuid },
	{ $id: 'ChatReadThreadInput', additionalProperties: false }
)
export type ChatReadThreadInput = Static<typeof ChatReadThreadInput>

export const SearchUnifiedInput = Type.Object(
	{
		query: Type.String({ minLength: 1, maxLength: 500 }),
		limit: Type.Optional(Type.Integer({ minimum: 1, maximum: 100, default: 20 }))
	},
	{ $id: 'SearchUnifiedInput', additionalProperties: false }
)
export type SearchUnifiedInput = Static<typeof SearchUnifiedInput>

export const ApprovalsStatusInput = Type.Object(
	{ approvalId: Uuid },
	{ $id: 'ApprovalsStatusInput', additionalProperties: false }
)
export type ApprovalsStatusInput = Static<typeof ApprovalsStatusInput>

export const WorkspaceDescribeInput = Type.Object(
	{},
	{ $id: 'WorkspaceDescribeInput', additionalProperties: false }
)
export type WorkspaceDescribeInput = Static<typeof WorkspaceDescribeInput>
