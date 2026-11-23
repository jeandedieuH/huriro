import { t } from '@huriro/i18n'
import { Checkbox } from '@/components/ui/checkbox'
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from '@/components/ui/dialog'
import { Kbd } from '@/components/ui/kbd'
import { useUiStore } from '@/stores/ui-store'

const SHORTCUT_ROWS: readonly { readonly keys: readonly string[]; readonly label: string }[] = [
	{ keys: ['⌘', 'K'], label: 'Command palette' },
	{ keys: ['⌘', '\\'], label: 'Toggle sidebar' },
	{ keys: ['?'], label: 'Toggle keyboard shortcuts' },
	{ keys: ['⌘', 'J'], label: 'Toggle detail panel' },
	{ keys: ['C'], label: 'Create issue / doc page' },
	{ keys: ['G', 'H'], label: 'Go to Home' },
	{ keys: ['G', 'I'], label: 'Go to Inbox' },
	{ keys: ['G', 'T'], label: 'Go to Tasks' },
	{ keys: ['G', 'D'], label: 'Go to Docs' },
	{ keys: ['G', 'C'], label: 'Go to Chat' },
	{ keys: ['G', 'S'], label: 'Go to Settings' },
	{ keys: ['J / K'], label: 'Move focus down / up' },
	{ keys: ['Enter'], label: 'Open focused issue' },
	{ keys: ['Space'], label: 'Toggle selection' },
	{ keys: ['H / L'], label: 'Move issue left / right column' },
	{ keys: ['⌘', '↑ / ↓'], label: 'Reorder within column' },
	{ keys: ['Esc'], label: 'Close modal or clear selection' }
]

export function ShortcutsDialog() {
	const open = useUiStore((s) => s.shortcutsDialogOpen)
	const setOpen = useUiStore((s) => s.setShortcutsDialogOpen)
	const shortcutsEnabled = useUiStore((s) => s.shortcutsEnabled)
	const setShortcutsEnabled = useUiStore((s) => s.setShortcutsEnabled)

	return (
		<Dialog open={open} onOpenChange={setOpen}>
			<DialogContent className="max-w-md">
				<DialogHeader>
					<DialogTitle>{t('shortcuts.title')}</DialogTitle>
					<DialogDescription>Single-key bindings never activate while typing in an input.</DialogDescription>
				</DialogHeader>

				<div className="flex items-center justify-between rounded-md border border-border bg-muted/40 px-3 py-2">
					<label htmlFor="shortcuts-enabled-toggle" className="text-sm font-medium">
						{t('shortcuts.enable')}
					</label>
					<Checkbox
						id="shortcuts-enabled-toggle"
						checked={shortcutsEnabled}
						onCheckedChange={(v) => setShortcutsEnabled(v === true)}
					/>
				</div>

				<div className="max-h-72 space-y-1.5 overflow-y-auto pr-1">
					{SHORTCUT_ROWS.map((row) => (
						<div key={row.label} className="flex items-center justify-between py-1 text-sm">
							<span className="text-muted-foreground">{row.label}</span>
							<span className="flex items-center gap-1">
								{row.keys.map((k) => (
									<Kbd key={k}>{k}</Kbd>
								))}
							</span>
						</div>
					))}
				</div>
			</DialogContent>
		</Dialog>
	)
}
