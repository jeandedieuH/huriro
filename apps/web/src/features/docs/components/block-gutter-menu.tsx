import { SEMANTIC_TONES, type SemanticTone } from '@huriro/editor'
import { t } from '@huriro/i18n'
import type { Editor } from '@tiptap/react'
import { ArrowDown, ArrowUp, Copy, GripVertical, Link2, Plus, Trash2 } from 'lucide-react'
import { type DragEvent, type RefObject, useEffect, useRef, useState } from 'react'
import { Button } from '@/components/ui/button'
import {
	DropdownMenu,
	DropdownMenuContent,
	DropdownMenuItem,
	DropdownMenuLabel,
	DropdownMenuSeparator,
	DropdownMenuTrigger
} from '@/components/ui/dropdown-menu'
import { cn } from '@/lib/utils'
import { useUiStore } from '@/stores/ui-store'

export interface BlockGutterMenuProps {
	readonly editor: Editor | null
	readonly canWrite: boolean
	readonly containerRef?: RefObject<HTMLElement | null> | undefined
}

interface HoveredBlock {
	readonly pos: number
	readonly nodeSize: number
	readonly top: number
}

interface DropIndicator {
	readonly top: number
	readonly targetPos: number
}

function getSelectedBlockId(editor: Editor): string | null {
	const { $from } = editor.state.selection
	for (let d = $from.depth; d >= 1; d--) {
		const id = $from.node(d).attrs['blockId']
		if (typeof id === 'string' && id.length > 0) return id
	}
	return null
}

const TONE_LABELS: Record<SemanticTone, () => string> = {
	default: () => t('docs.tone.default'),
	muted: () => t('docs.tone.muted'),
	primary: () => t('docs.tone.primary'),
	info: () => t('docs.tone.info'),
	success: () => t('docs.tone.success'),
	warning: () => t('docs.tone.warning'),
	danger: () => t('docs.tone.danger')
}

const BG_TONE_DOT: Record<SemanticTone, string> = {
	default: 'bg-background border-border',
	muted: 'bg-muted border-border',
	primary: 'bg-primary/25 border-primary/50',
	info: 'bg-(--info)/25 border-(--info)/50',
	success: 'bg-(--success)/25 border-(--success)/50',
	warning: 'bg-(--warning)/30 border-(--warning)/55',
	danger: 'bg-destructive/25 border-destructive/50'
}

const TEXT_TONE_COLOR: Record<SemanticTone, string> = {
	default: 'text-foreground border-border',
	muted: 'text-muted-foreground border-border',
	primary: 'text-primary border-primary/40',
	info: 'text-(--info) border-(--info)/40',
	success: 'text-(--success) border-(--success)/40',
	warning: 'text-(--warning) border-(--warning)/40',
	danger: 'text-destructive border-destructive/40'
}

function resolveBlockFromDom(editor: Editor, blockEl: HTMLElement): { pos: number; nodeSize: number } | null {
	try {
		const domPos = editor.view.posAtDOM(blockEl, 0)
		const clamped = Math.max(0, Math.min(editor.state.doc.content.size, domPos))
		const resolved = editor.state.doc.resolve(clamped)
		const pos = resolved.depth >= 1 ? resolved.before(1) : clamped
		const node = editor.state.doc.nodeAt(pos)
		if (!node?.isBlock) return null
		return { pos, nodeSize: node.nodeSize }
	} catch {
		return null
	}
}

