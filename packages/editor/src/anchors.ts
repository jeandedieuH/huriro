import type { EditorState } from '@tiptap/pm/state'
import {
	absolutePositionToRelativePosition,
	relativePositionToAbsolutePosition,
	ySyncPluginKey
} from '@tiptap/y-tiptap'
import * as Y from 'yjs'

export interface EncodedAnchor {
	readonly anchorFrom: string
	readonly anchorTo: string
	readonly anchorQuote: string
	readonly anchorBlockId: string | null
}

export type ResolvedAnchor =
	| {
			readonly status: 'attached'
			readonly from: number
			readonly to: number
			readonly text: string
	  }
	| { readonly status: 'orphaned' }

function encodeRelPosBase64(rel: Y.RelativePosition): string {
	const bytes = Y.encodeRelativePosition(rel)
	let binary = ''
	for (let i = 0; i < bytes.length; i++) {
		binary += String.fromCharCode(bytes[i] ?? 0)
	}
	return btoa(binary)
}

function decodeRelPosBase64(b64: string): Y.RelativePosition | null {
	try {
		const binary = atob(b64)
		const bytes = new Uint8Array(binary.length)
		for (let i = 0; i < binary.length; i++) {
			bytes[i] = binary.charCodeAt(i)
		}
		return Y.decodeRelativePosition(bytes)
	} catch {
		return null
	}
}

function isRelativePositionDeleted(ydoc: Y.Doc, rel: Y.RelativePosition): boolean {
	if (!rel.item) return false
	try {
		const store = ydoc.store
		const list = store.clients.get(rel.item.client)
		if (!list || list.length === 0) return false
		// Binary search item by clock
		let lo = 0
		let hi = list.length - 1
		while (lo <= hi) {
			const mid = (lo + hi) >> 1
			const item = list[mid]
			if (!item) break
			const start = item.id.clock
			const end = start + item.length
			if (rel.item.clock < start) {
				hi = mid - 1
			} else if (rel.item.clock >= end) {
				lo = mid + 1
			} else {
				return item.deleted
			}
		}
	} catch {
		return false
	}
	return false
}

interface TextLeafEntry {
	readonly xmlText: Y.XmlText
	readonly start: number
	readonly end: number
	readonly text: string
	readonly blockId: string | null
}

function collectTextLeaves(
	node: Y.XmlFragment | Y.XmlElement | Y.XmlText | Y.XmlHook,
	inheritedBlockId: string | null,
	leaves: TextLeafEntry[],
	offsetRef: { value: number }
): void {
	if (node instanceof Y.XmlText) {
		const str = String(node.toString())
		const start = offsetRef.value
		const end = start + str.length
		offsetRef.value = end
		leaves.push({ xmlText: node, start, end, text: str, blockId: inheritedBlockId })
		return
	}
	if (node instanceof Y.XmlFragment || node instanceof Y.XmlElement) {
		const ownBlockId =
			node instanceof Y.XmlElement ? ((node.getAttribute('blockId') as string | null) ?? null) : null
		const blockId = ownBlockId ?? inheritedBlockId
		for (const child of node.toArray()) {
			collectTextLeaves(child, blockId, leaves, offsetRef)
		}
	}
}

/**
 * Headless Yjs RelativePosition encoder over `XmlFragment('default')` character offsets (§10.4).
 * Survives concurrent insertions/deletions elsewhere in the document.
 */
export function encodeTextAnchor(
	ydoc: Y.Doc,
	startOffset: number,
	endOffset: number,
	field = 'default'
): EncodedAnchor | null {
	if (startOffset < 0 || endOffset <= startOffset) return null
	const fragment = ydoc.getXmlFragment(field)
	const leaves: TextLeafEntry[] = []
	const offsetRef = { value: 0 }
	collectTextLeaves(fragment, null, leaves, offsetRef)

	const startLeaf = leaves.find((l) => startOffset >= l.start && startOffset <= l.end && l.text.length > 0)
	const endLeaf = leaves.find((l) => endOffset > l.start && endOffset <= l.end && l.text.length > 0)
	if (!startLeaf || !endLeaf) return null

	const relFrom = Y.createRelativePositionFromTypeIndex(startLeaf.xmlText, startOffset - startLeaf.start, 0)
	const relTo = Y.createRelativePositionFromTypeIndex(endLeaf.xmlText, endOffset - endLeaf.start, -1)

	const fullText = leaves.map((l) => l.text).join('')
	const quote = fullText.slice(startOffset, endOffset)

	return {
		anchorFrom: encodeRelPosBase64(relFrom),
		anchorTo: encodeRelPosBase64(relTo),
		anchorQuote: quote,
		anchorBlockId: startLeaf.blockId
	}
}

/**
 * Headless Yjs RelativePosition resolver (§10.4).
 * Surfaces `{ status: 'orphaned' }` whenever the anchored text or parent block was deleted.
 */
