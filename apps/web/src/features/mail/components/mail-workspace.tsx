import type { MailIdentityDto } from '@huriro/contracts'
import { type MessageId, t } from '@huriro/i18n'
import { Keyboard, Lock, PenSquare, Users } from 'lucide-react'
import { useCallback, useEffect, useMemo, useState } from 'react'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { EmptyState } from '@/components/ui/empty-state'
import { ErrorState } from '@/components/ui/error-state'
import { Input } from '@/components/ui/input'
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover'
import type { WorkspaceMemberSummary } from '@/lib/api-bridge'
import { navigateToDoc } from '@/lib/navigation'
import { cn } from '@/lib/utils'
import { useWorkspace } from '@/lib/workspace'
import { useUiStore } from '@/stores/ui-store'
import { type MailNavView, parseInboxSplitTabs, useMailStore } from '../store/mail-store'
import { BulkTriageBar } from './bulk-triage-bar'
import { ComposeOutboundDialog } from './compose-outbound-dialog'
import { ContactContextSidebar } from './contact-context-sidebar'
import { ConversationList } from './conversation-list'
import { ConversationView, type MailShortcutSignal } from './conversation-view'
import { ForwardDialog } from './forward-dialog'

const MAIL_VIEW_FILTERS: readonly { readonly key: MailNavView; readonly labelId: MessageId }[] = [
	{ key: 'all', labelId: 'inbox.all' },
	{ key: 'unassigned', labelId: 'mail.sidebar.unassigned' },
	{ key: 'mine', labelId: 'mail.sidebar.assigned-to-me' },
	{ key: 'snoozed', labelId: 'mail.sidebar.snoozed' },
	{ key: 'closed', labelId: 'mail.sidebar.closed' }
]

const MAIL_SHORTCUTS_LIST: readonly { readonly keyLabel: string; readonly description: string }[] = [
	{ keyLabel: 'E', description: 'Close conversation' },
	{ keyLabel: 'H', description: 'Snooze 1 day' },
	{ keyLabel: 'C', description: 'New outbound email' },
	{ keyLabel: 'R / A', description: 'Reply / Reply all' },
	{ keyLabel: 'F', description: 'Forward conversation' },
	{ keyLabel: 'N', description: 'Internal note' },
	{ keyLabel: ';', description: 'Insert snippet' },
	{ keyLabel: '⌘/Ctrl+M', description: 'Run macro' },
	{ keyLabel: 'G / L', description: 'Assign / Add tag' },
	{ keyLabel: 'Shift+I', description: 'Convert to task' }
]

