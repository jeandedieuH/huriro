import { t } from '@huriro/i18n'
import { Moon, Plus, Sun } from 'lucide-react'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Kbd } from '@/components/ui/kbd'

export interface TopbarProps {
	readonly isPreview?: boolean | undefined
	readonly theme?: 'light' | 'dark' | undefined
	readonly onOpenCommandPalette?: (() => void) | undefined
	readonly onCreateNew?: (() => void) | undefined
	readonly onToggleTheme?: (() => void) | undefined
}

export function Topbar({
	isPreview,
	theme = 'light',
	onOpenCommandPalette,
	onCreateNew,
	onToggleTheme
}: TopbarProps) {
	return (
		<header className="flex h-12 items-center gap-3 border-b border-border bg-surface-2 px-4">
			<button
				type="button"
				aria-label={t('shell.command-palette')}
				onClick={onOpenCommandPalette}
				className="flex h-8 flex-1 max-w-md items-center justify-between rounded-md border border-input bg-background px-3 text-sm text-muted-foreground hover:border-ring"
			>
				<span>{t('search.placeholder')}</span>
				<span className="flex gap-0.5">
					<Kbd>⌘</Kbd>
					<Kbd>K</Kbd>
				</span>
			</button>

			<div className="ml-auto flex items-center gap-2">
				{isPreview ? <Badge tone="secondary">{t('shell.preview-badge')}</Badge> : null}
				{onCreateNew ? (
					<Button size="sm" onClick={onCreateNew}>
						<Plus className="size-3.5" aria-hidden />
						<span>{t('shell.new')}</span>
					</Button>
				) : null}
				{onToggleTheme ? (
					<Button
						size="icon"
						tone="ghost"
						className="size-8"
						aria-label={t('shell.theme-toggle')}
						onClick={onToggleTheme}
					>
						{theme === 'dark' ? (
							<Sun className="size-4" aria-hidden />
						) : (
							<Moon className="size-4" aria-hidden />
						)}
					</Button>
				) : null}
				<div className="size-7 rounded-full bg-primary/20 text-center text-xs leading-7 text-primary">H</div>
			</div>
		</header>
	)
}
