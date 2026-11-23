import type { GithubInstallationDto } from '@huriro/contracts'
import { t } from '@huriro/i18n'
import { useCollectionItems, useSyncEngine } from '@huriro/sync-client'
import { GitBranch, Trash2 } from 'lucide-react'
import { useEffect, useState } from 'react'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select'
import { Skeleton } from '@/components/ui/skeleton'
import { useWorkspace } from '@/lib/workspace'

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
		return (
			<div className="space-y-3 rounded-lg border border-border bg-card p-4">
				<Skeleton className="h-5 w-48" />
				<Skeleton className="h-24 w-full" />
			</div>
		)
	}

	return (
		<section
			aria-labelledby="github-settings-heading"
			className="space-y-4 rounded-lg border border-border bg-card p-4"
		>
			<div>
				<h2 id="github-settings-heading" className="flex items-center gap-2 text-sm font-semibold">
					<GitBranch className="size-4 text-muted-foreground" aria-hidden />
					<span>{t('settings.github.title')}</span>
				</h2>
				<p className="mt-0.5 text-xs text-muted-foreground">{t('settings.github.desc')}</p>
			</div>

			<form onSubmit={(ev) => void handleConnect(ev)} className="grid gap-2 sm:grid-cols-2">
				<div className="space-y-1">
					<label htmlFor="gh-repo" className="text-xs font-medium">
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
				<div className="space-y-1">
					<label htmlFor="gh-account" className="text-xs font-medium">
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
				<div className="space-y-1">
					<label htmlFor="gh-install-id" className="text-xs font-medium">
						{t('settings.github.installation-id')}
					</label>
					<Input
						id="gh-install-id"
						type="number"
						min={1}
						value={installationId}
						onChange={(ev) => setInstallationId(ev.target.value)}
						required
					/>
				</div>
				<div className="space-y-1">
					<label htmlFor="gh-project" className="text-xs font-medium">
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
				<div className="space-y-1 sm:col-span-2">
					<label htmlFor="gh-secret" className="text-xs font-medium">
						{t('settings.github.secret')}
					</label>
					<div className="flex gap-2">
						<Input
							id="gh-secret"
							type="password"
							value={webhookSecret}
							onChange={(ev) => setWebhookSecret(ev.target.value)}
							minLength={8}
							required
						/>
						<Button size="sm" type="submit" loading={busy}>
							{t('settings.github.connect')}
						</Button>
					</div>
				</div>
			</form>

			{error ? (
				<p role="alert" className="text-xs text-destructive">
					{error}
				</p>
			) : null}

			{installations.length === 0 ? (
				<p className="text-xs text-muted-foreground">{t('settings.github.empty')}</p>
			) : (
				<div className="space-y-2">
					{installations.map((inst) => (
						<div
							key={inst.id}
							className="flex flex-wrap items-center justify-between gap-2 rounded-md border border-border bg-muted/30 px-3 py-2 text-xs"
						>
							<div>
								<div className="flex items-center gap-2">
									<span className="font-mono font-semibold">{inst.repoFullName}</span>
									<Badge tone={inst.syncEnabled ? 'default' : 'secondary'}>#{inst.installationId}</Badge>
								</div>
								<p className="text-muted-foreground">{inst.accountLogin}</p>
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
					))}
				</div>
			)}
		</section>
	)
}
