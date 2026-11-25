import { mergeAttributes, Node } from '@tiptap/core'

declare module '@tiptap/core' {
	interface Commands<ReturnType> {
		syncedBlock: {
			insertSyncedBlock: (attrs: {
				syncedBlockId: string
				title?: string
				fallbackText?: string
			}) => ReturnType
		}
	}
}

export const SyncedBlockExtension = Node.create({
	name: 'syncedBlock',
	group: 'block',
	atom: true,
	draggable: true,

	addAttributes() {
		return {
			syncedBlockId: {
				default: '',
				parseHTML: (el) => el.getAttribute('data-synced-block-id') ?? '',
				renderHTML: (attrs) => ({ 'data-synced-block-id': String(attrs['syncedBlockId'] ?? '') })
			},
			title: {
				default: 'Synced block',
				parseHTML: (el) => el.getAttribute('data-synced-title') ?? 'Synced block',
				renderHTML: (attrs) => ({ 'data-synced-title': String(attrs['title'] ?? 'Synced block') })
			},
			fallbackText: {
				default: '',
				parseHTML: (el) => el.getAttribute('data-synced-fallback') ?? '',
				renderHTML: (attrs) => ({ 'data-synced-fallback': String(attrs['fallbackText'] ?? '') })
			}
		}
	},

	parseHTML() {
		return [{ tag: 'div[data-synced-block]' }]
	},

	renderHTML({ HTMLAttributes, node }) {
		const title = String(node.attrs['title'] ?? 'Synced block')
		const fallback = String(node.attrs['fallbackText'] ?? '')
		return ['div', mergeAttributes(HTMLAttributes, { 'data-synced-block': 'true' }), fallback || title]
	},

	addCommands() {
		return {
			insertSyncedBlock:
				(attrs) =>
				({ commands }) =>
					commands.insertContent({
						type: this.name,
						attrs: {
							syncedBlockId: attrs.syncedBlockId,
							title: attrs.title ?? 'Synced block',
							fallbackText: attrs.fallbackText ?? ''
						}
					})
		}
	}
})
