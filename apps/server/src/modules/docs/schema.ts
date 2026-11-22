import { Type } from 'typebox'

export {
	CreateDocCommentBody,
	CreateDocPageBody,
	CreateDocVersionBody,
	DocAppendBody,
	DocImportMarkdownBody,
	MoveDocPageBody,
	ResolveDocCommentBody,
	RestoreDocVersionBody,
	SplitDocPageBody,
	UpdateDocCommentBody,
	UpdateDocPageBody
} from '@huriro/contracts'

export const PageIdParam = Type.Object({
	id: Type.String({ format: 'uuid' })
})

export const PageSlugParam = Type.Object({
	slug: Type.String({ minLength: 1, maxLength: 160 })
})

export const ListPagesQuery = Type.Object({
	includeArchived: Type.Optional(Type.Boolean()),
	includeTemplates: Type.Optional(Type.Boolean()),
	parentId: Type.Optional(Type.String({ format: 'uuid' }))
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
	format: Type.Optional(Type.Literal('markdown'))
})
