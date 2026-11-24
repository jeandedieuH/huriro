import { Type } from 'typebox'

export {
	CreateCycleBody,
	CreateIssueBody,
	CreateIssueCommentBody,
	CreateIssueRelationBody,
	CreateLabelBody,
	CreateProjectBody,
	CreateSavedViewBody,
	CreateStatusBody,
	ListIssuesQuery,
	MoveIssueBody,
	SetIssueLabelsBody,
	UpdateCycleBody,
	UpdateIssueBody,
	UpdateIssueCommentBody,
	UpdateLabelBody,
	UpdateProjectBody,
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
