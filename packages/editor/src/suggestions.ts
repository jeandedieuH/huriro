import * as Y from 'yjs'
import type { SuggestionAuthorType, SuggestionMarkAttrs } from './extensions'

export interface ExtractedSuggestionSummary {
	readonly groupId: string
	readonly kind: 'insert' | 'delete' | 'replace'
	readonly authorType: SuggestionAuthorType
	readonly authorId: string
	readonly anchorBlockId: string | null
	readonly beforeText: string
	readonly afterText: string
	readonly createdAt: string
}

interface MatchedMark {
	readonly kind: 'insert' | 'delete'
	readonly key: string
	readonly attrs: Partial<SuggestionMarkAttrs>
}

function matchSuggestionMarks(attributes: Record<string, unknown> | undefined): MatchedMark[] {
	if (!attributes) return []
	const out: MatchedMark[] = []
	for (const [key, raw] of Object.entries(attributes)) {
		if (!raw || typeof raw !== 'object') continue
		if (key === 'suggestionInsert' || key.startsWith('suggestionInsert--')) {
			out.push({ kind: 'insert', key, attrs: raw as Partial<SuggestionMarkAttrs> })
		} else if (key === 'suggestionDelete' || key.startsWith('suggestionDelete--')) {
			out.push({ kind: 'delete', key, attrs: raw as Partial<SuggestionMarkAttrs> })
		}
	}
	return out
}

function walkXmlTexts(
	node: Y.XmlFragment | Y.XmlElement | Y.XmlText | Y.XmlHook,
	inheritedBlockId: string | null,
	visit: (xmlText: Y.XmlText, blockId: string | null) => void
): void {
	if (node instanceof Y.XmlText) {
		visit(node, inheritedBlockId)
		return
	}
	if (node instanceof Y.XmlFragment || node instanceof Y.XmlElement) {
		const ownId =
			node instanceof Y.XmlElement ? ((node.getAttribute('blockId') as string | null) ?? null) : null
		const blockId = ownId || inheritedBlockId
		for (const child of node.toArray()) {
			walkXmlTexts(child, blockId, visit)
		}
	}
}

export function extractSuggestionsFromYDoc(ydoc: Y.Doc, field = 'default'): ExtractedSuggestionSummary[] {
	const groups = new Map<
		string,
		{
			hasInsert: boolean
			hasDelete: boolean
			authorType: SuggestionAuthorType
			authorId: string
			anchorBlockId: string | null
			beforeParts: string[]
			afterParts: string[]
			createdAt: string
		}
	>()

	const fragment = ydoc.getXmlFragment(field)
	walkXmlTexts(fragment, null, (xmlText, blockId) => {
		const delta = xmlText.toDelta() as Array<{ insert?: unknown; attributes?: Record<string, unknown> }>
		for (const op of delta) {
			if (typeof op.insert !== 'string' || op.insert.length === 0) continue
			const marks = matchSuggestionMarks(op.attributes)
			for (const mark of marks) {
				const groupId =
					typeof mark.attrs.groupId === 'string' && mark.attrs.groupId.length > 0
						? mark.attrs.groupId
						: typeof mark.attrs.suggestionId === 'string' && mark.attrs.suggestionId.length > 0
							? mark.attrs.suggestionId
							: ''
				if (!groupId) continue
				let entry = groups.get(groupId)
				if (!entry) {
					entry = {
						hasInsert: false,
						hasDelete: false,
						authorType: mark.attrs.authorType === 'agent' ? 'agent' : 'user',
						authorId: typeof mark.attrs.authorId === 'string' ? mark.attrs.authorId : '',
						anchorBlockId: blockId,
						beforeParts: [],
						afterParts: [],
						createdAt:
							typeof mark.attrs.createdAt === 'string' && mark.attrs.createdAt.length > 0
								? mark.attrs.createdAt
								: new Date(0).toISOString()
					}
					groups.set(groupId, entry)
				}
				if (mark.kind === 'insert') {
					entry.hasInsert = true
					entry.afterParts.push(op.insert)
				} else {
					entry.hasDelete = true
					entry.beforeParts.push(op.insert)
				}
			}
		}
	})

	const out: ExtractedSuggestionSummary[] = []
	for (const [groupId, entry] of groups.entries()) {
		const kind = entry.hasInsert && entry.hasDelete ? 'replace' : entry.hasDelete ? 'delete' : 'insert'
		out.push({
			groupId,
			kind,
			authorType: entry.authorType,
			authorId: entry.authorId,
			anchorBlockId: entry.anchorBlockId,
			beforeText: entry.beforeParts.join(''),
			afterText: entry.afterParts.join(''),
			createdAt: entry.createdAt
		})
	}
	return out
}

