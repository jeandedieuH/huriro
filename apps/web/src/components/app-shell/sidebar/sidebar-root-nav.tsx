import { t } from '@huriro/i18n'
import { FileText, Home, Inbox, ListChecks, MessageSquare, Settings } from 'lucide-react'
import type { AppDestination } from '@/stores/ui-store'
import { SidebarNavItem, SidebarSection } from './sidebar-primitives'

export interface SidebarRootNavProps {
	readonly active: string
	readonly inboxUnreadCount?: number | undefined
	readonly chatUnreadCount?: number | undefined
	readonly collapsed?: boolean | undefined
	readonly onSelect?: ((dest: AppDestination) => void) | undefined
}

export function SidebarRootNav({
	active,
	inboxUnreadCount = 0,
	chatUnreadCount = 0,
	collapsed = false,
	onSelect
}: SidebarRootNavProps) {
	return (
		<nav aria-label={t('shell.nav.primary')} className="space-y-0.5">
			<SidebarNavItem
				icon={<Home className="size-4" />}
				label={t('nav.home')}
				active={active === 'home'}
				isCurrentPage={active === 'home'}
				collapsed={collapsed}
				onClick={() => onSelect?.('home')}
			/>
			<SidebarNavItem
				icon={<Inbox className="size-4" />}
				label={t('nav.inbox')}
				active={active === 'inbox'}
				isCurrentPage={active === 'inbox'}
				badgeCount={inboxUnreadCount}
				showChevron={active === 'inbox'}
				collapsed={collapsed}
				onClick={() => onSelect?.('inbox')}
			/>
			<SidebarNavItem
				icon={<ListChecks className="size-4" />}
				label={t('nav.tasks')}
				active={active === 'tasks'}
				isCurrentPage={active === 'tasks'}
				showChevron={active === 'tasks'}
				collapsed={collapsed}
				onClick={() => onSelect?.('tasks')}
			/>
			<SidebarNavItem
				icon={<FileText className="size-4" />}
				label={t('nav.docs')}
				active={active === 'docs'}
				isCurrentPage={active === 'docs'}
				showChevron={active === 'docs'}
				collapsed={collapsed}
				onClick={() => onSelect?.('docs')}
			/>
			<SidebarNavItem
				icon={<MessageSquare className="size-4" />}
				label={t('nav.chat')}
				active={active === 'chat'}
				isCurrentPage={active === 'chat'}
				badgeCount={chatUnreadCount}
				showChevron={active === 'chat'}
				collapsed={collapsed}
				onClick={() => onSelect?.('chat')}
			/>

			<SidebarSection title={t('shell.section.manage')} collapsed={collapsed}>
				<SidebarNavItem
					icon={<Settings className="size-4" />}
					label={t('nav.settings')}
					active={active === 'settings'}
					isCurrentPage={active === 'settings'}
					showChevron={active === 'settings'}
					collapsed={collapsed}
					onClick={() => onSelect?.('settings')}
				/>
			</SidebarSection>
		</nav>
	)
}
