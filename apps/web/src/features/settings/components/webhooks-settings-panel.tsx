import type { WebhookDeliveryDto, WebhookEndpointDto } from '@huriro/contracts'
import { t } from '@huriro/i18n'
import { KeyRound, RefreshCw, Trash2, Webhook } from 'lucide-react'
import { useEffect, useState } from 'react'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Skeleton } from '@/components/ui/skeleton'
import { useWorkspace } from '@/lib/workspace'

export function WebhooksSettingsPanel() {
	const { api } = useWorkspace()

	const [endpoints, setEndpoints] = useState<WebhookEndpointDto[]>([])
	const [deliveriesByEp, setDeliveriesByEp] = useState<Record<string, WebhookDeliveryDto[]>>({})
	const [expandedEp, setExpandedEp] = useState<string | null>(null)
	const [revealedSecret, setRevealedSecret] = useState<string | null>(null)

	const [name, setName] = useState('')
	const [url, setUrl] = useState('')
	const [eventsText, setEventsText] = useState('tasks.issue.created.v1, tasks.issue.updated.v1')
	const [loading, setLoading] = useState(true)
	const [busy, setBusy] = useState(false)
	const [error, setError] = useState<string | null>(null)

	useEffect(() => {
		let cancelled = false
		void api
			.listWebhooks()
			.then((list) => {
				if (cancelled) return
				setEndpoints(list)
				setLoading(false)
			})
			.catch((err) => {
				if (cancelled) return
				setError(err instanceof Error ? err.message : 'Failed to load webhooks')
				setLoading(false)
			})
		return () => {
			cancelled = true
		}
	}, [api])

	async function handleCreate(ev: React.FormEvent) {
		ev.preventDefault()
		const events = eventsText
			.split(',')
			.map((s) => s.trim())
			.filter(Boolean)
		if (!name.trim() || !url.trim() || events.length === 0 || busy) return
		setBusy(true)
		setError(null)
		try {
			const res = await api.createWebhook({
				name: name.trim(),
				url: url.trim(),
				events,
				enabled: true
			})
			setEndpoints((prev) => [res.endpoint, ...prev])
			setRevealedSecret(res.signingSecret)
			setName('')
			setUrl('')
		} catch (err) {
			setError(err instanceof Error ? err.message : 'Failed to create webhook')
		} finally {
			setBusy(false)
		}
	}

	async function handleToggle(ep: WebhookEndpointDto) {
		setError(null)
		try {
			const res = await api.updateWebhook(ep.id, { enabled: !ep.enabled, version: ep.version })
			setEndpoints((prev) => prev.map((item) => (item.id === ep.id ? res.endpoint : item)))
		} catch (err) {
			setError(err instanceof Error ? err.message : 'Failed to update webhook')
		}
	}

	async function handleRotate(ep: WebhookEndpointDto) {
		setError(null)
		try {
			const res = await api.updateWebhook(ep.id, { rotateSecret: true, version: ep.version })
			setEndpoints((prev) => prev.map((item) => (item.id === ep.id ? res.endpoint : item)))
			if (res.signingSecret) setRevealedSecret(res.signingSecret)
		} catch (err) {
			setError(err instanceof Error ? err.message : 'Failed to rotate secret')
		}
	}

	async function handleDelete(epId: string) {
		setError(null)
		try {
			await api.deleteWebhook(epId)
			setEndpoints((prev) => prev.filter((item) => item.id !== epId))
		} catch (err) {
			setError(err instanceof Error ? err.message : 'Failed to delete webhook')
		}
	}

	async function handleToggleDeliveries(epId: string) {
		if (expandedEp === epId) {
			setExpandedEp(null)
			return
		}
		setExpandedEp(epId)
		try {
			const list = await api.listWebhookDeliveries(epId)
			setDeliveriesByEp((prev) => ({ ...prev, [epId]: list }))
		} catch (err) {
			setError(err instanceof Error ? err.message : 'Failed to load deliveries')
		}
	}

	async function handleReplay(epId: string, deliveryId: string) {
		setError(null)
		try {
			const updated = await api.replayWebhookDelivery(deliveryId)
			setDeliveriesByEp((prev) => ({
				...prev,
				[epId]: (prev[epId] ?? []).map((d) => (d.id === deliveryId ? updated : d))
			}))
		} catch (err) {
			setError(err instanceof Error ? err.message : 'Failed to replay delivery')
		}
	}

	if (loading) {
		return (
			<div className="space-y-3 rounded-lg border border-border bg-card p-4">
				<Skeleton className="h-5 w-40" />
				<Skeleton className="h-24 w-full" />
			</div>
		)
	}

	return (
		<section
			aria-labelledby="webhooks-settings-heading"
			className="space-y-4 rounded-lg border border-border bg-card p-4"
		>
			<div>
				<h2 id="webhooks-settings-heading" className="flex items-center gap-2 text-sm font-semibold">
					<Webhook className="size-4 text-muted-foreground" aria-hidden />
					<span>{t('settings.webhooks.title')}</span>
				</h2>
				<p className="mt-0.5 text-xs text-muted-foreground">{t('settings.webhooks.desc')}</p>
			</div>

			{revealedSecret ? (
				<div role="status" className="rounded-md border border-(--warning)/40 bg-(--warning)/10 p-3 text-xs">
					<p className="font-semibold text-foreground">{t('settings.webhooks.secret-once')}</p>
					<code className="mt-1 block break-all font-mono text-foreground">{revealedSecret}</code>
				</div>
			) : null}

			<form onSubmit={(ev) => void handleCreate(ev)} className="grid gap-2 sm:grid-cols-3">
				<div className="space-y-1">
					<label htmlFor="webhook-name" className="text-xs font-medium">
						{t('settings.webhooks.name')}
					</label>
					<Input
						id="webhook-name"
						value={name}
						onChange={(ev) => setName(ev.target.value)}
						placeholder="CI notifier"
						required
					/>
				</div>
				<div className="space-y-1">
					<label htmlFor="webhook-url" className="text-xs font-medium">
						{t('settings.webhooks.url')}
					</label>
					<Input
						id="webhook-url"
						type="url"
						value={url}
						onChange={(ev) => setUrl(ev.target.value)}
						placeholder="https://example.com/hooks/huriro"
						required
					/>
				</div>
				<div className="space-y-1">
					<label htmlFor="webhook-events" className="text-xs font-medium">
						{t('settings.webhooks.events')}
					</label>
					<div className="flex gap-2">
						<Input
							id="webhook-events"
							value={eventsText}
							onChange={(ev) => setEventsText(ev.target.value)}
							required
						/>
						<Button size="sm" type="submit" loading={busy}>
							{t('settings.webhooks.submit')}
						</Button>
					</div>
				</div>
			</form>

			{error ? (
				<p role="alert" className="text-xs text-destructive">
					{error}
				</p>
			) : null}

			{endpoints.length === 0 ? (
				<p className="text-xs text-muted-foreground">{t('settings.webhooks.empty')}</p>
			) : (
				<div className="space-y-2">
					{endpoints.map((ep) => {
						const deliveries = deliveriesByEp[ep.id] ?? []
						const isExpanded = expandedEp === ep.id
						return (
							<div key={ep.id} className="rounded-md border border-border bg-muted/30 p-3 text-xs">
								<div className="flex flex-wrap items-center justify-between gap-2">
									<div className="min-w-0">
										<div className="flex items-center gap-2">
											<span className="font-semibold">{ep.name}</span>
											<Badge tone={ep.enabled ? 'default' : 'secondary'}>{ep.secretPrefix}…</Badge>
										</div>
										<p className="truncate font-mono text-muted-foreground">{ep.url}</p>
									</div>
									<div className="flex flex-wrap items-center gap-1.5">
										<Button
											size="sm"
											tone="outline"
											type="button"
											onClick={() => void handleToggleDeliveries(ep.id)}
										>
											{t('settings.webhooks.deliveries')}
										</Button>
										<Button size="sm" tone="outline" type="button" onClick={() => void handleRotate(ep)}>
											<KeyRound className="size-3" aria-hidden />
											<span>{t('settings.webhooks.rotate')}</span>
										</Button>
										<Button size="sm" tone="outline" type="button" onClick={() => void handleToggle(ep)}>
											{ep.enabled ? t('settings.webhooks.disable') : t('settings.webhooks.enable')}
										</Button>
										<Button
											size="icon"
											tone="ghost"
											type="button"
											aria-label={t('settings.webhooks.delete')}
											onClick={() => void handleDelete(ep.id)}
										>
											<Trash2 className="size-3.5 text-destructive" aria-hidden />
										</Button>
									</div>
								</div>

								{isExpanded ? (
									<div className="mt-3 space-y-1.5 border-t border-border pt-2">
										{deliveries.length === 0 ? (
											<p className="text-muted-foreground">0 deliveries</p>
										) : (
											deliveries.map((del) => (
												<div
													key={del.id}
													className="flex items-center justify-between gap-2 rounded bg-background px-2.5 py-1.5"
												>
													<div className="min-w-0">
														<span className="font-mono font-medium">{del.eventType}</span>
														<span className="ml-2 text-muted-foreground">
															{del.status} · {del.attempts}x
															{del.lastStatusCode ? ` (${del.lastStatusCode})` : ''}
														</span>
													</div>
													<Button
														size="sm"
														tone="outline"
														type="button"
														onClick={() => void handleReplay(ep.id, del.id)}
													>
														<RefreshCw className="size-3" aria-hidden />
														<span>{t('settings.webhooks.replay')}</span>
													</Button>
												</div>
											))
										)}
									</div>
								) : null}
							</div>
						)
					})}
				</div>
			)}
		</section>
	)
}
