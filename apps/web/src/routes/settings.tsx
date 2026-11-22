import { t } from '@huriro/i18n'
import { createFileRoute } from '@tanstack/react-router'
import { Button } from '@/components/ui/button'
import { useUiStore } from '@/stores/ui-store'

export const Route = createFileRoute('/settings')({
	component: SettingsRoute
})

function SettingsRoute() {
	const setImportDialogOpen = useUiStore((s) => s.setImportDialogOpen)

	return (
		<div className="mx-auto max-w-2xl space-y-4 p-6">
			<h1 className="text-xl font-semibold">{t('nav.settings')}</h1>
			<div className="flex items-center justify-between rounded-lg border border-border bg-card p-4">
				<div>
					<h2 className="text-sm font-medium">{t('imports.title')}</h2>
					<p className="text-xs text-muted-foreground">
						{t('imports.source.linear')} / {t('imports.source.github')}
					</p>
				</div>
				<Button size="sm" onClick={() => setImportDialogOpen(true)}>
					{t('tasks.import')}
				</Button>
			</div>
		</div>
	)
}
