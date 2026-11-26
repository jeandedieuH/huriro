import type {
	AiMailAssistMode,
	AiMailAssistResponse,
	CompleteDraftReviewBody,
	ContactDto,
	MailAddress,
	MailConversationEventDto,
	MailConversationStatus,
	MailDraftDto,
	MailIdentityDto,
	MailMacroDto,
	MailMessageDto,
	MailNoteDto,
	MailTagBody,
	MailTagDto,
	MailTemplateDto,
	MailTimelineDto,
	RequestDraftReviewBody,
	UpsertMailDraftBody
} from '@huriro/contracts'
import { type MessageId, t } from '@huriro/i18n'
import {
	Clock,
	ExternalLink,
	Forward,
	Link2,
	Moon,
	PanelRight,
	Paperclip,
	Scissors,
	Send,
	Sparkles,
	StickyNote,
	Undo2,
	Users,
	X
} from 'lucide-react'
import { lazy, Suspense, useEffect, useMemo, useRef, useState } from 'react'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select'
import { Skeleton } from '@/components/ui/skeleton'
import { Textarea } from '@/components/ui/textarea'
import type { WorkspaceMemberSummary } from '@/lib/api-bridge'
import { useWorkspace } from '@/lib/workspace'
import { ConversationTagsBar } from './conversation-tags-bar'
import { DraftReviewBanner } from './draft-review-banner'
import { FollowUpPopover, SendLaterPopover } from './follow-up-schedule-popovers'
import { MailAiCopilotPanel } from './mail-ai-copilot-panel'
import { RecipientInput, resolveRecipientList } from './recipient-input'
import { SnippetMacroBar } from './snippet-macro-bar'

const LazyMailDraftCollabEditor = lazy(() =>
	import('./mail-draft-collab-editor').then((m) => ({ default: m.MailDraftCollabEditor }))
)

export interface MailShortcutSignal {
	readonly kind: 'reply' | 'reply_all' | 'note' | 'snippet' | 'macro' | 'assign' | 'tag'
	readonly seq: number
}

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

