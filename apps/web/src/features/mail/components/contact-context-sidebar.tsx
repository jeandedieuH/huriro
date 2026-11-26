import type {
	ContactBody,
	ContactDto,
	ContactOrganizationBody,
	ContactOrganizationDto,
	ContactTier,
	MailConversationDto,
	MailTimelineDto
} from '@huriro/contracts'
import { t } from '@huriro/i18n'
import { Building2, ExternalLink, MessageSquare, User, X } from 'lucide-react'
import { useEffect, useState } from 'react'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'

export interface ContactContextSidebarProps {
	readonly customerEmail: string | null
	readonly contact: ContactDto | null
	readonly organization: ContactOrganizationDto | null
	readonly conversationCount: number
	readonly historyConversations?: readonly MailConversationDto[] | undefined
	readonly linkedTasks?: MailTimelineDto['linkedTasks'] | undefined
	readonly linkedDocs?: MailTimelineDto['linkedDocs'] | undefined
	readonly onSelectConversation?: ((conversationId: string) => void) | undefined
	readonly onOpenIssue?: ((taskId: string) => void) | undefined
	readonly onOpenDoc?: ((pageId: string, slug: string | null) => void) | undefined
	readonly onSaveContact: (body: ContactBody, id?: string) => Promise<unknown>
	readonly onSaveOrganization?:
		| ((body: ContactOrganizationBody, id?: string) => Promise<ContactOrganizationDto>)
		| undefined
	readonly onClose: () => void
}

function tierBadgeTone(tier: ContactTier): 'secondary' | 'warning' | 'info' {
	if (tier === 'strategic') return 'info'
	if (tier === 'vip') return 'warning'
	return 'secondary'
}

/**
 * Right-hand customer context rail showing the contact profile, organization tier & editor,
 * clickable previous conversations, linked Huriro work, and inline contact editing.
 */
