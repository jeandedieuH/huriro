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

export interface ExtractedDocumentContent {
	readonly plainText: string
	readonly headings: DocHeading[]
	readonly blocks: DocBlockSnippet[]
	readonly mentions: DocMention[]
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

function collectElementTextAndMentions(
	node: Y.XmlElement | Y.XmlText | Y.XmlHook,
	mentions: Map<string, DocMention>
): string {
	if (node instanceof Y.XmlText) {
		const delta = node.toDelta() as { insert: unknown; attributes?: Record<string, unknown> }[]
		let text = ''
		for (const op of delta) {
			if (typeof op.insert === 'string') {
				text += op.insert
			} else if (op.insert instanceof Y.XmlElement) {
				text += collectElementTextAndMentions(op.insert, mentions)
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
		}
		const prefix = entityType === 'person' ? '@' : entityType === 'issue' ? '#' : ''
		return `${prefix}${label}`
	}

	if (node.nodeName === 'referenceBlock') {
		const idf = String(node.getAttribute('identifier') ?? '')
		const title = String(node.getAttribute('title') ?? '')
		return idf ? `${idf}: ${title}` : title
	}

	if (node.nodeName === 'embed') {
		const title = String(node.getAttribute('title') ?? '')
		const url = String(node.getAttribute('url') ?? '')
		return title || url
	}

	if (node.nodeName === 'hardBreak') return '\n'

	let out = ''
	for (const child of node.toArray()) {
		const part = collectElementTextAndMentions(child, mentions)
		if (part.length > 0) {
			const isBlockChild =
				child instanceof Y.XmlElement &&
				['paragraph', 'heading', 'listItem', 'taskItem', 'tableRow', 'blockquote'].includes(child.nodeName)
			out += out.length > 0 && isBlockChild ? `\n${part}` : part
		}
	}
	return out
}

/**
 * Pure, DOM-free extraction of plain text, headings, block snippets (for deep-link search),
 * and entity mentions from a Yjs document (`XmlFragment('default')`).
 */
export function extractDocumentContent(ydoc: Y.Doc, field = 'default'): ExtractedDocumentContent {
	const fragment = ydoc.getXmlFragment(field)
	const headings: DocHeading[] = []
	const blocks: DocBlockSnippet[] = []
	const mentions = new Map<string, DocMention>()
	const blockTexts: string[] = []
	let cursorOffset = 0
	let fallbackIdx = 0

	for (const child of fragment.toArray()) {
		const text = collectElementTextAndMentions(child, mentions).trim()
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
		mentions: [...mentions.values()]
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
