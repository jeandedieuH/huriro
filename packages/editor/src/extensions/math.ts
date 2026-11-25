import { InputRule, mergeAttributes, Node } from '@tiptap/core'

declare module '@tiptap/core' {
	interface Commands<ReturnType> {
		mathInline: {
			insertMathInline: (latex?: string) => ReturnType
		}
		mathBlock: {
			insertMathBlock: (latex?: string) => ReturnType
		}
	}
}

export const MathInlineExtension = Node.create({
	name: 'mathInline',
	group: 'inline',
	inline: true,
	atom: true,
	selectable: true,

	addAttributes() {
		return {
			latex: {
				default: 'x^2',
				parseHTML: (el) => el.getAttribute('data-latex') ?? el.textContent ?? '',
				renderHTML: (attrs) => ({ 'data-latex': String(attrs['latex'] ?? '') })
			}
		}
	},

	parseHTML() {
		return [{ tag: 'span[data-math="inline"]' }]
	},

	renderHTML({ HTMLAttributes, node }) {
		return [
			'span',
			mergeAttributes(HTMLAttributes, { 'data-math': 'inline' }),
			String(node.attrs['latex'] ?? '')
		]
	},

	addInputRules() {
		return [
			new InputRule({
				find: /(?:^|\s)\$([^$\n]+)\$$/,
				handler: ({ state, range, match }) => {
					const latex = match[1]?.trim()
					if (!latex) return
					const leadingSpace = match[0].startsWith(' ') || match[0].startsWith('\t') ? 1 : 0
					const node = this.type.create({ latex })
					state.tr.replaceWith(range.from + leadingSpace, range.to, node)
				}
			})
		]
	},

	addCommands() {
		return {
			insertMathInline:
				(latex = 'x^2') =>
				({ commands }) =>
					commands.insertContent({ type: this.name, attrs: { latex } })
		}
	}
})

export const MathBlockExtension = Node.create({
	name: 'mathBlock',
	group: 'block',
	atom: true,
	draggable: true,

	addAttributes() {
		return {
			latex: {
				default: '\\sum_{i=1}^{n} x_i',
				parseHTML: (el) => el.getAttribute('data-latex') ?? el.textContent ?? '',
				renderHTML: (attrs) => ({ 'data-latex': String(attrs['latex'] ?? '') })
			}
		}
	},

	parseHTML() {
		return [{ tag: 'div[data-math="block"]' }]
	},

	renderHTML({ HTMLAttributes, node }) {
		return [
			'div',
			mergeAttributes(HTMLAttributes, { 'data-math': 'block' }),
			['code', String(node.attrs['latex'] ?? '')]
		]
	},

	addInputRules() {
		return [
			new InputRule({
				find: /^\$\$\s$/,
				handler: ({ state, range }) => {
					const node = this.type.create({ latex: '\\sum_{i=1}^{n} x_i' })
					state.tr.replaceWith(range.from, range.to, node)
				}
			})
		]
	},

	addCommands() {
		return {
			insertMathBlock:
				(latex = '\\sum_{i=1}^{n} x_i') =>
				({ commands }) =>
					commands.insertContent({ type: this.name, attrs: { latex } })
		}
	}
})
