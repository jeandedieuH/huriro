import type { ChatChannelDto, ChatMessageDto } from '@huriro/contracts'
import { t } from '@huriro/i18n'
import { useEffect, useState } from 'react'
import { Button } from '@/components/ui/button'
import {
	Dialog,
	DialogContent,
	DialogDescription,
	DialogFooter,
	DialogHeader,
	DialogTitle
} from '@/components/ui/dialog'
import { Input } from '@/components/ui/input'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select'

export interface ForwardMessageDialogProps {
	readonly open: boolean
	readonly message: ChatMessageDto | null
	readonly channels: readonly ChatChannelDto[]
	readonly currentUserId: string
	readonly onOpenChange: (open: boolean) => void
	readonly onForward: (targetChannelId: string, note?: string) => Promise<void> | void
}

function channelDisplayName(channel: ChatChannelDto, currentUserId: string): string {
	if (channel.kind === 'dm') {
		const others = (channel.members ?? []).filter((m) => m.principalId !== currentUserId)
		return others.map((m) => m.displayName ?? m.email ?? m.principalId.slice(0, 8)).join(', ') || 'DM'
	}
	return `#${channel.name ?? 'channel'}`
}

/** Modal dialog for forwarding a chat message into another channel or DM. */
export function ForwardMessageDialog({
	open,
	message,
	channels,
	currentUserId,
	onOpenChange,
	onForward
}: ForwardMessageDialogProps) {
	const [targetChannelId, setTargetChannelId] = useState('')
	const [note, setNote] = useState('')
	const [submitting, setSubmitting] = useState(false)

	useEffect(() => {
		if (!open) {
			setNote('')
			return
		}
		const fallback = channels.find((c) => c.id !== message?.channelId)?.id ?? channels[0]?.id ?? ''
		setTargetChannelId(fallback)
	}, [open, channels, message?.channelId])

	async function handleSubmit(ev: React.FormEvent) {
		ev.preventDefault()
		if (!targetChannelId || submitting) return
		setSubmitting(true)
		try {
			const trimmed = note.trim()
			await onForward(targetChannelId, trimmed || undefined)
			onOpenChange(false)
		} finally {
			setSubmitting(false)
		}
	}

	return (
		<Dialog open={open} onOpenChange={onOpenChange}>
			<DialogContent>
				<DialogHeader>
					<DialogTitle>{t('chat.forward.title')}</DialogTitle>
					<DialogDescription className="truncate">
						{message?.bodyText ?? t('chat.forward.channel')}
					</DialogDescription>
				</DialogHeader>

				<form onSubmit={(ev) => void handleSubmit(ev)} className="space-y-4">
					<div className="space-y-1.5">
						<label htmlFor="chat-forward-channel" className="text-xs font-medium text-foreground">
							{t('chat.forward.channel')}
						</label>
						<Select value={targetChannelId} onValueChange={setTargetChannelId}>
							<SelectTrigger id="chat-forward-channel" aria-label={t('chat.forward.channel')}>
								<SelectValue placeholder={t('chat.forward.channel')} />
							</SelectTrigger>
							<SelectContent>
								{channels.map((c) => (
									<SelectItem key={c.id} value={c.id}>
										{channelDisplayName(c, currentUserId)}
									</SelectItem>
								))}
							</SelectContent>
						</Select>
					</div>

					<div className="space-y-1.5">
						<label htmlFor="chat-forward-note" className="text-xs font-medium text-foreground">
							{t('chat.forward.note')}
						</label>
						<Input
							id="chat-forward-note"
							value={note}
							onChange={(ev) => setNote(ev.target.value)}
							placeholder={t('chat.forward.note')}
							maxLength={4000}
						/>
					</div>

					<DialogFooter>
						<Button size="sm" tone="outline" type="button" onClick={() => onOpenChange(false)}>
							{t('common.cancel')}
						</Button>
						<Button size="sm" type="submit" loading={submitting} disabled={!targetChannelId}>
							{t('chat.forward.submit')}
						</Button>
					</DialogFooter>
				</form>
			</DialogContent>
		</Dialog>
	)
}
