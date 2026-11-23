import type { ChatMessageDto } from '@huriro/contracts'
import { t } from '@huriro/i18n'
import { Download, FileIcon, MessageSquareReply, Pencil, ShieldAlert, Smile, Trash2 } from 'lucide-react'
import { useState } from 'react'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover'
import { Textarea } from '@/components/ui/textarea'
import { navigateToDoc } from '@/lib/navigation'
import { useUiStore } from '@/stores/ui-store'

const QUICK_REACTIONS = ['👍', '🎉', '❤️', '👀', '🚀'] as const

export interface MessageItemProps {
	readonly message: ChatMessageDto
	readonly currentUserId: string
	readonly isThreadView?: boolean | undefined
	readonly highlighted?: boolean | undefined
	readonly onReply?: ((messageId: string) => void) | undefined
	readonly onEdit: (messageId: string, bodyText: string, version: number) => Promise<void>
	readonly onDelete: (messageId: string) => Promise<void>
	readonly onToggleReaction: (messageId: string, emoji: string, currentlyReacted: boolean) => Promise<void>
}

export function MessageItem({
	message,
	currentUserId,
	isThreadView,
	highlighted,
	onReply,
	onEdit,
	onDelete,
	onToggleReaction
}: MessageItemProps) {
	const setDestination = useUiStore((s) => s.setDestination)
	const selectIssue = useUiStore((s) => s.selectIssue)
	const [editing, setEditing] = useState(false)
	const [draft, setDraft] = useState(message.bodyText)
	const [busy, setBusy] = useState(false)
	const [reactionOpen, setReactionOpen] = useState(false)

	const isMine = message.authorId === currentUserId

	async function handleSaveEdit(ev: React.FormEvent) {
		ev.preventDefault()
		const trimmed = draft.trim()
		if (!trimmed || busy) return
		setBusy(true)
		try {
			await onEdit(message.id, trimmed, message.version)
			setEditing(false)
		} finally {
			setBusy(false)
		}
	}

	if (message.deletedAt !== null) {
		return (
			<div className="rounded-md px-3 py-2 text-xs italic text-muted-foreground">
				{t('chat.message.deleted')}
			</div>
		)
	}

	const timeLabel = new Date(message.createdAt).toLocaleTimeString([], {
		hour: '2-digit',
		minute: '2-digit'
	})

	return (
		<article
			id={`msg-${message.id}`}
			className={`group rounded-lg px-3 py-2 transition-colors hover:bg-muted/40 ${
				highlighted ? 'bg-accent/50 ring-1 ring-primary/40' : ''
			}`}
		>
			<div className="flex items-start justify-between gap-2">
				<div className="flex items-baseline gap-2">
					<span className="text-sm font-semibold text-foreground">
						{message.authorDisplayName ?? message.authorId.slice(0, 8)}
					</span>
					<span className="text-xs text-muted-foreground tnum">{timeLabel}</span>
					{message.editedAt ? (
						<span className="text-xs text-muted-foreground">{t('chat.message.edited')}</span>
					) : null}
				</div>

				<div className="flex items-center gap-0.5 opacity-80 transition-opacity group-hover:opacity-100">
					<Popover open={reactionOpen} onOpenChange={setReactionOpen}>
						<PopoverTrigger asChild>
							<Button
								size="icon"
								tone="ghost"
								type="button"
								className="size-7"
								aria-label={t('chat.message.react')}
							>
								<Smile className="size-3.5" aria-hidden />
							</Button>
						</PopoverTrigger>
						<PopoverContent className="flex w-auto gap-1 p-1.5">
							{QUICK_REACTIONS.map((emoji) => {
								const existing = message.reactions.find((r) => r.emoji === emoji)
								return (
									<button
										key={emoji}
										type="button"
										onClick={() => {
											setReactionOpen(false)
											void onToggleReaction(message.id, emoji, existing?.reactedByMe ?? false)
										}}
										className="rounded px-1.5 py-1 text-sm hover:bg-accent"
									>
										{emoji}
									</button>
								)
							})}
						</PopoverContent>
					</Popover>

					{!isThreadView && onReply ? (
						<Button
							size="icon"
							tone="ghost"
							type="button"
							className="size-7"
							aria-label={t('chat.message.reply')}
							onClick={() => onReply(message.id)}
						>
							<MessageSquareReply className="size-3.5" aria-hidden />
						</Button>
					) : null}

					{isMine ? (
						<>
							<Button
								size="icon"
								tone="ghost"
								type="button"
								className="size-7"
								aria-label={t('chat.message.edit')}
								onClick={() => {
									setDraft(message.bodyText)
									setEditing(true)
								}}
							>
								<Pencil className="size-3.5" aria-hidden />
							</Button>
							<Button
								size="icon"
								tone="ghost"
								type="button"
								className="size-7"
								aria-label={t('chat.message.delete')}
								onClick={() => void onDelete(message.id)}
							>
								<Trash2 className="size-3.5 text-destructive" aria-hidden />
							</Button>
						</>
					) : null}
				</div>
			</div>

			{editing ? (
				<form onSubmit={(ev) => void handleSaveEdit(ev)} className="mt-1.5 space-y-1.5">
					<Textarea
						value={draft}
						onChange={(ev) => setDraft(ev.target.value)}
						rows={2}
						aria-label={t('chat.message.edit')}
					/>
					<div className="flex justify-end gap-1.5">
						<Button size="sm" tone="outline" type="button" onClick={() => setEditing(false)}>
							{t('common.cancel')}
						</Button>
						<Button size="sm" type="submit" loading={busy}>
							{t('chat.message.save')}
						</Button>
					</div>
				</form>
			) : (
				<p className="mt-1 whitespace-pre-wrap text-sm leading-relaxed text-foreground">{message.bodyText}</p>
			)}

			{message.richLinks.length > 0 ? (
				<div className="mt-2 flex flex-wrap gap-1.5">
					{message.richLinks.map((rl) => (
						<button
							key={`${rl.kind}:${rl.ref}`}
							type="button"
							onClick={() => {
								if (rl.kind === 'issue' && rl.entityId) {
									setDestination('tasks')
									selectIssue(rl.entityId, true)
								} else if (rl.kind === 'doc_page') {
									navigateToDoc(rl.ref)
								}
							}}
							className="inline-flex items-center gap-1.5 rounded-md border border-border bg-card px-2 py-1 text-xs hover:bg-accent"
						>
							<Badge tone="secondary">{rl.ref}</Badge>
							<span className="max-w-48 truncate font-medium text-foreground">{rl.title}</span>
						</button>
					))}
				</div>
			) : null}

			{message.attachments.length > 0 ? (
				<div className="mt-2 flex flex-wrap gap-2">
					{message.attachments.map((att) => (
						<div
							key={att.fileId}
							className="flex items-center gap-2 rounded-md border border-border bg-card px-2.5 py-1.5 text-xs"
						>
							<FileIcon className="size-3.5 text-muted-foreground" aria-hidden />
							<span className="max-w-44 truncate font-medium">{att.filename}</span>
							{att.scanStatus === 'clean' || att.scanStatus === 'unscanned' ? (
								<a
									href={att.downloadUrl}
									download={att.filename}
									className="inline-flex items-center gap-1 text-primary hover:underline"
								>
									<Download className="size-3" aria-hidden />
									<span>{t('chat.message.attachment-download')}</span>
								</a>
							) : att.scanStatus === 'pending' ? (
								<Badge tone="secondary">{t('chat.message.attachment-pending')}</Badge>
							) : (
								<Badge tone="danger">{t('chat.message.attachment-infected')}</Badge>
							)}
						</div>
					))}
				</div>
			) : null}

			{message.linkPreviews.length > 0 ? (
				<div className="mt-2 space-y-1.5">
					{message.linkPreviews.map((lp) =>
						lp.status === 'blocked' ? (
							<div
								key={lp.id}
								className="flex items-center gap-1.5 rounded-md border border-border bg-muted/30 px-2.5 py-1.5 text-xs text-muted-foreground"
							>
								<ShieldAlert className="size-3.5 shrink-0 text-(--warning)" aria-hidden />
								<span>{t('chat.message.preview-blocked')}</span>
							</div>
						) : lp.status === 'ok' ? (
							<a
								key={lp.id}
								href={lp.canonicalUrl ?? lp.url}
								target="_blank"
								rel="noopener noreferrer"
								className="block max-w-md rounded-md border border-border bg-card p-2.5 text-xs hover:bg-accent/30"
							>
								{lp.siteName ? (
									<p className="text-[11px] font-medium uppercase tracking-wide text-muted-foreground">
										{lp.siteName}
									</p>
								) : null}
								<p className="mt-0.5 font-semibold text-foreground">{lp.title || lp.url}</p>
								{lp.description ? (
									<p className="mt-0.5 line-clamp-2 text-muted-foreground">{lp.description}</p>
								) : null}
							</a>
						) : null
					)}
				</div>
			) : null}

			{message.reactions.length > 0 || (!isThreadView && message.replyCount > 0) ? (
				<div className="mt-2 flex flex-wrap items-center gap-1.5">
					{message.reactions.map((rx) => (
						<button
							key={rx.emoji}
							type="button"
							onClick={() => void onToggleReaction(message.id, rx.emoji, rx.reactedByMe)}
							className={`inline-flex items-center gap-1 rounded-full border px-2 py-0.5 text-xs tnum ${
								rx.reactedByMe
									? 'border-primary/50 bg-primary/10 text-foreground'
									: 'border-border bg-card text-muted-foreground hover:bg-accent'
							}`}
						>
							<span>{rx.emoji}</span>
							<span>{rx.count}</span>
						</button>
					))}

					{!isThreadView && message.replyCount > 0 && onReply ? (
						<button
							type="button"
							onClick={() => onReply(message.id)}
							className="inline-flex items-center gap-1 rounded-md px-2 py-0.5 text-xs font-medium text-primary hover:bg-accent"
						>
							<MessageSquareReply className="size-3" aria-hidden />
							<span>{t('chat.message.replies-count', { count: message.replyCount })}</span>
						</button>
					) : null}
				</div>
			) : null}
		</article>
	)
}
