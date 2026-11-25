import { Extension } from '@tiptap/core'
import { type EditorState, TextSelection } from '@tiptap/pm/state'

export const SEMANTIC_TONES = ['default', 'muted', 'primary', 'info', 'success', 'warning', 'danger'] as const
export type SemanticTone = (typeof SEMANTIC_TONES)[number]

const STYLED_BLOCK_TYPES = [
	'heading',
	'paragraph',
	'callout',
	'toggle',
	'toggleHeading',
	'codeBlock',
	'blockquote'
]

function isSemanticTone(value: unknown): value is SemanticTone {
	return typeof value === 'string' && (SEMANTIC_TONES as readonly string[]).includes(value)
}

declare module '@tiptap/core' {
	interface Commands<ReturnType> {
		blockStyle: {
			setBlockTextTone: (tone: SemanticTone) => ReturnType
			setBlockBgTone: (tone: SemanticTone) => ReturnType
			moveCurrentBlockUp: () => ReturnType
			moveCurrentBlockDown: () => ReturnType
			moveBlock: (fromPos: number, targetPos: number) => ReturnType
			duplicateCurrentBlock: () => ReturnType
			deleteCurrentBlock: () => ReturnType
		}
	}
}

function findTopOrContainerBlock(state: EditorState) {
	const { $from } = state.selection
	if ($from.depth === 0) return null
	// Move the direct child of the closest container (`doc` or `column` or `toggle`).
	let targetDepth = 1
	for (let d = $from.depth; d >= 1; d--) {
		const parentName = $from.node(d - 1).type.name
		if (
			parentName === 'doc' ||
			parentName === 'column' ||
			parentName === 'toggle' ||
			parentName === 'toggleHeading'
		) {
			targetDepth = d
			break
		}
	}
	const parentDepth = targetDepth - 1
	const parent = $from.node(parentDepth)
	const index = $from.index(parentDepth)
	const pos = $from.before(targetDepth)
	const node = $from.node(targetDepth)
	return { parent, parentDepth, index, pos, node }
}

