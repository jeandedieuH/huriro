import { t } from '@huriro/i18n'
import { ChevronRight } from 'lucide-react'
import { lazy, Suspense, useMemo } from 'react'
import { Badge } from '@/components/ui/badge'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select'
import { useWorkspace } from '@/lib/workspace'
import { type SettingsSection, useUiStore } from '@/stores/ui-store'
import {
	getSettingsSectionMeta,
	getVisibleSettingsSections,
	isSettingsSection,
	resolveActiveSettingsSection,
	SETTINGS_GROUPS
} from '../settings-sections'
import { AppearanceSettingsPanel } from './appearance-settings-panel'
import { GeneralSettingsPanel } from './general-settings-panel'
import { ImportsSettingsPanel } from './imports-settings-panel'
import { MembersSettingsPanel } from './members-settings-panel'
import { SettingsNotice, SettingsSkeleton } from './settings-primitives'

const NotificationsSettingsPanel = lazy(() =>
	import('./notifications-settings-panel').then((m) => ({ default: m.NotificationsSettingsPanel }))
)
const AvailabilitySettingsPanel = lazy(() =>
	import('./availability-settings-panel').then((m) => ({ default: m.AvailabilitySettingsPanel }))
)
const WebhooksSettingsPanel = lazy(() =>
	import('./webhooks-settings-panel').then((m) => ({ default: m.WebhooksSettingsPanel }))
)
const GithubSettingsPanel = lazy(() =>
	import('./github-settings-panel').then((m) => ({ default: m.GithubSettingsPanel }))
)
const MailSettingsPanel = lazy(() =>
	import('@/features/mail/components/mail-settings-panel').then((m) => ({
		default: m.MailSettingsPanel
	}))
)
const AgentsSettingsPanel = lazy(() =>
	import('./agents-panel').then((m) => ({ default: m.AgentsSettingsPanel }))
)
const ApprovalsSettingsPanel = lazy(() =>
	import('./approvals-panel').then((m) => ({ default: m.ApprovalsSettingsPanel }))
)
const AiSettingsPanel = lazy(() =>
	import('./ai-settings-panel').then((m) => ({ default: m.AiSettingsPanel }))
)
const BillingSettingsPanel = lazy(() =>
	import('./billing-panel').then((m) => ({ default: m.BillingSettingsPanel }))
)
const GovernanceSettingsPanel = lazy(() =>
	import('./governance-panel').then((m) => ({ default: m.GovernanceSettingsPanel }))
)

export interface SettingsWorkspaceProps {
	readonly billingStatus?: 'success' | 'cancel' | undefined
	readonly onDismissBillingStatus?: (() => void) | undefined
}

