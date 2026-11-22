import type { ProjectDto, SavedViewDto } from '@huriro/contracts'
import { t } from '@huriro/i18n'
import { Bookmark, Download, FolderKanban, Globe, Lock, Plus } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { cn } from '@/lib/utils'
import { useUiStore } from '@/stores/ui-store'

export interface ProjectSidebarProps {
	readonly projects: readonly ProjectDto[]
	readonly savedViews: readonly SavedViewDto[]
	readonly onSelectView: (view: SavedViewDto) => void
}

export function ProjectSidebar({ projects, savedViews, onSelectView }: ProjectSidebarProps) {
	const activeProjectId = useUiStore((s) => s.activeProjectId)
	const setActiveProjectId = useUiStore((s) => s.setActiveProjectId)
	const activeViewId = useUiStore((s) => s.filters.activeViewId)
	const setCreateProjectOpen = useUiStore((s) => s.setCreateProjectOpen)
	const setImportDialogOpen = useUiStore((s) => s.setImportDialogOpen)
	const resetFilters = useUiStore((s) => s.resetFilters)

	return (
		<aside
			aria-label={t('tasks.projects')}
			className="flex w-56 shrink-0 flex-col gap-4 border-r border-border bg-surface-2/50 p-3"
		>
			<div className="space-y-1">
				<div className="flex items-center justify-between px-2">
					<h2 className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">
						{t('tasks.projects')}
					</h2>
					<Button
						size="icon"
						tone="ghost"
						className="size-6"
						aria-label={t('tasks.new-project')}
						onClick={() => setCreateProjectOpen(true)}
					>
						<Plus className="size-3.5" aria-hidden />
					</Button>
				</div>

				<button
					type="button"
					onClick={() => {
						setActiveProjectId(null)
						resetFilters()
					}}
					className={cn(
						'flex w-full items-center gap-2 rounded-md px-2 py-1.5 text-left text-sm transition-colors',
						activeProjectId === null && activeViewId === null
							? 'bg-accent font-medium text-accent-foreground'
							: 'text-muted-foreground hover:bg-accent/60 hover:text-foreground'
					)}
				>
					<FolderKanban className="size-4 shrink-0" aria-hidden />
					<span className="truncate">{t('tasks.all-issues')}</span>
				</button>

				{projects.map((p) => (
					<button
						key={p.id}
						type="button"
						onClick={() => {
							setActiveProjectId(p.id)
							resetFilters()
						}}
						className={cn(
							'flex w-full items-center justify-between gap-2 rounded-md px-2 py-1.5 text-left text-sm transition-colors',
							activeProjectId === p.id
								? 'bg-accent font-medium text-accent-foreground'
								: 'text-muted-foreground hover:bg-accent/60 hover:text-foreground'
						)}
					>
						<span className="flex min-w-0 items-center gap-2">
							<span className="font-mono text-xs text-muted-foreground tnum">{p.key}</span>
							<span className="truncate">{p.name}</span>
						</span>
						{p.visibility === 'private' ? (
							<Lock className="size-3.5 shrink-0 text-muted-foreground" aria-hidden />
						) : (
							<Globe className="size-3.5 shrink-0 text-muted-foreground" aria-hidden />
						)}
					</button>
				))}
			</div>

			<div className="space-y-1">
				<h2 className="px-2 text-xs font-semibold uppercase tracking-wide text-muted-foreground">
					{t('tasks.views')}
				</h2>
				{savedViews.map((v) => (
					<button
						key={v.id}
						type="button"
						onClick={() => onSelectView(v)}
						className={cn(
							'flex w-full items-center gap-2 rounded-md px-2 py-1.5 text-left text-sm transition-colors',
							activeViewId === v.id
								? 'bg-accent font-medium text-accent-foreground'
								: 'text-muted-foreground hover:bg-accent/60 hover:text-foreground'
						)}
					>
						<Bookmark className="size-3.5 shrink-0" aria-hidden />
						<span className="truncate">{v.name}</span>
					</button>
				))}
			</div>

			<div className="mt-auto pt-2">
				<Button
					tone="outline"
					size="sm"
					className="w-full justify-start"
					onClick={() => setImportDialogOpen(true)}
				>
					<Download className="size-3.5" aria-hidden />
					<span>{t('tasks.import')}</span>
				</Button>
			</div>
		</aside>
	)
}
