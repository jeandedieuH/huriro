import { type Static, Type } from 'typebox'

export const DocVisibility = Type.Union([Type.Literal('workspace'), Type.Literal('private')])
export type DocVisibility = Static<typeof DocVisibility>

export const DocVersionKind = Type.Union([
	Type.Literal('auto'),
	Type.Literal('named'),
	Type.Literal('pre_restore')
])
export type DocVersionKind = Static<typeof DocVersionKind>

export const DocHeadingDto = Type.Object({
	blockId: Type.String(),
	level: Type.Integer({ minimum: 1, maximum: 6 }),
	text: Type.String(),
	offset: Type.Integer({ minimum: 0 })
})
export type DocHeadingDto = Static<typeof DocHeadingDto>

export const DocPageDto = Type.Object({
	id: Type.String({ format: 'uuid' }),
	workspaceId: Type.String({ format: 'uuid' }),
	parentId: Type.Union([Type.String({ format: 'uuid' }), Type.Null()]),
	path: Type.String(),
	depth: Type.Integer({ minimum: 0 }),
	slug: Type.String(),
	title: Type.String(),
	icon: Type.Union([Type.String(), Type.Null()]),
	visibility: DocVisibility,
	isTemplate: Type.Boolean(),
	isFavorite: Type.Boolean(),
	position: Type.String(),
	createdBy: Type.String({ format: 'uuid' }),
	archivedAt: Type.Union([Type.String(), Type.Null()]),
	createdAt: Type.String(),
	updatedAt: Type.String(),
	version: Type.Integer({ minimum: 1 }),
	byteSize: Type.Integer({ minimum: 0 })
})
export type DocPageDto = Static<typeof DocPageDto>

export const DocCommentDto = Type.Object({
	id: Type.String({ format: 'uuid' }),
	workspaceId: Type.String({ format: 'uuid' }),
	pageId: Type.String({ format: 'uuid' }),
	parentId: Type.Union([Type.String({ format: 'uuid' }), Type.Null()]),
	authorType: Type.Union([Type.Literal('user'), Type.Literal('agent')]),
	authorId: Type.String({ format: 'uuid' }),
	anchorFrom: Type.Union([Type.String(), Type.Null()]),
	anchorTo: Type.Union([Type.String(), Type.Null()]),
	anchorQuote: Type.String(),
	anchorBlockId: Type.Union([Type.String(), Type.Null()]),
	anchorOrphaned: Type.Boolean(),
	body: Type.Unknown(),
	bodyText: Type.String(),
	resolvedAt: Type.Union([Type.String(), Type.Null()]),
	resolvedBy: Type.Union([Type.String({ format: 'uuid' }), Type.Null()]),
	createdAt: Type.String(),
	updatedAt: Type.String(),
	deletedAt: Type.Union([Type.String(), Type.Null()]),
	version: Type.Integer({ minimum: 1 })
})
export type DocCommentDto = Static<typeof DocCommentDto>

export const DocVersionDto = Type.Object({
	id: Type.String({ format: 'uuid' }),
	workspaceId: Type.String({ format: 'uuid' }),
	pageId: Type.String({ format: 'uuid' }),
	kind: DocVersionKind,
	label: Type.Union([Type.String(), Type.Null()]),
	byteSize: Type.Integer({ minimum: 0 }),
	plainText: Type.String(),
	authors: Type.Array(Type.String({ format: 'uuid' })),
	createdBy: Type.Union([Type.String({ format: 'uuid' }), Type.Null()]),
	createdAt: Type.String()
})
export type DocVersionDto = Static<typeof DocVersionDto>

export const DocVersionDiffHunkDto = Type.Object({
	kind: Type.Union([Type.Literal('equal'), Type.Literal('add'), Type.Literal('remove')]),
	text: Type.String()
})
export type DocVersionDiffHunkDto = Static<typeof DocVersionDiffHunkDto>

export const DocVersionDetailDto = Type.Object({
	version: DocVersionDto,
	diff: Type.Array(DocVersionDiffHunkDto)
})
export type DocVersionDetailDto = Static<typeof DocVersionDetailDto>

export const DocPageDetailDto = Type.Object({
	page: DocPageDto,
	stateBase64: Type.String(),
	stateVectorBase64: Type.String(),
	byteSize: Type.Integer({ minimum: 0 }),
	plainText: Type.String(),
	headings: Type.Array(DocHeadingDto),
	comments: Type.Array(DocCommentDto),
	canWrite: Type.Boolean(),
	canShare: Type.Boolean()
})
export type DocPageDetailDto = Static<typeof DocPageDetailDto>

export const CreateDocPageBody = Type.Object({
	id: Type.Optional(Type.String({ format: 'uuid' })),
	parentId: Type.Optional(Type.Union([Type.String({ format: 'uuid' }), Type.Null()])),
	title: Type.String({ minLength: 1, maxLength: 200 }),
	slug: Type.Optional(Type.String({ pattern: '^[a-z0-9][a-z0-9-]{0,118}[a-z0-9]$|^[a-z0-9]$' })),
	icon: Type.Optional(Type.Union([Type.String({ maxLength: 32 }), Type.Null()])),
	visibility: Type.Optional(DocVisibility),
	isTemplate: Type.Optional(Type.Boolean()),
	templateId: Type.Optional(Type.String({ minLength: 1, maxLength: 100 })),
	markdown: Type.Optional(Type.String()),
	position: Type.Optional(Type.String({ minLength: 1, maxLength: 64 }))
})
export type CreateDocPageBody = Static<typeof CreateDocPageBody>

