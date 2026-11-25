import { Type } from 'typebox'

export {
	BulkIssuesBody,
	BulkRestoreBody,
	CreateCycleBody,
	CreateInitiativeBody,
	CreateIssueBody,
	CreateIssueCommentBody,
	CreateIssueRelationBody,
	CreateLabelBody,
	CreateProjectBody,
	CreateProjectMilestoneBody,
	CreateProjectUpdateBody,
	CreateSavedViewBody,
	CreateStatusBody,
	ListIssuesQuery,
	MoveIssueBody,
	QueryIssuesBody,
	SetIssueLabelsBody,
	TriageActionBody,
	TriageQueueQuery,
	UpdateCycleBody,
	UpdateInitiativeBody,
	UpdateIssueBody,
	UpdateIssueCommentBody,
	UpdateLabelBody,
	UpdateProjectBody,
	UpdateProjectMilestoneBody,
	UpdateSavedViewBody,
	UpdateStatusBody
} from '@huriro/contracts'

export const IdParam = Type.Object({
	id: Type.String({ format: 'uuid' })
})

/** GET /issues/:id only — permits the `<uuid>.md` representation suffix (§13.1b). */
export const IssueGetParam = Type.Object({
	id: Type.String({ minLength: 36, maxLength: 39 })
})

export const ProjectIdParam = Type.Object({
	projectId: Type.String({ format: 'uuid' })
})

export const IssueIdParam = Type.Object({
	issueId: Type.String({ format: 'uuid' })
})

export const CycleIdParam = Type.Object({
	cycleId: Type.String({ format: 'uuid' })
})

export const RelationDeleteParam = Type.Object({
	issueId: Type.String({ format: 'uuid' }),
	relationId: Type.String({ format: 'uuid' })
})

export const CommentPatchParam = Type.Object({
	issueId: Type.String({ format: 'uuid' }),
	commentId: Type.String({ format: 'uuid' })
})

export const IssueKeyParam = Type.Object({
	identifier: Type.String({ minLength: 3, maxLength: 64 })
})

export const ListCyclesQuery = Type.Object({
	projectId: Type.Optional(Type.String({ format: 'uuid' }))
})

export const InitiativeIdParam = Type.Object({
	initiativeId: Type.String({ format: 'uuid' })
})

export const MilestoneParam = Type.Object({
	projectId: Type.String({ format: 'uuid' }),
	milestoneId: Type.String({ format: 'uuid' })
})
