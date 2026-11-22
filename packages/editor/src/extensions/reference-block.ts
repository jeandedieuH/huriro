import { mergeAttributes, Node } from '@tiptap/core'

export type ReferenceEntityType = 'issue' | 'doc'

declare module '@tiptap/core' {
	interface Commands<ReturnType> {
		referenceBlock: {
			setReferenceBlock: (attrs: {
				entityType: ReferenceEntityType
				entityId: string
				identifier?: string
				title: string
				status?: string
			}) => ReturnType
		}
	}
}

export const ReferenceBlockExtension = Node.create({
	name: 'referenceBlock',
	group: 'block',
	atom: true,
	draggable: true,

	addAttributes() {
		return {
			entityType: {
				default: 'issue',
				parseHTML: (el) => (el.getAttribute('data-ref-type') as ReferenceEntityType | null) ?? 'issue',
				renderHTML: (attrs) => ({ 'data-ref-type': String(attrs['entityType'] ?? 'issue') })
			},
			entityId: {
				default: '',
				parseHTML: (el) => el.getAttribute('data-ref-id') ?? '',
				renderHTML: (attrs) => ({ 'data-ref-id': String(attrs['entityId'] ?? '') })
			},
			identifier: {
				default: '',
				parseHTML: (el) => el.getAttribute('data-ref-identifier') ?? '',
				renderHTML: (attrs) => ({ 'data-ref-identifier': String(attrs['identifier'] ?? '') })
			},
			title: {
				default: '',
				parseHTML: (el) => el.getAttribute('data-ref-title') ?? '',
				renderHTML: (attrs) => ({ 'data-ref-title': String(attrs['title'] ?? '') })
			},
			status: {
				default: '',
				parseHTML: (el) => el.getAttribute('data-ref-status') ?? '',
				renderHTML: (attrs) => ({ 'data-ref-status': String(attrs['status'] ?? '') })
			}
		}
	},

	parseHTML() {
		return [{ tag: 'div[data-reference-block]' }]
	},

	renderHTML({ HTMLAttributes, node }) {
		const idf = String(node.attrs['identifier'] ?? '')
		const title = String(node.attrs['title'] ?? '')
		const label = idf ? `${idf}: ${title}` : title
		return ['div', mergeAttributes(HTMLAttributes, { 'data-reference-block': 'true' }), label]
	},

	addCommands() {
		return {
			setReferenceBlock:
				(attrs) =>
				({ commands }) =>
					commands.insertContent({
						type: this.name,
						attrs: {
							entityType: attrs.entityType,
							entityId: attrs.entityId,
							identifier: attrs.identifier ?? '',
							title: attrs.title,
							status: attrs.status ?? ''
						}
					})
		}
	}
})
