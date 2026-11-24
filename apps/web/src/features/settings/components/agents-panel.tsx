import type { AgentPrincipalDto } from '@huriro/contracts'
import { AGENT_SCOPES, type AgentScope } from '@huriro/domain'
import { t } from '@huriro/i18n'
import { Bot, KeyRound, PlugZap, Trash2 } from 'lucide-react'
import { useEffect, useState } from 'react'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Checkbox } from '@/components/ui/checkbox'
import { Input } from '@/components/ui/input'
import { Skeleton } from '@/components/ui/skeleton'
import type { AgentApiKeyDto, TaskApiBridge } from '@/lib/sync-bootstrap'
import { useWorkspace } from '@/lib/workspace'

function formatDate(iso: string | null): string {
	if (!iso) return '—'
	return new Date(iso).toLocaleDateString()
}

/**
 * "Agents & API keys" settings section (§13.1): your own connected apps,
 * workspace agent principals (agent.manage), and hrk_ API keys.
 */
export function AgentsSettingsPanel() {
	const { api } = useWorkspace()

	const [apps, setApps] = useState<AgentPrincipalDto[]>([])
	const [agents, setAgents] = useState<AgentPrincipalDto[]>([])
	const [keys, setKeys] = useState<AgentApiKeyDto[]>([])
	const [revealedKey, setRevealedKey] = useState<string | null>(null)
	// Admin endpoints 403 for non-admins — hide those sections rather than error.
	const [adminDenied, setAdminDenied] = useState(false)
	const [loading, setLoading] = useState(true)
	const [error, setError] = useState<string | null>(null)

	useEffect(() => {
		let cancelled = false
		Promise.all([
			api.listConnectedApps().catch(() => null),
			api.listAgents().catch(() => null),
			api.listApiKeys().catch(() => null)
		]).then(([appsRes, agentsRes, keysRes]) => {
			if (cancelled) return
			if (appsRes) setApps(appsRes)
			if (agentsRes === null && keysRes === null) {
				// Both admin endpoints failed → agent.manage not held.
				setAdminDenied(true)
			} else {
				setAgents(agentsRes ?? [])
				setKeys(keysRes ?? [])
			}
			setLoading(false)
		})
		return () => {
			cancelled = true
		}
	}, [api])

	async function handleDisconnectApp(id: string) {
		setError(null)
		try {
			await api.revokeConnectedApp(id)
			setApps((prev) => prev.filter((a) => a.id !== id))
		} catch (err) {
			setError(err instanceof Error ? err.message : 'Failed to disconnect app')
		}
	}

	if (loading) {
		return (
			<div className="space-y-3 rounded-lg border border-border bg-card p-4">
				<Skeleton className="h-5 w-48" />
				<Skeleton className="h-20 w-full" />
			</div>
		)
	}

	return (
		<section
			aria-labelledby="agents-settings-heading"
			className="space-y-5 rounded-lg border border-border bg-card p-4"
		>
			<h2 id="agents-settings-heading" className="flex items-center gap-2 text-sm font-semibold">
				<PlugZap className="size-4 text-muted-foreground" aria-hidden />
				<span>{t('settings.apps.title')}</span>
			</h2>
			<p className="-mt-3 text-xs text-muted-foreground">{t('settings.apps.desc')}</p>

			{error ? (
				<p role="alert" className="text-xs text-destructive">
					{error}
				</p>
			) : null}

			{apps.length === 0 ? (
				<p className="text-xs text-muted-foreground">{t('settings.apps.empty')}</p>
			) : (
				<div className="space-y-2">
					{apps.map((app) => (
						<div
							key={app.id}
							className="flex flex-wrap items-center justify-between gap-2 rounded-md border border-border bg-muted/30 p-3 text-xs"
						>
							<div className="min-w-0">
								<div className="flex items-center gap-2">
									<span className="font-semibold">{app.name}</span>
									<Badge tone={app.status === 'active' ? 'default' : 'secondary'}>{app.status}</Badge>
								</div>
								<p className="mt-0.5 text-muted-foreground">
									{t('settings.apps.scopes')}: {app.scopeCeiling.join(', ') || '—'} ·{' '}
									{t('settings.apps.last-active')}: {formatDate(app.lastActiveAt)}
								</p>
							</div>
							<Button size="sm" tone="outline" type="button" onClick={() => void handleDisconnectApp(app.id)}>
								{t('settings.apps.revoke')}
							</Button>
						</div>
					))}
				</div>
			)}

			{adminDenied ? (
				<p className="text-xs text-muted-foreground">{t('settings.agents.admin-only')}</p>
			) : (
				<>
					<AgentManagementSection api={api} agents={agents} setAgents={setAgents} setError={setError} />
					<ApiKeysSection
						api={api}
						keys={keys}
						setKeys={setKeys}
						setError={setError}
						setRevealedKey={setRevealedKey}
					/>
					{revealedKey ? (
						<div
							role="status"
							className="rounded-md border border-(--warning)/40 bg-(--warning)/10 p-3 text-xs"
						>
							<p className="font-semibold text-foreground">{t('settings.api-keys.reveal-once')}</p>
							<code className="mt-1 block break-all font-mono text-foreground">{revealedKey}</code>
						</div>
					) : null}
				</>
			)}
		</section>
	)
}