export function resolveTextAnchor(
	ydoc: Y.Doc,
	anchorFrom: string | null,
	anchorTo: string | null,
	field = 'default'
): ResolvedAnchor {
	if (!anchorFrom || !anchorTo) return { status: 'orphaned' }
	const relFrom = decodeRelPosBase64(anchorFrom)
	const relTo = decodeRelPosBase64(anchorTo)
	if (!relFrom || !relTo) return { status: 'orphaned' }

	const absFrom = Y.createAbsolutePositionFromRelativePosition(relFrom, ydoc)
	const absTo = Y.createAbsolutePositionFromRelativePosition(relTo, ydoc)
	if (!absFrom || !absTo) return { status: 'orphaned' }
	if (isRelativePositionDeleted(ydoc, relFrom) && isRelativePositionDeleted(ydoc, relTo)) {
		return { status: 'orphaned' }
	}

	const fragment = ydoc.getXmlFragment(field)
	const leaves: TextLeafEntry[] = []
	const offsetRef = { value: 0 }
	collectTextLeaves(fragment, null, leaves, offsetRef)

	const startLeaf = leaves.find((l) => l.xmlText === absFrom.type)
	const endLeaf = leaves.find((l) => l.xmlText === absTo.type)
	if (!startLeaf || !endLeaf) return { status: 'orphaned' }

	const globalFrom = startLeaf.start + absFrom.index
	const globalTo = endLeaf.start + absTo.index
	if (globalTo <= globalFrom) return { status: 'orphaned' }

	const fullText = leaves.map((l) => l.text).join('')
	const resolvedText = fullText.slice(globalFrom, globalTo)
	if (resolvedText.length === 0) return { status: 'orphaned' }

	return {
		status: 'attached',
		from: globalFrom,
		to: globalTo,
		text: resolvedText
	}
}

/**
 * Browser/ProseMirror-bound encoder using active `@tiptap/y-tiptap` binding mapping.
 */
export function encodeProseMirrorAnchor(
	pmState: EditorState,
	ydoc: Y.Doc,
	from: number,
	to: number,
	field = 'default'
): EncodedAnchor | null {
	if (from >= to) return null
	const syncState = ySyncPluginKey.getState(pmState)
	if (!syncState?.binding) return null

	const fragment = ydoc.getXmlFragment(field)
	const relFrom = absolutePositionToRelativePosition(from, fragment, syncState.binding.mapping)
	const relTo = absolutePositionToRelativePosition(to, fragment, syncState.binding.mapping)
	const quote = pmState.doc.textBetween(from, to, ' ')
	let anchorBlockId: string | null = null
	const $pos = pmState.doc.resolve(from)
	for (let d = $pos.depth; d >= 1; d--) {
		const bid = $pos.node(d).attrs['blockId']
		if (typeof bid === 'string' && bid.length > 0) {
			anchorBlockId = bid
			break
		}
	}

	return {
		anchorFrom: encodeRelPosBase64(relFrom),
		anchorTo: encodeRelPosBase64(relTo),
		anchorQuote: quote,
		anchorBlockId
	}
}

/**
 * Browser/ProseMirror-bound resolver returning ProseMirror doc positions.
 */
export function resolveProseMirrorAnchor(
	pmState: EditorState,
	ydoc: Y.Doc,
	anchorFrom: string | null,
	anchorTo: string | null,
	field = 'default'
): ResolvedAnchor {
	if (!anchorFrom || !anchorTo) return { status: 'orphaned' }
	const syncState = ySyncPluginKey.getState(pmState)
	if (!syncState?.binding) return { status: 'orphaned' }

	const relFrom = decodeRelPosBase64(anchorFrom)
	const relTo = decodeRelPosBase64(anchorTo)
	if (!relFrom || !relTo) return { status: 'orphaned' }
	if (isRelativePositionDeleted(ydoc, relFrom) && isRelativePositionDeleted(ydoc, relTo)) {
		return { status: 'orphaned' }
	}

	const fragment = ydoc.getXmlFragment(field)
	const absFrom = relativePositionToAbsolutePosition(ydoc, fragment, relFrom, syncState.binding.mapping)
	const absTo = relativePositionToAbsolutePosition(ydoc, fragment, relTo, syncState.binding.mapping)
	if (absFrom === null || absTo === null || absTo <= absFrom) return { status: 'orphaned' }

	const clampedFrom = Math.max(0, Math.min(absFrom, pmState.doc.content.size))
	const clampedTo = Math.max(0, Math.min(absTo, pmState.doc.content.size))
	if (clampedTo <= clampedFrom) return { status: 'orphaned' }

	const text = pmState.doc.textBetween(clampedFrom, clampedTo, ' ')
	if (text.trim().length === 0) return { status: 'orphaned' }

	return { status: 'attached', from: clampedFrom, to: clampedTo, text }
}