export function ContactContextSidebar({
	customerEmail,
	contact,
	organization,
	conversationCount,
	historyConversations = [],
	linkedTasks = [],
	linkedDocs = [],
	onSelectConversation,
	onOpenIssue,
	onOpenDoc,
	onSaveContact,
	onSaveOrganization,
	onClose
}: ContactContextSidebarProps) {
	const [displayName, setDisplayName] = useState(contact?.displayName ?? '')
	const [title, setTitle] = useState(contact?.title ?? '')
	const [vipTier, setVipTier] = useState<ContactTier>(contact?.vipTier ?? 'standard')
	const [notes, setNotes] = useState(contact?.notes ?? '')
	const [busy, setBusy] = useState(false)

	const [orgEditorOpen, setOrgEditorOpen] = useState(false)
	const [orgName, setOrgName] = useState(organization?.name ?? '')
	const [orgDomain, setOrgDomain] = useState(organization?.domain ?? '')
	const [orgTier, setOrgTier] = useState<ContactTier>(organization?.tier ?? 'standard')
	const [orgNotes, setOrgNotes] = useState(organization?.notes ?? '')
	const [orgBusy, setOrgBusy] = useState(false)

	useEffect(() => {
		setDisplayName(contact?.displayName ?? '')
		setTitle(contact?.title ?? '')
		setVipTier(contact?.vipTier ?? 'standard')
		setNotes(contact?.notes ?? '')
	}, [contact])

	useEffect(() => {
		setOrgName(organization?.name ?? '')
		setOrgDomain(organization?.domain ?? '')
		setOrgTier(organization?.tier ?? 'standard')
		setOrgNotes(organization?.notes ?? '')
	}, [organization])

	const handleSubmit = async (ev: React.FormEvent) => {
		ev.preventDefault()
		const email = contact?.email ?? customerEmail
		if (!email || busy) return
		setBusy(true)
		try {
			await onSaveContact(
				{
					email,
					...(displayName.trim() ? { displayName: displayName.trim() } : {}),
					...(title.trim() ? { title: title.trim() } : {}),
					vipTier,
					...(notes.trim() ? { notes: notes.trim() } : {}),
					organizationId: organization?.id ?? contact?.organizationId ?? null
				},
				contact?.id
			)
		} finally {
			setBusy(false)
		}
	}

	const handleSaveOrg = async (ev: React.FormEvent) => {
		ev.preventDefault()
		if (!onSaveOrganization || !orgName.trim() || orgBusy) return
		setOrgBusy(true)
		try {
			const savedOrg = await onSaveOrganization(
				{
					name: orgName.trim(),
					domain: orgDomain.trim() ? orgDomain.trim() : null,
					tier: orgTier,
					notes: orgNotes.trim()
				},
				organization?.id
			)
			const email = contact?.email ?? customerEmail
			if (email) {
				await onSaveContact(
					{
						email,
						...(displayName.trim() ? { displayName: displayName.trim() } : {}),
						...(title.trim() ? { title: title.trim() } : {}),
						vipTier,
						...(notes.trim() ? { notes: notes.trim() } : {}),
						organizationId: savedOrg.id
					},
					contact?.id
				)
			}
			setOrgEditorOpen(false)
		} finally {
			setOrgBusy(false)
		}
	}

	return (
		<aside
			className="flex w-76 shrink-0 flex-col border-l border-border bg-card"
			aria-label={t('mail.contact.title')}
			data-testid="contact-context-sidebar"
		>
			<header className="flex items-center justify-between border-b border-border px-4 py-3">
				<div className="flex items-center gap-2">
					<User className="size-4 text-muted-foreground" aria-hidden />
					<h2 className="text-sm font-semibold">{t('mail.contact.title')}</h2>
				</div>
				<Button size="icon" tone="ghost" aria-label={t('chat.pins.close')} onClick={onClose}>
					<X className="size-4" aria-hidden />
				</Button>
			</header>

			<div className="flex-1 space-y-4 overflow-y-auto p-4 text-sm">
				<div className="space-y-1">
					<div className="flex items-center justify-between gap-2">
						<span className="truncate font-medium text-foreground">
							{contact?.displayName ?? customerEmail ?? '—'}
						</span>
						<Badge tone={tierBadgeTone(vipTier)}>
							{t(`mail.contact.tier.${vipTier}` as 'mail.contact.tier.standard')}
						</Badge>
					</div>
					{customerEmail ? <p className="truncate text-xs text-muted-foreground">{customerEmail}</p> : null}
					<p className="text-xs text-muted-foreground">
						{t('mail.conv.messages', { count: conversationCount })}
					</p>
				</div>

				<div className="space-y-2 rounded-md border border-border bg-background p-2.5 text-xs">
					<div className="flex items-center justify-between gap-2">
						<div className="flex items-center gap-1.5 font-medium text-foreground">
							<Building2 className="size-3.5 text-muted-foreground" aria-hidden />
							<span>{organization?.name ?? t('mail.contact.org-section')}</span>
						</div>
						{onSaveOrganization ? (
							<button
								type="button"
								onClick={() => setOrgEditorOpen((v) => !v)}
								className="text-[11px] font-medium text-primary hover:underline"
							>
								{organization ? t('mail.contact.org-edit') : t('mail.contact.org-create')}
							</button>
						) : null}
					</div>
					{organization?.domain ? (
						<p className="text-muted-foreground">{organization.domain}</p>
					) : !organization && !contact ? (
						<p className="text-muted-foreground">{t('mail.contact.empty')}</p>
					) : null}

					{orgEditorOpen && onSaveOrganization ? (
						<form onSubmit={(ev) => void handleSaveOrg(ev)} className="space-y-2 border-t border-border pt-2">
							<Input
								aria-label={t('mail.contact.org-name')}
								placeholder={t('mail.contact.org-name')}
								value={orgName}
								onChange={(e) => setOrgName(e.target.value)}
								className="h-8 text-xs"
							/>
							<Input
								aria-label={t('mail.contact.org-domain')}
								placeholder={t('mail.contact.org-domain')}
								value={orgDomain}
								onChange={(e) => setOrgDomain(e.target.value)}
								className="h-8 text-xs"
							/>
							<select
								aria-label={t('mail.contact.org-tier')}
								value={orgTier}
								onChange={(e) => setOrgTier(e.target.value as ContactTier)}
								className="h-8 w-full rounded-md border border-border bg-background px-2 text-xs"
							>
								<option value="standard">{t('mail.contact.tier.standard')}</option>
								<option value="vip">{t('mail.contact.tier.vip')}</option>
								<option value="strategic">{t('mail.contact.tier.strategic')}</option>
							</select>
							<Input
								aria-label={t('mail.contact.org-notes')}
								placeholder={t('mail.contact.org-notes')}
								value={orgNotes}
								onChange={(e) => setOrgNotes(e.target.value)}
								className="h-8 text-xs"
							/>
							<div className="flex gap-1.5">
								<Button size="sm" type="submit" disabled={orgBusy || !orgName.trim()} className="flex-1">
									{t('mail.contact.org-save')}
								</Button>
								<Button size="sm" tone="outline" type="button" onClick={() => setOrgEditorOpen(false)}>
									{t('mail.settings.cancel-edit')}
								</Button>
							</div>
						</form>
					) : null}
				</div>

				{customerEmail || contact ? (
					<form onSubmit={(ev) => void handleSubmit(ev)} className="space-y-2.5">
						<div className="space-y-1">
							<label htmlFor="contact-display-name" className="text-xs font-medium text-foreground">
								{t('mail.settings.display-name')}
							</label>
							<Input
								id="contact-display-name"
								value={displayName}
								onChange={(e) => setDisplayName(e.target.value)}
							/>
						</div>
						<div className="space-y-1">
							<label htmlFor="contact-tier" className="text-xs font-medium text-foreground">
								{t('mail.contact.tier')}
							</label>
							<select
								id="contact-tier"
								value={vipTier}
								onChange={(e) => setVipTier(e.target.value as ContactTier)}
								className="h-9 w-full rounded-md border border-border bg-background px-2.5 text-xs"
							>
								<option value="standard">{t('mail.contact.tier.standard')}</option>
								<option value="vip">{t('mail.contact.tier.vip')}</option>
								<option value="strategic">{t('mail.contact.tier.strategic')}</option>
							</select>
						</div>
						<div className="space-y-1">
							<label htmlFor="contact-notes" className="text-xs font-medium text-foreground">
								{t('mail.contact.notes')}
							</label>
							<textarea
								id="contact-notes"
								rows={3}
								value={notes}
								onChange={(e) => setNotes(e.target.value)}
								className="w-full resize-y rounded-md border border-border bg-background px-2.5 py-1.5 text-xs focus:outline-none focus:ring-2 focus:ring-ring"
							/>
						</div>
						<Button size="sm" type="submit" loading={busy} disabled={busy} className="w-full">
							{t('mail.contact.save')}
						</Button>
					</form>
				) : null}

				<div className="space-y-1.5 border-t border-border pt-3 text-xs">
					<p className="font-semibold text-foreground">{t('mail.contact.history-title')}</p>
					{historyConversations.length === 0 ? (
						<p className="text-muted-foreground">{t('mail.contact.history-empty')}</p>
					) : (
						<ul className="space-y-1">
							{historyConversations.map((conv) => (
								<li key={conv.id}>
									<button
										type="button"
										onClick={() => onSelectConversation?.(conv.id)}
										className="flex w-full items-center justify-between gap-2 rounded-sm border border-border/70 bg-background px-2 py-1.5 text-left hover:bg-accent"
									>
										<span className="inline-flex min-w-0 items-center gap-1.5 truncate font-medium text-foreground">
											<MessageSquare className="size-3 shrink-0 text-muted-foreground" aria-hidden />
											<span className="truncate">{conv.subject}</span>
										</span>
										<Badge tone="secondary" className="shrink-0 text-[10px]">
											{t(`mail.conv.status.${conv.status}` as 'mail.conv.status.open')}
										</Badge>
									</button>
								</li>
							))}
						</ul>
					)}
				</div>

				{linkedTasks.length > 0 || linkedDocs.length > 0 ? (
					<div className="space-y-1.5 border-t border-border pt-3 text-xs">
						<p className="font-semibold text-foreground">{t('mail.contact.linked-work')}</p>
						<ul className="space-y-1">
							{linkedTasks.map((task) => (
								<li key={task.taskId}>
									<button
										type="button"
										onClick={() => onOpenIssue?.(task.taskId)}
										className="flex w-full items-center gap-1.5 rounded-sm border border-border/70 bg-background px-2 py-1.5 text-left text-foreground hover:bg-accent"
									>
										<ExternalLink className="size-3 shrink-0 text-muted-foreground" aria-hidden />
										<span className="truncate">
											{task.identifier ?? task.taskId.slice(0, 8)} {task.title ? `— ${task.title}` : ''}
										</span>
									</button>
								</li>
							))}
							{linkedDocs.map((doc) => (
								<li key={doc.pageId}>
									<button
										type="button"
										onClick={() => onOpenDoc?.(doc.pageId, doc.slug)}
										className="flex w-full items-center gap-1.5 rounded-sm border border-border/70 bg-background px-2 py-1.5 text-left text-foreground hover:bg-accent"
									>
										<ExternalLink className="size-3 shrink-0 text-muted-foreground" aria-hidden />
										<span className="truncate">{doc.title ?? doc.slug ?? doc.pageId.slice(0, 8)}</span>
									</button>
								</li>
							))}
						</ul>
					</div>
				) : null}
			</div>
		</aside>
	)
}
