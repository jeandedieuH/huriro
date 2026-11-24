import type {
	MailConversationEventDto,
	MailConversationStatus,
	MailIdentityDto,
	MailMessageDto,
	MailNoteDto,
	MailTimelineDto
} from '@huriro/contracts'
import { type MessageId, t } from '@huriro/i18n'
import { Clock, ExternalLink, Link2, Moon, Send, StickyNote, Undo2 } from 'lucide-react'
import { useEffect, useMemo, useState } from 'react'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select'
import { Skeleton } from '@/components/ui/skeleton'
import { Textarea } from '@/components/ui/textarea'
import type { TaskApiBridge } from '@/lib/sync-bootstrap'

/** One merged, time-ordered feed: inbound/outbound mail, internal notes, system events. */
type TimelineItem =
	| { readonly kind: 'message'; readonly at: string; readonly message: MailMessageDto }
	| { readonly kind: 'note'; readonly at: string; readonly note: MailNoteDto }
	| { readonly kind: 'event'; readonly at: string; readonly event: MailConversationEventDto }

function mergeTimeline(tl: MailTimelineDto): TimelineItem[] {
	const items: TimelineItem[] = [
		...tl.messages.map((message) => ({ kind: 'message' as const, at: message.createdAt, message })),
		...tl.notes.map((note) => ({ kind: 'note' as const, at: note.createdAt, note })),
		...tl.events.map((event) => ({ kind: 'event' as const, at: event.createdAt, event }))
	]
	return items.sort((a, b) => a.at.localeCompare(b.at))
}

/** §14.6 — untrusted HTML renders only inside a fully sandboxed iframe
 *  (no scripts, no same-origin); the server sanitizer already blocked
 *  remote images and rewrote links through the interstitial. */
function SandboxedHtml({ html }: { readonly html: string }) {
	return (
		<iframe
			sandbox=""
			title="mail body"
			className="h-auto min-h-32 w-full rounded border border-border bg-background"
			srcDoc={html}
		/>
	)
}

function MessageCard({ message }: { readonly message: MailMessageDto }) {
	const isOutbound = message.direction === 'outbound'
	return (
		<article
			className={`rounded-lg border p-3 ${
				isOutbound ? 'ml-10 border-primary/30 bg-primary/5' : 'mr-10 border-border bg-card'
			}`}
		>
			<header className="flex flex-wrap items-baseline justify-between gap-2">
				<span className="text-sm font-medium">
					{message.fromAddr.name ?? message.fromAddr.email}
					{isOutbound ? (
						<Badge tone="info" className="ml-2">
							outbound
						</Badge>
					) : null}
				</span>
				<time className="text-xs text-muted-foreground">
					{new Date(message.sentAt ?? message.receivedAt).toLocaleString()}
				</time>
			</header>
			{message.authResults ? (
				<p className="mt-0.5 text-xs text-muted-foreground">
					{t('mail.security.auth-results', {
						spf: message.authResults.spf ?? '—',
						dkim: message.authResults.dkim ?? '—',
						dmarc: message.authResults.dmarc ?? '—'
					})}
				</p>
			) : null}
			<div className="mt-2 text-sm">
				{message.bodyHtml ? (
					<SandboxedHtml html={message.bodyHtml} />
				) : (
					<p className="whitespace-pre-wrap">{message.bodyText ?? message.snippet}</p>
				)}
			</div>
			{message.attachments.length > 0 ? (
				<footer className="mt-2 flex flex-wrap gap-1.5">
					{message.attachments.map((att) => (
						<span
							key={`${att.name}-${att.byteSize}`}
							className="inline-flex items-center gap-1 rounded border border-border px-1.5 py-0.5 text-xs text-muted-foreground"
						>
							{att.name}
							{att.scanStatus && att.scanStatus !== 'clean' ? (
								<Badge tone={att.scanStatus === 'pending' ? 'warning' : 'danger'}>{att.scanStatus}</Badge>
							) : null}
						</span>
					))}
				</footer>
			) : null}
		</article>
	)
}

