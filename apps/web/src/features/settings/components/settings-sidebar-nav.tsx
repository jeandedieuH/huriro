import { t } from '@huriro/i18n'
import { Keyboard } from 'lucide-react'
import { useMemo, useState } from 'react'
import { SidebarActionRow } from '@/components/app-shell/sidebar/sidebar-action-row'
import { SidebarCollapsibleSection } from '@/components/app-shell/sidebar/sidebar-collapsible-section'
import { SidebarFilterInput } from '@/components/app-shell/sidebar/sidebar-filter-input'
import { useSidebarCollapsed } from '@/components/app-shell/sidebar/sidebar-primitives'
import { TooltipProvider } from '@/components/ui/tooltip'
import { useOptionalWorkspace } from '@/lib/workspace'
import { useUiStore } from '@/stores/ui-store'
import {
	filterSettingsSections,
	getVisibleSettingsSections,
	resolveActiveSettingsSection,
	SETTINGS_GROUPS
} from '../settings-sections'

export function SettingsSidebarNav({ collapsed }: { readonly collapsed?: boolean | undefined }) {
	const ctxCollapsed = useSidebarCollapsed()
	const isCollapsed = collapsed ?? ctxCollapsed
	const mode = useOptionalWorkspace()?.mode ?? 'selfhost'
	const settingsSection = useUiStore((s) => s.settingsSection)
	const setSettingsSection = useUiStore((s) => s.setSettingsSection)
	const setShortcutsDialogOpen = useUiStore((s) => s.setShortcutsDialogOpen)
	const [query, setQuery] = useState('')

	const activeSection = resolveActiveSettingsSection(settingsSection, mode)
	const visibleSections = useMemo(() => getVisibleSettingsSections(mode), [mode])
	const filteredSections = useMemo(
		() => filterSettingsSections(visibleSections, query),
		[query, visibleSections]
	)

	const needle = query.trim().toLowerCase()
	const showShortcutsItem =
		!needle ||
		t('shell.shortcuts-button').toLowerCase().includes(needle) ||
		'keyboard shortcuts ?'.includes(needle)

	return (
		<TooltipProvider delayDuration={300}>
			<nav data-feature-sidebar aria-label={t('nav.settings')} className="space-y-0.5">
				{!isCollapsed ? (
					<SidebarFilterInput
						inputType="search"
						value={query}
						onChange={setQuery}
						placeholder={t('settings.search.placeholder')}
						ariaLabel={t('settings.search.label')}
						clearLabel={t('settings.search.clear')}
						onEnter={() => {
							const first = filteredSections[0]
							if (first) setSettingsSection(first.id)
						}}
					/>
				) : null}

				{filteredSections.length === 0 && !showShortcutsItem ? (
					<div className="space-y-2 px-2 py-4 text-center">
						<p className="text-xs text-sidebar-muted-foreground">{t('settings.search.empty')}</p>
						<button
							type="button"
							onClick={() => setQuery('')}
							className="text-xs font-medium text-sidebar-primary underline-offset-4 hover:underline"
						>
							{t('settings.search.clear')}
						</button>
					</div>
				) : (
					SETTINGS_GROUPS.map((group) => {
						const items = filteredSections.filter((section) => section.group === group.id)
						const includeShortcuts = group.id === 'personal' && showShortcutsItem
						if (items.length === 0 && !includeShortcuts) return null
						const groupCount = items.length + (includeShortcuts ? 1 : 0)

						return (
							<SidebarCollapsibleSection
								key={group.id}
								title={t(group.labelId)}
								collapsible={!needle}
								railCollapsed={isCollapsed}
								count={needle ? undefined : groupCount}
							>
								{items.map((item) => {
									const Icon = item.icon
									const isActive = activeSection === item.id
									return (
										<SidebarActionRow
											key={item.id}
											icon={<Icon className="size-4" />}
											label={t(item.labelId)}
											active={isActive}
											isCurrentPage={isActive}
											collapsed={isCollapsed}
											onClick={() => setSettingsSection(item.id)}
										/>
									)
								})}
								{includeShortcuts ? (
									<SidebarActionRow
										icon={<Keyboard className="size-4" />}
										label={t('shell.shortcuts-button')}
										trailingText="?"
										collapsed={isCollapsed}
										onClick={() => setShortcutsDialogOpen(true)}
									/>
								) : null}
							</SidebarCollapsibleSection>
						)
					})
				)}
			</nav>
		</TooltipProvider>
	)
}
