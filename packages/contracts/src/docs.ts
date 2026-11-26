import { type Static, Type } from 'typebox'

export const DocVisibility = Type.Union([Type.Literal('workspace'), Type.Literal('private')])
export type DocVisibility = Static<typeof DocVisibility>

export const DocFontStyle = Type.Union([Type.Literal('sans'), Type.Literal('serif'), Type.Literal('mono')])
export type DocFontStyle = Static<typeof DocFontStyle>

export const DocCoverGradient = Type.Union([
	Type.Literal('sunrise'),
	Type.Literal('ocean'),
	Type.Literal('forest'),
	Type.Literal('slate'),
	Type.Literal('plum')
])
export type DocCoverGradient = Static<typeof DocCoverGradient>

export const TeamspaceVisibility = Type.Union([
	Type.Literal('open'),
	Type.Literal('closed'),
	Type.Literal('private')
])
export type TeamspaceVisibility = Static<typeof TeamspaceVisibility>

export const TeamspaceRole = Type.Union([
	Type.Literal('owner'),
	Type.Literal('member'),
	Type.Literal('viewer')
])
export type TeamspaceRole = Static<typeof TeamspaceRole>

export const DocVerificationStatus = Type.Union([
	Type.Literal('verified'),
	Type.Literal('stale'),
	Type.Literal('unverified')
])
export type DocVerificationStatus = Static<typeof DocVerificationStatus>

export const DocSuggestionStatus = Type.Union([
	Type.Literal('open'),
	Type.Literal('accepted'),
	Type.Literal('rejected')
])
export type DocSuggestionStatus = Static<typeof DocSuggestionStatus>

export const DocSuggestionKind = Type.Union([
	Type.Literal('insert'),
	Type.Literal('delete'),
	Type.Literal('replace')
])
export type DocSuggestionKind = Static<typeof DocSuggestionKind>

export const DocExportFormat = Type.Union([
	Type.Literal('markdown'),
	Type.Literal('html'),
	Type.Literal('pdf-html'),
	Type.Literal('zip')
])
export type DocExportFormat = Static<typeof DocExportFormat>

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

export const TeamspaceDefaultAclEntryDto = Type.Object({
	principalType: Type.Union([Type.Literal('user'), Type.Literal('role'), Type.Literal('workspace')]),
	principalId: Type.Union([Type.String({ format: 'uuid' }), Type.Null()]),
	permission: Type.Union([
		Type.Literal('read'),
		Type.Literal('comment'),
		Type.Literal('write'),
		Type.Literal('manage')
	])
})
export type TeamspaceDefaultAclEntryDto = Static<typeof TeamspaceDefaultAclEntryDto>

export const TeamspaceDto = Type.Object({
	id: Type.String({ format: 'uuid' }),
	workspaceId: Type.String({ format: 'uuid' }),
	name: Type.String(),
	slug: Type.String(),
	icon: Type.Union([Type.String(), Type.Null()]),
	description: Type.String(),
	visibility: TeamspaceVisibility,
	defaultAcl: Type.Array(TeamspaceDefaultAclEntryDto),
	position: Type.String(),
	archivedAt: Type.Union([Type.String(), Type.Null()]),
	createdBy: Type.Union([Type.String({ format: 'uuid' }), Type.Null()]),
	createdAt: Type.String(),
	updatedAt: Type.String(),
	version: Type.Integer({ minimum: 1 })
})
export type TeamspaceDto = Static<typeof TeamspaceDto>

export const TeamspaceMemberDto = Type.Object({
	workspaceId: Type.String({ format: 'uuid' }),
	teamspaceId: Type.String({ format: 'uuid' }),
	userId: Type.String({ format: 'uuid' }),
	role: TeamspaceRole,
	createdAt: Type.String()
})
export type TeamspaceMemberDto = Static<typeof TeamspaceMemberDto>

