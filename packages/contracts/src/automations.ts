import { type Static, Type } from 'typebox'

/**
 * Workflow automation wire contract (§7.2, ADR-0028).
 * Ids are plain strings in action inputs because `{{issueId}}`, `{{projectId}}`,
 * and `{{actorId}}` template variables are substituted at execution time.
 */
const TemplateString = Type.String({ minLength: 1, maxLength: 256 })
const LongTemplateString = Type.String({ minLength: 1, maxLength: 20000 })
const LabelIds = Type.Array(TemplateString, { minItems: 1, maxItems: 50 })

const closed = { additionalProperties: false } as const

export const AutomationActionSchema = Type.Union([
	Type.Object(
		{
			kind: Type.Literal('issue.create'),
			projectId: TemplateString,
			title: Type.String({ minLength: 1, maxLength: 500 }),
			descriptionText: Type.Optional(Type.String({ maxLength: 50000 })),
			priority: Type.Optional(Type.Integer({ minimum: 0, maximum: 4 })),
			statusId: Type.Optional(TemplateString),
			assigneeUserId: Type.Optional(TemplateString),
			labelIds: Type.Optional(Type.Array(TemplateString, { maxItems: 50 }))
		},
		closed
	),
	Type.Object(
		{
			kind: Type.Literal('issue.update'),
			issueId: TemplateString,
			statusId: Type.Optional(TemplateString),
			priority: Type.Optional(Type.Integer({ minimum: 0, maximum: 4 })),
			assigneeUserId: Type.Optional(Type.Union([TemplateString, Type.Null()])),
			cycleId: Type.Optional(Type.Union([TemplateString, Type.Null()])),
			respectOooDelegate: Type.Optional(Type.Boolean())
		},
		closed
	),
	Type.Object(
		{ kind: Type.Literal('issue.add_labels'), issueId: TemplateString, labelIds: LabelIds },
		closed
	),
	Type.Object(
		{ kind: Type.Literal('issue.remove_labels'), issueId: TemplateString, labelIds: LabelIds },
		closed
	),
	Type.Object(
		{ kind: Type.Literal('chat.post_message'), channelId: TemplateString, bodyText: LongTemplateString },
		closed
	),
	Type.Object(
		{ kind: Type.Literal('mail.add_note'), conversationId: TemplateString, bodyText: LongTemplateString },
		closed
	),
	Type.Object(
		{
			kind: Type.Literal('mail.assign'),
			conversationId: TemplateString,
			assigneeUserId: Type.Union([TemplateString, Type.Null()]),
			respectOooDelegate: Type.Optional(Type.Boolean())
		},
		closed
	),
	Type.Object(
		{
			kind: Type.Literal('mail.route_round_robin'),
			inboxId: TemplateString
		},
		closed
	)
])
export type AutomationAction = Static<typeof AutomationActionSchema>

export const AutomationTriggerConfig = Type.Union([
	Type.Object(
		{ eventTypes: Type.Array(Type.String({ minLength: 1, maxLength: 160 }), { minItems: 1, maxItems: 50 }) },
		closed
	),
	Type.Object(
		{
			cron: Type.String({ minLength: 1, maxLength: 120 }),
			timezone: Type.Optional(Type.String({ minLength: 1, maxLength: 80 }))
		},
		closed
	)
])
export type AutomationTriggerConfig = Static<typeof AutomationTriggerConfig>

export const AutomationTriggerKind = Type.Union([Type.Literal('event'), Type.Literal('cron')])
export type AutomationTriggerKind = Static<typeof AutomationTriggerKind>

/** condition is the domain FilterExpr AST; the server validates it with validateFilter. */
const ConditionAst = Type.Unknown({ description: 'Domain FilterExpr AST (validated server-side)' })

export const AutomationRuleDto = Type.Object({
	id: Type.String({ format: 'uuid' }),
	workspaceId: Type.String({ format: 'uuid' }),
	name: Type.String(),
	description: Type.String(),
	enabled: Type.Boolean(),
	principalId: Type.String({ format: 'uuid' }),
	triggerKind: AutomationTriggerKind,
	triggerConfig: Type.Record(Type.String(), Type.Unknown()),
	condition: Type.Union([ConditionAst, Type.Null()]),
	actions: Type.Array(AutomationActionSchema),
	nextRunAt: Type.Union([Type.String(), Type.Null()]),
	lastRunAt: Type.Union([Type.String(), Type.Null()]),
	createdBy: Type.Union([Type.String({ format: 'uuid' }), Type.Null()]),
	createdAt: Type.String(),
	updatedAt: Type.String(),
	version: Type.Integer()
})
export type AutomationRuleDto = Static<typeof AutomationRuleDto>

