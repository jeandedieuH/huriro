import { type MessageId, t } from '@huriro/i18n'
import { cn } from '@/lib/utils'

const NAV: { id: string; label: MessageId }[] = [
	{ id: 'inbox', label: 'nav.inbox' },
	{ id: 'tasks', label: 'nav.tasks' },
	{ id: 'docs', label: 'nav.docs' },
	{ id: 'chat', label: 'nav.chat' },
	{ id: 'mail', label: 'nav.mail' },
	{ id: 'search', label: 'nav.search' },
	{ id: 'settings', label: 'nav.settings' }
]

export function Sidebar({ active }: { active?: string }) {
	return (
		<nav
			aria-label="Primary"
			className="flex h-full w-56 flex-col gap-1 border-r border-sidebar-border bg-sidebar px-2 py-3 text-sidebar-foreground"
		>
			<div className="px-2 pb-3 text-sm font-semibold">{t('app.name')}</div>
			{NAV.map((item) => (
				<a
					key={item.id}
					href={`#${item.id}`}
					aria-current={active === item.id ? 'page' : undefined}
					className={cn(
						'rounded-md px-2 py-1.5 text-sm transition-colors duration-(--motion-duration-fast)',
						active === item.id
							? 'bg-sidebar-accent font-medium text-sidebar-accent-foreground'
							: 'text-muted-foreground hover:bg-sidebar-accent hover:text-sidebar-accent-foreground'
					)}
				>
					{t(item.label)}
				</a>
			))}
		</nav>
	)
}
