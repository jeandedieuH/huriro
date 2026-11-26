import type {
	ContactDto,
	CreateOutboundConversationBody,
	MailAddress,
	MailIdentityDto,
	MailInboxDto
} from '@huriro/contracts'
import { t } from '@huriro/i18n'
import { Paperclip, X } from 'lucide-react'
import { useEffect, useRef, useState } from 'react'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import {
	Dialog,
	DialogContent,
	DialogDescription,
	DialogFooter,
	DialogHeader,
	DialogTitle
} from '@/components/ui/dialog'
import { Input } from '@/components/ui/input'
import { useWorkspace } from '@/lib/workspace'
import { RecipientInput, resolveRecipientList } from './recipient-input'

export interface ComposeOutboundDialogProps {
	readonly open: boolean
	readonly onOpenChange: (open: boolean) => void
	readonly inboxes: readonly MailInboxDto[]
	readonly identities: readonly MailIdentityDto[]
	readonly contacts?: readonly ContactDto[] | undefined
	readonly defaultInboxId?: string | null | undefined
	readonly onSubmit: (body: CreateOutboundConversationBody) => Promise<void>
}

interface AttachedFileChip {
	readonly id: string
	readonly filename: string
}

/**
 * Proactive outbound email composer creating a conversation shell + initial draft
 * with To/Cc/Bcc autocomplete, file attachments, Send Later, and Follow-Up options.
 */
