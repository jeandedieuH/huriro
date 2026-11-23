import type { ChatMessageDto } from '@huriro/contracts'
import { t } from '@huriro/i18n'
import { useEffect, useRef } from 'react'
import { EmptyState } from '@/components/ui/empty-state'
import { MessageItem } from './message-item'

export interface MessageListProps {
	readonly messages: readonly ChatMessageDto[]
	readonly currentUserId: string
	readonly highlightedMessageId?: string | null | undefined
	readonly onReply: (messageId: string) => void
	readonly onEdit: (messageId: string, bodyText: string, version: number) => Promise<void>
	readonly onDelete: (messageId: string) => Promise<void>
	readonly onToggleReaction: (messageId: string, emoji: string, currentlyReacted: boolean) => Promise<void>
}

export function MessageList({
	messages,
	currentUserId,
	highlightedMessageId,
	onReply,
	onEdit,
	onDelete,
	onToggleReaction
}: MessageListProps) {
	const endRef = useRef<HTMLDivElement | null>(null)

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
					onReply={onReply}
					onEdit={onEdit}
					onDelete={onDelete}
					onToggleReaction={onToggleReaction}
				/>
			))}
			<div ref={endRef} />
		</div>
	)
}