export const BlockStyleExtension = Extension.create({
	name: 'blockStyle',

	addGlobalAttributes() {
		return [
			{
				types: STYLED_BLOCK_TYPES,
				attributes: {
					textTone: {
						default: 'default',
						parseHTML: (el) => {
							const raw = el.getAttribute('data-text-tone')
							return isSemanticTone(raw) ? raw : 'default'
						},
						renderHTML: (attrs) => {
							const tone = attrs['textTone']
							return isSemanticTone(tone) && tone !== 'default' ? { 'data-text-tone': tone } : {}
						}
					},
					bgTone: {
						default: 'default',
						parseHTML: (el) => {
							const raw = el.getAttribute('data-bg-tone')
							return isSemanticTone(raw) ? raw : 'default'
						},
						renderHTML: (attrs) => {
							const tone = attrs['bgTone']
							return isSemanticTone(tone) && tone !== 'default' ? { 'data-bg-tone': tone } : {}
						}
					}
				}
			}
		]
	},

	addCommands() {
		return {
			setBlockTextTone:
				(tone) =>
				({ state, dispatch }) => {
					const { $from } = state.selection
					for (let d = $from.depth; d > 0; d--) {
						const node = $from.node(d)
						if (STYLED_BLOCK_TYPES.includes(node.type.name)) {
							if (dispatch) {
								dispatch(
									state.tr.setNodeMarkup($from.before(d), undefined, { ...node.attrs, textTone: tone })
								)
							}
							return true
						}
					}
					return false
				},
			setBlockBgTone:
				(tone) =>
				({ state, dispatch }) => {
					const { $from } = state.selection
					for (let d = $from.depth; d > 0; d--) {
						const node = $from.node(d)
						if (STYLED_BLOCK_TYPES.includes(node.type.name)) {
							if (dispatch) {
								dispatch(state.tr.setNodeMarkup($from.before(d), undefined, { ...node.attrs, bgTone: tone }))
							}
							return true
						}
					}
					return false
				},
			moveCurrentBlockUp:
				() =>
				({ state, dispatch }) => {
					const found = findTopOrContainerBlock(state)
					if (!found || found.index <= 0) return false
					const prevNode = found.parent.child(found.index - 1)
					const prevPos = found.pos - prevNode.nodeSize
					if (dispatch) {
						const tr = state.tr
						tr.delete(found.pos, found.pos + found.node.nodeSize)
						tr.insert(prevPos, found.node as never)
						const selPos = Math.min(tr.doc.content.size, prevPos + 1)
						tr.setSelection(TextSelection.near(tr.doc.resolve(selPos)))
						dispatch(tr.scrollIntoView())
					}
					return true
				},
			moveCurrentBlockDown:
				() =>
				({ state, dispatch }) => {
					const found = findTopOrContainerBlock(state)
					if (!found || found.index >= found.parent.childCount - 1) return false
					const nextNode = found.parent.child(found.index + 1)
					if (dispatch) {
						const tr = state.tr
						tr.delete(found.pos, found.pos + found.node.nodeSize)
						const insertPos = found.pos + nextNode.nodeSize
						tr.insert(insertPos, found.node as never)
						const selPos = Math.min(tr.doc.content.size, insertPos + 1)
						tr.setSelection(TextSelection.near(tr.doc.resolve(selPos)))
						dispatch(tr.scrollIntoView())
					}
					return true
				},
			moveBlock:
				(fromPos, targetPos) =>
				({ state, dispatch }) => {
					if (fromPos < 0 || fromPos >= state.doc.content.size) return false
					const node = state.doc.nodeAt(fromPos)
					if (!node?.isBlock) return false
					const clampedTarget = Math.max(0, Math.min(state.doc.content.size, targetPos))
					// Reject no-op drops on the moved block's own span or boundaries.
					if (clampedTarget >= fromPos && clampedTarget <= fromPos + node.nodeSize) return false
					if (dispatch) {
						const tr = state.tr
						tr.delete(fromPos, fromPos + node.nodeSize)
						const insertPos = clampedTarget > fromPos ? clampedTarget - node.nodeSize : clampedTarget
						const safeInsertPos = Math.max(0, Math.min(tr.doc.content.size, insertPos))
						tr.insert(safeInsertPos, node as never)
						const selPos = Math.min(tr.doc.content.size, safeInsertPos + 1)
						tr.setSelection(TextSelection.near(tr.doc.resolve(selPos)))
						dispatch(tr.scrollIntoView())
					}
					return true
				},
			duplicateCurrentBlock:
				() =>
				({ state, dispatch }) => {
					const found = findTopOrContainerBlock(state)
					if (!found) return false
					if (dispatch) {
						// Clear blockId so BlockIdExtension issues a fresh unique ID to the copy.
						const attrs = { ...found.node.attrs, blockId: null }
						const copy = (
							found.node as unknown as {
								type: { create: (a: Record<string, unknown>, c: unknown, m: unknown) => unknown }
								content: unknown
								marks: unknown
							}
						).type.create(
							attrs,
							(found.node as unknown as { content: unknown }).content,
							(found.node as unknown as { marks: unknown }).marks
						)
						const insertPos = found.pos + found.node.nodeSize
						const tr = state.tr.insert(insertPos, copy as never)
						tr.setSelection(TextSelection.near(tr.doc.resolve(Math.min(tr.doc.content.size, insertPos + 1))))
						dispatch(tr.scrollIntoView())
					}
					return true
				},
			deleteCurrentBlock:
				() =>
				({ state, dispatch }) => {
					const found = findTopOrContainerBlock(state)
					if (!found) return false
					if (dispatch) {
						if (found.parent.type.name === 'doc' && found.parent.childCount === 1) {
							const para = state.schema.nodes['paragraph']?.create()
							if (para) {
								dispatch(state.tr.replaceWith(found.pos, found.pos + found.node.nodeSize, para))
							}
						} else {
							dispatch(state.tr.delete(found.pos, found.pos + found.node.nodeSize))
						}
					}
					return true
				}
		}
	},

	addKeyboardShortcuts() {
		return {
			'Mod-Shift-ArrowUp': () => this.editor.commands.moveCurrentBlockUp(),
			'Mod-Shift-ArrowDown': () => this.editor.commands.moveCurrentBlockDown()
		}
	}
})
