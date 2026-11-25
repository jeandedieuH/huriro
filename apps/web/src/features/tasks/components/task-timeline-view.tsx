import type {
	InitiativeDto,
	IssueDto,
	IssueRelationDto,
	ProjectDto,
	ProjectMilestoneDto,
	ProjectStatusDto,
	UpdateIssueBody
} from '@huriro/contracts'
import {
	resizeDateSpan,
	shiftDateSpan,
	type TimelineZoom,
	timelineBarGeometry,
	timelineRangeForZoom,
	todayIsoFromDate
} from '@huriro/domain'
import { t } from '@huriro/i18n'
import { useCollectionItems, useSyncEngine } from '@huriro/sync-client'
import { type KeyboardEvent, useMemo, useState } from 'react'
import { cn } from '@/lib/utils'
import { InitiativeDialog, MilestoneDialog, ProjectUpdateDialog } from './planning-dialogs'

export interface TaskTimelineViewProps {
	readonly issues: readonly IssueDto[]
	readonly projects: readonly ProjectDto[]
	readonly initiatives: readonly InitiativeDto[]
	readonly milestones: readonly ProjectMilestoneDto[]
	readonly relations: readonly IssueRelationDto[]
	readonly statusesById: ReadonlyMap<string, ProjectStatusDto>
	readonly canManageInitiatives: boolean
	readonly canWriteProjects: boolean
	readonly initialAnchorDate?: string | undefined
	readonly onPatchIssue: (id: string, patch: UpdateIssueBody) => Promise<unknown>
}

function comparePos(a: string, b: string): number {
	return a < b ? -1 : a > b ? 1 : 0
}

function issueSpan(issue: IssueDto): { startDate: string; dueDate: string } | null {
	if (!issue.startDate && !issue.dueDate) return null
	const startDate = issue.startDate ?? issue.dueDate
	const dueDate = issue.dueDate ?? issue.startDate
	if (!startDate || !dueDate) return null
	return { startDate, dueDate }
}

