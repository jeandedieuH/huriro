import { t } from '@huriro/i18n'
import type { Editor, Range } from '@tiptap/core'
import {
	Bookmark,
	CheckSquare,
	ChevronRight,
	Code2,
	Columns2,
	Columns3,
	Database,
	Heading1,
	Heading2,
	Heading3,
	LayoutGrid,
	List,
	ListOrdered,
	ListTree,
	Megaphone,
	Minus,
	Paperclip,
	Play,
	Quote,
	RefreshCw,
	Sigma,
	Table2,
	Workflow
} from 'lucide-react'
import type { ComponentType } from 'react'

export type SlashCategory = 'basic' | 'lists' | 'layout' | 'advanced'

export const SLASH_CATEGORY_ORDER: readonly SlashCategory[] = ['basic', 'lists', 'layout', 'advanced']

export function getSlashCategoryLabel(category: SlashCategory): string {
	switch (category) {
		case 'basic':
			return t('docs.slash.group.basic')
		case 'lists':
			return t('docs.slash.group.lists')
		case 'layout':
			return t('docs.slash.group.layout')
		case 'advanced':
			return t('docs.slash.group.advanced')
	}
}

/**
 * One insertable block entry shared by the selection menu and the
 * in-editor "/" suggestion menu. `apply` runs a normal TipTap chain, so
 * inserts flow through the existing Yjs collaboration binding unchanged.
 * `isActive` is set only for toggle-type blocks (headings, lists, code block)
 * so UI surfaces can highlight the active block type and expose aria-pressed.
 */
export interface SlashItem {
	readonly id: string
	readonly label: string
	readonly description: string
	readonly category: SlashCategory
	readonly shortcut?: string
	readonly keywords: readonly string[]
	readonly icon: ComponentType<{ readonly className?: string }>
	readonly isActive?: (editor: Editor) => boolean
	readonly apply: (editor: Editor, range?: Range) => void
}

type EditorChain = ReturnType<Editor['chain']>

// Selection menus pass no range; the "/" suggestion deletes its query text first.
function applyBlock(editor: Editor, range: Range | undefined, run: (chain: EditorChain) => EditorChain) {
	const chain = editor.chain().focus()
	run(range ? chain.deleteRange(range) : chain).run()
}

