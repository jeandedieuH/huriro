import type { CreateCycleBody, CycleDto, ProjectDto, UpdateProjectBody } from '@huriro/contracts'
import { nextCycleWindow, todayIsoFromDate } from '@huriro/domain'
import { t } from '@huriro/i18n'
import { useEffect, useMemo, useState } from 'react'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
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
import { Separator } from '@/components/ui/separator'
import { Textarea } from '@/components/ui/textarea'
import { useUiStore } from '@/stores/ui-store'
import {
	DEFAULT_PROJECT_WORKFLOW_POLICY,
	ProjectWorkflowFields,
	type ProjectWorkflowPolicy
} from './project-workflow-fields'

export interface ProjectSettingsDialogProps {
	readonly open: boolean
	readonly project: ProjectDto | null
	readonly cycles: readonly CycleDto[]
	readonly canManage: boolean
	readonly onOpenChange: (open: boolean) => void
	readonly onSave: (projectId: string, patch: Omit<UpdateProjectBody, 'version'>) => Promise<void>
	readonly onCreateCycle: (input: CreateCycleBody) => Promise<CycleDto>
}

export function ProjectSettingsDialog({
	open,
	project,
	cycles,
	canManage,
	onOpenChange,
	onSave,
	onCreateCycle
}: ProjectSettingsDialogProps) {
	const pushToast = useUiStore((s) => s.pushToast)

	const [name, setName] = useState('')
	const [description, setDescription] = useState('')
	const [visibility, setVisibility] = useState<'workspace' | 'private'>('workspace')
	const [workflow, setWorkflow] = useState<ProjectWorkflowPolicy>(DEFAULT_PROJECT_WORKFLOW_POLICY)
	const [saving, setSaving] = useState(false)

	const [cycleName, setCycleName] = useState('')
	const [startsAt, setStartsAt] = useState('')
	const [endsAt, setEndsAt] = useState('')
	const [creatingCycle, setCreatingCycle] = useState(false)

	const projectCycles = useMemo(
		() =>
			project
				? cycles
						.filter((c) => c.projectId === project.id)
						.sort((a, b) => b.startsAt.localeCompare(a.startsAt))
				: [],
		[cycles, project]
	)
	const hasActiveCycle = projectCycles.some((c) => c.status === 'active')

	useEffect(() => {
		if (!open || !project) return
		setName(project.name)
		setDescription(project.description)
		setVisibility(project.visibility)
		const nextWorkflow: ProjectWorkflowPolicy = {
			triageEnabled: project.triageEnabled,
			cycleEnabled: project.cycleEnabled,
			cycleDurationDays: project.cycleDurationDays,
			cycleCooldownDays: project.cycleCooldownDays,
			cycleAutoRolloverMode: project.cycleAutoRolloverMode,
			cycleStartWeekday: project.cycleStartWeekday
		}
		setWorkflow(nextWorkflow)

		const projCycles = cycles.filter((c) => c.projectId === project.id)
		const latestEnd = projCycles.reduce<string | null>(
			(acc, c) => (acc === null || c.endsAt > acc ? c.endsAt : acc),
			null
		)
		const today = todayIsoFromDate(new Date())
		const win = nextCycleWindow(
			latestEnd,
			{
				durationDays: nextWorkflow.cycleDurationDays,
				cooldownDays: nextWorkflow.cycleCooldownDays,
				startWeekday: nextWorkflow.cycleStartWeekday,
				rolloverMode: nextWorkflow.cycleAutoRolloverMode
			},
			today
		)
		setCycleName(`Cycle ${projCycles.length + 1}`)
		setStartsAt(win.startsAt)
		setEndsAt(win.endsAt)
	}, [open, project, cycles])

	if (!project) return null

	async function handleSaveProject(ev: React.FormEvent) {
		ev.preventDefault()
		if (!project || !name.trim() || saving) return
		setSaving(true)
		try {
			const patch: Omit<UpdateProjectBody, 'version'> = {
				name: name.trim(),
				description: description.trim(),
				...(canManage
					? {
							visibility,
							triageEnabled: workflow.triageEnabled,
							cycleEnabled: workflow.cycleEnabled,
							cycleDurationDays: workflow.cycleDurationDays,
							cycleCooldownDays: workflow.cycleCooldownDays,
							cycleAutoRolloverMode: workflow.cycleAutoRolloverMode,
							cycleStartWeekday: workflow.cycleStartWeekday
						}
					: {})
			}
			await onSave(project.id, patch)
			pushToast({ title: t('tasks.project.saved') })
			onOpenChange(false)
		} catch (err) {
			pushToast({
				tone: 'danger',
				title: err instanceof Error ? err.message : t('error.title')
			})
		} finally {
			setSaving(false)
		}
	}

	async function handleCreateCycle(ev: React.FormEvent) {
		ev.preventDefault()
		if (!project || !cycleName.trim() || !startsAt || !endsAt || creatingCycle) return
		setCreatingCycle(true)
		try {
			const created = await onCreateCycle({
				projectId: project.id,
				name: cycleName.trim(),
				status: hasActiveCycle ? 'planned' : 'active',
				startsAt,
				endsAt
			})
			pushToast({ title: t('tasks.cycle.created', { name: created.name }) })
		} catch (err) {
			pushToast({
				tone: 'danger',
				title: err instanceof Error ? err.message : t('error.title')
			})
		} finally {
			setCreatingCycle(false)
		}
	}

	return (
		<Dialog open={open} onOpenChange={onOpenChange}>
			<DialogContent className="max-h-[85vh] overflow-y-auto">
				<DialogHeader>
					<DialogTitle>
						{project.key} · {t('tasks.project.settings')}
					</DialogTitle>
					<DialogDescription>{t('tasks.project.settings-description')}</DialogDescription>
				</DialogHeader>

				<form onSubmit={(ev) => void handleSaveProject(ev)} className="space-y-4">
					<div className="grid grid-cols-3 gap-3">
						<div className="col-span-2 space-y-1">
							<label htmlFor="edit-proj-name" className="text-xs font-medium">
								{t('tasks.project.name')}
							</label>
							<Input id="edit-proj-name" value={name} onChange={(ev) => setName(ev.target.value)} required />
						</div>
						<div className="space-y-1">
							<span className="text-xs font-medium">{t('tasks.project.visibility')}</span>
							<Select
								value={visibility}
								disabled={!canManage}
								onValueChange={(v) => setVisibility(v as 'workspace' | 'private')}
							>
								<SelectTrigger aria-label={t('tasks.project.visibility')}>
									<SelectValue />
								</SelectTrigger>
								<SelectContent>
									<SelectItem value="workspace">{t('tasks.project.visibility-workspace')}</SelectItem>
									<SelectItem value="private">{t('tasks.project.visibility-private')}</SelectItem>
								</SelectContent>
							</Select>
						</div>
					</div>

					<div className="space-y-1">
						<label htmlFor="edit-proj-desc" className="text-xs font-medium">
							{t('tasks.create.description-label')}
						</label>
						<Textarea
							id="edit-proj-desc"
							value={description}
							onChange={(ev) => setDescription(ev.target.value)}
							rows={2}
						/>
					</div>

					<ProjectWorkflowFields
						idPrefix="edit-proj"
						value={workflow}
						disabled={!canManage}
						onChange={(patch) => setWorkflow((prev) => ({ ...prev, ...patch }))}
					/>

					{!canManage ? (
						<p className="text-xs text-muted-foreground">{t('tasks.project.manage-required')}</p>
					) : null}

					<DialogFooter>
						<Button type="button" tone="outline" onClick={() => onOpenChange(false)}>
							{t('common.cancel')}
						</Button>
						<Button type="submit" disabled={!name.trim()} loading={saving}>
							{t('tasks.project.save')}
						</Button>
					</DialogFooter>
				</form>

				{project.cycleEnabled || workflow.cycleEnabled ? (
					<>
						<Separator />
						<section className="space-y-3" aria-label={t('tasks.project.cycle-enabled')}>
							{projectCycles.length > 0 ? (
								<ul className="max-h-32 space-y-1.5 overflow-y-auto">
									{projectCycles.map((cycle) => (
										<li
											key={cycle.id}
											className="flex items-center justify-between rounded-md border border-border px-2.5 py-1.5 text-xs"
										>
											<span className="font-medium text-foreground">{cycle.name}</span>
											<span className="flex items-center gap-2 text-muted-foreground tnum">
												<span>
													{cycle.startsAt} → {cycle.endsAt}
												</span>
												<Badge tone={cycle.status === 'active' ? 'info' : 'outline'}>{cycle.status}</Badge>
											</span>
										</li>
									))}
								</ul>
							) : null}

							<form onSubmit={(ev) => void handleCreateCycle(ev)} className="space-y-2.5">
								<div className="space-y-1">
									<label htmlFor="cycle-name" className="text-xs font-medium">
										{t('tasks.cycle.name')}
									</label>
									<Input
										id="cycle-name"
										value={cycleName}
										onChange={(ev) => setCycleName(ev.target.value)}
										className="h-8 text-xs"
										required
									/>
								</div>

								<div className="grid grid-cols-2 gap-2">
									<div className="space-y-1">
										<label htmlFor="cycle-starts-at" className="text-xs font-medium">
											{t('tasks.cycle.starts-at')}
										</label>
										<DatePicker
											id="cycle-starts-at"
											value={startsAt}
											onChange={setStartsAt}
											clearable={false}
										/>
									</div>
									<div className="space-y-1">
										<label htmlFor="cycle-ends-at" className="text-xs font-medium">
											{t('tasks.cycle.ends-at')}
										</label>
										<DatePicker id="cycle-ends-at" value={endsAt} onChange={setEndsAt} clearable={false} />
									</div>
								</div>

								<div className="flex justify-end">
									<Button
										type="submit"
										size="sm"
										tone="outline"
										disabled={!cycleName.trim() || !startsAt || !endsAt || endsAt < startsAt}
										loading={creatingCycle}
									>
										{hasActiveCycle ? t('tasks.cycle.create') : t('tasks.cycle.start-cycle')}
									</Button>
								</div>
							</form>
						</section>
					</>
				) : null}
			</DialogContent>
		</Dialog>
	)
}
