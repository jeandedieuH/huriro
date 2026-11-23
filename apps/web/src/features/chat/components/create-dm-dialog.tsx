import { t } from '@huriro/i18n'
import { useEffect, useState } from 'react'
import { Button } from '@/components/ui/button'
import { Checkbox } from '@/components/ui/checkbox'
import {
	Dialog,
	DialogContent,
	DialogDescription,
	DialogFooter,
	DialogHeader,
	DialogTitle
} from '@/components/ui/dialog'
import type { TaskApiBridge, WorkspaceMemberSummary } from '@/lib/sync-bootstrap'
import { useChatStore } from '../store/chat-store'

export function CreateDmDialog({
	api,
	currentUserId
}: {
	readonly api: TaskApiBridge
	readonly currentUserId: string
}) {
	const open = useChatStore((s) => s.createDmOpen)
	const setOpen = useChatStore((s) => s.setCreateDmOpen)
	const createDm = useChatStore((s) => s.createDm)

	const [members, setMembers] = useState<WorkspaceMemberSummary[]>([])
	const [selectedIds, setSelectedIds] = useState<string[]>([])
	const [busy, setBusy] = useState(false)
	const [error, setError] = useState<string | null>(null)

	useEffect(() => {
		if (!open) return
		void api.listMembers().then((list) => {
			setMembers(list.filter((m) => m.userId !== currentUserId))
		})
	}, [api, currentUserId, open])

	function toggleMember(uid: string) {
		setSelectedIds((prev) =>
			prev.includes(uid) ? prev.filter((id) => id !== uid) : prev.length < 7 ? [...prev, uid] : prev
		)
	}

	async function handleSubmit(ev: React.FormEvent) {
		ev.preventDefault()
		if (selectedIds.length === 0 || busy) return
		setBusy(true)
		setError(null)
		try {
			await createDm(api, { memberIds: selectedIds })
			setSelectedIds([])
		} catch (err) {
			setError(err instanceof Error ? err.message : 'Failed to start direct message')
		} finally {
			setBusy(false)
		}
	}

	return (
		<Dialog open={open} onOpenChange={setOpen}>
			<DialogContent>
				<DialogHeader>
					<DialogTitle>{t('chat.create-dm.title')}</DialogTitle>
					<DialogDescription>{t('chat.create-dm.select-hint')}</DialogDescription>
				</DialogHeader>

				<form onSubmit={(ev) => void handleSubmit(ev)} className="space-y-3">
					<div className="max-h-56 space-y-1.5 overflow-y-auto">
						{members.map((m) => (
							<label
								key={m.userId}
								htmlFor={`dm-member-${m.userId}`}
								className="flex items-center justify-between rounded-md border border-border px-3 py-2 text-xs"
							>
								<span className="flex items-center gap-2">
									<Checkbox
										id={`dm-member-${m.userId}`}
										checked={selectedIds.includes(m.userId)}
										onCheckedChange={() => toggleMember(m.userId)}
									/>
									<span className="font-medium">{m.displayName}</span>
								</span>
								<span className="text-muted-foreground">{m.email}</span>
							</label>
						))}
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
						<Button size="sm" type="submit" loading={busy} disabled={selectedIds.length === 0}>
							{t('chat.create-dm.submit')}
						</Button>
					</DialogFooter>
				</form>
			</DialogContent>
		</Dialog>
	)
}