function decideSuggestionsInternal(
	ydoc: Y.Doc,
	targetGroupId: string | null,
	decision: 'accept' | 'reject',
	origin: string,
	field: string
): boolean {
	let modified = false
	const fragment = ydoc.getXmlFragment(field)

	ydoc.transact(() => {
		walkXmlTexts(fragment, null, (xmlText) => {
			const delta = xmlText.toDelta() as Array<{ insert?: unknown; attributes?: Record<string, unknown> }>
			const unmarks: Array<{ offset: number; length: number; key: string }> = []
			const deletes: Array<{ offset: number; length: number }> = []
			let offset = 0

			for (const op of delta) {
				if (typeof op.insert !== 'string') {
					offset += 1
					continue
				}
				const len = op.insert.length
				const marks = matchSuggestionMarks(op.attributes)
				let shouldDelete = false
				for (const m of marks) {
					const gid =
						typeof m.attrs.groupId === 'string' && m.attrs.groupId.length > 0
							? m.attrs.groupId
							: (m.attrs.suggestionId ?? '')
					if (targetGroupId !== null && gid !== targetGroupId) continue
					const deleteThisSpan =
						(decision === 'accept' && m.kind === 'delete') || (decision === 'reject' && m.kind === 'insert')
					if (deleteThisSpan) {
						shouldDelete = true
					} else {
						unmarks.push({ offset, length: len, key: m.key })
					}
				}
				if (shouldDelete && len > 0) {
					deletes.push({ offset, length: len })
				}
				offset += len
			}

			for (const u of unmarks) {
				xmlText.format(u.offset, u.length, { [u.key]: null })
				modified = true
			}
			for (let i = deletes.length - 1; i >= 0; i--) {
				const d = deletes[i]
				if (!d) continue
				xmlText.delete(d.offset, d.length)
				modified = true
			}
		})
	}, origin)

	return modified
}

export function applySuggestionDecisionToYDoc(
	ydoc: Y.Doc,
	groupId: string,
	decision: 'accept' | 'reject',
	origin = 'huriro:suggestion:decide',
	field = 'default'
): boolean {
	return decideSuggestionsInternal(ydoc, groupId, decision, origin, field)
}

export function applyAllSuggestionsDecisionToYDoc(
	ydoc: Y.Doc,
	decision: 'accept' | 'reject',
	origin = 'huriro:suggestion:decide-all',
	field = 'default'
): boolean {
	return decideSuggestionsInternal(ydoc, null, decision, origin, field)
}

export function flattenOrphanedSuggestions(
	ydoc: Y.Doc,
	origin = 'huriro:suggestion:flatten-orphans',
	field = 'default'
): number {
	let cleaned = 0
	const fragment = ydoc.getXmlFragment(field)
	ydoc.transact(() => {
		walkXmlTexts(fragment, null, (xmlText) => {
			const delta = xmlText.toDelta() as Array<{ insert?: unknown; attributes?: Record<string, unknown> }>
			let offset = 0
			for (const op of delta) {
				if (typeof op.insert !== 'string') {
					offset += 1
					continue
				}
				const len = op.insert.length
				const marks = matchSuggestionMarks(op.attributes)
				for (const m of marks) {
					const hasGroup = typeof m.attrs.groupId === 'string' && m.attrs.groupId.length > 0
					const hasId = typeof m.attrs.suggestionId === 'string' && m.attrs.suggestionId.length > 0
					const hasAuthor = typeof m.attrs.authorId === 'string' && m.attrs.authorId.length > 0
					if (!hasGroup || !hasId || !hasAuthor) {
						xmlText.format(offset, len, { [m.key]: null })
						cleaned += 1
					}
				}
				offset += len
			}
		})
	}, origin)
	return cleaned
}

