import { type Static, Type } from 'typebox'

export const ProjectVisibility = Type.Union([Type.Literal('workspace'), Type.Literal('private')])
export type ProjectVisibility = Static<typeof ProjectVisibility>

export const StatusCategory = Type.Union([
	Type.Literal('backlog'),
	Type.Literal('unstarted'),
	Type.Literal('started'),
	Type.Literal('completed'),
	Type.Literal('cancelled')
])
export type StatusCategory = Static<typeof StatusCategory>

export const CycleStatus = Type.Union([
	Type.Literal('planned'),
	Type.Literal('active'),
	Type.Literal('completed')
])
export type CycleStatus = Static<typeof CycleStatus>

export const AssigneeType = Type.Union([Type.Literal('user'), Type.Literal('agent')])
export type AssigneeType = Static<typeof AssigneeType>

export const RelationKind = Type.Union([
	Type.Literal('blocks'),
	Type.Literal('relates_to'),
	Type.Literal('duplicates')
])
export type RelationKind = Static<typeof RelationKind>

export const ViewLayout = Type.Union([
	Type.Literal('list'),
	Type.Literal('board'),
	Type.Literal('timeline'),
	Type.Literal('calendar'),
	Type.Literal('table')
])
export type ViewLayout = Static<typeof ViewLayout>

export const TriageStatus = Type.Union([
	Type.Literal('none'),
	Type.Literal('pending'),
	Type.Literal('accepted'),
	Type.Literal('snoozed'),
	Type.Literal('declined'),
	Type.Literal('merged')
])
export type TriageStatus = Static<typeof TriageStatus>

export const SourceKind = Type.Union([
	Type.Literal('manual'),
	Type.Literal('mail'),
	Type.Literal('chat'),
	Type.Literal('form'),
	Type.Literal('github'),
	Type.Literal('gitlab'),
	Type.Literal('api'),
	Type.Literal('agent')
])
export type SourceKind = Static<typeof SourceKind>

export const CycleAutoRolloverMode = Type.Union([
	Type.Literal('next_cycle'),
	Type.Literal('backlog'),
	Type.Literal('none')
])
export type CycleAutoRolloverMode = Static<typeof CycleAutoRolloverMode>

/**
 * Compound filter AST (§3.4) — structural mirror of the domain FilterExpr in
 * packages/domain/src/filter-ast.ts (the authority; the server re-validates
 * every incoming expression with validateFilter before use). The field/op
 * unions are literal copies of the domain registry keys — the compile-time
 * assignability test in apps/server pins them against the domain types.
 */
const FilterOp = Type.Union([
	Type.Literal('eq'),
	Type.Literal('neq'),
	Type.Literal('in'),
	Type.Literal('nin'),
	Type.Literal('lt'),
	Type.Literal('lte'),
	Type.Literal('gt'),
	Type.Literal('gte'),
	Type.Literal('contains'),
	Type.Literal('is_null'),
	Type.Literal('is_not_null')
])

const FilterField = Type.Union([
	Type.Literal('status_category'),
	Type.Literal('status_id'),
	Type.Literal('priority'),
	Type.Literal('assignee_id'),
	Type.Literal('assignee_type'),
	Type.Literal('label_id'),
	Type.Literal('cycle_id'),
	Type.Literal('project_id'),
	Type.Literal('parent_id'),
	Type.Literal('title'),
	Type.Literal('estimate'),
	Type.Literal('due_date'),
	Type.Literal('start_date'),
	Type.Literal('created_at'),
	Type.Literal('updated_at'),
	Type.Literal('closed_at'),
	Type.Literal('triage_status'),
	Type.Literal('source_kind')
])

const FilterScalar = Type.Union([Type.String(), Type.Number(), Type.Boolean()])
const FilterRelativeDate = Type.Object({
	relative: Type.String({ pattern: '^[+-]\\d{1,4}[mhdw]$' })
})
const FilterValue = Type.Union([FilterScalar, Type.Array(FilterScalar), FilterRelativeDate, Type.Null()])

const FilterPredicate = Type.Object({
	kind: Type.Literal('pred'),
	field: FilterField,
	op: FilterOp,
	value: Type.Optional(FilterValue)
})

// Named defs + Type.Ref: Type.This() resolves to the enclosing object's props
// in typebox 1.x, so recursive union members must reference the root by name.
export const FilterExprSchema = Type.Cyclic(
	{
		FilterExpr: Type.Union([
			Type.Ref('FilterAnd'),
			Type.Ref('FilterOr'),
			Type.Ref('FilterNot'),
			FilterPredicate
		]),
		FilterAnd: Type.Object({
			kind: Type.Literal('and'),
			args: Type.Array(Type.Ref('FilterExpr'))
		}),
		FilterOr: Type.Object({
			kind: Type.Literal('or'),
			args: Type.Array(Type.Ref('FilterExpr'))
		}),
		FilterNot: Type.Object({ kind: Type.Literal('not'), arg: Type.Ref('FilterExpr') })
	},
	'FilterExpr'
)

