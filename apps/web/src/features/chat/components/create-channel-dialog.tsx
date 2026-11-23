import { t } from '@huriro/i18n'
import { useState } from 'react'
import { Button } from '@/components/ui/button'
import { Checkbox } from '@/components/ui/checkbox'
import { Dialog, DialogContent, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog'
import { Input } from '@/components/ui/input'
import type { TaskApiBridge } from '@/lib/sync-bootstrap'
import { useChatStore } from '../store/chat-store'

export function CreateChannelDialog({ api }: { readonly api: TaskApiBridge }) {
	const open = useChatStore((s) => s.createChannelOpen)
	const setOpen = useChatStore((s) => s.setCreateChannelOpen)
	const createChannel = useChatStore((s) => s.createChannel)

	const [name, setName] = useState('')
	const [topic, setTopic] = useState('')
	const [isPrivate, setIsPrivate] = useState(false)
	const [busy, setBusy] = useState(false)
	const [error, setError] = useState<string | null>(null)

	async function handleSubmit(ev: React.FormEvent) {
		ev.preventDefault()
		const slug = name
			.trim()
			.toLowerCase()
			.replace(/[^a-z0-9-_]+/g, '-')
			.replace(/^-+|-+$/g, '')
		if (!slug || busy) return
		setBusy(true)
		setError(null)
		try {
			await createChannel(api, {
				name: slug,
				topic: topic.trim(),
				kind: isPrivate ? 'private' : 'public'
			})
			setName('')
			setTopic('')
			setIsPrivate(false)
		} catch (err) {
			setError(err instanceof Error ? err.message : 'Failed to create channel')
		} finally {
			setBusy(false)
		}
	}

	return (
		<Dialog open={open} onOpenChange={setOpen}>
			<DialogContent>
				<DialogHeader>
					<DialogTitle>{t('chat.create-channel.title')}</DialogTitle>
				</DialogHeader>

				<form onSubmit={(ev) => void handleSubmit(ev)} className="space-y-3">
					<div className="space-y-1">
						<label htmlFor="chat-channel-name" className="text-xs font-medium">
							{t('chat.create-channel.name')}
						</label>
						<Input
							id="chat-channel-name"
							placeholder={t('chat.create-channel.name-placeholder')}
							value={name}
							onChange={(ev) => setName(ev.target.value)}
							required
						/>
					</div>

					<div className="space-y-1">
						<label htmlFor="chat-channel-topic" className="text-xs font-medium">
							{t('chat.create-channel.topic')}
						</label>
						<Input
							id="chat-channel-topic"
							placeholder={t('chat.create-channel.topic-placeholder')}
							value={topic}
							onChange={(ev) => setTopic(ev.target.value)}
						/>
					</div>

					<div className="flex items-center gap-2">
						<Checkbox
							id="chat-channel-private"
							checked={isPrivate}
							onCheckedChange={(checked) => setIsPrivate(checked === true)}
						/>
						<label htmlFor="chat-channel-private" className="text-xs font-medium">
							{t('chat.create-channel.private')}
						</label>
					</div>

					{error ? (
						<p role="alert" className="text-xs text-destructive">
							{error}
						</p>
					) : null}

					<DialogFooter>
						<Button size="sm" tone="outline" type="button" onClick={() => setOpen(false)}>
							{t('common.cancel')}
						</Button>
						<Button size="sm" type="submit" loading={busy}>
							{t('chat.create-channel.submit')}
						</Button>
					</DialogFooter>
				</form>
			</DialogContent>
		</Dialog>
	)
}