/** Zoomable roadmap/timeline canvas. Bars expose keyboard date controls (§3.2). */
export function TaskTimelineView({
	issues,
	projects,
	initiatives,
	milestones,
	relations,
	statusesById,
	canManageInitiatives,
	canWriteProjects,
	initialAnchorDate,
	onPatchIssue
}: TaskTimelineViewProps) {
	const engine = useSyncEngine()
	const projectUpdates = useCollectionItems(engine.collections.projectUpdates)
	const [zoom, setZoom] = useState<TimelineZoom>('month')
	const [anchorDate, setAnchorDate] = useState(() => initialAnchorDate ?? todayIsoFromDate(new Date()))
	const [initiativeEditor, setInitiativeEditor] = useState<{
		open: boolean
		initiative: InitiativeDto | null
	}>({
		open: false,
		initiative: null
	})
	const [milestoneEditor, setMilestoneEditor] = useState<{
		open: boolean
		milestone: ProjectMilestoneDto | null
	}>({
		open: false,
		milestone: null
	})
	const [updateEditorOpen, setUpdateEditorOpen] = useState(false)
	const range = useMemo(() => timelineRangeForZoom(zoom, anchorDate), [zoom, anchorDate])
	const projectsById = useMemo(() => new Map(projects.map((project) => [project.id, project])), [projects])
	const relationCountByIssue = useMemo(() => {
		const counts = new Map<string, number>()
		for (const relation of relations) {
			if (relation.kind !== 'blocks') continue
			counts.set(relation.sourceIssueId, (counts.get(relation.sourceIssueId) ?? 0) + 1)
			counts.set(relation.targetIssueId, (counts.get(relation.targetIssueId) ?? 0) + 1)
		}
		return counts
	}, [relations])
	const rows = useMemo(() => {
		return issues
			.map((issue) => ({ issue, span: issueSpan(issue) }))
			.filter(
				(row): row is { issue: IssueDto; span: { startDate: string; dueDate: string } } => row.span !== null
			)
			.sort(
				(a, b) =>
					comparePos(
						projectsById.get(a.issue.projectId)?.position ?? '',
						projectsById.get(b.issue.projectId)?.position ?? ''
					) || comparePos(a.issue.position, b.issue.position)
			)
	}, [issues, projectsById])
	const renderRows = useMemo(
		() =>
			rows
				.map((row) => ({
					...row,
					geometry: timelineBarGeometry(row.span.startDate, row.span.dueDate, range)
				}))
				.filter(
					(row): row is typeof row & { geometry: NonNullable<ReturnType<typeof timelineBarGeometry>> } =>
						row.geometry !== null
				),
		[rows, range]
	)
	const rowIndexByIssueId = useMemo(
		() => new Map(renderRows.map((row, index) => [row.issue.id, index] as const)),
		[renderRows]
	)
	// Dependency connectors are meaningful only when both endpoints are visible in
	// the current zoom window; clipped bars still expose their visible edge.
	const connectors = useMemo(() => {
		return relations.flatMap((relation) => {
			if (relation.kind !== 'blocks') return []
			const sourceIndex = rowIndexByIssueId.get(relation.sourceIssueId)
			const targetIndex = rowIndexByIssueId.get(relation.targetIssueId)
			if (sourceIndex === undefined || targetIndex === undefined) return []
			const source = renderRows[sourceIndex]
			const target = renderRows[targetIndex]
			if (!source || !target) return []
			return [
				{
					id: relation.id,
					x1: (source.geometry.leftPercent + source.geometry.widthPercent) * 10,
					y1: sourceIndex * 40 + 18,
					x2: target.geometry.leftPercent * 10,
					y2: targetIndex * 40 + 18
				}
			]
		})
	}, [relations, renderRows, rowIndexByIssueId])

	function shiftRange(days: number) {
		setAnchorDate((current) => {
			const [year, month, day] = current.split('-').map(Number)
			return todayIsoFromDate(new Date(Date.UTC(year ?? 0, (month ?? 1) - 1, (day ?? 1) + days)))
		})
	}

	async function handleDateKey(issue: IssueDto, event: KeyboardEvent<HTMLButtonElement>) {
		const current = { startDate: issue.startDate ?? null, dueDate: issue.dueDate ?? null }
		if (!current.startDate && !current.dueDate) return
		// Linear-style resize shortcuts: [ extends/moves the start edge, ] the end
		// edge. Shift reverses the direction so both extension and contraction are
		// possible without leaving the keyboard.
		let bracketEdge: 'start' | 'end' | null = null
		if (event.code === 'BracketLeft' || event.key === '[' || event.key === '{') bracketEdge = 'start'
		else if (event.code === 'BracketRight' || event.key === ']' || event.key === '}') bracketEdge = 'end'
		if (bracketEdge && current.startDate && current.dueDate) {
			event.preventDefault()
			const edge = bracketEdge
			const days = event.shiftKey ? 1 : -1
			const resizeDays = edge === 'end' ? -days : days
			await onPatchIssue(issue.id, {
				...resizeDateSpan({ startDate: current.startDate, dueDate: current.dueDate }, edge, resizeDays),
				version: issue.version
			})
			return
		}
		if (event.key !== 'ArrowLeft' && event.key !== 'ArrowRight') return
		event.preventDefault()
		const days = event.key === 'ArrowLeft' ? -1 : 1
		if (event.shiftKey && current.startDate && current.dueDate) {
			await onPatchIssue(issue.id, {
				...resizeDateSpan({ startDate: current.startDate, dueDate: current.dueDate }, 'end', days),
				version: issue.version
			})
			return
		}
		if (event.altKey && current.startDate && current.dueDate) {
			await onPatchIssue(issue.id, {
				...resizeDateSpan({ startDate: current.startDate, dueDate: current.dueDate }, 'start', days),
				version: issue.version
			})
			return
		}
		await onPatchIssue(issue.id, { ...shiftDateSpan(current, days), version: issue.version })
	}

	return (
		<section aria-label={t('tasks.timeline.title')} className="flex h-full min-h-0 flex-col">
			<div className="flex flex-wrap items-center gap-2 border-b border-border px-4 py-2">
				<div className="inline-flex rounded-md bg-muted p-0.5">
					{(['week', 'month', 'quarter', 'year'] as const).map((option) => (
						<button
							key={option}
							type="button"
							onClick={() => setZoom(option)}
							className={cn(
								'rounded-sm px-2 py-1 text-xs',
								zoom === option
									? 'bg-background text-foreground shadow-(--shadow-1)'
									: 'text-muted-foreground'
							)}
						>
							{t(`tasks.timeline.zoom.${option}` as never)}
						</button>
					))}
				</div>
				<button
					type="button"
					className="rounded-md border border-border px-2 py-1 text-xs"
					onClick={() => shiftRange(-range.days)}
				>
					{t('tasks.timeline.previous')}
				</button>
				<button
					type="button"
					className="rounded-md border border-border px-2 py-1 text-xs"
					onClick={() => setAnchorDate(todayIsoFromDate(new Date()))}
				>
					{t('tasks.timeline.today')}
				</button>
				<button
					type="button"
					className="rounded-md border border-border px-2 py-1 text-xs"
					onClick={() => shiftRange(range.days)}
				>
					{t('tasks.timeline.next')}
				</button>
				<span className="text-xs text-muted-foreground">
					{range.startDate} — {range.endDate}
				</span>
				{canManageInitiatives ? (
					<button
						type="button"
						className="rounded-md border border-border px-2 py-1 text-xs"
						onClick={() => setInitiativeEditor({ open: true, initiative: null })}
					>
						{t('tasks.planning.new-initiative')}
					</button>
				) : null}
				{canWriteProjects ? (
					<>
						<button
							type="button"
							className="rounded-md border border-border px-2 py-1 text-xs"
							onClick={() => setMilestoneEditor({ open: true, milestone: null })}
						>
							{t('tasks.planning.new-milestone')}
						</button>
						<button
							type="button"
							className="rounded-md border border-border px-2 py-1 text-xs"
							onClick={() => setUpdateEditorOpen(true)}
						>
							{t('tasks.planning.new-update')}
						</button>
					</>
				) : null}
				<span className="ml-auto text-xs text-muted-foreground">{t('tasks.timeline.keyboard-help')}</span>
			</div>

			<div className="min-h-0 flex-1 overflow-auto p-4">
				<div className="min-w-190 space-y-4">
					{initiatives.length > 0 ? (
						<div className="space-y-2 rounded-lg border border-border bg-muted/30 p-3">
							<h2 className="text-xs font-semibold text-muted-foreground uppercase">
								{t('tasks.timeline.initiatives')}
							</h2>
							{initiatives.map((initiative) => (
								<div key={initiative.id} className="grid grid-cols-[180px_1fr] items-center gap-3 text-sm">
									{canManageInitiatives ? (
										<button
											type="button"
											className="truncate rounded-sm text-left font-medium focus-visible:outline-2 focus-visible:outline-ring"
											onClick={() => setInitiativeEditor({ open: true, initiative })}
										>
											{initiative.name}
										</button>
									) : (
										<span className="truncate font-medium">{initiative.name}</span>
									)}
									<div className="relative h-5 rounded bg-background">
										{initiative.targetDate ? (
											<span
												className="absolute top-1/2 size-2.5 -translate-y-1/2 rotate-45 rounded-xs bg-primary"
												style={{
													left: `${timelineBarGeometry(initiative.targetDate, initiative.targetDate, range)?.leftPercent ?? 0}%`
												}}
												title={initiative.targetDate}
											/>
										) : null}
									</div>
								</div>
							))}
						</div>
					) : null}

					<div className="space-y-1">
						{renderRows.length === 0 ? (
							<p className="py-12 text-center text-sm text-muted-foreground">{t('tasks.timeline.empty')}</p>
						) : (
							<div className="grid grid-cols-[220px_1fr] gap-3">
								<div className="space-y-1">
									{renderRows.map(({ issue }) => {
										const status = statusesById.get(issue.statusId)
										return (
											<div key={issue.id} className="flex h-9 min-w-0 flex-col justify-center text-sm">
												<div className="truncate font-medium">
													{issue.identifier} · {issue.title}
												</div>
												<div className="truncate text-xs text-muted-foreground">
													{projectsById.get(issue.projectId)?.name} · {status?.name}
													{(relationCountByIssue.get(issue.id) ?? 0) > 0
														? ` · ${t('tasks.timeline.dependencies', { count: relationCountByIssue.get(issue.id) ?? 0 })}`
														: ''}
												</div>
											</div>
										)
									})}
								</div>
								<div className="relative min-w-0">
									<svg
										aria-hidden="true"
										className="pointer-events-none absolute inset-0 z-0 h-full w-full overflow-visible text-muted-foreground/55"
										viewBox={`0 0 1000 ${Math.max(renderRows.length * 40, 40)}`}
										preserveAspectRatio="none"
									>
										<defs>
											<marker
												id="timeline-dependency-arrow"
												markerWidth="7"
												markerHeight="7"
												refX="6"
												refY="3.5"
												orient="auto"
											>
												<path d="M0,0 L7,3.5 L0,7 Z" fill="currentColor" />
											</marker>
										</defs>
										{connectors.map((connector) => {
											const midpointX = connector.x1 + Math.max(24, Math.abs(connector.x2 - connector.x1) / 2)
											return (
												<path
													key={connector.id}
													d={`M ${connector.x1} ${connector.y1} H ${midpointX} V ${connector.y2} H ${connector.x2}`}
													fill="none"
													stroke="currentColor"
													strokeWidth="1.5"
													vectorEffect="non-scaling-stroke"
													markerEnd="url(#timeline-dependency-arrow)"
												/>
											)
										})}
									</svg>
									<div className="relative z-10 space-y-1">
										{renderRows.map(({ issue, span, geometry }) => {
											const projectMilestones = milestones.filter(
												(milestone) => milestone.projectId === issue.projectId && milestone.targetDate
											)
											return (
												<div key={issue.id} className="relative h-9 rounded-md bg-muted/50">
													{projectMilestones.map((milestone) => {
														if (!milestone.targetDate) return null
														const marker = timelineBarGeometry(
															milestone.targetDate,
															milestone.targetDate,
															range
														)
														if (!marker) return null
														return canWriteProjects ? (
															<button
																key={milestone.id}
																type="button"
																className="absolute top-1 size-2 rotate-45 rounded-xs bg-warning focus-visible:outline-2 focus-visible:outline-ring"
																style={{ left: `${marker.leftPercent}%` }}
																title={milestone.name}
																onClick={() => setMilestoneEditor({ open: true, milestone })}
															/>
														) : (
															<span
																key={milestone.id}
																className="absolute top-1 size-2 rotate-45 rounded-xs bg-warning"
																style={{ left: `${marker.leftPercent}%` }}
																title={milestone.name}
															/>
														)
													})}
													<button
														type="button"
														onKeyDown={(event) => void handleDateKey(issue, event)}
														className="absolute top-1.5 h-6 rounded-md border border-primary/30 bg-primary/85 px-2 text-left text-xs font-medium text-primary-foreground shadow-(--shadow-1) focus-visible:outline-2 focus-visible:outline-ring"
														style={{
															left: `${geometry.leftPercent}%`,
															width: `max(${geometry.widthPercent}%, 3rem)`
														}}
														title={`${span.startDate} — ${span.dueDate}`}
													>
														<span className="truncate">{issue.identifier}</span>
													</button>
												</div>
											)
										})}
									</div>
								</div>
							</div>
						)}
					</div>
				</div>
			</div>
			<InitiativeDialog
				open={initiativeEditor.open}
				initiative={initiativeEditor.initiative}
				projects={projects}
				onOpenChange={(open) => setInitiativeEditor((current) => ({ ...current, open }))}
				onSubmit={async (input, initiativeId) => {
					if (initiativeId) await engine.updateInitiative(initiativeId, input)
					else await engine.createInitiative(input)
				}}
				onDelete={async (initiativeId) => engine.deleteInitiative(initiativeId)}
			/>
			<MilestoneDialog
				open={milestoneEditor.open}
				milestone={milestoneEditor.milestone}
				projects={projects}
				initialProjectId={projects[0]?.id ?? null}
				onOpenChange={(open) => setMilestoneEditor((current) => ({ ...current, open }))}
				onSubmit={async (projectId, input, milestoneId) => {
					if (milestoneId) await engine.updateProjectMilestone(projectId, milestoneId, input)
					else await engine.createProjectMilestone(projectId, input)
				}}
				onDelete={async (projectId, milestoneId) => engine.deleteProjectMilestone(projectId, milestoneId)}
			/>
			<ProjectUpdateDialog
				open={updateEditorOpen}
				projects={projects}
				updates={projectUpdates}
				initialProjectId={projects[0]?.id ?? null}
				onOpenChange={setUpdateEditorOpen}
				onSubmit={async (projectId, input) => {
					await engine.createProjectUpdate(projectId, input)
				}}
			/>
		</section>
	)
}
