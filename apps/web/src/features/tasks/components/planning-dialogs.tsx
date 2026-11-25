import type {
	CreateInitiativeBody,
	CreateProjectMilestoneBody,
	CreateProjectUpdateBody,
	InitiativeDto,
	ProjectDto,
	ProjectMilestoneDto,
	ProjectUpdateDto
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

type InitiativeInput = Omit<CreateInitiativeBody, 'id'>
type MilestoneInput = Omit<CreateProjectMilestoneBody, 'id'>
type ProjectUpdateInput = Omit<CreateProjectUpdateBody, 'id'>

const HEALTHS: readonly InitiativeDto['health'][] = ['on_track', 'at_risk', 'off_track', 'completed']
const MILESTONE_STATUSES: readonly ProjectMilestoneDto['status'][] = ['planned', 'completed', 'missed']

/** Rich-text fields keep a minimal valid document while the planning UI is text-first. */
function plainTextDocument(text: string): Record<string, unknown> | null {
	const trimmed = text.trim()
	if (!trimmed) return null
	return {
		type: 'doc',
		content: [{ type: 'paragraph', content: [{ type: 'text', text: trimmed }] }]
	}
}

function useResetOnOpen(open: boolean, reset: () => void) {
	// biome-ignore lint/correctness/useExhaustiveDependencies: reset captures the record selected when the dialog opens; re-running while typing would erase input
	useEffect(() => {
		if (open) reset()
	}, [open])
}

export interface InitiativeDialogProps {
	readonly open: boolean
	readonly initiative: InitiativeDto | null
	readonly projects: readonly ProjectDto[]
	readonly onOpenChange: (open: boolean) => void
	readonly onSubmit: (input: InitiativeInput, initiativeId?: string) => Promise<void>
	readonly onDelete?: ((initiativeId: string) => Promise<void>) | undefined
}

export function InitiativeDialog({
	open,
	initiative,
	projects,
	onOpenChange,
	onSubmit,
	onDelete
}: InitiativeDialogProps) {
	const [name, setName] = useState('')
	const [description, setDescription] = useState('')
	const [health, setHealth] = useState<InitiativeDto['health']>('on_track')
	const [targetDate, setTargetDate] = useState('')
	const [projectIds, setProjectIds] = useState<readonly string[]>([])
	const [submitting, setSubmitting] = useState(false)
	const [confirmDelete, setConfirmDelete] = useState(false)

	useResetOnOpen(open, () => {
		setName(initiative?.name ?? '')
		setDescription(initiative?.descriptionText ?? '')
		setHealth(initiative?.health ?? 'on_track')
		setTargetDate(initiative?.targetDate ?? '')
		setProjectIds(initiative?.projectIds ?? [])
		setConfirmDelete(false)
	})

	async function handleSubmit(event: React.FormEvent) {
		event.preventDefault()
		if (!name.trim() || submitting) return
		setSubmitting(true)
		try {
			await onSubmit(
				{
					name: name.trim(),
					description: plainTextDocument(description),
					descriptionText: description.trim(),
					health,
					targetDate: targetDate || null,
					projectIds: [...projectIds]
				},
				initiative?.id
			)
			onOpenChange(false)
		} finally {
			setSubmitting(false)
		}
	}

	async function handleDelete() {
		if (!initiative || !onDelete) return
		if (!confirmDelete) {
			setConfirmDelete(true)
			return
		}
		setSubmitting(true)
		try {
			await onDelete(initiative.id)
			onOpenChange(false)
		} finally {
			setSubmitting(false)
		}
	}

	return (
		<Dialog open={open} onOpenChange={onOpenChange}>
			<DialogContent>
				<DialogHeader>
					<DialogTitle>
						{initiative ? t('tasks.planning.edit-initiative') : t('tasks.planning.new-initiative')}
					</DialogTitle>
					<DialogDescription>{t('tasks.timeline.initiatives')}</DialogDescription>
				</DialogHeader>
				<form className="space-y-4" onSubmit={(event) => void handleSubmit(event)}>
					<div className="space-y-1">
						<label htmlFor="initiative-name" className="text-xs font-medium">
							{t('tasks.planning.initiative-name')}
						</label>
						<Input
							id="initiative-name"
							value={name}
							onChange={(event) => setName(event.target.value)}
							required
						/>
					</div>
					<div className="grid grid-cols-2 gap-3">
						<div className="space-y-1">
							<span className="text-xs font-medium">{t('tasks.planning.health')}</span>
							<Select value={health} onValueChange={(value) => setHealth(value as InitiativeDto['health'])}>
								<SelectTrigger aria-label={t('tasks.planning.health')}>
									<SelectValue />
								</SelectTrigger>
								<SelectContent>
									{HEALTHS.map((option) => (
										<SelectItem key={option} value={option}>
											{t(`tasks.planning.health.${option}` as never)}
										</SelectItem>
									))}
								</SelectContent>
							</Select>
						</div>
						<div className="space-y-1">
							<label htmlFor="initiative-target-date" className="text-xs font-medium">
								{t('tasks.planning.target-date')}
							</label>
							<DatePicker id="initiative-target-date" value={targetDate} onChange={setTargetDate} />
						</div>
					</div>
					<div className="space-y-1">
						<label htmlFor="initiative-description" className="text-xs font-medium">
							{t('tasks.create.description-label')}
						</label>
						<Textarea
							id="initiative-description"
							value={description}
							onChange={(event) => setDescription(event.target.value)}
							rows={3}
						/>
					</div>
					<fieldset className="space-y-2">
						<legend className="text-xs font-medium">{t('tasks.planning.projects')}</legend>
						<div className="max-h-36 space-y-2 overflow-auto rounded-md border border-border p-2">
							{projects.map((project) => {
								const checked = projectIds.includes(project.id)
								return (
									<label
										htmlFor={`initiative-project-${project.id}`}
										key={project.id}
										className="flex items-center gap-2 text-sm"
									>
										<Checkbox
											id={`initiative-project-${project.id}`}
											checked={checked}
											onCheckedChange={(next) =>
												setProjectIds((current) =>
													next === true ? [...current, project.id] : current.filter((id) => id !== project.id)
												)
											}
										/>
										<span className="truncate">{project.name}</span>
									</label>
								)
							})}
						</div>
					</fieldset>
					<DialogFooter>
						{initiative && onDelete ? (
							<Button
								type="button"
								tone="destructive"
								onClick={() => void handleDelete()}
								disabled={submitting}
							>
								{confirmDelete ? t('tasks.planning.delete-confirm') : t('common.delete')}
							</Button>
						) : null}
						<Button type="button" tone="outline" onClick={() => onOpenChange(false)}>
							{t('common.cancel')}
						</Button>
						<Button type="submit" disabled={!name.trim()} loading={submitting}>
							{initiative ? t('common.save') : t('tasks.planning.create-initiative')}
						</Button>
					</DialogFooter>
				</form>
			</DialogContent>
		</Dialog>
	)
}

export interface MilestoneDialogProps {
	readonly open: boolean
	readonly milestone: ProjectMilestoneDto | null
	readonly projects: readonly ProjectDto[]
	readonly initialProjectId: string | null
	readonly onOpenChange: (open: boolean) => void
	readonly onSubmit: (projectId: string, input: MilestoneInput, milestoneId?: string) => Promise<void>
	readonly onDelete?: ((projectId: string, milestoneId: string) => Promise<void>) | undefined
}

export function MilestoneDialog({
	open,
	milestone,
	projects,
	initialProjectId,
	onOpenChange,
	onSubmit,
	onDelete
}: MilestoneDialogProps) {
	const [projectId, setProjectId] = useState('')
	const [name, setName] = useState('')
	const [description, setDescription] = useState('')
	const [targetDate, setTargetDate] = useState('')
	const [status, setStatus] = useState<ProjectMilestoneDto['status']>('planned')
	const [submitting, setSubmitting] = useState(false)
	const [confirmDelete, setConfirmDelete] = useState(false)

	useResetOnOpen(open, () => {
		setProjectId(milestone?.projectId ?? initialProjectId ?? projects[0]?.id ?? '')
		setName(milestone?.name ?? '')
		setDescription(milestone?.description ?? '')
		setTargetDate(milestone?.targetDate ?? '')
		setStatus(milestone?.status ?? 'planned')
		setConfirmDelete(false)
	})

	async function handleSubmit(event: React.FormEvent) {
		event.preventDefault()
		if (!projectId || !name.trim() || submitting) return
		setSubmitting(true)
		try {
			await onSubmit(
				projectId,
				{ name: name.trim(), description: description.trim(), targetDate: targetDate || null, status },
				milestone?.id
			)
			onOpenChange(false)
		} finally {
			setSubmitting(false)
		}
	}

	async function handleDelete() {
		if (!milestone || !onDelete) return
		if (!confirmDelete) {
			setConfirmDelete(true)
			return
		}
		setSubmitting(true)
		try {
			await onDelete(milestone.projectId, milestone.id)
			onOpenChange(false)
		} finally {
			setSubmitting(false)
		}
	}

	return (
		<Dialog open={open} onOpenChange={onOpenChange}>
			<DialogContent>
				<DialogHeader>
					<DialogTitle>
						{milestone ? t('tasks.planning.edit-milestone') : t('tasks.planning.new-milestone')}
					</DialogTitle>
					<DialogDescription>{t('tasks.planning.milestone-description')}</DialogDescription>
				</DialogHeader>
				<form className="space-y-4" onSubmit={(event) => void handleSubmit(event)}>
					<div className="space-y-1">
						<span className="text-xs font-medium">{t('tasks.create.project-label')}</span>
						<Select value={projectId} onValueChange={setProjectId} disabled={Boolean(milestone)}>
							<SelectTrigger aria-label={t('tasks.create.project-label')}>
								<SelectValue placeholder={t('tasks.planning.select-project')} />
							</SelectTrigger>
							<SelectContent>
								{projects.map((project) => (
									<SelectItem key={project.id} value={project.id}>
										{project.name}
									</SelectItem>
								))}
							</SelectContent>
						</Select>
					</div>
					<div className="space-y-1">
						<label htmlFor="milestone-name" className="text-xs font-medium">
							{t('tasks.planning.milestone-name')}
						</label>
						<Input
							id="milestone-name"
							value={name}
							onChange={(event) => setName(event.target.value)}
							required
						/>
					</div>
					<div className="grid grid-cols-2 gap-3">
						<div className="space-y-1">
							<label htmlFor="milestone-target-date" className="text-xs font-medium">
								{t('tasks.planning.target-date')}
							</label>
							<DatePicker id="milestone-target-date" value={targetDate} onChange={setTargetDate} />
						</div>
						<div className="space-y-1">
							<span className="text-xs font-medium">{t('tasks.planning.milestone-status')}</span>
							<Select
								value={status}
								onValueChange={(value) => setStatus(value as ProjectMilestoneDto['status'])}
							>
								<SelectTrigger aria-label={t('tasks.planning.milestone-status')}>
									<SelectValue />
								</SelectTrigger>
								<SelectContent>
									{MILESTONE_STATUSES.map((option) => (
										<SelectItem key={option} value={option}>
											{t(`tasks.planning.milestone-status.${option}` as never)}
										</SelectItem>
									))}
								</SelectContent>
							</Select>
						</div>
					</div>
					<div className="space-y-1">
						<label htmlFor="milestone-description" className="text-xs font-medium">
							{t('tasks.create.description-label')}
						</label>
						<Textarea
							id="milestone-description"
							value={description}
							onChange={(event) => setDescription(event.target.value)}
							rows={3}
						/>
					</div>
					<DialogFooter>
						{milestone && onDelete ? (
							<Button
								type="button"
								tone="destructive"
								onClick={() => void handleDelete()}
								disabled={submitting}
							>
								{confirmDelete ? t('tasks.planning.delete-confirm') : t('common.delete')}
							</Button>
						) : null}
						<Button type="button" tone="outline" onClick={() => onOpenChange(false)}>
							{t('common.cancel')}
						</Button>
						<Button type="submit" disabled={!projectId || !name.trim()} loading={submitting}>
							{milestone ? t('common.save') : t('tasks.planning.create-milestone')}
						</Button>
					</DialogFooter>
				</form>
			</DialogContent>
		</Dialog>
	)
}

export interface ProjectUpdateDialogProps {
	readonly open: boolean
	readonly projects: readonly ProjectDto[]
	readonly updates: readonly ProjectUpdateDto[]
	readonly initialProjectId: string | null
	readonly onOpenChange: (open: boolean) => void
	readonly onSubmit: (projectId: string, input: ProjectUpdateInput) => Promise<void>
}

export function ProjectUpdateDialog({
	open,
	projects,
	updates,
	initialProjectId,
	onOpenChange,
	onSubmit
}: ProjectUpdateDialogProps) {
	const [projectId, setProjectId] = useState('')
	const [health, setHealth] = useState<ProjectUpdateDto['health']>('on_track')
	const [bodyText, setBodyText] = useState('')
	const [scopeChange, setScopeChange] = useState('0')
	const [submitting, setSubmitting] = useState(false)

	useResetOnOpen(open, () => {
		setProjectId(initialProjectId ?? projects[0]?.id ?? '')
		setHealth('on_track')
		setBodyText('')
		setScopeChange('0')
	})

	const projectUpdates = updates
		.filter((update) => update.projectId === projectId)
		.sort((a, b) => b.createdAt.localeCompare(a.createdAt))
		.slice(0, 5)

	async function handleSubmit(event: React.FormEvent) {
		event.preventDefault()
		if (!projectId || !bodyText.trim() || submitting) return
		setSubmitting(true)
		try {
			await onSubmit(projectId, {
				health,
				body: plainTextDocument(bodyText),
				bodyText: bodyText.trim(),
				scopeChange: Number.parseInt(scopeChange, 10) || 0
			})
			onOpenChange(false)
		} finally {
			setSubmitting(false)
		}
	}

	return (
		<Dialog open={open} onOpenChange={onOpenChange}>
			<DialogContent>
				<DialogHeader>
					<DialogTitle>{t('tasks.planning.new-update')}</DialogTitle>
					<DialogDescription>{t('tasks.planning.update-description')}</DialogDescription>
				</DialogHeader>
				<form className="space-y-4" onSubmit={(event) => void handleSubmit(event)}>
					<div className="grid grid-cols-2 gap-3">
						<div className="space-y-1">
							<span className="text-xs font-medium">{t('tasks.create.project-label')}</span>
							<Select value={projectId} onValueChange={setProjectId}>
								<SelectTrigger aria-label={t('tasks.create.project-label')}>
									<SelectValue placeholder={t('tasks.planning.select-project')} />
								</SelectTrigger>
								<SelectContent>
									{projects.map((project) => (
										<SelectItem key={project.id} value={project.id}>
											{project.name}
										</SelectItem>
									))}
								</SelectContent>
							</Select>
						</div>
						<div className="space-y-1">
							<span className="text-xs font-medium">{t('tasks.planning.health')}</span>
							<Select
								value={health}
								onValueChange={(value) => setHealth(value as ProjectUpdateDto['health'])}
							>
								<SelectTrigger aria-label={t('tasks.planning.health')}>
									<SelectValue />
								</SelectTrigger>
								<SelectContent>
									{HEALTHS.map((option) => (
										<SelectItem key={option} value={option}>
											{t(`tasks.planning.health.${option}` as never)}
										</SelectItem>
									))}
								</SelectContent>
							</Select>
						</div>
					</div>
					<div className="space-y-1">
						<label htmlFor="project-update-body" className="text-xs font-medium">
							{t('tasks.planning.update-body')}
						</label>
						<Textarea
							id="project-update-body"
							value={bodyText}
							onChange={(event) => setBodyText(event.target.value)}
							placeholder={t('tasks.planning.update-placeholder')}
							rows={4}
							required
						/>
					</div>
					<div className="space-y-1">
						<label htmlFor="project-update-scope" className="text-xs font-medium">
							{t('tasks.planning.scope-change')}
						</label>
						<Input
							id="project-update-scope"
							type="number"
							value={scopeChange}
							onChange={(event) => setScopeChange(event.target.value)}
						/>
					</div>
					<section className="space-y-2" aria-label={t('tasks.planning.recent-updates')}>
						<h3 className="text-xs font-semibold text-muted-foreground uppercase">
							{t('tasks.planning.recent-updates')}
						</h3>
						{projectUpdates.length === 0 ? (
							<p className="text-sm text-muted-foreground">{t('tasks.planning.no-updates')}</p>
						) : (
							projectUpdates.map((update) => (
								<div key={update.id} className="space-y-1 rounded-md border border-border p-2 text-sm">
									<div className="flex items-center gap-2">
										<Badge
											tone={
												update.health === 'on_track'
													? 'success'
													: update.health === 'completed'
														? 'info'
														: 'warning'
											}
										>
											{t(`tasks.planning.health.${update.health}` as never)}
										</Badge>
										<span className="text-xs text-muted-foreground">
											{t('tasks.planning.update-counts', {
												completed: update.completedIssues,
												total: update.totalIssues
											})}
										</span>
									</div>
									<p className="line-clamp-2">{update.bodyText}</p>
								</div>
							))
						)}
					</section>
					<DialogFooter>
						<Button type="button" tone="outline" onClick={() => onOpenChange(false)}>
							{t('common.cancel')}
						</Button>
						<Button type="submit" disabled={!projectId || !bodyText.trim()} loading={submitting}>
							{t('tasks.planning.create-update')}
						</Button>
					</DialogFooter>
				</form>
			</DialogContent>
		</Dialog>
	)
}