export type FilterExprSchema = Static<typeof FilterExprSchema>

/** Saved-view display options (§3.4) — all optional; renderer defaults apply. */
export const ViewDisplayOptions = Type.Object({
	groupBy: Type.Optional(Type.String({ maxLength: 64 })),
	subGroupBy: Type.Optional(Type.Union([Type.String({ maxLength: 64 }), Type.Null()])),
	sortBy: Type.Optional(Type.String({ maxLength: 64 })),
	sortDirection: Type.Optional(Type.Union([Type.Literal('asc'), Type.Literal('desc')])),
	visibleProperties: Type.Optional(Type.Array(Type.String({ maxLength: 64 }), { maxItems: 64 })),
	showSubIssues: Type.Optional(Type.Boolean())
})
export type ViewDisplayOptions = Static<typeof ViewDisplayOptions>

export const ProjectDto = Type.Object({
	id: Type.String({ format: 'uuid' }),
	workspaceId: Type.String({ format: 'uuid' }),
	key: Type.String(),
	name: Type.String(),
	description: Type.String(),
	visibility: ProjectVisibility,
	position: Type.String(),
	archivedAt: Type.Union([Type.String(), Type.Null()]),
	triageEnabled: Type.Boolean(),
	cycleEnabled: Type.Boolean(),
	cycleDurationDays: Type.Integer({ minimum: 1, maximum: 90 }),
	cycleCooldownDays: Type.Integer({ minimum: 0, maximum: 30 }),
	cycleAutoRolloverMode: CycleAutoRolloverMode,
	cycleStartWeekday: Type.Integer({ minimum: 0, maximum: 6 }),
	createdBy: Type.Union([Type.String({ format: 'uuid' }), Type.Null()]),
	createdAt: Type.String(),
	updatedAt: Type.String(),
	version: Type.Integer()
})
export type ProjectDto = Static<typeof ProjectDto>

export const CreateProjectBody = Type.Object({
	id: Type.Optional(Type.String({ format: 'uuid' })),
	key: Type.String({ pattern: '^[A-Z][A-Z0-9]{1,9}$' }),
	name: Type.String({ minLength: 1, maxLength: 120 }),
	description: Type.Optional(Type.String({ maxLength: 2000 })),
	visibility: Type.Optional(ProjectVisibility),
	position: Type.Optional(Type.String({ minLength: 1, maxLength: 128 })),
	triageEnabled: Type.Optional(Type.Boolean()),
	cycleEnabled: Type.Optional(Type.Boolean()),
	cycleDurationDays: Type.Optional(Type.Integer({ minimum: 1, maximum: 90 })),
	cycleCooldownDays: Type.Optional(Type.Integer({ minimum: 0, maximum: 30 })),
	cycleAutoRolloverMode: Type.Optional(CycleAutoRolloverMode),
	cycleStartWeekday: Type.Optional(Type.Integer({ minimum: 0, maximum: 6 }))
})
export type CreateProjectBody = Static<typeof CreateProjectBody>

export const UpdateProjectBody = Type.Object({
	name: Type.Optional(Type.String({ minLength: 1, maxLength: 120 })),
	description: Type.Optional(Type.String({ maxLength: 2000 })),
	visibility: Type.Optional(ProjectVisibility),
	archived: Type.Optional(Type.Boolean()),
	triageEnabled: Type.Optional(Type.Boolean()),
	cycleEnabled: Type.Optional(Type.Boolean()),
	cycleDurationDays: Type.Optional(Type.Integer({ minimum: 1, maximum: 90 })),
	cycleCooldownDays: Type.Optional(Type.Integer({ minimum: 0, maximum: 30 })),
	cycleAutoRolloverMode: Type.Optional(CycleAutoRolloverMode),
	cycleStartWeekday: Type.Optional(Type.Integer({ minimum: 0, maximum: 6 })),
	version: Type.Integer({ minimum: 1 })
})
export type UpdateProjectBody = Static<typeof UpdateProjectBody>

export const ProjectStatusDto = Type.Object({
	id: Type.String({ format: 'uuid' }),
	workspaceId: Type.String({ format: 'uuid' }),
	projectId: Type.String({ format: 'uuid' }),
	name: Type.String(),
	category: StatusCategory,
	color: Type.String(),
	position: Type.String(),
	isDefault: Type.Boolean(),
	createdAt: Type.String(),
	updatedAt: Type.String(),
	version: Type.Integer()
})
export type ProjectStatusDto = Static<typeof ProjectStatusDto>

export const CreateStatusBody = Type.Object({
	name: Type.String({ minLength: 1, maxLength: 60 }),
	category: StatusCategory,
	color: Type.Optional(Type.String({ minLength: 1, maxLength: 32 })),
	position: Type.Optional(Type.String({ minLength: 1, maxLength: 128 })),
	isDefault: Type.Optional(Type.Boolean())
})
export type CreateStatusBody = Static<typeof CreateStatusBody>

