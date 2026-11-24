import type { AiProviderDto, AiProviderKind } from '@huriro/contracts'
import { t } from '@huriro/i18n'
import { Cpu, Sparkles } from 'lucide-react'
import { useEffect, useState } from 'react'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Checkbox } from '@/components/ui/checkbox'
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
	SettingsRow,
	SettingsSkeleton
} from './settings-primitives'

/**
 * AI settings (§11.3): the workspace off-by-default flag, prompt-tracing
 * opt-in, and BYO provider configuration. Provider API keys are write-only —
 * the API returns `hasApiKey`, never the secret.
 */
export function AiSettingsPanel() {
	const { api } = useWorkspace()

	const [aiEnabled, setAiEnabled] = useState(false)
	const [tracePrompts, setTracePrompts] = useState(false)
	const [providers, setProviders] = useState<AiProviderDto[]>([])

	const [kind, setKind] = useState<AiProviderKind>('openai_compatible')
	const [name, setName] = useState('')
	const [baseUrl, setBaseUrl] = useState('')
	const [apiKey, setApiKey] = useState('')
	const [chatModel, setChatModel] = useState('')
	const [embeddingModel, setEmbeddingModel] = useState('')

	const [loading, setLoading] = useState(true)
	const [denied, setDenied] = useState(false)
	const [busy, setBusy] = useState(false)
	const [error, setError] = useState<string | null>(null)

	useEffect(() => {
		let cancelled = false
		void api
			.getAiSettings()
			.then((res) => {
				if (cancelled) return
				setAiEnabled(res.aiEnabled)
				setTracePrompts(res.aiTracePrompts)
				setProviders(res.providers)
				setLoading(false)
			})
			.catch(() => {
				if (cancelled) return
				setDenied(true)
				setLoading(false)
			})
		return () => {
			cancelled = true
		}
	}, [api])

	async function patchSettings(body: { aiEnabled?: boolean; aiTracePrompts?: boolean }) {
		setError(null)
		try {
			const res = await api.updateAiSettings(body)
			setAiEnabled(res.aiEnabled)
			setTracePrompts(res.aiTracePrompts)
		} catch (err) {
			setError(err instanceof Error ? err.message : 'Failed to update AI settings')
		}
	}

	async function handleSaveProvider(ev: React.FormEvent) {
		ev.preventDefault()
		if (!name.trim() || !baseUrl.trim() || busy) return
		setBusy(true)
		setError(null)
		try {
			const saved = await api.upsertAiProvider({
				kind,
				name: name.trim(),
				baseUrl: baseUrl.trim(),
				...(apiKey.trim() ? { apiKey: apiKey.trim() } : {}),
				...(chatModel.trim() ? { chatModel: chatModel.trim() } : {}),
				...(embeddingModel.trim() ? { embeddingModel: embeddingModel.trim() } : {})
			})
			setProviders((prev) => [...prev.filter((p) => p.id !== saved.id && p.name !== saved.name), saved])
			setName('')
			setBaseUrl('')
			setApiKey('')
			setChatModel('')
			setEmbeddingModel('')
		} catch (err) {
			setError(err instanceof Error ? err.message : 'Failed to save provider')
		} finally {
			setBusy(false)
		}
	}

	if (loading) {
		return <SettingsSkeleton rows={3} />
	}

	if (denied) {
		return (
			<SettingsCard labelledBy="ai-settings-heading">
				<SettingsCardHeader
					headingId="ai-settings-heading"
					icon={<Sparkles className="size-4" />}
					title={t('settings.ai.title')}
					description={t('settings.ai.desc')}
				/>
				<SettingsCardBody>
					<SettingsNotice tone="info" title={t('settings.common.permission-title')}>
						{t('settings.ai.denied')}
					</SettingsNotice>
				</SettingsCardBody>
			</SettingsCard>
		)
	}

	return (
		<div className="space-y-5">
			<SettingsCard labelledBy="ai-settings-heading">
				<SettingsCardHeader
					headingId="ai-settings-heading"
					icon={<Sparkles className="size-4" />}
					title={t('settings.ai.title')}
					description={t('settings.ai.desc')}
					badge={
						<Badge tone={aiEnabled ? 'success' : 'secondary'}>
							{aiEnabled ? t('settings.ai.status-enabled') : t('settings.ai.status-disabled')}
						</Badge>
					}
				/>
				<SettingsCardBody className="divide-y divide-border/70">
					<SettingsRow label={t('settings.ai.enable')} htmlFor="ai-enabled">
						<Checkbox
							id="ai-enabled"
							checked={aiEnabled}
							onCheckedChange={(v) => void patchSettings({ aiEnabled: v === true })}
						/>
					</SettingsRow>
					<SettingsRow label={t('settings.ai.trace')} htmlFor="ai-trace">
						<Checkbox
							id="ai-trace"
							checked={tracePrompts}
							onCheckedChange={(v) => void patchSettings({ aiTracePrompts: v === true })}
						/>
					</SettingsRow>
					{error ? <SettingsNotice tone="danger">{error}</SettingsNotice> : null}
				</SettingsCardBody>
			</SettingsCard>

			<SettingsCard labelledBy="ai-providers-heading">
				<SettingsCardHeader
					headingId="ai-providers-heading"
					icon={<Cpu className="size-4" />}
					title={t('settings.ai.provider.title')}
					badge={
						<Badge tone="secondary" className="tnum">
							{providers.length}
						</Badge>
					}
				/>
				<form onSubmit={(ev) => void handleSaveProvider(ev)}>
					<SettingsCardBody>
						{providers.length === 0 ? (
							<SettingsEmptyState
								icon={<Cpu className="size-4" />}
								message={t('settings.ai.provider.empty')}
							/>
						) : (
							<div className="space-y-2.5">
								{providers.map((p) => (
									<div
										key={p.id}
										className="flex flex-wrap items-center justify-between gap-2 rounded-lg border border-border bg-surface-2/40 px-4 py-3 text-xs"
									>
										<div className="flex flex-wrap items-center gap-2">
											<span className="text-sm font-semibold text-foreground">{p.name}</span>
											<Badge tone="secondary">{p.kind}</Badge>
										</div>
										<div className="flex flex-wrap items-center gap-2 font-mono text-muted-foreground">
											<span>
												{p.chatModel ?? '—'} {p.embeddingModel ? `· ${p.embeddingModel}` : ''}
											</span>
											{p.hasApiKey ? (
												<Badge tone="success">{t('settings.ai.provider.configured')}</Badge>
											) : null}
										</div>
									</div>
								))}
							</div>
						)}

						<div className="space-y-3 border-t border-border/70 pt-4">
							<h3 className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">
								{t('settings.ai.provider.add-title')}
							</h3>
							<div className="grid gap-3 sm:grid-cols-2">
								<div className="space-y-1.5">
									<label htmlFor="ai-provider-kind" className="text-xs font-medium text-foreground">
										{t('settings.ai.provider.kind')}
									</label>
									<Select value={kind} onValueChange={(v) => setKind(v as AiProviderKind)}>
										<SelectTrigger id="ai-provider-kind">
											<SelectValue />
										</SelectTrigger>
										<SelectContent>
											<SelectItem value="openai_compatible">OpenAI-compatible</SelectItem>
											<SelectItem value="ollama">Ollama (local)</SelectItem>
										</SelectContent>
									</Select>
								</div>
								<div className="space-y-1.5">
									<label htmlFor="ai-provider-name" className="text-xs font-medium text-foreground">
										{t('settings.ai.provider.name')}
									</label>
									<Input
										id="ai-provider-name"
										value={name}
										onChange={(ev) => setName(ev.target.value)}
										placeholder={kind === 'ollama' ? 'Local Ollama' : 'OpenAI'}
										required
									/>
								</div>
								<div className="space-y-1.5">
									<label htmlFor="ai-provider-url" className="text-xs font-medium text-foreground">
										{t('settings.ai.provider.url')}
									</label>
									<Input
										id="ai-provider-url"
										value={baseUrl}
										onChange={(ev) => setBaseUrl(ev.target.value)}
										placeholder={kind === 'ollama' ? 'http://localhost:11434' : 'https://api.openai.com'}
										required
									/>
								</div>
								{kind === 'openai_compatible' ? (
									<div className="space-y-1.5">
										<label htmlFor="ai-provider-key" className="text-xs font-medium text-foreground">
											{t('settings.ai.provider.key')}
										</label>
										<Input
											id="ai-provider-key"
											type="password"
											value={apiKey}
											onChange={(ev) => setApiKey(ev.target.value)}
											autoComplete="off"
										/>
										<p className="text-[11px] text-muted-foreground">{t('settings.ai.provider.key-hint')}</p>
									</div>
								) : null}
								<div className="space-y-1.5">
									<label htmlFor="ai-provider-chat" className="text-xs font-medium text-foreground">
										{t('settings.ai.provider.chat-model')}
									</label>
									<Input
										id="ai-provider-chat"
										value={chatModel}
										onChange={(ev) => setChatModel(ev.target.value)}
										placeholder="gpt-4o-mini / llama3.1"
									/>
								</div>
								<div className="space-y-1.5">
									<label htmlFor="ai-provider-embed" className="text-xs font-medium text-foreground">
										{t('settings.ai.provider.embedding-model')}
									</label>
									<Input
										id="ai-provider-embed"
										value={embeddingModel}
										onChange={(ev) => setEmbeddingModel(ev.target.value)}
										placeholder="nomic-embed-text"
									/>
								</div>
							</div>
						</div>
					</SettingsCardBody>

					<SettingsCardFooter className="justify-end">
						<Button size="sm" type="submit" loading={busy}>
							{t('settings.ai.provider.save')}
						</Button>
					</SettingsCardFooter>
				</form>
			</SettingsCard>
		</div>
	)
}
