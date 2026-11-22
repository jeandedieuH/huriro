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

export const ViewLayout = Type.Union([Type.Literal('list'), Type.Literal('board')])
export type ViewLayout = Static<typeof ViewLayout>

export const ProjectDto = Type.Object({
	id: Type.String({ format: 'uuid' }),
	workspaceId: Type.String({ format: 'uuid' }),
	key: Type.String(),
	name: Type.String(),
	description: Type.String(),
	visibility: ProjectVisibility,
	position: Type.String(),
	archivedAt: Type.Union([Type.String(), Type.Null()]),
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
	position: Type.Optional(Type.String({ minLength: 1, maxLength: 128 }))
})
export type CreateProjectBody = Static<typeof CreateProjectBody>

export const UpdateProjectBody = Type.Object({
	name: Type.Optional(Type.String({ minLength: 1, maxLength: 120 })),
	description: Type.Optional(Type.String({ maxLength: 2000 })),
	visibility: Type.Optional(ProjectVisibility),
	archived: Type.Optional(Type.Boolean()),
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

export const IssueDto = Type.Object({
	id: Type.String({ format: 'uuid' }),
	workspaceId: Type.String({ format: 'uuid' }),
	projectId: Type.String({ format: 'uuid' }),
	projectKey: Type.String(),
	number: Type.Integer(),
	identifier: Type.String(),
	parentId: Type.Union([Type.String({ format: 'uuid' }), Type.Null()]),
	cycleId: Type.Union([Type.String({ format: 'uuid' }), Type.Null()]),
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
	labelIds: Type.Optional(Type.Array(Type.String({ format: 'uuid' })))
})
export type CreateIssueBody = Static<typeof CreateIssueBody>

export const UpdateIssueBody = Type.Object({
	projectId: Type.Optional(Type.String({ format: 'uuid' })),
	title: Type.Optional(Type.String({ minLength: 1, maxLength: 500 })),
	description: Type.Optional(Type.Union([Type.Unknown(), Type.Null()])),
	descriptionText: Type.Optional(Type.String({ maxLength: 50000 })),
	statusId: Type.Optional(Type.String({ format: 'uuid' })),
	cycleId: Type.Optional(Type.Union([Type.String({ format: 'uuid' }), Type.Null()])),
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
	sort: Type.Optional(Type.Record(Type.String(), Type.Unknown())),
	isShared: Type.Optional(Type.Boolean()),
	position: Type.Optional(Type.String({ minLength: 1, maxLength: 128 }))
})
export type CreateSavedViewBody = Static<typeof CreateSavedViewBody>

export const UpdateSavedViewBody = Type.Object({
	name: Type.Optional(Type.String({ minLength: 1, maxLength: 100 })),
	layout: Type.Optional(ViewLayout),
	filters: Type.Optional(SavedViewFilters),
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
	limit: Type.Optional(Type.Integer({ minimum: 1, maximum: 200, default: 50 })),
	cursor: Type.Optional(Type.String())
})
export type ListIssuesQuery = Static<typeof ListIssuesQuery>