export function ComposeOutboundDialog({
	open,
	onOpenChange,
	inboxes,
	identities,
	contacts = [],
	defaultInboxId,
	onSubmit
}: ComposeOutboundDialogProps) {
	const { api } = useWorkspace()
	const fileInputRef = useRef<HTMLInputElement | null>(null)
	const [inboxId, setInboxId] = useState(defaultInboxId ?? inboxes[0]?.id ?? '')
	const [identityId, setIdentityId] = useState(identities[0]?.id ?? '')
	const [toRecipients, setToRecipients] = useState<MailAddress[]>([])
	const [toDraft, setToDraft] = useState('')
	const [showCcBcc, setShowCcBcc] = useState(false)
	const [ccRecipients, setCcRecipients] = useState<MailAddress[]>([])
	const [ccDraft, setCcDraft] = useState('')
	const [bccRecipients, setBccRecipients] = useState<MailAddress[]>([])
	const [bccDraft, setBccDraft] = useState('')
	const [attachments, setAttachments] = useState<AttachedFileChip[]>([])
	const [uploading, setUploading] = useState(false)
	const [scheduledSendAt, setScheduledSendAt] = useState('')
	const [followUpAt, setFollowUpAt] = useState('')
	const [followUpCondition, setFollowUpCondition] = useState<'if_no_reply' | 'always'>('if_no_reply')
	const [subject, setSubject] = useState('')
	const [bodyText, setBodyText] = useState('')
	const [busy, setBusy] = useState(false)

	useEffect(() => {
		if (!inboxId && inboxes[0]) setInboxId(defaultInboxId ?? inboxes[0].id)
	}, [defaultInboxId, inboxId, inboxes])

	useEffect(() => {
		if (!identityId && identities[0]) setIdentityId(identities[0].id)
	}, [identities, identityId])

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

	const handleSubmit = async (ev: React.FormEvent) => {
		ev.preventDefault()
		const resolvedInbox = inboxId || inboxes[0]?.id
		const resolvedIdentity = identityId || identities[0]?.id
		const toList = resolveRecipientList(toRecipients, toDraft)
		const ccList = resolveRecipientList(ccRecipients, ccDraft)
		const bccList = resolveRecipientList(bccRecipients, bccDraft)
		if (
			!resolvedInbox ||
			!resolvedIdentity ||
			toList.length === 0 ||
			!subject.trim() ||
			!bodyText.trim() ||
			busy
		) {
			return
		}
		setBusy(true)
		try {
			await onSubmit({
				inboxId: resolvedInbox,
				identityId: resolvedIdentity,
				subject: subject.trim(),
				recipients: {
					to: toList,
					...(ccList.length > 0 ? { cc: ccList } : {}),
					...(bccList.length > 0 ? { bcc: bccList } : {})
				},
				bodyText: bodyText.trim(),
				...(scheduledSendAt ? { scheduledSendAt: new Date(scheduledSendAt).toISOString() } : {}),
				...(followUpAt ? { followUpAt: new Date(followUpAt).toISOString(), followUpCondition } : {}),
				...(attachments.length > 0 ? { attachmentFileIds: attachments.map((a) => a.id) } : {})
			})
			setToRecipients([])
			setToDraft('')
			setCcRecipients([])
			setCcDraft('')
			setBccRecipients([])
			setBccDraft('')
			setAttachments([])
			setScheduledSendAt('')
			setFollowUpAt('')
			setSubject('')
			setBodyText('')
			onOpenChange(false)
		} finally {
			setBusy(false)
		}
	}

	return (
		<Dialog open={open} onOpenChange={onOpenChange}>
			<DialogContent className="sm:max-w-lg">
				<DialogHeader>
					<DialogTitle>{t('mail.compose.title')}</DialogTitle>
					<DialogDescription>{t('mail.composer.from')}</DialogDescription>
				</DialogHeader>
				<form onSubmit={(ev) => void handleSubmit(ev)} className="space-y-3">
					{inboxes.length > 0 ? (
						<div className="space-y-1">
							<label htmlFor="compose-inbox" className="text-xs font-medium text-foreground">
								{t('mail.compose.inbox')}
							</label>
							<select
								id="compose-inbox"
								value={inboxId}
								onChange={(e) => setInboxId(e.target.value)}
								className="h-9 w-full rounded-md border border-border bg-background px-2.5 text-sm"
							>
								{inboxes.map((inbox) => (
									<option key={inbox.id} value={inbox.id}>
										{inbox.name}
									</option>
								))}
							</select>
						</div>
					) : null}

					<div className="space-y-1">
						<div className="flex items-center justify-between">
							<label htmlFor="compose-to" className="text-xs font-medium text-foreground">
								{t('mail.compose.to')}
							</label>
							<button
								type="button"
								onClick={() => setShowCcBcc((v) => !v)}
								className="text-xs text-muted-foreground hover:text-foreground"
							>
								{t('mail.compose.show-cc-bcc')}
							</button>
						</div>
						<RecipientInput
							id="compose-to"
							required
							recipients={toRecipients}
							draftText={toDraft}
							onDraftTextChange={setToDraft}
							onChange={setToRecipients}
							contacts={contacts}
							placeholder={t('mail.compose.to-placeholder')}
						/>
					</div>

					{showCcBcc ? (
						<div className="grid gap-2 sm:grid-cols-2">
							<div className="space-y-1">
								<label htmlFor="compose-cc" className="text-xs font-medium text-foreground">
									{t('mail.compose.cc')}
								</label>
								<RecipientInput
									id="compose-cc"
									recipients={ccRecipients}
									draftText={ccDraft}
									onDraftTextChange={setCcDraft}
									onChange={setCcRecipients}
									contacts={contacts}
									placeholder={t('mail.compose.to-placeholder')}
								/>
							</div>
							<div className="space-y-1">
								<label htmlFor="compose-bcc" className="text-xs font-medium text-foreground">
									{t('mail.compose.bcc')}
								</label>
								<RecipientInput
									id="compose-bcc"
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

					<div className="space-y-1">
						<label htmlFor="compose-subject" className="text-xs font-medium text-foreground">
							{t('mail.compose.subject')}
						</label>
						<Input
							id="compose-subject"
							required
							placeholder={t('mail.compose.subject-placeholder')}
							value={subject}
							onChange={(e) => setSubject(e.target.value)}
						/>
					</div>

					<div className="space-y-1">
						<label htmlFor="compose-body" className="text-xs font-medium text-foreground">
							{t('mail.compose.body')}
						</label>
						<textarea
							id="compose-body"
							rows={4}
							required
							value={bodyText}
							onChange={(e) => setBodyText(e.target.value)}
							className="w-full resize-y rounded-md border border-border bg-background px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-ring"
						/>
					</div>

					<div className="grid gap-2 sm:grid-cols-2">
						<div className="space-y-1">
							<label htmlFor="compose-send-later" className="text-xs font-medium text-foreground">
								{t('mail.send-later.custom')}
							</label>
							<Input
								id="compose-send-later"
								type="datetime-local"
								value={scheduledSendAt}
								onChange={(e) => setScheduledSendAt(e.target.value)}
								className="h-8 text-xs"
							/>
						</div>
						<div className="space-y-1">
							<label htmlFor="compose-follow-up" className="text-xs font-medium text-foreground">
								{t('mail.followup.custom')}
							</label>
							<div className="flex gap-1.5">
								<Input
									id="compose-follow-up"
									type="datetime-local"
									value={followUpAt}
									onChange={(e) => setFollowUpAt(e.target.value)}
									className="h-8 text-xs"
								/>
								{followUpAt ? (
									<select
										aria-label={t('mail.followup.title')}
										value={followUpCondition}
										onChange={(e) => setFollowUpCondition(e.target.value as 'if_no_reply' | 'always')}
										className="h-8 rounded-md border border-border bg-background px-1.5 text-[11px]"
									>
										<option value="if_no_reply">{t('mail.followup.condition-no-reply')}</option>
										<option value="always">{t('mail.followup.condition-always')}</option>
									</select>
								) : null}
							</div>
						</div>
					</div>

					<div className="flex flex-wrap items-center gap-2">
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

					<DialogFooter>
						<Button type="button" tone="outline" onClick={() => onOpenChange(false)}>
							{t('chat.pins.close')}
						</Button>
						<Button type="submit" loading={busy} disabled={busy || uploading || identities.length === 0}>
							{t('mail.compose.create')}
						</Button>
					</DialogFooter>
				</form>
			</DialogContent>
		</Dialog>
	)
}
