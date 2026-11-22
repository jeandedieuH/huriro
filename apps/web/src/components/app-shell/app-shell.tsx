/**
 * App shell (§17.9): fixed chrome — sidebar + topbar — with only the content
 * column scrolling. Layout is grid-based, responsive, keyboard-first
 * (skip link + landmark roles).
 */
import { t } from '@huriro/i18n'
import type { ReactNode } from 'react'
import { Sidebar } from './sidebar'
import { Topbar } from './topbar'

export interface AppShellProps {
	children: ReactNode
	activeNav?: string
}

export function AppShell({ children, activeNav }: AppShellProps) {
	return (
		<div className="grid h-dvh grid-cols-[auto_1fr] grid-rows-[auto_1fr] bg-background">
			<a
				href="#content"
				className="sr-only focus:not-sr-only focus:absolute focus:z-(--z-modal) focus:m-2 focus:rounded-md focus:bg-primary focus:px-3 focus:py-1.5 focus:text-primary-foreground"
			>
				{t('shell.skip-to-content')}
			</a>
			<div className="row-span-2">
				<Sidebar active={activeNav ?? ''} />
			</div>
			<Topbar />
			<main id="content" className="min-h-0 overflow-y-auto">
				{children}
			</main>
		</div>
	)
}
