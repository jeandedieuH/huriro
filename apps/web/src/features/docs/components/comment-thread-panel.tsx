import type { DocCommentDto } from '@huriro/contracts'
import { t } from '@huriro/i18n'
import { CheckCircle2, RotateCcw, Trash2 } from 'lucide-react'
import { useMemo, useState } from 'react'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Textarea } from '@/components/ui/textarea'
import type { WorkspaceMemberSummary } from '@/lib/sync-bootstrap'

export interface CommentThreadPanelProps {
	readonly comments: readonly DocCommentDto[]
	readonly membersById: ReadonlyMap<string, WorkspaceMemberSummary>
	readonly currentUserId: string
	readonly activeDraftQuote?: string | null
	readonly onCreateComment: (bodyText: string, parentId?: string | null) => Promise<void>
	readonly onResolveComment: (commentId: string, resolved: boolean) => Promise<void>
	readonly onDeleteComment: (commentId: string) => Promise<void>
}

export function CommentThreadPanel({
	comments,
	membersById,
	currentUserId,
	activeDraftQuote,
	onCreateComment,
	onResolveComment,
	onDeleteComment
}: CommentThreadPanelProps) {
	const [draft, setDraft] = useState('')
	const [replyDrafts, setReplyDrafts] = useState<Record<string, string>>({})
	const [busy, setBusy] = useState(false)

	const roots = useMemo(() => comments.filter((c) => c.parentId === null && c.deletedAt === null), [comments])
	const repliesByParent = useMemo(() => {
		const map = new Map<string, DocCommentDto[]>()
		for (const c of comments) {
			if (!c.parentId || c.deletedAt !== null) continue
			const list = map.get(c.parentId) ?? []
			list.push(c)
			map.set(c.parentId, list)
		}
		return map
	}, [comments])

	async function submitNew() {
		const text = draft.trim()
		if (!text || busy) return
		setBusy(true)
		try {
			await onCreateComment(text, null)
			setDraft('')
		} finally {
			setBusy(false)
		}
	}

	async function submitReply(parentId: string) {
		const text = (replyDrafts[parentId] ?? '').trim()
		if (!text || busy) return
		setBusy(true)
		try {
			await onCreateComment(text, parentId)
			setReplyDrafts((prev) => ({ ...prev, [parentId]: '' }))
		} finally {
			setBusy(false)
		}
	}

	return (
		<div className="flex h-full flex-col gap-3 p-3">
			<div className="space-y-2 rounded-md border border-border bg-muted/30 p-2.5">
				{activeDraftQuote ? (
					<blockquote className="border-l-2 border-(--warning) pl-2 text-xs italic text-muted-foreground">
						“{activeDraftQuote.slice(0, 140)}”
					</blockquote>
				) : null}
				<Textarea
					aria-label={t('docs.comments.placeholder')}
					value={draft}
					onChange={(ev) => setDraft(ev.target.value)}
					placeholder={t('docs.comments.placeholder')}
					rows={2}
					className="text-xs"
				/>
				<div className="flex justify-end">
					<Button type="button" size="sm" disabled={!draft.trim() || busy} onClick={() => void submitNew()}>
						{t('docs.comments.submit')}
					</Button>
				</div>
			</div>

			<div className="min-h-0 flex-1 space-y-3 overflow-y-auto">
				{roots.length === 0 ? (
					<p className="py-6 text-center text-xs text-muted-foreground">{t('docs.comments.empty')}</p>
				) : (
					roots.map((thread) => {
						const author = membersById.get(thread.authorId)?.displayName ?? 'Member'
						const replies = repliesByParent.get(thread.id) ?? []
						const isResolved = thread.resolvedAt !== null
						return (
							<article
								key={thread.id}
								className="space-y-2 rounded-md border border-border bg-card p-2.5 text-xs"
							>
								<div className="flex flex-wrap items-center justify-between gap-1">
									<span className="font-medium text-foreground">{author}</span>
									<div className="flex items-center gap-1">
										{thread.anchorOrphaned ? (
											<Badge tone="warning">{t('docs.comments.orphaned-badge')}</Badge>
										) : null}
										{isResolved ? <Badge tone="success">{t('docs.comments.resolved-badge')}</Badge> : null}
									</div>
								</div>

								{thread.anchorQuote ? (
									<blockquote className="border-l-2 border-border pl-2 text-muted-foreground">
										{thread.anchorQuote}
									</blockquote>
								) : null}

								<p className="whitespace-pre-wrap text-foreground">{thread.bodyText}</p>

								<div className="flex items-center gap-1">
									<Button
										type="button"
										size="sm"
										tone="ghost"
										onClick={() => void onResolveComment(thread.id, !isResolved)}
										className="h-6 gap-1 px-1.5 text-xs"
									>
										{isResolved ? (
											<>
												<RotateCcw className="size-3" aria-hidden />
												<span>{t('docs.comments.reopen')}</span>
											</>
										) : (
											<>
												<CheckCircle2 className="size-3" aria-hidden />
												<span>{t('docs.comments.resolve')}</span>
											</>
										)}
									</Button>
									{thread.authorId === currentUserId ? (
										<Button
											type="button"
											size="icon"
											tone="ghost"
											aria-label={t('docs.comments.delete')}
											onClick={() => void onDeleteComment(thread.id)}
											className="size-6 text-muted-foreground hover:text-destructive"
										>
											<Trash2 className="size-3" aria-hidden />
										</Button>
									) : null}
								</div>

								{replies.length > 0 ? (
									<ul className="space-y-1.5 border-t border-border pt-2">
										{replies.map((r) => (
											<li key={r.id} className="space-y-0.5 pl-2">
												<span className="font-medium text-foreground">
													{membersById.get(r.authorId)?.displayName ?? 'Member'}
												</span>
												<p className="text-muted-foreground">{r.bodyText}</p>
											</li>
										))}
									</ul>
								) : null}

								<div className="flex items-center gap-1.5 pt-1">
									<Textarea
										aria-label={t('docs.comments.reply-placeholder')}
										rows={1}
										value={replyDrafts[thread.id] ?? ''}
										onChange={(ev) => setReplyDrafts((prev) => ({ ...prev, [thread.id]: ev.target.value }))}
										placeholder={t('docs.comments.reply-placeholder')}
										className="min-h-7 text-xs"
									/>
									<Button
										type="button"
										size="sm"
										tone="outline"
										disabled={!(replyDrafts[thread.id] ?? '').trim() || busy}
										onClick={() => void submitReply(thread.id)}
										className="h-7 px-2 text-xs"
									>
										{t('docs.comments.submit')}
									</Button>
								</div>
							</article>
						)
					})
				)}
			</div>
		</div>
	)
}
