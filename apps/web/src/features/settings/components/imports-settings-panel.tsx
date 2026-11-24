import type { ImportSource } from '@huriro/contracts'
import { type MessageId, t } from '@huriro/i18n'
import {
	ArrowRight,
	Download,
	FileCode2,
	FileText,
	GitBranch,
	Kanban,
	Layers,
	MessageSquare
} from 'lucide-react'
import { Button } from '@/components/ui/button'
import { useUiStore } from '@/stores/ui-store'
import { SettingsCard, SettingsCardBody, SettingsCardHeader } from './settings-primitives'

interface SourceCardConfig {
	readonly id: ImportSource
	readonly labelId: MessageId
	readonly descId: MessageId
	readonly icon: typeof Download
}

const IMPORT_SOURCES: readonly SourceCardConfig[] = [
	{
		id: 'linear',
		labelId: 'imports.source.linear',
		descId: 'settings.imports.source-linear-desc',
		icon: Layers
	},
	{
		id: 'github',
		labelId: 'imports.source.github',
		descId: 'settings.imports.source-github-desc',
		icon: GitBranch
	},
	{
		id: 'jira',
		labelId: 'imports.source.jira',
		descId: 'settings.imports.source-jira-desc',
		icon: Kanban
	},
	{
		id: 'notion',
		labelId: 'imports.source.notion',
		descId: 'settings.imports.source-notion-desc',
		icon: FileText
	},
	{
		id: 'markdown',
		labelId: 'imports.source.markdown',
		descId: 'settings.imports.source-markdown-desc',
		icon: FileCode2
	},
	{
		id: 'slack',
		labelId: 'imports.source.slack',
		descId: 'settings.imports.source-slack-desc',
		icon: MessageSquare
	}
]

export function ImportsSettingsPanel() {
	const openImportDialog = useUiStore((s) => s.openImportDialog)

	return (
		<div className="space-y-5">
			<SettingsCard labelledBy="imports-hero-heading">
				<SettingsCardHeader
					headingId="imports-hero-heading"
					icon={<Download className="size-4" />}
					title={t('settings.imports.hero-title')}
					description={t('settings.imports.hero-desc')}
					action={
						<Button size="sm" type="button" onClick={() => openImportDialog()}>
							{t('tasks.import')}
						</Button>
					}
				/>
			</SettingsCard>

			<SettingsCard labelledBy="imports-sources-heading">
				<SettingsCardHeader headingId="imports-sources-heading" title={t('settings.imports.sources-title')} />
				<SettingsCardBody>
					<div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
						{IMPORT_SOURCES.map((source) => {
							const Icon = source.icon
							const label = t(source.labelId)
							return (
								<button
									key={source.id}
									type="button"
									onClick={() => openImportDialog(source.id)}
									className="group flex flex-col justify-between gap-3 rounded-xl border border-border bg-surface-2/40 p-4 text-left transition-colors duration-(--motion-duration-fast) hover:border-primary/40 hover:bg-accent/50"
								>
									<div className="space-y-2">
										<span
											aria-hidden
											className="inline-flex size-8 items-center justify-center rounded-lg border border-border bg-card text-muted-foreground transition-colors group-hover:text-primary"
										>
											<Icon className="size-4" />
										</span>
										<div>
											<p className="text-sm font-semibold text-foreground">{label}</p>
											<p className="mt-1 text-xs leading-relaxed text-muted-foreground">{t(source.descId)}</p>
										</div>
									</div>

									<span className="inline-flex items-center gap-1 text-xs font-medium text-primary">
										<span>{t('settings.imports.start', { source: label })}</span>
										<ArrowRight
											className="size-3.5 transition-transform group-hover:translate-x-0.5"
											aria-hidden
										/>
									</span>
								</button>
							)
						})}
					</div>
				</SettingsCardBody>
			</SettingsCard>
		</div>
	)
}