function AgentManagementSection({
	api,
	agents,
	setAgents,
	setError
}: {
	readonly api: TaskApiBridge
	readonly agents: AgentPrincipalDto[]
	readonly setAgents: (fn: (prev: AgentPrincipalDto[]) => AgentPrincipalDto[]) => void
	readonly setError: (msg: string | null) => void
}) {
	async function toggleStatus(agent: AgentPrincipalDto) {
		setError(null)
		try {
			const next = agent.status === 'active' ? 'suspended' : 'active'
			const updated = await api.updateAgent(agent.id, { status: next })
			setAgents((prev) => prev.map((a) => (a.id === agent.id ? updated : a)))
		} catch (err) {
			setError(err instanceof Error ? err.message : 'Failed to update agent')
		}
	}

	async function revoke(agent: AgentPrincipalDto) {
		setError(null)
		try {
			await api.revokeAgent(agent.id)
			setAgents((prev) => prev.filter((a) => a.id !== agent.id))
		} catch (err) {
			setError(err instanceof Error ? err.message : 'Failed to revoke agent')
		}
	}

	const visible = agents.filter((a) => a.status !== 'revoked')

	return (
		<div className="space-y-3 border-t border-border pt-4">
			<div>
				<h3 className="flex items-center gap-2 text-sm font-semibold">
					<Bot className="size-4 text-muted-foreground" aria-hidden />
					<span>{t('settings.agents.title')}</span>
				</h3>
				<p className="mt-0.5 text-xs text-muted-foreground">{t('settings.agents.desc')}</p>
			</div>
			{visible.length === 0 ? (
				<p className="text-xs text-muted-foreground">{t('settings.agents.empty')}</p>
			) : (
				<div className="space-y-2">
					{visible.map((agent) => (
						<div
							key={agent.id}
							className="flex flex-wrap items-center justify-between gap-2 rounded-md border border-border bg-muted/30 p-3 text-xs"
						>
							<div className="min-w-0">
								<div className="flex items-center gap-2">
									<span className="font-semibold">{agent.name}</span>
									<Badge tone={agent.status === 'active' ? 'default' : 'secondary'}>{agent.status}</Badge>
									<Badge tone="secondary">{agent.kind}</Badge>
								</div>
								<p className="mt-0.5 font-mono text-muted-foreground">
									{agent.scopeCeiling.join(', ') || '—'}
								</p>
							</div>
							<div className="flex flex-wrap items-center gap-1.5">
								<Button size="sm" tone="outline" type="button" onClick={() => void toggleStatus(agent)}>
									{agent.status === 'active' ? t('settings.agents.suspend') : t('settings.agents.resume')}
								</Button>
								<Button size="sm" tone="outline" type="button" onClick={() => void revoke(agent)}>
									{t('settings.agents.revoke')}
								</Button>
							</div>
						</div>
					))}
				</div>
			)}
		</div>
	)
}

