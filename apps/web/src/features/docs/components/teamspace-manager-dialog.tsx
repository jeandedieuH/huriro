import type { TeamspaceDto, TeamspaceMemberDto, TeamspaceRole, TeamspaceVisibility } from '@huriro/contracts'
import { t } from '@huriro/i18n'
import { useCollectionItems, useSyncEngine } from '@huriro/sync-client'
import { Plus, Trash2, Users } from 'lucide-react'
import { type FormEvent, useEffect, useState } from 'react'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Dialog, DialogContent, DialogHeader, DialogTitle } from '@/components/ui/dialog'
import { Input } from '@/components/ui/input'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select'
import type { TaskApiBridge, WorkspaceMemberSummary } from '@/lib/sync-bootstrap'
import { useUiStore } from '@/stores/ui-store'

export interface TeamspaceManagerDialogProps {
	readonly api: TaskApiBridge
	readonly members: readonly WorkspaceMemberSummary[]
}

export function TeamspaceManagerDialog({ api, members }: TeamspaceManagerDialogProps) {
	const engine = useSyncEngine()
	const teamspaces = useCollectionItems(engine.collections.teamspaces)
	const open = useUiStore((s) => s.teamspaceManagerOpen)
	const setOpen = useUiStore((s) => s.setTeamspaceManagerOpen)
	const pushToast = useUiStore((s) => s.pushToast)

	const activeTeamspaces = teamspaces.filter((ts) => ts.archivedAt === null)

	const [name, setName] = useState('')
	const [description, setDescription] = useState('')
	const [visibility, setVisibility] = useState<TeamspaceVisibility>('open')
	const [selectedId, setSelectedId] = useState<string>('')
	const [tsMembers, setTsMembers] = useState<TeamspaceMemberDto[]>([])
	const [addUserId, setAddUserId] = useState<string>('')
	const [addRole, setAddRole] = useState<TeamspaceRole>('member')
	const [busy, setBusy] = useState(false)

	useEffect(() => {
		if (!open) return
		if (!selectedId && activeTeamspaces[0]) {
			setSelectedId(activeTeamspaces[0].id)
		}
		if (!addUserId && members[0]) {
			setAddUserId(members[0].userId)
		}
	}, [activeTeamspaces, addUserId, members, open, selectedId])

	useEffect(() => {
		if (!open || !selectedId) return
		let cancelled = false
		void api
			.listTeamspaceMembers(selectedId)
			.then((rows) => {
				if (!cancelled) setTsMembers(rows)
			})
			.catch(() => {
				if (!cancelled) setTsMembers([])
			})
		return () => {
			cancelled = true
		}
	}, [api, open, selectedId])

	async function handleCreate(ev: FormEvent) {
		ev.preventDefault()
		const cleanName = name.trim()
		if (!cleanName || busy) return
		setBusy(true)
		try {
			const created = await api.createTeamspace({
				name: cleanName,
				description: description.trim(),
				visibility
			})
			engine.collections.teamspacesManaged.upsertMany([created])
			setSelectedId(created.id)
			setName('')
			setDescription('')
			pushToast({ tone: 'success', title: created.name })
		} catch (err) {
			pushToast({ tone: 'danger', title: err instanceof Error ? err.message : 'Failed to create teamspace' })
		} finally {
			setBusy(false)
		}
	}

	async function handleAddMember() {
		if (!selectedId || !addUserId || busy) return
		setBusy(true)
		try {
			const added = await api.addTeamspaceMember(selectedId, { userId: addUserId, role: addRole })
			setTsMembers((prev) => [...prev.filter((m) => m.userId !== added.userId), added])
		} catch (err) {
			pushToast({ tone: 'danger', title: err instanceof Error ? err.message : 'Failed to add member' })
		} finally {
			setBusy(false)
		}
	}

	async function handleRemoveMember(userId: string) {
		if (!selectedId || busy) return
		setBusy(true)
		try {
			await api.removeTeamspaceMember(selectedId, userId)
			setTsMembers((prev) => prev.filter((m) => m.userId !== userId))
		} finally {
			setBusy(false)
		}
	}

	async function handleArchive(ts: TeamspaceDto) {
		setBusy(true)
		try {
			await api.archiveTeamspace(ts.id, ts.version)
			engine.collections.teamspacesManaged.upsertMany([{ ...ts, archivedAt: new Date().toISOString() }])
			if (selectedId === ts.id) setSelectedId('')
		} catch (err) {
			pushToast({ tone: 'danger', title: err instanceof Error ? err.message : 'Archive failed' })
		} finally {
			setBusy(false)
		}
	}

	const membersById = new Map(members.map((m) => [m.userId, m]))
	const selectedTeamspace = activeTeamspaces.find((ts) => ts.id === selectedId) ?? null

	return (
		<Dialog open={open} onOpenChange={setOpen}>
			<DialogContent className="max-w-xl">
				<DialogHeader>
					<DialogTitle>{t('docs.teamspaces.manage')}</DialogTitle>
				</DialogHeader>

				<div className="space-y-4">
					<form
						onSubmit={(ev) => void handleCreate(ev)}
						className="space-y-2 rounded-lg border border-border p-3"
					>
						<p className="text-xs font-semibold">{t('docs.teamspaces.create')}</p>
						<div className="grid gap-2 sm:grid-cols-2">
							<Input
								aria-label={t('docs.teamspaces.name')}
								value={name}
								onChange={(ev) => setName(ev.target.value)}
								placeholder={t('docs.teamspaces.name')}
								className="h-8 text-xs"
							/>
							<Select value={visibility} onValueChange={(v) => setVisibility(v as TeamspaceVisibility)}>
								<SelectTrigger aria-label={t('docs.teamspaces.visibility')} className="h-8 text-xs">
									<SelectValue />
								</SelectTrigger>
								<SelectContent>
									<SelectItem value="open">{t('docs.teamspaces.vis.open')}</SelectItem>
									<SelectItem value="closed">{t('docs.teamspaces.vis.closed')}</SelectItem>
									<SelectItem value="private">{t('docs.teamspaces.vis.private')}</SelectItem>
								</SelectContent>
							</Select>
						</div>
						<div className="flex items-center gap-2">
							<Input
								aria-label={t('docs.teamspaces.description')}
								value={description}
								onChange={(ev) => setDescription(ev.target.value)}
								placeholder={t('docs.teamspaces.description')}
								className="h-8 flex-1 text-xs"
							/>
							<Button type="submit" size="sm" disabled={busy || !name.trim()} className="h-8 gap-1 text-xs">
								<Plus className="size-3.5" aria-hidden />
								<span>{t('docs.teamspaces.create')}</span>
							</Button>
						</div>
					</form>

					<div className="grid gap-3 sm:grid-cols-2">
						<div className="space-y-1.5">
							<p className="text-xs font-semibold">{t('docs.teamspaces.title')}</p>
							<ul className="max-h-56 space-y-1 overflow-y-auto">
								{activeTeamspaces.map((ts) => (
									<li
										key={ts.id}
										className="flex items-center justify-between gap-2 rounded-md border border-border px-2 py-1.5"
									>
										<button
											type="button"
											onClick={() => setSelectedId(ts.id)}
											className="flex min-w-0 flex-1 items-center gap-1.5 text-left text-xs font-medium"
										>
											<span>{ts.icon ?? '📁'}</span>
											<span className="truncate">{ts.name}</span>
										</button>
										<Badge tone="outline">{ts.visibility}</Badge>
										<Button
											type="button"
											size="icon"
											tone="ghost"
											className="size-6 text-destructive"
											aria-label={t('docs.teamspaces.archive')}
											onClick={() => void handleArchive(ts)}
										>
											<Trash2 className="size-3" aria-hidden />
										</Button>
									</li>
								))}
							</ul>
						</div>

						{selectedTeamspace ? (
							<div className="space-y-2 rounded-md border border-border p-2.5">
								<div className="flex items-center gap-1.5 text-xs font-semibold">
									<Users className="size-3.5" aria-hidden />
									<span>
										{selectedTeamspace.name} — {t('docs.teamspaces.members')}
									</span>
								</div>
								<div className="flex items-center gap-1.5">
									<Select value={addUserId} onValueChange={setAddUserId}>
										<SelectTrigger
											aria-label={t('docs.teamspaces.add-member')}
											className="h-7 flex-1 text-xs"
										>
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
									<Select value={addRole} onValueChange={(v) => setAddRole(v as TeamspaceRole)}>
										<SelectTrigger className="h-7 w-24 text-xs">
											<SelectValue />
										</SelectTrigger>
										<SelectContent>
											<SelectItem value="owner">owner</SelectItem>
											<SelectItem value="member">member</SelectItem>
											<SelectItem value="viewer">viewer</SelectItem>
										</SelectContent>
									</Select>
									<Button
										type="button"
										size="sm"
										className="h-7 px-2 text-xs"
										disabled={busy || !addUserId}
										onClick={() => void handleAddMember()}
									>
										{t('docs.teamspaces.add-member')}
									</Button>
								</div>
								<ul className="max-h-40 space-y-1 overflow-y-auto text-xs">
									{tsMembers.map((m) => (
										<li
											key={m.userId}
											className="flex items-center justify-between rounded border border-border/60 px-2 py-1"
										>
											<span className="truncate">
												{membersById.get(m.userId)?.displayName ?? m.userId.slice(0, 8)}
											</span>
											<div className="flex items-center gap-1">
												<Badge tone="secondary">{m.role}</Badge>
												<Button
													type="button"
													size="icon"
													tone="ghost"
													className="size-5"
													aria-label={t('common.delete')}
													onClick={() => void handleRemoveMember(m.userId)}
												>
													<Trash2 className="size-3" aria-hidden />
												</Button>
											</div>
										</li>
									))}
								</ul>
							</div>
						) : null}
					</div>
				</div>
			</DialogContent>
		</Dialog>
	)
}