export const CreateAutomationRuleBody = Type.Object(
	{
		name: Type.String({ minLength: 1, maxLength: 160 }),
		description: Type.Optional(Type.String({ maxLength: 4000 })),
		enabled: Type.Optional(Type.Boolean()),
		principalId: Type.Optional(Type.String({ format: 'uuid' })),
		triggerKind: AutomationTriggerKind,
		triggerConfig: AutomationTriggerConfig,
		condition: Type.Optional(ConditionAst),
		actions: Type.Array(AutomationActionSchema, { minItems: 1, maxItems: 10 })
	},
	closed
)
export type CreateAutomationRuleBody = Static<typeof CreateAutomationRuleBody>

export const UpdateAutomationRuleBody = Type.Object(
	{
		name: Type.Optional(Type.String({ minLength: 1, maxLength: 160 })),
		description: Type.Optional(Type.String({ maxLength: 4000 })),
		enabled: Type.Optional(Type.Boolean()),
		principalId: Type.Optional(Type.String({ format: 'uuid' })),
		triggerKind: Type.Optional(AutomationTriggerKind),
		triggerConfig: Type.Optional(AutomationTriggerConfig),
		condition: Type.Optional(Type.Union([ConditionAst, Type.Null()])),
		actions: Type.Optional(Type.Array(AutomationActionSchema, { minItems: 1, maxItems: 10 })),
		version: Type.Integer({ minimum: 1 })
	},
	closed
)
export type UpdateAutomationRuleBody = Static<typeof UpdateAutomationRuleBody>

export const ListAutomationRulesQuery = Type.Object({
	enabled: Type.Optional(Type.Union([Type.Literal('true'), Type.Literal('false')]))
})
export type ListAutomationRulesQuery = Static<typeof ListAutomationRulesQuery>

export const SimulateAutomationRuleBody = Type.Object(
	{
		eventType: Type.String({ minLength: 1, maxLength: 160 }),
		payload: Type.Optional(Type.Record(Type.String(), Type.Unknown()))
	},
	closed
)
export type SimulateAutomationRuleBody = Static<typeof SimulateAutomationRuleBody>

export const ImportAutomationRuleBody = Type.Object(
	{ yaml: Type.String({ minLength: 1, maxLength: 100000 }) },
	closed
)
export type ImportAutomationRuleBody = Static<typeof ImportAutomationRuleBody>

export const AutomationRunStatus = Type.Union([
	Type.Literal('running'),
	Type.Literal('succeeded'),
	Type.Literal('failed'),
	Type.Literal('skipped'),
	Type.Literal('loop_guard_tripped'),
	Type.Literal('quota_exceeded'),
	Type.Literal('dry_run')
])
export type AutomationRunStatus = Static<typeof AutomationRunStatus>

export const AutomationRunDto = Type.Object({
	id: Type.String({ format: 'uuid' }),
	workspaceId: Type.String({ format: 'uuid' }),
	ruleId: Type.String({ format: 'uuid' }),
	triggerEventId: Type.Union([Type.String({ format: 'uuid' }), Type.Null()]),
	status: AutomationRunStatus,
	depth: Type.Integer({ minimum: 0 }),
	dryRun: Type.Boolean(),
	triggerSnapshot: Type.Record(Type.String(), Type.Unknown()),
	startedAt: Type.String(),
	finishedAt: Type.Union([Type.String(), Type.Null()]),
	durationMs: Type.Union([Type.Integer(), Type.Null()]),
	errorDetail: Type.Union([Type.String(), Type.Null()]),
	createdAt: Type.String()
})
export type AutomationRunDto = Static<typeof AutomationRunDto>

export const AutomationRunStepDto = Type.Object({
	id: Type.String({ format: 'uuid' }),
	workspaceId: Type.String({ format: 'uuid' }),
	runId: Type.String({ format: 'uuid' }),
	stepIndex: Type.Integer({ minimum: 0 }),
	actionKind: Type.String(),
	status: Type.Union([
		Type.Literal('succeeded'),
		Type.Literal('failed'),
		Type.Literal('skipped'),
		Type.Literal('simulated')
	]),
	input: Type.Record(Type.String(), Type.Unknown()),
	output: Type.Union([Type.Record(Type.String(), Type.Unknown()), Type.Null()]),
	errorDetail: Type.Union([Type.String(), Type.Null()]),
	createdAt: Type.String()
})
export type AutomationRunStepDto = Static<typeof AutomationRunStepDto>

export const ListAutomationRunsQuery = Type.Object({
	ruleId: Type.Optional(Type.String({ format: 'uuid' })),
	status: Type.Optional(AutomationRunStatus),
	limit: Type.Optional(Type.Integer({ minimum: 1, maximum: 100 }))
})
export type ListAutomationRunsQuery = Static<typeof ListAutomationRunsQuery>

export const AutomationSimulationResult = Type.Object({
	run: AutomationRunDto,
	steps: Type.Array(AutomationRunStepDto),
	status: AutomationRunStatus
})
export type AutomationSimulationResult = Static<typeof AutomationSimulationResult>
