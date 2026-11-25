import { mergeAttributes, Node } from '@tiptap/core'
import { isSafeUrl } from '../sanitize'

declare module '@tiptap/core' {
	interface Commands<ReturnType> {
		bookmarkCard: {
			insertBookmarkCard: (attrs: {
				url: string
				title?: string
				description?: string
				siteName?: string
				faviconUrl?: string | null
				imageUrl?: string | null
			}) => ReturnType
		}
	}
}

function safeAttrUrl(val: unknown): string {
	const raw = typeof val === 'string' ? val.trim() : ''
	return raw && isSafeUrl(raw) ? raw : ''
}

export const BookmarkCardExtension = Node.create({
	name: 'bookmarkCard',
	group: 'block',
	atom: true,
	draggable: true,

	addAttributes() {
		return {
			url: {
				default: '',
				parseHTML: (el) => safeAttrUrl(el.getAttribute('data-bookmark-url')),
				renderHTML: (attrs) => ({ 'data-bookmark-url': safeAttrUrl(attrs['url']) })
			},
			title: {
				default: '',
				parseHTML: (el) => el.getAttribute('data-bookmark-title') ?? '',
				renderHTML: (attrs) => ({ 'data-bookmark-title': String(attrs['title'] ?? '') })
			},
			description: {
				default: '',
				parseHTML: (el) => el.getAttribute('data-bookmark-description') ?? '',
				renderHTML: (attrs) => ({ 'data-bookmark-description': String(attrs['description'] ?? '') })
			},
			siteName: {
				default: '',
				parseHTML: (el) => el.getAttribute('data-bookmark-site') ?? '',
				renderHTML: (attrs) => ({ 'data-bookmark-site': String(attrs['siteName'] ?? '') })
			},
			faviconUrl: {
				default: '',
				parseHTML: (el) => safeAttrUrl(el.getAttribute('data-bookmark-favicon')),
				renderHTML: (attrs) => ({ 'data-bookmark-favicon': safeAttrUrl(attrs['faviconUrl']) })
			},
			imageUrl: {
				default: '',
				parseHTML: (el) => safeAttrUrl(el.getAttribute('data-bookmark-image')),
				renderHTML: (attrs) => ({ 'data-bookmark-image': safeAttrUrl(attrs['imageUrl']) })
			}
		}
	},

	parseHTML() {
		return [{ tag: 'div[data-bookmark]' }]
	},

	renderHTML({ HTMLAttributes, node }) {
		const url = safeAttrUrl(node.attrs['url'])
		const title = String(node.attrs['title'] ?? '') || url
		const desc = String(node.attrs['description'] ?? '')
		return [
			'div',
			mergeAttributes(HTMLAttributes, { 'data-bookmark': 'true' }),
			['a', { href: url, rel: 'noopener noreferrer', target: '_blank' }, title],
			...(desc ? [['p', desc]] : [])
		]
	},

	addCommands() {
		return {
			insertBookmarkCard:
				(attrs) =>
				({ commands }) => {
					if (!isSafeUrl(attrs.url)) return false
					return commands.insertContent({
						type: this.name,
						attrs: {
							url: attrs.url,
							title: attrs.title ?? attrs.url,
							description: attrs.description ?? '',
							siteName: attrs.siteName ?? '',
							faviconUrl: safeAttrUrl(attrs.faviconUrl),
							imageUrl: safeAttrUrl(attrs.imageUrl)
						}
					})
				}
		}
	}
})
