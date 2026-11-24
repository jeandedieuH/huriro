import type { MailIdentityDto } from '@huriro/contracts'
import { type MessageId, t } from '@huriro/i18n'
import { useEffect, useMemo, useState } from 'react'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { EmptyState } from '@/components/ui/empty-state'
import { ErrorState } from '@/components/ui/error-state'
import { Input } from '@/components/ui/input'
import { cn } from '@/lib/utils'
import { useWorkspace } from '@/lib/workspace'
import { useUiStore } from '@/stores/ui-store'
import { type MailNavView, useMailStore } from '../store/mail-store'
import { ConversationList } from './conversation-list'
import { ConversationView } from './conversation-view'

const MAIL_VIEW_FILTERS: readonly { readonly key: MailNavView; readonly labelId: MessageId }[] = [
	{ key: 'all', labelId: 'inbox.all' },
	{ key: 'unassigned', labelId: 'mail.sidebar.unassigned' },
	{ key: 'mine', labelId: 'mail.sidebar.assigned-to-me' },
	{ key: 'snoozed', labelId: 'mail.sidebar.snoozed' },
	{ key: 'closed', labelId: 'mail.sidebar.closed' }
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
	const searchQuery = useMailStore((s) => s.searchQuery)
	const activeConversationId = useMailStore((s) => s.activeConversationId)
	const timeline = useMailStore((s) => s.timeline)
	const loading = useMailStore((s) => s.loading)
	const loadingTimeline = useMailStore((s) => s.loadingTimeline)
	const loadingMore = useMailStore((s) => s.loadingMore)
	const error = useMailStore((s) => s.error)
	const lastSentDraftId = useMailStore((s) => s.lastSentDraftId)
	const lastSentAt = useMailStore((s) => s.lastSentAt)

	const loadInboxes = useMailStore((s) => s.loadInboxes)
	const loadConversations = useMailStore((s) => s.loadConversations)
	const loadMore = useMailStore((s) => s.loadMore)
	const selectConversation = useMailStore((s) => s.selectConversation)
	const setView = useMailStore((s) => s.setView)
	const setSearchQuery = useMailStore((s) => s.setSearchQuery)
	const patchConversation = useMailStore((s) => s.patchConversation)
	const addNote = useMailStore((s) => s.addNote)
	const saveReplyDraft = useMailStore((s) => s.saveReplyDraft)
	const sendDraft = useMailStore((s) => s.sendDraft)
	const undoSend = useMailStore((s) => s.undoSend)

	const setDestination = useUiStore((s) => s.setDestination)
	const setSettingsSection = useUiStore((s) => s.setSettingsSection)

	const [identities, setIdentities] = useState<MailIdentityDto[]>([])
	const [accountsLoaded, setAccountsLoaded] = useState(false)

	// Boot: inboxes, identities, first page of conversations.
	useEffect(() => {
		if (accountsLoaded) return
		setAccountsLoaded(true)
		if (!inboxesLoaded) void loadInboxes(api)
		void api
			.listMailIdentities()
			.then(setIdentities)
			.catch(() => setIdentities([]))
		void loadConversations(api)
	}, [api, accountsLoaded, inboxesLoaded, loadInboxes, loadConversations])

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

	const activeInbox = useMemo(
		() => inboxes.find((inbox) => inbox.id === activeInboxId) ?? null,
		[activeInboxId, inboxes]
	)
	const headerOpenCount = activeInbox
		? activeInbox.openCount
		: inboxes.reduce((sum, inbox) => sum + inbox.openCount, 0)

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
				<div className="flex items-center gap-2">
					<h1 className="text-base font-semibold tracking-tight">
						{activeInbox?.name ?? t('mail.sidebar.all')}
					</h1>
					{headerOpenCount > 0 ? <Badge tone="info">{headerOpenCount}</Badge> : null}
				</div>

				<div className="flex flex-wrap items-center gap-2">
					<fieldset
						aria-label={t('mail.sidebar.inboxes')}
						className="m-0 inline-flex flex-wrap items-center gap-1 rounded-md border-0 bg-muted p-1"
					>
						{MAIL_VIEW_FILTERS.map(({ key, labelId }) => {
							const active = activeView === key
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
					</fieldset>

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
					<div className="border-b border-border p-2">
						<Input
							value={searchQuery}
							onChange={(e) => void setSearchQuery(api, e.target.value)}
							placeholder={t('mail.list.search-placeholder')}
							aria-label={t('mail.list.search-placeholder')}
						/>
					</div>
					<div className="flex-1 overflow-y-auto">
						<ConversationList
							conversations={conversations}
							activeId={activeConversationId}
							loading={loading}
							hasMore={nextCursor !== null}
							loadingMore={loadingMore}
							onSelect={(id) => void selectConversation(api, id)}
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
							onPatch={(body) => patchConversation(api, activeConversationId, body)}
							onAddNote={(bodyText) => addNote(api, activeConversationId, bodyText)}
							onSaveReplyDraft={(body) => saveReplyDraft(api, activeConversationId, body)}
							onSendDraft={(draftId) => sendDraft(api, draftId)}
							onUndoSend={(draftId) => undoSend(api, draftId)}
							onConvertToIssue={async (projectId) => {
								await api.convertMailToIssue(activeConversationId, { projectId })
							}}
							projects={projects}
						/>
					) : (
						<EmptyState title={t('mail.conv.select-hint')} className="h-full justify-center p-6" />
					)}
				</div>
			</div>
		</div>
	)
}