export const UpdateStatusBody = Type.Object({
	name: Type.Optional(Type.String({ minLength: 1, maxLength: 60 })),
	category: Type.Optional(StatusCategory),
	color: Type.Optional(Type.String({ minLength: 1, maxLength: 32 })),
	position: Type.Optional(Type.String({ minLength: 1, maxLength: 128 })),
	isDefault: Type.Optional(Type.Boolean()),
	version: Type.Integer({ minimum: 1 })
})
export type UpdateStatusBody = Static<typeof UpdateStatusBody>

export const LabelDto = Type.Object({
	id: Type.String({ format: 'uuid' }),
	workspaceId: Type.String({ format: 'uuid' }),
	name: Type.String(),
	color: Type.String(),
	createdAt: Type.String(),
	updatedAt: Type.String(),
	version: Type.Integer()
})
export type LabelDto = Static<typeof LabelDto>

export const CreateLabelBody = Type.Object({
	name: Type.String({ minLength: 1, maxLength: 60 }),
	color: Type.Optional(Type.String({ minLength: 1, maxLength: 32 }))
})
export type CreateLabelBody = Static<typeof CreateLabelBody>

export const UpdateLabelBody = Type.Object({
	name: Type.Optional(Type.String({ minLength: 1, maxLength: 60 })),
	color: Type.Optional(Type.String({ minLength: 1, maxLength: 32 })),
	version: Type.Integer({ minimum: 1 })
})
export type UpdateLabelBody = Static<typeof UpdateLabelBody>

export const CycleDto = Type.Object({
	id: Type.String({ format: 'uuid' }),
	workspaceId: Type.String({ format: 'uuid' }),
	projectId: Type.String({ format: 'uuid' }),
	name: Type.String(),
	description: Type.String(),
	status: CycleStatus,
	startsAt: Type.String(),
	endsAt: Type.String(),
	createdAt: Type.String(),
	updatedAt: Type.String(),
	version: Type.Integer()
})
export type CycleDto = Static<typeof CycleDto>

export const CreateCycleBody = Type.Object({
	projectId: Type.String({ format: 'uuid' }),
	name: Type.String({ minLength: 1, maxLength: 100 }),
	description: Type.Optional(Type.String({ maxLength: 1000 })),
	status: Type.Optional(CycleStatus),
	startsAt: Type.String({ pattern: '^\\d{4}-\\d{2}-\\d{2}$' }),
	endsAt: Type.String({ pattern: '^\\d{4}-\\d{2}-\\d{2}$' })
})
export type CreateCycleBody = Static<typeof CreateCycleBody>

export const UpdateCycleBody = Type.Object({
	name: Type.Optional(Type.String({ minLength: 1, maxLength: 100 })),
	description: Type.Optional(Type.String({ maxLength: 1000 })),
	status: Type.Optional(CycleStatus),
	startsAt: Type.Optional(Type.String({ pattern: '^\\d{4}-\\d{2}-\\d{2}$' })),
	endsAt: Type.Optional(Type.String({ pattern: '^\\d{4}-\\d{2}-\\d{2}$' })),
	version: Type.Integer({ minimum: 1 })
})
export type UpdateCycleBody = Static<typeof UpdateCycleBody>

/**
 * Nightly burnup snapshot of one active cycle (§3.3) — composite key
 * (workspaceId, cycleId, snapshotDate), no surrogate id. Estimates serialize
 * as numbers, matching `IssueDto.estimate` (numeric → float8 on read).
 * scopeAdded/Removed are the NET total-issue delta vs the prior snapshot —
 * exact membership tracking arrives with issue_activity in M8.
 */
export const CycleDailySnapshotDto = Type.Object({
	workspaceId: Type.String({ format: 'uuid' }),
	cycleId: Type.String({ format: 'uuid' }),
	snapshotDate: Type.String(),
	totalIssues: Type.Integer(),
	completedIssues: Type.Integer(),
	startedIssues: Type.Integer(),
	cancelledIssues: Type.Integer(),
	totalEstimate: Type.Number(),
	completedEstimate: Type.Number(),
	scopeAddedCount: Type.Integer(),
	scopeRemovedCount: Type.Integer(),
	createdAt: Type.String()
})
export type CycleDailySnapshotDto = Static<typeof CycleDailySnapshotDto>

// ---------- M8 planning: initiatives, project updates & milestones (§3.2) ----------

export const PlanningHealth = Type.Union([
	Type.Literal('on_track'),
	Type.Literal('at_risk'),
	Type.Literal('off_track'),
	Type.Literal('completed')
])
export type PlanningHealth = Static<typeof PlanningHealth>

export const MilestoneStatus = Type.Union([
	Type.Literal('planned'),
	Type.Literal('completed'),
	Type.Literal('missed')
])
export type MilestoneStatus = Static<typeof MilestoneStatus>

