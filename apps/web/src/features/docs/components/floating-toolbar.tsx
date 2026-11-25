import { isSafeUrl, SEMANTIC_TONES, type SemanticTone } from '@huriro/editor'
import { t } from '@huriro/i18n'
import type { Editor } from '@tiptap/react'
import {
	Bold,
	ChevronDown,
	Code,
	Italic,
	Link2,
	MessageSquarePlus,
	Palette,
	Strikethrough,
	Underline
} from 'lucide-react'
import { useEffect, useRef, useState } from 'react'
import { Button } from '@/components/ui/button'
import {
	DropdownMenu,
	DropdownMenuContent,
	DropdownMenuItem,
	DropdownMenuTrigger
} from '@/components/ui/dropdown-menu'
import { Input } from '@/components/ui/input'
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover'
import { Separator } from '@/components/ui/separator'
import { cn } from '@/lib/utils'

export interface FloatingToolbarProps {
	readonly editor: Editor | null
	readonly canWrite: boolean
	readonly canComment: boolean
	readonly onAddComment: () => void
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

const TEXT_SWATCH_CLASS: Record<SemanticTone, string> = {
	default: 'text-foreground border-border',
	muted: 'text-muted-foreground border-border',
	primary: 'text-primary border-primary/40',
	info: 'text-(--info) border-(--info)/40',
	success: 'text-(--success) border-(--success)/40',
	warning: 'text-(--warning) border-(--warning)/40',
	danger: 'text-destructive border-destructive/40'
}

const BG_SWATCH_CLASS: Record<SemanticTone, string> = {
	default: 'bg-background border-border',
	muted: 'bg-muted border-border',
	primary: 'bg-primary/20 border-primary/40',
	info: 'bg-(--info)/20 border-(--info)/40',
	success: 'bg-(--success)/20 border-(--success)/40',
	warning: 'bg-(--warning)/25 border-(--warning)/45',
	danger: 'bg-destructive/20 border-destructive/40'
}

function getActiveBlockLabel(editor: Editor): string {
	if (editor.isActive('heading', { level: 1 })) return t('docs.slash.h1')
	if (editor.isActive('heading', { level: 2 })) return t('docs.slash.h2')
	if (editor.isActive('heading', { level: 3 })) return t('docs.slash.h3')
	if (editor.isActive('bulletList')) return t('docs.slash.bullet')
	if (editor.isActive('orderedList')) return t('docs.slash.ordered')
	if (editor.isActive('taskList')) return t('docs.slash.task')
	if (editor.isActive('blockquote')) return t('docs.toolbar.quote')
	if (editor.isActive('codeBlock')) return t('docs.slash.code')
	return t('docs.toolbar.text-block')
}

function computeBubblePosition(editor: Editor): { readonly left: number; readonly top: number } {
	const fallback = { left: 24, top: 80 }
	if (typeof window === 'undefined') return fallback
	try {
		const { from, to } = editor.state.selection
		const start = editor.view.coordsAtPos(from)
		const end = editor.view.coordsAtPos(to)
		if (start.left === 0 && start.top === 0 && end.right === 0 && end.bottom === 0) {
			return fallback
		}
		const midX = (start.left + end.right) / 2
		const estimatedWidth = 440
		const vw = window.innerWidth || 1024
		const vh = window.innerHeight || 768
		const left = Math.max(12, Math.min(midX - estimatedWidth / 2, vw - estimatedWidth - 12))
		const aboveTop = start.top - 50
		const top = aboveTop >= 12 ? aboveTop : Math.min(vh - 56, end.bottom + 8)
		return { left, top }
	} catch {
		return fallback
	}
}

export function FloatingToolbar({ editor, canWrite, canComment, onAddComment }: FloatingToolbarProps) {
	const [linkOpen, setLinkOpen] = useState(false)
	const [colorOpen, setColorOpen] = useState(false)
	const [turnIntoOpen, setTurnIntoOpen] = useState(false)
	const [linkUrl, setLinkUrl] = useState('')
	const [linkError, setLinkError] = useState(false)
	const [dismissed, setDismissed] = useState(false)
	const [, setSelectionTick] = useState(0)
	// Set when a link was just applied — close-autofocus must not yank focus
	// back to the trigger, because applyLink already returned it to the editor.
	const linkApplied = useRef(false)

	useEffect(() => {
		if (!editor) return
		const handleSelection = () => {
			setDismissed(false)
			setSelectionTick((n) => n + 1)
		}
		const handleTransaction = () => {
			setSelectionTick((n) => n + 1)
		}
		editor.on('selectionUpdate', handleSelection)
		editor.on('transaction', handleTransaction)
		return () => {
			editor.off('selectionUpdate', handleSelection)
			editor.off('transaction', handleTransaction)
		}
	}, [editor])

	useEffect(() => {
		if (typeof window === 'undefined') return
		const onKeyDown = (ev: KeyboardEvent) => {
			if (ev.key === 'Escape') {
				setLinkOpen(false)
				setColorOpen(false)
				setTurnIntoOpen(false)
				setDismissed(true)
			}
		}
		const onViewportChange = () => setSelectionTick((n) => n + 1)
		window.addEventListener('keydown', onKeyDown)
		window.addEventListener('resize', onViewportChange)
		window.addEventListener('scroll', onViewportChange, true)
		return () => {
			window.removeEventListener('keydown', onKeyDown)
			window.removeEventListener('resize', onViewportChange)
			window.removeEventListener('scroll', onViewportChange, true)
		}
	}, [])

	if (!editor || (!canWrite && !canComment)) return null

	const { empty, from, to } = editor.state.selection
	const hasTextSelection = !empty && from < to
	const anyPopoverOpen = linkOpen || colorOpen || turnIntoOpen
	if ((dismissed && !anyPopoverOpen) || (!hasTextSelection && !anyPopoverOpen)) {
		return null
	}

	const isInsideCodeBlock = editor.isActive('codeBlock')
	if (isInsideCodeBlock && !canComment && !anyPopoverOpen) {
		return null
	}

	const coords = computeBubblePosition(editor)

	function handleLinkOpenChange(open: boolean) {
		setLinkError(false)
		if (open) {
			// Prefill with the current link so editing an existing link isn't a retype.
			setLinkUrl((editor?.getAttributes('link')['href'] as string | undefined) ?? '')
		}
		setLinkOpen(open)
	}

	function applyLink() {
		const trimmed = linkUrl.trim()
		if (!trimmed) {
			editor?.chain().focus().unsetLink().run()
			linkApplied.current = true
			setLinkOpen(false)
			return
		}
		if (!isSafeUrl(trimmed)) {
			setLinkError(true)
			return
		}
		// With a collapsed cursor outside any link, setLink would only set an
		// invisible stored mark — nothing appears in the document. Insert the URL
		// as visible linked text instead, matching Notion behavior.
		const selectionEmpty = editor?.state.selection.empty ?? false
		const insideLink = editor?.isActive('link') ?? false
		if (selectionEmpty && !insideLink) {
			editor
				?.chain()
				.focus()
				.insertContent({
					type: 'text',
					text: trimmed,
					marks: [{ type: 'link', attrs: { href: trimmed } }]
				})
				.run()
		} else {
			editor?.chain().focus().extendMarkRange('link').setLink({ href: trimmed }).run()
		}
		setLinkError(false)
		linkApplied.current = true
		setLinkOpen(false)
		setLinkUrl('')
	}

	const showWriteControls = canWrite && !isInsideCodeBlock

	return (
		<div
			role="toolbar"
			aria-label={t('docs.toolbar.label')}
			style={{ position: 'fixed', left: coords.left, top: coords.top }}
			className="z-(--z-popover) flex max-w-[calc(100vw-24px)] flex-wrap items-center gap-0.5 rounded-xl border border-border/90 bg-popover/95 px-1.5 py-1 shadow-(--shadow-3) backdrop-blur-md"
		>
			{showWriteControls ? (
				<>
					<DropdownMenu modal={false} open={turnIntoOpen} onOpenChange={setTurnIntoOpen}>
						<DropdownMenuTrigger asChild>
							<Button
								type="button"
								size="sm"
								tone="ghost"
								aria-label={t('docs.toolbar.turn-into')}
								onMouseDown={(ev) => ev.preventDefault()}
								className="h-7 gap-1 px-2 text-xs font-medium"
							>
								<span className="max-w-24 truncate">{getActiveBlockLabel(editor)}</span>
								<ChevronDown className="size-3 text-muted-foreground" aria-hidden />
							</Button>
						</DropdownMenuTrigger>
						<DropdownMenuContent
							align="start"
							className="w-48 rounded-xl border-border/90 bg-popover/98 p-1 shadow-(--shadow-3)"
						>
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
							<DropdownMenuItem onSelect={() => editor.chain().focus().toggleCallout().run()}>
								{t('docs.slash.callout')}
							</DropdownMenuItem>
							<DropdownMenuItem onSelect={() => editor.chain().focus().toggleCodeBlock().run()}>
								{t('docs.slash.code')}
							</DropdownMenuItem>
						</DropdownMenuContent>
					</DropdownMenu>

					<Separator orientation="vertical" className="mx-0.5 h-4" />

					<Button
						type="button"
						size="icon"
						tone={editor.isActive('bold') ? 'secondary' : 'ghost'}
						aria-label={t('docs.toolbar.bold')}
						aria-pressed={editor.isActive('bold')}
						onMouseDown={(ev) => ev.preventDefault()}
						onClick={() => editor.chain().focus().toggleBold().run()}
						className="size-7"
					>
						<Bold className="size-3.5" aria-hidden />
					</Button>
					<Button
						type="button"
						size="icon"
						tone={editor.isActive('italic') ? 'secondary' : 'ghost'}
						aria-label={t('docs.toolbar.italic')}
						aria-pressed={editor.isActive('italic')}
						onMouseDown={(ev) => ev.preventDefault()}
						onClick={() => editor.chain().focus().toggleItalic().run()}
						className="size-7"
					>
						<Italic className="size-3.5" aria-hidden />
					</Button>
					<Button
						type="button"
						size="icon"
						tone={editor.isActive('underline') ? 'secondary' : 'ghost'}
						aria-label={t('docs.toolbar.underline')}
						aria-pressed={editor.isActive('underline')}
						onMouseDown={(ev) => ev.preventDefault()}
						onClick={() => editor.chain().focus().toggleUnderline().run()}
						className="size-7"
					>
						<Underline className="size-3.5" aria-hidden />
					</Button>
					<Button
						type="button"
						size="icon"
						tone={editor.isActive('strike') ? 'secondary' : 'ghost'}
						aria-label={t('docs.toolbar.strike')}
						aria-pressed={editor.isActive('strike')}
						onMouseDown={(ev) => ev.preventDefault()}
						onClick={() => editor.chain().focus().toggleStrike().run()}
						className="size-7"
					>
						<Strikethrough className="size-3.5" aria-hidden />
					</Button>
					<Button
						type="button"
						size="icon"
						tone={editor.isActive('code') ? 'secondary' : 'ghost'}
						aria-label={t('docs.toolbar.code')}
						aria-pressed={editor.isActive('code')}
						onMouseDown={(ev) => ev.preventDefault()}
						onClick={() => editor.chain().focus().toggleCode().run()}
						className="size-7"
					>
						<Code className="size-3.5" aria-hidden />
					</Button>

					<Popover open={linkOpen} onOpenChange={handleLinkOpenChange}>
						<PopoverTrigger asChild>
							<Button
								type="button"
								size="icon"
								tone={editor.isActive('link') ? 'secondary' : 'ghost'}
								aria-label={t('docs.toolbar.link')}
								onMouseDown={(ev) => ev.preventDefault()}
								className="size-7"
							>
								<Link2 className="size-3.5" aria-hidden />
							</Button>
						</PopoverTrigger>
						<PopoverContent
							align="start"
							className="w-80 rounded-xl border-border/90 bg-popover/98 p-2.5 shadow-(--shadow-3) backdrop-blur-md"
							onCloseAutoFocus={(ev) => {
								if (linkApplied.current) {
									ev.preventDefault()
									linkApplied.current = false
								}
							}}
						>
							<div className="flex items-center gap-1.5">
								<Input
									aria-label={t('docs.toolbar.link')}
									value={linkUrl}
									onChange={(ev) => {
										setLinkUrl(ev.target.value)
										setLinkError(false)
									}}
									onKeyDown={(ev) => {
										if (ev.key === 'Enter') {
											ev.preventDefault()
											applyLink()
										}
									}}
									placeholder="https://…"
									className="h-7 flex-1 text-xs"
								/>
								<Button type="button" size="sm" onClick={applyLink} className="h-7 px-2 text-xs">
									{t('common.save')}
								</Button>
							</div>
							{linkError ? (
								<p role="alert" className="mt-1.5 text-xs text-destructive">
									{t('docs.toolbar.link-invalid')}
								</p>
							) : null}
						</PopoverContent>
					</Popover>

					<Popover open={colorOpen} onOpenChange={setColorOpen}>
						<PopoverTrigger asChild>
							<Button
								type="button"
								size="sm"
								tone="ghost"
								aria-label={t('docs.toolbar.color')}
								onMouseDown={(ev) => ev.preventDefault()}
								className="h-7 gap-0.5 px-1.5"
							>
								<Palette className="size-3.5" aria-hidden />
								<ChevronDown className="size-3 text-muted-foreground" aria-hidden />
							</Button>
						</PopoverTrigger>
						<PopoverContent
							align="start"
							className="w-60 space-y-2.5 rounded-xl border-border/90 bg-popover/98 p-2.5 shadow-(--shadow-3) backdrop-blur-md"
						>
							<div className="space-y-1.5">
								<span className="text-[11px] font-medium text-muted-foreground">
									{t('docs.toolbar.text-color')}
								</span>
								<div className="flex flex-wrap gap-1">
									{SEMANTIC_TONES.map((tone) => (
										<button
											key={`text-${tone}`}
											type="button"
											aria-label={`${t('docs.toolbar.text-color')}: ${TONE_LABELS[tone]()}`}
											onClick={() => {
												editor.chain().focus().setBlockTextTone(tone).run()
												setColorOpen(false)
											}}
											className={cn(
												'flex size-6 items-center justify-center rounded-md border bg-background text-xs font-semibold transition-transform hover:scale-105',
												TEXT_SWATCH_CLASS[tone]
											)}
										>
											A
										</button>
									))}
								</div>
							</div>
							<div className="space-y-1.5">
								<span className="text-[11px] font-medium text-muted-foreground">
									{t('docs.toolbar.bg-color')}
								</span>
								<div className="flex flex-wrap gap-1">
									{SEMANTIC_TONES.map((tone) => (
										<button
											key={`bg-${tone}`}
											type="button"
											aria-label={`${t('docs.toolbar.bg-color')}: ${TONE_LABELS[tone]()}`}
											onClick={() => {
												editor.chain().focus().setBlockBgTone(tone).run()
												setColorOpen(false)
											}}
											className={cn(
												'size-6 rounded-md border transition-transform hover:scale-105',
												BG_SWATCH_CLASS[tone]
											)}
										/>
									))}
								</div>
							</div>
						</PopoverContent>
					</Popover>
				</>
			) : null}

			{canComment ? (
				<>
					{showWriteControls ? <Separator orientation="vertical" className="mx-0.5 h-4" /> : null}
					<Button
						type="button"
						size="sm"
						tone="ghost"
						onMouseDown={(ev) => ev.preventDefault()}
						onClick={onAddComment}
						className="h-7 gap-1 px-2 text-xs"
					>
						<MessageSquarePlus className="size-3.5" aria-hidden />
						<span>{t('docs.toolbar.comment')}</span>
					</Button>
				</>
			) : null}
		</div>
	)
}
