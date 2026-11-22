import type { DocPageDto, DocVisibility } from '@huriro/contracts'
import { t } from '@huriro/i18n'
import { useSyncEngine } from '@huriro/sync-client'
import { Trash2 } from 'lucide-react'
import { useEffect, useState } from 'react'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Dialog, DialogContent, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select'
import type { ResourceAclItemDto, TaskApiBridge, WorkspaceMemberSummary } from '@/lib/sync-bootstrap'
import { useUiStore } from '@/stores/ui-store'

export interface DocShareDialogProps {
	readonly api: TaskApiBridge
	readonly page: DocPageDto | null
	readonly members: readonly WorkspaceMemberSummary[]
}

export function DocShareDialog({ api, page, members }: DocShareDialogProps) {
	const engine = useSyncEngine()
	const open = useUiStore((s) => s.docShareOpen)
	const setOpen = useUiStore((s) => s.setDocShareOpen)
	const pushToast = useUiStore((s) => s.pushToast)

	const [acls, setAcls] = useState<ResourceAclItemDto[]>([])
	const [selectedUserId, setSelectedUserId] = useState<string>('')
	const [permission, setPermission] = useState<'read' | 'comment' | 'write' | 'manage'>('comment')
	const [busy, setBusy] = useState(false)

	useEffect(() => {
		if (!open || !page) return
		let cancelled = false
		void api
			.listResourceAcls('doc_page', page.id)
			.then((rows) => {
				if (!cancelled) setAcls(rows)
			})
			.catch(() => {
				if (!cancelled) setAcls([])
			})
		if (!selectedUserId && members[0]?.userId) {
			setSelectedUserId(members[0].userId)
		}
		return () => {
			cancelled = true
		}
	}, [api, members, open, page, selectedUserId])

	if (!page) return null
	const activePage = page
	const membersById = new Map(members.map((m) => [m.userId, m]))

	async function handleVisibilityChange(nextVis: DocVisibility) {
		setBusy(true)
		try {
			await engine.updateDocPage(activePage.id, { visibility: nextVis })
		} catch (err) {
			pushToast({ tone: 'danger', title: err instanceof Error ? err.message : 'Update failed' })
		} finally {
			setBusy(false)
		}
	}

	async function handleGrant() {
		if (!selectedUserId || busy) return
		setBusy(true)
		try {
			const granted = await api.grantResourceAcl({
				resourceType: 'doc_page',
				resourceId: activePage.id,
				principalType: 'user',
				principalId: selectedUserId,
				permission
			})
			setAcls((prev) => [...prev.filter((a) => a.id !== granted.id), granted])
		} catch (err) {
			pushToast({ tone: 'danger', title: err instanceof Error ? err.message : 'Grant failed' })
		} finally {
			setBusy(false)
		}
	}

	async function handleRevoke(aclId: string) {
		setBusy(true)
		try {
			await api.revokeResourceAcl(aclId)
			setAcls((prev) => prev.filter((a) => a.id !== aclId))
		} finally {
			setBusy(false)
		}
	}

	const permLabel = (p: ResourceAclItemDto['permission']) => {
		if (p === 'comment') return t('docs.share.perm.comment')
		if (p === 'write') return t('docs.share.perm.write')
		if (p === 'manage') return t('docs.share.perm.manage')
		return t('docs.share.perm.read')
	}

	return (
		<Dialog open={open} onOpenChange={setOpen}>
			<DialogContent className="max-w-md">
				<DialogHeader>
					<DialogTitle>{t('docs.share.title')}</DialogTitle>
				</DialogHeader>

				<div className="space-y-4">
					<div className="space-y-1.5">
						<span className="text-xs font-medium">{t('docs.share.visibility')}</span>
						<Select
							value={activePage.visibility}
							disabled={busy}
							onValueChange={(v) => void handleVisibilityChange(v as DocVisibility)}
						>
							<SelectTrigger aria-label={t('docs.share.visibility')}>
								<SelectValue />
							</SelectTrigger>
							<SelectContent>
								<SelectItem value="workspace">{t('tasks.project.visibility-workspace')}</SelectItem>
								<SelectItem value="private">{t('tasks.project.visibility-private')}</SelectItem>
							</SelectContent>
						</Select>
					</div>

					<div className="grid grid-cols-[1fr_auto_auto] items-end gap-2">
						<div className="space-y-1">
							<span className="text-xs font-medium">{t('docs.share.member')}</span>
							<Select value={selectedUserId} onValueChange={setSelectedUserId}>
								<SelectTrigger aria-label={t('docs.share.member')}>
									<SelectValue />
								</SelectTrigger>
								<SelectContent>
									{members.map((m) => (
										<SelectItem key={m.userId} value={m.userId}>
											{m.displayName}
										</SelectItem>
									))}
								</SelectContent>
							</Select>
						</div>

						<div className="space-y-1">
							<span className="text-xs font-medium">{t('docs.share.permission')}</span>
							<Select
								value={permission}
								onValueChange={(v) => setPermission(v as ResourceAclItemDto['permission'])}
							>
								<SelectTrigger aria-label={t('docs.share.permission')} className="w-32">
									<SelectValue />
								</SelectTrigger>
								<SelectContent>
									<SelectItem value="read">{t('docs.share.perm.read')}</SelectItem>
									<SelectItem value="comment">{t('docs.share.perm.comment')}</SelectItem>
									<SelectItem value="write">{t('docs.share.perm.write')}</SelectItem>
									<SelectItem value="manage">{t('docs.share.perm.manage')}</SelectItem>
								</SelectContent>
							</Select>
						</div>

						<Button
							type="button"
							size="sm"
							disabled={!selectedUserId || busy}
							onClick={() => void handleGrant()}
						>
							{t('docs.share.grant')}
						</Button>
					</div>

					<div className="space-y-1.5">
						{acls.length === 0 ? (
							<p className="text-xs text-muted-foreground">{t('docs.share.no-acls')}</p>
						) : (
							<ul className="space-y-1.5">
								{acls.map((acl) => {
									const member = acl.principalId ? membersById.get(acl.principalId) : null
									return (
										<li
											key={acl.id}
											className="flex items-center justify-between rounded-md border border-border px-2.5 py-1.5 text-xs"
										>
											<span>{member?.displayName ?? acl.principalId ?? acl.principalType}</span>
											<div className="flex items-center gap-2">
												<Badge tone="secondary">{permLabel(acl.permission)}</Badge>
												<Button
													type="button"
													size="icon"
													tone="ghost"
													aria-label={t('docs.share.revoke')}
													onClick={() => void handleRevoke(acl.id)}
													className="size-6 text-muted-foreground hover:text-destructive"
												>
													<Trash2 className="size-3.5" aria-hidden />
												</Button>
											</div>
										</li>
									)
								})}
							</ul>
						)}
					</div>
				</div>

				<DialogFooter>
					<Button type="button" tone="outline" onClick={() => setOpen(false)}>
						{t('common.close')}
					</Button>
				</DialogFooter>
			</DialogContent>
		</Dialog>
	)
}