export function getSlashItems(): SlashItem[] {
	return [
		{
			id: 'h1',
			label: t('docs.slash.h1'),
			description: t('docs.slash.desc.h1'),
			category: 'basic',
			shortcut: '#',
			keywords: ['h1', 'heading', 'title'],
			icon: Heading1,
			isActive: (editor) => editor.isActive('heading', { level: 1 }),
			apply: (editor, range) => applyBlock(editor, range, (chain) => chain.toggleHeading({ level: 1 }))
		},
		{
			id: 'h2',
			label: t('docs.slash.h2'),
			description: t('docs.slash.desc.h2'),
			category: 'basic',
			shortcut: '##',
			keywords: ['h2', 'heading', 'subtitle'],
			icon: Heading2,
			isActive: (editor) => editor.isActive('heading', { level: 2 }),
			apply: (editor, range) => applyBlock(editor, range, (chain) => chain.toggleHeading({ level: 2 }))
		},
		{
			id: 'h3',
			label: t('docs.slash.h3'),
			description: t('docs.slash.desc.h3'),
			category: 'basic',
			shortcut: '###',
			keywords: ['h3', 'heading', 'subheading'],
			icon: Heading3,
			isActive: (editor) => editor.isActive('heading', { level: 3 }),
			apply: (editor, range) => applyBlock(editor, range, (chain) => chain.toggleHeading({ level: 3 }))
		},
		{
			id: 'quote',
			label: t('docs.slash.quote'),
			description: t('docs.slash.desc.quote'),
			category: 'basic',
			shortcut: '>',
			keywords: ['quote', 'blockquote', 'cite'],
			icon: Quote,
			isActive: (editor) => editor.isActive('blockquote'),
			apply: (editor, range) => applyBlock(editor, range, (chain) => chain.toggleBlockquote())
		},
		{
			id: 'callout',
			label: t('docs.slash.callout'),
			description: t('docs.slash.desc.callout'),
			category: 'basic',
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
			id: 'hr',
			label: t('docs.slash.divider'),
			description: t('docs.slash.desc.divider'),
			category: 'basic',
			shortcut: '---',
			keywords: ['divider', 'hr', 'separator', 'rule'],
			icon: Minus,
			apply: (editor, range) => applyBlock(editor, range, (chain) => chain.setHorizontalRule())
		},
		{
			id: 'bullet',
			label: t('docs.slash.bullet'),
			description: t('docs.slash.desc.bullet'),
			category: 'lists',
			shortcut: '-',
			keywords: ['list', 'ul', 'unordered'],
			icon: List,
			isActive: (editor) => editor.isActive('bulletList'),
			apply: (editor, range) => applyBlock(editor, range, (chain) => chain.toggleBulletList())
		},
		{
			id: 'ordered',
			label: t('docs.slash.ordered'),
			description: t('docs.slash.desc.ordered'),
			category: 'lists',
			shortcut: '1.',
			keywords: ['list', 'ol', 'numbered'],
			icon: ListOrdered,
			isActive: (editor) => editor.isActive('orderedList'),
			apply: (editor, range) => applyBlock(editor, range, (chain) => chain.toggleOrderedList())
		},
		{
			id: 'task',
			label: t('docs.slash.task'),
			description: t('docs.slash.desc.task'),
			category: 'lists',
			shortcut: '[]',
			keywords: ['todo', 'checkbox', 'task'],
			icon: CheckSquare,
			isActive: (editor) => editor.isActive('taskList'),
			apply: (editor, range) => applyBlock(editor, range, (chain) => chain.toggleTaskList())
		},
		{
			id: 'toggle',
			label: t('docs.slash.toggle'),
			description: t('docs.slash.desc.toggle'),
			category: 'lists',
			keywords: ['toggle', 'collapsible', 'details', 'expand'],
			icon: ChevronRight,
			apply: (editor, range) =>
				applyBlock(editor, range, (chain) => chain.setToggle({ summary: t('docs.slash.toggle-summary') }))
		},
		{
			id: 'toggle-h1',
			label: t('docs.slash.toggle-h1'),
			description: t('docs.slash.desc.toggle-h1'),
			category: 'lists',
			keywords: ['toggle', 'heading', 'h1', 'collapsible'],
			icon: Heading1,
			apply: (editor, range) =>
				applyBlock(editor, range, (chain) =>
					chain.setToggleHeading({ level: 1, summary: t('docs.slash.toggle-h1') })
				)
		},
		{
			id: 'toggle-h2',
			label: t('docs.slash.toggle-h2'),
			description: t('docs.slash.desc.toggle-h2'),
			category: 'lists',
			keywords: ['toggle', 'heading', 'h2', 'collapsible'],
			icon: Heading2,
			apply: (editor, range) =>
				applyBlock(editor, range, (chain) =>
					chain.setToggleHeading({ level: 2, summary: t('docs.slash.toggle-h2') })
				)
		},
		{
			id: 'toggle-h3',
			label: t('docs.slash.toggle-h3'),
			description: t('docs.slash.desc.toggle-h3'),
			category: 'lists',
			keywords: ['toggle', 'heading', 'h3', 'collapsible'],
			icon: Heading3,
			apply: (editor, range) =>
				applyBlock(editor, range, (chain) =>
					chain.setToggleHeading({ level: 3, summary: t('docs.slash.toggle-h3') })
				)
		},
		{
			id: 'col2',
			label: t('docs.slash.col2'),
			description: t('docs.slash.desc.col2'),
			category: 'layout',
			keywords: ['columns', '2col', 'layout', 'split'],
			icon: Columns2,
			apply: (editor, range) => applyBlock(editor, range, (chain) => chain.setColumns(2))
		},
		{
			id: 'col3',
			label: t('docs.slash.col3'),
			description: t('docs.slash.desc.col3'),
			category: 'layout',
			keywords: ['columns', '3col', 'layout'],
			icon: Columns3,
			apply: (editor, range) => applyBlock(editor, range, (chain) => chain.setColumns(3))
		},
		{
			id: 'col4',
			label: t('docs.slash.col4'),
			description: t('docs.slash.desc.col4'),
			category: 'layout',
			keywords: ['columns', '4col', 'layout', 'grid'],
			icon: LayoutGrid,
			apply: (editor, range) => applyBlock(editor, range, (chain) => chain.setColumns(4))
		},
		{
			id: 'table',
			label: t('docs.slash.table'),
			description: t('docs.slash.desc.table'),
			category: 'layout',
			keywords: ['table', 'grid'],
			icon: Table2,
			apply: (editor, range) =>
				applyBlock(editor, range, (chain) => chain.insertTable({ rows: 3, cols: 3, withHeaderRow: true }))
		},
		{
			id: 'media-embed',
			label: t('docs.slash.embed'),
			description: t('docs.slash.desc.embed'),
			category: 'layout',
			keywords: ['embed', 'media', 'video', 'audio', 'pdf', 'file', 'image'],
			icon: Paperclip,
			apply: (editor, range) =>
				applyBlock(editor, range, (chain) =>
					chain.insertContent({
						type: 'embed',
						attrs: { url: '', kind: 'file', title: '', fileId: null }
					})
				)
		},
		{
			id: 'bookmark',
			label: t('docs.slash.bookmark'),
			description: t('docs.slash.desc.bookmark'),
			category: 'layout',
			keywords: ['bookmark', 'link', 'card', 'unfurl'],
			icon: Bookmark,
			apply: (editor, range) => applyBlock(editor, range, (chain) => chain.insertBookmarkCard({ url: '' }))
		},
		{
			id: 'code',
			label: t('docs.slash.code'),
			description: t('docs.slash.desc.code'),
			category: 'advanced',
			shortcut: '```',
			keywords: ['code', 'snippet', 'pre'],
			icon: Code2,
			isActive: (editor) => editor.isActive('codeBlock'),
			apply: (editor, range) => applyBlock(editor, range, (chain) => chain.toggleCodeBlock())
		},
		{
			id: 'mermaid',
			label: t('docs.slash.mermaid'),
			description: t('docs.slash.desc.mermaid'),
			category: 'advanced',
			keywords: ['mermaid', 'diagram', 'flowchart', 'sequence'],
			icon: Workflow,
			apply: (editor, range) => applyBlock(editor, range, (chain) => chain.insertMermaidBlock())
		},
		{
			id: 'math',
			label: t('docs.slash.math'),
			description: t('docs.slash.desc.math'),
			category: 'advanced',
			shortcut: '$$',
			keywords: ['math', 'latex', 'katex', 'equation'],
			icon: Sigma,
			apply: (editor, range) => applyBlock(editor, range, (chain) => chain.insertMathBlock())
		},
		{
			id: 'toc',
			label: t('docs.slash.toc'),
			description: t('docs.slash.desc.toc'),
			category: 'advanced',
			keywords: ['toc', 'outline', 'contents'],
			icon: ListTree,
			apply: (editor, range) => applyBlock(editor, range, (chain) => chain.insertTocBlock())
		},
		{
			id: 'button',
			label: t('docs.slash.button'),
			description: t('docs.slash.desc.button'),
			category: 'advanced',
			keywords: ['button', 'action', 'automation', 'template'],
			icon: Play,
			apply: (editor, range) => applyBlock(editor, range, (chain) => chain.insertButtonBlock())
		},
		{
			id: 'linked-database-view',
			label: t('databases.slash.linked-view'),
			description: t('databases.slash.linked-view-desc'),
			category: 'advanced',
			keywords: ['database', 'table', 'view', 'linked'],
			icon: Database,
			apply: (editor, range) =>
				applyBlock(editor, range, (chain) =>
					chain.insertContent({
						type: 'linkedViewBlock',
						attrs: { sourceType: 'database', sourceId: '', viewId: '', config: {} }
					})
				)
		},
		{
			id: 'synced-block',
			label: t('docs.slash.synced-block'),
			description: t('docs.slash.desc.synced-block'),
			category: 'advanced',
			keywords: ['synced', 'shared', 'transclusion', 'reuse'],
			icon: RefreshCw,
			apply: (editor, range) =>
				applyBlock(editor, range, (chain) => chain.insertSyncedBlock({ syncedBlockId: '' }))
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
