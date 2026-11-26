import { t } from '@huriro/i18n'
import {
	BookmarkCheck,
	FileEdit,
	FolderPlus,
	Hash,
	MessageSquareDot,
	MessageSquareText,
	Plus,
	Smile,
	Users
} from 'lucide-react'
import { type FormEvent, useEffect, useMemo, useState } from 'react'
import { SidebarActionRow } from '@/components/app-shell/sidebar/sidebar-action-row'
import { SidebarCollapsibleSection } from '@/components/app-shell/sidebar/sidebar-collapsible-section'
import { SidebarFilterInput } from '@/components/app-shell/sidebar/sidebar-filter-input'
import { useSidebarCollapsed } from '@/components/app-shell/sidebar/sidebar-primitives'
import { Button } from '@/components/ui/button'
import {
	DropdownMenu,
	DropdownMenuContent,
	DropdownMenuItem,
	DropdownMenuTrigger
} from '@/components/ui/dropdown-menu'
import { Input } from '@/components/ui/input'
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover'
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from '@/components/ui/tooltip'
import { useOptionalWorkspace } from '@/lib/workspace'
import { useChatStore } from '../store/chat-store'
import { ChatChannelRow } from './sidebar/chat-channel-row'
import { ChatCustomSection } from './sidebar/chat-custom-section'
import { ChatStatusCard } from './sidebar/chat-status-card'

