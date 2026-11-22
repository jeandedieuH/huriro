import { isSafeUrl } from '@huriro/editor'
import { t } from '@huriro/i18n'
import type { Editor } from '@tiptap/react'
import { Bold, Code, Italic, Link2, MessageSquarePlus, Strikethrough } from 'lucide-react'
import { useState } from 'react'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'

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

	if (!editor) return null

	function applyLink() {
		const trimmed = linkUrl.trim()
		if (!trimmed) {
			editor?.chain().focus().unsetLink().run()
			setLinkOpen(false)
			return
		}
		if (!isSafeUrl(trimmed)) {
			setLinkError(true)
			return
		}
		editor?.chain().focus().extendMarkRange('link').setLink({ href: trimmed }).run()
		setLinkError(false)
		setLinkOpen(false)
		setLinkUrl('')
	}

	return (
		<div
			role="toolbar"
			aria-label={t('docs.toolbar.bold')}
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
					<Button
						type="button"
						size="icon"
						tone={editor.isActive('link') ? 'secondary' : 'ghost'}
						aria-label={t('docs.toolbar.link')}
						onClick={() => {
							setLinkOpen((v) => !v)
							setLinkError(false)
						}}
						className="size-7"
					>
						<Link2 className="size-3.5" aria-hidden />
					</Button>
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

			{linkOpen ? (
				<div className="flex items-center gap-1.5 pl-2">
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
						className="h-7 w-44 text-xs"
					/>
					<Button type="button" size="sm" onClick={applyLink} className="h-7 px-2 text-xs">
						{t('common.save')}
					</Button>
					{linkError ? (
						<span role="alert" className="text-xs text-destructive">
							Unsafe URL
						</span>
					) : null}
				</div>
			) : null}
		</div>
	)
}
