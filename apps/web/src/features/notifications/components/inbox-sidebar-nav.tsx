import { t } from '@huriro/i18n'
import { useCollectionItems, useSyncEngine } from '@huriro/sync-client'
import {
	Archive,
	AtSign,
	Bell,
	CheckCheck,
	Clock,
	Inbox,
	Mail,
	PenSquare,
	Settings2,
	UserCheck
} from 'lucide-react'
import { useEffect, useMemo, useState } from 'react'
import { SidebarActionRow, SidebarMenuAction } from '@/components/app-shell/sidebar/sidebar-action-row'
import { SidebarCollapsibleSection } from '@/components/app-shell/sidebar/sidebar-collapsible-section'
import { SidebarFilterInput } from '@/components/app-shell/sidebar/sidebar-filter-input'
import { useSidebarCollapsed } from '@/components/app-shell/sidebar/sidebar-primitives'
import { Button } from '@/components/ui/button'
import { DropdownMenuSeparator } from '@/components/ui/dropdown-menu'
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from '@/components/ui/tooltip'
import { type MailNavView, useMailStore } from '@/features/mail/store/mail-store'
import { navigateToDestination, navigateToMail, navigateToSettingsSection } from '@/lib/navigation'
import { useOptionalWorkspace } from '@/lib/workspace'
import { type InboxFilter, useUiStore } from '@/stores/ui-store'
import { InboxMailRow } from './sidebar/inbox-mail-row'

const MENU_ICON_CLASS = 'size-4 shrink-0 text-muted-foreground'