export function MailWorkspace({
	requestedConversationId
}: {
	readonly requestedConversationId?: string | undefined
}) {
	const { api, engine, currentUserId } = useWorkspace()
	const inboxes = useMailStore((s) => s.inboxes)
	const inboxesLoaded = useMailStore((s) => s.inboxesLoaded)
	const conversations = useMailStore((s) => s.conversations)
	const nextCursor = useMailStore((s) => s.nextCursor)
	const activeInboxId = useMailStore((s) => s.activeInboxId)
	const activeView = useMailStore((s) => s.activeView)
	const activeTagId = useMailStore((s) => s.activeTagId)
	const activeSplitTabId = useMailStore((s) => s.activeSplitTabId)
	const searchQuery = useMailStore((s) => s.searchQuery)
	const activeConversationId = useMailStore((s) => s.activeConversationId)
	const timeline = useMailStore((s) => s.timeline)
	const loading = useMailStore((s) => s.loading)
	const loadingTimeline = useMailStore((s) => s.loadingTimeline)
	const loadingMore = useMailStore((s) => s.loadingMore)
	const error = useMailStore((s) => s.error)
	const lastSentDraftId = useMailStore((s) => s.lastSentDraftId)
	const lastSentAt = useMailStore((s) => s.lastSentAt)
	const tags = useMailStore((s) => s.tags)
	const tagsByConversation = useMailStore((s) => s.tagsByConversation)
	const templates = useMailStore((s) => s.templates)
	const macros = useMailStore((s) => s.macros)
	const contacts = useMailStore((s) => s.contacts)
	const organizations = useMailStore((s) => s.organizations)
	const selectedConversationIds = useMailStore((s) => s.selectedConversationIds)
	const contactSidebarOpen = useMailStore((s) => s.contactSidebarOpen)
	const composeOpen = useMailStore((s) => s.composeOpen)
	const forwardOpen = useMailStore((s) => s.forwardOpen)
	const aiAssistResult = useMailStore((s) => s.aiAssistResult)
	const aiAssistLoading = useMailStore((s) => s.aiAssistLoading)
	const aiAssistError = useMailStore((s) => s.aiAssistError)

	const loadInboxes = useMailStore((s) => s.loadInboxes)
	const loadConversations = useMailStore((s) => s.loadConversations)
	const loadMore = useMailStore((s) => s.loadMore)
	const selectConversation = useMailStore((s) => s.selectConversation)
	const refreshTimeline = useMailStore((s) => s.refreshTimeline)
	const setInbox = useMailStore((s) => s.setInbox)
	const setView = useMailStore((s) => s.setView)
	const setActiveTagId = useMailStore((s) => s.setActiveTagId)
	const setActiveSplitTabId = useMailStore((s) => s.setActiveSplitTabId)
	const setSearchQuery = useMailStore((s) => s.setSearchQuery)
	const patchConversation = useMailStore((s) => s.patchConversation)
	const addNote = useMailStore((s) => s.addNote)
	const saveReplyDraft = useMailStore((s) => s.saveReplyDraft)
	const sendDraft = useMailStore((s) => s.sendDraft)
	const scheduleDraftSend = useMailStore((s) => s.scheduleDraftSend)
	const undoSend = useMailStore((s) => s.undoSend)
	const loadMailV2Metadata = useMailStore((s) => s.loadMailV2Metadata)
	const createTag = useMailStore((s) => s.createTag)
	const setConversationTags = useMailStore((s) => s.setConversationTags)
	const renderTemplate = useMailStore((s) => s.renderTemplate)
	const applyMacro = useMailStore((s) => s.applyMacro)
	const createOutbound = useMailStore((s) => s.createOutbound)
	const forwardConversation = useMailStore((s) => s.forwardConversation)
	const splitConversation = useMailStore((s) => s.splitConversation)
	const toggleSelectConversation = useMailStore((s) => s.toggleSelectConversation)
	const clearSelection = useMailStore((s) => s.clearSelection)
	const bulkTriage = useMailStore((s) => s.bulkTriage)
	const upsertContact = useMailStore((s) => s.upsertContact)
	const upsertOrganization = useMailStore((s) => s.upsertOrganization)
	const routeRoundRobin = useMailStore((s) => s.routeRoundRobin)
	const requestDraftReview = useMailStore((s) => s.requestDraftReview)
	const completeDraftReview = useMailStore((s) => s.completeDraftReview)
	const assistWithAi = useMailStore((s) => s.assistWithAi)
	const clearAiAssist = useMailStore((s) => s.clearAiAssist)
	const setContactSidebarOpen = useMailStore((s) => s.setContactSidebarOpen)
	const setComposeOpen = useMailStore((s) => s.setComposeOpen)
	const setForwardOpen = useMailStore((s) => s.setForwardOpen)

	const setDestination = useUiStore((s) => s.setDestination)
	const selectIssue = useUiStore((s) => s.selectIssue)
	const setSettingsSection = useUiStore((s) => s.setSettingsSection)

	const [identities, setIdentities] = useState<MailIdentityDto[]>([])
	const [members, setMembers] = useState<WorkspaceMemberSummary[]>([])
	const [accountsLoaded, setAccountsLoaded] = useState(false)
	const [shortcutSignal, setShortcutSignal] = useState<MailShortcutSignal | null>(null)

	const dispatchShortcut = useCallback((kind: MailShortcutSignal['kind']) => {
		setShortcutSignal((prev) => ({ kind, seq: (prev?.seq ?? 0) + 1 }))
	}, [])

	// Boot: inboxes, identities, workspace members, first page of conversations.
	useEffect(() => {
		if (accountsLoaded) return
		setAccountsLoaded(true)
		if (!inboxesLoaded) void loadInboxes(api)
		void api
			.listMailIdentities()
			.then(setIdentities)
			.catch(() => setIdentities([]))
		void api
			.listMembers()
			.then(setMembers)
			.catch(() => setMembers([]))
		void loadConversations(api)
	}, [api, accountsLoaded, inboxesLoaded, loadInboxes, loadConversations])

	useEffect(() => {
		void loadMailV2Metadata(api, activeInboxId)
	}, [activeInboxId, api, loadMailV2Metadata])

	useEffect(() => {
		if (requestedConversationId && requestedConversationId !== activeConversationId) {
			void selectConversation(api, requestedConversationId)
		}
	}, [api, requestedConversationId, activeConversationId, selectConversation])

	const projects = useMemo(
		() =>
			engine.collections.projects.toArray
				.filter((p) => p.archivedAt === null)
				.map((p) => ({ id: p.id, name: p.name })),
		[engine.collections.projects.toArray]
	)
	const availableIssues = useMemo(
		() =>
			engine.collections.issues.toArray.slice(0, 50).map((iss) => ({
				id: iss.id,
				identifier: iss.identifier,
				title: iss.title
			})),
		[engine.collections.issues.toArray]
	)
	const availableDocs = useMemo(
		() =>
			engine.collections.docPages.toArray.slice(0, 50).map((doc) => ({
				id: doc.id,
				slug: doc.slug,
				title: doc.title
			})),
		[engine.collections.docPages.toArray]
	)

	// Mail keyboard shortcuts (§6.6) guarded against text inputs/dialogs.
	useEffect(() => {
		const handleKeyDown = (e: KeyboardEvent) => {
			if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === 'm') {
				if (activeConversationId) {
					e.preventDefault()
					dispatchShortcut('macro')
				}
				return
			}
			const target = e.target as HTMLElement | null
			const tagName = (target?.tagName ?? '').toLowerCase()
			if (
				tagName === 'input' ||
				tagName === 'textarea' ||
				tagName === 'select' ||
				target?.isContentEditable ||
				composeOpen ||
				forwardOpen ||
				e.metaKey ||
				e.ctrlKey ||
				e.altKey
			) {
				return
			}
			const key = e.key
			const lower = key.toLowerCase()
			if (lower === 'c') {
				e.preventDefault()
				setComposeOpen(true)
			} else if (!activeConversationId) {
				return
			} else if (lower === 'e') {
				e.preventDefault()
				void patchConversation(api, activeConversationId, { status: 'closed' })
			} else if (lower === 'h') {
				e.preventDefault()
				void patchConversation(api, activeConversationId, {
					snoozedUntil: new Date(Date.now() + 86_400_000).toISOString()
				})
			} else if (lower === 'r') {
				e.preventDefault()
				dispatchShortcut('reply')
			} else if (lower === 'a') {
				e.preventDefault()
				dispatchShortcut('reply_all')
			} else if (lower === 'f') {
				e.preventDefault()
				setForwardOpen(true)
			} else if (lower === 'n') {
				e.preventDefault()
				dispatchShortcut('note')
			} else if (key === ';') {
				e.preventDefault()
				dispatchShortcut('snippet')
			} else if (lower === 'g') {
				e.preventDefault()
				dispatchShortcut('assign')
			} else if (lower === 'l') {
				e.preventDefault()
				dispatchShortcut('tag')
			} else if (e.shiftKey && lower === 'i' && projects[0]) {
				e.preventDefault()
				void api.convertMailToIssue(activeConversationId, { projectId: projects[0].id }).then(() => {
					void refreshTimeline(api)
				})
			}
		}
		window.addEventListener('keydown', handleKeyDown)
		return () => window.removeEventListener('keydown', handleKeyDown)
	}, [
		activeConversationId,
		api,
		composeOpen,
		dispatchShortcut,
		forwardOpen,
		patchConversation,
		projects,
		refreshTimeline,
		setComposeOpen,
		setForwardOpen
	])

	const activeInbox = useMemo(
		() => inboxes.find((inbox) => inbox.id === activeInboxId) ?? null,
		[activeInboxId, inboxes]
	)
	const customSplitTabs = useMemo(
		() =>
			activeInbox
				? parseInboxSplitTabs(activeInbox.settings)
				: inboxes.flatMap((inbox) => parseInboxSplitTabs(inbox.settings)),
		[activeInbox, inboxes]
	)
	const headerOpenCount = activeInbox
		? activeInbox.openCount
		: inboxes.reduce((sum, inbox) => sum + inbox.openCount, 0)

	const tagsById = useMemo(() => new Map(tags.map((item) => [item.id, item])), [tags])
	const activeConv = timeline?.conversation ?? null
	const activeConvTags = activeConversationId ? (tagsByConversation[activeConversationId] ?? []) : []
	const activeContact = useMemo(() => {
		if (!activeConv) return null
		if (activeConv.contactId) {
			return contacts.find((c) => c.id === activeConv.contactId) ?? null
		}
		if (activeConv.customerEmail) {
			const email = activeConv.customerEmail.toLowerCase()
			return contacts.find((c) => c.email.toLowerCase() === email) ?? null
		}
		return null
	}, [activeConv, contacts])
	const activeOrganization = useMemo(() => {
		if (!activeContact?.organizationId) return null
		return organizations.find((o) => o.id === activeContact.organizationId) ?? null
	}, [activeContact, organizations])
	const sameContactConversations = useMemo(() => {
		if (!activeConv) return []
		const email = activeConv.customerEmail?.toLowerCase()
		return conversations.filter(
			(c) =>
				c.id !== activeConv.id &&
				((activeConv.contactId && c.contactId === activeConv.contactId) ||
					(email && c.customerEmail?.toLowerCase() === email))
		)
	}, [activeConv, conversations])
	const senderConversationCount = sameContactConversations.length + (activeConv?.customerEmail ? 1 : 0)

	const handleOpenIssue = useCallback(
		(taskId: string) => {
			selectIssue(taskId, true)
			setDestination('tasks')
		},
		[selectIssue, setDestination]
	)

	const handleOpenDoc = useCallback((pageId: string, slug: string | null) => {
		navigateToDoc(slug ?? pageId)
	}, [])

	if (error && conversations.length === 0) {
		return (
			<ErrorState
				title={t('mail.error.load')}
				action={
					<button type="button" className="text-sm underline" onClick={() => void loadConversations(api)}>
						{t('mail.action.retry')}
					</button>
				}
			/>
		)
	}

	return (
		<div className="flex h-full flex-col">
			<header className="flex flex-wrap items-center justify-between gap-2 border-b border-border px-4 py-2.5">
				<div className="flex flex-wrap items-center gap-2">
					<h1 className="text-base font-semibold tracking-tight">
						{activeInbox?.name ?? t('mail.sidebar.all')}
					</h1>
					{headerOpenCount > 0 ? <Badge tone="info">{headerOpenCount}</Badge> : null}

					{inboxes.length > 0 ? (
						<nav className="ml-2 flex flex-wrap items-center gap-1" aria-label={t('mail.sidebar.inboxes')}>
							<button
								type="button"
								aria-pressed={activeInboxId === null}
								onClick={() => void setInbox(api, null)}
								className={cn(
									'rounded-sm px-2 py-0.5 text-xs font-medium transition-colors',
									activeInboxId === null
										? 'bg-accent text-foreground'
										: 'text-muted-foreground hover:text-foreground'
								)}
							>
								{t('mail.inboxes.all')}
							</button>
							{inboxes.map((inbox) => (
								<button
									key={inbox.id}
									type="button"
									aria-pressed={activeInboxId === inbox.id}
									onClick={() => void setInbox(api, inbox.id)}
									className={cn(
										'inline-flex items-center gap-1 rounded-sm px-2 py-0.5 text-xs font-medium transition-colors',
										activeInboxId === inbox.id
											? 'bg-accent text-foreground'
											: 'text-muted-foreground hover:text-foreground'
									)}
								>
									{inbox.visibility === 'private' ? (
										<Lock className="size-3" aria-hidden />
									) : (
										<Users className="size-3" aria-hidden />
									)}
									<span>{inbox.name}</span>
								</button>
							))}
						</nav>
					) : null}
				</div>

				<div className="flex flex-wrap items-center gap-2">
					<fieldset
						aria-label={t('mail.split-tabs.title')}
						className="m-0 inline-flex flex-wrap items-center gap-1 rounded-md border-0 bg-muted p-1"
					>
						{MAIL_VIEW_FILTERS.map(({ key, labelId }) => {
							const active = activeView === key && activeSplitTabId === null
							return (
								<button
									key={key}
									type="button"
									aria-pressed={active}
									onClick={() => void setView(api, key)}
									className={cn(
										'rounded-sm px-2.5 py-1 text-xs font-medium transition-colors',
										active
											? 'bg-background text-foreground shadow-(--shadow-1)'
											: 'text-muted-foreground hover:text-foreground'
									)}
								>
									{t(labelId)}
								</button>
							)
						})}
						{customSplitTabs.map((tab) => {
							const active = activeSplitTabId === tab.id
							return (
								<button
									key={tab.id}
									type="button"
									aria-pressed={active}
									onClick={() => void setActiveSplitTabId(api, active ? null : tab.id)}
									className={cn(
										'rounded-sm px-2.5 py-1 text-xs font-medium transition-colors',
										active
											? 'bg-background text-foreground shadow-(--shadow-1)'
											: 'text-muted-foreground hover:text-foreground'
									)}
								>
									{tab.name}
								</button>
							)
						})}
					</fieldset>

					<Popover>
						<PopoverTrigger asChild>
							<Button size="sm" tone="outline" type="button" aria-label={t('mail.shortcuts.title')}>
								<Keyboard className="size-3.5" aria-hidden />
								<span>{t('mail.shortcuts.hint')}</span>
							</Button>
						</PopoverTrigger>
						<PopoverContent className="w-64 p-3" align="end">
							<p className="mb-2 text-xs font-semibold text-foreground">{t('mail.shortcuts.title')}</p>
							<ul className="space-y-1 text-xs">
								{MAIL_SHORTCUTS_LIST.map((item) => (
									<li key={item.keyLabel} className="flex items-center justify-between gap-2">
										<span className="text-muted-foreground">{item.description}</span>
										<kbd className="rounded border border-border bg-muted px-1.5 py-0.5 font-mono text-[10px]">
											{item.keyLabel}
										</kbd>
									</li>
								))}
							</ul>
						</PopoverContent>
					</Popover>

					<Button size="sm" type="button" onClick={() => setComposeOpen(true)}>
						<PenSquare className="size-3.5" aria-hidden />
						{t('mail.compose.new')}
					</Button>

					{inboxes.length === 0 ? (
						<Button
							size="sm"
							tone="outline"
							onClick={() => {
								setSettingsSection('mail')
								setDestination('settings')
							}}
						>
							{t('mail.settings.title')}
						</Button>
					) : null}
				</div>
			</header>

			<div className="flex min-h-0 flex-1">
				<div className="flex w-80 shrink-0 flex-col border-r border-border">
					<div className="space-y-2 border-b border-border p-2">
						<Input
							value={searchQuery}
							onChange={(e) => void setSearchQuery(api, e.target.value)}
							placeholder={t('mail.list.search-placeholder')}
							aria-label={t('mail.list.search-placeholder')}
						/>
						{tags.length > 0 ? (
							<div className="flex flex-wrap gap-1">
								<button
									type="button"
									aria-pressed={activeTagId === null}
									onClick={() => void setActiveTagId(api, null)}
									className={cn(
										'rounded-full border px-2 py-0.5 text-[11px] font-medium',
										activeTagId === null
											? 'border-primary bg-primary/10 text-primary'
											: 'border-border text-muted-foreground hover:text-foreground'
									)}
								>
									{t('mail.tags.filter-all')}
								</button>
								{tags.map((tag) => (
									<button
										key={tag.id}
										type="button"
										aria-pressed={activeTagId === tag.id}
										aria-label={t('mail.tags.filter-by', { name: tag.name })}
										onClick={() => void setActiveTagId(api, activeTagId === tag.id ? null : tag.id)}
										className={cn(
											'rounded-full border px-2 py-0.5 text-[11px] font-medium',
											activeTagId === tag.id
												? 'border-primary bg-primary/10 text-primary'
												: 'border-border text-muted-foreground hover:text-foreground'
										)}
									>
										{tag.name}
									</button>
								))}
							</div>
						) : null}
					</div>
					<div className="flex-1 overflow-y-auto">
						<ConversationList
							conversations={conversations}
							activeId={activeConversationId}
							selectedIds={selectedConversationIds}
							tagsById={tagsById}
							bulkBar={
								<BulkTriageBar
									selectedCount={selectedConversationIds.length}
									tags={tags}
									members={members}
									currentUserId={currentUserId}
									onBulkTriage={(body) => bulkTriage(api, body)}
									onClear={clearSelection}
								/>
							}
							loading={loading}
							hasMore={nextCursor !== null}
							loadingMore={loadingMore}
							onSelect={(id) => void selectConversation(api, id)}
							onToggleSelect={toggleSelectConversation}
							onLoadMore={() => void loadMore(api)}
						/>
					</div>
				</div>

				<div className="min-w-0 flex-1">
					{activeConversationId ? (
						<ConversationView
							timeline={timeline}
							loading={loadingTimeline}
							identities={identities}
							currentUserId={currentUserId}
							lastSentDraftId={lastSentDraftId}
							lastSentAt={lastSentAt}
							undoWindowSeconds={10}
							tags={activeConvTags}
							availableTags={tags}
							templates={templates}
							macros={macros}
							members={members}
							contacts={contacts}
							availableIssues={availableIssues}
							availableDocs={availableDocs}
							aiResult={aiAssistResult}
							aiLoading={aiAssistLoading}
							aiError={aiAssistError}
							shortcutSignal={shortcutSignal}
							contactSidebarOpen={contactSidebarOpen}
							onPatch={(body) => patchConversation(api, activeConversationId, body)}
							onAddNote={(bodyText) => addNote(api, activeConversationId, bodyText)}
							onSaveReplyDraft={(body) => saveReplyDraft(api, activeConversationId, body)}
							onSendDraft={(draftId) => sendDraft(api, draftId)}
							onScheduleSend={(draftId, scheduledSendAt, expectedVersion) =>
								scheduleDraftSend(api, draftId, scheduledSendAt, expectedVersion)
							}
							onUndoSend={(draftId) => undoSend(api, draftId)}
							onConvertToIssue={async (projectId) => {
								await api.convertMailToIssue(activeConversationId, { projectId })
								await refreshTimeline(api)
							}}
							onLinkIssue={async (taskId) => {
								await api.linkMailConversation(activeConversationId, { taskId })
								await refreshTimeline(api)
							}}
							onLinkDoc={async (pageId) => {
								await api.linkMailConversation(activeConversationId, { pageId })
								await refreshTimeline(api)
							}}
							onOpenIssue={handleOpenIssue}
							onOpenDoc={handleOpenDoc}
							onToggleTag={async (tagId) => {
								const currentIds = new Set(activeConvTags.map((item) => item.id))
								if (currentIds.has(tagId)) currentIds.delete(tagId)
								else currentIds.add(tagId)
								await setConversationTags(api, activeConversationId, [...currentIds])
							}}
							onCreateTag={(body) => createTag(api, body)}
							onRenderTemplate={(templateId, vars) => renderTemplate(api, templateId, vars)}
							onApplyMacro={(macroId) => applyMacro(api, macroId, [activeConversationId])}
							onOpenForward={() => setForwardOpen(true)}
							onSplitMessage={async (messageId) => {
								await splitConversation(api, activeConversationId, { messageId })
							}}
							onRouteRoundRobin={async () => {
								await routeRoundRobin(api, activeConversationId)
							}}
							onToggleContactSidebar={() => setContactSidebarOpen(!contactSidebarOpen)}
							onRequestDraftReview={(draftId, body) => requestDraftReview(api, draftId, body)}
							onCompleteDraftReview={(draftId, body) => completeDraftReview(api, draftId, body)}
							onAssistAi={async (mode) => {
								await assistWithAi(api, activeConversationId, mode)
							}}
							onClearAi={clearAiAssist}
							projects={projects}
						/>
					) : (
						<EmptyState title={t('mail.conv.select-hint')} className="h-full justify-center p-6" />
					)}
				</div>

				{contactSidebarOpen && activeConv ? (
					<ContactContextSidebar
						customerEmail={activeConv.customerEmail}
						contact={activeContact}
						organization={activeOrganization}
						conversationCount={senderConversationCount}
						historyConversations={sameContactConversations}
						linkedTasks={timeline?.linkedTasks}
						linkedDocs={timeline?.linkedDocs}
						onSelectConversation={(convId) => void selectConversation(api, convId)}
						onOpenIssue={handleOpenIssue}
						onOpenDoc={handleOpenDoc}
						onSaveContact={(body, id) => upsertContact(api, body, id)}
						onSaveOrganization={(body, id) => upsertOrganization(api, body, id)}
						onClose={() => setContactSidebarOpen(false)}
					/>
				) : null}
			</div>

			<ComposeOutboundDialog
				open={composeOpen}
				onOpenChange={setComposeOpen}
				inboxes={inboxes}
				identities={identities}
				contacts={contacts}
				defaultInboxId={activeInboxId}
				onSubmit={async (body) => {
					await createOutbound(api, body)
				}}
			/>

			{activeConv ? (
				<ForwardDialog
					open={forwardOpen}
					onOpenChange={setForwardOpen}
					subject={activeConv.subject}
					identities={identities}
					contacts={contacts}
					onSubmit={async (body) => {
						await forwardConversation(api, activeConv.id, body)
					}}
				/>
			) : null}
		</div>
	)
}
