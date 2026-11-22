/**
 * App shell (§17.9): fixed chrome — sidebar + topbar — with only the content
 * column scrolling. Layout is grid-based, responsive, keyboard-first
 * (skip link + landmark roles).
 */
import { t } from '@huriro/i18n'
import type { ReactNode } from 'react'
import type { AppDestination } from '@/stores/ui-store'
import { Sidebar } from './sidebar'
import { Topbar } from './topbar'

export interface AppShellProps {
	children: ReactNode
	activeNav?: string
	workspaceName?: string | undefined
	inboxUnreadCount?: number | undefined
	isPreview?: boolean | undefined
	theme?: 'light' | 'dark' | undefined
	onSelectNav?: ((dest: AppDestination) => void) | undefined
	onOpenCommandPalette?: (() => void) | undefined
	onCreateNew?: (() => void) | undefined
	onToggleTheme?: (() => void) | undefined
	onOpenShortcuts?: (() => void) | undefined
}

export function AppShell({
	children,
	activeNav,
	workspaceName,
	inboxUnreadCount,
	isPreview,
	theme,
	onSelectNav,
	onOpenCommandPalette,
	onCreateNew,
	onToggleTheme,
	onOpenShortcuts
}: AppShellProps) {
	return (
		<div className="grid h-dvh grid-cols-[auto_1fr] grid-rows-[auto_1fr] bg-background">
			<a
				href="#content"
				className="sr-only focus:not-sr-only focus:absolute focus:z-(--z-modal) focus:m-2 focus:rounded-md focus:bg-primary focus:px-3 focus:py-1.5 focus:text-primary-foreground"
			>
				{t('shell.skip-to-content')}
			</a>
			<div className="row-span-2">
				<Sidebar
					active={activeNav ?? ''}
					workspaceName={workspaceName}
					inboxUnreadCount={inboxUnreadCount}
					onSelect={onSelectNav}
					onOpenShortcuts={onOpenShortcuts}
				/>
			</div>
			<Topbar
				isPreview={isPreview}
				theme={theme}
				onOpenCommandPalette={onOpenCommandPalette}
				onCreateNew={onCreateNew}
				onToggleTheme={onToggleTheme}
			/>
			<main id="content" className="flex min-h-0 flex-col overflow-hidden">
				{children}
			</main>
		</div>
	)
}