export function ChatSidebarNav({ collapsed }: { readonly collapsed?: boolean | undefined }) {
	const ctxCollapsed = useSidebarCollapsed()
	const isCollapsed = collapsed ?? ctxCollapsed
	const workspace = useOptionalWorkspace()
	const api = workspace?.api ?? null
	const currentUserId = workspace?.currentUserId ?? null

	const channels = useChatStore((s) => s.channels)
	const activeChannelId = useChatStore((s) => s.activeChannelId)
	const activeView = useChatStore((s) => s.activeView)
	const presenceByUser = useChatStore((s) => s.presenceByUser)
	const drafts = useChatStore((s) => s.drafts)
	const scheduledMessages = useChatStore((s) => s.scheduledMessages)
	const savedItems = useChatStore((s) => s.savedItems)
	const sidebarSections = useChatStore((s) => s.sidebarSections)
	const myStatus = useChatStore((s) => s.myStatus)

	const loadChannels = useChatStore((s) => s.loadChannels)
	const loadChatV2Metadata = useChatStore((s) => s.loadChatV2Metadata)
	const selectChannel = useChatStore((s) => s.selectChannel)
	const setActiveView = useChatStore((s) => s.setActiveView)
	const setCreateChannelOpen = useChatStore((s) => s.setCreateChannelOpen)
	const setCreateDmOpen = useChatStore((s) => s.setCreateDmOpen)
	const createSidebarSection = useChatStore((s) => s.createSidebarSection)

	const [filter, setFilter] = useState('')
	const [newSectionOpen, setNewSectionOpen] = useState(false)
	const [newSectionName, setNewSectionName] = useState('')

	useEffect(() => {
		if (!api) return
		if (channels.length === 0) {
			void loadChannels(api)
		}
		void loadChatV2Metadata(api)
	}, [api, channels.length, loadChannels, loadChatV2Metadata])

	async function handleCreateSection(ev: FormEvent) {
		ev.preventDefault()
		const name = newSectionName.trim()
		if (!name || !api) return
		await createSidebarSection(api, { name })
		setNewSectionName('')
		setNewSectionOpen(false)
	}

	const openSavedCount = useMemo(
		() => savedItems.filter((item) => item.status === 'saved' || item.status === 'in_progress').length,
		[savedItems]
	)
	const draftsAndScheduledCount = useMemo(
		() =>
			drafts.filter((d) => d.bodyText.trim().length > 0).length +
			scheduledMessages.filter((s) => s.status === 'scheduled').length,
		[drafts, scheduledMessages]
	)
	const unreadChannelsCount = useMemo(
		() => channels.filter((c) => c.unreadCount > 0 || c.hasUnread).length,
		[channels]
	)
	const draftChannelIds = useMemo(
		() =>
			new Set(
				drafts.filter((d) => !d.threadParentId && d.bodyText.trim().length > 0).map((d) => d.channelId)
			),
		[drafts]
	)

	const needle = filter.trim().toLowerCase()
	const channelById = useMemo(() => new Map(channels.map((c) => [c.id, c])), [channels])
	const sectionedChannelIds = useMemo(
		() => new Set(sidebarSections.flatMap((sec) => (sec.items ?? []).map((item) => item.channelId))),
		[sidebarSections]
	)

	const channelItems = useMemo(
		() =>
			channels.filter(
				(c) =>
					c.kind !== 'dm' &&
					!sectionedChannelIds.has(c.id) &&
					(!needle || (c.name ?? 'channel').toLowerCase().includes(needle))
			),
		[channels, needle, sectionedChannelIds]
	)

	const dmEntries = useMemo(() => {
		return channels
			.filter((c) => c.kind === 'dm')
			.map((dm) => {
				const peers = (dm.members ?? []).filter((m) => m.principalId !== currentUserId)
				const label =
					peers.map((p) => p.displayName ?? p.email ?? p.principalId.slice(0, 8)).join(', ') || 'DM'
				const peerOnline = peers.some((p) => presenceByUser[p.principalId]?.status === 'online')
				return { dm, label, peerOnline }
			})
			.filter((entry) => !needle || entry.label.toLowerCase().includes(needle))
	}, [channels, currentUserId, needle, presenceByUser])

	const customSections = useMemo(() => {
		return sidebarSections
			.map((sec) => {
				const rawMembers = (sec.items ?? [])
					.map((item) => channelById.get(item.channelId))
					.filter((c): c is NonNullable<typeof c> => Boolean(c))
				const visible = sec.unreadOnly
					? rawMembers.filter((c) => c.unreadCount > 0 || c.hasUnread)
					: rawMembers
				const filtered = needle
					? visible.filter((c) => (c.name ?? 'channel').toLowerCase().includes(needle))
					: visible
				return { section: sec, members: filtered }
			})
			.filter((entry) => !needle || entry.members.length > 0)
	}, [channelById, needle, sidebarSections])

	const hasFilterMatches = customSections.length > 0 || channelItems.length > 0 || dmEntries.length > 0

	function handleSelectChannel(channelId: string) {
		if (!api) return
		void selectChannel(api, channelId)
	}

	return (
		<TooltipProvider delayDuration={300}>
			<nav data-feature-sidebar aria-label={t('nav.chat')} className="space-y-0.5">
				{!isCollapsed ? (
					<>
						<ChatStatusCard api={api} myStatus={myStatus} />
						<SidebarFilterInput
							value={filter}
							onChange={setFilter}
							placeholder={t('chat.sidebar.filter-placeholder')}
							ariaLabel={t('chat.sidebar.filter-label')}
							clearLabel={t('shell.sidebar.filter-clear')}
						/>
					</>
				) : null}

				{needle && !hasFilterMatches ? (
					<div className="space-y-2 px-2 py-4 text-center">
						<p className="text-xs text-sidebar-muted-foreground">
							{t('shell.sidebar.filter-empty', { query: filter.trim() })}
						</p>
						<button
							type="button"
							onClick={() => setFilter('')}
							className="text-xs font-medium text-sidebar-primary underline-offset-4 hover:underline"
						>
							{t('shell.sidebar.filter-clear')}
						</button>
					</div>
				) : (
					<>
						{!needle ? (
							<>
								<SidebarActionRow
									icon={<MessageSquareText className="size-4" />}
									label={t('chat.sidebar.threads')}
									active={activeView === 'threads'}
									isCurrentPage={activeView === 'threads'}
									collapsed={isCollapsed}
									onClick={() => setActiveView('threads')}
								/>
								<SidebarActionRow
									icon={<MessageSquareDot className="size-4" />}
									label={t('chat.sidebar.unreads')}
									active={activeView === 'unreads'}
									isCurrentPage={activeView === 'unreads'}
									badgeCount={unreadChannelsCount > 0 ? unreadChannelsCount : undefined}
									badgeTone="primary"
									collapsed={isCollapsed}
									onClick={() => setActiveView('unreads')}
								/>
								<SidebarActionRow
									icon={<BookmarkCheck className="size-4" />}
									label={t('chat.sidebar.later')}
									active={activeView === 'later'}
									isCurrentPage={activeView === 'later'}
									badgeCount={openSavedCount > 0 ? openSavedCount : undefined}
									badgeTone="muted"
									collapsed={isCollapsed}
									onClick={() => setActiveView('later')}
								/>
								<SidebarActionRow
									icon={<FileEdit className="size-4" />}
									label={t('chat.sidebar.drafts')}
									active={activeView === 'drafts'}
									isCurrentPage={activeView === 'drafts'}
									badgeCount={draftsAndScheduledCount > 0 ? draftsAndScheduledCount : undefined}
									badgeTone="muted"
									collapsed={isCollapsed}
									onClick={() => setActiveView('drafts')}
								/>
								<SidebarActionRow
									icon={<Smile className="size-4" />}
									label={t('chat.sidebar.groups')}
									active={activeView === 'groups'}
									isCurrentPage={activeView === 'groups'}
									collapsed={isCollapsed}
									onClick={() => setActiveView('groups')}
								/>
							</>
						) : null}

						{customSections.map(({ section, members }) => (
							<ChatCustomSection
								key={section.id}
								section={section}
								channels={members}
								allSections={sidebarSections}
								activeChannelId={activeChannelId}
								isChannelView={activeView === 'channel'}
								draftChannelIds={draftChannelIds}
								collapsed={isCollapsed}
								filtering={needle.length > 0}
								api={api}
								onSelectChannel={handleSelectChannel}
							/>
						))}

						{!needle || channelItems.length > 0 ? (
							<SidebarCollapsibleSection
								title={t('chat.sidebar.channels')}
								count={channelItems.length}
								railCollapsed={isCollapsed}
								action={
									!isCollapsed ? (
										<div className="flex items-center gap-0.5">
											<Popover open={newSectionOpen} onOpenChange={setNewSectionOpen}>
												<Tooltip>
													<TooltipTrigger asChild>
														<PopoverTrigger asChild>
															<button
																type="button"
																aria-label={t('chat.sidebar.new-section')}
																className="flex size-5 items-center justify-center rounded-md text-sidebar-muted-foreground/80 outline-none transition-colors hover:bg-sidebar-accent hover:text-sidebar-foreground focus-visible:ring-2 focus-visible:ring-sidebar-primary/60"
															>
																<FolderPlus className="size-3.5" aria-hidden />
															</button>
														</PopoverTrigger>
													</TooltipTrigger>
													<TooltipContent side="top">{t('chat.sidebar.new-section')}</TooltipContent>
												</Tooltip>
												<PopoverContent align="end" className="w-60">
													<form onSubmit={(ev) => void handleCreateSection(ev)} className="space-y-2">
														<p className="text-xs font-semibold text-foreground">
															{t('chat.sidebar.new-section')}
														</p>
														<Input
															value={newSectionName}
															onChange={(ev) => setNewSectionName(ev.target.value)}
															placeholder={t('chat.sidebar.section-placeholder')}
															aria-label={t('chat.sidebar.section-placeholder')}
															maxLength={80}
														/>
														<Button
															size="sm"
															type="submit"
															className="w-full"
															disabled={!newSectionName.trim() || !api}
														>
															{t('chat.sidebar.new-section')}
														</Button>
													</form>
												</PopoverContent>
											</Popover>
											<Tooltip>
												<TooltipTrigger asChild>
													<button
														type="button"
														aria-label={t('chat.sidebar.new-channel')}
														onClick={() => setCreateChannelOpen(true)}
														className="flex size-5 items-center justify-center rounded-md text-sidebar-muted-foreground/80 outline-none transition-colors hover:bg-sidebar-accent hover:text-sidebar-foreground focus-visible:ring-2 focus-visible:ring-sidebar-primary/60"
													>
														<Plus className="size-3.5" aria-hidden />
													</button>
												</TooltipTrigger>
												<TooltipContent side="top">{t('chat.sidebar.new-channel')}</TooltipContent>
											</Tooltip>
										</div>
									) : undefined
								}
							>
								{channelItems.map((ch) => (
									<ChatChannelRow
										key={ch.id}
										channel={ch}
										label={ch.name ?? 'channel'}
										isDm={false}
										active={activeView === 'channel' && activeChannelId === ch.id}
										hasDraft={draftChannelIds.has(ch.id)}
										collapsed={isCollapsed}
										sections={sidebarSections}
										api={api}
										onSelect={() => handleSelectChannel(ch.id)}
									/>
								))}
							</SidebarCollapsibleSection>
						) : null}

						{!needle || dmEntries.length > 0 ? (
							<SidebarCollapsibleSection
								title={t('chat.sidebar.direct-messages')}
								count={dmEntries.length}
								railCollapsed={isCollapsed}
								action={
									!isCollapsed ? (
										<Tooltip>
											<TooltipTrigger asChild>
												<button
													type="button"
													aria-label={t('chat.sidebar.new-dm')}
													onClick={() => setCreateDmOpen(true)}
													className="flex size-5 items-center justify-center rounded-md text-sidebar-muted-foreground/80 outline-none transition-colors hover:bg-sidebar-accent hover:text-sidebar-foreground focus-visible:ring-2 focus-visible:ring-sidebar-primary/60"
												>
													<Plus className="size-3.5" aria-hidden />
												</button>
											</TooltipTrigger>
											<TooltipContent side="top">{t('chat.sidebar.new-dm')}</TooltipContent>
										</Tooltip>
									) : undefined
								}
							>
								{dmEntries.length === 0 ? (
									<SidebarActionRow
										icon={<Users className="size-4" />}
										label={t('chat.sidebar.no-dms')}
										disabled={isCollapsed}
										collapsed={isCollapsed}
										onClick={isCollapsed ? undefined : () => setCreateDmOpen(true)}
									/>
								) : (
									dmEntries.map(({ dm, label, peerOnline }) => (
										<ChatChannelRow
											key={dm.id}
											channel={dm}
											label={label}
											isDm
											peerOnline={peerOnline}
											active={activeView === 'channel' && activeChannelId === dm.id}
											hasDraft={draftChannelIds.has(dm.id)}
											collapsed={isCollapsed}
											sections={sidebarSections}
											api={api}
											onSelect={() => handleSelectChannel(dm.id)}
										/>
									))
								)}
							</SidebarCollapsibleSection>
						) : null}
					</>
				)}
			</nav>
		</TooltipProvider>
	)
}