export const DocVerificationDto = Type.Object({
	id: Type.String({ format: 'uuid' }),
	workspaceId: Type.String({ format: 'uuid' }),
	pageId: Type.String({ format: 'uuid' }),
	status: DocVerificationStatus,
	verifiedBy: Type.Union([Type.String({ format: 'uuid' }), Type.Null()]),
	verifiedAt: Type.Union([Type.String(), Type.Null()]),
	expiresAt: Type.Union([Type.String(), Type.Null()]),
	note: Type.String(),
	createdAt: Type.String(),
	updatedAt: Type.String(),
	version: Type.Integer({ minimum: 1 })
})
export type DocVerificationDto = Static<typeof DocVerificationDto>

export const DocSuggestionDto = Type.Object({
	id: Type.String({ format: 'uuid' }),
	workspaceId: Type.String({ format: 'uuid' }),
	pageId: Type.String({ format: 'uuid' }),
	groupId: Type.String(),
	kind: DocSuggestionKind,
	authorType: Type.Union([Type.Literal('user'), Type.Literal('agent')]),
	authorId: Type.String({ format: 'uuid' }),
	anchorBlockId: Type.Union([Type.String(), Type.Null()]),
	beforeText: Type.String(),
	afterText: Type.String(),
	status: DocSuggestionStatus,
	resolvedBy: Type.Union([Type.String({ format: 'uuid' }), Type.Null()]),
	resolvedAt: Type.Union([Type.String(), Type.Null()]),
	createdAt: Type.String(),
	updatedAt: Type.String(),
	version: Type.Integer({ minimum: 1 })
})
export type DocSuggestionDto = Static<typeof DocSuggestionDto>

export const DocPublicShareDto = Type.Object({
	id: Type.String({ format: 'uuid' }),
	workspaceId: Type.String({ format: 'uuid' }),
	pageId: Type.String({ format: 'uuid' }),
	publicSlug: Type.String(),
	includeChildren: Type.Boolean(),
	allowSearchIndexing: Type.Boolean(),
	hasPassword: Type.Boolean(),
	expiresAt: Type.Union([Type.String(), Type.Null()]),
	revokedAt: Type.Union([Type.String(), Type.Null()]),
	createdBy: Type.Union([Type.String({ format: 'uuid' }), Type.Null()]),
	createdAt: Type.String(),
	updatedAt: Type.String(),
	version: Type.Integer({ minimum: 1 })
})
export type DocPublicShareDto = Static<typeof DocPublicShareDto>

export const DocSyncedBlockDto = Type.Object({
	id: Type.String({ format: 'uuid' }),
	workspaceId: Type.String({ format: 'uuid' }),
	title: Type.String(),
	sourcePageId: Type.Union([Type.String({ format: 'uuid' }), Type.Null()]),
	stateBase64: Type.String(),
	stateVectorBase64: Type.String(),
	byteSize: Type.Integer({ minimum: 0 }),
	plainText: Type.String(),
	createdBy: Type.Union([Type.String({ format: 'uuid' }), Type.Null()]),
	archivedAt: Type.Union([Type.String(), Type.Null()]),
	createdAt: Type.String(),
	updatedAt: Type.String(),
	version: Type.Integer({ minimum: 1 })
})
export type DocSyncedBlockDto = Static<typeof DocSyncedBlockDto>

export const DocPageDto = Type.Object({
	id: Type.String({ format: 'uuid' }),
	workspaceId: Type.String({ format: 'uuid' }),
	parentId: Type.Union([Type.String({ format: 'uuid' }), Type.Null()]),
	teamspaceId: Type.Optional(Type.Union([Type.String({ format: 'uuid' }), Type.Null()])),
	path: Type.String(),
	depth: Type.Integer({ minimum: 0 }),
	slug: Type.String(),
	title: Type.String(),
	icon: Type.Union([Type.String(), Type.Null()]),
	coverFileId: Type.Optional(Type.Union([Type.String({ format: 'uuid' }), Type.Null()])),
	coverGradient: Type.Optional(Type.Union([Type.String(), Type.Null()])),
	coverPositionY: Type.Optional(Type.Integer({ minimum: 0, maximum: 100 })),
	fontStyle: Type.Optional(DocFontStyle),
	fullWidth: Type.Optional(Type.Boolean()),
	smallText: Type.Optional(Type.Boolean()),
	isLocked: Type.Optional(Type.Boolean()),
	lockedBy: Type.Optional(Type.Union([Type.String({ format: 'uuid' }), Type.Null()])),
	lockedAt: Type.Optional(Type.Union([Type.String(), Type.Null()])),
	verificationStatus: Type.Optional(Type.Union([DocVerificationStatus, Type.Null()])),
	verificationExpiresAt: Type.Optional(Type.Union([Type.String(), Type.Null()])),
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
	canShare: Type.Boolean(),
	canVerify: Type.Optional(Type.Boolean()),
	canPublish: Type.Optional(Type.Boolean()),
	verification: Type.Optional(Type.Union([DocVerificationDto, Type.Null()])),
	publicShare: Type.Optional(Type.Union([DocPublicShareDto, Type.Null()])),
	suggestions: Type.Optional(Type.Array(DocSuggestionDto))
})
export type DocPageDetailDto = Static<typeof DocPageDetailDto>

