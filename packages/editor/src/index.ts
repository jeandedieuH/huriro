// @huriro/editor public surface (§10).
// Re-exported so web surfaces (e.g. slash suggestion) can suppress popups on
// remote-collab transactions without taking a direct dependency.
export { isChangeOrigin } from '@tiptap/extension-collaboration'
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
	BlockStyleExtension,
	BookmarkCardExtension,
	type ButtonBlockActionKind,
	ButtonBlockExtension,
	type ButtonBlockTone,
	CalloutExtension,
	type CalloutTone,
	ColumnExtension,
	ColumnsExtension,
	CommentAnchorMark,
	EmbedExtension,
	type EmbedKind,
	EntityMentionExtension,
	HuriroTableCell,
	HuriroTableHeader,
	MAX_COLUMNS,
	MathBlockExtension,
	MathInlineExtension,
	MermaidBlockExtension,
	type MermaidViewMode,
	MIN_COLUMN_WIDTH_PCT,
	MIN_COLUMNS,
	normalizeColumnWidths,
	ReferenceBlockExtension,
	type ReferenceEntityType,
	SEMANTIC_TONES,
	type SemanticTone,
	type SuggestionAuthorType,
	SuggestionDeleteMark,
	SuggestionInsertMark,
	type SuggestionMarkAttrs,
	SuggestionModeExtension,
	type SuggestionModeStorage,
	SyncedBlockExtension,
	TABLE_CELL_TONES,
	type TableCellTone,
	TableUpgradesExtension,
	TocBlockExtension,
	ToggleExtension,
	ToggleHeadingExtension
} from './extensions'
export { type HtmlDocFontStyle, proseMirrorJsonToSafeHtml, renderStandaloneHtmlDocument } from './html'
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
	HuriroCodeBlockExtension,
	type HuriroExtensionsOptions
} from './schema'
export {
	applyAllSuggestionsDecisionToYDoc,
	applySuggestionDecisionToYDoc,
	type ExtractedSuggestionSummary,
	extractSuggestionsFromYDoc,
	flattenOrphanedSuggestions,
	type ProposeSuggestionInput,
	proposeSuggestionOnYDoc
} from './suggestions'
export { BUILTIN_DOC_TEMPLATES, type DocTemplate, getBuiltinDocTemplate } from './templates'
export {
	appendProseMirrorNodesToYDoc,
	createEmptyYDocState,
	type DocBlockSnippet,
	type DocHeading,
	type DocMention,
	type DocReferencedLink,
	type ExtractedDocumentContent,
	extractDocumentContent,
	extractPersonHandleMentions,
	prosemirrorJsonToYDoc,
	replaceYDocContent,
	ydocToProseMirrorJson
} from './yjs-utils'
