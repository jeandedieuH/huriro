import type { ChatBookmarkBody, ChatChannelBookmarkDto } from '@huriro/contracts'
import { t } from '@huriro/i18n'
import { Bookmark, ExternalLink, Plus, X } from 'lucide-react'
import { useState } from 'react'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover'
import { navigateToChat, navigateToDestination, navigateToDoc, navigateToMail } from '@/lib/navigation'

export interface ChannelBookmarksBarProps {
	readonly bookmarks: readonly ChatChannelBookmarkDto[]
	readonly onAddBookmark: (body: ChatBookmarkBody) => Promise<void> | void
	readonly onRemoveBookmark: (bookmarkId: string) => Promise<void> | void
}

function isSafeBookmarkUrl(raw: string): boolean {
	const trimmed = raw.trim()
	return trimmed.startsWith('/') || /^https?:\/\//i.test(trimmed)
}

function inferBookmarkTargetType(url: string): ChatBookmarkBody['targetType'] {
	const trimmed = url.trim()
	if (trimmed.startsWith('/docs/')) return 'doc_page'
	if (trimmed.startsWith('/tasks')) return 'issue'
	if (trimmed.startsWith('/inbox') || trimmed.startsWith('/mail')) return 'mail_inbox'
	if (trimmed.startsWith('/')) return 'saved_view'
	return 'external_url'
}

function openBookmarkUrl(url: string) {
	const trimmed = url.trim()
	if (trimmed.startsWith('/docs/')) {
		const rest = trimmed.slice('/docs/'.length)
		const [slugPart, hashPart] = rest.split('#')
		navigateToDoc(slugPart ?? '', hashPart)
		return
	}
	if (trimmed.startsWith('/tasks')) {
		navigateToDestination('tasks')
		return
	}
	if (trimmed.startsWith('/inbox') || trimmed.startsWith('/mail')) {
		navigateToMail()
		return
	}
	if (trimmed.startsWith('/chat')) {
		const parts = trimmed.split('/').filter(Boolean)
		navigateToChat(parts[1], parts[2])
	}
}

/** Persistent bookmark strip directly below the active channel header. */
export function ChannelBookmarksBar({
	bookmarks,
	onAddBookmark,
	onRemoveBookmark
}: ChannelBookmarksBarProps) {
	const [open, setOpen] = useState(false)
	const [title, setTitle] = useState('')
	const [url, setUrl] = useState('')
	const [busy, setBusy] = useState(false)

	async function handleSubmit(ev: React.FormEvent) {
		ev.preventDefault()
		const cleanTitle = title.trim()
		const cleanUrl = url.trim()
		if (!cleanTitle || !cleanUrl || !isSafeBookmarkUrl(cleanUrl) || busy) return
		setBusy(true)
		try {
			await onAddBookmark({
				targetType: inferBookmarkTargetType(cleanUrl),
				title: cleanTitle,
				url: cleanUrl
			})
			setTitle('')
			setUrl('')
			setOpen(false)
		} finally {
			setBusy(false)
		}
	}

	return (
		<nav
			aria-label={t('chat.bookmarks.title')}
			className="flex flex-wrap items-center gap-1.5 border-b border-border bg-muted/20 px-4 py-1.5 text-xs"
		>
			{bookmarks.length === 0 ? (
				<span className="text-muted-foreground">{t('chat.bookmarks.empty')}</span>
			) : (
				bookmarks.map((bm) => {
					const rawUrl = bm.url?.trim() ?? ''
					const safe = rawUrl.length > 0 && isSafeBookmarkUrl(rawUrl)
					const isExternal = safe && /^https?:\/\//i.test(rawUrl)

					return (
						<div
							key={bm.id}
							className="inline-flex items-center gap-1 rounded-full border border-border bg-card px-2.5 py-0.5 text-xs text-foreground"
						>
							<Bookmark className="size-3 shrink-0 text-primary" aria-hidden />
							{isExternal ? (
								<a
									href={rawUrl}
									target="_blank"
									rel="noopener noreferrer"
									className="inline-flex items-center gap-1 font-medium hover:underline"
								>
									<span className="max-w-40 truncate">{bm.title}</span>
									<ExternalLink className="size-2.5 text-muted-foreground" aria-hidden />
								</a>
							) : safe ? (
								<button
									type="button"
									onClick={() => openBookmarkUrl(rawUrl)}
									className="max-w-40 truncate font-medium hover:underline"
								>
									{bm.title}
								</button>
							) : (
								<span className="max-w-40 truncate font-medium">{bm.title}</span>
							)}
							<button
								type="button"
								aria-label={t('chat.bookmarks.remove')}
								onClick={() => void onRemoveBookmark(bm.id)}
								className="rounded-full p-0.5 text-muted-foreground hover:text-destructive"
							>
								<X className="size-2.5" aria-hidden />
							</button>
						</div>
					)
				})
			)}

			<Popover open={open} onOpenChange={setOpen}>
				<PopoverTrigger asChild>
					<Button size="sm" tone="ghost" type="button" className="h-6 px-2 text-xs">
						<Plus className="size-3" aria-hidden />
						<span>{t('chat.bookmarks.add')}</span>
					</Button>
				</PopoverTrigger>
				<PopoverContent align="start" className="w-72">
					<form onSubmit={(ev) => void handleSubmit(ev)} className="space-y-2.5">
						<p className="text-xs font-semibold text-foreground">{t('chat.bookmarks.add')}</p>
						<div className="space-y-1">
							<label htmlFor="chat-bm-title" className="text-[11px] font-medium text-muted-foreground">
								{t('chat.bookmarks.title-label')}
							</label>
							<Input
								id="chat-bm-title"
								value={title}
								onChange={(ev) => setTitle(ev.target.value)}
								placeholder={t('chat.bookmarks.title-label')}
								maxLength={200}
							/>
						</div>
						<div className="space-y-1">
							<label htmlFor="chat-bm-url" className="text-[11px] font-medium text-muted-foreground">
								{t('chat.bookmarks.url-label')}
							</label>
							<Input
								id="chat-bm-url"
								value={url}
								onChange={(ev) => setUrl(ev.target.value)}
								placeholder="https://... or /docs/..."
								maxLength={2048}
							/>
						</div>
						<Button
							size="sm"
							type="submit"
							className="w-full"
							loading={busy}
							disabled={!title.trim() || !isSafeBookmarkUrl(url)}
						>
							{t('chat.bookmarks.add')}
						</Button>
					</form>
				</PopoverContent>
			</Popover>
		</nav>
	)
}
