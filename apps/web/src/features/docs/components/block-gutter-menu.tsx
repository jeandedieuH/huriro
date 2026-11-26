import type { DocPageDto } from '@huriro/contracts'
import {
	encodeProseMirrorAnchor,
	markdownToProseMirrorJson,
	SEMANTIC_TONES,
	type SemanticTone
} from '@huriro/editor'
import { t } from '@huriro/i18n'
import type { Editor } from '@tiptap/react'
import {
	ArrowDown,
	ArrowUp,
	Copy,
	FileInput,
	GripVertical,
	Link2,
	MessageSquare,
	Plus,
	Sparkles,
	Trash2
} from 'lucide-react'
import { type DragEvent, type RefObject, useEffect, useRef, useState } from 'react'
import type * as Y from 'yjs'
import { Button } from '@/components/ui/button'
import {
	Dialog,
	DialogContent,
	DialogDescription,
	DialogFooter,
	DialogHeader,
	DialogTitle
} from '@/components/ui/dialog'
import {
	DropdownMenu,
	DropdownMenuContent,
	DropdownMenuItem,
	DropdownMenuLabel,
	DropdownMenuSeparator,
	DropdownMenuTrigger
} from '@/components/ui/dropdown-menu'
import { Textarea } from '@/components/ui/textarea'
import { cn } from '@/lib/utils'
import { useUiStore } from '@/stores/ui-store'

export interface BlockGutterMenuProps {
	readonly editor: Editor | null
	readonly canWrite: boolean
	readonly containerRef?: RefObject<HTMLElement | null> | undefined
	readonly ydoc?: Y.Doc | undefined
	readonly onStartAnchoredComment?:
		| ((anchor: ReturnType<typeof encodeProseMirrorAnchor>, selectedText: string) => void)
		| undefined
	readonly pages?: readonly DocPageDto[] | undefined
	readonly currentPageId?: string | undefined
	readonly onMoveBlockToPage?:
		| ((targetPageId: string, nodes: readonly Record<string, unknown>[]) => Promise<void>)
		| undefined
	readonly onAskAi?: ((blockId: string, instruction: string) => Promise<string>) | undefined
}

interface HoveredBlock {
	readonly pos: number
	readonly nodeSize: number
	readonly top: number
}

