import { TABLE_CELL_TONES, type TableCellTone } from '@huriro/editor'
import { t } from '@huriro/i18n'
import type { Editor } from '@tiptap/react'
import {
	ArrowDownAZ,
	ArrowUpZA,
	Columns,
	GripHorizontal,
	GripVertical,
	Palette,
	Rows,
	Trash2
} from 'lucide-react'
import { type RefObject, useEffect, useState } from 'react'
import { Button } from '@/components/ui/button'
import {
	DropdownMenu,
	DropdownMenuContent,
	DropdownMenuItem,
	DropdownMenuTrigger
} from '@/components/ui/dropdown-menu'
import { Separator } from '@/components/ui/separator'
import { cn } from '@/lib/utils'

export interface TableToolbarProps {
	readonly editor: Editor | null
	readonly canWrite: boolean
	readonly containerRef?: RefObject<HTMLElement | null> | undefined
}

function getCurrentTableColumnIndex(editor: Editor): number {
	const { $from } = editor.state.selection
	for (let d = $from.depth; d > 0; d--) {
		const name = $from.node(d).type.name
		if (name === 'tableCell' || name === 'tableHeader') {
			return $from.index(d - 1)
		}
	}
	return 0
}

const CELL_TONE_LABELS: Record<TableCellTone, () => string> = {
	default: () => t('docs.tone.default'),
	muted: () => t('docs.tone.muted'),
	info: () => t('docs.tone.info'),
	success: () => t('docs.tone.success'),
	warning: () => t('docs.tone.warning'),
	danger: () => t('docs.tone.danger')
}

const CELL_TONE_DOT: Record<TableCellTone, string> = {
	default: 'bg-background border-border',
	muted: 'bg-muted border-border',
	info: 'bg-(--info)/25 border-(--info)/50',
	success: 'bg-(--success)/25 border-(--success)/50',
	warning: 'bg-(--warning)/30 border-(--warning)/55',
	danger: 'bg-destructive/25 border-destructive/50'
}

function getActiveTableTopOffset(
	editor: Editor,
	containerRef?: RefObject<HTMLElement | null>
): number | null {
	const container = containerRef?.current
	if (!container) return null
	try {
		const domInfo = editor.view.domAtPos(editor.state.selection.from)
		const el = domInfo.node instanceof HTMLElement ? domInfo.node : (domInfo.node.parentElement ?? null)
		const tableEl = el?.closest('table')
		if (!tableEl) return null
		const containerRect = container.getBoundingClientRect()
		const tableRect = tableEl.getBoundingClientRect()
		return Math.max(0, tableRect.top - containerRect.top - 42)
	} catch {
		return null
	}
}