function NoteCard({ note }: { readonly note: MailNoteDto }) {
	return (
		<article className="ml-10 rounded-lg border border-(--warning)/40 bg-(--warning)/10 p-3">
			<header className="flex items-center gap-2 text-xs text-muted-foreground">
				<StickyNote className="size-3.5" aria-hidden />
				<span className="font-medium">{note.authorName ?? note.authorId.slice(0, 8)}</span>
				<span>{t('mail.timeline.note')}</span>
				<time className="ml-auto">{new Date(note.createdAt).toLocaleString()}</time>
			</header>
			<p className="mt-1 whitespace-pre-wrap text-sm">{note.bodyText}</p>
		</article>
	)
}

function EventRow({ event }: { readonly event: MailConversationEventDto }) {
	return (
		<p className="text-center text-xs text-muted-foreground">
			{event.actorName ?? t('mail.timeline.system')} · {event.kind.replaceAll('_', ' ')} ·{' '}
			<time>{new Date(event.createdAt).toLocaleString()}</time>
		</p>
	)
}

export interface ConversationViewProps {
	readonly timeline: MailTimelineDto | null
	readonly loading: boolean
	readonly identities: readonly MailIdentityDto[]
	readonly currentUserId: string
	readonly lastSentDraftId: string | null
	readonly lastSentAt: number | null
	readonly undoWindowSeconds: number
	readonly onPatch: (body: Parameters<TaskApiBridge['updateMailConversation']>[1]) => Promise<void>
	readonly onAddNote: (bodyText: string) => Promise<void>
	readonly onSaveReplyDraft: (body: {
		readonly identityId: string
		readonly bodyText: string
		readonly recipients: { readonly to: { email: string; name?: string | null }[] }
	}) => Promise<{ id: string }>
	readonly onSendDraft: (draftId: string) => Promise<void>
	readonly onUndoSend: (draftId: string) => Promise<void>
	readonly onConvertToIssue: (projectId: string) => Promise<void>
	readonly projects: readonly { id: string; name: string }[]
}

const UNDO_FALLBACK_SECONDS = 10

const STATUS_LABELS: Record<MailConversationStatus, MessageId> = {
	open: 'mail.conv.status.open',
	pending: 'mail.conv.status.pending',
	snoozed: 'mail.conv.status.snoozed',
	closed: 'mail.conv.status.closed',
	spam: 'mail.conv.status.spam'
}

