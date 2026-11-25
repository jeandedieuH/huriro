import { mergeAttributes, Node } from '@tiptap/core'

export type MermaidViewMode = 'split' | 'code' | 'diagram'

declare module '@tiptap/core' {
	interface Commands<ReturnType> {
		mermaidBlock: {
			insertMermaidBlock: (attrs?: { code?: string; alt?: string; viewMode?: MermaidViewMode }) => ReturnType
		}
	}
}

const DEFAULT_MERMAID_CODE =
	'flowchart TD\n  Start[Request] --> Review{Verified?}\n  Review -->|Yes| Publish[Published]\n  Review -->|No| Draft[Revise]'

export const MermaidBlockExtension = Node.create({
	name: 'mermaidBlock',
	group: 'block',
	atom: true,
	draggable: true,

	addAttributes() {
		return {
			code: {
				default: DEFAULT_MERMAID_CODE,
				parseHTML: (el) => el.getAttribute('data-mermaid-code') ?? el.textContent ?? DEFAULT_MERMAID_CODE,
				renderHTML: (attrs) => ({ 'data-mermaid-code': String(attrs['code'] ?? DEFAULT_MERMAID_CODE) })
			},
			alt: {
				default: 'Architecture diagram',
				parseHTML: (el) => el.getAttribute('data-alt') ?? 'Architecture diagram',
				renderHTML: (attrs) => ({ 'data-alt': String(attrs['alt'] ?? 'Architecture diagram') })
			},
			viewMode: {
				default: 'split',
				parseHTML: (el) => {
					const mode = el.getAttribute('data-view-mode')
					return mode === 'code' || mode === 'diagram' ? mode : 'split'
				},
				renderHTML: (attrs) => ({ 'data-view-mode': String(attrs['viewMode'] ?? 'split') })
			}
		}
	},

	parseHTML() {
		return [{ tag: 'div[data-mermaid-block]' }]
	},

	renderHTML({ HTMLAttributes, node }) {
		const code = String(node.attrs['code'] ?? '')
		const alt = String(node.attrs['alt'] ?? 'Diagram')
		return [
			'div',
			mergeAttributes(HTMLAttributes, { 'data-mermaid-block': 'true', role: 'figure', 'aria-label': alt }),
			['pre', ['code', { class: 'language-mermaid' }, code]]
		]
	},

	addCommands() {
		return {
			insertMermaidBlock:
				(attrs) =>
				({ commands }) =>
					commands.insertContent({
						type: this.name,
						attrs: {
							code: attrs?.code ?? DEFAULT_MERMAID_CODE,
							alt: attrs?.alt ?? 'Architecture diagram',
							viewMode: attrs?.viewMode ?? 'split'
						}
					})
		}
	}
})