const DateString = Type.String({ pattern: '^\\d{4}-\\d{2}-\\d{2}$' })

export const InitiativeDto = Type.Object({
	id: Type.String({ format: 'uuid' }),
	workspaceId: Type.String({ format: 'uuid' }),
	name: Type.String(),
	description: Type.Union([Type.Unknown(), Type.Null()]),
	descriptionText: Type.String(),
	health: PlanningHealth,
	ownerId: Type.Union([Type.String({ format: 'uuid' }), Type.Null()]),
	targetDate: Type.Union([Type.String(), Type.Null()]),
	position: Type.String(),
	/** Ordered project ids attached through initiative_projects (visibility-filtered). */
	projectIds: Type.Array(Type.String({ format: 'uuid' })),
	createdAt: Type.String(),
	updatedAt: Type.String(),
	version: Type.Integer()
})
export type InitiativeDto = Static<typeof InitiativeDto>

export const CreateInitiativeBody = Type.Object({
	id: Type.Optional(Type.String({ format: 'uuid' })),
	name: Type.String({ minLength: 1, maxLength: 160 }),
	description: Type.Optional(Type.Union([Type.Unknown(), Type.Null()])),
	descriptionText: Type.Optional(Type.String({ maxLength: 20000 })),
	health: Type.Optional(PlanningHealth),
	ownerId: Type.Optional(Type.Union([Type.String({ format: 'uuid' }), Type.Null()])),
	targetDate: Type.Optional(Type.Union([DateString, Type.Null()])),
	projectIds: Type.Optional(
		Type.Array(Type.String({ format: 'uuid' }), { maxItems: 200, uniqueItems: true })
	),
	position: Type.Optional(Type.String({ minLength: 1, maxLength: 128 }))
})
export type CreateInitiativeBody = Static<typeof CreateInitiativeBody>

export const UpdateInitiativeBody = Type.Object({
	name: Type.Optional(Type.String({ minLength: 1, maxLength: 160 })),
	description: Type.Optional(Type.Union([Type.Unknown(), Type.Null()])),
	descriptionText: Type.Optional(Type.String({ maxLength: 20000 })),
	health: Type.Optional(PlanningHealth),
	ownerId: Type.Optional(Type.Union([Type.String({ format: 'uuid' }), Type.Null()])),
	targetDate: Type.Optional(Type.Union([DateString, Type.Null()])),
	projectIds: Type.Optional(
		Type.Array(Type.String({ format: 'uuid' }), { maxItems: 200, uniqueItems: true })
	),
	position: Type.Optional(Type.String({ minLength: 1, maxLength: 128 })),
	version: Type.Integer({ minimum: 1 })
})
export type UpdateInitiativeBody = Static<typeof UpdateInitiativeBody>

export const ProjectMilestoneDto = Type.Object({
	id: Type.String({ format: 'uuid' }),
	workspaceId: Type.String({ format: 'uuid' }),
	projectId: Type.String({ format: 'uuid' }),
	name: Type.String(),
	description: Type.String(),
	targetDate: Type.Union([Type.String(), Type.Null()]),
	status: MilestoneStatus,
	position: Type.String(),
	createdAt: Type.String(),
	updatedAt: Type.String(),
	version: Type.Integer()
})
export type ProjectMilestoneDto = Static<typeof ProjectMilestoneDto>

export const CreateProjectMilestoneBody = Type.Object({
	id: Type.Optional(Type.String({ format: 'uuid' })),
	name: Type.String({ minLength: 1, maxLength: 160 }),
	description: Type.Optional(Type.String({ maxLength: 5000 })),
	targetDate: Type.Optional(Type.Union([DateString, Type.Null()])),
	status: Type.Optional(MilestoneStatus),
	position: Type.Optional(Type.String({ minLength: 1, maxLength: 128 }))
})
export type CreateProjectMilestoneBody = Static<typeof CreateProjectMilestoneBody>

export const UpdateProjectMilestoneBody = Type.Object({
	name: Type.Optional(Type.String({ minLength: 1, maxLength: 160 })),
	description: Type.Optional(Type.String({ maxLength: 5000 })),
	targetDate: Type.Optional(Type.Union([DateString, Type.Null()])),
	status: Type.Optional(MilestoneStatus),
	position: Type.Optional(Type.String({ minLength: 1, maxLength: 128 })),
	version: Type.Integer({ minimum: 1 })
})
export type UpdateProjectMilestoneBody = Static<typeof UpdateProjectMilestoneBody>

export const ProjectUpdateDto = Type.Object({
	id: Type.String({ format: 'uuid' }),
	workspaceId: Type.String({ format: 'uuid' }),
	projectId: Type.String({ format: 'uuid' }),
	health: PlanningHealth,
	body: Type.Union([Type.Unknown(), Type.Null()]),
	bodyText: Type.String(),
	completedIssues: Type.Integer({ minimum: 0 }),
	totalIssues: Type.Integer({ minimum: 0 }),
	scopeChange: Type.Integer(),
	createdBy: Type.Union([Type.String({ format: 'uuid' }), Type.Null()]),
	createdAt: Type.String(),
	updatedAt: Type.String(),
	version: Type.Integer()
})
export type ProjectUpdateDto = Static<typeof ProjectUpdateDto>

