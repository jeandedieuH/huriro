import { Extension } from '@tiptap/core'
import { Plugin, PluginKey } from '@tiptap/pm/state'

const BLOCK_ID_TYPES = [
	'heading',
	'paragraph',
	'callout',
	'toggle',
	'codeBlock',
	'blockquote',
	'referenceBlock',
	'embed'
]

const blockIdPluginKey = new PluginKey('huriroBlockId')

function nextBlockId(): string {
	return crypto.randomUUID()
}

export const BlockIdExtension = Extension.create({
	name: 'blockId',

	addGlobalAttributes() {
		return [
			{
				types: BLOCK_ID_TYPES,
				attributes: {
					blockId: {
						default: null,
						parseHTML: (element) => element.getAttribute('data-block-id'),
						renderHTML: (attributes) => {
							const id = attributes['blockId']
							if (typeof id !== 'string' || id.length === 0) return {}
							return {
								'data-block-id': id,
								id: `block-${id}`
							}
						}
					}
				}
			}
		]
	},

	addProseMirrorPlugins() {
		const targetSet = new Set(BLOCK_ID_TYPES)
		return [
			new Plugin({
				key: blockIdPluginKey,
				appendTransaction(transactions, _oldState, newState) {
					const docChanged = transactions.some((tr) => tr.docChanged)
					if (!docChanged) return null

					const seen = new Set<string>()
					const tr = newState.tr
					let modified = false

					newState.doc.descendants((node, pos) => {
						if (!targetSet.has(node.type.name)) return
						const current = node.attrs['blockId']
						if (typeof current === 'string' && current.length > 0 && !seen.has(current)) {
							seen.add(current)
							return
						}
						const fresh = nextBlockId()
						seen.add(fresh)
						tr.setNodeMarkup(pos, undefined, { ...node.attrs, blockId: fresh })
						modified = true
					})

					if (!modified) return null
					tr.setMeta('addToHistory', false)
					return tr
				}
			})
		]
	}
})