interface DropIndicator {
	readonly top: number
	readonly targetPos: number
	readonly columnSide?: 'left' | 'right' | undefined
	readonly railX?: number | undefined
	readonly railHeight?: number | undefined
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

function findBlockPositionById(editor: Editor, blockId: string): { pos: number; nodeSize: number } | null {
	let found: { pos: number; nodeSize: number } | null = null
	editor.state.doc.descendants((node, pos) => {
		if (found) return false
		if (node.attrs['blockId'] === blockId) {
			found = { pos, nodeSize: node.nodeSize }
			return false
		}
		return true
	})
	return found
}

export function BlockGutterMenu({
	editor,
	canWrite,
	containerRef,
	ydoc,
	onStartAnchoredComment,
	pages = [],
	currentPageId,
	onMoveBlockToPage,
	onAskAi
}: BlockGutterMenuProps) {
	const [open, setOpen] = useState(false)
	const [moveDialogOpen, setMoveDialogOpen] = useState(false)
	const [movingToPage, setMovingToPage] = useState(false)
	const [aiDialogOpen, setAiDialogOpen] = useState(false)
	const [aiInstruction, setAiInstruction] = useState('')
	const [aiResult, setAiResult] = useState('')
	const [aiBusy, setAiBusy] = useState(false)
	const aiBlockRef = useRef<{ blockId: string } | null>(null)
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
				const horizontalRatio = rect.width > 0 ? (ev.clientX - rect.left) / rect.width : 0.5
				const columnSide = horizontalRatio <= 0.22 ? 'left' : horizontalRatio >= 0.78 ? 'right' : null
				const dist = columnSide ? Math.abs(ev.clientY - midY) * 0.5 : Math.abs(ev.clientY - edgeY)
				if (dist < minDist) {
					minDist = dist
					best = {
						top: columnSide ? rect.top - containerRect.top : edgeY - containerRect.top,
						targetPos: columnSide
							? resolved.pos
							: placeBefore
								? resolved.pos
								: resolved.pos + resolved.nodeSize,
						...(columnSide
							? {
									columnSide,
									railX: (columnSide === 'left' ? rect.left : rect.right) - containerRect.left,
									railHeight: rect.height
								}
							: {})
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
				if (target.columnSide) {
					editor
						.chain()
						.focus()
						.moveBlockToColumnSide(source.fromPos, target.targetPos, target.columnSide)
						.run()
				} else {
					editor.chain().focus().moveBlock(source.fromPos, target.targetPos).run()
				}
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

	function handleStartBlockComment() {
		if (!editor || !hoveredBlock) return
		const from = Math.min(hoveredBlock.pos + 1, editor.state.doc.content.size)
		const to = Math.max(
			from,
			Math.min(hoveredBlock.pos + hoveredBlock.nodeSize - 1, editor.state.doc.content.size)
		)
		const selectedText = editor.state.doc.textBetween(from, to, ' ')
		const anchor = ydoc ? encodeProseMirrorAnchor(editor.state, ydoc, from, to) : null
		onStartAnchoredComment?.(anchor, selectedText)
		setOpen(false)
	}

	function handleOpenAskAi() {
		if (!editor || !hoveredBlock || !onAskAi) return
		const node = editor.state.doc.nodeAt(hoveredBlock.pos)
		const blockId = typeof node?.attrs['blockId'] === 'string' ? String(node.attrs['blockId']) : null
		if (!blockId) return
		aiBlockRef.current = { blockId }
		setAiInstruction('')
		setAiResult('')
		setAiDialogOpen(true)
		setOpen(false)
	}

	async function handleAskAiSubmit() {
		const blockId = aiBlockRef.current?.blockId
		if (!blockId || !onAskAi || !aiInstruction.trim()) return
		setAiBusy(true)
		try {
			const text = await onAskAi(blockId, aiInstruction.trim())
			setAiResult(text)
		} catch (error) {
			pushToast({
				tone: 'danger',
				title: t('docs.block.ai-error'),
				description: error instanceof Error ? error.message : undefined
			})
		} finally {
			setAiBusy(false)
		}
	}

	function handleInsertAiResult() {
		const blockId = aiBlockRef.current?.blockId
		if (!editor || !blockId || !aiResult.trim()) return
		const target = findBlockPositionById(editor, blockId)
		if (!target) return
		const parsed = markdownToProseMirrorJson(aiResult, `ask-ai:${blockId}`)
		const content = Array.isArray(parsed['content']) ? parsed['content'] : []
		if (content.length === 0) return
		editor
			.chain()
			.focus()
			.insertContentAt(target.pos + target.nodeSize, content)
			.run()
		setAiDialogOpen(false)
		pushToast({ tone: 'success', title: t('docs.block.ai-inserted') })
	}

	async function handleMoveToPage(targetPageId: string) {
		if (!editor || !hoveredBlock || !onMoveBlockToPage) return
		const node = editor.state.doc.nodeAt(hoveredBlock.pos)
		if (!node) return
		setMovingToPage(true)
		try {
			// Structured JSON keeps database embeds, colors, tables, media, and other
			// custom attrs intact; the original block is removed only after append succeeds.
			const blockId = typeof node.attrs['blockId'] === 'string' ? node.attrs['blockId'] : null
			await onMoveBlockToPage(targetPageId, [node.toJSON() as Record<string, unknown>])
			// Re-resolve after the network/sync await: collaborative edits may have moved
			// the block, and deleting the current selection could remove the wrong node.
			const fresh = blockId ? findBlockPositionById(editor, blockId) : null
			const from = fresh?.pos ?? hoveredBlock.pos
			const to = fresh ? fresh.pos + fresh.nodeSize : hoveredBlock.pos + hoveredBlock.nodeSize
			editor.chain().focus().deleteRange({ from, to }).run()
			setMoveDialogOpen(false)
			setOpen(false)
			pushToast({ tone: 'success', title: t('docs.block.move-page-success') })
		} catch (error) {
			pushToast({
				tone: 'danger',
				title: t('docs.block.move-page-error'),
				description: error instanceof Error ? error.message : undefined
			})
		} finally {
			setMovingToPage(false)
		}
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
			<DropdownMenuItem disabled={!onStartAnchoredComment} onSelect={handleStartBlockComment}>
				<MessageSquare className="size-3.5 text-muted-foreground" aria-hidden />
				<span>{t('docs.block.comment')}</span>
			</DropdownMenuItem>
			<DropdownMenuItem
				disabled={!onMoveBlockToPage || pages.filter((page) => page.id !== currentPageId).length === 0}
				onSelect={() => {
					focusHoveredBlock()
					setMoveDialogOpen(true)
				}}
			>
				<FileInput className="size-3.5 text-muted-foreground" aria-hidden />
				<span>{t('docs.block.move-to-page')}</span>
			</DropdownMenuItem>
			<DropdownMenuItem disabled={!onAskAi} onSelect={handleOpenAskAi}>
				<Sparkles className="size-3.5 text-muted-foreground" aria-hidden />
				<span>{t('docs.block.ask-ai')}</span>
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
			<DropdownMenuItem
				onSelect={() =>
					editor
						.chain()
						.focus()
						.setToggle({ summary: t('docs.slash.toggle') })
						.run()
				}
			>
				{t('docs.slash.toggle')}
			</DropdownMenuItem>
			<DropdownMenuItem onSelect={() => editor.chain().focus().setCallout({ tone: 'info' }).run()}>
				{t('docs.slash.callout')}
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
					style={
						dropIndicator.columnSide
							? {
									top: dropIndicator.top,
									left: dropIndicator.railX,
									height: dropIndicator.railHeight
								}
							: { top: dropIndicator.top }
					}
					className={cn(
						'pointer-events-none absolute z-(--z-raised)',
						dropIndicator.columnSide
							? 'w-0.5 rounded-full bg-primary'
							: 'inset-x-10 flex items-center sm:inset-x-14'
					)}
				>
					{dropIndicator.columnSide ? null : (
						<>
							<span className="-ml-1 size-2 rounded-full bg-primary" />
							<span className="h-0.5 flex-1 rounded-full bg-primary" />
						</>
					)}
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
			<Dialog open={aiDialogOpen} onOpenChange={setAiDialogOpen}>
				<DialogContent className="max-w-xl">
					<DialogHeader>
						<DialogTitle>{t('docs.block.ask-ai')}</DialogTitle>
						<DialogDescription>{t('docs.block.ai-description')}</DialogDescription>
					</DialogHeader>
					<Textarea
						aria-label={t('docs.block.ai-instruction')}
						value={aiInstruction}
						onChange={(event) => setAiInstruction(event.target.value)}
						placeholder={t('docs.block.ai-placeholder')}
						rows={4}
					/>
					{aiResult ? (
						<div className="max-h-64 overflow-y-auto rounded-lg border border-border/70 bg-muted/30 p-3">
							<span className="mb-1 block font-medium text-xs">{t('docs.block.ai-result')}</span>
							<pre className="whitespace-pre-wrap font-sans text-sm">{aiResult}</pre>
						</div>
					) : null}
					<DialogFooter>
						{aiResult ? (
							<Button type="button" onClick={handleInsertAiResult}>
								{t('docs.block.ai-insert')}
							</Button>
						) : (
							<Button
								type="button"
								disabled={aiBusy || !aiInstruction.trim()}
								onClick={() => void handleAskAiSubmit()}
							>
								{aiBusy ? t('docs.block.ai-running') : t('docs.block.ai-submit')}
							</Button>
						)}
					</DialogFooter>
				</DialogContent>
			</Dialog>

			<Dialog open={moveDialogOpen} onOpenChange={setMoveDialogOpen}>
				<DialogContent className="max-w-md">
					<DialogHeader>
						<DialogTitle>{t('docs.block.move-to-page')}</DialogTitle>
						<DialogDescription>{t('docs.block.move-page-description')}</DialogDescription>
					</DialogHeader>
					<div className="max-h-80 space-y-1 overflow-y-auto">
						{pages
							.filter((page) => page.id !== currentPageId && page.archivedAt === null)
							.map((page) => (
								<button
									key={page.id}
									type="button"
									disabled={movingToPage}
									onClick={() => void handleMoveToPage(page.id)}
									className="w-full rounded-lg border border-border/70 px-3 py-2 text-left text-sm hover:bg-accent disabled:opacity-50"
								>
									<span className="block truncate font-medium">
										{page.icon} {page.title}
									</span>
									<span className="block truncate text-muted-foreground text-xs">{page.slug}</span>
								</button>
							))}
					</div>
				</DialogContent>
			</Dialog>
		</>
	)
}
