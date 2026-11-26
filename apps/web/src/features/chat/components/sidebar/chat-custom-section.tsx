import type { ChatChannelDto, ChatSidebarSectionDto } from '@huriro/contracts'
import { t } from '@huriro/i18n'
import { Eye, EyeOff, Trash2 } from 'lucide-react'
import { SidebarCollapsibleSection } from '@/components/app-shell/sidebar/sidebar-collapsible-section'
import { Tooltip, TooltipContent, TooltipTrigger } from '@/components/ui/tooltip'
import type { TaskApiBridge } from '@/lib/sync-bootstrap'
import { useChatStore } from '../../store/chat-store'
import { ChatChannelRow } from './chat-channel-row'

export interface ChatCustomSectionProps {
	readonly section: ChatSidebarSectionDto
	readonly channels: readonly ChatChannelDto[]
	readonly allSections: readonly ChatSidebarSectionDto[]
	readonly activeChannelId: string | null
	readonly isChannelView: boolean
	readonly draftChannelIds: ReadonlySet<string>
	readonly collapsed: boolean
	readonly filtering: boolean
	readonly api: TaskApiBridge | null
	readonly onSelectChannel: (channelId: string) => void
}

/** Custom user-created channel group with persisted collapse, unread-only filter, and delete controls. */
export function ChatCustomSection({
	section,
	channels,
	allSections,
	activeChannelId,
	isChannelView,
	draftChannelIds,
	collapsed,
	filtering,
	api,
	onSelectChannel
}: ChatCustomSectionProps) {
	const updateSidebarSection = useChatStore((s) => s.updateSidebarSection)
	const deleteSidebarSection = useChatStore((s) => s.deleteSidebarSection)

	return (
		<SidebarCollapsibleSection
			title={section.name}
			count={channels.length}
			railCollapsed={collapsed}
			collapsed={filtering ? false : section.collapsed}
			onToggleCollapsed={() => {
				if (!api) return
				void updateSidebarSection(api, section.id, {
					collapsed: !section.collapsed,
					version: section.version
				})
			}}
			action={
				!collapsed && api ? (
					<div className="flex items-center gap-0.5">
						<Tooltip>
							<TooltipTrigger asChild>
								<button
									type="button"
									aria-label={t('chat.sidebar.section-unread-only')}
									onClick={() =>
										void updateSidebarSection(api, section.id, {
											unreadOnly: !section.unreadOnly,
											version: section.version
										})
									}
									className="flex size-5 items-center justify-center rounded-md text-sidebar-muted-foreground/80 outline-none transition-colors hover:bg-sidebar-accent hover:text-sidebar-foreground focus-visible:ring-2 focus-visible:ring-sidebar-primary/60"
								>
									{section.unreadOnly ? (
										<EyeOff className="size-3 text-sidebar-primary" aria-hidden />
									) : (
										<Eye className="size-3" aria-hidden />
									)}
								</button>
							</TooltipTrigger>
							<TooltipContent side="top">{t('chat.sidebar.section-unread-only')}</TooltipContent>
						</Tooltip>
						<Tooltip>
							<TooltipTrigger asChild>
								<button
									type="button"
									aria-label={t('chat.sidebar.section-delete')}
									onClick={() => void deleteSidebarSection(api, section.id)}
									className="flex size-5 items-center justify-center rounded-md text-sidebar-muted-foreground/80 outline-none transition-colors hover:bg-sidebar-accent hover:text-destructive focus-visible:ring-2 focus-visible:ring-sidebar-primary/60"
								>
									<Trash2 className="size-3" aria-hidden />
								</button>
							</TooltipTrigger>
							<TooltipContent side="top">{t('chat.sidebar.section-delete')}</TooltipContent>
						</Tooltip>
					</div>
				) : undefined
			}
		>
			{channels.map((ch) => (
				<ChatChannelRow
					key={ch.id}
					channel={ch}
					label={ch.name ?? 'channel'}
					isDm={false}
					active={isChannelView && activeChannelId === ch.id}
					hasDraft={draftChannelIds.has(ch.id)}
					collapsed={collapsed}
					sectionId={section.id}
					sections={allSections}
					api={api}
					onSelect={() => onSelectChannel(ch.id)}
				/>
			))}
		</SidebarCollapsibleSection>
	)
}
