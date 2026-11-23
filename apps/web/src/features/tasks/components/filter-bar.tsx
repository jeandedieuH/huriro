import type { ProjectStatusDto } from '@huriro/contracts'
import { t } from '@huriro/i18n'
import { BookmarkPlus, ChevronRight, LayoutGrid, List, Plus, Search, UserCheck } from 'lucide-react'
import { useState } from 'react'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select'
import type { WorkspaceMemberSummary } from '@/lib/sync-bootstrap'
import { cn } from '@/lib/utils'
import { useUiStore } from '@/stores/ui-store'

export interface FilterBarProps {
	readonly statuses: readonly ProjectStatusDto[]
	readonly members: readonly WorkspaceMemberSummary[]
	readonly projectLabel?: string | undefined
	readonly viewLabel?: string | undefined
	readonly onSaveView: (name: string) => Promise<void>
}

export function FilterBar({ statuses, members, projectLabel, viewLabel, onSaveView }: FilterBarProps) {
	const filters = useUiStore((s) => s.filters)
	const setFilterPatch = useUiStore((s) => s.setFilterPatch)
	const resetFilters = useUiStore((s) => s.resetFilters)
	const tasksLayout = useUiStore((s) => s.tasksLayout)
	const setTasksLayout = useUiStore((s) => s.setTasksLayout)
	const density = useUiStore((s) => s.density)
	const setDensity = useUiStore((s) => s.setDensity)
	const setCreateIssueOpen = useUiStore((s) => s.setCreateIssueOpen)

	const [savePopoverOpen, setSavePopoverOpen] = useState(false)
	const [viewName, setViewName] = useState('')

	const hasActiveFilters =
		filters.query.length > 0 ||
		filters.statusId !== 'all' ||
		filters.priority !== 'all' ||
		filters.assigneeId !== 'all'

	// Deduplicate statuses by name when viewing All Issues across projects
	const statusOptions = statuses.reduce<ProjectStatusDto[]>((acc, s) => {
		if (!acc.some((item) => item.id === s.id)) acc.push(s)
		return acc
	}, [])

	return (
		<div className="flex flex-wrap items-center gap-2 border-b border-border bg-background px-4 py-2.5">
			{projectLabel || viewLabel ? (
				<div className="flex items-center gap-1.5 pr-2 text-xs">
					{projectLabel ? <span className="text-muted-foreground">{projectLabel}</span> : null}
					{projectLabel && viewLabel ? (
						<ChevronRight className="size-3 text-muted-foreground/70" aria-hidden />
					) : null}
					{viewLabel ? <span className="font-medium text-foreground">{viewLabel}</span> : null}
				</div>
			) : null}

			{/* View switcher: List / Board / My work */}
			<div role="tablist" aria-label={t('tasks.title')} className="inline-flex rounded-md bg-muted p-0.5">
				<button
					type="button"
					role="tab"
					aria-selected={tasksLayout === 'list'}
					onClick={() => setTasksLayout('list')}
					className={cn(
						'inline-flex items-center gap-1.5 rounded-sm px-2.5 py-1 text-xs font-medium transition-colors',
						tasksLayout === 'list'
							? 'bg-background text-foreground shadow-(--shadow-1)'
							: 'text-muted-foreground'
					)}
				>
					<List className="size-3.5" aria-hidden />
					<span>{t('tasks.view.list')}</span>
				</button>
				<button
					type="button"
					role="tab"
					aria-selected={tasksLayout === 'board'}
					onClick={() => setTasksLayout('board')}
					className={cn(
						'inline-flex items-center gap-1.5 rounded-sm px-2.5 py-1 text-xs font-medium transition-colors',
						tasksLayout === 'board'
							? 'bg-background text-foreground shadow-(--shadow-1)'
							: 'text-muted-foreground'
					)}
				>
					<LayoutGrid className="size-3.5" aria-hidden />
					<span>{t('tasks.view.board')}</span>
				</button>
				<button
					type="button"
					role="tab"
					aria-selected={tasksLayout === 'my-work'}
					onClick={() => setTasksLayout('my-work')}
					className={cn(
						'inline-flex items-center gap-1.5 rounded-sm px-2.5 py-1 text-xs font-medium transition-colors',
						tasksLayout === 'my-work'
							? 'bg-background text-foreground shadow-(--shadow-1)'
							: 'text-muted-foreground'
					)}
				>
					<UserCheck className="size-3.5" aria-hidden />
					<span>{t('tasks.view.my-work')}</span>
				</button>
			</div>

			{/* Text filter */}
			<div className="relative min-w-48 flex-1 max-w-xs">
				<Search
					className="pointer-events-none absolute top-1/2 left-2.5 size-3.5 -translate-y-1/2 text-muted-foreground"
					aria-hidden
				/>
				<Input
					value={filters.query}
					onChange={(ev) => setFilterPatch({ query: ev.target.value, activeViewId: null })}
					placeholder={t('tasks.filter.placeholder')}
					aria-label={t('tasks.filter.placeholder')}
					className="h-8 pl-8 text-xs"
				/>
			</div>

			{/* Status filter */}
			<Select
				value={filters.statusId}
				onValueChange={(value) => setFilterPatch({ statusId: value, activeViewId: null })}
			>
				<SelectTrigger aria-label={t('tasks.filter.status')} className="h-8 w-36 text-xs">
					<SelectValue placeholder={t('tasks.filter.status')} />
				</SelectTrigger>
				<SelectContent>
					<SelectItem value="all">{t('tasks.filter.all')}</SelectItem>
					{statusOptions.map((s) => (
						<SelectItem key={s.id} value={s.id}>
							{s.name}
						</SelectItem>
					))}
				</SelectContent>
			</Select>

			{/* Priority filter */}
			<Select
				value={String(filters.priority)}
				onValueChange={(value) =>
					setFilterPatch({
						priority: value === 'all' ? 'all' : Number(value),
						activeViewId: null
					})
				}
			>
				<SelectTrigger aria-label={t('tasks.filter.priority')} className="h-8 w-36 text-xs">
					<SelectValue placeholder={t('tasks.filter.priority')} />
				</SelectTrigger>
				<SelectContent>
					<SelectItem value="all">{t('tasks.filter.all')}</SelectItem>
					<SelectItem value="4">{t('tasks.priority.4')}</SelectItem>
					<SelectItem value="3">{t('tasks.priority.3')}</SelectItem>
					<SelectItem value="2">{t('tasks.priority.2')}</SelectItem>
					<SelectItem value="1">{t('tasks.priority.1')}</SelectItem>
					<SelectItem value="0">{t('tasks.priority.0')}</SelectItem>
				</SelectContent>
			</Select>

			{/* Assignee filter */}
			<Select
				value={filters.assigneeId}
				onValueChange={(value) => setFilterPatch({ assigneeId: value, activeViewId: null })}
			>
				<SelectTrigger aria-label={t('tasks.filter.assignee')} className="h-8 w-36 text-xs">
					<SelectValue placeholder={t('tasks.filter.assignee')} />
				</SelectTrigger>
				<SelectContent>
					<SelectItem value="all">{t('tasks.filter.all')}</SelectItem>
					<SelectItem value="me">{t('tasks.filter.me')}</SelectItem>
					<SelectItem value="unassigned">{t('tasks.detail.unassigned')}</SelectItem>
					{members.map((m) => (
						<SelectItem key={m.userId} value={m.userId}>
							{m.displayName}
						</SelectItem>
					))}
				</SelectContent>
			</Select>

			{hasActiveFilters ? (
				<Button size="sm" tone="ghost" onClick={resetFilters}>
					{t('tasks.filter.clear')}
				</Button>
			) : null}

			{/* Save current view */}
			<Popover open={savePopoverOpen} onOpenChange={setSavePopoverOpen}>
				<PopoverTrigger asChild>
					<Button size="sm" tone="outline">
						<BookmarkPlus className="size-3.5" aria-hidden />
						<span>{t('tasks.save-view')}</span>
					</Button>
				</PopoverTrigger>
				<PopoverContent align="end" className="w-64 space-y-3">
					<form
						onSubmit={(ev) => {
							ev.preventDefault()
							const trimmed = viewName.trim()
							if (!trimmed) return
							void onSaveView(trimmed).then(() => {
								setViewName('')
								setSavePopoverOpen(false)
							})
						}}
						className="space-y-2"
					>
						<label htmlFor="save-view-name" className="block text-xs font-medium">
							{t('tasks.save-view.name')}
						</label>
						<Input
							id="save-view-name"
							value={viewName}
							onChange={(ev) => setViewName(ev.target.value)}
							placeholder={t('tasks.save-view.name')}
							className="h-8 text-xs"
						/>
						<div className="flex justify-end gap-2">
							<Button size="sm" tone="ghost" type="button" onClick={() => setSavePopoverOpen(false)}>
								{t('common.cancel')}
							</Button>
							<Button size="sm" type="submit" disabled={!viewName.trim()}>
								{t('common.save')}
							</Button>
						</div>
					</form>
				</PopoverContent>
			</Popover>

			<Button
				size="sm"
				tone="ghost"
				onClick={() => setDensity(density === 'comfortable' ? 'compact' : 'comfortable')}
			>
				{density === 'compact' ? t('tasks.density.compact') : t('tasks.density.comfortable')}
			</Button>

			<Button size="sm" className="ml-auto" onClick={() => setCreateIssueOpen(true)}>
				<Plus className="size-3.5" aria-hidden />
				<span>{t('tasks.new-issue')}</span>
			</Button>
		</div>
	)
}