export function InboxSidebarNav({ collapsed }: { readonly collapsed?: boolean | undefined }) {
	const ctxCollapsed = useSidebarCollapsed()
	const isCollapsed = collapsed ?? ctxCollapsed
	const workspace = useOptionalWorkspace()
	const api = workspace?.api ?? null
	const engine = useSyncEngine()
	const notifications = useCollectionItems(engine.collections.notifications)

	const inboxFilter = useUiStore((s) => s.inboxFilter)
	const inboxPane = useUiStore((s) => s.inboxPane)
	const setInboxFilter = useUiStore((s) => s.setInboxFilter)
	const setInboxPane = useUiStore((s) => s.setInboxPane)
	const pushToast = useUiStore((s) => s.pushToast)

	const inboxes = useMailStore((s) => s.inboxes)
	const inboxesLoaded = useMailStore((s) => s.inboxesLoaded)
	const activeInboxId = useMailStore((s) => s.activeInboxId)
	const loadInboxes = useMailStore((s) => s.loadInboxes)
	const setInbox = useMailStore((s) => s.setInbox)
	const setMailView = useMailStore((s) => s.setView)
	const setComposeOpen = useMailStore((s) => s.setComposeOpen)

	const [filter, setFilter] = useState('')
	const needle = filter.trim().toLowerCase()

	useEffect(() => {
		if (api && !inboxesLoaded) {
			void loadInboxes(api)
		}
	}, [api, inboxesLoaded, loadInboxes])

	const { unreadCount, allCount, assignedCount, mentionsCount } = useMemo(() => {
		let unread = 0
		let all = 0
		let assigned = 0
		let mentions = 0
		for (const n of notifications) {
			if (n.archivedAt !== null) continue
			all += 1
			if (n.readAt === null) unread += 1
			if (n.kind.includes('assigned')) assigned += 1
			if (n.kind.includes('mention')) mentions += 1
		}
		return { unreadCount: unread, allCount: all, assignedCount: assigned, mentionsCount: mentions }
	}, [notifications])

	const totalSharedOpenCount = useMemo(
		() => inboxes.reduce((sum, inbox) => sum + inbox.openCount, 0),
		[inboxes]
	)

	const filteredInboxes = useMemo(() => {
		if (!needle) return inboxes
		return inboxes.filter((inbox) => inbox.name.toLowerCase().includes(needle))
	}, [inboxes, needle])

	const isNotifications = inboxPane === 'notifications'
	const isMail = inboxPane === 'mail'

	function selectNotificationFilter(nextFilter: InboxFilter) {
		setInboxFilter(nextFilter)
		navigateToDestination('inbox')
	}

	function selectSharedInbox(inboxId: string | null) {
		setInboxPane('mail')
		navigateToMail()
		if (api) void setInbox(api, inboxId)
	}

	function handleCompose(inboxId: string | null) {
		selectSharedInbox(inboxId)
		setComposeOpen(true)
	}

	function handleMailView(inboxId: string | null, view: MailNavView) {
		setInboxPane('mail')
		navigateToMail()
		if (!api) return
		void setInbox(api, inboxId).then(() => setMailView(api, view))
	}

	function openSettingsSection(section: 'notifications' | 'mail') {
		useUiStore.getState().setSettingsSection(section)
		useUiStore.getState().setDestination('settings')
		navigateToSettingsSection(section)
	}

	async function handleMarkAllRead() {
		if (!api) return
		try {
			await api.markAllNotificationsRead()
			void engine.syncNow()
			pushToast({ tone: 'success', title: t('inbox.sidebar.marked-all-read') })
		} catch (err) {
			pushToast({
				tone: 'danger',
				title: t('shell.sidebar.action-failed'),
				description: err instanceof Error ? err.message : undefined
			})
		}
	}

	return (
		<TooltipProvider delayDuration={300}>
			<nav data-feature-sidebar aria-label={t('inbox.title')} className="space-y-0.5">
				{!isCollapsed && inboxes.length >= 4 ? (
					<SidebarFilterInput
						value={filter}
						onChange={setFilter}
						placeholder={t('inbox.sidebar.filter-placeholder')}
						ariaLabel={t('inbox.sidebar.filter-label')}
						clearLabel={t('shell.sidebar.filter-clear')}
					/>
				) : null}

				{!needle ? (
					<>
						<SidebarActionRow
							icon={<Inbox className="size-4" />}
							label={t('inbox.sidebar.unread')}
							active={isNotifications && inboxFilter === 'unread'}
							isCurrentPage={isNotifications && inboxFilter === 'unread'}
							emphasized={unreadCount > 0}
							badgeCount={unreadCount}
							badgeTone="primary"
							collapsed={isCollapsed}
							// Menu & quick labels deliberately exclude "Unread" so /Unread/i queries uniquely match the row.
							menuAriaLabel={t('shell.sidebar.more-actions')}
							onClick={() => selectNotificationFilter('unread')}
							quickAction={
								unreadCount > 0 && api ? (
									<Tooltip>
										<TooltipTrigger asChild>
											<button
												type="button"
												aria-label={t('inbox.mark-all-read')}
												onClick={(ev) => {
													ev.stopPropagation()
													void handleMarkAllRead()
												}}
												className="flex size-6 items-center justify-center rounded-md text-sidebar-muted-foreground outline-none transition-colors hover:bg-sidebar-border/60 hover:text-sidebar-foreground focus-visible:ring-2 focus-visible:ring-sidebar-primary/60"
											>
												<CheckCheck className="size-3.5" aria-hidden />
											</button>
										</TooltipTrigger>
										<TooltipContent side="top">{t('inbox.mark-all-read')}</TooltipContent>
									</Tooltip>
								) : null
							}
							menuContent={
								<>
									{api ? (
										<SidebarMenuAction
											icon={<CheckCheck className={MENU_ICON_CLASS} aria-hidden />}
											label={t('inbox.mark-all-read')}
											disabled={unreadCount === 0}
											onSelect={() => void handleMarkAllRead()}
										/>
									) : null}
									<SidebarMenuAction
										icon={<Settings2 className={MENU_ICON_CLASS} aria-hidden />}
										label={t('inbox.sidebar.notification-settings')}
										onSelect={() => openSettingsSection('notifications')}
									/>
								</>
							}
						/>

						<SidebarActionRow
							icon={<Bell className="size-4" />}
							label={t('inbox.sidebar.all')}
							active={isNotifications && inboxFilter === 'all'}
							isCurrentPage={isNotifications && inboxFilter === 'all'}
							badgeCount={allCount}
							badgeTone="muted"
							collapsed={isCollapsed}
							onClick={() => selectNotificationFilter('all')}
						/>

						<SidebarCollapsibleSection title={t('inbox.sidebar.for-me')} railCollapsed={isCollapsed}>
							<SidebarActionRow
								icon={<UserCheck className="size-4" />}
								label={t('inbox.sidebar.assigned')}
								active={isNotifications && inboxFilter === 'assigned'}
								isCurrentPage={isNotifications && inboxFilter === 'assigned'}
								badgeCount={assignedCount}
								badgeTone="muted"
								collapsed={isCollapsed}
								onClick={() => selectNotificationFilter('assigned')}
							/>
							<SidebarActionRow
								icon={<AtSign className="size-4" />}
								label={t('inbox.sidebar.mentions')}
								active={isNotifications && inboxFilter === 'mentions'}
								isCurrentPage={isNotifications && inboxFilter === 'mentions'}
								badgeCount={mentionsCount}
								badgeTone="muted"
								collapsed={isCollapsed}
								onClick={() => selectNotificationFilter('mentions')}
							/>
						</SidebarCollapsibleSection>
					</>
				) : null}

				<SidebarCollapsibleSection
					title={t('inbox.sidebar.shared')}
					count={filteredInboxes.length}
					railCollapsed={isCollapsed}
					action={
						!isCollapsed ? (
							<Tooltip>
								<TooltipTrigger asChild>
									<button
										type="button"
										aria-label={t('inbox.sidebar.manage-inboxes')}
										onClick={() => openSettingsSection('mail')}
										className="flex size-5 items-center justify-center rounded-md text-sidebar-muted-foreground/80 outline-none transition-colors hover:bg-sidebar-accent hover:text-sidebar-foreground focus-visible:ring-2 focus-visible:ring-sidebar-primary/60"
									>
										<Settings2 className="size-3.5" aria-hidden />
									</button>
								</TooltipTrigger>
								<TooltipContent side="top">{t('inbox.sidebar.manage-inboxes')}</TooltipContent>
							</Tooltip>
						) : null
					}
				>
					{!needle ? (
						<SidebarActionRow
							icon={<Mail className="size-4" />}
							label={t('mail.sidebar.all')}
							active={isMail && activeInboxId === null}
							isCurrentPage={isMail && activeInboxId === null}
							badgeCount={totalSharedOpenCount}
							badgeTone="primary"
							collapsed={isCollapsed}
							menuAriaLabel={t('inbox.sidebar.inbox-actions')}
							onClick={() => selectSharedInbox(null)}
							quickAction={
								<Tooltip>
									<TooltipTrigger asChild>
										<button
											type="button"
											aria-label={t('mail.compose.new')}
											onClick={(ev) => {
												ev.stopPropagation()
												handleCompose(null)
											}}
											className="flex size-6 items-center justify-center rounded-md text-sidebar-muted-foreground outline-none transition-colors hover:bg-sidebar-border/60 hover:text-sidebar-foreground focus-visible:ring-2 focus-visible:ring-sidebar-primary/60"
										>
											<PenSquare className="size-3.5" aria-hidden />
										</button>
									</TooltipTrigger>
									<TooltipContent side="top">{t('mail.compose.new')}</TooltipContent>
								</Tooltip>
							}
							menuContent={
								<>
									<SidebarMenuAction
										icon={<PenSquare className={MENU_ICON_CLASS} aria-hidden />}
										label={t('mail.compose.new')}
										onSelect={() => handleCompose(null)}
									/>
									<DropdownMenuSeparator className="my-1.5" />
									<SidebarMenuAction
										icon={<Inbox className={MENU_ICON_CLASS} aria-hidden />}
										label={t('mail.sidebar.unassigned')}
										onSelect={() => handleMailView(null, 'unassigned')}
									/>
									<SidebarMenuAction
										icon={<UserCheck className={MENU_ICON_CLASS} aria-hidden />}
										label={t('mail.sidebar.assigned-to-me')}
										onSelect={() => handleMailView(null, 'mine')}
									/>
									<SidebarMenuAction
										icon={<Clock className={MENU_ICON_CLASS} aria-hidden />}
										label={t('mail.sidebar.snoozed')}
										onSelect={() => handleMailView(null, 'snoozed')}
									/>
									<SidebarMenuAction
										icon={<Archive className={MENU_ICON_CLASS} aria-hidden />}
										label={t('mail.sidebar.closed')}
										onSelect={() => handleMailView(null, 'closed')}
									/>
								</>
							}
						/>
					) : null}

					{filteredInboxes.length === 0 && needle ? (
						<div className="space-y-2 px-2 py-3 text-center">
							<p className="text-xs text-sidebar-muted-foreground">
								{t('shell.sidebar.filter-empty', { query: filter.trim() })}
							</p>
							<button
								type="button"
								onClick={() => setFilter('')}
								className="text-xs font-medium text-sidebar-primary underline-offset-4 hover:underline"
							>
								{t('shell.sidebar.filter-clear')}
							</button>
						</div>
					) : inboxesLoaded && inboxes.length === 0 && !isCollapsed ? (
						<div className="space-y-1.5 px-2 py-2">
							<p className="text-xs text-sidebar-muted-foreground">{t('inbox.sidebar.no-inboxes')}</p>
							<Button
								type="button"
								size="sm"
								tone="outline"
								className="h-7 gap-1 px-2 text-xs"
								onClick={() => openSettingsSection('mail')}
							>
								<Settings2 className="size-3" aria-hidden />
								{t('inbox.sidebar.configure-inboxes')}
							</Button>
						</div>
					) : (
						filteredInboxes.map((inbox, idx) => (
							<InboxMailRow
								key={inbox.id}
								inbox={inbox}
								index={idx}
								active={isMail && activeInboxId === inbox.id}
								collapsed={isCollapsed}
								onSelect={() => selectSharedInbox(inbox.id)}
								onCompose={() => handleCompose(inbox.id)}
								onSelectView={(view) => handleMailView(inbox.id, view)}
								onManageInboxes={() => openSettingsSection('mail')}
							/>
						))
					)}
				</SidebarCollapsibleSection>
			</nav>
		</TooltipProvider>
	)
}

