import type { IssueDto, ProjectMilestoneDto, UpdateIssueBody } from '@huriro/contracts'
import { calendarMonthGrid, todayIsoFromDate } from '@huriro/domain'
import { t } from '@huriro/i18n'
import { type KeyboardEvent, useMemo, useState } from 'react'
import { cn } from '@/lib/utils'

export interface TaskCalendarViewProps {
	readonly issues: readonly IssueDto[]
	readonly milestones: readonly ProjectMilestoneDto[]
	readonly onPatchIssue: (id: string, patch: UpdateIssueBody) => Promise<unknown>
}

function monthKeyParts(date: string): { year: number; monthIndex: number } {
	const [year, month] = date.split('-').map(Number)
	return { year: year ?? 1970, monthIndex: (month ?? 1) - 1 }
}

/** Month calendar for due dates; focused chips support ArrowLeft/ArrowRight date moves. */
export function TaskCalendarView({ issues, milestones, onPatchIssue }: TaskCalendarViewProps) {
	const today = todayIsoFromDate(new Date())
	const [monthAnchor, setMonthAnchor] = useState(today)
	const { year, monthIndex } = monthKeyParts(monthAnchor)
	const weeks = useMemo(() => calendarMonthGrid(year, monthIndex, 1), [year, monthIndex])
	const byDate = useMemo(() => {
		const map = new Map<string, IssueDto[]>()
		for (const issue of issues) {
			if (!issue.dueDate || issue.deletedAt !== null) continue
			const list = map.get(issue.dueDate) ?? []
			list.push(issue)
			map.set(issue.dueDate, list)
		}
		return map
	}, [issues])
	const milestonesByDate = useMemo(() => {
		const map = new Map<string, ProjectMilestoneDto[]>()
		for (const milestone of milestones) {
			if (!milestone.targetDate) continue
			const list = map.get(milestone.targetDate) ?? []
			list.push(milestone)
			map.set(milestone.targetDate, list)
		}
		return map
	}, [milestones])

	function moveMonth(delta: number) {
		setMonthAnchor(todayIsoFromDate(new Date(Date.UTC(year, monthIndex + delta, 1))))
	}

	async function handleChipKey(issue: IssueDto, event: KeyboardEvent<HTMLButtonElement>) {
		if ((event.key !== 'ArrowLeft' && event.key !== 'ArrowRight') || !issue.dueDate) return
		event.preventDefault()
		const days = event.key === 'ArrowLeft' ? -1 : 1
		const next = todayIsoFromDate(new Date(Date.parse(`${issue.dueDate}T00:00:00Z`) + days * 86_400_000))
		await onPatchIssue(issue.id, { dueDate: next, version: issue.version })
	}

	return (
		<section aria-label={t('tasks.calendar.title')} className="flex h-full min-h-0 flex-col">
			<div className="flex items-center gap-2 border-b border-border px-4 py-2">
				<button
					type="button"
					className="rounded-md border border-border px-2 py-1 text-xs"
					onClick={() => moveMonth(-1)}
				>
					{t('tasks.timeline.previous')}
				</button>
				<button
					type="button"
					className="rounded-md border border-border px-2 py-1 text-xs"
					onClick={() => setMonthAnchor(today)}
				>
					{t('tasks.timeline.today')}
				</button>
				<button
					type="button"
					className="rounded-md border border-border px-2 py-1 text-xs"
					onClick={() => moveMonth(1)}
				>
					{t('tasks.timeline.next')}
				</button>
				<h2 className="text-sm font-semibold">
					{todayIsoFromDate(new Date(Date.UTC(year, monthIndex, 1))).slice(0, 7)}
				</h2>
				<span className="ml-auto text-xs text-muted-foreground">{t('tasks.calendar.keyboard-help')}</span>
			</div>
			<div className="grid min-h-0 flex-1 grid-cols-7 grid-rows-6 overflow-hidden">
				{weeks.flat().map((date) => {
					const inMonth = monthKeyParts(date).monthIndex === monthIndex
					const dayIssues = byDate.get(date) ?? []
					const dayMilestones = milestonesByDate.get(date) ?? []
					return (
						<div
							key={date}
							className={cn(
								'min-h-28 border-r border-b border-border p-1.5',
								!inMonth && 'bg-muted/30 text-muted-foreground'
							)}
						>
							<div className="flex items-center justify-between text-xs">
								<span
									className={cn(
										'font-medium',
										date === today && 'rounded-full bg-primary px-1.5 text-primary-foreground'
									)}
								>
									{Number(date.slice(8, 10))}
								</span>
								{dayMilestones.length > 0 ? (
									<span
										className="size-2 rotate-45 bg-warning"
										title={dayMilestones.map((m) => m.name).join(', ')}
									/>
								) : null}
							</div>
							<div className="mt-1 space-y-1 overflow-hidden">
								{dayIssues.slice(0, 4).map((issue) => (
									<button
										key={issue.id}
										type="button"
										onKeyDown={(event) => void handleChipKey(issue, event)}
										className="block w-full truncate rounded border border-border bg-background px-1.5 py-0.5 text-left text-xs hover:bg-accent focus-visible:outline-2 focus-visible:outline-ring"
										title={issue.title}
									>
										<span className="font-medium">{issue.identifier}</span> {issue.title}
									</button>
								))}
								{dayIssues.length > 4 ? (
									<div className="text-xs text-muted-foreground">
										{t('tasks.calendar.more', { count: dayIssues.length - 4 })}
									</div>
								) : null}
							</div>
						</div>
					)
				})}
			</div>
		</section>
	)
}
