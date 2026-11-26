import type {
	ChatChannelDto,
	ChatMessageDto,
	FileDto,
	UserGroupDto,
	WorkspaceEmojiDto
} from '@huriro/contracts'
import { t } from '@huriro/i18n'
import { X } from 'lucide-react'
import { useState } from 'react'
import { Button } from '@/components/ui/button'
import { Checkbox } from '@/components/ui/checkbox'
import { Separator } from '@/components/ui/separator'
import type { AutocompleteMemberEntry } from './composer-autocomplete'
import { MessageComposer } from './message-composer'
import { MessageItem } from './message-item'

export interface ThreadPanelProps {
	readonly parent: ChatMessageDto
	readonly replies: readonly ChatMessageDto[]
	readonly currentUserId: string
	readonly memberNamesById?: ReadonlyMap<string, string> | undefined
	readonly workspaceEmojis?: readonly WorkspaceEmojiDto[] | undefined
	readonly channels?: readonly ChatChannelDto[] | undefined
	readonly members?: readonly AutocompleteMemberEntry[] | undefined
	readonly userGroups?: readonly UserGroupDto[] | undefined
	readonly initialDraftText?: string | undefined
	readonly onDraftChange?: ((text: string) => Promise<void> | void) | undefined
	readonly onClose: () => void
	readonly onSendReply: (
		bodyText: string,
		attachmentFileIds: string[],
		broadcastToChannel?: boolean
	) => Promise<void>
	readonly onUploadFile?: ((file: File) => Promise<FileDto>) | undefined
	readonly onEdit: (messageId: string, bodyText: string, version: number) => Promise<void>
	readonly onDelete: (messageId: string) => Promise<void>
	readonly onToggleReaction: (messageId: string, emoji: string, currentlyReacted: boolean) => Promise<void>
	readonly onSave?: ((message: ChatMessageDto) => Promise<void> | void) | undefined
	readonly onForward?: ((message: ChatMessageDto) => void) | undefined
	readonly onCreateIssue?: ((message: ChatMessageDto) => Promise<void> | void) | undefined
	readonly onCopyLink?: ((message: ChatMessageDto) => Promise<void> | void) | undefined
}

export function ThreadPanel({
	parent,
	replies,
	currentUserId,
	memberNamesById,
	workspaceEmojis,
	channels,
	members,
	userGroups,
	initialDraftText,
	onDraftChange,
	onClose,
	onSendReply,
	onUploadFile,
	onEdit,
	onDelete,
	onToggleReaction,
	onSave,
	onForward,
	onCreateIssue,
	onCopyLink
}: ThreadPanelProps) {
	const [broadcastToChannel, setBroadcastToChannel] = useState(false)

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
					memberNamesById={memberNamesById}
					workspaceEmojis={workspaceEmojis}
					onEdit={onEdit}
					onDelete={onDelete}
					onToggleReaction={onToggleReaction}
					onSave={onSave}
					onForward={onForward}
					onCreateIssue={onCreateIssue}
					onCopyLink={onCopyLink}
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
								memberNamesById={memberNamesById}
								workspaceEmojis={workspaceEmojis}
								onEdit={onEdit}
								onDelete={onDelete}
								onToggleReaction={onToggleReaction}
								onSave={onSave}
								onForward={onForward}
								onCreateIssue={onCreateIssue}
								onCopyLink={onCopyLink}
							/>
						))}
					</div>
				)}
			</div>

			<div className="space-y-2 border-t border-border p-3">
				<div className="inline-flex items-center gap-2">
					<Checkbox
						id="chat-thread-broadcast"
						checked={broadcastToChannel}
						onCheckedChange={(v) => setBroadcastToChannel(v === true)}
					/>
					<label htmlFor="chat-thread-broadcast" className="cursor-pointer text-xs text-muted-foreground">
						{t('chat.thread.broadcast')}
					</label>
				</div>
				<MessageComposer
					channelKey={`thread:${parent.id}`}
					initialDraftText={initialDraftText}
					onDraftChange={onDraftChange}
					channels={channels}
					members={members}
					userGroups={userGroups}
					workspaceEmojis={workspaceEmojis}
					placeholder={t('chat.composer.thread-placeholder')}
					onSend={async (bodyText, attachmentFileIds) => {
						await onSendReply(bodyText, attachmentFileIds, broadcastToChannel)
						setBroadcastToChannel(false)
					}}
					onUploadFile={onUploadFile}
				/>
			</div>
		</aside>
	)
}