function parseAddressArray(raw: unknown): MailAddress[] {
	if (!Array.isArray(raw)) return []
	return raw
		.filter((item): item is Record<string, unknown> => Boolean(item && typeof item === 'object'))
		.map((item) => ({
			email: typeof item['email'] === 'string' ? item['email'] : '',
			name: typeof item['name'] === 'string' ? item['name'] : null
		}))
		.filter((addr) => addr.email.length > 0)
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

function MessageCard({
	message,
	onSplit
}: {
	readonly message: MailMessageDto
	readonly onSplit?: ((messageId: string) => Promise<void>) | undefined
}) {
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
				<div className="flex items-center gap-2">
					<time className="text-xs text-muted-foreground">
						{new Date(message.sentAt ?? message.receivedAt).toLocaleString()}
					</time>
					{onSplit ? (
						<Button
							size="sm"
							tone="ghost"
							type="button"
							aria-label={`${t('mail.split.action')}: ${message.fromAddr.email}`}
							onClick={() => void onSplit(message.id)}
							className="h-6 px-1.5 text-xs"
						>
							<Scissors className="size-3" aria-hidden />
							<span className="sr-only">{t('mail.split.action')}</span>
						</Button>
					) : null}
				</div>
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
	readonly tags?: readonly MailTagDto[] | undefined
	readonly availableTags?: readonly MailTagDto[] | undefined
	readonly templates?: readonly MailTemplateDto[] | undefined
	readonly macros?: readonly MailMacroDto[] | undefined
	readonly members?: readonly WorkspaceMemberSummary[] | undefined
	readonly contacts?: readonly ContactDto[] | undefined
	readonly availableIssues?:
		| readonly { readonly id: string; readonly identifier: string; readonly title: string }[]
		| undefined
	readonly availableDocs?:
		| readonly { readonly id: string; readonly slug: string; readonly title: string }[]
		| undefined
	readonly aiResult?: AiMailAssistResponse | null | undefined
	readonly aiLoading?: boolean | undefined
	readonly aiError?: string | null | undefined
	readonly shortcutSignal?: MailShortcutSignal | null | undefined
	readonly contactSidebarOpen?: boolean | undefined
	readonly onPatch: (
		body: Parameters<ReturnType<typeof useWorkspace>['api']['updateMailConversation']>[1]
	) => Promise<void>
	readonly onAddNote: (bodyText: string) => Promise<void>
	readonly onSaveReplyDraft: (body: UpsertMailDraftBody) => Promise<MailDraftDto>
	readonly onSendDraft: (draftId: string) => Promise<void>
	readonly onScheduleSend?:
		| ((draftId: string, scheduledSendAt: string, expectedVersion?: number) => Promise<void>)
		| undefined
	readonly onUndoSend: (draftId: string) => Promise<void>
	readonly onConvertToIssue: (projectId: string) => Promise<void>
	readonly onLinkIssue?: ((taskId: string) => Promise<void>) | undefined
	readonly onLinkDoc?: ((pageId: string) => Promise<void>) | undefined
	readonly onOpenIssue?: ((taskId: string) => void) | undefined
	readonly onOpenDoc?: ((pageId: string, slug: string | null) => void) | undefined
	readonly onToggleTag?: ((tagId: string) => Promise<void>) | undefined
	readonly onCreateTag?: ((body: MailTagBody) => Promise<MailTagDto>) | undefined
	readonly onRenderTemplate?:
		| ((templateId: string, variables?: Record<string, string>) => Promise<string>)
		| undefined
	readonly onApplyMacro?: ((macroId: string) => Promise<void>) | undefined
	readonly onOpenForward?: (() => void) | undefined
	readonly onSplitMessage?: ((messageId: string) => Promise<void>) | undefined
	readonly onRouteRoundRobin?: (() => Promise<void>) | undefined
	readonly onToggleContactSidebar?: (() => void) | undefined
	readonly onRequestDraftReview?:
		| ((draftId: string, body: RequestDraftReviewBody) => Promise<void>)
		| undefined
	readonly onCompleteDraftReview?:
		| ((draftId: string, body: CompleteDraftReviewBody) => Promise<void>)
		| undefined
	readonly onAssistAi?: ((mode: AiMailAssistMode) => Promise<void>) | undefined
	readonly onClearAi?: (() => void) | undefined
	readonly projects: readonly { id: string; name: string }[]
}

interface AttachedFileChip {
	readonly id: string
	readonly filename: string
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
	tags = [],
	availableTags = [],
	templates = [],
	macros = [],
	members = [],
	contacts = [],
	availableIssues = [],
	availableDocs = [],
	aiResult = null,
	aiLoading = false,
	aiError = null,
	shortcutSignal = null,
	contactSidebarOpen = false,
	onPatch,
	onAddNote,
	onSaveReplyDraft,
	onSendDraft,
	onScheduleSend,
	onUndoSend,
	onConvertToIssue,
	onLinkIssue,
	onLinkDoc,
	onOpenIssue,
	onOpenDoc,
	onToggleTag,
	onCreateTag,
	onRenderTemplate,
	onApplyMacro,
	onOpenForward,
	onSplitMessage,
	onRouteRoundRobin,
	onToggleContactSidebar,
	onRequestDraftReview,
	onCompleteDraftReview,
	onAssistAi,
	onClearAi,
	projects
}: ConversationViewProps) {
	const { api, isPreview, userDisplayName } = useWorkspace()
	const composerWrapRef = useRef<HTMLDivElement | null>(null)
	const assignWrapRef = useRef<HTMLSpanElement | null>(null)
	const fileInputRef = useRef<HTMLInputElement | null>(null)

	const [composerTab, setComposerTab] = useState<'reply' | 'note'>('reply')
	const [replyMode, setReplyMode] = useState<'reply' | 'reply_all'>('reply')
	const [composerText, setComposerText] = useState('')
	const [identityId, setIdentityId] = useState<string>('')
	const [projectId, setProjectId] = useState<string>('')
	const [showCcBcc, setShowCcBcc] = useState(false)
	const [ccRecipients, setCcRecipients] = useState<MailAddress[]>([])
	const [ccDraft, setCcDraft] = useState('')
	const [bccRecipients, setBccRecipients] = useState<MailAddress[]>([])
	const [bccDraft, setBccDraft] = useState('')
	const [attachments, setAttachments] = useState<AttachedFileChip[]>([])
	const [uploading, setUploading] = useState(false)
	const [collabActive, setCollabActive] = useState(false)
	const [aiPanelOpen, setAiPanelOpen] = useState(false)
	const [snippetsSignal, setSnippetsSignal] = useState(0)
	const [macrosSignal, setMacrosSignal] = useState(0)
	const [tagsSignal, setTagsSignal] = useState(0)
	const [busy, setBusy] = useState(false)
	const [error, setError] = useState<string | null>(null)

	const defaultIdentity = identities.find((i) => i.isDefault) ?? identities[0] ?? null
	const effectiveIdentityId = identityId || defaultIdentity?.id || ''

	const items = useMemo(() => (timeline ? mergeTimeline(timeline) : []), [timeline])
	const conversation = timeline?.conversation ?? null
	const activeDraft = timeline?.drafts.find((d) => d.status === 'draft') ?? null
	const scheduledDraft =
		timeline?.drafts.find(
			(d) => d.status === 'sending' && Boolean(d.scheduledSendAt) && d.id !== lastSentDraftId
		) ?? null
	const reviewBlocked = activeDraft?.reviewStatus === 'requested'
	const [syncedDraftId, setSyncedDraftId] = useState<string | null>(activeDraft?.id ?? null)

	const activeDraftId = activeDraft?.id ?? null
	if (activeDraftId !== syncedDraftId) {
		setSyncedDraftId(activeDraftId)
		if (activeDraft?.bodyText && composerText === '') {
			setComposerText(activeDraft.bodyText)
		}
		if (activeDraft) {
			const parsedCc = parseAddressArray(activeDraft.recipients['cc'])
			const parsedBcc = parseAddressArray(activeDraft.recipients['bcc'])
			if (parsedCc.length > 0 || parsedBcc.length > 0) {
				setCcRecipients(parsedCc)
				setBccRecipients(parsedBcc)
				setShowCcBcc(true)
			}
			setCollabActive(activeDraft.collabEnabled)
		} else {
			setCollabActive(false)
		}
	}

	// React to keyboard shortcut triggers dispatched from MailWorkspace (§6.6).
	useEffect(() => {
		if (!shortcutSignal || !timeline?.conversation) return
		const conv = timeline.conversation
		const focusComposer = () => {
			window.setTimeout(() => {
				composerWrapRef.current?.querySelector('textarea')?.focus()
			}, 0)
		}
		if (shortcutSignal.kind === 'reply') {
			setComposerTab('reply')
			setReplyMode('reply')
			focusComposer()
		} else if (shortcutSignal.kind === 'reply_all') {
			setComposerTab('reply')
			setReplyMode('reply_all')
			setShowCcBcc(true)
			const latestMsg = timeline.messages.at(-1)
			const ownEmail = defaultIdentity?.address.toLowerCase() ?? ''
			const primaryEmail = (conv.customerEmail ?? '').toLowerCase()
			if (latestMsg) {
				const extra = [...latestMsg.toAddrs, ...latestMsg.ccAddrs]
					.filter((a) => {
						const low = a.email.toLowerCase()
						return low !== ownEmail && low !== primaryEmail
					})
					.map((a) => ({ email: a.email, name: a.name ?? null }))
				if (extra.length > 0) setCcRecipients(extra)
			}
			focusComposer()
		} else if (shortcutSignal.kind === 'note') {
			setComposerTab('note')
			focusComposer()
		} else if (shortcutSignal.kind === 'snippet') {
			setComposerTab('reply')
			setSnippetsSignal((n) => n + 1)
		} else if (shortcutSignal.kind === 'macro') {
			setComposerTab('reply')
			setMacrosSignal((n) => n + 1)
		} else if (shortcutSignal.kind === 'assign') {
			assignWrapRef.current?.querySelector('button')?.focus()
		} else if (shortcutSignal.kind === 'tag') {
			setTagsSignal((n) => n + 1)
		}
	}, [defaultIdentity?.address, shortcutSignal, timeline])

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

	// Inline ";shortcut" snippet autocomplete token near end of reply text.
	const inlineSnippetToken = useMemo(() => {
		if (composerTab !== 'reply') return null
		const match = /(?:^|\s)(;[a-z0-9_-]*)$/i.exec(composerText)
		return match?.[1] ?? null
	}, [composerTab, composerText])

	const inlineSnippetMatches = useMemo(() => {
		if (!inlineSnippetToken) return []
		const needle = inlineSnippetToken.toLowerCase()
		return templates.filter((tpl) => tpl.shortcut.toLowerCase().startsWith(needle)).slice(0, 6)
	}, [inlineSnippetToken, templates])

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

	const buildRecipients = () => {
		const ccList = resolveRecipientList(ccRecipients, ccDraft)
		const bccList = resolveRecipientList(bccRecipients, bccDraft)
		return {
			to: [{ email: conversation.customerEmail ?? '' }],
			...(ccList.length > 0 ? { cc: ccList } : {}),
			...(bccList.length > 0 ? { bcc: bccList } : {})
		}
	}

	const buildDraftPayload = (
		text: string,
		overrides?: Partial<UpsertMailDraftBody>
	): UpsertMailDraftBody => ({
		identityId: effectiveIdentityId,
		bodyText: text,
		recipients: buildRecipients(),
		collabEnabled: collabActive,
		...(attachments.length > 0 ? { attachmentFileIds: attachments.map((a) => a.id) } : {}),
		...overrides
	})

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

	const insertTemplateInline = async (tpl: MailTemplateDto) => {
		if (!inlineSnippetToken) return
		let expanded = tpl.bodyText
		if (onRenderTemplate) {
			const vars: Record<string, string> = {}
			for (const variable of tpl.mergeVariables) {
				if (variable === 'customer') vars[variable] = conversation.customerEmail || 'there'
			}
			expanded = await onRenderTemplate(tpl.id, vars)
		}
		setComposerText((prev) => {
			const idx = prev.lastIndexOf(inlineSnippetToken)
			if (idx < 0) return prev
			return `${prev.slice(0, idx)}${expanded}`
		})
	}

	const handleUploadFiles = async (files: FileList | null) => {
		if (!files || files.length === 0 || uploading) return
		setUploading(true)
		try {
			const uploaded: AttachedFileChip[] = []
			for (const file of Array.from(files)) {
				const dto = await api.uploadFile(file)
				uploaded.push({ id: dto.id, filename: dto.filename })
			}
			setAttachments((prev) => [...prev, ...uploaded])
		} finally {
			setUploading(false)
			if (fileInputRef.current) fileInputRef.current.value = ''
		}
	}

	const saveDraftOnly = async () => {
		const text = composerText.trim()
		if (!text || !effectiveIdentityId || !conversation.customerEmail) return
		await run(async () => {
			await onSaveReplyDraft(buildDraftPayload(text))
		})
	}

	const toggleCollabDraft = async () => {
		const next = !collabActive
		setCollabActive(next)
		if (effectiveIdentityId && conversation.customerEmail) {
			await run(async () => {
				await onSaveReplyDraft(buildDraftPayload(composerText.trim() || ' ', { collabEnabled: next }))
			})
		}
	}

	const handleReplyModeSwitch = (mode: 'reply' | 'reply_all') => {
		setComposerTab('reply')
		setReplyMode(mode)
		if (mode === 'reply_all') {
			setShowCcBcc(true)
			const latestMsg = timeline.messages.at(-1)
			const ownEmail = defaultIdentity?.address.toLowerCase() ?? ''
			const primaryEmail = (conversation.customerEmail ?? '').toLowerCase()
			if (latestMsg) {
				const extra = [...latestMsg.toAddrs, ...latestMsg.ccAddrs]
					.filter((a) => {
						const low = a.email.toLowerCase()
						return low !== ownEmail && low !== primaryEmail
					})
					.map((a) => ({ email: a.email, name: a.name ?? null }))
				if (extra.length > 0) setCcRecipients(extra)
			}
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
		if (reviewBlocked) return
		if (!effectiveIdentityId || !conversation.customerEmail) return
		await run(async () => {
			const draft =
				activeDraft && activeDraft.bodyText.trim() === text && attachments.length === 0
					? activeDraft
					: await onSaveReplyDraft(buildDraftPayload(text))
			await onSendDraft(draft.id)
			setComposerText('')
			setAttachments([])
		})
	}

	const handleScheduleLater = async (isoDateTime: string) => {
		const text = composerText.trim()
		if (!text || reviewBlocked || !effectiveIdentityId || !conversation.customerEmail || !onScheduleSend) {
			return
		}
		await run(async () => {
			const draft = await onSaveReplyDraft(buildDraftPayload(text))
			await onScheduleSend(draft.id, isoDateTime, draft.version)
			setComposerText('')
			setAttachments([])
		})
	}

	return (
		<section className="flex h-full flex-col">
			<header className="flex flex-wrap items-center gap-2 border-b border-border px-4 py-3">
				<h2 className="min-w-0 flex-1 truncate text-base font-semibold">{conversation.subject}</h2>
				<Badge tone={conversation.status === 'open' ? 'success' : 'secondary'}>
					{t(STATUS_LABELS[conversation.status])}
				</Badge>
				{conversation.followUpAt ? (
					<Badge tone="info">
						{t('mail.followup.active-badge', {
							date: new Date(conversation.followUpAt).toLocaleDateString()
						})}
					</Badge>
				) : null}
				<FollowUpPopover
					followUpAt={conversation.followUpAt}
					followUpCondition={conversation.followUpCondition}
					disabled={busy}
					onSetFollowUp={(at, condition) =>
						run(() => onPatch({ followUpAt: at, followUpCondition: condition }))
					}
				/>
				{onAssistAi ? (
					<Button
						size="sm"
						tone={aiPanelOpen ? 'default' : 'outline'}
						type="button"
						aria-pressed={aiPanelOpen}
						onClick={() => setAiPanelOpen((v) => !v)}
					>
						<Sparkles className="size-3.5" aria-hidden />
						{t('mail.ai.toggle')}
					</Button>
				) : null}
				{conversation.assigneeId === currentUserId ? (
					<span ref={assignWrapRef} className="inline-flex">
						<Button
							size="sm"
							tone="outline"
							disabled={busy}
							onClick={() => void run(() => onPatch({ assigneeId: null }))}
						>
							{t('mail.action.unassign')}
						</Button>
					</span>
				) : (
					<span ref={assignWrapRef} className="inline-flex">
						<Button
							size="sm"
							tone="outline"
							disabled={busy}
							onClick={() => void run(() => onPatch({ assigneeId: currentUserId }))}
						>
							{t('mail.action.assign-to-me')}
						</Button>
					</span>
				)}
				{onRouteRoundRobin ? (
					<Button size="sm" tone="outline" disabled={busy} onClick={() => void run(onRouteRoundRobin)}>
						<Sparkles className="size-3.5" aria-hidden />
						{t('mail.route.action')}
					</Button>
				) : null}
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
				{onOpenForward ? (
					<Button size="sm" tone="outline" disabled={busy} onClick={onOpenForward}>
						<Forward className="size-3.5" aria-hidden />
						{t('mail.forward.action')}
					</Button>
				) : null}
				{onToggleContactSidebar ? (
					<Button
						size="sm"
						tone={contactSidebarOpen ? 'default' : 'outline'}
						aria-pressed={contactSidebarOpen}
						onClick={onToggleContactSidebar}
					>
						<PanelRight className="size-3.5" aria-hidden />
						{t('mail.contact.toggle')}
					</Button>
				) : null}
				{projects.length > 0 ? (
					<div className="flex items-center gap-1.5">
						<Select value={projectId} onValueChange={setProjectId}>
							<SelectTrigger className="h-8 w-36" aria-label={t('mail.action.link-issue')}>
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

			{aiPanelOpen && onAssistAi ? (
				<MailAiCopilotPanel
					result={aiResult}
					loading={aiLoading}
					error={aiError}
					availableTags={availableTags}
					onRunMode={onAssistAi}
					onInsertDraft={(text) => {
						setComposerTab('reply')
						setComposerText(text)
					}}
					onApplyTag={async (tagId) => {
						if (onToggleTag) await onToggleTag(tagId)
					}}
					onOpenCitation={(entityType, entityId, slug) => {
						if (entityType === 'doc_page') onOpenDoc?.(entityId, slug ?? null)
						else onOpenIssue?.(entityId)
					}}
					onClear={() => onClearAi?.()}
					onClose={() => setAiPanelOpen(false)}
				/>
			) : null}

			{onToggleTag && onCreateTag ? (
				<div className="border-b border-border px-4 py-2">
					<ConversationTagsBar
						tags={tags}
						availableTags={availableTags}
						inboxId={conversation.inboxId}
						openSignal={tagsSignal}
						onToggleTag={onToggleTag}
						onCreateTag={onCreateTag}
					/>
				</div>
			) : null}

			{timeline.linkedTasks.length > 0 ||
			timeline.linkedDocs.length > 0 ||
			(onLinkIssue && availableIssues.length > 0) ||
			(onLinkDoc && availableDocs.length > 0) ? (
				<div className="flex flex-wrap items-center gap-1.5 border-b border-border px-4 py-2">
					{timeline.linkedTasks.map((l) => (
						<button
							key={l.taskId}
							type="button"
							onClick={() => onOpenIssue?.(l.taskId)}
							className="inline-flex items-center gap-1 rounded-full border border-border bg-card px-2.5 py-0.5 text-xs font-medium text-foreground hover:bg-accent"
						>
							<ExternalLink className="size-3" aria-hidden />
							{l.identifier ?? l.taskId.slice(0, 8)} {l.title ? `— ${l.title}` : ''}
						</button>
					))}
					{timeline.linkedDocs.map((l) => (
						<button
							key={l.pageId}
							type="button"
							onClick={() => onOpenDoc?.(l.pageId, l.slug)}
							className="inline-flex items-center gap-1 rounded-full border border-border bg-card px-2.5 py-0.5 text-xs font-medium text-foreground hover:bg-accent"
						>
							<ExternalLink className="size-3" aria-hidden />
							{l.title ?? l.slug ?? l.pageId.slice(0, 8)}
						</button>
					))}
					{onLinkIssue && availableIssues.length > 0 ? (
						<select
							aria-label={t('mail.links.link-issue')}
							value=""
							onChange={(e) => {
								if (e.target.value) void run(() => onLinkIssue(e.target.value))
							}}
							className="h-7 rounded-md border border-border bg-background px-2 text-xs"
						>
							<option value="">{t('mail.links.pick-issue')}</option>
							{availableIssues.map((iss) => (
								<option key={iss.id} value={iss.id}>
									{iss.identifier}: {iss.title}
								</option>
							))}
						</select>
					) : null}
					{onLinkDoc && availableDocs.length > 0 ? (
						<select
							aria-label={t('mail.links.link-doc')}
							value=""
							onChange={(e) => {
								if (e.target.value) void run(() => onLinkDoc(e.target.value))
							}}
							className="h-7 rounded-md border border-border bg-background px-2 text-xs"
						>
							<option value="">{t('mail.links.pick-doc')}</option>
							{availableDocs.map((doc) => (
								<option key={doc.id} value={doc.id}>
									{doc.title}
								</option>
							))}
						</select>
					) : null}
				</div>
			) : null}

			<div className="flex-1 space-y-3 overflow-y-auto p-4">
				{items.map((item) =>
					item.kind === 'message' ? (
						<MessageCard key={item.message.id} message={item.message} onSplit={onSplitMessage} />
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

			{scheduledDraft?.scheduledSendAt ? (
				<div
					className="flex items-center justify-between border-t border-border bg-accent/30 px-4 py-2"
					data-testid="scheduled-send-banner"
				>
					<span className="inline-flex items-center gap-1.5 text-xs font-medium text-foreground">
						<Clock className="size-3.5 text-primary" aria-hidden />
						{t('mail.send-later.scheduled-badge', {
							date: new Date(scheduledDraft.scheduledSendAt).toLocaleString()
						})}
					</span>
					<Button
						size="sm"
						tone="outline"
						type="button"
						onClick={() => void run(() => onUndoSend(scheduledDraft.id))}
					>
						<Undo2 className="size-3.5" aria-hidden />
						{t('mail.send-later.cancel-schedule')}
					</Button>
				</div>
			) : null}

			<footer className="border-t border-border p-3">
				{composerTab === 'reply' && onRequestDraftReview && onCompleteDraftReview ? (
					<DraftReviewBanner
						draft={activeDraft}
						members={members}
						currentUserId={currentUserId}
						onRequestReview={onRequestDraftReview}
						onCompleteReview={onCompleteDraftReview}
					/>
				) : null}
				<div className="mb-2 flex flex-wrap items-center gap-2">
					<Button
						size="sm"
						tone={composerTab === 'reply' && replyMode === 'reply' ? 'default' : 'outline'}
						onClick={() => handleReplyModeSwitch('reply')}
					>
						{t('mail.composer.reply')}
					</Button>
					<Button
						size="sm"
						tone={composerTab === 'reply' && replyMode === 'reply_all' ? 'default' : 'outline'}
						onClick={() => handleReplyModeSwitch('reply_all')}
					>
						{t('mail.reply.mode-reply-all')}
					</Button>
					<Button
						size="sm"
						tone={composerTab === 'note' ? 'default' : 'outline'}
						onClick={() => setComposerTab('note')}
					>
						{t('mail.composer.note')}
					</Button>
					{composerTab === 'reply' && (onRenderTemplate || onApplyMacro) ? (
						<SnippetMacroBar
							templates={templates}
							macros={macros}
							customerName={conversation.customerEmail}
							snippetsOpenSignal={snippetsSignal}
							macrosOpenSignal={macrosSignal}
							onInsertSnippet={async (tplId, vars) => {
								if (!onRenderTemplate) return
								const rendered = await onRenderTemplate(tplId, vars)
								setComposerText((prev) => (prev ? `${prev}\n${rendered}` : rendered))
							}}
							onApplyMacro={async (macroId) => {
								if (onApplyMacro) await onApplyMacro(macroId)
							}}
						/>
					) : null}
					{composerTab === 'reply' ? (
						<Button
							size="sm"
							tone={showCcBcc ? 'default' : 'outline'}
							type="button"
							onClick={() => setShowCcBcc((v) => !v)}
						>
							{t('mail.compose.show-cc-bcc')}
						</Button>
					) : null}
					{composerTab === 'reply' ? (
						<Button
							size="sm"
							tone={collabActive ? 'default' : 'outline'}
							type="button"
							aria-pressed={collabActive}
							onClick={() => void toggleCollabDraft()}
						>
							<Users className="size-3.5" aria-hidden />
							<span>{collabActive ? t('mail.collab.disable') : t('mail.collab.enable')}</span>
						</Button>
					) : null}
					{composerTab === 'reply' && identities.length > 1 ? (
						<Select value={effectiveIdentityId} onValueChange={setIdentityId}>
							<SelectTrigger className="h-8 w-56" aria-label={t('mail.composer.from')}>
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

				{composerTab === 'reply' && showCcBcc ? (
					<div className="mb-2 grid gap-2 sm:grid-cols-2">
						<div className="space-y-1">
							<label htmlFor="reply-cc" className="text-xs font-medium text-foreground">
								{t('mail.compose.cc')}
							</label>
							<RecipientInput
								id="reply-cc"
								recipients={ccRecipients}
								draftText={ccDraft}
								onDraftTextChange={setCcDraft}
								onChange={setCcRecipients}
								contacts={contacts}
								placeholder={t('mail.compose.to-placeholder')}
							/>
						</div>
						<div className="space-y-1">
							<label htmlFor="reply-bcc" className="text-xs font-medium text-foreground">
								{t('mail.compose.bcc')}
							</label>
							<RecipientInput
								id="reply-bcc"
								recipients={bccRecipients}
								draftText={bccDraft}
								onDraftTextChange={setBccDraft}
								onChange={setBccRecipients}
								contacts={contacts}
								placeholder={t('mail.compose.to-placeholder')}
							/>
						</div>
					</div>
				) : null}

				{composerTab === 'reply' && inlineSnippetMatches.length > 0 ? (
					<div
						role="listbox"
						aria-label={t('mail.templates.title')}
						className="mb-2 max-h-36 overflow-y-auto rounded-md border border-border bg-popover p-1 shadow-sm"
					>
						{inlineSnippetMatches.map((tpl) => (
							<button
								key={tpl.id}
								type="button"
								role="option"
								aria-selected={false}
								onClick={() => void insertTemplateInline(tpl)}
								className="flex w-full items-center justify-between rounded-sm px-2 py-1 text-left text-xs text-popover-foreground hover:bg-accent"
							>
								<span className="font-medium">{tpl.name}</span>
								<code className="text-muted-foreground">{tpl.shortcut}</code>
							</button>
						))}
					</div>
				) : null}

				<div className="flex items-end gap-2">
					<div ref={composerWrapRef} className="flex min-w-0 flex-1">
						{composerTab === 'reply' && collabActive ? (
							<Suspense fallback={<Skeleton className="h-20 flex-1" />}>
								<LazyMailDraftCollabEditor
									draftId={activeDraft?.id ?? `draft-${conversation.id}`}
									workspaceId={conversation.workspaceId}
									value={composerText}
									onChange={setComposerText}
									onKeyDown={(e) => {
										const firstInline = inlineSnippetMatches[0]
										if ((e.key === 'Tab' || (e.key === 'Enter' && !e.shiftKey)) && firstInline) {
											e.preventDefault()
											void insertTemplateInline(firstInline)
										}
									}}
									placeholder={t('mail.composer.reply-placeholder')}
									ariaLabel={t('mail.composer.reply-placeholder')}
									userDisplayName={userDisplayName}
									currentUserId={currentUserId}
									isPreview={isPreview}
									api={api}
								/>
							</Suspense>
						) : (
							<Textarea
								value={composerText}
								onChange={(e) => setComposerText(e.target.value)}
								onKeyDown={(e) => {
									const firstInline = inlineSnippetMatches[0]
									if (
										composerTab === 'reply' &&
										(e.key === 'Tab' || (e.key === 'Enter' && !e.shiftKey)) &&
										firstInline
									) {
										e.preventDefault()
										void insertTemplateInline(firstInline)
									}
								}}
								placeholder={
									composerTab === 'reply'
										? t('mail.composer.reply-placeholder')
										: t('mail.composer.note-placeholder')
								}
								className="min-h-20 flex-1"
							/>
						)}
					</div>
					<div className="flex flex-col gap-1.5">
						{composerTab === 'reply' ? (
							<Button
								size="sm"
								tone="outline"
								type="button"
								disabled={busy || !composerText.trim() || !effectiveIdentityId || !conversation.customerEmail}
								onClick={() => void saveDraftOnly()}
							>
								{t('chat.message.save')}
							</Button>
						) : null}
						{composerTab === 'reply' && onScheduleSend ? (
							<SendLaterPopover
								disabled={
									busy ||
									!composerText.trim() ||
									!effectiveIdentityId ||
									!conversation.customerEmail ||
									reviewBlocked
								}
								onSchedule={handleScheduleLater}
							/>
						) : null}
						<Button
							disabled={
								busy ||
								uploading ||
								!composerText.trim() ||
								(composerTab === 'reply' &&
									(!effectiveIdentityId || !conversation.customerEmail || reviewBlocked))
							}
							onClick={() => void submitComposer()}
						>
							<Send className="size-3.5" aria-hidden />
							{composerTab === 'reply' ? t('mail.composer.send') : t('mail.composer.save-note')}
						</Button>
					</div>
				</div>

				{composerTab === 'reply' ? (
					<div className="mt-2 flex flex-wrap items-center gap-2">
						<input
							ref={fileInputRef}
							type="file"
							multiple
							aria-label={t('mail.compose.attach-file')}
							className="sr-only"
							onChange={(e) => void handleUploadFiles(e.target.files)}
						/>
						<Button
							size="sm"
							tone="outline"
							type="button"
							disabled={uploading}
							onClick={() => fileInputRef.current?.click()}
						>
							<Paperclip className="size-3.5" aria-hidden />
							<span>{uploading ? t('mail.compose.uploading') : t('mail.compose.attach-file')}</span>
						</Button>
						{attachments.map((att) => (
							<Badge key={att.id} tone="secondary" className="gap-1 text-xs">
								<span>{att.filename}</span>
								<button
									type="button"
									aria-label={t('mail.compose.remove-attachment', { name: att.filename })}
									onClick={() => setAttachments((prev) => prev.filter((item) => item.id !== att.id))}
								>
									<X className="size-3" aria-hidden />
								</button>
							</Badge>
						))}
					</div>
				) : null}
			</footer>
		</section>
	)
}
