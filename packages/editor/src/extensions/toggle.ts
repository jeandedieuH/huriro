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

	// Apps inject localized labels via configure(); English defaults keep
	// headless/server callers free of i18n dependencies.
	addOptions() {
		return {
			arrowLabel: 'Toggle collapsible section',
			summaryLabel: 'Collapsible section title'
		}
	},

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

	/**
	 * Interactive collapse/expand + editable summary. DOM code lives in the node
	 * view factory — inert until a live EditorView mounts it, so the package stays
	 * headless-safe (getSchema/yjs helpers never invoke this).
	 */
	addNodeView() {
		return ({ node, editor, view, getPos, HTMLAttributes }) => {
			const dom = document.createElement('div')
			for (const [key, value] of Object.entries(HTMLAttributes)) {
				dom.setAttribute(key, String(value))
			}
			dom.setAttribute('data-toggle', 'true')

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
			summaryInput.value = String(node.attrs['summary'] ?? 'Details')
			summaryInput.spellcheck = false
			summaryInput.readOnly = !editor.isEditable

			const content = document.createElement('div')
			content.setAttribute('data-toggle-content', 'true')

			header.append(arrow, summaryInput)
			dom.append(header, content)

			const syncOpenState = (open: boolean) => {
				dom.setAttribute('data-open', open ? 'true' : 'false')
				arrow.setAttribute('aria-expanded', open ? 'true' : 'false')
				content.hidden = !open
			}
			syncOpenState(node.attrs['open'] !== false)

			const updateNodeAttrs = (attrs: Record<string, unknown>) => {
				const pos = getPos()
				if (typeof pos !== 'number') return
				view.dispatch(view.state.tr.setNodeMarkup(pos, undefined, { ...node.attrs, ...attrs }))
			}

			const onArrowClick = () => {
				// Read-only viewers can't flip `open` — the write would diverge from
				// the collab server, which rejects non-writer updates.
				if (!editor.isEditable) return
				updateNodeAttrs({ open: !(node.attrs['open'] !== false) })
			}
			// Keep the click from stealing the editor's selection.
			const onArrowMouseDown = (event: Event) => event.preventDefault()

			const onSummaryChange = () => {
				if (!editor.isEditable) return
				const value = summaryInput.value.trim() || 'Details'
				if (value !== node.attrs['summary']) updateNodeAttrs({ summary: value })
			}
			const onSummaryKeydown = (event: KeyboardEvent) => {
				if (event.key === 'Enter') {
					event.preventDefault()
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
					if (updatedNode.type.name !== 'toggle') return false
					node = updatedNode
					syncOpenState(node.attrs['open'] !== false)
					summaryInput.readOnly = !editor.isEditable
					const summary = String(node.attrs['summary'] ?? 'Details')
					// Don't clobber the field while the user is editing it.
					if (summaryInput.value !== summary && document.activeElement !== summaryInput) {
						summaryInput.value = summary
					}
					return true
				},
				// Header events (arrow, summary input) are handled natively, not by PM.
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
