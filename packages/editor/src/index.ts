// @huriro/editor public surface (§10).
export {
	type EncodedAnchor,
	encodeProseMirrorAnchor,
	encodeTextAnchor,
	type ResolvedAnchor,
	resolveProseMirrorAnchor,
	resolveTextAnchor
} from './anchors'
export {
	BlockIdExtension,
	CalloutExtension,
	type CalloutTone,
	CommentAnchorMark,
	EmbedExtension,
	type EmbedKind,
	EntityMentionExtension,
	type MentionEntityType,
	ReferenceBlockExtension,
	type ReferenceEntityType,
	ToggleExtension
} from './extensions'
export {
	type DocVersionDiffHunk,
	diffVersionText,
	markdownToProseMirrorJson,
	markdownToYDocUpdate,
	type ProseMirrorMarkJson,
	type ProseMirrorNodeJson,
	proseMirrorJsonToMarkdown,
	ydocToMarkdown
} from './markdown'
export { isSafeUrl, sanitizeHtml } from './sanitize'
export {
	createHeadlessProseMirrorSchema,
	createHuriroExtensions,
	DOCUMENT_SIZE_MAX_BYTES,
	DOCUMENT_SIZE_WARN_BYTES,
	type HuriroExtensionsOptions
} from './schema'
export { BUILTIN_DOC_TEMPLATES, type DocTemplate, getBuiltinDocTemplate } from './templates'
export {
	appendProseMirrorNodesToYDoc,
	createEmptyYDocState,
	type DocBlockSnippet,
	type DocHeading,
	type DocMention,
	type ExtractedDocumentContent,
	extractDocumentContent,
	extractPersonHandleMentions,
	prosemirrorJsonToYDoc,
	replaceYDocContent,
	ydocToProseMirrorJson
} from './yjs-utils'