export const UpdateDocPageBody = Type.Object({
	title: Type.Optional(Type.String({ minLength: 1, maxLength: 200 })),
	slug: Type.Optional(Type.String({ pattern: '^[a-z0-9][a-z0-9-]{0,118}[a-z0-9]$|^[a-z0-9]$' })),
	icon: Type.Optional(Type.Union([Type.String({ maxLength: 32 }), Type.Null()])),
	visibility: Type.Optional(DocVisibility),
	isTemplate: Type.Optional(Type.Boolean()),
	archived: Type.Optional(Type.Boolean()),
	version: Type.Integer({ minimum: 1 })
})
export type UpdateDocPageBody = Static<typeof UpdateDocPageBody>

export const MoveDocPageBody = Type.Object({
	parentId: Type.Union([Type.String({ format: 'uuid' }), Type.Null()]),
	afterPageId: Type.Optional(Type.Union([Type.String({ format: 'uuid' }), Type.Null()])),
	beforePageId: Type.Optional(Type.Union([Type.String({ format: 'uuid' }), Type.Null()])),
	position: Type.Optional(Type.String({ minLength: 1, maxLength: 64 })),
	version: Type.Integer({ minimum: 1 })
})
export type MoveDocPageBody = Static<typeof MoveDocPageBody>

export const SplitDocPageBody = Type.Object({
	headingBlockId: Type.Optional(Type.String({ minLength: 1 })),
	title: Type.String({ minLength: 1, maxLength: 200 }),
	markdown: Type.Optional(Type.String())
})
export type SplitDocPageBody = Static<typeof SplitDocPageBody>

export const DocAppendBody = Type.Object({
	markdown: Type.String({ minLength: 1 }),
	origin: Type.Optional(Type.String({ minLength: 1, maxLength: 64 }))
})
export type DocAppendBody = Static<typeof DocAppendBody>

export const CollabTicketResponse = Type.Object({
	ticket: Type.String(),
	documentName: Type.String(),
	permission: Type.Union([Type.Literal('read'), Type.Literal('write')]),
	expiresAt: Type.String(),
	collabUrl: Type.String()
})
export type CollabTicketResponse = Static<typeof CollabTicketResponse>

export const CreateDocVersionBody = Type.Object({
	label: Type.String({ minLength: 1, maxLength: 120 })
})
export type CreateDocVersionBody = Static<typeof CreateDocVersionBody>

export const RestoreDocVersionBody = Type.Object({
	label: Type.Optional(Type.String({ minLength: 1, maxLength: 120 }))
})
export type RestoreDocVersionBody = Static<typeof RestoreDocVersionBody>

export const CreateDocCommentBody = Type.Object({
	id: Type.Optional(Type.String({ format: 'uuid' })),
	parentId: Type.Optional(Type.Union([Type.String({ format: 'uuid' }), Type.Null()])),
	anchorFrom: Type.Optional(Type.Union([Type.String(), Type.Null()])),
	anchorTo: Type.Optional(Type.Union([Type.String(), Type.Null()])),
	anchorQuote: Type.Optional(Type.String({ maxLength: 500 })),
	anchorBlockId: Type.Optional(Type.Union([Type.String({ maxLength: 120 }), Type.Null()])),
	body: Type.Optional(Type.Unknown()),
	bodyText: Type.String({ minLength: 1, maxLength: 10000 })
})
export type CreateDocCommentBody = Static<typeof CreateDocCommentBody>

export const UpdateDocCommentBody = Type.Object({
	body: Type.Optional(Type.Unknown()),
	bodyText: Type.String({ minLength: 1, maxLength: 10000 }),
	version: Type.Integer({ minimum: 1 })
})
export type UpdateDocCommentBody = Static<typeof UpdateDocCommentBody>

export const ResolveDocCommentBody = Type.Object({
	resolved: Type.Boolean()
})
export type ResolveDocCommentBody = Static<typeof ResolveDocCommentBody>

export const DocExportMarkdownResponse = Type.Object({
	pageId: Type.String({ format: 'uuid' }),
	slug: Type.String(),
	title: Type.String(),
	markdown: Type.String()
})
export type DocExportMarkdownResponse = Static<typeof DocExportMarkdownResponse>

export const DocImportMarkdownBody = Type.Object({
	parentId: Type.Optional(Type.Union([Type.String({ format: 'uuid' }), Type.Null()])),
	title: Type.Optional(Type.String({ minLength: 1, maxLength: 200 })),
	visibility: Type.Optional(DocVisibility),
	markdown: Type.String({ minLength: 1 })
})
export type DocImportMarkdownBody = Static<typeof DocImportMarkdownBody>
