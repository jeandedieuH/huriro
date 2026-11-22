import { t } from '@huriro/i18n'
import { Kbd } from '@/components/ui/kbd'

export function Topbar() {
	return (
		<header className="flex h-12 items-center gap-3 border-b border-border bg-surface-2 px-4">
			<button
				type="button"
				className="flex h-8 flex-1 max-w-md items-center justify-between rounded-md border border-input bg-background px-3 text-sm text-muted-foreground"
			>
				<span>{t('search.placeholder')}</span>
				<span className="flex gap-0.5">
					<Kbd>⌘</Kbd>
					<Kbd>K</Kbd>
				</span>
			</button>
			<div className="ml-auto flex items-center gap-2">
				<div className="size-7 rounded-full bg-primary/20 text-center text-xs leading-7 text-primary">H</div>
			</div>
		</header>
	)
}
