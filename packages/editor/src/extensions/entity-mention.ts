import { mergeAttributes, Node } from '@tiptap/core'

export type MentionEntityType = 'person' | 'issue' | 'doc'

declare module '@tiptap/core' {
	interface Commands<ReturnType> {
		entityMention: {
			insertEntityMention: (attrs: {
				entityType: MentionEntityType
				entityId: string
				label: string
			}) => ReturnType
		}
	}
}

export const EntityMentionExtension = Node.create({
	name: 'entityMention',
	group: 'inline',
	inline: true,
	atom: true,
	selectable: true,

	addAttributes() {
		return {
			entityType: {
				default: 'person',
				parseHTML: (el) => (el.getAttribute('data-entity-type') as MentionEntityType | null) ?? 'person',
				renderHTML: (attrs) => ({ 'data-entity-type': String(attrs['entityType'] ?? 'person') })
			},
			entityId: {
				default: '',
				parseHTML: (el) => el.getAttribute('data-entity-id') ?? '',
				renderHTML: (attrs) => ({ 'data-entity-id': String(attrs['entityId'] ?? '') })
			},
			label: {
				default: '',
				parseHTML: (el) => el.getAttribute('data-label') ?? el.textContent ?? '',
				renderHTML: (attrs) => ({ 'data-label': String(attrs['label'] ?? '') })
			}
		}
	},

	parseHTML() {
		return [{ tag: 'span[data-entity-mention]' }]
	},

	renderHTML({ HTMLAttributes, node }) {
		const entityType = String(node.attrs['entityType'] ?? 'person')
		const label = String(node.attrs['label'] ?? '')
		const prefix = entityType === 'person' ? '@' : entityType === 'issue' ? '#' : ''
		return ['span', mergeAttributes(HTMLAttributes, { 'data-entity-mention': 'true' }), `${prefix}${label}`]
	},

	addCommands() {
		return {
			insertEntityMention:
				(attrs) =>
				({ commands }) =>
					commands.insertContent({ type: this.name, attrs })
		}
	}
})
