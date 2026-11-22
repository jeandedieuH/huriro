import { Mark, mergeAttributes } from '@tiptap/core'

declare module '@tiptap/core' {
	interface Commands<ReturnType> {
		commentAnchor: {
			setCommentAnchor: (attrs: { commentId: string; resolved?: boolean }) => ReturnType
			unsetCommentAnchor: () => ReturnType
		}
	}
}

export const CommentAnchorMark = Mark.create({
	name: 'commentAnchor',
	inclusive: false,
	excludes: '',

	addAttributes() {
		return {
			commentId: {
				default: '',
				parseHTML: (el) => el.getAttribute('data-comment-id') ?? '',
				renderHTML: (attrs) => ({ 'data-comment-id': String(attrs['commentId'] ?? '') })
			},
			resolved: {
				default: false,
				parseHTML: (el) => el.getAttribute('data-comment-resolved') === 'true',
				renderHTML: (attrs) => ({
					'data-comment-resolved': attrs['resolved'] === true ? 'true' : 'false'
				})
			}
		}
	},

	parseHTML() {
		return [{ tag: 'span[data-comment-id]' }]
	},

	renderHTML({ HTMLAttributes }) {
		return ['span', mergeAttributes(HTMLAttributes), 0]
	},

	addCommands() {
		return {
			setCommentAnchor:
				(attrs) =>
				({ commands }) =>
					commands.setMark(this.name, { commentId: attrs.commentId, resolved: attrs.resolved ?? false }),
			unsetCommentAnchor:
				() =>
				({ commands }) =>
					commands.unsetMark(this.name)
		}
	}
})
