import type { CycleDailySnapshotDto, CycleDto } from '@huriro/contracts'
import { t } from '@huriro/i18n'
import { useEffect, useMemo, useState } from 'react'
import { useWorkspace } from '@/lib/workspace'

/**
 * Hand-rolled SVG cycle burnup (§3.3, §8.3) — no chart library: the whole
 * thing is a lazy chunk (~3 KB) so the entry shell budget stays untouched.
 * Draws scope (total), completed and the ideal-pace line over the cycle.
 */
export function CycleBurnupChart({ cycle }: { readonly cycle: CycleDto }) {
	const { api } = useWorkspace()
	const [snapshots, setSnapshots] = useState<readonly CycleDailySnapshotDto[] | null>(null)

	useEffect(() => {
		let cancelled = false
		void api
			.listCycleSnapshots(cycle.id)
			.then((s) => {
				if (!cancelled) setSnapshots(s)
			})
			.catch(() => {
				if (!cancelled) setSnapshots([])
			})
		return () => {
			cancelled = true
		}
	}, [api, cycle.id])

	const model = useMemo(() => {
		if (!snapshots || snapshots.length === 0) return null
		const startMs = Date.parse(cycle.startsAt)
		const endMs = Date.parse(cycle.endsAt)
		const span = Math.max(endMs - startMs, 1)
		const W = 560
		const H = 180
		const PAD = 28
		const maxScope = Math.max(...snapshots.map((s) => s.totalIssues), 1)
		const x = (ms: number) => PAD + ((ms - startMs) / span) * (W - PAD * 2)
		const y = (n: number) => H - PAD - (n / maxScope) * (H - PAD * 2)
		const line = (pick: (s: CycleDailySnapshotDto) => number) =>
			snapshots.map((s) => `${x(Date.parse(s.snapshotDate))},${y(pick(s))}`).join(' ')
		return {
			W,
			H,
			PAD,
			maxScope,
			scopeLine: line((s) => s.totalIssues),
			doneLine: line((s) => s.completedIssues),
			idealLine: `${x(startMs)},${y(0)} ${x(endMs)},${y(maxScope)}`,
			xEnd: x(endMs),
			yMax: y(maxScope),
			yZero: y(0)
		}
	}, [cycle.endsAt, cycle.startsAt, snapshots])

	if (snapshots === null) {
		return (
			<div
				role="status"
				className="h-44 animate-pulse rounded-md bg-accent/30"
				aria-label={t('peek.loading')}
			/>
		)
	}
	if (!model) {
		return <p className="py-6 text-center text-sm text-muted-foreground">{t('tasks.cycle.no-snapshots')}</p>
	}

	const latest = snapshots[snapshots.length - 1]
	return (
		<div className="space-y-2">
			<svg
				viewBox={`0 0 ${model.W} ${model.H}`}
				className="w-full"
				role="img"
				aria-label={t('tasks.cycle.burnup')}
			>
				<line
					x1={model.PAD}
					y1={model.yZero}
					x2={model.xEnd}
					y2={model.yZero}
					className="stroke-border"
					strokeWidth="1"
				/>
				{/* ideal pace — dashed diagonal across the cycle window */}
				<polyline
					points={model.idealLine}
					fill="none"
					className="stroke-muted-foreground"
					strokeWidth="1"
					strokeDasharray="4 3"
					opacity="0.5"
				/>
				<polyline points={model.scopeLine} fill="none" className="stroke-primary" strokeWidth="1.5" />
				<polyline points={model.doneLine} fill="none" className="stroke-success" strokeWidth="2" />
			</svg>
			<div className="flex items-center gap-4 text-xs text-muted-foreground">
				<span className="flex items-center gap-1">
					<span className="inline-block h-0.5 w-4 bg-success" aria-hidden />
					{t('tasks.cycle.completed')}
				</span>
				<span className="flex items-center gap-1">
					<span className="inline-block h-0.5 w-4 bg-primary" aria-hidden />
					{t('tasks.cycle.scope')}
				</span>
				<span className="flex-1" />
				{latest ? (
					<span className="tnum">
						{t('tasks.cycle.progress', { done: latest.completedIssues, total: latest.totalIssues })}
					</span>
				) : null}
			</div>
		</div>
	)
}
