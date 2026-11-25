import { prosemirrorJSONToYXmlFragment, yDocToProsemirrorJSON } from '@tiptap/y-tiptap'
import * as Y from 'yjs'
import type { MentionEntityType } from './extensions'
import { createHeadlessProseMirrorSchema } from './schema'

export interface DocHeading {
	readonly blockId: string
	readonly level: number
	readonly text: string
	readonly offset: number
}

export interface DocBlockSnippet {
	readonly blockId: string
	readonly type: string
	readonly text: string
	readonly startOffset: number
	readonly endOffset: number
}

export interface DocMention {
	readonly entityType: MentionEntityType
	readonly entityId: string
	readonly label: string
}

export interface DocReferencedLink {
	readonly targetType: 'doc' | 'issue'
	readonly targetRef: string
	readonly by: 'id' | 'slug'
}

export interface ExtractedDocumentContent {
	readonly plainText: string
	readonly headings: DocHeading[]
	readonly blocks: DocBlockSnippet[]
	readonly mentions: DocMention[]
	readonly referencedLinks: DocReferencedLink[]
	readonly syncedBlockIds: string[]
}

const PERSON_HANDLE_RE = /(?:^|[\s(])@([a-zA-Z0-9._-]{2,64})/g

export function extractPersonHandleMentions(text: string): string[] {
	const found = new Set<string>()
	let match = PERSON_HANDLE_RE.exec(text)
	while (match !== null) {
		const handle = match[1]
		if (handle) found.add(handle.toLowerCase())
		match = PERSON_HANDLE_RE.exec(text)
	}
	PERSON_HANDLE_RE.lastIndex = 0
	return [...found]
}

function recordInternalLinkHref(href: string, links: Map<string, DocReferencedLink>): void {
	const clean = href.trim()
	if (!clean) return
	const docPrefix = /^doc:([0-9a-f-]{36})$/i.exec(clean)
	if (docPrefix?.[1]) {
		links.set(`doc:id:${docPrefix[1]}`, { targetType: 'doc', targetRef: docPrefix[1], by: 'id' })
		return
	}
	const issuePrefix = /^issue:([0-9a-f-]{36})$/i.exec(clean)
	if (issuePrefix?.[1]) {
		links.set(`issue:id:${issuePrefix[1]}`, { targetType: 'issue', targetRef: issuePrefix[1], by: 'id' })
		return
	}
	const docSlugPath = /^\/docs\/([a-z0-9-]+)(?:#.*)?$/i.exec(clean)
	if (docSlugPath?.[1]) {
		links.set(`doc:slug:${docSlugPath[1]}`, { targetType: 'doc', targetRef: docSlugPath[1], by: 'slug' })
	}
}

function collectElementTextAndMentions(
	node: Y.XmlElement | Y.XmlText | Y.XmlHook,
	mentions: Map<string, DocMention>,
	links: Map<string, DocReferencedLink>,
	syncedBlockIds: Set<string>,
	headings?: DocHeading[],
	baseOffset = 0
): string {
	if (node instanceof Y.XmlText) {
		const delta = node.toDelta() as { insert: unknown; attributes?: Record<string, unknown> }[]
		let text = ''
		for (const op of delta) {
			if (typeof op.insert === 'string') {
				const attrs = op.attributes ?? {}
				const linkAttr = attrs['link'] as { href?: unknown } | undefined
				if (linkAttr && typeof linkAttr.href === 'string') {
					recordInternalLinkHref(linkAttr.href, links)
				}
				const isDeletedSuggestion = Object.keys(attrs).some(
					(k) => k === 'suggestionDelete' || k.startsWith('suggestionDelete--')
				)
				if (!isDeletedSuggestion) {
					text += op.insert
				}
			} else if (op.insert instanceof Y.XmlElement) {
				text += collectElementTextAndMentions(
					op.insert,
					mentions,
					links,
					syncedBlockIds,
					headings,
					baseOffset
				)
			}
		}
		return text
	}

	if (!(node instanceof Y.XmlElement)) return ''

	const name = node.nodeName
	if (name === 'entityMention' || name.toLowerCase() === 'entitymention') {
		const entityTypeRaw = String(node.getAttribute('entityType') ?? 'person')
		const entityType: MentionEntityType =
			entityTypeRaw === 'issue' || entityTypeRaw === 'doc' ? entityTypeRaw : 'person'
		const entityId = String(node.getAttribute('entityId') ?? '')
		const label = String(node.getAttribute('label') ?? '')
		if (entityId) {
			mentions.set(`${entityType}:${entityId}`, { entityType, entityId, label })
			if (entityType === 'doc' || entityType === 'issue') {
				links.set(`${entityType}:id:${entityId}`, { targetType: entityType, targetRef: entityId, by: 'id' })
			}
		}
		const prefix = entityType === 'person' ? '@' : entityType === 'issue' ? '#' : ''
		return `${prefix}${label}`
	}

	if (name === 'referenceBlock') {
		const entityTypeRaw = String(node.getAttribute('entityType') ?? 'issue')
		const entityId = String(node.getAttribute('entityId') ?? '')
		if (entityId && (entityTypeRaw === 'doc' || entityTypeRaw === 'issue')) {
			links.set(`${entityTypeRaw}:id:${entityId}`, {
				targetType: entityTypeRaw,
				targetRef: entityId,
				by: 'id'
			})
		}
		const idf = String(node.getAttribute('identifier') ?? '')
		const title = String(node.getAttribute('title') ?? '')
		return idf ? `${idf}: ${title}` : title
	}

	if (name === 'syncedBlock') {
		const syncedId = String(node.getAttribute('syncedBlockId') ?? '')
		if (syncedId) syncedBlockIds.add(syncedId)
		const fallback = String(node.getAttribute('fallbackText') ?? node.getAttribute('title') ?? '')
		return fallback
	}

	if (name === 'mermaidBlock') {
		return String(node.getAttribute('alt') ?? '') || String(node.getAttribute('code') ?? '')
	}

	if (name === 'mathBlock' || name === 'mathInline') {
		return String(node.getAttribute('latex') ?? '')
	}

	if (name === 'bookmarkCard') {
		const title = String(node.getAttribute('title') ?? '')
		const url = String(node.getAttribute('url') ?? '')
		recordInternalLinkHref(url, links)
		return title || url
	}

	if (name === 'buttonBlock') {
		return String(node.getAttribute('label') ?? '')
	}

	if (name === 'embed') {
		const title = String(node.getAttribute('title') ?? '')
		const url = String(node.getAttribute('url') ?? '')
		return title || url
	}

	if (name === 'toggleHeading') {
		const summary = String(node.getAttribute('summary') ?? '').trim()
		const rawLevel = Number(node.getAttribute('level') ?? 2)
		const level = Number.isFinite(rawLevel) ? Math.max(1, Math.min(3, rawLevel)) : 2
		const rawId = node.getAttribute('blockId')
		const blockId = typeof rawId === 'string' && rawId.length > 0 ? rawId : `th-${headings?.length ?? 0}`
		if (summary && headings) {
			headings.push({ blockId, level, text: summary, offset: baseOffset })
		}
		let inner = ''
		for (const child of node.toArray()) {
			const part = collectElementTextAndMentions(child, mentions, links, syncedBlockIds, headings, baseOffset)
			if (part) inner += inner ? `\n${part}` : part
		}
		return [summary, inner].filter(Boolean).join('\n')
	}

	if (name === 'hardBreak') return '\n'

	let out = ''
	for (const child of node.toArray()) {
		const part = collectElementTextAndMentions(child, mentions, links, syncedBlockIds, headings, baseOffset)
		if (part.length > 0) {
			const isBlockChild =
				child instanceof Y.XmlElement &&
				['paragraph', 'heading', 'listItem', 'taskItem', 'tableRow', 'blockquote', 'column'].includes(
					child.nodeName
				)
			out += out.length > 0 && isBlockChild ? `\n${part}` : part
		}
	}
	return out
}

/**
 * Pure, DOM-free extraction of plain text, headings, block snippets (for deep-link search),
 * entity mentions, backlink references, and synced block IDs from a Yjs document.
 */
export function extractDocumentContent(ydoc: Y.Doc, field = 'default'): ExtractedDocumentContent {
	const fragment = ydoc.getXmlFragment(field)
	const headings: DocHeading[] = []
	const blocks: DocBlockSnippet[] = []
	const mentions = new Map<string, DocMention>()
	const links = new Map<string, DocReferencedLink>()
	const syncedBlockIds = new Set<string>()
	const blockTexts: string[] = []
	let cursorOffset = 0
	let fallbackIdx = 0

	for (const child of fragment.toArray()) {
		const text = collectElementTextAndMentions(
			child,
			mentions,
			links,
			syncedBlockIds,
			headings,
			cursorOffset
		).trim()
		if (text.length === 0) continue

		fallbackIdx += 1
		const blockType = child instanceof Y.XmlElement ? child.nodeName : 'text'
		const rawBlockId = child instanceof Y.XmlElement ? child.getAttribute('blockId') : null
		const blockId = typeof rawBlockId === 'string' && rawBlockId.length > 0 ? rawBlockId : `b-${fallbackIdx}`

		if (blockTexts.length > 0) cursorOffset += 2 // '\n\n' separator
		const startOffset = cursorOffset
		const endOffset = startOffset + text.length
		cursorOffset = endOffset

		blockTexts.push(text)
		blocks.push({ blockId, type: blockType, text, startOffset, endOffset })

		if (child instanceof Y.XmlElement && child.nodeName === 'heading') {
			const rawLevel = Number(child.getAttribute('level') ?? 1)
			const level = Number.isFinite(rawLevel) ? Math.max(1, Math.min(6, rawLevel)) : 1
			headings.push({ blockId, level, text, offset: startOffset })
		}
	}

	return {
		plainText: blockTexts.join('\n\n'),
		headings,
		blocks,
		mentions: [...mentions.values()],
		referencedLinks: [...links.values()],
		syncedBlockIds: [...syncedBlockIds]
	}
}

export function prosemirrorJsonToYDoc(
	json: Record<string, unknown>,
	existingDoc?: Y.Doc,
	field = 'default'
): Y.Doc {
	const doc = existingDoc ?? new Y.Doc()
	const schema = createHeadlessProseMirrorSchema()
	const fragment = doc.getXmlFragment(field)
	doc.transact(() => {
		if (fragment.length > 0) {
			fragment.delete(0, fragment.length)
		}
		prosemirrorJSONToYXmlFragment(schema, json, fragment)
	}, 'huriro:init')
	return doc
}

export function ydocToProseMirrorJson(ydoc: Y.Doc, field = 'default'): Record<string, unknown> {
	return yDocToProsemirrorJSON(ydoc, field) as unknown as Record<string, unknown>
}

/**
 * Forward CRDT replacement for non-destructive version restore (§10.4).
 * Deleting & re-populating inside a single `transact` keeps connected peers converging.
 */
export function replaceYDocContent(
	liveDoc: Y.Doc,
	json: Record<string, unknown>,
	origin: unknown = 'huriro:restore',
	field = 'default'
): void {
	const schema = createHeadlessProseMirrorSchema()
	const fragment = liveDoc.getXmlFragment(field)
	liveDoc.transact(() => {
		if (fragment.length > 0) {
			fragment.delete(0, fragment.length)
		}
		prosemirrorJSONToYXmlFragment(schema, json, fragment)
	}, origin)
}

/**
 * Append ProseMirror JSON nodes into a live Y.Doc via a single CRDT transaction
 * (used by server-side `docs.append` direct connections §10.2).
 */
export function appendProseMirrorNodesToYDoc(
	liveDoc: Y.Doc,
	nodes: readonly Record<string, unknown>[],
	origin: unknown = 'huriro:append',
	field = 'default'
): void {
	if (nodes.length === 0) return
	const existing = ydocToProseMirrorJson(liveDoc, field)
	const prevContent = Array.isArray(existing['content'])
		? (existing['content'] as Record<string, unknown>[])
		: []
	const isOnlyEmptyPara =
		prevContent.length === 1 &&
		prevContent[0]?.['type'] === 'paragraph' &&
		(!Array.isArray(prevContent[0]?.['content']) || prevContent[0]['content'].length === 0)
	const merged = {
		type: 'doc',
		content: isOnlyEmptyPara ? [...nodes] : [...prevContent, ...nodes]
	}
	replaceYDocContent(liveDoc, merged, origin, field)
}

export function createEmptyYDocState(): { readonly state: Uint8Array; readonly stateVector: Uint8Array } {
	const doc = prosemirrorJsonToYDoc({ type: 'doc', content: [{ type: 'paragraph' }] })
	return {
		state: Y.encodeStateAsUpdate(doc),
		stateVector: Y.encodeStateVector(doc)
	}
}
