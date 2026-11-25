import { isSafeUrl } from '@huriro/editor'
import { t } from '@huriro/i18n'
import type { Editor } from '@tiptap/react'
import { Check, Copy, ExternalLink, Pencil, Unlink } from 'lucide-react'
import { useEffect, useRef, useState } from 'react'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'

export interface LinkPreviewCardProps {
	readonly editor: Editor | null
}

interface LinkTarget {
	readonly href: string
	readonly rect: { readonly left: number; readonly top: number; readonly bottom: number }
}

const CARD_ESTIMATED_HEIGHT = 44
const CARD_MAX_WIDTH = 330

/**
 * Notion-style link preview: clicking a link inside the editor floats a card
 * under it with open/copy/edit/unlink actions. `openOnClick` stays off in the
 * schema — navigating away on every click would be hostile while editing —
 * so this card is the only way links open, for writers and readers alike.
 *
 * The card is transient: it closes on outside click, Escape, scroll, or any
 * editor selection/content change. That transience is what makes edit/unlink
 * safe with plain extendMarkRange — the cursor cannot leave the link while
 * the card is open, because moving it would have closed the card.
 */
export function LinkPreviewCard({ editor }: LinkPreviewCardProps) {
	const [target, setTarget] = useState<LinkTarget | null>(null)
	const [editing, setEditing] = useState(false)
	const [draft, setDraft] = useState('')
	const [invalid, setInvalid] = useState(false)
	const [copied, setCopied] = useState(false)
	const cardRef = useRef<HTMLDivElement>(null)

	// Open the card when an anchor inside the editor is clicked.
	useEffect(() => {
		if (!editor) return
		const dom = editor.view.dom
		function handleClick(ev: MouseEvent) {
			const anchor = (ev.target as HTMLElement).closest('a')
			if (!anchor || !dom.contains(anchor)) return
			// In read-only mode anchors would otherwise navigate the tab away.
			ev.preventDefault()
			const href = anchor.getAttribute('href')
			if (!href) return
			const rect = anchor.getBoundingClientRect()
			setEditing(false)
			setInvalid(false)
			setCopied(false)
			setDraft(href)
			setTarget({ href, rect: { left: rect.left, top: rect.top, bottom: rect.bottom } })
		}
		dom.addEventListener('click', handleClick)
		return () => dom.removeEventListener('click', handleClick)
	}, [editor])

	const close = () => setTarget(null)

	// Dismissal: outside click, Escape, scroll, and any editor selection or
	// content change (collaborative edits included) close the transient card.
	useEffect(() => {
		if (!target || !editor) return
		const dismiss = () => setTarget(null)
		function onPointerDown(ev: PointerEvent) {
			if (!cardRef.current?.contains(ev.target as Node)) dismiss()
		}
		function onKeyDown(ev: KeyboardEvent) {
			if (ev.key === 'Escape') dismiss()
		}
		document.addEventListener('pointerdown', onPointerDown, true)
		document.addEventListener('keydown', onKeyDown)
		window.addEventListener('scroll', dismiss, true)
		editor.on('selectionUpdate', dismiss)
		editor.on('update', dismiss)
		return () => {
			document.removeEventListener('pointerdown', onPointerDown, true)
			document.removeEventListener('keydown', onKeyDown)
			window.removeEventListener('scroll', dismiss, true)
			editor.off('selectionUpdate', dismiss)
			editor.off('update', dismiss)
		}
	}, [target, editor])

	if (!editor || !target) return null

	// Captured once per open card — the hoisted handlers below can't narrow state.
	const href = target.href

	const viewportWidth = typeof window === 'undefined' ? 1024 : window.innerWidth
	const viewportHeight = typeof window === 'undefined' ? 768 : window.innerHeight
	const left = Math.max(8, Math.min(target.rect.left, viewportWidth - CARD_MAX_WIDTH - 8))
	const flipAbove = target.rect.bottom + CARD_ESTIMATED_HEIGHT + 8 > viewportHeight
	const top = flipAbove ? target.rect.top - CARD_ESTIMATED_HEIGHT - 4 : target.rect.bottom + 4

	function applyEdit() {
		const trimmed = draft.trim()
		if (!trimmed || !isSafeUrl(trimmed)) {
			setInvalid(true)
			return
		}
		// The cursor is guaranteed to sit inside the link: moving it would have
		// fired selectionUpdate and closed this card.
		editor?.chain().focus().extendMarkRange('link').setLink({ href: trimmed }).run()
		close()
	}

	function removeLink() {
		editor?.chain().focus().extendMarkRange('link').unsetLink().run()
		close()
	}

	async function copyLink() {
		try {
			await navigator.clipboard.writeText(href)
			setCopied(true)
		} catch {
			// Clipboard access can be denied (insecure context, permissions) — the
			// href stays visible in the card for manual copying either way.
		}
	}

	return (
		<div
			ref={cardRef}
			role="dialog"
			aria-label={t('docs.link.preview')}
			style={{ position: 'fixed', left, top }}
			className="z-(--z-popover) rounded-md border border-border bg-popover px-2 py-1.5 shadow-(--shadow-2)"
		>
			{editing ? (
				<div className="w-72">
					<div className="flex items-center gap-1.5">
						<Input
							aria-label={t('docs.toolbar.link')}
							value={draft}
							autoFocus
							onChange={(ev) => {
								setDraft(ev.target.value)
								setInvalid(false)
							}}
							onKeyDown={(ev) => {
								if (ev.key === 'Enter') {
									ev.preventDefault()
									applyEdit()
								}
							}}
							placeholder="https://…"
							className="h-7 flex-1 text-xs"
						/>
						<Button type="button" size="sm" onClick={applyEdit} className="h-7 px-2 text-xs">
							{t('common.save')}
						</Button>
					</div>
					{invalid ? (
						<p role="alert" className="mt-1.5 text-xs text-destructive">
							{t('docs.toolbar.link-invalid')}
						</p>
					) : null}
				</div>
			) : (
				<div className="flex items-center gap-0.5">
					<span className="max-w-44 truncate px-1 text-xs text-muted-foreground">{href}</span>
					<Button
						type="button"
						size="icon"
						tone="ghost"
						aria-label={t('docs.link.open')}
						onClick={() => window.open(href, '_blank', 'noopener,noreferrer')}
						className="size-7"
					>
						<ExternalLink className="size-3.5" aria-hidden />
					</Button>
					<Button
						type="button"
						size="icon"
						tone="ghost"
						aria-label={copied ? t('docs.link.copied') : t('docs.link.copy')}
						onClick={() => void copyLink()}
						className="size-7"
					>
						{copied ? (
							<Check className="size-3.5 text-(--success)" aria-hidden />
						) : (
							<Copy className="size-3.5" aria-hidden />
						)}
					</Button>
					{editor.isEditable ? (
						<>
							<Button
								type="button"
								size="icon"
								tone="ghost"
								aria-label={t('docs.link.edit')}
								onClick={() => setEditing(true)}
								className="size-7"
							>
								<Pencil className="size-3.5" aria-hidden />
							</Button>
							<Button
								type="button"
								size="icon"
								tone="ghost"
								aria-label={t('docs.link.remove')}
								onClick={removeLink}
								className="size-7"
							>
								<Unlink className="size-3.5" aria-hidden />
							</Button>
						</>
					) : null}
				</div>
			)}
		</div>
	)
}