export function SettingsWorkspace({ billingStatus, onDismissBillingStatus }: SettingsWorkspaceProps) {
	const { isPreview, mode } = useWorkspace()
	const settingsSection = useUiStore((s) => s.settingsSection)
	const setSettingsSection = useUiStore((s) => s.setSettingsSection)

	const activeSectionId = resolveActiveSettingsSection(settingsSection, mode)
	const activeMeta = getSettingsSectionMeta(activeSectionId)
	const activeGroup = SETTINGS_GROUPS.find((g) => g.id === activeMeta.group) ?? {
		id: 'workspace' as const,
		labelId: 'settings.group.workspace' as const
	}
	const visibleSections = useMemo(() => getVisibleSettingsSections(mode), [mode])
	const ActiveIcon = activeMeta.icon

	function renderSectionPanel(section: SettingsSection) {
		switch (section) {
			case 'general':
				return <GeneralSettingsPanel />
			case 'members':
				return <MembersSettingsPanel />
			case 'imports':
				return <ImportsSettingsPanel />
			case 'appearance':
				return <AppearanceSettingsPanel />
			case 'notifications':
				return (
					<Suspense fallback={<SettingsSkeleton rows={4} />}>
						<NotificationsSettingsPanel />
					</Suspense>
				)
			case 'availability':
				return (
					<Suspense fallback={<SettingsSkeleton rows={4} />}>
						<AvailabilitySettingsPanel />
					</Suspense>
				)
			case 'webhooks':
				return (
					<Suspense fallback={<SettingsSkeleton rows={3} />}>
						<WebhooksSettingsPanel />
					</Suspense>
				)
			case 'integrations':
				return (
					<Suspense fallback={<SettingsSkeleton rows={3} />}>
						<GithubSettingsPanel />
					</Suspense>
				)
			case 'mail':
				return (
					<Suspense fallback={<SettingsSkeleton rows={3} />}>
						<MailSettingsPanel />
					</Suspense>
				)
			case 'agents':
				return (
					<Suspense fallback={<SettingsSkeleton rows={4} />}>
						<AgentsSettingsPanel />
					</Suspense>
				)
			case 'approvals':
				return (
					<Suspense fallback={<SettingsSkeleton rows={3} />}>
						<ApprovalsSettingsPanel />
					</Suspense>
				)
			case 'ai':
				return (
					<Suspense fallback={<SettingsSkeleton rows={3} />}>
						<AiSettingsPanel />
					</Suspense>
				)
			case 'billing':
				return (
					<Suspense fallback={<SettingsSkeleton rows={3} />}>
						<BillingSettingsPanel />
					</Suspense>
				)
			case 'governance':
				return (
					<Suspense fallback={<SettingsSkeleton rows={3} />}>
						<GovernanceSettingsPanel />
					</Suspense>
				)
		}
	}

	return (
		<div className="flex min-h-full flex-col">
			{/* Sticky section header — fixed chrome with scrolling content below (§17.3) */}
			<header className="sticky top-0 z-(--z-sticky) border-b border-border/80 bg-background/95 backdrop-blur-sm">
				<div className="mx-auto w-full max-w-4xl space-y-3 px-5 py-4 md:px-8">
					<nav
						aria-label={t('settings.breadcrumb.label')}
						className="flex flex-wrap items-center gap-1.5 text-xs text-muted-foreground"
					>
						<button
							type="button"
							onClick={() => setSettingsSection('general')}
							className="transition-colors hover:text-foreground"
						>
							{t('nav.settings')}
						</button>
						<ChevronRight className="size-3.5 shrink-0 opacity-60" aria-hidden />
						<span>{t(activeGroup.labelId)}</span>
						<ChevronRight className="size-3.5 shrink-0 opacity-60" aria-hidden />
						<span aria-current="page" className="font-medium text-foreground">
							{t(activeMeta.labelId)}
						</span>
					</nav>

					<div className="flex flex-wrap items-start justify-between gap-3">
						<div className="flex min-w-0 items-start gap-3">
							<span
								aria-hidden
								className="mt-0.5 flex size-9 shrink-0 items-center justify-center rounded-xl border border-border bg-surface-2 text-primary shadow-(--shadow-1)"
							>
								<ActiveIcon className="size-4" />
							</span>
							<div className="min-w-0">
								<h1 className="text-xl font-semibold tracking-tight text-foreground">
									{t(activeMeta.labelId)}
								</h1>
								<p className="mt-0.5 text-sm text-muted-foreground">{t(activeMeta.descriptionId)}</p>
							</div>
						</div>

						<div className="flex shrink-0 items-center gap-2">
							<Badge tone="outline">
								{mode === 'cloud' ? t('settings.general.mode.cloud') : t('settings.general.mode.selfhost')}
							</Badge>
							{isPreview ? <Badge tone="secondary">{t('shell.preview-badge')}</Badge> : null}
						</div>
					</div>

					{/* Mobile section switcher so all sections stay one tap away on narrow screens */}
					<div className="md:hidden">
						<Select
							value={activeSectionId}
							onValueChange={(val) => {
								if (isSettingsSection(val)) setSettingsSection(val)
							}}
						>
							<SelectTrigger aria-label={t('settings.mobile.section-label')}>
								<SelectValue />
							</SelectTrigger>
							<SelectContent>
								{visibleSections.map((section) => (
									<SelectItem key={section.id} value={section.id}>
										{t(section.labelId)}
									</SelectItem>
								))}
							</SelectContent>
						</Select>
					</div>
				</div>
			</header>

			<div className="mx-auto w-full max-w-4xl flex-1 space-y-6 px-5 py-6 md:px-8 md:py-8">
				{billingStatus === 'success' ? (
					<SettingsNotice
						tone="success"
						title={t('settings.billing.return-success-title')}
						onDismiss={onDismissBillingStatus}
					>
						{t('settings.billing.return-success-desc')}
					</SettingsNotice>
				) : billingStatus === 'cancel' ? (
					<SettingsNotice
						tone="warning"
						title={t('settings.billing.return-cancel-title')}
						onDismiss={onDismissBillingStatus}
					>
						{t('settings.billing.return-cancel-desc')}
					</SettingsNotice>
				) : null}

				{renderSectionPanel(activeSectionId)}
			</div>
		</div>
	)
}