export function ConversationView({
	timeline,
	loading,
	identities,
	currentUserId,
	lastSentDraftId,
	lastSentAt,
	undoWindowSeconds = UNDO_FALLBACK_SECONDS,
	onPatch,
	onAddNote,
	onSaveReplyDraft,
	onSendDraft,
	onUndoSend,
	onConvertToIssue,
	projects
}: ConversationViewProps) {
	const [composerTab, setComposerTab] = useState<'reply' | 'note'>('reply')
	const [composerText, setComposerText] = useState('')
	const [identityId, setIdentityId] = useState<string>('')
	const [projectId, setProjectId] = useState<string>('')
	const [busy, setBusy] = useState(false)
	const [error, setError] = useState<string | null>(null)

	const defaultIdentity = identities.find((i) => i.isDefault) ?? identities[0] ?? null
	const effectiveIdentityId = identityId || defaultIdentity?.id || ''

	const items = useMemo(() => (timeline ? mergeTimeline(timeline) : []), [timeline])
	const conversation = timeline?.conversation ?? null

	// Undo-send window countdown (§14.5): computed from the client clock,
	// server enforces the real deadline.
	const undoRemaining = useMemo(() => {
		if (!lastSentDraftId || !lastSentAt) return 0
		const elapsed = (Date.now() - lastSentAt) / 1000
		return Math.max(0, Math.ceil(undoWindowSeconds - elapsed))
	}, [lastSentDraftId, lastSentAt, undoWindowSeconds])
	const [, forceTick] = useState(0)
	useEffect(() => {
		if (!lastSentDraftId) return
		const tId = setInterval(() => forceTick((n) => n + 1), 500)
		return () => clearInterval(tId)
	}, [lastSentDraftId])

	if (loading) {
		return (
			<div className="space-y-3 p-4" aria-busy>
				<Skeleton className="h-6 w-1/2" />
				<Skeleton className="h-32 w-full" />
				<Skeleton className="h-24 w-3/4" />
			</div>
		)
	}
	if (!timeline || !conversation) {
		return null
	}

	const run = async (fn: () => Promise<void>) => {
		setBusy(true)
		setError(null)
		try {
			await fn()
		} catch (err) {
			setError(err instanceof Error ? err.message : 'action failed')
		} finally {
			setBusy(false)
		}
	}

	const submitComposer = async () => {
		const text = composerText.trim()
		if (!text) return
		if (composerTab === 'note') {
			await run(async () => {
				await onAddNote(text)
				setComposerText('')
			})
			return
		}
		if (!effectiveIdentityId || !conversation.customerEmail) return
		const toEmail = conversation.customerEmail
		await run(async () => {
			const draft = await onSaveReplyDraft({
				identityId: effectiveIdentityId,
				bodyText: text,
				recipients: { to: [{ email: toEmail }] }
			})
			setComposerText('')
			await onSendDraft(draft.id)
		})
	}

	return (
		<section className="flex h-full flex-col">
			<header className="flex flex-wrap items-center gap-2 border-b border-border px-4 py-3">
				<h2 className="min-w-0 flex-1 truncate text-base font-semibold">{conversation.subject}</h2>
				<Badge tone={conversation.status === 'open' ? 'success' : 'secondary'}>
					{t(STATUS_LABELS[conversation.status])}
				</Badge>
				{conversation.assigneeId === currentUserId ? (
					<Button
						size="sm"
						tone="outline"
						disabled={busy}
						onClick={() => void run(() => onPatch({ assigneeId: null }))}
					>
						{t('mail.action.unassign')}
					</Button>
				) : (
					<Button
						size="sm"
						tone="outline"
						disabled={busy}
						onClick={() => void run(() => onPatch({ assigneeId: currentUserId }))}
					>
						{t('mail.action.assign-to-me')}
					</Button>
				)}
				<Button
					size="sm"
					tone="outline"
					disabled={busy}
					onClick={() =>
						void run(() => onPatch({ snoozedUntil: new Date(Date.now() + 86_400_000).toISOString() }))
					}
				>
					<Moon className="size-3.5" aria-hidden />
					{t('mail.action.snooze-day')}
				</Button>
				{conversation.status === 'closed' ? (
					<Button
						size="sm"
						tone="outline"
						disabled={busy}
						onClick={() => void run(() => onPatch({ status: 'open' }))}
					>
						{t('mail.action.reopen')}
					</Button>
				) : (
					<Button
						size="sm"
						tone="outline"
						disabled={busy}
						onClick={() => void run(() => onPatch({ status: 'closed' }))}
					>
						{t('mail.action.close')}
					</Button>
				)}
				{projects.length > 0 ? (
					<div className="flex items-center gap-1.5">
						<Select value={projectId} onValueChange={setProjectId}>
							<SelectTrigger className="h-8 w-36">
								<SelectValue placeholder={t('mail.action.link-issue')} />
							</SelectTrigger>
							<SelectContent>
								{projects.map((p) => (
									<SelectItem key={p.id} value={p.id}>
										{p.name}
									</SelectItem>
								))}
							</SelectContent>
						</Select>
						<Button
							size="sm"
							tone="outline"
							disabled={busy || !projectId}
							onClick={() => void run(() => onConvertToIssue(projectId))}
						>
							<Link2 className="size-3.5" aria-hidden />
							{t('mail.action.convert-to-issue')}
						</Button>
					</div>
				) : null}
			</header>

			{timeline.linkedTasks.length > 0 || timeline.linkedDocs.length > 0 ? (
				<div className="flex flex-wrap gap-1.5 border-b border-border px-4 py-2">
					{timeline.linkedTasks.map((l) => (
						<Badge key={l.taskId} tone="outline">
							<ExternalLink className="size-3" aria-hidden />
							{l.identifier ?? l.taskId.slice(0, 8)} {l.title ? `— ${l.title}` : ''}
						</Badge>
					))}
					{timeline.linkedDocs.map((l) => (
						<Badge key={l.pageId} tone="outline">
							{l.title ?? l.slug ?? l.pageId.slice(0, 8)}
						</Badge>
					))}
				</div>
			) : null}

			<div className="flex-1 space-y-3 overflow-y-auto p-4">
				{items.map((item) =>
					item.kind === 'message' ? (
						<MessageCard key={item.message.id} message={item.message} />
					) : item.kind === 'note' ? (
						<NoteCard key={item.note.id} note={item.note} />
					) : (
						<EventRow key={item.event.id} event={item.event} />
					)
				)}
			</div>

			{error ? (
				<p role="alert" className="border-t border-border px-4 py-2 text-sm text-destructive">
					{t('mail.error.send')}
				</p>
			) : null}

			{lastSentDraftId && undoRemaining > 0 ? (
				<div className="flex items-center justify-between border-t border-border bg-accent/40 px-4 py-2">
					<span className="inline-flex items-center gap-1.5 text-sm text-muted-foreground">
						<Clock className="size-3.5" aria-hidden />
						{undoRemaining}s
					</span>
					<Button size="sm" tone="outline" onClick={() => void run(() => onUndoSend(lastSentDraftId))}>
						<Undo2 className="size-3.5" aria-hidden />
						{t('mail.composer.undo')}
					</Button>
				</div>
			) : null}

			<footer className="border-t border-border p-3">
				<div className="mb-2 flex items-center gap-2">
					<Button
						size="sm"
						tone={composerTab === 'reply' ? 'default' : 'outline'}
						onClick={() => setComposerTab('reply')}
					>
						{t('mail.composer.reply')}
					</Button>
					<Button
						size="sm"
						tone={composerTab === 'note' ? 'default' : 'outline'}
						onClick={() => setComposerTab('note')}
					>
						{t('mail.composer.note')}
					</Button>
					{composerTab === 'reply' && identities.length > 1 ? (
						<Select value={effectiveIdentityId} onValueChange={setIdentityId}>
							<SelectTrigger className="h-8 w-56">
								<SelectValue placeholder={t('mail.composer.from')} />
							</SelectTrigger>
							<SelectContent>
								{identities.map((i) => (
									<SelectItem key={i.id} value={i.id}>
										{i.displayName ? `${i.displayName} <${i.address}>` : i.address}
									</SelectItem>
								))}
							</SelectContent>
						</Select>
					) : null}
				</div>
				<div className="flex items-end gap-2">
					<Textarea
						value={composerText}
						onChange={(e) => setComposerText(e.target.value)}
						placeholder={
							composerTab === 'reply'
								? t('mail.composer.reply-placeholder')
								: t('mail.composer.note-placeholder')
						}
						className="min-h-20 flex-1"
					/>
					<Button
						disabled={
							busy ||
							!composerText.trim() ||
							(composerTab === 'reply' && (!effectiveIdentityId || !conversation.customerEmail))
						}
						onClick={() => void submitComposer()}
					>
						<Send className="size-3.5" aria-hidden />
						{composerTab === 'reply' ? t('mail.composer.send') : t('mail.composer.save-note')}
					</Button>
				</div>
			</footer>
		</section>
	)
}
