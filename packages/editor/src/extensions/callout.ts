import { mergeAttributes, Node } from '@tiptap/core'

export type CalloutTone = 'info' | 'warning' | 'danger' | 'success' | 'neutral'

declare module '@tiptap/core' {
	interface Commands<ReturnType> {
		callout: {
			setCallout: (attrs?: { tone?: CalloutTone }) => ReturnType
			toggleCallout: (attrs?: { tone?: CalloutTone }) => ReturnType
		}
	}
}

export const CalloutExtension = Node.create({
	name: 'callout',
	group: 'block',
	content: 'block+',
	defining: true,

	addAttributes() {
		return {
			tone: {
				default: 'info',
				parseHTML: (el) => (el.getAttribute('data-callout-tone') as CalloutTone | null) ?? 'info',
				renderHTML: (attrs) => ({ 'data-callout-tone': String(attrs['tone'] ?? 'info') })
			}
		}
	},

	parseHTML() {
		return [{ tag: 'div[data-callout-tone]' }, { tag: 'aside[data-callout-tone]' }]
	},

	renderHTML({ HTMLAttributes }) {
		return ['div', mergeAttributes(HTMLAttributes, { 'data-callout': 'true' }), 0]
	},

	addCommands() {
		return {
			setCallout:
				(attrs) =>
				({ commands }) =>
					commands.wrapIn(this.name, attrs),
			toggleCallout:
				(attrs) =>
				({ commands }) =>
					commands.toggleWrap(this.name, attrs)
		}
	}
})
