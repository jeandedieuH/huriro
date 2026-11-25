import type { CycleDto, IssueDto } from '@huriro/contracts'
import { t } from '@huriro/i18n'
import { CalendarRange, ChartLine } from 'lucide-react'
import { lazy, Suspense, useMemo, useState } from 'react'
import { Button } from '@/components/ui/button'
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover'
import { Skeleton } from '@/components/ui/skeleton'

// The burnup chart is a lazy chunk (§21.4): it only loads when the user opens
// the popover, so neither the entry shell nor the initial tasks chunk pays for it.
const CycleBurnupChart = lazy(() => import('./cycle-burnup').then((m) => ({ default: m.CycleBurnupChart })))

export interface CycleStripProps {
	readonly cycle: CycleDto
	/** Issues in the active cycle — progress is computed locally from the replica (offline-first). */
	readonly cycleIssues: readonly IssueDto[]
}

/**
 * Active-cycle header strip (§3.3): surfaces the current cycle's name, end
 * date and local completion progress directly under the filter bar, with the
 * burnup chart one click away behind a lazy boundary.
 */
export function CycleStrip({ cycle, cycleIssues }: CycleStripProps) {
	const [chartOpen, setChartOpen] = useState(false)

	const progress = useMemo(() => {
		const total = cycleIssues.length
		const done = cycleIssues.filter((i) => i.closedAt !== null).length
		return { done, total, ratio: total > 0 ? done / total : 0 }
	}, [cycleIssues])

	const endsLabel = useMemo(() => {
		const endMs = Date.parse(cycle.endsAt)
		if (Number.isNaN(endMs)) return null
		return t('tasks.cycle.ends', { date: new Date(endMs).toLocaleDateString() })
	}, [cycle.endsAt])

	return (
		<div
			data-testid="cycle-strip"
			className="flex items-center gap-3 border-b border-border bg-surface-2/40 px-4 py-1.5 text-xs"
		>
			<CalendarRange className="size-3.5 text-muted-foreground" aria-hidden />
			<span className="font-medium text-foreground">{cycle.name}</span>
			{endsLabel ? <span className="text-muted-foreground">{endsLabel}</span> : null}
			{progress.total > 0 ? (
				<span className="flex items-center gap-1.5 text-muted-foreground">
					<span className="h-1 w-16 overflow-hidden rounded-full bg-accent" aria-hidden>
						<span
							className="block h-full bg-success"
							style={{ width: `${Math.round(progress.ratio * 100)}%` }}
						/>
					</span>
					<span className="tnum">
						{t('tasks.cycle.progress', { done: progress.done, total: progress.total })}
					</span>
				</span>
			) : null}
			<Popover open={chartOpen} onOpenChange={setChartOpen}>
				<PopoverTrigger asChild>
					<Button
						size="sm"
						tone="ghost"
						className="ml-auto h-6 px-2 text-xs"
						aria-label={t('tasks.cycle.view-chart')}
					>
						<ChartLine className="size-3.5" aria-hidden />
						{t('tasks.cycle.view-chart')}
					</Button>
				</PopoverTrigger>
				<PopoverContent align="end" className="w-xl max-w-[90vw] p-3">
					<h3 className="mb-2 text-xs font-semibold uppercase tracking-wide text-muted-foreground">
						{t('tasks.cycle.burnup')}
					</h3>
					{chartOpen ? (
						<Suspense fallback={<Skeleton className="h-44 w-full" />}>
							<CycleBurnupChart cycle={cycle} />
						</Suspense>
					) : null}
				</PopoverContent>
			</Popover>
		</div>
	)
}
