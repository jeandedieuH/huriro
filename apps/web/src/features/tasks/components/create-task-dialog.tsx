import type { ProjectDto, ProjectStatusDto } from '@huriro/contracts'
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
import { Textarea } from '@/components/ui/textarea'
import { useUiStore } from '@/stores/ui-store'

export interface CreateTaskDialogProps {
	readonly projects: readonly ProjectDto[]
	readonly statuses: readonly ProjectStatusDto[]
	readonly onSubmit: (input: {
		projectId: string
		title: string
		descriptionText: string
		statusId: string
		priority: number
	}) => Promise<void>
}

export function CreateTaskDialog({ projects, statuses, onSubmit }: CreateTaskDialogProps) {
	const open = useUiStore((s) => s.createIssueOpen)
	const setOpen = useUiStore((s) => s.setCreateIssueOpen)
	const activeProjectId = useUiStore((s) => s.activeProjectId)

	const defaultProjectId = activeProjectId ?? projects[0]?.id ?? ''
	const [projectId, setProjectId] = useState(defaultProjectId)
	const [title, setTitle] = useState('')
	const [descriptionText, setDescriptionText] = useState('')
	const [priority, setPriority] = useState('2')
	const [statusId, setStatusId] = useState('')
	const [submitting, setSubmitting] = useState(false)

	useEffect(() => {
		if (!open) return
		const pid = activeProjectId ?? projects[0]?.id ?? ''
		setProjectId(pid)
		const projStatuses = statuses.filter((s) => s.projectId === pid)
		setStatusId(projStatuses.find((s) => s.isDefault)?.id ?? projStatuses[0]?.id ?? '')
	}, [open, activeProjectId, projects, statuses])

	const projectStatuses = statuses.filter((s) => s.projectId === projectId)

	async function handleSubmit(ev: React.FormEvent) {
		ev.preventDefault()
		if (!projectId || !title.trim() || submitting) return
		setSubmitting(true)
		try {
			await onSubmit({
				projectId,
				title: title.trim(),
				descriptionText: descriptionText.trim(),
				statusId: statusId || (projectStatuses[0]?.id ?? ''),
				priority: Number(priority)
			})
			setTitle('')
			setDescriptionText('')
			setOpen(false)
		} finally {
			setSubmitting(false)
		}
	}

	return (
		<Dialog open={open} onOpenChange={setOpen}>
			<DialogContent>
				<DialogHeader>
					<DialogTitle>{t('tasks.new-issue')}</DialogTitle>
					<DialogDescription>
						Offline writes save locally right away and sync when reconnected.
					</DialogDescription>
				</DialogHeader>

				<form onSubmit={(ev) => void handleSubmit(ev)} className="space-y-4">
					<div className="space-y-1.5">
						<label htmlFor="create-issue-title" className="text-xs font-medium">
							{t('tasks.create.title-label')}
						</label>
						<Input
							id="create-issue-title"
							value={title}
							onChange={(ev) => setTitle(ev.target.value)}
							placeholder={t('tasks.create.title-placeholder')}
							required
						/>
					</div>

					<div className="grid grid-cols-3 gap-2">
						<div className="space-y-1">
							<span className="text-xs font-medium">{t('tasks.create.project-label')}</span>
							<Select
								value={projectId}
								onValueChange={(nextPid) => {
									setProjectId(nextPid)
									const nextStatuses = statuses.filter((s) => s.projectId === nextPid)
									setStatusId(nextStatuses.find((s) => s.isDefault)?.id ?? nextStatuses[0]?.id ?? '')
								}}
							>
								<SelectTrigger aria-label={t('tasks.create.project-label')} className="h-8 text-xs">
									<SelectValue />
								</SelectTrigger>
								<SelectContent>
									{projects.map((p) => (
										<SelectItem key={p.id} value={p.id}>
											{p.key} · {p.name}
										</SelectItem>
									))}
								</SelectContent>
							</Select>
						</div>

						<div className="space-y-1">
							<span className="text-xs font-medium">{t('tasks.detail.status')}</span>
							<Select value={statusId} onValueChange={setStatusId}>
								<SelectTrigger aria-label={t('tasks.detail.status')} className="h-8 text-xs">
									<SelectValue />
								</SelectTrigger>
								<SelectContent>
									{projectStatuses.map((s) => (
										<SelectItem key={s.id} value={s.id}>
											{s.name}
										</SelectItem>
									))}
								</SelectContent>
							</Select>
						</div>

						<div className="space-y-1">
							<span className="text-xs font-medium">{t('tasks.detail.priority')}</span>
							<Select value={priority} onValueChange={setPriority}>
								<SelectTrigger aria-label={t('tasks.detail.priority')} className="h-8 text-xs">
									<SelectValue />
								</SelectTrigger>
								<SelectContent>
									<SelectItem value="0">{t('tasks.priority.0')}</SelectItem>
									<SelectItem value="1">{t('tasks.priority.1')}</SelectItem>
									<SelectItem value="2">{t('tasks.priority.2')}</SelectItem>
									<SelectItem value="3">{t('tasks.priority.3')}</SelectItem>
									<SelectItem value="4">{t('tasks.priority.4')}</SelectItem>
								</SelectContent>
							</Select>
						</div>
					</div>

					<div className="space-y-1.5">
						<label htmlFor="create-issue-desc" className="text-xs font-medium">
							{t('tasks.create.description-label')}
						</label>
						<Textarea
							id="create-issue-desc"
							value={descriptionText}
							onChange={(ev) => setDescriptionText(ev.target.value)}
							rows={3}
						/>
					</div>

					<DialogFooter>
						<Button type="button" tone="outline" onClick={() => setOpen(false)}>
							{t('common.cancel')}
						</Button>
						<Button type="submit" disabled={!title.trim() || !projectId} loading={submitting}>
							{t('tasks.create.submit')}
						</Button>
					</DialogFooter>
				</form>
			</DialogContent>
		</Dialog>
	)
}
