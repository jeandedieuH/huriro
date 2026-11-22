import { type MessageId, t } from '@huriro/i18n'
import { CheckSquare, FileText, Inbox, Keyboard, MessageSquare, Settings } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { cn } from '@/lib/utils'
import type { AppDestination } from '@/stores/ui-store'

// §17.2 — strictly 5 primary destinations: Inbox, Issues, Docs, Chat, Settings
const NAV: { id: AppDestination; label: MessageId; icon: typeof Inbox }[] = [
	{ id: 'inbox', label: 'nav.inbox', icon: Inbox },
	{ id: 'tasks', label: 'nav.tasks', icon: CheckSquare },
	{ id: 'docs', label: 'nav.docs', icon: FileText },
	{ id: 'chat', label: 'nav.chat', icon: MessageSquare },
	{ id: 'settings', label: 'nav.settings', icon: Settings }
]

export interface SidebarProps {
	readonly active?: string
	readonly inboxUnreadCount?: number | undefined
	readonly onSelect?: ((dest: AppDestination) => void) | undefined
	readonly onOpenShortcuts?: (() => void) | undefined
}

export function Sidebar({ active, inboxUnreadCount = 0, onSelect, onOpenShortcuts }: SidebarProps) {
	return (
		<nav
			aria-label="Primary"
			className="flex h-full w-56 flex-col gap-1 border-r border-sidebar-border bg-sidebar px-2 py-3 text-sidebar-foreground"
		>
			{/* Brand lockup: logo.png on light, logo-white.png under .dark (§17.4) */}
			<div className="flex items-center px-2 pb-3">
				<img src="/images/logo.png" alt={t('app.name')} className="h-12 w-auto dark:hidden" />
				<img src="/images/logo-white.png" alt={t('app.name')} className="hidden h-12 w-auto dark:block" />
			</div>

			{NAV.map((item) => {
				const Icon = item.icon
				const isActive = active === item.id
				const badgeCount = item.id === 'inbox' && inboxUnreadCount > 0 ? inboxUnreadCount : 0

				if (onSelect) {
					return (
						<button
							key={item.id}
							type="button"
							aria-current={isActive ? 'page' : undefined}
							onClick={() => onSelect(item.id)}
							className={cn(
								'flex w-full items-center justify-between rounded-md px-2 py-1.5 text-left text-sm transition-colors duration-(--motion-duration-fast)',
								isActive
									? 'bg-sidebar-accent font-medium text-sidebar-accent-foreground'
									: 'text-muted-foreground hover:bg-sidebar-accent hover:text-sidebar-accent-foreground'
							)}
						>
							<span className="flex items-center gap-2">
								<Icon className="size-4 shrink-0" aria-hidden />
								<span>{t(item.label)}</span>
							</span>
							{badgeCount > 0 ? (
								<span className="rounded-full bg-primary/15 px-1.5 py-0.5 font-mono text-xs font-medium text-primary tnum">
									{badgeCount}
								</span>
							) : null}
						</button>
					)
				}

				return (
					<a
						key={item.id}
						href={`#${item.id}`}
						aria-current={isActive ? 'page' : undefined}
						className={cn(
							'flex items-center gap-2 rounded-md px-2 py-1.5 text-sm transition-colors duration-(--motion-duration-fast)',
							isActive
								? 'bg-sidebar-accent font-medium text-sidebar-accent-foreground'
								: 'text-muted-foreground hover:bg-sidebar-accent hover:text-sidebar-accent-foreground'
						)}
					>
						<Icon className="size-4 shrink-0" aria-hidden />
						<span>{t(item.label)}</span>
					</a>
				)
			})}

			{onOpenShortcuts ? (
				<div className="mt-auto pt-2">
					<Button
						size="sm"
						tone="ghost"
						className="w-full justify-start text-muted-foreground"
						onClick={onOpenShortcuts}
					>
						<Keyboard className="size-4" aria-hidden />
						<span>{t('shell.shortcuts-button')}</span>
						<span className="ml-auto font-mono text-xs">?</span>
					</Button>
				</div>
			) : null}
		</nav>
	)
}