function ApiKeysSection({
	api,
	keys,
	setKeys,
	setError,
	setRevealedKey
}: {
	readonly api: TaskApiBridge
	readonly keys: AgentApiKeyDto[]
	readonly setKeys: (fn: (prev: AgentApiKeyDto[]) => AgentApiKeyDto[]) => void
	readonly setError: (msg: string | null) => void
	readonly setRevealedKey: (key: string | null) => void
}) {
	const [name, setName] = useState('')
	const [expiresDays, setExpiresDays] = useState('')
	const [scopes, setScopes] = useState<ReadonlySet<AgentScope>>(new Set(['tasks.read']))
	const [busy, setBusy] = useState(false)

	function toggleScope(scope: AgentScope) {
		setScopes((prev) => {
			const next = new Set(prev)
			if (next.has(scope)) next.delete(scope)
			else next.add(scope)
			return next
		})
	}

	async function handleCreate(ev: React.FormEvent) {
		ev.preventDefault()
		if (!name.trim() || scopes.size === 0 || busy) return
		setBusy(true)
		setError(null)
		try {
			const days = expiresDays.trim() === '' ? undefined : Number(expiresDays)
			const created = await api.createApiKey({
				name: name.trim(),
				scopes: [...scopes],
				...(days !== undefined && Number.isFinite(days) && days > 0
					? { expiresInDays: Math.floor(days) }
					: {})
			})
			setKeys((prev) => [created, ...prev])
			setRevealedKey(created.key)
			setName('')
			setExpiresDays('')
		} catch (err) {
			setError(err instanceof Error ? err.message : 'Failed to create API key')
		} finally {
			setBusy(false)
		}
	}

	async function handleRevoke(id: string) {
		setError(null)
		try {
			await api.revokeApiKey(id)
			setKeys((prev) => prev.filter((k) => k.id !== id))
		} catch (err) {
			setError(err instanceof Error ? err.message : 'Failed to revoke API key')
		}
	}

	return (
		<div className="space-y-3 border-t border-border pt-4">
			<div>
				<h3 className="flex items-center gap-2 text-sm font-semibold">
					<KeyRound className="size-4 text-muted-foreground" aria-hidden />
					<span>{t('settings.api-keys.title')}</span>
				</h3>
				<p className="mt-0.5 text-xs text-muted-foreground">{t('settings.api-keys.desc')}</p>
			</div>

			<form onSubmit={(ev) => void handleCreate(ev)} className="space-y-3">
				<div className="grid gap-2 sm:grid-cols-2">
					<div className="space-y-1">
						<label htmlFor="api-key-name" className="text-xs font-medium">
							{t('settings.api-keys.name')}
						</label>
						<Input
							id="api-key-name"
							value={name}
							onChange={(ev) => setName(ev.target.value)}
							placeholder="CI deploy bot"
							required
						/>
					</div>
					<div className="space-y-1">
						<label htmlFor="api-key-expires" className="text-xs font-medium">
							{t('settings.api-keys.expires')}
						</label>
						<Input
							id="api-key-expires"
							inputMode="numeric"
							value={expiresDays}
							onChange={(ev) => setExpiresDays(ev.target.value)}
							placeholder="90"
						/>
					</div>
				</div>
				<fieldset className="space-y-1.5">
					<legend className="text-xs font-medium">{t('settings.api-keys.scopes')}</legend>
					<div className="flex flex-wrap gap-x-4 gap-y-1.5">
						{AGENT_SCOPES.map((scope) => (
							<div key={scope} className="flex items-center gap-1.5">
								<Checkbox
									id={`api-key-scope-${scope}`}
									checked={scopes.has(scope)}
									onCheckedChange={() => toggleScope(scope)}
								/>
								<label htmlFor={`api-key-scope-${scope}`} className="font-mono text-xs">
									{scope}
								</label>
							</div>
						))}
					</div>
				</fieldset>
				<Button size="sm" type="submit" loading={busy} disabled={scopes.size === 0}>
					{t('settings.api-keys.create')}
				</Button>
			</form>

			{keys.length === 0 ? (
				<p className="text-xs text-muted-foreground">{t('settings.api-keys.empty')}</p>
			) : (
				<div className="space-y-2">
					{keys.map((key) => (
						<div
							key={key.id}
							className="flex flex-wrap items-center justify-between gap-2 rounded-md border border-border bg-muted/30 p-3 text-xs"
						>
							<div className="min-w-0">
								<div className="flex items-center gap-2">
									<span className="font-semibold">{key.name}</span>
									<Badge tone={key.status === 'active' ? 'default' : 'secondary'}>{key.status}</Badge>
								</div>
								<p className="mt-0.5 font-mono text-muted-foreground">
									hrk_{key.prefix}_… {key.scopes.join(', ')}
								</p>
								<p className="text-muted-foreground">
									{t('settings.api-keys.last-used')}: {formatDate(key.lastUsedAt)} ·{' '}
									{t('settings.api-keys.expires-at')}:{' '}
									{key.expiresAt ? formatDate(key.expiresAt) : t('settings.api-keys.never')}
								</p>
							</div>
							{key.status === 'active' ? (
								<Button
									size="icon"
									tone="ghost"
									type="button"
									aria-label={t('settings.api-keys.revoke')}
									onClick={() => void handleRevoke(key.id)}
								>
									<Trash2 className="size-3.5 text-destructive" aria-hidden />
								</Button>
							) : null}
						</div>
					))}
				</div>
			)}
		</div>
	)
}
