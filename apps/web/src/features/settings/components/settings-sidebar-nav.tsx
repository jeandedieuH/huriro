import { t } from '@huriro/i18n'
import { Keyboard, Search, X } from 'lucide-react'
import { useMemo, useState } from 'react'
import {
	SidebarNavItem,
	SidebarSection,
	useSidebarCollapsed
} from '@/components/app-shell/sidebar/sidebar-primitives'
import { useWorkspace } from '@/lib/workspace'
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
	const { mode } = useWorkspace()
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

	function handleFilterKeyDown(ev: React.KeyboardEvent<HTMLInputElement>) {
		if (ev.key === 'Escape' && query) {
			ev.preventDefault()
			setQuery('')
			return
		}
		if (ev.key === 'Enter' && filteredSections.length > 0) {
			ev.preventDefault()
			const first = filteredSections[0]
			if (first) setSettingsSection(first.id)
		}
	}

	return (
		<nav aria-label={t('nav.settings')} className="space-y-1">
			{!isCollapsed ? (
				<div className="px-1 pb-1">
					<div className="relative flex items-center">
						<Search
							className="pointer-events-none absolute left-2.5 size-3.5 text-sidebar-muted-foreground"
							aria-hidden
						/>
						<input
							type="search"
							value={query}
							onChange={(ev) => setQuery(ev.target.value)}
							onKeyDown={handleFilterKeyDown}
							placeholder={t('settings.search.placeholder')}
							aria-label={t('settings.search.label')}
							className="h-8 w-full rounded-lg border border-sidebar-border/80 bg-sidebar-icon-well/60 pr-7 pl-8 text-xs text-sidebar-foreground placeholder:text-sidebar-muted-foreground/75 focus-visible:border-sidebar-ring focus-visible:outline-none"
						/>
						{query ? (
							<button
								type="button"
								aria-label={t('settings.search.clear')}
								onClick={() => setQuery('')}
								className="absolute right-1.5 flex size-5 items-center justify-center rounded text-sidebar-muted-foreground hover:bg-sidebar-accent hover:text-sidebar-foreground"
							>
								<X className="size-3" aria-hidden />
							</button>
						) : null}
					</div>
				</div>
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

					return (
						<SidebarSection key={group.id} title={t(group.labelId)} collapsed={isCollapsed}>
							{items.map((item) => {
								const Icon = item.icon
								const isActive = activeSection === item.id
								return (
									<SidebarNavItem
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
								<SidebarNavItem
									icon={<Keyboard className="size-4" />}
									label={t('shell.shortcuts-button')}
									trailingText="?"
									collapsed={isCollapsed}
									onClick={() => setShortcutsDialogOpen(true)}
								/>
							) : null}
						</SidebarSection>
					)
				})
			)}
		</nav>
	)
}