export const CreateDocPageBody = Type.Object({
	id: Type.Optional(Type.String({ format: 'uuid' })),
	parentId: Type.Optional(Type.Union([Type.String({ format: 'uuid' }), Type.Null()])),
	teamspaceId: Type.Optional(Type.Union([Type.String({ format: 'uuid' }), Type.Null()])),
	title: Type.String({ minLength: 1, maxLength: 200 }),
	slug: Type.Optional(Type.String({ pattern: '^[a-z0-9][a-z0-9-]{0,118}[a-z0-9]$|^[a-z0-9]$' })),
	icon: Type.Optional(Type.Union([Type.String({ maxLength: 32 }), Type.Null()])),
	coverGradient: Type.Optional(Type.Union([DocCoverGradient, Type.Null()])),
	fontStyle: Type.Optional(DocFontStyle),
	fullWidth: Type.Optional(Type.Boolean()),
	smallText: Type.Optional(Type.Boolean()),
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
	teamspaceId: Type.Optional(Type.Union([Type.String({ format: 'uuid' }), Type.Null()])),
	coverFileId: Type.Optional(Type.Union([Type.String({ format: 'uuid' }), Type.Null()])),
	coverGradient: Type.Optional(Type.Union([DocCoverGradient, Type.Null()])),
	coverPositionY: Type.Optional(Type.Integer({ minimum: 0, maximum: 100 })),
	fontStyle: Type.Optional(DocFontStyle),
	fullWidth: Type.Optional(Type.Boolean()),
	smallText: Type.Optional(Type.Boolean()),
	isLocked: Type.Optional(Type.Boolean()),
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
	markdown: Type.Optional(Type.String({ minLength: 1 })),
	/** Structured ProseMirror blocks preserve node types/attrs that Markdown cannot round-trip. */
	nodes: Type.Optional(Type.Array(Type.Record(Type.String(), Type.Unknown()), { minItems: 1 })),
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
	teamspaceId: Type.Optional(Type.Union([Type.String({ format: 'uuid' }), Type.Null()])),
	title: Type.Optional(Type.String({ minLength: 1, maxLength: 200 })),
	visibility: Type.Optional(DocVisibility),
	markdown: Type.String({ minLength: 1 })
})
export type DocImportMarkdownBody = Static<typeof DocImportMarkdownBody>

// ---------- M9 Teamspaces, Synced Blocks, Suggestions, Verification, Publishing & Graph ----------

export const CreateTeamspaceBody = Type.Object({
	name: Type.String({ minLength: 1, maxLength: 120 }),
	slug: Type.Optional(Type.String({ pattern: '^[a-z0-9][a-z0-9-]{0,118}[a-z0-9]$|^[a-z0-9]$' })),
	icon: Type.Optional(Type.Union([Type.String({ maxLength: 32 }), Type.Null()])),
	description: Type.Optional(Type.String({ maxLength: 500 })),
	visibility: Type.Optional(TeamspaceVisibility),
	defaultAcl: Type.Optional(Type.Array(TeamspaceDefaultAclEntryDto))
})
export type CreateTeamspaceBody = Static<typeof CreateTeamspaceBody>

