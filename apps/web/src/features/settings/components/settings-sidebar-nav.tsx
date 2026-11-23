import { t } from '@huriro/i18n'
import { Bell, Download, GitBranch, Keyboard, Palette, SlidersHorizontal, Users, Webhook } from 'lucide-react'
import {
	SidebarNavItem,
	SidebarSection,
	useSidebarCollapsed
} from '@/components/app-shell/sidebar/sidebar-primitives'
import { useUiStore } from '@/stores/ui-store'

export function SettingsSidebarNav({ collapsed }: { readonly collapsed?: boolean | undefined }) {
	const ctxCollapsed = useSidebarCollapsed()
	const isCollapsed = collapsed ?? ctxCollapsed
	const settingsSection = useUiStore((s) => s.settingsSection)
	const setSettingsSection = useUiStore((s) => s.setSettingsSection)
	const setShortcutsDialogOpen = useUiStore((s) => s.setShortcutsDialogOpen)

	return (
		<nav aria-label={t('nav.settings')} className="space-y-0.5">
			<SidebarSection title={t('settings.sidebar.workspace')} collapsed={isCollapsed}>
				<SidebarNavItem
					icon={<SlidersHorizontal className="size-4" />}
					label={t('settings.sidebar.general')}
					active={settingsSection === 'general'}
					collapsed={isCollapsed}
					onClick={() => setSettingsSection('general')}
				/>
				<SidebarNavItem
					icon={<Download className="size-4" />}
					label={t('settings.sidebar.imports')}
					active={settingsSection === 'imports'}
					collapsed={isCollapsed}
					onClick={() => setSettingsSection('imports')}
				/>
				<SidebarNavItem
					icon={<Webhook className="size-4" />}
					label={t('settings.sidebar.webhooks')}
					active={settingsSection === 'webhooks'}
					collapsed={isCollapsed}
					onClick={() => setSettingsSection('webhooks')}
				/>
				<SidebarNavItem
					icon={<GitBranch className="size-4" />}
					label={t('settings.sidebar.integrations')}
					active={settingsSection === 'integrations'}
					collapsed={isCollapsed}
					onClick={() => setSettingsSection('integrations')}
				/>
				<SidebarNavItem
					icon={<Users className="size-4" />}
					label={t('settings.sidebar.members')}
					disabled
					trailingText={t('shell.coming-soon')}
					collapsed={isCollapsed}
				/>
			</SidebarSection>

			<SidebarSection title={t('settings.sidebar.personal')} collapsed={isCollapsed}>
				<SidebarNavItem
					icon={<Bell className="size-4" />}
					label={t('settings.sidebar.notifications')}
					active={settingsSection === 'notifications'}
					collapsed={isCollapsed}
					onClick={() => setSettingsSection('notifications')}
				/>
				<SidebarNavItem
					icon={<Palette className="size-4" />}
					label={t('settings.sidebar.appearance')}
					active={settingsSection === 'appearance'}
					collapsed={isCollapsed}
					onClick={() => setSettingsSection('appearance')}
				/>
				<SidebarNavItem
					icon={<Keyboard className="size-4" />}
					label={t('shell.shortcuts-button')}
					trailingText="?"
					collapsed={isCollapsed}
					onClick={() => setShortcutsDialogOpen(true)}
				/>
			</SidebarSection>
		</nav>
	)
}
