import type {
	CreateIssueBody,
	CycleDto,
	IssueDto,
	LabelDto,
	ProjectDto,
	ProjectMilestoneDto,
	ProjectStatusDto
} from '@huriro/contracts'
import { t } from '@huriro/i18n'
import { useEffect, useState } from 'react'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Checkbox } from '@/components/ui/checkbox'
import { DatePicker } from '@/components/ui/date-picker'
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
import type { WorkspaceMemberSummary } from '@/lib/sync-bootstrap'
import { useUiStore } from '@/stores/ui-store'

export interface CreateTaskDialogProps {
	readonly projects: readonly ProjectDto[]
	readonly statuses: readonly ProjectStatusDto[]
	readonly members?: readonly WorkspaceMemberSummary[]
	readonly labels?: readonly LabelDto[]
	readonly cycles?: readonly CycleDto[]
	readonly milestones?: readonly ProjectMilestoneDto[]
	readonly issues?: readonly IssueDto[]
	readonly defaultTriage?: boolean
	readonly onSubmit: (input: Omit<CreateIssueBody, 'id' | 'position'>) => Promise<void>
}

export function CreateTaskDialog({
	projects,
	statuses,
	members = [],
	labels = [],
	cycles = [],
	milestones = [],
	issues = [],
	defaultTriage = false,
	onSubmit
}: CreateTaskDialogProps) {
	const open = useUiStore((s) => s.createIssueOpen)
	const setOpen = useUiStore((s) => s.setCreateIssueOpen)
	const activeProjectId = useUiStore((s) => s.activeProjectId)
	const pushToast = useUiStore((s) => s.pushToast)

	const defaultProjectId = activeProjectId ?? projects[0]?.id ?? ''
	const [projectId, setProjectId] = useState(defaultProjectId)
	const [title, setTitle] = useState('')
	const [descriptionText, setDescriptionText] = useState('')
	const [priority, setPriority] = useState('2')
	const [statusId, setStatusId] = useState('')
	const [assigneeId, setAssigneeId] = useState('unassigned')
	const [cycleId, setCycleId] = useState('none')
	const [milestoneId, setMilestoneId] = useState('none')
	const [parentId, setParentId] = useState('none')
	const [startDate, setStartDate] = useState('')
	const [dueDate, setDueDate] = useState('')
	const [estimate, setEstimate] = useState('')
	const [selectedLabelIds, setSelectedLabelIds] = useState<string[]>([])
	const [sendToTriage, setSendToTriage] = useState(false)
	const [submitting, setSubmitting] = useState(false)

	useEffect(() => {
		if (!open) return
		const pid = activeProjectId ?? projects[0]?.id ?? ''
		setProjectId(pid)
		const proj = projects.find((p) => p.id === pid)
		const projStatuses = statuses.filter((s) => s.projectId === pid)
		setStatusId(projStatuses.find((s) => s.isDefault)?.id ?? projStatuses[0]?.id ?? '')
		setAssigneeId('unassigned')
		setCycleId('none')
		setMilestoneId('none')
		setParentId('none')
		setStartDate('')
		setDueDate('')
		setEstimate('')
		setSelectedLabelIds([])
		setSendToTriage(Boolean(defaultTriage && proj?.triageEnabled))
	}, [open, activeProjectId, projects, statuses, defaultTriage])

	const selectedProject = projects.find((p) => p.id === projectId)
	const projectStatuses = statuses.filter((s) => s.projectId === projectId)
	const projectCycles = cycles.filter((c) => c.projectId === projectId)
	const projectMilestones = milestones.filter((m) => m.projectId === projectId)
	const parentCandidates = issues.filter((i) => i.projectId === projectId && i.deletedAt === null)

	async function handleSubmit(ev: React.FormEvent) {
		ev.preventDefault()
		if (!projectId || !title.trim() || submitting) return
		setSubmitting(true)
		try {
			const parsedEstimate = estimate.trim() === '' ? undefined : Number(estimate)
			await onSubmit({
				projectId,
				title: title.trim(),
				descriptionText: descriptionText.trim(),
				statusId: statusId || (projectStatuses[0]?.id ?? ''),
				priority: Number(priority),
				...(assigneeId !== 'unassigned' ? { assigneeId, assigneeType: 'user' as const } : {}),
				...(cycleId !== 'none' ? { cycleId } : {}),
				...(milestoneId !== 'none' ? { milestoneId } : {}),
				...(parentId !== 'none' ? { parentId } : {}),
				...(startDate ? { startDate } : {}),
				...(dueDate ? { dueDate } : {}),
				...(parsedEstimate !== undefined && Number.isFinite(parsedEstimate) && parsedEstimate >= 0
					? { estimate: parsedEstimate }
					: {}),
				...(selectedLabelIds.length > 0 ? { labelIds: selectedLabelIds } : {}),
				...(selectedProject?.triageEnabled && sendToTriage ? { triage: true } : {})
			})
			setTitle('')
			setDescriptionText('')
			setOpen(false)
		} catch (err) {
			pushToast({
				title: t('tasks.create.submit'),
				description: err instanceof Error ? err.message : undefined,
				tone: 'danger'
			})
		} finally {
			setSubmitting(false)
		}
	}

	return (
		<Dialog open={open} onOpenChange={setOpen}>
			<DialogContent className="max-h-[85vh] overflow-y-auto">
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
									const nextProj = projects.find((p) => p.id === nextPid)
									const nextStatuses = statuses.filter((s) => s.projectId === nextPid)
									setStatusId(nextStatuses.find((s) => s.isDefault)?.id ?? nextStatuses[0]?.id ?? '')
									setCycleId('none')
									setMilestoneId('none')
									setParentId('none')
									setSendToTriage(Boolean(defaultTriage && nextProj?.triageEnabled))
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

					<div className="grid grid-cols-2 gap-2">
						<div className="space-y-1">
							<span className="text-xs font-medium">{t('tasks.create.assignee-label')}</span>
							<Select value={assigneeId} onValueChange={setAssigneeId}>
								<SelectTrigger aria-label={t('tasks.create.assignee-label')} className="h-8 text-xs">
									<SelectValue />
								</SelectTrigger>
								<SelectContent>
									<SelectItem value="unassigned">{t('tasks.detail.unassigned')}</SelectItem>
									{members.map((m) => (
										<SelectItem key={m.userId} value={m.userId}>
											{m.displayName}
										</SelectItem>
									))}
								</SelectContent>
							</Select>
						</div>

						<div className="space-y-1">
							<label htmlFor="create-issue-estimate" className="text-xs font-medium">
								{t('tasks.create.estimate')}
							</label>
							<Input
								id="create-issue-estimate"
								type="number"
								min={0}
								step="any"
								value={estimate}
								onChange={(ev) => setEstimate(ev.target.value)}
								placeholder={t('tasks.create.estimate-placeholder')}
								className="h-8 text-xs"
							/>
						</div>

						<div className="space-y-1">
							<label htmlFor="create-issue-start-date" className="text-xs font-medium">
								{t('tasks.create.start-date')}
							</label>
							<DatePicker id="create-issue-start-date" value={startDate} clearable onChange={setStartDate} />
						</div>

						<div className="space-y-1">
							<label htmlFor="create-issue-due-date" className="text-xs font-medium">
								{t('tasks.create.due-date')}
							</label>
							<DatePicker id="create-issue-due-date" value={dueDate} clearable onChange={setDueDate} />
						</div>

						{projectCycles.length > 0 || selectedProject?.cycleEnabled ? (
							<div className="space-y-1">
								<span className="text-xs font-medium">{t('tasks.create.cycle-label')}</span>
								<Select value={cycleId} onValueChange={setCycleId}>
									<SelectTrigger aria-label={t('tasks.create.cycle-label')} className="h-8 text-xs">
										<SelectValue />
									</SelectTrigger>
									<SelectContent>
										<SelectItem value="none">{t('tasks.bulk.no-cycle')}</SelectItem>
										{projectCycles.map((c) => (
											<SelectItem key={c.id} value={c.id}>
												{c.name}
											</SelectItem>
										))}
									</SelectContent>
								</Select>
							</div>
						) : null}

						{projectMilestones.length > 0 ? (
							<div className="space-y-1">
								<span className="text-xs font-medium">{t('tasks.create.milestone-label')}</span>
								<Select value={milestoneId} onValueChange={setMilestoneId}>
									<SelectTrigger aria-label={t('tasks.create.milestone-label')} className="h-8 text-xs">
										<SelectValue />
									</SelectTrigger>
									<SelectContent>
										<SelectItem value="none">{t('tasks.create.no-milestone')}</SelectItem>
										{projectMilestones.map((m) => (
											<SelectItem key={m.id} value={m.id}>
												{m.name}
											</SelectItem>
										))}
									</SelectContent>
								</Select>
							</div>
						) : null}

						{parentCandidates.length > 0 ? (
							<div className="col-span-2 space-y-1">
								<span className="text-xs font-medium">{t('tasks.create.parent-label')}</span>
								<Select value={parentId} onValueChange={setParentId}>
									<SelectTrigger aria-label={t('tasks.create.parent-label')} className="h-8 text-xs">
										<SelectValue />
									</SelectTrigger>
									<SelectContent>
										<SelectItem value="none">{t('tasks.create.no-parent')}</SelectItem>
										{parentCandidates.map((candidate) => (
											<SelectItem key={candidate.id} value={candidate.id}>
												{candidate.identifier} · {candidate.title}
											</SelectItem>
										))}
									</SelectContent>
								</Select>
							</div>
						) : null}
					</div>

					{labels.length > 0 ? (
						<div className="space-y-1.5">
							<p className="text-xs font-medium">{t('tasks.detail.labels')}</p>
							<div className="flex flex-wrap gap-1.5">
								{labels.map((label) => {
									const selected = selectedLabelIds.includes(label.id)
									return (
										<button
											key={label.id}
											type="button"
											aria-pressed={selected}
											onClick={() =>
												setSelectedLabelIds((prev) =>
													selected ? prev.filter((id) => id !== label.id) : [...prev, label.id]
												)
											}
										>
											<Badge tone={selected ? 'info' : 'outline'}>{label.name}</Badge>
										</button>
									)
								})}
							</div>
						</div>
					) : null}

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

					{selectedProject?.triageEnabled ? (
						<div className="flex items-start gap-2 rounded-md border border-border px-3 py-2">
							<Checkbox
								id="create-issue-triage"
								checked={sendToTriage}
								onCheckedChange={(checked) => setSendToTriage(checked === true)}
							/>
							<div className="space-y-0.5 text-xs">
								<label htmlFor="create-issue-triage" className="cursor-pointer font-medium leading-none">
									{t('tasks.create.send-to-triage')}
								</label>
								<p className="text-muted-foreground">{t('tasks.create.send-to-triage-hint')}</p>
							</div>
						</div>
					) : null}

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
