import { mergeAttributes, Node } from '@tiptap/core'

declare module '@tiptap/core' {
	interface Commands<ReturnType> {
		toggleHeading: {
			setToggleHeading: (attrs?: { level?: 1 | 2 | 3; summary?: string; open?: boolean }) => ReturnType
		}
	}
}

export const ToggleHeadingExtension = Node.create({
	name: 'toggleHeading',
	group: 'block',
	content: 'block+',
	defining: true,

	addOptions() {
		return {
			arrowLabel: 'Toggle heading section',
			summaryLabel: 'Toggle heading title'
		}
	},

	addAttributes() {
		return {
			level: {
				default: 2,
				parseHTML: (el) => {
					const raw = Number(el.getAttribute('data-level') ?? 2)
					return raw === 1 || raw === 2 || raw === 3 ? raw : 2
				},
				renderHTML: (attrs) => ({ 'data-level': String(attrs['level'] ?? 2) })
			},
			summary: {
				default: 'Toggle heading',
				parseHTML: (el) => el.getAttribute('data-summary') ?? 'Toggle heading',
				renderHTML: (attrs) => ({ 'data-summary': String(attrs['summary'] ?? 'Toggle heading') })
			},
			open: {
				default: true,
				parseHTML: (el) => el.getAttribute('data-open') !== 'false',
				renderHTML: (attrs) => ({ 'data-open': attrs['open'] === false ? 'false' : 'true' })
			}
		}
	},

	parseHTML() {
		return [{ tag: 'div[data-toggle-heading]' }]
	},

	renderHTML({ HTMLAttributes, node }) {
		const level = Number(node.attrs['level'] ?? 2)
		const safeLevel = level === 1 || level === 2 || level === 3 ? level : 2
		const summary = String(node.attrs['summary'] ?? 'Toggle heading')
		return [
			'div',
			mergeAttributes(HTMLAttributes, { 'data-toggle-heading': 'true' }),
			[`h${safeLevel}`, { 'data-toggle-heading-summary': 'true' }, summary],
			['div', { 'data-toggle-content': 'true' }, 0]
		]
	},

	addNodeView() {
		return ({ node, editor, view, getPos, HTMLAttributes }) => {
			const dom = document.createElement('div')
			for (const [k, v] of Object.entries(HTMLAttributes)) {
				dom.setAttribute(k, String(v))
			}
			dom.setAttribute('data-toggle-heading', 'true')

			const header = document.createElement('div')
			header.setAttribute('data-toggle-header', 'true')
			header.contentEditable = 'false'

			const arrow = document.createElement('button')
			arrow.type = 'button'
			arrow.setAttribute('data-toggle-arrow', 'true')
			arrow.setAttribute('aria-label', this.options.arrowLabel)

			const summaryInput = document.createElement('input')
			summaryInput.setAttribute('data-toggle-summary-input', 'true')
			summaryInput.setAttribute('aria-label', this.options.summaryLabel)
			summaryInput.value = String(node.attrs['summary'] ?? 'Toggle heading')
			summaryInput.readOnly = !editor.isEditable

			const content = document.createElement('div')
			content.setAttribute('data-toggle-content', 'true')

			header.append(arrow, summaryInput)
			dom.append(header, content)

			const syncAttrs = () => {
				const open = node.attrs['open'] !== false
				const level = Number(node.attrs['level'] ?? 2)
				dom.setAttribute('data-open', open ? 'true' : 'false')
				dom.setAttribute('data-level', String(level))
				arrow.setAttribute('aria-expanded', open ? 'true' : 'false')
				content.hidden = !open
			}
			syncAttrs()

			const updateNodeAttrs = (attrs: Record<string, unknown>) => {
				const pos = getPos()
				if (typeof pos !== 'number') return
				view.dispatch(view.state.tr.setNodeMarkup(pos, undefined, { ...node.attrs, ...attrs }))
			}

			const onArrowClick = () => {
				if (!editor.isEditable) return
				updateNodeAttrs({ open: !(node.attrs['open'] !== false) })
			}
			const onArrowMouseDown = (ev: Event) => ev.preventDefault()
			const onSummaryChange = () => {
				if (!editor.isEditable) return
				const value = summaryInput.value.trim() || 'Toggle heading'
				if (value !== node.attrs['summary']) updateNodeAttrs({ summary: value })
			}
			const onSummaryKeydown = (ev: KeyboardEvent) => {
				if (ev.key === 'Enter') {
					ev.preventDefault()
					summaryInput.blur()
				}
			}

			arrow.addEventListener('click', onArrowClick)
			arrow.addEventListener('mousedown', onArrowMouseDown)
			summaryInput.addEventListener('change', onSummaryChange)
			summaryInput.addEventListener('keydown', onSummaryKeydown)

			return {
				dom,
				contentDOM: content,
				update(updatedNode) {
					if (updatedNode.type.name !== 'toggleHeading') return false
					node = updatedNode
					syncAttrs()
					summaryInput.readOnly = !editor.isEditable
					const summary = String(node.attrs['summary'] ?? 'Toggle heading')
					if (summaryInput.value !== summary && document.activeElement !== summaryInput) {
						summaryInput.value = summary
					}
					return true
				},
				stopEvent(event) {
					const target = event.target
					return target instanceof window.Node && header.contains(target) && !content.contains(target)
				},
				ignoreMutation(mutation) {
					return !content.contains(mutation.target)
				},
				destroy() {
					arrow.removeEventListener('click', onArrowClick)
					arrow.removeEventListener('mousedown', onArrowMouseDown)
					summaryInput.removeEventListener('change', onSummaryChange)
					summaryInput.removeEventListener('keydown', onSummaryKeydown)
				}
			}
		}
	},

	addCommands() {
		return {
			setToggleHeading:
				(attrs) =>
				({ commands }) => {
					const level = attrs?.level ?? 2
					return commands.insertContent({
						type: this.name,
						attrs: {
							level: level === 1 || level === 2 || level === 3 ? level : 2,
							summary: attrs?.summary ?? 'Toggle heading',
							open: attrs?.open ?? true
						},
						content: [{ type: 'paragraph' }]
					})
				}
		}
	}
})
