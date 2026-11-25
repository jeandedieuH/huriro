import { mergeAttributes, Node } from '@tiptap/core'

export type ButtonBlockActionKind = 'append_template' | 'run_automation'
export type ButtonBlockTone = 'primary' | 'secondary' | 'outline'

declare module '@tiptap/core' {
	interface Commands<ReturnType> {
		buttonBlock: {
			insertButtonBlock: (attrs?: {
				buttonId?: string
				label?: string
				actionKind?: ButtonBlockActionKind
				templateMarkdown?: string
				automationRuleId?: string | null
				tone?: ButtonBlockTone
			}) => ReturnType
		}
	}
}

export const ButtonBlockExtension = Node.create({
	name: 'buttonBlock',
	group: 'block',
	atom: true,
	draggable: true,

	addAttributes() {
		return {
			buttonId: {
				default: '',
				parseHTML: (el) => el.getAttribute('data-button-id') ?? '',
				renderHTML: (attrs) => ({ 'data-button-id': String(attrs['buttonId'] ?? '') })
			},
			label: {
				default: 'Insert template',
				parseHTML: (el) => el.getAttribute('data-button-label') ?? el.textContent ?? 'Insert template',
				renderHTML: (attrs) => ({ 'data-button-label': String(attrs['label'] ?? 'Insert template') })
			},
			actionKind: {
				default: 'append_template',
				parseHTML: (el) =>
					el.getAttribute('data-button-action') === 'run_automation' ? 'run_automation' : 'append_template',
				renderHTML: (attrs) => ({ 'data-button-action': String(attrs['actionKind'] ?? 'append_template') })
			},
			templateMarkdown: {
				default: '### Action item\n\n- [ ] Follow up',
				parseHTML: (el) => el.getAttribute('data-button-template') ?? '',
				renderHTML: (attrs) => ({ 'data-button-template': String(attrs['templateMarkdown'] ?? '') })
			},
			automationRuleId: {
				default: null,
				parseHTML: (el) => el.getAttribute('data-button-rule-id') || null,
				renderHTML: (attrs) =>
					attrs['automationRuleId'] ? { 'data-button-rule-id': String(attrs['automationRuleId']) } : {}
			},
			tone: {
				default: 'primary',
				parseHTML: (el) => {
					const t = el.getAttribute('data-button-tone')
					return t === 'secondary' || t === 'outline' ? t : 'primary'
				},
				renderHTML: (attrs) => ({ 'data-button-tone': String(attrs['tone'] ?? 'primary') })
			}
		}
	},

	parseHTML() {
		return [{ tag: 'div[data-button-block]' }]
	},

	renderHTML({ HTMLAttributes, node }) {
		return [
			'div',
			mergeAttributes(HTMLAttributes, { 'data-button-block': 'true' }),
			['span', String(node.attrs['label'] ?? 'Button')]
		]
	},

	addCommands() {
		return {
			insertButtonBlock:
				(attrs) =>
				({ commands }) =>
					commands.insertContent({
						type: this.name,
						attrs: {
							buttonId: attrs?.buttonId ?? crypto.randomUUID(),
							label: attrs?.label ?? 'Add section',
							actionKind: attrs?.actionKind ?? 'append_template',
							templateMarkdown: attrs?.templateMarkdown ?? '### Action item\n\n- [ ] Follow up',
							automationRuleId: attrs?.automationRuleId ?? null,
							tone: attrs?.tone ?? 'primary'
						}
					})
		}
	}
})
