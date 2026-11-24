import type { GithubInstallationDto } from '@huriro/contracts'
import { t } from '@huriro/i18n'
import { useCollectionItems, useSyncEngine } from '@huriro/sync-client'
import { GitBranch, Trash2 } from 'lucide-react'
import { useEffect, useState } from 'react'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select'
import { useWorkspace } from '@/lib/workspace'
import {
	SettingsCard,
	SettingsCardBody,
	SettingsCardFooter,
	SettingsCardHeader,
	SettingsEmptyState,
	SettingsNotice,
	SettingsSkeleton
} from './settings-primitives'

export function GithubSettingsPanel() {
	const { api } = useWorkspace()
	const engine = useSyncEngine()
	const projects = useCollectionItems(engine.collections.projects)

	const [installations, setInstallations] = useState<GithubInstallationDto[]>([])
	const [repoFullName, setRepoFullName] = useState('')
	const [accountLogin, setAccountLogin] = useState('')
	const [installationId, setInstallationId] = useState('1001')
	const [projectId, setProjectId] = useState('')
	const [webhookSecret, setWebhookSecret] = useState('')
	const [loading, setLoading] = useState(true)
	const [busy, setBusy] = useState(false)
	const [error, setError] = useState<string | null>(null)

	useEffect(() => {
		if (!projectId && projects[0]?.id) setProjectId(projects[0].id)
	}, [projectId, projects])

	useEffect(() => {
		let cancelled = false
		void api
			.listGithubInstallations()
			.then((list) => {
				if (cancelled) return
				setInstallations(list)
				setLoading(false)
			})
			.catch((err) => {
				if (cancelled) return
				setError(err instanceof Error ? err.message : 'Failed to load GitHub installations')
				setLoading(false)
			})
		return () => {
			cancelled = true
		}
	}, [api])

	async function handleConnect(ev: React.FormEvent) {
		ev.preventDefault()
		const instNum = Number.parseInt(installationId, 10)
		if (
			!repoFullName.trim() ||
			!accountLogin.trim() ||
			!projectId ||
			webhookSecret.length < 8 ||
			!Number.isFinite(instNum) ||
			busy
		) {
			return
		}
		setBusy(true)
		setError(null)
		try {
			const created = await api.createGithubInstallation({
				installationId: instNum,
				accountLogin: accountLogin.trim(),
				repoFullName: repoFullName.trim(),
				projectId,
				webhookSecret,
				syncEnabled: true
			})
			setInstallations((prev) => [created, ...prev])
			setRepoFullName('')
			setAccountLogin('')
			setWebhookSecret('')
		} catch (err) {
			setError(err instanceof Error ? err.message : 'Failed to connect repository')
		} finally {
			setBusy(false)
		}
	}

	async function handleToggle(inst: GithubInstallationDto) {
		setError(null)
		try {
			const updated = await api.updateGithubInstallation(inst.id, {
				syncEnabled: !inst.syncEnabled,
				version: inst.version
			})
			setInstallations((prev) => prev.map((i) => (i.id === inst.id ? updated : i)))
		} catch (err) {
			setError(err instanceof Error ? err.message : 'Failed to toggle GitHub sync')
		}
	}

	async function handleDelete(id: string) {
		setError(null)
		try {
			await api.deleteGithubInstallation(id)
			setInstallations((prev) => prev.filter((i) => i.id !== id))
		} catch (err) {
			setError(err instanceof Error ? err.message : 'Failed to disconnect repository')
		}
	}

	if (loading) {
		return <SettingsSkeleton rows={3} />
	}

	return (
		<div className="space-y-5">
			<SettingsCard labelledBy="github-settings-heading">
				<SettingsCardHeader
					headingId="github-settings-heading"
					icon={<GitBranch className="size-4" />}
					title={t('settings.github.title')}
					description={t('settings.github.desc')}
				/>
				<form onSubmit={(ev) => void handleConnect(ev)}>
					<SettingsCardBody>
						<div className="grid gap-3 sm:grid-cols-2">
							<div className="space-y-1.5">
								<label htmlFor="gh-repo" className="text-xs font-medium text-foreground">
									{t('settings.github.repo')}
								</label>
								<Input
									id="gh-repo"
									placeholder="acme/huriro"
									value={repoFullName}
									onChange={(ev) => setRepoFullName(ev.target.value)}
									required
								/>
							</div>
							<div className="space-y-1.5">
								<label htmlFor="gh-account" className="text-xs font-medium text-foreground">
									{t('settings.github.account')}
								</label>
								<Input
									id="gh-account"
									placeholder="acme"
									value={accountLogin}
									onChange={(ev) => setAccountLogin(ev.target.value)}
									required
								/>
							</div>
							<div className="space-y-1.5">
								<label htmlFor="gh-install-id" className="text-xs font-medium text-foreground">
									{t('settings.github.installation-id')}
								</label>
								<Input
									id="gh-install-id"
									type="number"
									min={1}
									className="font-mono tnum"
									value={installationId}
									onChange={(ev) => setInstallationId(ev.target.value)}
									required
								/>
							</div>
							<div className="space-y-1.5">
								<label htmlFor="gh-project" className="text-xs font-medium text-foreground">
									{t('settings.github.project')}
								</label>
								<Select value={projectId} onValueChange={setProjectId}>
									<SelectTrigger id="gh-project" aria-label={t('settings.github.project')}>
										<SelectValue />
									</SelectTrigger>
									<SelectContent>
										{projects.map((p) => (
											<SelectItem key={p.id} value={p.id}>
												{p.key} · {p.name}
											</SelectItem>
										))}
									</SelectContent>
								</Select>
							</div>
							<div className="space-y-1.5 sm:col-span-2">
								<label htmlFor="gh-secret" className="text-xs font-medium text-foreground">
									{t('settings.github.secret')}
								</label>
								<Input
									id="gh-secret"
									type="password"
									value={webhookSecret}
									onChange={(ev) => setWebhookSecret(ev.target.value)}
									minLength={8}
									required
								/>
							</div>
						</div>

						{error ? <SettingsNotice tone="danger">{error}</SettingsNotice> : null}
					</SettingsCardBody>
					<SettingsCardFooter className="justify-end">
						<Button size="sm" type="submit" loading={busy}>
							{t('settings.github.connect')}
						</Button>
					</SettingsCardFooter>
				</form>
			</SettingsCard>

			<SettingsCard labelledBy="github-connected-heading">
				<SettingsCardHeader
					headingId="github-connected-heading"
					title={t('settings.github.connected-title')}
					badge={
						<Badge tone="secondary" className="tnum">
							{installations.length}
						</Badge>
					}
				/>
				<SettingsCardBody>
					{installations.length === 0 ? (
						<SettingsEmptyState
							icon={<GitBranch className="size-4" />}
							message={t('settings.github.empty')}
						/>
					) : (
						<div className="space-y-2.5">
							{installations.map((inst) => {
								const linkedProject = projects.find((p) => p.id === inst.projectId)
								return (
									<div
										key={inst.id}
										className="flex flex-wrap items-center justify-between gap-3 rounded-lg border border-border bg-surface-2/40 px-4 py-3 text-xs"
									>
										<div className="min-w-0 space-y-1">
											<div className="flex flex-wrap items-center gap-2">
												<span className="font-mono text-sm font-semibold text-foreground">
													{inst.repoFullName}
												</span>
												<Badge tone={inst.syncEnabled ? 'success' : 'secondary'}>
													{inst.syncEnabled ? t('settings.common.active') : t('settings.common.paused')}
												</Badge>
												<Badge tone="outline" className="font-mono tnum">
													#{inst.installationId}
												</Badge>
											</div>
											<p className="text-muted-foreground">
												{inst.accountLogin}
												{linkedProject ? ` · ${linkedProject.key} · ${linkedProject.name}` : ''}
											</p>
										</div>
										<div className="flex items-center gap-1.5">
											<Button size="sm" tone="outline" type="button" onClick={() => void handleToggle(inst)}>
												{inst.syncEnabled ? t('settings.github.pause') : t('settings.github.enable')}
											</Button>
											<Button
												size="icon"
												tone="ghost"
												type="button"
												aria-label={t('settings.github.delete')}
												onClick={() => void handleDelete(inst.id)}
											>
												<Trash2 className="size-3.5 text-destructive" aria-hidden />
											</Button>
										</div>
									</div>
								)
							})}
						</div>
					)}
				</SettingsCardBody>
			</SettingsCard>
		</div>
	)
}