export const CreateProjectUpdateBody = Type.Object({
	id: Type.Optional(Type.String({ format: 'uuid' })),
	health: PlanningHealth,
	body: Type.Optional(Type.Union([Type.Unknown(), Type.Null()])),
	bodyText: Type.Optional(Type.String({ maxLength: 20000 })),
	completedIssues: Type.Optional(Type.Integer({ minimum: 0 })),
	totalIssues: Type.Optional(Type.Integer({ minimum: 0 })),
	scopeChange: Type.Optional(Type.Integer())
})
export type CreateProjectUpdateBody = Static<typeof CreateProjectUpdateBody>

export const IssueDto = Type.Object({
	id: Type.String({ format: 'uuid' }),
	workspaceId: Type.String({ format: 'uuid' }),
	projectId: Type.String({ format: 'uuid' }),
	projectKey: Type.String(),
	number: Type.Integer(),
	identifier: Type.String(),
	parentId: Type.Union([Type.String({ format: 'uuid' }), Type.Null()]),
	cycleId: Type.Union([Type.String({ format: 'uuid' }), Type.Null()]),
	milestoneId: Type.Optional(Type.Union([Type.String({ format: 'uuid' }), Type.Null()])),
	title: Type.String(),
	description: Type.Union([Type.Unknown(), Type.Null()]),
	descriptionText: Type.String(),
	statusId: Type.String({ format: 'uuid' }),
	priority: Type.Integer({ minimum: 0, maximum: 4 }),
	assigneeType: Type.Union([AssigneeType, Type.Null()]),
	assigneeId: Type.Union([Type.String({ format: 'uuid' }), Type.Null()]),
	creatorId: Type.String({ format: 'uuid' }),
	position: Type.String(),
	startDate: Type.Union([Type.String(), Type.Null()]),
	dueDate: Type.Union([Type.String(), Type.Null()]),
	estimate: Type.Union([Type.Number(), Type.Null()]),
	triageStatus: TriageStatus,
	triageSnoozedUntil: Type.Union([Type.String(), Type.Null()]),
	triageDeclinedReason: Type.Union([Type.String(), Type.Null()]),
	sourceKind: SourceKind,
	closedAt: Type.Union([Type.String(), Type.Null()]),
	labelIds: Type.Array(Type.String({ format: 'uuid' })),
	createdAt: Type.String(),
	updatedAt: Type.String(),
	deletedAt: Type.Union([Type.String(), Type.Null()]),
	version: Type.Integer()
})
export type IssueDto = Static<typeof IssueDto>

export const CreateIssueBody = Type.Object({
	id: Type.Optional(Type.String({ format: 'uuid' })),
	projectId: Type.String({ format: 'uuid' }),
	parentId: Type.Optional(Type.Union([Type.String({ format: 'uuid' }), Type.Null()])),
	cycleId: Type.Optional(Type.Union([Type.String({ format: 'uuid' }), Type.Null()])),
	milestoneId: Type.Optional(Type.Union([Type.String({ format: 'uuid' }), Type.Null()])),
	title: Type.String({ minLength: 1, maxLength: 500 }),
	description: Type.Optional(Type.Union([Type.Unknown(), Type.Null()])),
	descriptionText: Type.Optional(Type.String({ maxLength: 50000 })),
	statusId: Type.Optional(Type.String({ format: 'uuid' })),
	priority: Type.Optional(Type.Integer({ minimum: 0, maximum: 4 })),
	assigneeType: Type.Optional(Type.Union([AssigneeType, Type.Null()])),
	assigneeId: Type.Optional(Type.Union([Type.String({ format: 'uuid' }), Type.Null()])),
	position: Type.Optional(Type.String({ minLength: 1, maxLength: 128 })),
	startDate: Type.Optional(Type.Union([Type.String({ pattern: '^\\d{4}-\\d{2}-\\d{2}$' }), Type.Null()])),
	dueDate: Type.Optional(Type.Union([Type.String({ pattern: '^\\d{4}-\\d{2}-\\d{2}$' }), Type.Null()])),
	estimate: Type.Optional(Type.Union([Type.Number({ minimum: 0, maximum: 9999 }), Type.Null()])),
	labelIds: Type.Optional(Type.Array(Type.String({ format: 'uuid' }))),
	sourceKind: Type.Optional(SourceKind),
	/** Force the issue into the project's triage queue (§3.1). */
	triage: Type.Optional(Type.Boolean())
})
export type CreateIssueBody = Static<typeof CreateIssueBody>

