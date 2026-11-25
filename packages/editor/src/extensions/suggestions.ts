import { Extension, Mark, mergeAttributes } from '@tiptap/core'
import { type EditorState, Plugin, PluginKey, TextSelection } from '@tiptap/pm/state'

export type SuggestionAuthorType = 'user' | 'agent'

export interface SuggestionMarkAttrs {
	readonly suggestionId: string
	readonly groupId: string
	readonly authorType: SuggestionAuthorType
	readonly authorId: string
	readonly createdAt: string
}

function suggestionMarkAttributes() {
	return {
		suggestionId: {
			default: '',
			parseHTML: (el: HTMLElement) => el.getAttribute('data-suggestion-id') ?? '',
			renderHTML: (attrs: Record<string, unknown>) => ({
				'data-suggestion-id': String(attrs['suggestionId'] ?? '')
			})
		},
		groupId: {
			default: '',
			parseHTML: (el: HTMLElement) => el.getAttribute('data-suggestion-group') ?? '',
			renderHTML: (attrs: Record<string, unknown>) => ({
				'data-suggestion-group': String(attrs['groupId'] ?? '')
			})
		},
		authorType: {
			default: 'user',
			parseHTML: (el: HTMLElement) => (el.getAttribute('data-author-type') === 'agent' ? 'agent' : 'user'),
			renderHTML: (attrs: Record<string, unknown>) => ({
				'data-author-type': String(attrs['authorType'] ?? 'user')
			})
		},
		authorId: {
			default: '',
			parseHTML: (el: HTMLElement) => el.getAttribute('data-author-id') ?? '',
			renderHTML: (attrs: Record<string, unknown>) => ({
				'data-author-id': String(attrs['authorId'] ?? '')
			})
		},
		createdAt: {
			default: '',
			parseHTML: (el: HTMLElement) => el.getAttribute('data-created-at') ?? '',
			renderHTML: (attrs: Record<string, unknown>) => ({
				'data-created-at': String(attrs['createdAt'] ?? '')
			})
		}
	}
}

export const SuggestionInsertMark = Mark.create({
	name: 'suggestionInsert',
	inclusive: false,
	excludes: 'suggestionDelete',

	addAttributes() {
		return suggestionMarkAttributes()
	},

	parseHTML() {
		return [{ tag: 'ins[data-suggestion-insert]' }]
	},

	renderHTML({ HTMLAttributes }) {
		return ['ins', mergeAttributes(HTMLAttributes, { 'data-suggestion-insert': 'true' }), 0]
	}
})

export const SuggestionDeleteMark = Mark.create({
	name: 'suggestionDelete',
	inclusive: false,
	excludes: 'suggestionInsert',

	addAttributes() {
		return suggestionMarkAttributes()
	},

	parseHTML() {
		return [{ tag: 'del[data-suggestion-delete]' }]
	},

	renderHTML({ HTMLAttributes }) {
		return ['del', mergeAttributes(HTMLAttributes, { 'data-suggestion-delete': 'true' }), 0]
	}
})

export interface SuggestionModeStorage {
	enabled: boolean
	authorType: SuggestionAuthorType
	authorId: string
}

declare module '@tiptap/core' {
	interface Commands<ReturnType> {
		suggestionMode: {
			setSuggestionMode: (
				enabled: boolean,
				author?: { readonly authorType?: SuggestionAuthorType; readonly authorId?: string }
			) => ReturnType
		}
	}
}

const suggestionModePluginKey = new PluginKey('huriroSuggestionMode')

function buildAttrs(
	storage: SuggestionModeStorage,
	groupId: string = crypto.randomUUID()
): SuggestionMarkAttrs {
	return {
		suggestionId: crypto.randomUUID(),
		groupId,
		authorType: storage.authorType,
		authorId: storage.authorId,
		createdAt: new Date().toISOString()
	}
}

export const SuggestionModeExtension = Extension.create<
	{
		readonly enabled?: boolean
		readonly authorType?: SuggestionAuthorType
		readonly authorId?: string
	},
	SuggestionModeStorage
