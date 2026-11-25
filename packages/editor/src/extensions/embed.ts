import { mergeAttributes, Node } from '@tiptap/core'
import { isSafeUrl } from '../sanitize'

export type EmbedKind = 'file' | 'image' | 'video' | 'audio' | 'pdf' | 'figma' | 'loom' | 'link'

declare module '@tiptap/core' {
	interface Commands<ReturnType> {
		embed: {
			setEmbed: (attrs: {
				url: string
				kind?: EmbedKind
				title?: string
				fileId?: string | null
			}) => ReturnType
		}
	}
}

export const EmbedExtension = Node.create({
	name: 'embed',
	group: 'block',
	atom: true,
	draggable: true,

	addAttributes() {
		return {
			url: {
				default: '',
				parseHTML: (el) => {
					const raw = el.getAttribute('data-embed-url') ?? ''
					return isSafeUrl(raw) ? raw : ''
				},
				renderHTML: (attrs) => ({
					'data-embed-url': isSafeUrl(String(attrs['url'] ?? '')) ? String(attrs['url']) : ''
				})
			},
			kind: {
				default: 'link',
				parseHTML: (el) => (el.getAttribute('data-embed-kind') as EmbedKind | null) ?? 'link',
				renderHTML: (attrs) => ({ 'data-embed-kind': String(attrs['kind'] ?? 'link') })
			},
			title: {
				default: '',
				parseHTML: (el) => el.getAttribute('data-embed-title') ?? '',
				renderHTML: (attrs) => ({ 'data-embed-title': String(attrs['title'] ?? '') })
			},
			fileId: {
				default: null,
				parseHTML: (el) => el.getAttribute('data-embed-file-id') || null,
				renderHTML: (attrs) => (attrs['fileId'] ? { 'data-embed-file-id': String(attrs['fileId']) } : {})
			}
		}
	},

	parseHTML() {
		return [{ tag: 'div[data-embed-url]' }]
	},

	renderHTML({ HTMLAttributes, node }) {
		const url = String(node.attrs['url'] ?? '')
		const safeUrl = isSafeUrl(url) ? url : ''
		const title = String(node.attrs['title'] ?? '') || safeUrl
		return [
			'div',
			mergeAttributes(HTMLAttributes, { 'data-embed': 'true' }),
			['a', { href: safeUrl, rel: 'noopener noreferrer', target: '_blank' }, title]
		]
	},

	addCommands() {
		return {
			setEmbed:
				(attrs) =>
				({ commands }) => {
					if (!isSafeUrl(attrs.url)) return false
					return commands.insertContent({
						type: this.name,
						attrs: {
							url: attrs.url,
							kind: attrs.kind ?? 'link',
							title: attrs.title ?? attrs.url,
							fileId: attrs.fileId ?? null
						}
					})
				}
		}
	}
})
