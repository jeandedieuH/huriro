import { t } from '@huriro/i18n'
import { Hash, Lock, MessageSquareDot, MessageSquareText, Plus, Users } from 'lucide-react'
import { useEffect } from 'react'
import {
	SidebarNavItem,
	SidebarSection,
	useSidebarCollapsed
} from '@/components/app-shell/sidebar/sidebar-primitives'
import { Button } from '@/components/ui/button'
import { useWorkspace } from '@/lib/workspace'
import { useChatStore } from '../store/chat-store'

export function ChatSidebarNav({ collapsed }: { readonly collapsed?: boolean | undefined }) {
	const ctxCollapsed = useSidebarCollapsed()
	const isCollapsed = collapsed ?? ctxCollapsed
	const { api, currentUserId } = useWorkspace()

	const channels = useChatStore((s) => s.channels)
	const activeChannelId = useChatStore((s) => s.activeChannelId)
	const activeView = useChatStore((s) => s.activeView)
	const presenceByUser = useChatStore((s) => s.presenceByUser)
	const loadChannels = useChatStore((s) => s.loadChannels)
	const selectChannel = useChatStore((s) => s.selectChannel)
	const setActiveView = useChatStore((s) => s.setActiveView)
	const setCreateChannelOpen = useChatStore((s) => s.setCreateChannelOpen)
	const setCreateDmOpen = useChatStore((s) => s.setCreateDmOpen)

	useEffect(() => {
		if (channels.length === 0) {
			void loadChannels(api)
		}
	}, [api, channels.length, loadChannels])

	const channelItems = channels.filter((c) => c.kind !== 'dm')
	const dmItems = channels.filter((c) => c.kind === 'dm')

	return (
		<nav aria-label={t('nav.chat')} className="space-y-0.5">
			<SidebarNavItem
				icon={<MessageSquareText className="size-4" />}
				label={t('chat.sidebar.threads')}
				active={activeView === 'threads'}
				collapsed={isCollapsed}
				onClick={() => setActiveView('threads')}
			/>
			<SidebarNavItem
				icon={<MessageSquareDot className="size-4" />}
				label={t('chat.sidebar.unreads')}
				active={activeView === 'unreads'}
				collapsed={isCollapsed}
				onClick={() => setActiveView('unreads')}
			/>

			<SidebarSection
				title={t('chat.sidebar.channels')}
				collapsed={isCollapsed}
				action={
					!isCollapsed ? (
						<Button
							size="icon"
							tone="ghost"
							type="button"
							className="size-5"
							aria-label={t('chat.sidebar.new-channel')}
							onClick={() => setCreateChannelOpen(true)}
						>
							<Plus className="size-3.5" aria-hidden />
						</Button>
					) : undefined
				}
			>
				{channelItems.map((ch) => (
					<SidebarNavItem
						key={ch.id}
						icon={ch.kind === 'private' ? <Lock className="size-4" /> : <Hash className="size-4" />}
						label={ch.name ?? ch.id.slice(0, 8)}
						active={activeView === 'channel' && activeChannelId === ch.id}
						badgeCount={ch.unreadCount > 0 ? ch.unreadCount : undefined}
						collapsed={isCollapsed}
						onClick={() => void selectChannel(api, ch.id)}
					/>
				))}
			</SidebarSection>

			<SidebarSection
				title={t('chat.sidebar.direct-messages')}
				collapsed={isCollapsed}
				action={
					!isCollapsed ? (
						<Button
							size="icon"
							tone="ghost"
							type="button"
							className="size-5"
							aria-label={t('chat.sidebar.new-dm')}
							onClick={() => setCreateDmOpen(true)}
						>
							<Plus className="size-3.5" aria-hidden />
						</Button>
					) : undefined
				}
			>
				{dmItems.length === 0 ? (
					<SidebarNavItem
						icon={<Users className="size-4" />}
						label={t('chat.sidebar.no-dms')}
						disabled
						collapsed={isCollapsed}
					/>
				) : (
					dmItems.map((dm) => {
						const peers = (dm.members ?? []).filter((m) => m.principalId !== currentUserId)
						const label =
							peers.map((p) => p.displayName ?? p.email ?? p.principalId.slice(0, 8)).join(', ') || 'DM'
						const peerOnline = peers.some((p) => presenceByUser[p.principalId]?.status === 'online')
						return (
							<SidebarNavItem
								key={dm.id}
								icon={
									<span className="relative inline-flex">
										<Users className="size-4" />
										{peerOnline ? (
											<span className="absolute -bottom-0.5 -right-0.5 size-2 rounded-full bg-(--success)" />
										) : null}
									</span>
								}
								label={label}
								active={activeView === 'channel' && activeChannelId === dm.id}
								badgeCount={dm.unreadCount > 0 ? dm.unreadCount : undefined}
								collapsed={isCollapsed}
								onClick={() => void selectChannel(api, dm.id)}
							/>
						)
					})
				)}
			</SidebarSection>
		</nav>
	)
}