export interface ProposeSuggestionInput {
	readonly kind: 'insert' | 'delete' | 'replace'
	readonly anchorBlockId?: string | null | undefined
	readonly targetText?: string | undefined
	readonly replacementText?: string | undefined
	readonly authorType: SuggestionAuthorType
	readonly authorId: string
	readonly groupId?: string | undefined
}

export function proposeSuggestionOnYDoc(
	ydoc: Y.Doc,
	input: ProposeSuggestionInput,
	origin = 'huriro:suggestion:propose',
	field = 'default'
): { readonly applied: boolean; readonly groupId: string; readonly anchorBlockId: string | null } {
	const groupId = input.groupId ?? crypto.randomUUID()
	const nowIso = new Date().toISOString()
	const baseAttrs: SuggestionMarkAttrs = {
		suggestionId: crypto.randomUUID(),
		groupId,
		authorType: input.authorType,
		authorId: input.authorId,
		createdAt: nowIso
	}

	const fragment = ydoc.getXmlFragment(field)
	const leaves: Array<{ xmlText: Y.XmlText; blockId: string | null }> = []
	walkXmlTexts(fragment, null, (xmlText, blockId) => {
		leaves.push({ xmlText, blockId })
	})

	let applied = false
	let resolvedBlockId: string | null = input.anchorBlockId ?? null

	ydoc.transact(() => {
		const scopedLeaves = input.anchorBlockId
			? leaves.filter((l) => l.blockId === input.anchorBlockId)
			: leaves
		const candidates = scopedLeaves.length > 0 ? scopedLeaves : leaves

		if (input.kind === 'delete' || input.kind === 'replace') {
			const needle = input.targetText ?? ''
			if (!needle) return
			for (const leaf of candidates) {
				const full = String(leaf.xmlText.toString())
				const idx = full.indexOf(needle)
				if (idx < 0) continue
				leaf.xmlText.format(idx, needle.length, { suggestionDelete: baseAttrs })
				if (input.kind === 'replace' && input.replacementText) {
					leaf.xmlText.insert(idx + needle.length, input.replacementText, {
						suggestionInsert: { ...baseAttrs, suggestionId: crypto.randomUUID() }
					})
				}
				resolvedBlockId = leaf.blockId
				applied = true
				return
			}
			return
		}

		// kind === 'insert'
		const text = input.replacementText ?? ''
		if (!text) return
		if (input.targetText) {
			for (const leaf of candidates) {
				const full = String(leaf.xmlText.toString())
				const idx = full.indexOf(input.targetText)
				if (idx < 0) continue
				leaf.xmlText.insert(idx + input.targetText.length, text, { suggestionInsert: baseAttrs })
				resolvedBlockId = leaf.blockId
				applied = true
				return
			}
		}

		const targetLeaf = candidates.at(-1)
		if (targetLeaf) {
			const len = String(targetLeaf.xmlText.toString()).length
			const prefix = len > 0 && !String(targetLeaf.xmlText.toString()).endsWith(' ') ? ' ' : ''
			targetLeaf.xmlText.insert(len, `${prefix}${text}`, { suggestionInsert: baseAttrs })
			resolvedBlockId = targetLeaf.blockId
			applied = true
			return
		}

		const para = new Y.XmlElement('paragraph')
		const newBlockId = crypto.randomUUID()
		para.setAttribute('blockId', newBlockId)
		const xmlText = new Y.XmlText()
		xmlText.insert(0, text, { suggestionInsert: baseAttrs })
		para.insert(0, [xmlText])
		fragment.push([para])
		resolvedBlockId = newBlockId
		applied = true
	}, origin)

	return { applied, groupId, anchorBlockId: resolvedBlockId }
}
