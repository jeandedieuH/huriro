import type { ContactDto, ForwardConversationBody, MailAddress, MailIdentityDto } from '@huriro/contracts'
import { t } from '@huriro/i18n'
import { Paperclip, X } from 'lucide-react'
import { useEffect, useRef, useState } from 'react'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Checkbox } from '@/components/ui/checkbox'
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

export interface ForwardDialogProps {
	readonly open: boolean
	readonly onOpenChange: (open: boolean) => void
	readonly subject: string
	readonly identities: readonly MailIdentityDto[]
	readonly contacts?: readonly ContactDto[] | undefined
	readonly onSubmit: (body: ForwardConversationBody) => Promise<void>
}

interface AttachedFileChip {
	readonly id: string
	readonly filename: string
}

/**
 * Modal dialog for forwarding an existing shared-inbox conversation to an
 * external collaborator or vendor with To/Cc/Bcc autocomplete and attachments.
 */
export function ForwardDialog({
	open,
	onOpenChange,
	subject,
	identities,
	contacts = [],
	onSubmit
}: ForwardDialogProps) {
	const { api } = useWorkspace()
	const fileInputRef = useRef<HTMLInputElement | null>(null)
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
	const [bodyText, setBodyText] = useState('')
	const [includeHistory, setIncludeHistory] = useState(true)
	const [busy, setBusy] = useState(false)

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
		const resolvedIdentity = identityId || identities[0]?.id
		const toList = resolveRecipientList(toRecipients, toDraft)
		const ccList = resolveRecipientList(ccRecipients, ccDraft)
		const bccList = resolveRecipientList(bccRecipients, bccDraft)
		if (!resolvedIdentity || toList.length === 0 || !bodyText.trim() || busy) return
		setBusy(true)
		try {
			await onSubmit({
				identityId: resolvedIdentity,
				recipients: {
					to: toList,
					...(ccList.length > 0 ? { cc: ccList } : {}),
					...(bccList.length > 0 ? { bcc: bccList } : {})
				},
				bodyText: bodyText.trim(),
				includeHistory,
				...(scheduledSendAt ? { scheduledSendAt: new Date(scheduledSendAt).toISOString() } : {}),
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
			setBodyText('')
			onOpenChange(false)
		} finally {
			setBusy(false)
		}
	}

	return (
		<Dialog open={open} onOpenChange={onOpenChange}>
			<DialogContent className="sm:max-w-md">
				<DialogHeader>
					<DialogTitle>{t('mail.forward.title')}</DialogTitle>
					<DialogDescription>{subject}</DialogDescription>
				</DialogHeader>
				<form onSubmit={(ev) => void handleSubmit(ev)} className="space-y-3">
					<div className="space-y-1">
						<div className="flex items-center justify-between">
							<label htmlFor="forward-to" className="text-xs font-medium text-foreground">
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
							id="forward-to"
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
								<label htmlFor="forward-cc" className="text-xs font-medium text-foreground">
									{t('mail.compose.cc')}
								</label>
								<RecipientInput
									id="forward-cc"
									recipients={ccRecipients}
									draftText={ccDraft}
									onDraftTextChange={setCcDraft}
									onChange={setCcRecipients}
									contacts={contacts}
									placeholder={t('mail.compose.to-placeholder')}
								/>
							</div>
							<div className="space-y-1">
								<label htmlFor="forward-bcc" className="text-xs font-medium text-foreground">
									{t('mail.compose.bcc')}
								</label>
								<RecipientInput
									id="forward-bcc"
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
						<label htmlFor="forward-body" className="text-xs font-medium text-foreground">
							{t('mail.compose.body')}
						</label>
						<textarea
							id="forward-body"
							rows={3}
							required
							value={bodyText}
							onChange={(e) => setBodyText(e.target.value)}
							className="w-full resize-y rounded-md border border-border bg-background px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-ring"
						/>
					</div>

					<div className="space-y-1">
						<label htmlFor="forward-send-later" className="text-xs font-medium text-foreground">
							{t('mail.send-later.custom')}
						</label>
						<Input
							id="forward-send-later"
							type="datetime-local"
							value={scheduledSendAt}
							onChange={(e) => setScheduledSendAt(e.target.value)}
							className="h-8 text-xs"
						/>
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

					<div className="flex items-center gap-2">
						<Checkbox
							id="forward-include-history"
							checked={includeHistory}
							onCheckedChange={(checked) => setIncludeHistory(checked === true)}
						/>
						<label htmlFor="forward-include-history" className="cursor-pointer text-xs text-foreground">
							{t('mail.forward.include-history')}
						</label>
					</div>

					<DialogFooter>
						<Button type="button" tone="outline" onClick={() => onOpenChange(false)}>
							{t('mail.bulk.clear')}
						</Button>
						<Button type="submit" loading={busy} disabled={busy || uploading || identities.length === 0}>
							{t('mail.forward.submit')}
						</Button>
					</DialogFooter>
				</form>
			</DialogContent>
		</Dialog>
	)
}
