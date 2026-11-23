import type { ChatChannelDto } from '@huriro/contracts'
import { t } from '@huriro/i18n'
import { Trash2 } from 'lucide-react'
import { useEffect, useState } from 'react'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Dialog, DialogContent, DialogHeader, DialogTitle } from '@/components/ui/dialog'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select'
import type { TaskApiBridge, WorkspaceMemberSummary } from '@/lib/sync-bootstrap'
import { useChatStore } from '../store/chat-store'

export function ChannelMembersDialog({
	api,
	channel
}: {
	readonly api: TaskApiBridge
	readonly channel: ChatChannelDto | null
}) {
	const open = useChatStore((s) => s.membersDialogOpen)
	const setOpen = useChatStore((s) => s.setMembersDialogOpen)
	const refreshChannelDetail = useChatStore((s) => s.refreshChannelDetail)

	const [workspaceMembers, setWorkspaceMembers] = useState<WorkspaceMemberSummary[]>([])
	const [selectedUserId, setSelectedUserId] = useState('')
	const [busy, setBusy] = useState(false)
	const [error, setError] = useState<string | null>(null)

	useEffect(() => {
		if (!open) return
		void api.listMembers().then((list) => setWorkspaceMembers(list))
	}, [api, open])

	if (!channel) return null

	const currentMembers = channel.members ?? []
	const candidates = workspaceMembers.filter((m) => !currentMembers.some((cm) => cm.principalId === m.userId))

	async function handleAdd() {
		if (!channel || !selectedUserId || busy) return
		setBusy(true)
		setError(null)
		try {
			await api.addChannelMember(channel.id, { principalId: selectedUserId })
			setSelectedUserId('')
			await refreshChannelDetail(api, channel.id)
		} catch (err) {
			setError(err instanceof Error ? err.message : 'Failed to add member')
		} finally {
			setBusy(false)
		}
	}

	async function handleRemove(principalId: string) {
		if (!channel || busy) return
		setBusy(true)
		setError(null)
		try {
			await api.removeChannelMember(channel.id, principalId)
			await refreshChannelDetail(api, channel.id)
		} catch (err) {
			setError(err instanceof Error ? err.message : 'Failed to remove member')
		} finally {
			setBusy(false)
		}
	}

	return (
		<Dialog open={open} onOpenChange={setOpen}>
			<DialogContent>
				<DialogHeader>
					<DialogTitle>{t('chat.members.title')}</DialogTitle>
				</DialogHeader>

				<div className="space-y-3">
					{channel.kind !== 'dm' && candidates.length > 0 ? (
						<div className="flex gap-2">
							<Select value={selectedUserId} onValueChange={setSelectedUserId}>
								<SelectTrigger aria-label={t('chat.members.add-label')} className="flex-1">
									<SelectValue placeholder={t('chat.members.add-label')} />
								</SelectTrigger>
								<SelectContent>
									{candidates.map((m) => (
										<SelectItem key={m.userId} value={m.userId}>
											{m.displayName} ({m.email})
										</SelectItem>
									))}
								</SelectContent>
							</Select>
							<Button
								size="sm"
								type="button"
								disabled={!selectedUserId}
								loading={busy}
								onClick={() => void handleAdd()}
							>
								{t('chat.members.add-submit')}
							</Button>
						</div>
					) : null}

					{error ? (
						<p role="alert" className="text-xs text-destructive">
							{error}
						</p>
					) : null}

					<div className="max-h-60 space-y-1.5 overflow-y-auto">
						{currentMembers.map((m) => (
							<div
								key={m.principalId}
								className="flex items-center justify-between rounded-md border border-border px-3 py-2 text-xs"
							>
								<div className="flex items-center gap-2">
									<span className="font-medium">{m.displayName ?? m.principalId.slice(0, 8)}</span>
									<Badge tone="secondary">{m.role}</Badge>
								</div>
								{channel.kind !== 'dm' ? (
									<Button
										size="icon"
										tone="ghost"
										type="button"
										aria-label={t('chat.members.remove')}
										onClick={() => void handleRemove(m.principalId)}
									>
										<Trash2 className="size-3.5 text-destructive" aria-hidden />
									</Button>
								) : null}
							</div>
						))}
					</div>
				</div>
			</DialogContent>
		</Dialog>
	)
}
