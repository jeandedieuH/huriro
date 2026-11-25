import { mergeAttributes, Node } from '@tiptap/core'

declare module '@tiptap/core' {
	interface Commands<ReturnType> {
		tocBlock: {
			insertTocBlock: (attrs?: { maxLevel?: 2 | 3 }) => ReturnType
		}
	}
}

export const TocBlockExtension = Node.create({
	name: 'tocBlock',
	group: 'block',
	atom: true,
	draggable: true,

	addAttributes() {
		return {
			maxLevel: {
				default: 3,
				parseHTML: (el) => (Number(el.getAttribute('data-max-level')) === 2 ? 2 : 3),
				renderHTML: (attrs) => ({ 'data-max-level': String(attrs['maxLevel'] === 2 ? 2 : 3) })
			}
		}
	},

	parseHTML() {
		return [{ tag: 'nav[data-toc]' }, { tag: 'div[data-toc]' }]
	},

	renderHTML({ HTMLAttributes }) {
		return [
			'nav',
			mergeAttributes(HTMLAttributes, { 'data-toc': 'true', 'aria-label': 'Table of contents' }),
			'Table of contents'
		]
	},

	addCommands() {
		return {
			insertTocBlock:
				(attrs) =>
				({ commands }) =>
					commands.insertContent({
						type: this.name,
						attrs: { maxLevel: attrs?.maxLevel === 2 ? 2 : 3 }
					})
		}
	}
})
