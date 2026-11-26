import { mergeAttributes, Node } from '@tiptap/core'

export type LinkedViewSourceType = 'database' | 'issue_saved_view'

declare module '@tiptap/core' {
	interface Commands<ReturnType> {
		linkedViewBlock: {
			setLinkedViewBlock: (attrs: {
				sourceType: LinkedViewSourceType
				sourceId: string
				viewId?: string
				config?: Record<string, unknown>
			}) => ReturnType
		}
	}
}

/**
 * Atom embedding a live structured database view or issue saved view (§4.1).
 * The package stays framework-free — apps replace rendering through
 * `nodeViewOverrides` and hydrate the target collection themselves.
 */
export const LinkedViewBlockExtension = Node.create({
	name: 'linkedViewBlock',
	group: 'block',
	atom: true,
	draggable: true,

	addAttributes() {
		return {
			sourceType: {
				default: 'database',
				parseHTML: (el) => el.getAttribute('data-source-type') ?? 'database',
				renderHTML: (attrs) => ({ 'data-source-type': String(attrs['sourceType'] ?? 'database') })
			},
			sourceId: {
				default: '',
				parseHTML: (el) => el.getAttribute('data-source-id') ?? '',
				renderHTML: (attrs) => ({ 'data-source-id': String(attrs['sourceId'] ?? '') })
			},
			viewId: {
				default: '',
				parseHTML: (el) => el.getAttribute('data-view-id') ?? '',
				renderHTML: (attrs) => ({ 'data-view-id': String(attrs['viewId'] ?? '') })
			},
			config: {
				default: {},
				parseHTML: (el) => {
					try {
						return JSON.parse(el.getAttribute('data-view-config') ?? '{}') as Record<string, unknown>
					} catch {
						return {}
					}
				},
				renderHTML: (attrs) => ({ 'data-view-config': JSON.stringify(attrs['config'] ?? {}) })
			}
		}
	},

	parseHTML() {
		return [{ tag: 'div[data-linked-view]' }]
	},

	renderHTML({ HTMLAttributes }) {
		return ['div', mergeAttributes(HTMLAttributes, { 'data-linked-view': 'true' })]
	},

	addCommands() {
		return {
			setLinkedViewBlock:
				(attrs) =>
				({ commands }) =>
					commands.insertContent({
						type: this.name,
						attrs: {
							sourceType: attrs.sourceType,
							sourceId: attrs.sourceId,
							viewId: attrs.viewId ?? '',
							config: attrs.config ?? {}
						}
					})
		}
	}
})