export const UpdateTeamspaceBody = Type.Object({
	name: Type.Optional(Type.String({ minLength: 1, maxLength: 120 })),
	slug: Type.Optional(Type.String({ pattern: '^[a-z0-9][a-z0-9-]{0,118}[a-z0-9]$|^[a-z0-9]$' })),
	icon: Type.Optional(Type.Union([Type.String({ maxLength: 32 }), Type.Null()])),
	description: Type.Optional(Type.String({ maxLength: 500 })),
	visibility: Type.Optional(TeamspaceVisibility),
	defaultAcl: Type.Optional(Type.Array(TeamspaceDefaultAclEntryDto)),
	archived: Type.Optional(Type.Boolean()),
	version: Type.Integer({ minimum: 1 })
})
export type UpdateTeamspaceBody = Static<typeof UpdateTeamspaceBody>

export const AddTeamspaceMemberBody = Type.Object({
	userId: Type.String({ format: 'uuid' }),
	role: Type.Optional(TeamspaceRole)
})
export type AddTeamspaceMemberBody = Static<typeof AddTeamspaceMemberBody>

export const CreateSyncedBlockBody = Type.Object({
	title: Type.Optional(Type.String({ minLength: 1, maxLength: 160 })),
	sourcePageId: Type.Optional(Type.Union([Type.String({ format: 'uuid' }), Type.Null()])),
	markdown: Type.Optional(Type.String()),
	prosemirrorJson: Type.Optional(Type.Record(Type.String(), Type.Unknown()))
})
export type CreateSyncedBlockBody = Static<typeof CreateSyncedBlockBody>

export const UpdateSyncedBlockBody = Type.Object({
	title: Type.Optional(Type.String({ minLength: 1, maxLength: 160 })),
	markdown: Type.Optional(Type.String()),
	archived: Type.Optional(Type.Boolean()),
	version: Type.Integer({ minimum: 1 })
})
export type UpdateSyncedBlockBody = Static<typeof UpdateSyncedBlockBody>

export const ProposeDocSuggestionBody = Type.Object({
	kind: DocSuggestionKind,
	anchorBlockId: Type.Optional(Type.Union([Type.String({ maxLength: 120 }), Type.Null()])),
	targetText: Type.Optional(Type.String({ maxLength: 2000 })),
	replacementText: Type.Optional(Type.String({ maxLength: 8000 })),
	groupId: Type.Optional(Type.String({ minLength: 1, maxLength: 80 }))
})
export type ProposeDocSuggestionBody = Static<typeof ProposeDocSuggestionBody>

export const DecideDocSuggestionBody = Type.Object({
	decision: Type.Union([Type.Literal('accept'), Type.Literal('reject')])
})
export type DecideDocSuggestionBody = Static<typeof DecideDocSuggestionBody>

export const DecideAllSuggestionsBody = Type.Object({
	decision: Type.Union([Type.Literal('accept'), Type.Literal('reject')])
})
export type DecideAllSuggestionsBody = Static<typeof DecideAllSuggestionsBody>

export const SetDocVerificationBody = Type.Object({
	status: Type.Optional(DocVerificationStatus),
	ttlDays: Type.Optional(Type.Union([Type.Integer({ minimum: 1, maximum: 3650 }), Type.Null()])),
	expiresAt: Type.Optional(Type.Union([Type.String(), Type.Null()])),
	note: Type.Optional(Type.String({ maxLength: 500 }))
})
export type SetDocVerificationBody = Static<typeof SetDocVerificationBody>

export const UpsertDocPublicShareBody = Type.Object({
	publicSlug: Type.Optional(Type.String({ pattern: '^[a-z0-9][a-z0-9-]{0,118}[a-z0-9]$|^[a-z0-9]$' })),
	includeChildren: Type.Optional(Type.Boolean()),
	allowSearchIndexing: Type.Optional(Type.Boolean()),
	password: Type.Optional(Type.Union([Type.String({ minLength: 4, maxLength: 128 }), Type.Null()])),
	expiresAt: Type.Optional(Type.Union([Type.String(), Type.Null()]))
})
export type UpsertDocPublicShareBody = Static<typeof UpsertDocPublicShareBody>

