import { t } from '@huriro/i18n'
import type { Editor, Range } from '@tiptap/core'
import {
	CheckSquare,
	ChevronRight,
	Code2,
	Heading1,
	Heading2,
	Heading3,
	List,
	ListOrdered,
	Megaphone,
	Minus,
	Table2
} from 'lucide-react'
import type { ComponentType } from 'react'

/**
 * One insertable block entry shared by the flat editor toolbar and the
 * in-editor "/" suggestion menu. `apply` runs a normal TipTap chain, so
 * inserts flow through the existing Yjs collaboration binding unchanged.
 * `isActive` is set only for toggle-type blocks (headings, lists, code block)
 * so the toolbar can highlight the active block type and expose aria-pressed;
 * pure inserts (callout, toggle, table, divider) leave it undefined.
 */
export interface SlashItem {
	readonly id: string
	readonly label: string
	readonly keywords: readonly string[]
	readonly icon: ComponentType<{ readonly className?: string }>
	readonly isActive?: (editor: Editor) => boolean
	readonly apply: (editor: Editor, range?: Range) => void
}

type EditorChain = ReturnType<Editor['chain']>

// The toolbar passes no range; the "/" suggestion deletes its query text first.
function applyBlock(editor: Editor, range: Range | undefined, run: (chain: EditorChain) => EditorChain) {
	const chain = editor.chain().focus()
	run(range ? chain.deleteRange(range) : chain).run()
}

export function getSlashItems(): SlashItem[] {
	return [
		{
			id: 'h1',
			label: t('docs.slash.h1'),
			keywords: ['h1', 'heading', 'title'],
			icon: Heading1,
			isActive: (editor) => editor.isActive('heading', { level: 1 }),
			apply: (editor, range) => applyBlock(editor, range, (chain) => chain.toggleHeading({ level: 1 }))
		},
		{
			id: 'h2',
			label: t('docs.slash.h2'),
			keywords: ['h2', 'heading', 'subtitle'],
			icon: Heading2,
			isActive: (editor) => editor.isActive('heading', { level: 2 }),
			apply: (editor, range) => applyBlock(editor, range, (chain) => chain.toggleHeading({ level: 2 }))
		},
		{
			id: 'h3',
			label: t('docs.slash.h3'),
			keywords: ['h3', 'heading', 'subheading'],
			icon: Heading3,
			isActive: (editor) => editor.isActive('heading', { level: 3 }),
			apply: (editor, range) => applyBlock(editor, range, (chain) => chain.toggleHeading({ level: 3 }))
		},
		{
			id: 'bullet',
			label: t('docs.slash.bullet'),
			keywords: ['list', 'ul', 'unordered'],
			icon: List,
			isActive: (editor) => editor.isActive('bulletList'),
			apply: (editor, range) => applyBlock(editor, range, (chain) => chain.toggleBulletList())
		},
		{
			id: 'ordered',
			label: t('docs.slash.ordered'),
			keywords: ['list', 'ol', 'numbered'],
			icon: ListOrdered,
			isActive: (editor) => editor.isActive('orderedList'),
			apply: (editor, range) => applyBlock(editor, range, (chain) => chain.toggleOrderedList())
		},
		{
			id: 'task',
			label: t('docs.slash.task'),
			keywords: ['todo', 'checkbox', 'task'],
			icon: CheckSquare,
			isActive: (editor) => editor.isActive('taskList'),
			apply: (editor, range) => applyBlock(editor, range, (chain) => chain.toggleTaskList())
		},
		{
			id: 'code',
			label: t('docs.slash.code'),
			keywords: ['code', 'snippet', 'pre'],
			icon: Code2,
			isActive: (editor) => editor.isActive('codeBlock'),
			apply: (editor, range) => applyBlock(editor, range, (chain) => chain.toggleCodeBlock())
		},
		{
			id: 'callout',
			label: t('docs.slash.callout'),
			keywords: ['callout', 'banner', 'note', 'info'],
			icon: Megaphone,
			apply: (editor, range) =>
				applyBlock(editor, range, (chain) =>
					chain.insertContent({
						type: 'callout',
						attrs: { tone: 'info' },
						content: [{ type: 'paragraph', content: [{ type: 'text', text: t('docs.slash.callout-note') }] }]
					})
				)
		},
		{
			id: 'toggle',
			label: t('docs.slash.toggle'),
			keywords: ['toggle', 'collapsible', 'details', 'expand'],
			icon: ChevronRight,
			apply: (editor, range) =>
				applyBlock(editor, range, (chain) => chain.setToggle({ summary: t('docs.slash.toggle-summary') }))
		},
		{
			id: 'table',
			label: t('docs.slash.table'),
			keywords: ['table', 'grid'],
			icon: Table2,
			apply: (editor, range) =>
				applyBlock(editor, range, (chain) => chain.insertTable({ rows: 3, cols: 3, withHeaderRow: true }))
		},
		{
			id: 'hr',
			label: t('docs.slash.divider'),
			keywords: ['divider', 'hr', 'separator', 'rule'],
			icon: Minus,
			apply: (editor, range) => applyBlock(editor, range, (chain) => chain.setHorizontalRule())
		}
	]
}

export function filterSlashItems(query: string): SlashItem[] {
	const items = getSlashItems()
	const normalized = query.trim().toLowerCase()
	if (!normalized) return items
	return items.filter(
		(item) =>
			item.id.includes(normalized) ||
			item.label.toLowerCase().includes(normalized) ||
			item.keywords.some((keyword) => keyword.includes(normalized))
	)
}