export function TableToolbar({ editor, canWrite, containerRef }: TableToolbarProps) {
	const [, setTick] = useState(0)

	useEffect(() => {
		if (!editor) return
		const bump = () => setTick((n) => n + 1)
		editor.on('selectionUpdate', bump)
		editor.on('transaction', bump)
		return () => {
			editor.off('selectionUpdate', bump)
			editor.off('transaction', bump)
		}
	}, [editor])

	if (!editor || !canWrite || !editor.isActive('table')) return null

	const colIndex = getCurrentTableColumnIndex(editor)
	const anchoredTop = getActiveTableTopOffset(editor, containerRef)

	const startRowDrag = (event: React.PointerEvent<HTMLButtonElement>) => {
		event.preventDefault()
		let lastY = event.clientY
		const move = (moveEvent: PointerEvent) => {
			const delta = moveEvent.clientY - lastY
			if (Math.abs(delta) < 24) return
			editor
				.chain()
				.focus()
				.moveCurrentTableRow(delta > 0 ? 1 : -1)
				.run()
			lastY = moveEvent.clientY
		}
		const up = () => {
			window.removeEventListener('pointermove', move)
			window.removeEventListener('pointerup', up)
		}
		window.addEventListener('pointermove', move)
		window.addEventListener('pointerup', up)
	}
	const startColumnDrag = (event: React.PointerEvent<HTMLButtonElement>) => {
		event.preventDefault()
		let lastX = event.clientX
		const move = (moveEvent: PointerEvent) => {
			const delta = moveEvent.clientX - lastX
			if (Math.abs(delta) < 32) return
			editor
				.chain()
				.focus()
				.moveCurrentTableColumn(delta > 0 ? 1 : -1)
				.run()
			lastX = moveEvent.clientX
		}
		const up = () => {
			window.removeEventListener('pointermove', move)
			window.removeEventListener('pointerup', up)
		}
		window.addEventListener('pointermove', move)
		window.addEventListener('pointerup', up)
	}

	return (
		<div
			role="toolbar"
			aria-label={t('docs.table.controls')}
			style={anchoredTop !== null ? { top: anchoredTop } : undefined}
			className={cn(
				'flex flex-wrap items-center gap-0.5 rounded-xl border border-border/90 bg-popover/95 px-1.5 py-1 shadow-(--shadow-2) backdrop-blur-md',
				anchoredTop !== null ? 'absolute right-12 z-(--z-raised) sm:right-16' : 'mb-2 inline-flex'
			)}
		>
			<Button
				type="button"
				size="icon"
				tone="ghost"
				aria-label={t('docs.table.drag-row')}
				title={t('docs.table.drag-row')}
				className="size-6 cursor-grab text-muted-foreground active:cursor-grabbing"
				onPointerDown={startRowDrag}
			>
				<GripVertical className="size-3.5" aria-hidden />
			</Button>
			<Button
				type="button"
				size="icon"
				tone="ghost"
				aria-label={t('docs.table.drag-column')}
				title={t('docs.table.drag-column')}
				className="size-6 cursor-grab text-muted-foreground active:cursor-grabbing"
				onPointerDown={startColumnDrag}
			>
				<GripHorizontal className="size-3.5" aria-hidden />
			</Button>
			<Separator orientation="vertical" className="mx-0.5 h-4" />

			<Button
				type="button"
				size="sm"
				tone="ghost"
				className="h-6 gap-1 px-2 text-xs"
				onMouseDown={(ev) => ev.preventDefault()}
				onClick={() => editor.chain().focus().addRowAfter().run()}
			>
				<Rows className="size-3 text-muted-foreground" aria-hidden />
				<span>{t('docs.table.add-row')}</span>
			</Button>
			<Button
				type="button"
				size="sm"
				tone="ghost"
				className="h-6 gap-1 px-2 text-xs"
				onMouseDown={(ev) => ev.preventDefault()}
				onClick={() => editor.chain().focus().addColumnAfter().run()}
			>
				<Columns className="size-3 text-muted-foreground" aria-hidden />
				<span>{t('docs.table.add-col')}</span>
			</Button>
			<Button
				type="button"
				size="sm"
				tone="ghost"
				className="h-6 px-2 text-xs text-muted-foreground hover:text-foreground"
				onMouseDown={(ev) => ev.preventDefault()}
				onClick={() => editor.chain().focus().deleteRow().run()}
			>
				{t('docs.table.del-row')}
			</Button>
			<Button
				type="button"
				size="sm"
				tone="ghost"
				className="h-6 px-2 text-xs text-muted-foreground hover:text-foreground"
				onMouseDown={(ev) => ev.preventDefault()}
				onClick={() => editor.chain().focus().deleteColumn().run()}
			>
				{t('docs.table.del-col')}
			</Button>

			<Separator orientation="vertical" className="mx-0.5 h-4" />

			<Button
				type="button"
				size="sm"
				tone="ghost"
				className="h-6 px-2 text-xs"
				onMouseDown={(ev) => ev.preventDefault()}
				onClick={() => editor.chain().focus().toggleHeaderRow().run()}
			>
				{t('docs.table.header-row')}
			</Button>
			<Button
				type="button"
				size="sm"
				tone="ghost"
				className="h-6 px-2 text-xs"
				onMouseDown={(ev) => ev.preventDefault()}
				onClick={() => editor.chain().focus().toggleHeaderColumn().run()}
			>
				{t('docs.table.header-col')}
			</Button>

			<Separator orientation="vertical" className="mx-0.5 h-4" />

			<Button
				type="button"
				size="sm"
				tone="ghost"
				className="h-6 gap-1 px-2 text-xs"
				onMouseDown={(ev) => ev.preventDefault()}
				onClick={() => editor.chain().focus().sortTableByColumn(colIndex, 'asc').run()}
			>
				<ArrowDownAZ className="size-3 text-muted-foreground" aria-hidden />
				<span>{t('docs.table.sort-asc')}</span>
			</Button>
			<Button
				type="button"
				size="sm"
				tone="ghost"
				className="h-6 gap-1 px-2 text-xs"
				onMouseDown={(ev) => ev.preventDefault()}
				onClick={() => editor.chain().focus().sortTableByColumn(colIndex, 'desc').run()}
			>
				<ArrowUpZA className="size-3 text-muted-foreground" aria-hidden />
				<span>{t('docs.table.sort-desc')}</span>
			</Button>

			<DropdownMenu>
				<DropdownMenuTrigger asChild>
					<Button
						type="button"
						size="sm"
						tone="ghost"
						className="h-6 gap-1 px-2 text-xs"
						onMouseDown={(ev) => ev.preventDefault()}
					>
						<Palette className="size-3 text-muted-foreground" aria-hidden />
						<span>{t('docs.table.cell-tint')}</span>
					</Button>
				</DropdownMenuTrigger>
				<DropdownMenuContent
					align="end"
					className="w-40 rounded-xl border-border/90 bg-popover/98 p-1 shadow-(--shadow-3)"
				>
					{TABLE_CELL_TONES.map((tone) => (
						<DropdownMenuItem
							key={tone}
							onSelect={() => editor.chain().focus().setCellBackgroundTone(tone).run()}
						>
							<span className={cn('size-3.5 rounded-sm border', CELL_TONE_DOT[tone])} aria-hidden />
							<span>{CELL_TONE_LABELS[tone]()}</span>
						</DropdownMenuItem>
					))}
				</DropdownMenuContent>
			</DropdownMenu>

			<Separator orientation="vertical" className="mx-0.5 h-4" />

			<Button
				type="button"
				size="icon"
				tone="ghost"
				aria-label={t('docs.table.delete')}
				className="size-6 text-muted-foreground hover:text-destructive"
				onMouseDown={(ev) => ev.preventDefault()}
				onClick={() => editor.chain().focus().deleteTable().run()}
			>
				<Trash2 className="size-3.5" aria-hidden />
			</Button>
		</div>
	)
}
