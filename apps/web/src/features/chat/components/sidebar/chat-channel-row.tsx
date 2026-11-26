import type { ChatChannelDto, ChatSidebarSectionDto } from '@huriro/contracts'
import { t } from '@huriro/i18n'
import { Bell, BellOff, CheckCheck, FolderInput, Hash, Link2, Lock, Pencil, Users, X } from 'lucide-react'
import { SidebarActionRow, SidebarMenuAction } from '@/components/app-shell/sidebar/sidebar-action-row'
import { DropdownMenuLabel, DropdownMenuSeparator } from '@/components/ui/dropdown-menu'
import type { TaskApiBridge } from '@/lib/sync-bootstrap'
import { useUiStore } from '@/stores/ui-store'
import { useChatStore } from '../../store/chat-store'

export interface ChatChannelRowProps {
	readonly channel: ChatChannelDto
	readonly label: string
	readonly isDm: boolean
	readonly peerOnline?: boolean | undefined
	readonly active: boolean
	readonly hasDraft: boolean
	readonly collapsed: boolean
	readonly sectionId?: string | undefined
	readonly sections: readonly ChatSidebarSectionDto[]
	readonly api: TaskApiBridge | null
	readonly onSelect: () => void
}

const MENU_ICON_CLASS = 'size-4 shrink-0 text-muted-foreground'

/** Channel or DM row with unread weight, mute dimming, section membership actions, and copy-link. */
export function ChatChannelRow({
	channel,
	label,
	isDm,
	peerOnline = false,
	active,
	hasDraft,
	collapsed,
	sectionId,
	sections,
	api,
	onSelect
}: ChatChannelRowProps) {
	const selectChannel = useChatStore((s) => s.selectChannel)
	const toggleMute = useChatStore((s) => s.toggleMute)
	const addChannelToSection = useChatStore((s) => s.addChannelToSection)
	const removeChannelFromSection = useChatStore((s) => s.removeChannelFromSection)
	const setMembersDialogOpen = useChatStore((s) => s.setMembersDialogOpen)
	const pushToast = useUiStore((s) => s.pushToast)

	const isUnread = channel.unreadCount > 0 || channel.hasUnread

	async function guarded(action: () => Promise<void>) {
		try {
			await action()
		} catch (err) {
			pushToast({
				tone: 'danger',
				title: t('shell.sidebar.action-failed'),
				description: err instanceof Error ? err.message : undefined
			})
		}
	}

	async function handleMarkRead() {
		if (!api) return
		const res = await api.markChannelRead(channel.id, channel.lastMsgSeq)
		useChatStore.setState((s) => ({
			channels: s.channels.map((c) =>
				c.id === channel.id
					? {
							...c,
							lastReadSeq: res.lastReadSeq,
							unreadCount: res.unreadCount,
							hasUnread: res.unreadCount > 0,
							mentionCount: 0
						}
					: c
			)
		}))
		pushToast({ tone: 'success', title: t('chat.sidebar.marked-read-toast') })
	}

	async function handleToggleMute() {
		if (!api) return
		const nextMuted = !channel.muted
		await toggleMute(api, channel.id, nextMuted)
		pushToast({
			tone: 'success',
			title: nextMuted ? t('chat.sidebar.muted-toast') : t('chat.sidebar.unmuted-toast')
		})
	}

	async function handleCopyLink() {
		if (typeof navigator === 'undefined' || !navigator.clipboard) {
			throw new Error('Clipboard is unavailable in this context')
		}
		await navigator.clipboard.writeText(
			`${window.location.origin}/chat?channel=${encodeURIComponent(channel.id)}`
		)
		pushToast({ tone: 'success', title: t('chat.sidebar.link-copied') })
	}

	const icon = isDm ? (
		<span className="relative inline-flex">
			<Users className="size-4" />
			{peerOnline ? (
				<span className="absolute -right-0.5 -bottom-0.5 size-2 rounded-full bg-(--success)" />
			) : null}
		</span>
	) : channel.kind === 'private' ? (
		<Lock className="size-4" />
	) : (
		<Hash className="size-4" />
	)

	const trailingIcon =
		channel.muted && hasDraft ? (
			<span className="flex items-center gap-1">
				<BellOff className="size-3 text-sidebar-muted-foreground/75" aria-hidden />
				<Pencil className="size-3 text-sidebar-muted-foreground/75" aria-hidden />
			</span>
		) : channel.muted ? (
			<BellOff className="size-3 text-sidebar-muted-foreground/75" aria-hidden />
		) : hasDraft ? (
			<Pencil className="size-3 text-sidebar-muted-foreground/75" aria-hidden />
		) : undefined

	const canMoveSections = !isDm && api !== null && !sectionId && sections.length > 0

	return (
		<SidebarActionRow
			icon={icon}
			label={label}
			active={active}
			isCurrentPage={active}
			emphasized={isUnread}
			muted={channel.muted}
			collapsed={collapsed}
			badgeCount={channel.unreadCount > 0 ? channel.unreadCount : undefined}
			badgeTone="primary"
			trailingIcon={trailingIcon}
			menuAriaLabel={t('chat.sidebar.channel-actions')}
			onClick={onSelect}
			menuContent={
				<>
					{isUnread && api ? (
						<SidebarMenuAction
							icon={<CheckCheck className={MENU_ICON_CLASS} aria-hidden />}
							label={t('chat.sidebar.mark-read')}
							onSelect={() => void guarded(handleMarkRead)}
						/>
					) : null}
					{api ? (
						<SidebarMenuAction
							icon={
								channel.muted ? (
									<Bell className={MENU_ICON_CLASS} aria-hidden />
								) : (
									<BellOff className={MENU_ICON_CLASS} aria-hidden />
								)
							}
							label={channel.muted ? t('chat.sidebar.unmute') : t('chat.sidebar.mute')}
							onSelect={() => void guarded(handleToggleMute)}
						/>
					) : null}
					{!isDm && api && sectionId ? (
						<SidebarMenuAction
							icon={<X className={MENU_ICON_CLASS} aria-hidden />}
							label={t('chat.sidebar.section-remove-channel')}
							onSelect={() => void guarded(() => removeChannelFromSection(api, sectionId, channel.id))}
						/>
					) : null}

					{canMoveSections ? (
						<>
							<DropdownMenuSeparator className="my-1.5" />
							<DropdownMenuLabel className="px-2.5 py-1 text-[11px]">
								{t('chat.sidebar.move-to-section')}
							</DropdownMenuLabel>
							{sections.map((sec) => (
								<SidebarMenuAction
									key={sec.id}
									icon={<FolderInput className={MENU_ICON_CLASS} aria-hidden />}
									label={sec.name}
									onSelect={() => void guarded(() => addChannelToSection(api, sec.id, channel.id))}
								/>
							))}
						</>
					) : null}

					{!isDm ? (
						<>
							<DropdownMenuSeparator className="my-1.5" />
							<SidebarMenuAction
								icon={<Users className={MENU_ICON_CLASS} aria-hidden />}
								label={t('chat.sidebar.members')}
								onSelect={() => {
									if (api) void selectChannel(api, channel.id)
									setMembersDialogOpen(true)
								}}
							/>
						</>
					) : null}

					<DropdownMenuSeparator className="my-1.5" />
					<SidebarMenuAction
						icon={<Link2 className={MENU_ICON_CLASS} aria-hidden />}
						label={t('chat.sidebar.copy-link')}
						onSelect={() => void guarded(handleCopyLink)}
					/>
				</>
			}
		/>
	)
}
