import { t } from '@huriro/i18n'
import type { Editor } from '@tiptap/react'
import { Plus } from 'lucide-react'
import { useState } from 'react'
import { Button } from '@/components/ui/button'
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover'
import { getSlashItems } from './slash-items'

export interface SlashMenuProps {
	readonly editor: Editor | null
	readonly canWrite: boolean
}

export function SlashMenu({ editor, canWrite }: SlashMenuProps) {
	const [open, setOpen] = useState(false)

	if (!editor || !canWrite) return null

	const items = getSlashItems()

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
								onClick={() => {
									item.apply(editor)
									setOpen(false)
								}}
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
