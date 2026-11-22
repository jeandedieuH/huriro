import { t } from '@huriro/i18n'
import type { Editor } from '@tiptap/react'
import {
	CheckSquare,
	Code2,
	Heading1,
	Heading2,
	Heading3,
	List,
	ListOrdered,
	Megaphone,
	Minus,
	Plus,
	Table2
} from 'lucide-react'
import { useState } from 'react'
import { Button } from '@/components/ui/button'
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover'

export interface SlashMenuProps {
	readonly editor: Editor | null
	readonly canWrite: boolean
}

export function SlashMenu({ editor, canWrite }: SlashMenuProps) {
	const [open, setOpen] = useState(false)

	if (!editor || !canWrite) return null
	const ed = editor

	function run(fn: () => void) {
		fn()
		setOpen(false)
	}

	const items = [
		{
			id: 'h1',
			label: t('docs.slash.h1'),
			icon: Heading1,
			onClick: () => ed.chain().focus().toggleHeading({ level: 1 }).run()
		},
		{
			id: 'h2',
			label: t('docs.slash.h2'),
			icon: Heading2,
			onClick: () => ed.chain().focus().toggleHeading({ level: 2 }).run()
		},
		{
			id: 'h3',
			label: t('docs.slash.h3'),
			icon: Heading3,
			onClick: () => ed.chain().focus().toggleHeading({ level: 3 }).run()
		},
		{
			id: 'bullet',
			label: t('docs.slash.bullet'),
			icon: List,
			onClick: () => ed.chain().focus().toggleBulletList().run()
		},
		{
			id: 'ordered',
			label: t('docs.slash.ordered'),
			icon: ListOrdered,
			onClick: () => ed.chain().focus().toggleOrderedList().run()
		},
		{
			id: 'task',
			label: t('docs.slash.task'),
			icon: CheckSquare,
			onClick: () => ed.chain().focus().toggleTaskList().run()
		},
		{
			id: 'code',
			label: t('docs.slash.code'),
			icon: Code2,
			onClick: () => ed.chain().focus().toggleCodeBlock().run()
		},
		{
			id: 'callout',
			label: t('docs.slash.callout'),
			icon: Megaphone,
			onClick: () =>
				ed
					.chain()
					.focus()
					.insertContent({
						type: 'callout',
						attrs: { tone: 'info' },
						content: [{ type: 'paragraph', content: [{ type: 'text', text: 'Note' }] }]
					})
					.run()
		},
		{
			id: 'table',
			label: t('docs.slash.table'),
			icon: Table2,
			onClick: () => ed.chain().focus().insertTable({ rows: 3, cols: 3, withHeaderRow: true }).run()
		},
		{
			id: 'hr',
			label: t('docs.slash.divider'),
			icon: Minus,
			onClick: () => ed.chain().focus().setHorizontalRule().run()
		}
	]

	return (
		<Popover open={open} onOpenChange={setOpen}>
			<PopoverTrigger asChild>
				<Button type="button" size="sm" tone="outline" className="h-7 gap-1 px-2 text-xs">
					<Plus className="size-3.5" aria-hidden />
					<span>{t('docs.slash.title')}</span>
				</Button>
			</PopoverTrigger>
			<PopoverContent align="start" className="w-56 p-1">
				<div role="menu" aria-label={t('docs.slash.title')} className="space-y-0.5">
					{items.map((item) => {
						const Icon = item.icon
						return (
							<button
								key={item.id}
								type="button"
								role="menuitem"
								onClick={() => run(item.onClick)}
								className="flex w-full items-center gap-2 rounded-sm px-2 py-1.5 text-left text-xs hover:bg-accent hover:text-accent-foreground"
							>
								<Icon className="size-3.5 text-muted-foreground" aria-hidden />
								<span>{item.label}</span>
							</button>
						)
					})}
				</div>
			</PopoverContent>
		</Popover>
	)
}