export const UpdateIssueBody = Type.Object({
	projectId: Type.Optional(Type.String({ format: 'uuid' })),
	title: Type.Optional(Type.String({ minLength: 1, maxLength: 500 })),
	description: Type.Optional(Type.Union([Type.Unknown(), Type.Null()])),
	descriptionText: Type.Optional(Type.String({ maxLength: 50000 })),
	statusId: Type.Optional(Type.String({ format: 'uuid' })),
	cycleId: Type.Optional(Type.Union([Type.String({ format: 'uuid' }), Type.Null()])),
	milestoneId: Type.Optional(Type.Union([Type.String({ format: 'uuid' }), Type.Null()])),
	parentId: Type.Optional(Type.Union([Type.String({ format: 'uuid' }), Type.Null()])),
	priority: Type.Optional(Type.Integer({ minimum: 0, maximum: 4 })),
	assigneeType: Type.Optional(Type.Union([AssigneeType, Type.Null()])),
	assigneeId: Type.Optional(Type.Union([Type.String({ format: 'uuid' }), Type.Null()])),
	position: Type.Optional(Type.String({ minLength: 1, maxLength: 128 })),
	startDate: Type.Optional(Type.Union([Type.String({ pattern: '^\\d{4}-\\d{2}-\\d{2}$' }), Type.Null()])),
	dueDate: Type.Optional(Type.Union([Type.String({ pattern: '^\\d{4}-\\d{2}-\\d{2}$' }), Type.Null()])),
	estimate: Type.Optional(Type.Union([Type.Number({ minimum: 0, maximum: 9999 }), Type.Null()])),
	labelIds: Type.Optional(Type.Array(Type.String({ format: 'uuid' }))),
	version: Type.Integer({ minimum: 1 })
})
export type UpdateIssueBody = Static<typeof UpdateIssueBody>

export const MoveIssueBody = Type.Object({
	statusId: Type.Optional(Type.String({ format: 'uuid' })),
	afterIssueId: Type.Optional(Type.Union([Type.String({ format: 'uuid' }), Type.Null()])),
	beforeIssueId: Type.Optional(Type.Union([Type.String({ format: 'uuid' }), Type.Null()])),
	position: Type.Optional(Type.String({ minLength: 1, maxLength: 128 })),
	version: Type.Integer({ minimum: 1 })
})
export type MoveIssueBody = Static<typeof MoveIssueBody>

export const SetIssueLabelsBody = Type.Object({
	labelIds: Type.Array(Type.String({ format: 'uuid' })),
	version: Type.Integer({ minimum: 1 })
})
export type SetIssueLabelsBody = Static<typeof SetIssueLabelsBody>

export const IssueRelationDto = Type.Object({
	id: Type.String({ format: 'uuid' }),
	workspaceId: Type.String({ format: 'uuid' }),
	sourceIssueId: Type.String({ format: 'uuid' }),
	targetIssueId: Type.String({ format: 'uuid' }),
	kind: RelationKind,
	createdBy: Type.Union([Type.String({ format: 'uuid' }), Type.Null()]),
	createdAt: Type.String()
})
export type IssueRelationDto = Static<typeof IssueRelationDto>

export const CreateIssueRelationBody = Type.Object({
	targetIssueId: Type.String({ format: 'uuid' }),
	kind: RelationKind
})
export type CreateIssueRelationBody = Static<typeof CreateIssueRelationBody>

export const IssueCommentDto = Type.Object({
	id: Type.String({ format: 'uuid' }),
	workspaceId: Type.String({ format: 'uuid' }),
	issueId: Type.String({ format: 'uuid' }),
	authorType: AssigneeType,
	authorId: Type.String({ format: 'uuid' }),
	body: Type.Union([Type.Unknown(), Type.Null()]),
	bodyText: Type.String(),
	createdAt: Type.String(),
	updatedAt: Type.String(),
	deletedAt: Type.Union([Type.String(), Type.Null()]),
	version: Type.Integer()
})
export type IssueCommentDto = Static<typeof IssueCommentDto>

export const CreateIssueCommentBody = Type.Object({
	id: Type.Optional(Type.String({ format: 'uuid' })),
	body: Type.Optional(Type.Union([Type.Unknown(), Type.Null()])),
	bodyText: Type.String({ minLength: 1, maxLength: 20000 })
})
export type CreateIssueCommentBody = Static<typeof CreateIssueCommentBody>

export const UpdateIssueCommentBody = Type.Object({
	body: Type.Optional(Type.Union([Type.Unknown(), Type.Null()])),
	bodyText: Type.String({ minLength: 1, maxLength: 20000 }),
	version: Type.Integer({ minimum: 1 })
})
export type UpdateIssueCommentBody = Static<typeof UpdateIssueCommentBody>