export function ChatSidebarHeaderAction() {
	const setCreateChannelOpen = useChatStore((s) => s.setCreateChannelOpen)
	const setCreateDmOpen = useChatStore((s) => s.setCreateDmOpen)

	return (
		<DropdownMenu>
			<Tooltip>
				<TooltipTrigger asChild>
					<DropdownMenuTrigger asChild>
						<button
							type="button"
							aria-label={t('chat.sidebar.quick-compose')}
							className="flex size-7 items-center justify-center rounded-lg text-sidebar-muted-foreground transition-colors hover:bg-sidebar-accent hover:text-sidebar-foreground"
						>
							<Plus className="size-4" aria-hidden />
						</button>
					</DropdownMenuTrigger>
				</TooltipTrigger>
				<TooltipContent side="bottom">{t('chat.sidebar.quick-compose')}</TooltipContent>
			</Tooltip>
			<DropdownMenuContent align="end" className="w-48 rounded-xl border-border/80 p-1.5 shadow-(--shadow-3)">
				<DropdownMenuItem
					className="gap-2 rounded-lg px-2.5 py-1.5 text-[13px]"
					onSelect={() => setCreateChannelOpen(true)}
				>
					<Hash className="size-4 text-muted-foreground" aria-hidden />
					<span>{t('chat.sidebar.new-channel')}</span>
				</DropdownMenuItem>
				<DropdownMenuItem
					className="gap-2 rounded-lg px-2.5 py-1.5 text-[13px]"
					onSelect={() => setCreateDmOpen(true)}
				>
					<Users className="size-4 text-muted-foreground" aria-hidden />
					<span>{t('chat.sidebar.new-dm')}</span>
				</DropdownMenuItem>
			</DropdownMenuContent>
		</DropdownMenu>
	)
}
