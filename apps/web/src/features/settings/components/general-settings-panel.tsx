import { t } from '@huriro/i18n'
import { useCollectionItems, useSyncEngine, useSyncStatus } from '@huriro/sync-client'
import {
	ArrowRight,
	Bell,
	CheckCircle2,
	Cloud,
	CloudOff,
	Palette,
	RefreshCw,
	Server,
	ShieldCheck,
	SlidersHorizontal,
	Users
} from 'lucide-react'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { useWorkspace } from '@/lib/workspace'
import { type SettingsSection, useUiStore } from '@/stores/ui-store'
import {
	CopyableSecretField,
	SettingsCard,
	SettingsCardBody,
	SettingsCardHeader,
	SettingsRow
} from './settings-primitives'

function getWorkspaceMonogram(name: string): string {
	const parts = name.trim().split(/\s+/).filter(Boolean)
	if (parts.length >= 2) {
		return `${parts[0]?.[0] ?? ''}${parts[1]?.[0] ?? ''}`.toUpperCase()
	}
	return (parts[0] ?? 'HU').slice(0, 2).toUpperCase()
}

export function GeneralSettingsPanel() {
	const { workspaceName, userDisplayName, isPreview, mode } = useWorkspace()
	const engine = useSyncEngine()
	const syncStatus = useSyncStatus()
	const setSettingsSection = useUiStore((s) => s.setSettingsSection)

	const projects = useCollectionItems(engine.collections.projects)
	const issues = useCollectionItems(engine.collections.issues)
	const docPages = useCollectionItems(engine.collections.docPages)

	const activeProjectCount = projects.filter((p) => p.archivedAt === null).length
	const openIssueCount = issues.filter((i) => i.deletedAt === null && i.closedAt === null).length
	const activeDocCount = docPages.filter((d) => d.archivedAt === null && !d.isTemplate).length

	const quickLinks: readonly {
		readonly id: SettingsSection
		readonly label: string
		readonly desc: string
		readonly icon: typeof Users
	}[] = [
		{
			id: 'members',
			label: t('settings.sidebar.members'),
			desc: t('settings.desc.members'),
			icon: Users
		},
		{
			id: 'appearance',
			label: t('settings.sidebar.appearance'),
			desc: t('settings.desc.appearance'),
			icon: Palette
		},
		{
			id: 'notifications',
			label: t('settings.sidebar.notifications'),
			desc: t('settings.desc.notifications'),
			icon: Bell
		},
		{
			id: 'governance',
			label: t('settings.sidebar.governance'),
			desc: t('settings.desc.governance'),
			icon: ShieldCheck
		}
	]

	return (
		<div className="space-y-5">
			<SettingsCard labelledBy="general-workspace-heading">
				<SettingsCardHeader
					headingId="general-workspace-heading"
					icon={<SlidersHorizontal className="size-4" />}
					title={t('settings.general.workspace-card')}
					description={workspaceName}
					action={
						<div className="flex items-center gap-1.5">
							<Badge tone="outline">
								{mode === 'cloud' ? (
									<>
										<Cloud className="size-3" aria-hidden />
										<span>{t('settings.general.mode.cloud')}</span>
									</>
								) : (
									<>
										<Server className="size-3" aria-hidden />
										<span>{t('settings.general.mode.selfhost')}</span>
									</>
								)}
							</Badge>
							{isPreview ? <Badge tone="secondary">{t('shell.preview-badge')}</Badge> : null}
						</div>
					}
				/>
				<SettingsCardBody>
					<div className="flex flex-wrap items-center gap-4 rounded-lg border border-border bg-surface-2/40 p-4">
						<div
							aria-hidden
							className="flex size-12 shrink-0 items-center justify-center rounded-xl bg-primary text-sm font-semibold text-primary-foreground shadow-(--shadow-1)"
						>
							{getWorkspaceMonogram(workspaceName)}
						</div>
						<div className="min-w-0 flex-1 space-y-1">
							<p className="truncate text-base font-semibold text-foreground">{workspaceName}</p>
							<p className="text-xs text-muted-foreground">{t('settings.general.workspace-id')}</p>
							<CopyableSecretField value={engine.workspaceId} label={t('settings.general.workspace-id')} />
						</div>
					</div>

					<div className="grid gap-3 sm:grid-cols-3">
						<div className="rounded-lg border border-border bg-surface-2/40 p-3.5">
							<p className="text-xs text-muted-foreground">{t('settings.general.stats.projects')}</p>
							<p className="mt-1 text-xl font-semibold text-foreground tnum">{activeProjectCount}</p>
						</div>
						<div className="rounded-lg border border-border bg-surface-2/40 p-3.5">
							<p className="text-xs text-muted-foreground">{t('settings.general.stats.issues')}</p>
							<p className="mt-1 text-xl font-semibold text-foreground tnum">{openIssueCount}</p>
						</div>
						<div className="rounded-lg border border-border bg-surface-2/40 p-3.5">
							<p className="text-xs text-muted-foreground">{t('settings.general.stats.docs')}</p>
							<p className="mt-1 text-xl font-semibold text-foreground tnum">{activeDocCount}</p>
						</div>
					</div>
				</SettingsCardBody>
			</SettingsCard>

			<SettingsCard labelledBy="general-session-heading">
				<SettingsCardHeader
					headingId="general-session-heading"
					title={t('settings.general.session-card')}
					action={
						syncStatus.online ? (
							<Button
								type="button"
								size="sm"
								tone="outline"
								onClick={() => void engine.flushOutbox({ force: true }).then(() => engine.syncNow())}
							>
								<RefreshCw className="size-3.5" aria-hidden />
								<span>{t('sync.sync-now')}</span>
							</Button>
						) : null
					}
				/>
				<SettingsCardBody className="divide-y divide-border/70">
					<SettingsRow label={t('settings.general.signed-in-as')}>
						<span className="text-sm font-medium text-foreground">{userDisplayName}</span>
					</SettingsRow>
					<SettingsRow label={t('settings.general.sync-status')}>
						{!syncStatus.online ? (
							<Badge tone="warning">
								<CloudOff className="size-3" aria-hidden />
								<span>{t('sync.offline')}</span>
							</Badge>
						) : syncStatus.syncing ? (
							<Badge tone="info">
								<RefreshCw className="size-3 animate-spin" aria-hidden />
								<span>{t('sync.syncing')}</span>
							</Badge>
						) : (
							<Badge tone="success">
								<CheckCircle2 className="size-3" aria-hidden />
								<span>{t('sync.online')}</span>
							</Badge>
						)}
					</SettingsRow>
					<SettingsRow label={t('settings.general.storage-mode')}>
						<Badge tone="outline">{syncStatus.storageMode.toUpperCase()}</Badge>
					</SettingsRow>
					<SettingsRow label={t('settings.general.cursor')}>
						<span className="font-mono text-xs text-foreground tnum">{syncStatus.cursor}</span>
					</SettingsRow>
					<SettingsRow label={t('settings.general.pending-changes')}>
						<Badge tone={syncStatus.pendingCount > 0 ? 'warning' : 'secondary'} className="tnum">
							{syncStatus.pendingCount}
						</Badge>
					</SettingsRow>
				</SettingsCardBody>
			</SettingsCard>

			<SettingsCard labelledBy="general-quick-links-heading">
				<SettingsCardHeader
					headingId="general-quick-links-heading"
					title={t('settings.general.quick-links')}
				/>
				<SettingsCardBody>
					<div className="grid gap-3 sm:grid-cols-2">
						{quickLinks.map((item) => {
							const Icon = item.icon
							return (
								<button
									key={item.id}
									type="button"
									onClick={() => setSettingsSection(item.id)}
									className="group flex items-start justify-between gap-3 rounded-xl border border-border bg-surface-2/40 p-3.5 text-left transition-colors duration-(--motion-duration-fast) hover:border-primary/40 hover:bg-accent/50"
								>
									<div className="flex min-w-0 items-start gap-3">
										<span
											aria-hidden
											className="mt-0.5 flex size-8 shrink-0 items-center justify-center rounded-lg border border-border bg-card text-muted-foreground transition-colors group-hover:text-primary"
										>
											<Icon className="size-4" />
										</span>
										<div className="min-w-0">
											<p className="text-sm font-medium text-foreground">{item.label}</p>
											<p className="mt-0.5 line-clamp-2 text-xs text-muted-foreground">{item.desc}</p>
										</div>
									</div>
									<ArrowRight
										className="mt-1 size-4 shrink-0 text-muted-foreground transition-transform group-hover:translate-x-0.5 group-hover:text-foreground"
										aria-hidden
									/>
								</button>
							)
						})}
					</div>
				</SettingsCardBody>
			</SettingsCard>
		</div>
	)
}