export const PublicDocChildDto = Type.Object({
	id: Type.String({ format: 'uuid' }),
	title: Type.String(),
	slug: Type.String(),
	icon: Type.Union([Type.String(), Type.Null()]),
	html: Type.String(),
	markdown: Type.String(),
	headings: Type.Array(DocHeadingDto)
})
export type PublicDocChildDto = Static<typeof PublicDocChildDto>

export const PublicDocResponse = Type.Object({
	workspaceSlug: Type.String(),
	workspaceName: Type.String(),
	publicSlug: Type.String(),
	pageId: Type.String({ format: 'uuid' }),
	title: Type.String(),
	icon: Type.Union([Type.String(), Type.Null()]),
	coverGradient: Type.Union([Type.String(), Type.Null()]),
	fontStyle: DocFontStyle,
	fullWidth: Type.Boolean(),
	smallText: Type.Boolean(),
	allowSearchIndexing: Type.Boolean(),
	passwordRequired: Type.Boolean(),
	html: Type.String(),
	markdown: Type.String(),
	headings: Type.Array(DocHeadingDto),
	children: Type.Array(PublicDocChildDto),
	updatedAt: Type.String()
})
export type PublicDocResponse = Static<typeof PublicDocResponse>

export const BookmarkUnfurlBody = Type.Object({
	url: Type.String({ minLength: 1, maxLength: 2048 })
})
export type BookmarkUnfurlBody = Static<typeof BookmarkUnfurlBody>

export const BookmarkMetadataDto = Type.Object({
	url: Type.String(),
	title: Type.String(),
	description: Type.String(),
	siteName: Type.String(),
	faviconUrl: Type.Union([Type.String(), Type.Null()]),
	imageUrl: Type.Union([Type.String(), Type.Null()])
})
export type BookmarkMetadataDto = Static<typeof BookmarkMetadataDto>

export const DocButtonTriggerBody = Type.Object({
	buttonId: Type.String({ minLength: 1, maxLength: 120 }),
	label: Type.String({ minLength: 1, maxLength: 120 }),
	actionKind: Type.Union([Type.Literal('append_template'), Type.Literal('run_automation')]),
	automationRuleId: Type.Optional(Type.Union([Type.String({ format: 'uuid' }), Type.Null()])),
	payload: Type.Optional(Type.Record(Type.String(), Type.Unknown()))
})
export type DocButtonTriggerBody = Static<typeof DocButtonTriggerBody>

export const DocExportHtmlResponse = Type.Object({
	pageId: Type.String({ format: 'uuid' }),
	slug: Type.String(),
	title: Type.String(),
	html: Type.String()
})
export type DocExportHtmlResponse = Static<typeof DocExportHtmlResponse>

export const KnowledgeGraphNodeDto = Type.Object({
	id: Type.String({ format: 'uuid' }),
	kind: Type.Union([Type.Literal('teamspace'), Type.Literal('doc_page'), Type.Literal('issue')]),
	label: Type.String(),
	subtitle: Type.Optional(Type.Union([Type.String(), Type.Null()])),
	slug: Type.Optional(Type.Union([Type.String(), Type.Null()])),
	teamspaceId: Type.Optional(Type.Union([Type.String({ format: 'uuid' }), Type.Null()])),
	verificationStatus: Type.Optional(Type.Union([DocVerificationStatus, Type.Null()]))
})
export type KnowledgeGraphNodeDto = Static<typeof KnowledgeGraphNodeDto>

export const KnowledgeGraphEdgeDto = Type.Object({
	id: Type.String(),
	sourceId: Type.String({ format: 'uuid' }),
	targetId: Type.String({ format: 'uuid' }),
	relationKind: Type.String()
})
export type KnowledgeGraphEdgeDto = Static<typeof KnowledgeGraphEdgeDto>

export const KnowledgeGraphResponse = Type.Object({
	nodes: Type.Array(KnowledgeGraphNodeDto),
	edges: Type.Array(KnowledgeGraphEdgeDto)
})
export type KnowledgeGraphResponse = Static<typeof KnowledgeGraphResponse>