>({
	name: 'suggestionMode',

	addOptions() {
		return {
			enabled: false,
			authorType: 'user',
			authorId: ''
		}
	},

	addStorage() {
		return {
			enabled: this.options.enabled ?? false,
			authorType: this.options.authorType ?? 'user',
			authorId: this.options.authorId ?? ''
		}
	},

	addCommands() {
		return {
			setSuggestionMode: (enabled, author) => () => {
				this.storage.enabled = enabled
				if (author?.authorType) this.storage.authorType = author.authorType
				if (author?.authorId !== undefined) this.storage.authorId = author.authorId
				return true
			}
		}
	},

	addProseMirrorPlugins() {
		const storage = this.storage

		const applySuggestedDelete = (state: EditorState, from: number, to: number, groupId: string) => {
			const insertType = state.schema.marks['suggestionInsert']
			const deleteType = state.schema.marks['suggestionDelete']
			if (!deleteType) return null
			const tr = state.tr
			const ownInsertRanges: Array<{ from: number; to: number }> = []
			const markDeleteRanges: Array<{ from: number; to: number }> = []

			state.doc.nodesBetween(from, to, (node, pos) => {
				if (!node.isText) return
				const start = Math.max(from, pos)
				const end = Math.min(to, pos + node.nodeSize)
				if (start >= end) return
				const insMark = insertType
					? node.marks.find(
							(m) => m.type === insertType && (!storage.authorId || m.attrs['authorId'] === storage.authorId)
						)
					: undefined
				if (insMark) {
					ownInsertRanges.push({ from: start, to: end })
				} else if (!node.marks.some((m) => m.type === deleteType)) {
					markDeleteRanges.push({ from: start, to: end })
				}
			})

			for (const r of markDeleteRanges) {
				tr.addMark(r.from, r.to, deleteType.create(buildAttrs(storage, groupId)))
			}
			// Delete own unaccepted insertions cleanly from back to front so positions hold.
			for (let i = ownInsertRanges.length - 1; i >= 0; i--) {
				const r = ownInsertRanges[i]
				if (r) tr.delete(r.from, r.to)
			}
			return tr
		}

		return [
			new Plugin({
				key: suggestionModePluginKey,
				props: {
					handleTextInput(view, from, to, text) {
						if (!storage.enabled || !view.editable) return false
						const insertType = view.state.schema.marks['suggestionInsert']
						if (!insertType) return false

						const groupId = crypto.randomUUID()
						const attrs = buildAttrs(storage, groupId)
						const tr =
							from < to
								? (applySuggestedDelete(view.state, from, to, groupId) ?? view.state.tr)
								: view.state.tr

						// Insert at the end of the selected/marked range so delete precedes insert visually.
						const mappedInsertPos = tr.mapping.map(to)
						const textNode = view.state.schema.text(text, [insertType.create(attrs)])
						tr.insert(mappedInsertPos, textNode)
						tr.setSelection(TextSelection.create(tr.doc, mappedInsertPos + text.length))
						view.dispatch(tr.scrollIntoView())
						return true
					},
					handleKeyDown(view, event) {
						if (!storage.enabled || !view.editable) return false
						if (event.key !== 'Backspace' && event.key !== 'Delete') return false
						const { from, to, $from } = view.state.selection
						const groupId = crypto.randomUUID()

						if (from < to) {
							const tr = applySuggestedDelete(view.state, from, to, groupId)
							if (!tr) return false
							const collapsePos = tr.mapping.map(event.key === 'Backspace' ? from : to, -1)
							tr.setSelection(
								TextSelection.near(tr.doc.resolve(Math.max(0, Math.min(tr.doc.content.size, collapsePos))))
							)
							view.dispatch(tr.scrollIntoView())
							return true
						}

						if (event.key === 'Backspace') {
							if (from <= $from.start()) return false
							const targetFrom = from - 1
							const tr = applySuggestedDelete(view.state, targetFrom, from, groupId)
							if (!tr) return false
							const nextPos = Math.min(tr.doc.content.size, targetFrom)
							tr.setSelection(TextSelection.near(tr.doc.resolve(nextPos), -1))
							view.dispatch(tr.scrollIntoView())
							return true
						}

						if (from >= $from.end()) return false
						const targetTo = Math.min(view.state.doc.content.size, from + 1)
						const tr = applySuggestedDelete(view.state, from, targetTo, groupId)
						if (!tr) return false
						const nextPos = tr.mapping.map(targetTo)
						tr.setSelection(TextSelection.near(tr.doc.resolve(Math.min(tr.doc.content.size, nextPos))))
						view.dispatch(tr.scrollIntoView())
						return true
					}
				}
			})
		]
	}
})
