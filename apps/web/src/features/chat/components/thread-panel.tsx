import type { ChatMessageDto, FileDto } from '@huriro/contracts'
import { t } from '@huriro/i18n'
import { X } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Separator } from '@/components/ui/separator'
import { MessageComposer } from './message-composer'
import { MessageItem } from './message-item'

export interface ThreadPanelProps {
	readonly parent: ChatMessageDto
	readonly replies: readonly ChatMessageDto[]
	readonly currentUserId: string
	readonly onClose: () => void
	readonly onSendReply: (bodyText: string, attachmentFileIds: string[]) => Promise<void>
	readonly onUploadFile?: ((file: File) => Promise<FileDto>) | undefined
	readonly onEdit: (messageId: string, bodyText: string, version: number) => Promise<void>
	readonly onDelete: (messageId: string) => Promise<void>
	readonly onToggleReaction: (messageId: string, emoji: string, currentlyReacted: boolean) => Promise<void>
}

export function ThreadPanel({
	parent,
	replies,
	currentUserId,
	onClose,
	onSendReply,
	onUploadFile,
	onEdit,
	onDelete,
	onToggleReaction
}: ThreadPanelProps) {
	return (
		<aside
			aria-label={t('chat.thread.title')}
			className="flex h-full w-96 shrink-0 flex-col border-l border-border bg-card text-card-foreground"
		>
			<header className="flex items-center justify-between border-b border-border px-4 py-2.5">
				<h2 className="text-sm font-semibold">{t('chat.thread.title')}</h2>
				<Button size="icon" tone="ghost" type="button" aria-label={t('common.close')} onClick={onClose}>
					<X className="size-4" aria-hidden />
				</Button>
			</header>

			<div className="flex-1 space-y-3 overflow-y-auto p-3">
				<MessageItem
					message={parent}
					currentUserId={currentUserId}
					isThreadView
					onEdit={onEdit}
					onDelete={onDelete}
					onToggleReaction={onToggleReaction}
				/>

				<Separator />

				{replies.length === 0 ? (
					<p className="px-2 py-4 text-center text-xs text-muted-foreground">{t('chat.thread.empty')}</p>
				) : (
					<div className="space-y-1">
						{replies.map((reply) => (
							<MessageItem
								key={reply.id}
								message={reply}
								currentUserId={currentUserId}
								isThreadView
								onEdit={onEdit}
								onDelete={onDelete}
								onToggleReaction={onToggleReaction}
							/>
						))}
					</div>
				)}
			</div>

			<div className="border-t border-border p-3">
				<MessageComposer
					placeholder={t('chat.composer.thread-placeholder')}
					onSend={onSendReply}
					onUploadFile={onUploadFile}
				/>
			</div>
		</aside>
	)
}
