import type { AiProviderDto, AiProviderKind } from '@huriro/contracts'
import { t } from '@huriro/i18n'
import { Sparkles } from 'lucide-react'
import { useEffect, useState } from 'react'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Checkbox } from '@/components/ui/checkbox'
import { Input } from '@/components/ui/input'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select'
import { Skeleton } from '@/components/ui/skeleton'
import { useWorkspace } from '@/lib/workspace'

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
		return (
			<div className="space-y-3 rounded-lg border border-border bg-card p-4">
				<Skeleton className="h-5 w-32" />
				<Skeleton className="h-16 w-full" />
			</div>
		)
	}

	// ai.manage not held → the section is invisible, same as other admin panels.
	if (denied) return null

	return (
		<section
			aria-labelledby="ai-settings-heading"
			className="space-y-4 rounded-lg border border-border bg-card p-4"
		>
			<div>
				<h2 id="ai-settings-heading" className="flex items-center gap-2 text-sm font-semibold">
					<Sparkles className="size-4 text-muted-foreground" aria-hidden />
					<span>{t('settings.ai.title')}</span>
				</h2>
				<p className="mt-0.5 text-xs text-muted-foreground">{t('settings.ai.desc')}</p>
			</div>

			<div className="space-y-2">
				<div className="flex items-center gap-2">
					<Checkbox
						id="ai-enabled"
						checked={aiEnabled}
						onCheckedChange={(v) => void patchSettings({ aiEnabled: v === true })}
					/>
					<label htmlFor="ai-enabled" className="text-sm">
						{t('settings.ai.enable')}
					</label>
				</div>
				<div className="flex items-center gap-2">
					<Checkbox
						id="ai-trace"
						checked={tracePrompts}
						onCheckedChange={(v) => void patchSettings({ aiTracePrompts: v === true })}
					/>
					<label htmlFor="ai-trace" className="text-sm">
						{t('settings.ai.trace')}
					</label>
				</div>
			</div>

			{error ? (
				<p role="alert" className="text-xs text-destructive">
					{error}
				</p>
			) : null}

			<div className="space-y-3 border-t border-border pt-4">
				<h3 className="text-sm font-semibold">{t('settings.ai.provider.title')}</h3>

				{providers.length === 0 ? (
					<p className="text-xs text-muted-foreground">{t('settings.ai.provider.empty')}</p>
				) : (
					<div className="space-y-2">
						{providers.map((p) => (
							<div
								key={p.id}
								className="flex flex-wrap items-center justify-between gap-2 rounded-md border border-border bg-muted/30 p-3 text-xs"
							>
								<div>
									<span className="font-semibold">{p.name}</span>
									<Badge tone="secondary" className="ml-2">
										{p.kind}
									</Badge>
								</div>
								<div className="text-muted-foreground">
									{p.chatModel ?? '—'} {p.embeddingModel ? `· ${p.embeddingModel}` : ''} ·{' '}
									{p.hasApiKey ? t('settings.ai.provider.configured') : ''}
								</div>
							</div>
						))}
					</div>
				)}

				<form onSubmit={(ev) => void handleSaveProvider(ev)} className="space-y-3">
					<div className="grid gap-2 sm:grid-cols-2">
						<div className="space-y-1">
							<label htmlFor="ai-provider-kind" className="text-xs font-medium">
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
						<div className="space-y-1">
							<label htmlFor="ai-provider-name" className="text-xs font-medium">
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
						<div className="space-y-1">
							<label htmlFor="ai-provider-url" className="text-xs font-medium">
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
							<div className="space-y-1">
								<label htmlFor="ai-provider-key" className="text-xs font-medium">
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
						<div className="space-y-1">
							<label htmlFor="ai-provider-chat" className="text-xs font-medium">
								{t('settings.ai.provider.chat-model')}
							</label>
							<Input
								id="ai-provider-chat"
								value={chatModel}
								onChange={(ev) => setChatModel(ev.target.value)}
								placeholder="gpt-4o-mini / llama3.1"
							/>
						</div>
						<div className="space-y-1">
							<label htmlFor="ai-provider-embed" className="text-xs font-medium">
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
					<Button size="sm" type="submit" loading={busy}>
						{t('settings.ai.provider.save')}
					</Button>
				</form>
			</div>
		</section>
	)
}
