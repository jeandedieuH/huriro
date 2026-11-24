import { t } from '@huriro/i18n'
import { useCollectionItems, useSyncEngine } from '@huriro/sync-client'
import { Archive, AtSign, Bell, Inbox, Mail, UserCheck } from 'lucide-react'
import { useEffect, useMemo } from 'react'
import {
	SidebarNavItem,
	SidebarProjectDot,
	SidebarSection,
	useSidebarCollapsed
} from '@/components/app-shell/sidebar/sidebar-primitives'
import { useMailStore } from '@/features/mail/store/mail-store'
import { navigateToDestination, navigateToMail } from '@/lib/navigation'
import { useWorkspace } from '@/lib/workspace'
import { type InboxFilter, useUiStore } from '@/stores/ui-store'

export function InboxSidebarNav({ collapsed }: { readonly collapsed?: boolean | undefined }) {
	const ctxCollapsed = useSidebarCollapsed()
	const isCollapsed = collapsed ?? ctxCollapsed
	const { api } = useWorkspace()
	const engine = useSyncEngine()
	const notifications = useCollectionItems(engine.collections.notifications)

	const inboxFilter = useUiStore((s) => s.inboxFilter)
	const inboxPane = useUiStore((s) => s.inboxPane)
	const setInboxFilter = useUiStore((s) => s.setInboxFilter)
	const setInboxPane = useUiStore((s) => s.setInboxPane)

	const inboxes = useMailStore((s) => s.inboxes)
	const inboxesLoaded = useMailStore((s) => s.inboxesLoaded)
	const activeInboxId = useMailStore((s) => s.activeInboxId)
	const loadInboxes = useMailStore((s) => s.loadInboxes)
	const setInbox = useMailStore((s) => s.setInbox)

	useEffect(() => {
		if (!inboxesLoaded) {
			void loadInboxes(api)
		}
	}, [api, inboxesLoaded, loadInboxes])

	const unreadCount = useMemo(
		() => notifications.filter((n) => n.archivedAt === null && n.readAt === null).length,
		[notifications]
	)

	const totalSharedOpenCount = useMemo(
		() => inboxes.reduce((sum, inbox) => sum + inbox.openCount, 0),
		[inboxes]
	)

	const isNotifications = inboxPane === 'notifications'
	const isMail = inboxPane === 'mail'

	function selectNotificationFilter(filter: InboxFilter) {
		setInboxFilter(filter)
		navigateToDestination('inbox')
	}

	function selectSharedInbox(inboxId: string | null) {
		setInboxPane('mail')
		navigateToMail()
		void setInbox(api, inboxId)
	}

	return (
		<nav aria-label={t('inbox.title')} className="space-y-0.5">
			<SidebarNavItem
				icon={<Inbox className="size-4" />}
				label={t('inbox.sidebar.unread')}
				active={isNotifications && inboxFilter === 'unread'}
				isCurrentPage={isNotifications && inboxFilter === 'unread'}
				badgeCount={unreadCount}
				collapsed={isCollapsed}
				onClick={() => selectNotificationFilter('unread')}
			/>
			<SidebarNavItem
				icon={<Bell className="size-4" />}
				label={t('inbox.sidebar.all')}
				active={isNotifications && inboxFilter === 'all'}
				isCurrentPage={isNotifications && inboxFilter === 'all'}
				collapsed={isCollapsed}
				onClick={() => selectNotificationFilter('all')}
			/>

			<SidebarSection title={t('inbox.sidebar.for-me')} collapsed={isCollapsed}>
				<SidebarNavItem
					icon={<UserCheck className="size-4" />}
					label={t('inbox.sidebar.assigned')}
					active={isNotifications && inboxFilter === 'assigned'}
					isCurrentPage={isNotifications && inboxFilter === 'assigned'}
					collapsed={isCollapsed}
					onClick={() => selectNotificationFilter('assigned')}
				/>
				<SidebarNavItem
					icon={<AtSign className="size-4" />}
					label={t('inbox.sidebar.mentions')}
					active={isNotifications && inboxFilter === 'mentions'}
					isCurrentPage={isNotifications && inboxFilter === 'mentions'}
					collapsed={isCollapsed}
					onClick={() => selectNotificationFilter('mentions')}
				/>
			</SidebarSection>

			<SidebarSection title={t('inbox.sidebar.shared')} collapsed={isCollapsed}>
				<SidebarNavItem
					icon={<Mail className="size-4" />}
					label={t('mail.sidebar.all')}
					active={isMail && activeInboxId === null}
					isCurrentPage={isMail && activeInboxId === null}
					badgeCount={totalSharedOpenCount > 0 ? totalSharedOpenCount : undefined}
					collapsed={isCollapsed}
					onClick={() => selectSharedInbox(null)}
				/>
				{inboxes.map((inbox, idx) => {
					const isSelected = isMail && activeInboxId === inbox.id
					return (
						<SidebarNavItem
							key={inbox.id}
							icon={<SidebarProjectDot index={idx} active={isSelected} />}
							label={inbox.name}
							active={isSelected}
							isCurrentPage={isSelected}
							badgeCount={inbox.openCount > 0 ? inbox.openCount : undefined}
							collapsed={isCollapsed}
							onClick={() => selectSharedInbox(inbox.id)}
						/>
					)
				})}
			</SidebarSection>
		</nav>
	)
}

export function InboxSidebarFooterUtility({ collapsed }: { readonly collapsed?: boolean | undefined }) {
	const ctxCollapsed = useSidebarCollapsed()
	const isCollapsed = collapsed ?? ctxCollapsed
	const inboxFilter = useUiStore((s) => s.inboxFilter)
	const inboxPane = useUiStore((s) => s.inboxPane)
	const setInboxFilter = useUiStore((s) => s.setInboxFilter)

	return (
		<SidebarNavItem
			icon={<Archive className="size-4" />}
			label={t('inbox.sidebar.archived')}
			active={inboxPane === 'notifications' && inboxFilter === 'archived'}
			isCurrentPage={inboxPane === 'notifications' && inboxFilter === 'archived'}
			collapsed={isCollapsed}
			onClick={() => {
				setInboxFilter('archived')
				navigateToDestination('inbox')
			}}
		/>
	)
}
