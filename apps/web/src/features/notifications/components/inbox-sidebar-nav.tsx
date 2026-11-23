import { t } from '@huriro/i18n'
import { useCollectionItems, useSyncEngine } from '@huriro/sync-client'
import { Archive, AtSign, Bell, Inbox, Mail, UserCheck } from 'lucide-react'
import { useMemo } from 'react'
import {
	SidebarNavItem,
	SidebarSection,
	useSidebarCollapsed
} from '@/components/app-shell/sidebar/sidebar-primitives'
import { useUiStore } from '@/stores/ui-store'

export function InboxSidebarNav({ collapsed }: { readonly collapsed?: boolean | undefined }) {
	const ctxCollapsed = useSidebarCollapsed()
	const isCollapsed = collapsed ?? ctxCollapsed
	const engine = useSyncEngine()
	const notifications = useCollectionItems(engine.collections.notifications)

	const inboxFilter = useUiStore((s) => s.inboxFilter)
	const setInboxFilter = useUiStore((s) => s.setInboxFilter)

	const unreadCount = useMemo(
		() => notifications.filter((n) => n.archivedAt === null && n.readAt === null).length,
		[notifications]
	)

	return (
		<nav aria-label={t('inbox.title')} className="space-y-0.5">
			<SidebarNavItem
				icon={<Inbox className="size-4" />}
				label={t('inbox.sidebar.unread')}
				active={inboxFilter === 'unread'}
				badgeCount={unreadCount}
				collapsed={isCollapsed}
				onClick={() => setInboxFilter('unread')}
			/>
			<SidebarNavItem
				icon={<Bell className="size-4" />}
				label={t('inbox.sidebar.all')}
				active={inboxFilter === 'all'}
				collapsed={isCollapsed}
				onClick={() => setInboxFilter('all')}
			/>

			<SidebarSection title={t('inbox.sidebar.for-me')} collapsed={isCollapsed}>
				<SidebarNavItem
					icon={<UserCheck className="size-4" />}
					label={t('inbox.sidebar.assigned')}
					active={inboxFilter === 'assigned'}
					collapsed={isCollapsed}
					onClick={() => setInboxFilter('assigned')}
				/>
				<SidebarNavItem
					icon={<AtSign className="size-4" />}
					label={t('inbox.sidebar.mentions')}
					active={inboxFilter === 'mentions'}
					collapsed={isCollapsed}
					onClick={() => setInboxFilter('mentions')}
				/>
			</SidebarSection>

			<SidebarSection title={t('inbox.sidebar.shared')} collapsed={isCollapsed}>
				<SidebarNavItem
					icon={<Mail className="size-4" />}
					label={t('inbox.sidebar.shared-inboxes')}
					disabled
					trailingText={t('shell.coming-soon')}
					collapsed={isCollapsed}
				/>
			</SidebarSection>
		</nav>
	)
}

export function InboxSidebarFooterUtility({ collapsed }: { readonly collapsed?: boolean | undefined }) {
	const ctxCollapsed = useSidebarCollapsed()
	const isCollapsed = collapsed ?? ctxCollapsed
	const inboxFilter = useUiStore((s) => s.inboxFilter)
	const setInboxFilter = useUiStore((s) => s.setInboxFilter)

	return (
		<SidebarNavItem
			icon={<Archive className="size-4" />}
			label={t('inbox.sidebar.archived')}
			active={inboxFilter === 'archived'}
			collapsed={isCollapsed}
			onClick={() => setInboxFilter('archived')}
		/>
	)
}
