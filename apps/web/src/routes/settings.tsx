import { t } from '@huriro/i18n'
import { createFileRoute } from '@tanstack/react-router'
import { Moon, Sun } from 'lucide-react'
import { lazy, Suspense } from 'react'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Skeleton } from '@/components/ui/skeleton'
import { MailSettingsPanel } from '@/features/mail/components/mail-settings-panel'
import { AgentsSettingsPanel } from '@/features/settings/components/agents-panel'
import { AiSettingsPanel } from '@/features/settings/components/ai-settings-panel'
import { ApprovalsSettingsPanel } from '@/features/settings/components/approvals-panel'
import { GithubSettingsPanel } from '@/features/settings/components/github-settings-panel'
import { NotificationsSettingsPanel } from '@/features/settings/components/notifications-settings-panel'
import { WebhooksSettingsPanel } from '@/features/settings/components/webhooks-settings-panel'
import { cn } from '@/lib/utils'
import { useWorkspace } from '@/lib/workspace'
import { useUiStore } from '@/stores/ui-store'

const BillingSettingsPanel = lazy(() =>
	import('@/features/settings/components/billing-panel').then((m) => ({
		default: m.BillingSettingsPanel
	}))
)
const GovernanceSettingsPanel = lazy(() =>
	import('@/features/settings/components/governance-panel').then((m) => ({
		default: m.GovernanceSettingsPanel
	}))
)

export const Route = createFileRoute('/settings')({
	component: SettingsRoute
})

function SettingsRoute() {
	const { workspaceName, isPreview, mode } = useWorkspace()
	const settingsSection = useUiStore((s) => s.settingsSection)
	const setImportDialogOpen = useUiStore((s) => s.setImportDialogOpen)
	const theme = useUiStore((s) => s.theme)
	const toggleTheme = useUiStore((s) => s.toggleTheme)

	return (
		<div className="mx-auto max-w-3xl space-y-5 p-6">
			<h1 className="text-xl font-semibold">{t('nav.settings')}</h1>

			<div
				className={cn(
					'flex items-center justify-between rounded-lg border border-border bg-card p-4 transition-shadow',
					settingsSection === 'general' && 'ring-1 ring-primary/50'
				)}
			>
				<div>
					<h2 className="text-sm font-medium">{t('settings.sidebar.general')}</h2>
					<p className="text-xs text-muted-foreground">{workspaceName}</p>
				</div>
				{isPreview ? <Badge tone="secondary">{t('shell.preview-badge')}</Badge> : null}
			</div>

			<div className={cn(settingsSection === 'notifications' && 'rounded-lg ring-1 ring-primary/50')}>
				<NotificationsSettingsPanel />
			</div>

			<div
				className={cn(
					'flex items-center justify-between rounded-lg border border-border bg-card p-4 transition-shadow',
					settingsSection === 'imports' && 'ring-1 ring-primary/50'
				)}
			>
				<div>
					<h2 className="text-sm font-medium">{t('imports.title')}</h2>
					<p className="text-xs text-muted-foreground">
						{t('imports.source.linear')} / {t('imports.source.github')} / {t('imports.source.jira')} /{' '}
						{t('imports.source.slack')}
					</p>
				</div>
				<Button size="sm" onClick={() => setImportDialogOpen(true)}>
					{t('tasks.import')}
				</Button>
			</div>

			<div className={cn(settingsSection === 'webhooks' && 'rounded-lg ring-1 ring-primary/50')}>
				<WebhooksSettingsPanel />
			</div>

			<div className={cn(settingsSection === 'integrations' && 'rounded-lg ring-1 ring-primary/50')}>
				<GithubSettingsPanel />
			</div>

			<div className={cn(settingsSection === 'mail' && 'rounded-lg ring-1 ring-primary/50')}>
				<MailSettingsPanel />
			</div>

			<div className={cn(settingsSection === 'agents' && 'rounded-lg ring-1 ring-primary/50')}>
				<AgentsSettingsPanel />
			</div>

			<div className={cn(settingsSection === 'approvals' && 'rounded-lg ring-1 ring-primary/50')}>
				<ApprovalsSettingsPanel />
			</div>

			<div className={cn(settingsSection === 'ai' && 'rounded-lg ring-1 ring-primary/50')}>
				<AiSettingsPanel />
			</div>

			{mode === 'cloud' ? (
				<div className={cn(settingsSection === 'billing' && 'rounded-lg ring-1 ring-primary/50')}>
					<Suspense fallback={<Skeleton className="h-24 w-full" />}>
						<BillingSettingsPanel />
					</Suspense>
				</div>
			) : null}

			<div className={cn(settingsSection === 'governance' && 'rounded-lg ring-1 ring-primary/50')}>
				<Suspense fallback={<Skeleton className="h-24 w-full" />}>
					<GovernanceSettingsPanel />
				</Suspense>
			</div>

			<div
				className={cn(
					'flex items-center justify-between rounded-lg border border-border bg-card p-4 transition-shadow',
					settingsSection === 'appearance' && 'ring-1 ring-primary/50'
				)}
			>
				<div>
					<h2 className="text-sm font-medium">{t('settings.sidebar.appearance')}</h2>
					<p className="text-xs text-muted-foreground">{t('settings.appearance.desc')}</p>
				</div>
				<Button size="sm" tone="outline" onClick={toggleTheme}>
					{theme === 'dark' ? (
						<Sun className="size-3.5" aria-hidden />
					) : (
						<Moon className="size-3.5" aria-hidden />
					)}
					<span>{theme === 'dark' ? t('shell.theme.to-light') : t('shell.theme.to-dark')}</span>
				</Button>
			</div>
		</div>
	)
}