export function InboxSidebarHeaderAction() {
	const setInboxPane = useUiStore((s) => s.setInboxPane)
	const setComposeOpen = useMailStore((s) => s.setComposeOpen)

	return (
		<Tooltip>
			<TooltipTrigger asChild>
				<button
					type="button"
					aria-label={t('inbox.sidebar.compose-header')}
					onClick={() => {
						setInboxPane('mail')
						navigateToMail()
						setComposeOpen(true)
					}}
					className="flex size-7 items-center justify-center rounded-lg text-sidebar-muted-foreground transition-colors hover:bg-sidebar-accent hover:text-sidebar-foreground"
				>
					<PenSquare className="size-4" aria-hidden />
				</button>
			</TooltipTrigger>
			<TooltipContent side="bottom">{t('inbox.sidebar.compose-header')}</TooltipContent>
		</Tooltip>
	)
}

export function InboxSidebarFooterUtility({ collapsed }: { readonly collapsed?: boolean | undefined }) {
	const ctxCollapsed = useSidebarCollapsed()
	const isCollapsed = collapsed ?? ctxCollapsed
	const engine = useSyncEngine()
	const notifications = useCollectionItems(engine.collections.notifications)
	const inboxFilter = useUiStore((s) => s.inboxFilter)
	const inboxPane = useUiStore((s) => s.inboxPane)
	const setInboxFilter = useUiStore((s) => s.setInboxFilter)

	const archivedCount = useMemo(
		() => notifications.filter((n) => n.archivedAt !== null).length,
		[notifications]
	)

	return (
		<SidebarActionRow
			icon={<Archive className="size-4" />}
			label={t('inbox.sidebar.archived')}
			active={inboxPane === 'notifications' && inboxFilter === 'archived'}
			isCurrentPage={inboxPane === 'notifications' && inboxFilter === 'archived'}
			badgeCount={archivedCount}
			badgeTone="muted"
			collapsed={isCollapsed}
			onClick={() => {
				setInboxFilter('archived')
				navigateToDestination('inbox')
			}}
		/>
	)
}
