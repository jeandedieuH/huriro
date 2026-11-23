import { t } from '@huriro/i18n'
import { Search } from 'lucide-react'
import { Kbd } from '@/components/ui/kbd'
import { Tooltip, TooltipContent, TooltipTrigger } from '@/components/ui/tooltip'

export interface SidebarHeaderProps {
	readonly collapsed?: boolean | undefined
	readonly onGoHome?: (() => void) | undefined
	readonly onOpenCommandPalette?: (() => void) | undefined
}

export function SidebarHeader({ collapsed = false, onGoHome, onOpenCommandPalette }: SidebarHeaderProps) {
	const homeLabel = `${t('app.name')} — ${t('nav.home')}`

	if (collapsed) {
		return (
			<div className="flex flex-col items-center gap-2 pb-3">
				{/* Brand mark doubles as the home shortcut; the colorful mark reads on both themes */}
				<Tooltip>
					<TooltipTrigger asChild>
						<button
							type="button"
							aria-label={homeLabel}
							onClick={onGoHome}
							className="flex size-9 items-center justify-center rounded-xl transition-colors hover:bg-sidebar-accent"
						>
							<img src="/images/icon.png" alt="" className="size-7" />
						</button>
					</TooltipTrigger>
					<TooltipContent side="right">{homeLabel}</TooltipContent>
				</Tooltip>

				<Tooltip>
					<TooltipTrigger asChild>
						<button
							type="button"
							aria-label={t('shell.command-palette')}
							onClick={onOpenCommandPalette}
							className="flex size-9 items-center justify-center rounded-xl border border-sidebar-border/80 bg-sidebar-icon-well/70 text-sidebar-muted-foreground transition-colors hover:bg-sidebar-accent hover:text-sidebar-foreground"
						>
							<Search className="size-4" aria-hidden />
						</button>
					</TooltipTrigger>
					<TooltipContent side="right">{t('nav.search')} (Ctrl+K)</TooltipContent>
				</Tooltip>
			</div>
		)
	}

	return (
		<div className="space-y-2.5 pb-3">
			{/* Brand logo in place of the workspace switcher — the light/dark pair swaps via the .dark class */}
			<button
				type="button"
				aria-label={homeLabel}
				onClick={onGoHome}
				className="flex w-full items-center rounded-lg px-1 py-1 transition-colors hover:bg-sidebar-accent/60"
			>
				<img src="/images/logo.png" alt="" className="h-12 w-auto dark:hidden" />
				<img src="/images/logo-white.png" alt="" className="hidden h-12 w-auto dark:block" />
			</button>

			<button
				type="button"
				aria-label={t('shell.command-palette')}
				onClick={onOpenCommandPalette}
				className="flex h-9 w-full items-center justify-between rounded-lg border border-sidebar-border/80 bg-sidebar-icon-well/60 px-2.5 text-sm text-sidebar-muted-foreground transition-colors hover:border-sidebar-ring/60 hover:bg-sidebar-accent hover:text-sidebar-foreground"
			>
				<span className="flex items-center gap-2">
					<Search className="size-3.5 shrink-0" aria-hidden />
					<span>{t('nav.search')}</span>
				</span>
				<Kbd className="border-sidebar-border bg-sidebar-accent/70 text-sidebar-muted-foreground">Ctrl+K</Kbd>
			</button>
		</div>
	)
}
