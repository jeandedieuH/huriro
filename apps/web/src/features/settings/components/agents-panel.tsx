import type { AgentPrincipalDto } from '@huriro/contracts'
import { AGENT_SCOPES, type AgentScope } from '@huriro/domain'
import { t } from '@huriro/i18n'
import { Bot, KeyRound, PlugZap, Trash2 } from 'lucide-react'
import { useEffect, useState } from 'react'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Checkbox } from '@/components/ui/checkbox'
import { Input } from '@/components/ui/input'
import type { AgentApiKeyDto, TaskApiBridge } from '@/lib/sync-bootstrap'
import { useWorkspace } from '@/lib/workspace'
import {
	CopyableSecretField,
	SettingsCard,
	SettingsCardBody,
	SettingsCardFooter,
	SettingsCardHeader,
	SettingsEmptyState,
	SettingsNotice,
	SettingsSkeleton
} from './settings-primitives'

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
	// Admin endpoints 403 for non-admins — surface a clear explanation rather than erroring.
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
		return <SettingsSkeleton rows={4} />
	}

	return (
		<div className="space-y-5">
			{error ? <SettingsNotice tone="danger">{error}</SettingsNotice> : null}

			<SettingsCard labelledBy="agents-settings-heading">
				<SettingsCardHeader
					headingId="agents-settings-heading"
					icon={<PlugZap className="size-4" />}
					title={t('settings.apps.title')}
					description={t('settings.apps.desc')}
					badge={
						<Badge tone="secondary" className="tnum">
							{apps.length}
						</Badge>
					}
				/>
				<SettingsCardBody>
					{apps.length === 0 ? (
						<SettingsEmptyState icon={<PlugZap className="size-4" />} message={t('settings.apps.empty')} />
					) : (
						<div className="space-y-2.5">
							{apps.map((app) => (
								<div
									key={app.id}
									className="flex flex-wrap items-center justify-between gap-3 rounded-lg border border-border bg-surface-2/40 p-3.5 text-xs"
								>
									<div className="min-w-0 space-y-1.5">
										<div className="flex flex-wrap items-center gap-2">
											<span className="text-sm font-semibold text-foreground">{app.name}</span>
											<Badge tone={app.status === 'active' ? 'success' : 'secondary'}>{app.status}</Badge>
										</div>
										<div className="flex flex-wrap items-center gap-1.5 text-muted-foreground">
											<span>{t('settings.apps.scopes')}:</span>
											{app.scopeCeiling.length === 0 ? (
												<span>—</span>
											) : (
												app.scopeCeiling.map((scope) => (
													<Badge key={scope} tone="outline" className="font-mono text-[11px]">
														{scope}
													</Badge>
												))
											)}
										</div>
										<p className="text-muted-foreground tnum">
											{t('settings.apps.last-active')}: {formatDate(app.lastActiveAt)}
										</p>
									</div>
									<Button
										size="sm"
										tone="outline"
										type="button"
										onClick={() => void handleDisconnectApp(app.id)}
									>
										{t('settings.apps.revoke')}
									</Button>
								</div>
							))}
						</div>
					)}
				</SettingsCardBody>
			</SettingsCard>

			{adminDenied ? (
				<SettingsNotice tone="info" title={t('settings.common.permission-title')}>
					{t('settings.agents.admin-only')}
				</SettingsNotice>
			) : (
				<>
					<AgentManagementSection api={api} agents={agents} setAgents={setAgents} setError={setError} />
					<ApiKeysSection
						api={api}
						keys={keys}
						setKeys={setKeys}
						setError={setError}
						revealedKey={revealedKey}
						setRevealedKey={setRevealedKey}
					/>
				</>
			)}
		</div>
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
		<SettingsCard labelledBy="agents-workspace-heading">
			<SettingsCardHeader
				headingId="agents-workspace-heading"
				icon={<Bot className="size-4" />}
				title={t('settings.agents.title')}
				description={t('settings.agents.desc')}
				badge={
					<Badge tone="secondary" className="tnum">
						{visible.length}
					</Badge>
				}
			/>
			<SettingsCardBody>
				{visible.length === 0 ? (
					<SettingsEmptyState icon={<Bot className="size-4" />} message={t('settings.agents.empty')} />
				) : (
					<div className="space-y-2.5">
						{visible.map((agent) => (
							<div
								key={agent.id}
								className="flex flex-wrap items-center justify-between gap-3 rounded-lg border border-border bg-surface-2/40 p-3.5 text-xs"
							>
								<div className="min-w-0 space-y-1.5">
									<div className="flex flex-wrap items-center gap-2">
										<span className="text-sm font-semibold text-foreground">{agent.name}</span>
										<Badge tone={agent.status === 'active' ? 'success' : 'secondary'}>{agent.status}</Badge>
										<Badge tone="outline">{agent.kind}</Badge>
									</div>
									<div className="flex flex-wrap gap-1">
										{agent.scopeCeiling.length === 0 ? (
											<span className="text-muted-foreground">—</span>
										) : (
											agent.scopeCeiling.map((scope) => (
												<Badge key={scope} tone="secondary" className="font-mono text-[11px]">
													{scope}
												</Badge>
											))
										)}
									</div>
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
			</SettingsCardBody>
		</SettingsCard>
	)
}

function ApiKeysSection({
	api,
	keys,
	setKeys,
	setError,
	revealedKey,
	setRevealedKey
}: {
	readonly api: TaskApiBridge
	readonly keys: AgentApiKeyDto[]
	readonly setKeys: (fn: (prev: AgentApiKeyDto[]) => AgentApiKeyDto[]) => void
	readonly setError: (msg: string | null) => void
	readonly revealedKey: string | null
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
		<SettingsCard labelledBy="api-keys-heading">
			<SettingsCardHeader
				headingId="api-keys-heading"
				icon={<KeyRound className="size-4" />}
				title={t('settings.api-keys.title')}
				description={t('settings.api-keys.desc')}
				badge={
					<Badge tone="secondary" className="tnum">
						{keys.length}
					</Badge>
				}
			/>
			<form onSubmit={(ev) => void handleCreate(ev)}>
				<SettingsCardBody>
					{revealedKey ? (
						<SettingsNotice
							tone="warning"
							title={t('settings.api-keys.reveal-once')}
							onDismiss={() => setRevealedKey(null)}
						>
							<CopyableSecretField value={revealedKey} />
						</SettingsNotice>
					) : null}

					<div className="grid gap-3 sm:grid-cols-2">
						<div className="space-y-1.5">
							<label htmlFor="api-key-name" className="text-xs font-medium text-foreground">
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
						<div className="space-y-1.5">
							<label htmlFor="api-key-expires" className="text-xs font-medium text-foreground">
								{t('settings.api-keys.expires')}
							</label>
							<Input
								id="api-key-expires"
								inputMode="numeric"
								className="font-mono tnum"
								value={expiresDays}
								onChange={(ev) => setExpiresDays(ev.target.value)}
								placeholder="90"
							/>
						</div>
					</div>

					<fieldset className="space-y-2">
						<legend className="text-xs font-medium text-foreground">{t('settings.api-keys.scopes')}</legend>
						<div className="grid gap-2 sm:grid-cols-2 md:grid-cols-3">
							{AGENT_SCOPES.map((scope) => (
								<label
									key={scope}
									htmlFor={`api-key-scope-${scope}`}
									className="flex cursor-pointer items-center gap-2 rounded-lg border border-border bg-surface-2/40 px-3 py-2 text-xs transition-colors hover:bg-accent/50"
								>
									<Checkbox
										id={`api-key-scope-${scope}`}
										checked={scopes.has(scope)}
										onCheckedChange={() => toggleScope(scope)}
									/>
									<span className="font-mono text-foreground">{scope}</span>
								</label>
							))}
						</div>
					</fieldset>

					{keys.length === 0 ? (
						<SettingsEmptyState
							icon={<KeyRound className="size-4" />}
							message={t('settings.api-keys.empty')}
						/>
					) : (
						<div className="space-y-2.5 border-t border-border/70 pt-4">
							{keys.map((key) => (
								<div
									key={key.id}
									className="flex flex-wrap items-center justify-between gap-3 rounded-lg border border-border bg-surface-2/40 p-3.5 text-xs"
								>
									<div className="min-w-0 space-y-1">
										<div className="flex flex-wrap items-center gap-2">
											<span className="text-sm font-semibold text-foreground">{key.name}</span>
											<Badge tone={key.status === 'active' ? 'success' : 'secondary'}>{key.status}</Badge>
										</div>
										<p className="font-mono text-muted-foreground">
											hrk_{key.prefix}_… {key.scopes.join(', ')}
										</p>
										<p className="text-muted-foreground tnum">
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
				</SettingsCardBody>

				<SettingsCardFooter className="justify-end">
					<Button size="sm" type="submit" loading={busy} disabled={scopes.size === 0}>
						{t('settings.api-keys.create')}
					</Button>
				</SettingsCardFooter>
			</form>
		</SettingsCard>
	)
}