export function BlockGutterMenu({ editor, canWrite, containerRef }: BlockGutterMenuProps) {
	const [open, setOpen] = useState(false)
	const [hoveredBlock, setHoveredBlock] = useState<HoveredBlock | null>(null)
	const [dropIndicator, setDropIndicator] = useState<DropIndicator | null>(null)
	const dropIndicatorRef = useRef<DropIndicator | null>(null)
	const dragSourceRef = useRef<{ fromPos: number; el: HTMLElement } | null>(null)
	const pushToast = useUiStore((s) => s.pushToast)

	// Keyboard shortcut Mod+/ opens the block menu at the current selection.
	useEffect(() => {
		if (!editor || !canWrite) return
		const handleKeyDown = (ev: KeyboardEvent) => {
			if ((ev.metaKey || ev.ctrlKey) && ev.key === '/') {
				ev.preventDefault()
				setOpen((prev) => !prev)
			}
		}
		window.addEventListener('keydown', handleKeyDown)
		return () => {
			window.removeEventListener('keydown', handleKeyDown)
		}
	}, [canWrite, editor])

	// Canvas hover + drag-and-drop tracking across direct .ProseMirror block children.
	useEffect(() => {
		const container = containerRef?.current
		if (!editor || !canWrite || !container) return

		const findBlockAtY = (clientY: number) => {
			const pm = container.querySelector('.ProseMirror')
			if (!pm) return null
			const containerRect = container.getBoundingClientRect()
			const children = Array.from(pm.children)
			for (const child of children) {
				if (!(child instanceof HTMLElement)) continue
				const rect = child.getBoundingClientRect()
				if (clientY >= rect.top - 6 && clientY <= rect.bottom + 6) {
					const resolved = resolveBlockFromDom(editor, child)
					if (!resolved) continue
					return {
						el: child,
						rect,
						top: rect.top - containerRect.top + (rect.height > 32 ? 2 : 0),
						...resolved
					}
				}
			}
			return null
		}

		const syncSelectionBlock = () => {
			if (open || dragSourceRef.current) return
			const { $from } = editor.state.selection
			if ($from.depth < 1) return
			const pos = $from.before(1)
			const node = editor.state.doc.nodeAt(pos)
			if (!node) return
			const dom = editor.view.nodeDOM(pos)
			if (dom instanceof HTMLElement) {
				const containerRect = container.getBoundingClientRect()
				const rect = dom.getBoundingClientRect()
				if (rect.height > 0) {
					setHoveredBlock({
						pos,
						nodeSize: node.nodeSize,
						top: rect.top - containerRect.top + (rect.height > 32 ? 2 : 0)
					})
				}
			}
		}

		const handleMouseMove = (ev: MouseEvent) => {
			if (open || dragSourceRef.current) return
			const hit = findBlockAtY(ev.clientY)
			if (!hit) return
			setHoveredBlock((prev) =>
				prev && prev.pos === hit.pos && Math.abs(prev.top - hit.top) < 1
					? prev
					: { pos: hit.pos, nodeSize: hit.nodeSize, top: hit.top }
			)
		}

		const handleMouseLeave = () => {
			if (!open && !dragSourceRef.current) {
				setHoveredBlock(null)
			}
		}

		const handleDragOver = (ev: globalThis.DragEvent) => {
			if (!dragSourceRef.current) return
			ev.preventDefault()
			if (ev.dataTransfer) ev.dataTransfer.dropEffect = 'move'
			const pm = container.querySelector('.ProseMirror')
			if (!pm) return
			const containerRect = container.getBoundingClientRect()
			const children = Array.from(pm.children).filter((el): el is HTMLElement => el instanceof HTMLElement)
			if (children.length === 0) return

			let best: DropIndicator | null = null
			let minDist = Number.POSITIVE_INFINITY
			for (const child of children) {
				const resolved = resolveBlockFromDom(editor, child)
				if (!resolved) continue
				const rect = child.getBoundingClientRect()
				const midY = rect.top + rect.height / 2
				const placeBefore = ev.clientY < midY
				const edgeY = placeBefore ? rect.top : rect.bottom
				const dist = Math.abs(ev.clientY - edgeY)
				if (dist < minDist) {
					minDist = dist
					best = {
						top: edgeY - containerRect.top,
						targetPos: placeBefore ? resolved.pos : resolved.pos + resolved.nodeSize
					}
				}
			}
			if (best) {
				dropIndicatorRef.current = best
				setDropIndicator(best)
			}
		}

		const clearDrag = () => {
			dragSourceRef.current?.el.classList.remove('huriro-block-dragging')
			dragSourceRef.current = null
			dropIndicatorRef.current = null
			setDropIndicator(null)
		}

		const handleDrop = (ev: globalThis.DragEvent) => {
			const source = dragSourceRef.current
			if (!source) return
			ev.preventDefault()
			const target = dropIndicatorRef.current
			if (target) {
				editor.chain().focus().moveBlock(source.fromPos, target.targetPos).run()
			}
			clearDrag()
		}

		container.addEventListener('mousemove', handleMouseMove)
		container.addEventListener('mouseleave', handleMouseLeave)
		container.addEventListener('dragover', handleDragOver)
		container.addEventListener('drop', handleDrop)
		window.addEventListener('dragend', clearDrag)
		editor.on('selectionUpdate', syncSelectionBlock)

		return () => {
			container.removeEventListener('mousemove', handleMouseMove)
			container.removeEventListener('mouseleave', handleMouseLeave)
			container.removeEventListener('dragover', handleDragOver)
			container.removeEventListener('drop', handleDrop)
			window.removeEventListener('dragend', clearDrag)
			editor.off('selectionUpdate', syncSelectionBlock)
		}
	}, [canWrite, containerRef, editor, open])

	if (!editor || !canWrite) return null

	function focusHoveredBlock() {
		if (!editor || !hoveredBlock) return
		const targetPos = Math.min(editor.state.doc.content.size, hoveredBlock.pos + 1)
		editor.commands.setTextSelection(targetPos)
	}

	function handleAddBlockBelow() {
		if (!editor) return
		const insertPos = hoveredBlock ? hoveredBlock.pos + hoveredBlock.nodeSize : editor.state.doc.content.size
		editor
			.chain()
			.focus()
			.insertContentAt(insertPos, { type: 'paragraph' })
			.setTextSelection(Math.min(editor.state.doc.content.size + 2, insertPos + 1))
			.insertContent('/')
			.run()
	}

	function handleCopyBlockLink() {
		if (!editor) return
		const blockId = getSelectedBlockId(editor)
		if (!blockId) return
		const url =
			typeof window !== 'undefined'
				? `${window.location.origin}${window.location.pathname}#block-${blockId}`
				: `#block-${blockId}`
		if (typeof navigator !== 'undefined' && navigator.clipboard) {
			void navigator.clipboard.writeText(url)
		}
		pushToast({ tone: 'success', title: t('docs.link.copied') })
	}

	function handleDragStart(ev: DragEvent<HTMLButtonElement>) {
		if (!editor || !hoveredBlock) return
		const dom = editor.view.nodeDOM(hoveredBlock.pos)
		if (dom instanceof HTMLElement) {
			dom.classList.add('huriro-block-dragging')
			dragSourceRef.current = { fromPos: hoveredBlock.pos, el: dom }
		}
		ev.dataTransfer.effectAllowed = 'move'
		ev.dataTransfer.setData('text/plain', String(hoveredBlock.pos))
	}

	const dropdownContent = (
		<DropdownMenuContent
			align="start"
			className="max-h-96 w-60 overflow-y-auto rounded-xl border-border/90 bg-popover/98 p-1.5 shadow-(--shadow-3) backdrop-blur-md"
		>
			<DropdownMenuItem onSelect={() => editor.chain().focus().moveCurrentBlockUp().run()}>
				<ArrowUp className="size-3.5 text-muted-foreground" aria-hidden />
				<span>{t('docs.block.move-up')}</span>
			</DropdownMenuItem>
			<DropdownMenuItem onSelect={() => editor.chain().focus().moveCurrentBlockDown().run()}>
				<ArrowDown className="size-3.5 text-muted-foreground" aria-hidden />
				<span>{t('docs.block.move-down')}</span>
			</DropdownMenuItem>
			<DropdownMenuItem onSelect={() => editor.chain().focus().duplicateCurrentBlock().run()}>
				<Copy className="size-3.5 text-muted-foreground" aria-hidden />
				<span>{t('docs.block.duplicate')}</span>
			</DropdownMenuItem>
			<DropdownMenuItem onSelect={handleCopyBlockLink}>
				<Link2 className="size-3.5 text-muted-foreground" aria-hidden />
				<span>{t('docs.block.copy-link')}</span>
			</DropdownMenuItem>

			<DropdownMenuSeparator />
			<DropdownMenuLabel>{t('docs.block.turn-into')}</DropdownMenuLabel>
			<DropdownMenuItem onSelect={() => editor.chain().focus().setParagraph().run()}>
				{t('docs.toolbar.text-block')}
			</DropdownMenuItem>
			<DropdownMenuItem onSelect={() => editor.chain().focus().toggleHeading({ level: 1 }).run()}>
				{t('docs.slash.h1')}
			</DropdownMenuItem>
			<DropdownMenuItem onSelect={() => editor.chain().focus().toggleHeading({ level: 2 }).run()}>
				{t('docs.slash.h2')}
			</DropdownMenuItem>
			<DropdownMenuItem onSelect={() => editor.chain().focus().toggleHeading({ level: 3 }).run()}>
				{t('docs.slash.h3')}
			</DropdownMenuItem>
			<DropdownMenuItem onSelect={() => editor.chain().focus().toggleBulletList().run()}>
				{t('docs.slash.bullet')}
			</DropdownMenuItem>
			<DropdownMenuItem onSelect={() => editor.chain().focus().toggleOrderedList().run()}>
				{t('docs.slash.ordered')}
			</DropdownMenuItem>
			<DropdownMenuItem onSelect={() => editor.chain().focus().toggleTaskList().run()}>
				{t('docs.slash.task')}
			</DropdownMenuItem>
			<DropdownMenuItem onSelect={() => editor.chain().focus().toggleBlockquote().run()}>
				{t('docs.slash.quote')}
			</DropdownMenuItem>
			<DropdownMenuItem onSelect={() => editor.chain().focus().setToggleHeading({ level: 2 }).run()}>
				{t('docs.slash.toggle-h2')}
			</DropdownMenuItem>
			<DropdownMenuItem onSelect={() => editor.chain().focus().setColumns(2).run()}>
				{t('docs.slash.col2')}
			</DropdownMenuItem>
			<DropdownMenuItem onSelect={() => editor.chain().focus().setColumns(3).run()}>
				{t('docs.slash.col3')}
			</DropdownMenuItem>
			<DropdownMenuItem onSelect={() => editor.chain().focus().toggleCodeBlock().run()}>
				{t('docs.slash.code')}
			</DropdownMenuItem>

			<DropdownMenuSeparator />
			<DropdownMenuLabel>{t('docs.block.bg-tone')}</DropdownMenuLabel>
			<div className="flex flex-wrap gap-1 px-2 py-1">
				{SEMANTIC_TONES.map((tone) => (
					<button
						key={`bg-${tone}`}
						type="button"
						aria-label={`${t('docs.block.bg-tone')}: ${TONE_LABELS[tone]()}`}
						onClick={() => {
							editor.chain().focus().setBlockBgTone(tone).run()
							setOpen(false)
						}}
						className={cn('size-5 rounded-md border transition-transform hover:scale-110', BG_TONE_DOT[tone])}
					/>
				))}
			</div>

			<DropdownMenuLabel>{t('docs.block.text-tone')}</DropdownMenuLabel>
			<div className="flex flex-wrap gap-1 px-2 py-1">
				{SEMANTIC_TONES.map((tone) => (
					<button
						key={`text-${tone}`}
						type="button"
						aria-label={`${t('docs.block.text-tone')}: ${TONE_LABELS[tone]()}`}
						onClick={() => {
							editor.chain().focus().setBlockTextTone(tone).run()
							setOpen(false)
						}}
						className={cn(
							'flex size-5 items-center justify-center rounded-md border bg-background text-[11px] font-semibold transition-transform hover:scale-110',
							TEXT_TONE_COLOR[tone]
						)}
					>
						A
					</button>
				))}
			</div>

			<DropdownMenuSeparator />
			<DropdownMenuItem
				className="text-destructive"
				onSelect={() => editor.chain().focus().deleteCurrentBlock().run()}
			>
				<Trash2 className="size-3.5" aria-hidden />
				<span>{t('docs.block.delete')}</span>
			</DropdownMenuItem>
		</DropdownMenuContent>
	)

	// Standalone inline fallback (used when no canvas containerRef is attached).
	if (!containerRef) {
		return (
			<DropdownMenu open={open} onOpenChange={setOpen}>
				<DropdownMenuTrigger asChild>
					<Button
						type="button"
						size="icon"
						tone="ghost"
						className="size-7"
						aria-label={t('docs.block.menu-label')}
					>
						<GripVertical className="size-3.5" aria-hidden />
					</Button>
				</DropdownMenuTrigger>
				{dropdownContent}
			</DropdownMenu>
		)
	}

	const isVisible = Boolean(hoveredBlock || open)
	const gutterTop = hoveredBlock?.top ?? 8

	return (
		<>
			{dropIndicator ? (
				<div
					aria-hidden="true"
					style={{ top: dropIndicator.top }}
					className="pointer-events-none absolute inset-x-10 z-(--z-raised) flex items-center sm:inset-x-14"
				>
					<span className="-ml-1 size-2 rounded-full bg-primary" />
					<span className="h-0.5 flex-1 rounded-full bg-primary" />
				</div>
			) : null}

			<div
				data-docs-chrome="true"
				style={{ top: gutterTop }}
				className={cn(
					'absolute left-1 z-(--z-raised) flex items-center gap-0.5 transition-[top,opacity] duration-(--motion-duration-fast) sm:left-3',
					isVisible ? 'opacity-100' : 'pointer-events-none opacity-0'
				)}
			>
				<Button
					type="button"
					size="icon"
					tone="ghost"
					aria-label={t('docs.block.add-below')}
					onMouseDown={(ev) => ev.preventDefault()}
					onClick={handleAddBlockBelow}
					className="size-6 rounded-md text-muted-foreground hover:bg-accent hover:text-foreground"
				>
					<Plus className="size-3.5" aria-hidden />
				</Button>

				<DropdownMenu
					open={open}
					onOpenChange={(nextOpen) => {
						if (nextOpen) focusHoveredBlock()
						setOpen(nextOpen)
					}}
				>
					<DropdownMenuTrigger asChild>
						<Button
							type="button"
							size="icon"
							tone="ghost"
							draggable={true}
							onDragStart={handleDragStart}
							title={t('docs.block.drag-hint')}
							aria-label={t('docs.block.menu-label')}
							className="size-6 cursor-grab rounded-md text-muted-foreground hover:bg-accent hover:text-foreground active:cursor-grabbing"
						>
							<GripVertical className="size-3.5" aria-hidden />
						</Button>
					</DropdownMenuTrigger>
					{dropdownContent}
				</DropdownMenu>
			</div>
		</>
	)
}
