import { isSafeUrl } from '@huriro/editor'
import { t } from '@huriro/i18n'
import type { Editor } from '@tiptap/react'
import { Bold, Code, Italic, Link2, MessageSquarePlus, Strikethrough } from 'lucide-react'
import { useRef, useState } from 'react'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover'
import { Separator } from '@/components/ui/separator'
import { getSlashItems } from './slash-items'

export interface FloatingToolbarProps {
	readonly editor: Editor | null
	readonly canWrite: boolean
	readonly canComment: boolean
	readonly onAddComment: () => void
}

export function FloatingToolbar({ editor, canWrite, canComment, onAddComment }: FloatingToolbarProps) {
	const [linkOpen, setLinkOpen] = useState(false)
	const [linkUrl, setLinkUrl] = useState('')
	const [linkError, setLinkError] = useState(false)
	// Set when a link was just applied — close-autofocus must not yank focus
	// back to the trigger, because applyLink already returned it to the editor.
	const linkApplied = useRef(false)

	if (!editor) return null

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
		// as visible linked text instead, matching Google Docs/Notion behavior.
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
			// Selected text gets linked in place; a cursor inside an existing link
			// updates that whole link via extendMarkRange.
			editor?.chain().focus().extendMarkRange('link').setLink({ href: trimmed }).run()
		}
		setLinkError(false)
		linkApplied.current = true
		setLinkOpen(false)
		setLinkUrl('')
	}

	return (
		<div
			role="toolbar"
			aria-label={t('docs.toolbar.label')}
			className="flex flex-wrap items-center gap-1 rounded-md border border-border bg-card px-2 py-1 shadow-(--shadow-1)"
		>
			{canWrite ? (
				<>
					<Button
						type="button"
						size="icon"
						tone={editor.isActive('bold') ? 'secondary' : 'ghost'}
						aria-label={t('docs.toolbar.bold')}
						aria-pressed={editor.isActive('bold')}
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
						onClick={() => editor.chain().focus().toggleItalic().run()}
						className="size-7"
					>
						<Italic className="size-3.5" aria-hidden />
					</Button>
					<Button
						type="button"
						size="icon"
						tone={editor.isActive('strike') ? 'secondary' : 'ghost'}
						aria-label={t('docs.toolbar.strike')}
						aria-pressed={editor.isActive('strike')}
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
								className="size-7"
							>
								<Link2 className="size-3.5" aria-hidden />
							</Button>
						</PopoverTrigger>
						<PopoverContent
							align="start"
							className="w-80 p-2"
							onCloseAutoFocus={(ev) => {
								// Applying a link already restored editor focus; only let Radix
								// return focus to the trigger when the popover was dismissed.
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
					<Separator orientation="vertical" className="mx-0.5 h-4" />
					{/* Block tools mirror the "/" menu one-for-one so nothing hides behind a
					    popover. Toggle-type blocks expose aria-pressed; pure inserts don't. */}
					{getSlashItems().map((item) => {
						const Icon = item.icon
						const active = item.isActive?.(editor) ?? false
						return (
							<Button
								key={item.id}
								type="button"
								size="icon"
								tone={active ? 'secondary' : 'ghost'}
								aria-label={item.label}
								aria-pressed={item.isActive ? active : undefined}
								onClick={() => item.apply(editor)}
								className="size-7"
							>
								<Icon className="size-3.5" aria-hidden />
							</Button>
						)
					})}
				</>
			) : null}

			{canComment ? (
				<Button
					type="button"
					size="sm"
					tone="ghost"
					onClick={onAddComment}
					className="h-7 gap-1 px-2 text-xs"
				>
					<MessageSquarePlus className="size-3.5" aria-hidden />
					<span>{t('docs.toolbar.comment')}</span>
				</Button>
			) : null}
		</div>
	)
}
