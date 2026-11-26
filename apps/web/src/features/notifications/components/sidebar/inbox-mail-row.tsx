import type { MailInboxDto } from '@huriro/contracts'
import { t } from '@huriro/i18n'
import { Archive, Clock, Inbox, Lock, PenSquare, Settings2, UserCheck } from 'lucide-react'
import { SidebarActionRow, SidebarMenuAction } from '@/components/app-shell/sidebar/sidebar-action-row'
import { SidebarProjectDot } from '@/components/app-shell/sidebar/sidebar-primitives'
import { DropdownMenuSeparator } from '@/components/ui/dropdown-menu'
import { Tooltip, TooltipContent, TooltipTrigger } from '@/components/ui/tooltip'
import type { MailNavView } from '@/features/mail/store/mail-store'

export interface InboxMailRowProps {
	readonly inbox: MailInboxDto
	readonly index: number
	readonly active: boolean
	readonly collapsed: boolean
	readonly onSelect: () => void
	readonly onCompose: () => void
	readonly onSelectView: (view: MailNavView) => void
	readonly onManageInboxes: () => void
}

const MENU_ICON_CLASS = 'size-4 shrink-0 text-muted-foreground'

/**
 * Shared mail inbox row with quick compose and bucket filter menu.
 * Quick action & menu triggers intentionally omit `inbox.name` from `aria-label`
 * so `getByRole('button', { name: /<InboxName>/i })` unambiguously matches the row itself.
 */
export function InboxMailRow({
	inbox,
	index,
	active,
	collapsed,
	onSelect,
	onCompose,
	onSelectView,
	onManageInboxes
}: InboxMailRowProps) {
	return (
		<SidebarActionRow
			icon={<SidebarProjectDot index={index} active={active} />}
			label={inbox.name}
			active={active}
			isCurrentPage={active}
			emphasized={inbox.openCount > 0}
			collapsed={collapsed}
			badgeCount={inbox.openCount}
			badgeTone="primary"
			trailingIcon={
				inbox.visibility === 'private' ? (
					<Lock className="size-3 text-sidebar-muted-foreground/80" aria-hidden />
				) : undefined
			}
			menuAriaLabel={t('inbox.sidebar.inbox-actions')}
			onClick={onSelect}
			quickAction={
				<Tooltip>
					<TooltipTrigger asChild>
						<button
							type="button"
							aria-label={t('mail.compose.new')}
							onClick={(ev) => {
								ev.stopPropagation()
								onCompose()
							}}
							className="flex size-6 items-center justify-center rounded-md text-sidebar-muted-foreground outline-none transition-colors hover:bg-sidebar-border/60 hover:text-sidebar-foreground focus-visible:ring-2 focus-visible:ring-sidebar-primary/60"
						>
							<PenSquare className="size-3.5" aria-hidden />
						</button>
					</TooltipTrigger>
					<TooltipContent side="top">{t('mail.compose.new')}</TooltipContent>
				</Tooltip>
			}
			menuContent={
				<>
					<SidebarMenuAction
						icon={<PenSquare className={MENU_ICON_CLASS} aria-hidden />}
						label={t('mail.compose.new')}
						onSelect={onCompose}
					/>
					<DropdownMenuSeparator className="my-1.5" />
					<SidebarMenuAction
						icon={<Inbox className={MENU_ICON_CLASS} aria-hidden />}
						label={t('mail.sidebar.unassigned')}
						onSelect={() => onSelectView('unassigned')}
					/>
					<SidebarMenuAction
						icon={<UserCheck className={MENU_ICON_CLASS} aria-hidden />}
						label={t('mail.sidebar.assigned-to-me')}
						onSelect={() => onSelectView('mine')}
					/>
					<SidebarMenuAction
						icon={<Clock className={MENU_ICON_CLASS} aria-hidden />}
						label={t('mail.sidebar.snoozed')}
						onSelect={() => onSelectView('snoozed')}
					/>
					<SidebarMenuAction
						icon={<Archive className={MENU_ICON_CLASS} aria-hidden />}
						label={t('mail.sidebar.closed')}
						onSelect={() => onSelectView('closed')}
					/>
					<DropdownMenuSeparator className="my-1.5" />
					<SidebarMenuAction
						icon={<Settings2 className={MENU_ICON_CLASS} aria-hidden />}
						label={t('inbox.sidebar.manage-inboxes')}
						onSelect={onManageInboxes}
					/>
				</>
			}
		/>
	)
}
