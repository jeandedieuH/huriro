import type { ChatMessageDto, ChatPollDto, WorkspaceEmojiDto } from '@huriro/contracts'
import { t } from '@huriro/i18n'
import { useEffect, useMemo, useRef } from 'react'
import { EmptyState } from '@/components/ui/empty-state'
import { MessageItem } from './message-item'

export interface MessageListProps {
	readonly messages: readonly ChatMessageDto[]
	readonly currentUserId: string
	readonly highlightedMessageId?: string | null | undefined
	readonly memberNamesById?: ReadonlyMap<string, string> | undefined
	readonly workspaceEmojis?: readonly WorkspaceEmojiDto[] | undefined
	readonly pollsById?: ReadonlyMap<string, ChatPollDto> | undefined
	readonly activeHuddleId?: string | null | undefined
	readonly onReply: (messageId: string) => void
	readonly onEdit: (messageId: string, bodyText: string, version: number) => Promise<void>
	readonly onDelete: (messageId: string) => Promise<void>
	readonly onToggleReaction: (messageId: string, emoji: string, currentlyReacted: boolean) => Promise<void>
	readonly onPin?: ((messageId: string) => Promise<void>) | undefined
	readonly onQuote?: ((message: ChatMessageDto) => void) | undefined
	readonly onSave?: ((message: ChatMessageDto) => Promise<void> | void) | undefined
	readonly onForward?: ((message: ChatMessageDto) => void) | undefined
	readonly onCreateIssue?: ((message: ChatMessageDto) => Promise<void> | void) | undefined
	readonly onMarkUnreadFromHere?: ((channelSeq: number) => void) | undefined
	readonly onCopyLink?: ((message: ChatMessageDto) => Promise<void> | void) | undefined
	readonly onVotePoll?: ((pollId: string, optionIds: readonly string[]) => Promise<void> | void) | undefined
	readonly onClosePoll?: ((pollId: string) => Promise<void> | void) | undefined
	readonly onJoinHuddle?: ((huddleId: string) => Promise<void> | void) | undefined
	readonly onEndHuddle?: ((huddleId: string) => Promise<void> | void) | undefined
	readonly onClickChannel?: ((channelName: string) => void) | undefined
}

export function MessageList({
	messages,
	currentUserId,
	highlightedMessageId,
	memberNamesById,
	workspaceEmojis,
	pollsById,
	activeHuddleId,
	onReply,
	onEdit,
	onDelete,
	onToggleReaction,
	onPin,
	onQuote,
	onSave,
	onForward,
	onCreateIssue,
	onMarkUnreadFromHere,
	onCopyLink,
	onVotePoll,
	onClosePoll,
	onJoinHuddle,
	onEndHuddle,
	onClickChannel
}: MessageListProps) {
	const endRef = useRef<HTMLDivElement | null>(null)
	const messagesById = useMemo(() => new Map(messages.map((m) => [m.id, m])), [messages])

	// biome-ignore lint/correctness/useExhaustiveDependencies: scroll must re-run when a message is appended (length) or a highlight is set — neither is read inside the callback
	useEffect(() => {
		if (highlightedMessageId) {
			const el = document.getElementById(`msg-${highlightedMessageId}`)
			el?.scrollIntoView?.({ block: 'center' })
			return
		}
		endRef.current?.scrollIntoView?.({ block: 'end' })
	}, [messages.length, highlightedMessageId])

	if (messages.length === 0) {
		return (
			<div className="flex flex-1 items-center justify-center p-6">
				<EmptyState title={t('chat.empty.messages')} />
			</div>
		)
	}

	return (
		<div className="flex-1 space-y-1 overflow-y-auto px-4 py-3">
			{messages.map((msg) => (
				<MessageItem
					key={msg.id}
					message={msg}
					currentUserId={currentUserId}
					highlighted={highlightedMessageId === msg.id}
					messagesById={messagesById}
					memberNamesById={memberNamesById}
					workspaceEmojis={workspaceEmojis}
					pollsById={pollsById}
					activeHuddleId={activeHuddleId}
					onReply={onReply}
					onEdit={onEdit}
					onDelete={onDelete}
					onToggleReaction={onToggleReaction}
					onPin={onPin}
					onQuote={onQuote}
					onSave={onSave}
					onForward={onForward}
					onCreateIssue={onCreateIssue}
					onMarkUnreadFromHere={onMarkUnreadFromHere}
					onCopyLink={onCopyLink}
					onVotePoll={onVotePoll}
					onClosePoll={onClosePoll}
					onJoinHuddle={onJoinHuddle}
					onEndHuddle={onEndHuddle}
					onClickChannel={onClickChannel}
				/>
			))}
			<div ref={endRef} />
		</div>
	)
}
