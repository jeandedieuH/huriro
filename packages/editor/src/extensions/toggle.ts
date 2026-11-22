import { mergeAttributes, Node } from '@tiptap/core'

declare module '@tiptap/core' {
	interface Commands<ReturnType> {
		toggle: {
			setToggle: (attrs?: { summary?: string; open?: boolean }) => ReturnType
		}
	}
}

export const ToggleExtension = Node.create({
	name: 'toggle',
	group: 'block',
	content: 'block+',
	defining: true,

	addAttributes() {
		return {
			summary: {
				default: 'Details',
				parseHTML: (el) => el.getAttribute('data-summary') ?? 'Details',
				renderHTML: (attrs) => ({ 'data-summary': String(attrs['summary'] ?? 'Details') })
			},
			open: {
				default: true,
				parseHTML: (el) => el.getAttribute('data-open') !== 'false',
				renderHTML: (attrs) => ({ 'data-open': attrs['open'] === false ? 'false' : 'true' })
			}
		}
	},

	parseHTML() {
		return [{ tag: 'div[data-toggle]' }, { tag: 'details[data-toggle]' }]
	},

	renderHTML({ HTMLAttributes, node }) {
		const summary = String(node.attrs['summary'] ?? 'Details')
		return [
			'div',
			mergeAttributes(HTMLAttributes, { 'data-toggle': 'true' }),
			['div', { 'data-toggle-summary': 'true', contenteditable: 'false' }, summary],
			['div', { 'data-toggle-content': 'true' }, 0]
		]
	},

	addCommands() {
		return {
			setToggle:
				(attrs) =>
				({ commands }) =>
					commands.insertContent({
						type: this.name,
						attrs: { summary: attrs?.summary ?? 'Details', open: attrs?.open ?? true },
						content: [{ type: 'paragraph' }]
					})
		}
	}
})
