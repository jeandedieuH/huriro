import { t } from '@huriro/i18n'
import { SlidersHorizontal } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover'
import { type TasksDisplayOptions, useUiStore } from '@/stores/ui-store'

/**
 * Display menu (§3.4): grouping, swimlanes, sort direction and sub-issue
 * nesting. Ephemeral in the ui-store; saved into views as `displayOptions`.
 */
export function DisplayMenu() {
	const display = useUiStore((s) => s.tasksDisplay)
	const setTasksDisplay = useUiStore((s) => s.setTasksDisplay)

	return (
		<Popover>
			<PopoverTrigger asChild>
				<Button size="sm" tone="outline" aria-label={t('tasks.display.title')}>
					<SlidersHorizontal className="size-3.5" aria-hidden />
					{t('tasks.display.title')}
				</Button>
			</PopoverTrigger>
			<PopoverContent align="end" className="w-64 space-y-3 p-3">
				<MenuSelect
					label={t('tasks.display.group-by')}
					value={display.groupBy}
					options={[
						'none',
						'status_category',
						'priority',
						'assignee_id',
						'project_id',
						'cycle_id',
						'due_date'
					]}
					onChange={(v) => setTasksDisplay({ groupBy: v as TasksDisplayOptions['groupBy'] })}
				/>
				<MenuSelect
					label={t('tasks.display.sub-group-by')}
					value={display.subGroupBy}
					options={['none', 'priority', 'assignee_id']}
					onChange={(v) => setTasksDisplay({ subGroupBy: v as TasksDisplayOptions['subGroupBy'] })}
				/>
				<MenuSelect
					label={t('tasks.display.sort-by')}
					value={display.sortBy}
					options={['manual', 'priority', 'due_date', 'updated_at', 'created_at', 'estimate']}
					labels={{
						manual: t('tasks.display.sort.manual'),
						priority: t('tasks.display.sort.priority'),
						due_date: t('tasks.display.sort.due_date'),
						updated_at: t('tasks.display.sort.updated_at'),
						created_at: t('tasks.display.sort.created_at'),
						estimate: t('tasks.display.sort.estimate')
					}}
					onChange={(v) => setTasksDisplay({ sortBy: v as TasksDisplayOptions['sortBy'] })}
				/>
				<MenuSelect
					label={t('tasks.display.direction')}
					value={display.sortDirection}
					options={['asc', 'desc']}
					labels={{ asc: t('tasks.display.asc'), desc: t('tasks.display.desc') }}
					onChange={(v) => setTasksDisplay({ sortDirection: v as TasksDisplayOptions['sortDirection'] })}
				/>
				<label className="flex items-center gap-2 text-sm">
					<input
						type="checkbox"
						checked={display.showSubIssues}
						onChange={(e) => setTasksDisplay({ showSubIssues: e.target.checked })}
					/>
					{t('tasks.display.show-sub-issues')}
				</label>
			</PopoverContent>
		</Popover>
	)
}

function MenuSelect({
	label,
	value,
	options,
	labels,
	onChange
}: {
	readonly label: string
	readonly value: string
	readonly options: readonly string[]
	readonly labels?: Record<string, string>
	readonly onChange: (v: string) => void
}) {
	return (
		<label className="flex items-center justify-between gap-2 text-sm">
			<span className="text-muted-foreground">{label}</span>
			<select
				className="rounded border border-border bg-background px-1.5 py-1 text-xs"
				value={value}
				onChange={(e) => onChange(e.target.value)}
			>
				{options.map((o) => (
					<option key={o} value={o}>
						{labels?.[o] ?? (o === 'none' ? t('tasks.display.none') : t(`tasks.filtervalue.${o}` as never))}
					</option>
				))}
			</select>
		</label>
	)
}