export const SavedViewFilters = Type.Object({
	statusIds: Type.Optional(Type.Array(Type.String({ format: 'uuid' }))),
	priorities: Type.Optional(Type.Array(Type.Integer({ minimum: 0, maximum: 4 }))),
	assigneeIds: Type.Optional(Type.Array(Type.String({ format: 'uuid' }))),
	labelIds: Type.Optional(Type.Array(Type.String({ format: 'uuid' }))),
	cycleId: Type.Optional(Type.Union([Type.String({ format: 'uuid' }), Type.Null()])),
	mine: Type.Optional(Type.Boolean()),
	search: Type.Optional(Type.String())
})
export type SavedViewFilters = Static<typeof SavedViewFilters>

export const SavedViewDto = Type.Object({
	id: Type.String({ format: 'uuid' }),
	workspaceId: Type.String({ format: 'uuid' }),
	projectId: Type.Union([Type.String({ format: 'uuid' }), Type.Null()]),
	ownerUserId: Type.Union([Type.String({ format: 'uuid' }), Type.Null()]),
	name: Type.String(),
	layout: ViewLayout,
	filters: SavedViewFilters,
	/** Domain FilterExpr AST — when non-null it wins over `filters` (§3.4). */
	filterExpr: Type.Union([FilterExprSchema, Type.Null()]),
	displayOptions: ViewDisplayOptions,
	sort: Type.Record(Type.String(), Type.Unknown()),
	isShared: Type.Boolean(),
	position: Type.String(),
	createdAt: Type.String(),
	updatedAt: Type.String(),
	version: Type.Integer()
})
export type SavedViewDto = Static<typeof SavedViewDto>

export const CreateSavedViewBody = Type.Object({
	id: Type.Optional(Type.String({ format: 'uuid' })),
	projectId: Type.Optional(Type.Union([Type.String({ format: 'uuid' }), Type.Null()])),
	name: Type.String({ minLength: 1, maxLength: 100 }),
	layout: Type.Optional(ViewLayout),
	filters: Type.Optional(SavedViewFilters),
	filterExpr: Type.Optional(Type.Union([FilterExprSchema, Type.Null()])),
	displayOptions: Type.Optional(ViewDisplayOptions),
	sort: Type.Optional(Type.Record(Type.String(), Type.Unknown())),
	isShared: Type.Optional(Type.Boolean()),
	position: Type.Optional(Type.String({ minLength: 1, maxLength: 128 }))
})
export type CreateSavedViewBody = Static<typeof CreateSavedViewBody>

export const UpdateSavedViewBody = Type.Object({
	name: Type.Optional(Type.String({ minLength: 1, maxLength: 100 })),
	layout: Type.Optional(ViewLayout),
	filters: Type.Optional(SavedViewFilters),
	filterExpr: Type.Optional(Type.Union([FilterExprSchema, Type.Null()])),
	displayOptions: Type.Optional(ViewDisplayOptions),
	sort: Type.Optional(Type.Record(Type.String(), Type.Unknown())),
	isShared: Type.Optional(Type.Boolean()),
	version: Type.Integer({ minimum: 1 })
})
export type UpdateSavedViewBody = Static<typeof UpdateSavedViewBody>

export const ListIssuesQuery = Type.Object({
	projectId: Type.Optional(Type.String({ format: 'uuid' })),
	statusId: Type.Optional(Type.String({ format: 'uuid' })),
	assigneeId: Type.Optional(Type.String({ format: 'uuid' })),
	cycleId: Type.Optional(Type.String({ format: 'uuid' })),
	parentId: Type.Optional(Type.String({ format: 'uuid' })),
	priority: Type.Optional(Type.Integer({ minimum: 0, maximum: 4 })),
	mine: Type.Optional(Type.Boolean()),
	q: Type.Optional(Type.String()),
	/** Explicit opt-in: without it, pending/snoozed triage issues are excluded (§3.1). */
	triageStatus: Type.Optional(TriageStatus),
	limit: Type.Optional(Type.Integer({ minimum: 1, maximum: 200, default: 50 })),
	cursor: Type.Optional(Type.String())
})
export type ListIssuesQuery = Static<typeof ListIssuesQuery>

export const QueryIssuesBody = Type.Object({
	filter: Type.Optional(FilterExprSchema),
	sortBy: Type.Optional(
		Type.Union([
			Type.Literal('manual'),
			Type.Literal('priority'),
			Type.Literal('due_date'),
			Type.Literal('updated_at'),
			Type.Literal('created_at'),
			Type.Literal('estimate')
		])
	),
	sortDirection: Type.Optional(Type.Union([Type.Literal('asc'), Type.Literal('desc')])),
	limit: Type.Optional(Type.Integer({ minimum: 1, maximum: 200, default: 50 })),
	cursor: Type.Optional(Type.String())
})
export type QueryIssuesBody = Static<typeof QueryIssuesBody>

// ---------- Bulk actions (§3.4) ----------

export const BULK_UNDO_WINDOW_MS = 10_000

