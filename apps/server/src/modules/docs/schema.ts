import { DocExportFormat } from '@huriro/contracts'
import { Type } from 'typebox'

export {
	AddTeamspaceMemberBody,
	BookmarkUnfurlBody,
	CreateDocCommentBody,
	CreateDocPageBody,
	CreateDocVersionBody,
	CreateSyncedBlockBody,
	CreateTeamspaceBody,
	DecideAllSuggestionsBody,
	DecideDocSuggestionBody,
	DocAppendBody,
	DocButtonTriggerBody,
	DocExportFormat,
	DocImportMarkdownBody,
	MoveDocPageBody,
	ProposeDocSuggestionBody,
	ResolveDocCommentBody,
	RestoreDocVersionBody,
	SetDocVerificationBody,
	SplitDocPageBody,
	UpdateDocCommentBody,
	UpdateDocPageBody,
	UpdateSyncedBlockBody,
	UpdateTeamspaceBody,
	UpsertDocPublicShareBody
} from '@huriro/contracts'

export const PageIdParam = Type.Object({
	id: Type.String({ format: 'uuid' })
})

/** GET /docs/:id only — permits the `<uuid>.md` representation suffix (§13.1b). */
export const PageGetParam = Type.Object({
	id: Type.String({ minLength: 1, maxLength: 163 })
})

export const PageSlugParam = Type.Object({
	slug: Type.String({ minLength: 1, maxLength: 160 })
})

export const ListPagesQuery = Type.Object({
	includeArchived: Type.Optional(Type.Boolean()),
	includeTemplates: Type.Optional(Type.Boolean()),
	parentId: Type.Optional(Type.String({ format: 'uuid' })),
	teamspaceId: Type.Optional(Type.String({ format: 'uuid' }))
})

export const VersionDetailParam = Type.Object({
	id: Type.String({ format: 'uuid' }),
	versionId: Type.String({ format: 'uuid' })
})

export const CommentParam = Type.Object({
	id: Type.String({ format: 'uuid' }),
	commentId: Type.String({ format: 'uuid' })
})

export const ExportDocQuery = Type.Object({
	format: Type.Optional(DocExportFormat),
	includeChildren: Type.Optional(Type.Boolean())
})

export const TeamspaceIdParam = Type.Object({
	id: Type.String({ format: 'uuid' })
})

export const TeamspaceMemberParam = Type.Object({
	id: Type.String({ format: 'uuid' }),
	userId: Type.String({ format: 'uuid' })
})

export const SyncedBlockIdParam = Type.Object({
	id: Type.String({ format: 'uuid' })
})

export const SuggestionGroupParam = Type.Object({
	id: Type.String({ format: 'uuid' }),
	groupId: Type.String({ minLength: 1, maxLength: 80 })
})

export const PublicDocParam = Type.Object({
	workspaceSlug: Type.String({ minLength: 1, maxLength: 80 }),
	publicSlug: Type.String({ minLength: 1, maxLength: 163 })
})

export const PublicWorkspaceParam = Type.Object({
	workspaceSlug: Type.String({ minLength: 1, maxLength: 80 })
})

export const PublicDocUnlockBody = Type.Object({
	password: Type.String({ minLength: 1, maxLength: 128 })
})

export const OptionalVersionQuery = Type.Object({
	version: Type.Optional(Type.Integer({ minimum: 1 }))
})