export const BulkIssuePatch = Type.Object(
	{
		statusId: Type.Optional(Type.String({ format: 'uuid' })),
		priority: Type.Optional(Type.Integer({ minimum: 0, maximum: 4 })),
		assigneeType: Type.Optional(AssigneeType),
		assigneeId: Type.Optional(Type.Union([Type.String({ format: 'uuid' }), Type.Null()])),
		cycleId: Type.Optional(Type.Union([Type.String({ format: 'uuid' }), Type.Null()])),
		projectId: Type.Optional(Type.String({ format: 'uuid' })),
		addLabelIds: Type.Optional(Type.Array(Type.String({ format: 'uuid' }), { maxItems: 20 })),
		removeLabelIds: Type.Optional(Type.Array(Type.String({ format: 'uuid' }), { maxItems: 20 })),
		delete: Type.Optional(Type.Literal(true))
	},
	{ minProperties: 1 }
)
export type BulkIssuePatch = Static<typeof BulkIssuePatch>

export const BulkIssuesBody = Type.Object({
	issueIds: Type.Array(Type.String({ format: 'uuid' }), {
		minItems: 1,
		maxItems: 200,
		uniqueItems: true
	}),
	patch: BulkIssuePatch
})
export type BulkIssuesBody = Static<typeof BulkIssuesBody>

/** Pre-write snapshot per issue; `version` is the version AFTER the bulk write. */
export const BulkBeforeFields = Type.Object({
	statusId: Type.String({ format: 'uuid' }),
	priority: Type.Integer(),
	assigneeType: Type.Union([AssigneeType, Type.Null()]),
	assigneeId: Type.Union([Type.String({ format: 'uuid' }), Type.Null()]),
	cycleId: Type.Union([Type.String({ format: 'uuid' }), Type.Null()]),
	labelIds: Type.Array(Type.String({ format: 'uuid' })),
	deleted: Type.Boolean()
})
export type BulkBeforeFields = Static<typeof BulkBeforeFields>

export const BulkBeforeDto = Type.Object({
	issueId: Type.String({ format: 'uuid' }),
	version: Type.Integer(),
	fields: BulkBeforeFields
})
export type BulkBeforeDto = Static<typeof BulkBeforeDto>

export const BulkIssuesResponse = Type.Object({
	data: Type.Array(IssueDto),
	before: Type.Array(BulkBeforeDto),
	cursor: Type.Integer(),
	undoWindowMs: Type.Integer()
})
export type BulkIssuesResponse = Static<typeof BulkIssuesResponse>

export const BulkRestoreBody = Type.Object({
	items: Type.Array(
		Type.Object({
			issueId: Type.String({ format: 'uuid' }),
			expectedVersion: Type.Integer({ minimum: 1 }),
			fields: BulkBeforeFields
		}),
		{ minItems: 1, maxItems: 200 }
	)
})
export type BulkRestoreBody = Static<typeof BulkRestoreBody>

// ---------- Triage (§3.1) ----------

export const TriageActionBody = Type.Union([
	Type.Object({
		action: Type.Literal('accept'),
		statusId: Type.Optional(Type.String({ format: 'uuid' })),
		assigneeId: Type.Optional(Type.Union([Type.String({ format: 'uuid' }), Type.Null()])),
		priority: Type.Optional(Type.Integer({ minimum: 0, maximum: 4 })),
		labelIds: Type.Optional(Type.Array(Type.String({ format: 'uuid' }), { maxItems: 20 })),
		version: Type.Integer({ minimum: 1 })
	}),
	Type.Object({
		action: Type.Literal('snooze'),
		until: Type.String({ format: 'date-time' }),
		version: Type.Integer({ minimum: 1 })
	}),
	Type.Object({
		action: Type.Literal('decline'),
		reason: Type.String({ minLength: 1, maxLength: 500 }),
		version: Type.Integer({ minimum: 1 })
	}),
	Type.Object({
		action: Type.Literal('merge'),
		duplicateOfIssueId: Type.String({ format: 'uuid' }),
		version: Type.Integer({ minimum: 1 })
	})
])
export type TriageActionBody = Static<typeof TriageActionBody>

export const TriageSuggestionsDto = Type.Object({
	duplicates: Type.Array(
		Type.Object({
			issueId: Type.String({ format: 'uuid' }),
			identifier: Type.String(),
			title: Type.String(),
			statusCategory: StatusCategory,
			score: Type.Number()
		})
	),
	suggestedPriority: Type.Union([Type.Integer(), Type.Null()]),
	suggestedLabelIds: Type.Array(Type.String({ format: 'uuid' })),
	suggestedAssigneeId: Type.Union([Type.String({ format: 'uuid' }), Type.Null()])
})
export type TriageSuggestionsDto = Static<typeof TriageSuggestionsDto>

export const TriageQueueQuery = Type.Object({
	state: Type.Optional(
		Type.Union([Type.Literal('pending'), Type.Literal('snoozed'), Type.Literal('resolved')])
	)
})
export type TriageQueueQuery = Static<typeof TriageQueueQuery>
