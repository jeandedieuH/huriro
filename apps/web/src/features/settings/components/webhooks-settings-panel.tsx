import type { WebhookDeliveryDto, WebhookEndpointDto } from '@huriro/contracts'
import { t } from '@huriro/i18n'
import { KeyRound, RefreshCw, Trash2, Webhook } from 'lucide-react'
import { useEffect, useMemo, useState } from 'react'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
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

const COMMON_WEBHOOK_EVENTS = [
	'tasks.issue.created.v1',
	'tasks.issue.updated.v1',
	'docs.page.updated.v1',
	'chat.message.created.v1'
] as const

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

	const selectedEvents = useMemo(
		() =>
			new Set(
				eventsText
					.split(',')
					.map((s) => s.trim())
					.filter(Boolean)
			),
		[eventsText]
	)

	function togglePresetEvent(eventKey: string) {
		const next = new Set(selectedEvents)
		if (next.has(eventKey)) next.delete(eventKey)
		else next.add(eventKey)
		setEventsText([...next].join(', '))
	}

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
		return <SettingsSkeleton rows={3} />
	}

	return (
		<div className="space-y-5">
			{revealedSecret ? (
				<SettingsNotice
					tone="warning"
					title={t('settings.webhooks.secret-once')}
					onDismiss={() => setRevealedSecret(null)}
				>
					<CopyableSecretField value={revealedSecret} />
				</SettingsNotice>
			) : null}

			<SettingsCard labelledBy="webhooks-settings-heading">
				<SettingsCardHeader
					headingId="webhooks-settings-heading"
					icon={<Webhook className="size-4" />}
					title={t('settings.webhooks.title')}
					description={t('settings.webhooks.desc')}
				/>
				<form onSubmit={(ev) => void handleCreate(ev)}>
					<SettingsCardBody>
						<div className="grid gap-3 sm:grid-cols-2">
							<div className="space-y-1.5">
								<label htmlFor="webhook-name" className="text-xs font-medium text-foreground">
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
							<div className="space-y-1.5">
								<label htmlFor="webhook-url" className="text-xs font-medium text-foreground">
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
						</div>

						<div className="space-y-2">
							<label htmlFor="webhook-events" className="text-xs font-medium text-foreground">
								{t('settings.webhooks.events')}
							</label>
							<Input
								id="webhook-events"
								value={eventsText}
								onChange={(ev) => setEventsText(ev.target.value)}
								className="font-mono text-xs"
								required
							/>
							<p className="text-xs text-muted-foreground">{t('settings.webhooks.events-hint')}</p>
							<div className="flex flex-wrap gap-1.5">
								{COMMON_WEBHOOK_EVENTS.map((eventKey) => {
									const active = selectedEvents.has(eventKey)
									return (
										<Button
											key={eventKey}
											type="button"
											size="sm"
											tone={active ? 'default' : 'outline'}
											className="h-7 font-mono text-[11px]"
											aria-pressed={active}
											onClick={() => togglePresetEvent(eventKey)}
										>
											{eventKey}
										</Button>
									)
								})}
							</div>
						</div>

						{error ? <SettingsNotice tone="danger">{error}</SettingsNotice> : null}
					</SettingsCardBody>
					<SettingsCardFooter className="justify-end">
						<Button size="sm" type="submit" loading={busy}>
							{t('settings.webhooks.submit')}
						</Button>
					</SettingsCardFooter>
				</form>
			</SettingsCard>

			<SettingsCard labelledBy="webhooks-list-heading">
				<SettingsCardHeader
					headingId="webhooks-list-heading"
					title={t('settings.webhooks.list-title')}
					badge={
						<Badge tone="secondary" className="tnum">
							{endpoints.length}
						</Badge>
					}
				/>
				<SettingsCardBody>
					{endpoints.length === 0 ? (
						<SettingsEmptyState
							icon={<Webhook className="size-4" />}
							message={t('settings.webhooks.empty')}
						/>
					) : (
						<div className="space-y-3">
							{endpoints.map((ep) => {
								const deliveries = deliveriesByEp[ep.id] ?? []
								const isExpanded = expandedEp === ep.id
								return (
									<div key={ep.id} className="rounded-lg border border-border bg-surface-2/40 p-3.5 text-xs">
										<div className="flex flex-wrap items-start justify-between gap-3">
											<div className="min-w-0 flex-1 space-y-1.5">
												<div className="flex flex-wrap items-center gap-2">
													<span className="text-sm font-semibold text-foreground">{ep.name}</span>
													<Badge tone={ep.enabled ? 'success' : 'secondary'}>
														{ep.enabled ? t('settings.common.active') : t('settings.common.paused')}
													</Badge>
													<Badge tone="outline" className="font-mono">
														{ep.secretPrefix}…
													</Badge>
												</div>
												<p className="truncate font-mono text-muted-foreground">{ep.url}</p>
												<div className="flex flex-wrap gap-1">
													{ep.events.map((evName) => (
														<Badge key={evName} tone="secondary" className="font-mono text-[11px]">
															{evName}
														</Badge>
													))}
												</div>
											</div>
											<div className="flex flex-wrap items-center gap-1.5">
												<Button
													size="sm"
													tone="outline"
													type="button"
													aria-expanded={isExpanded}
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
											<div className="mt-3 space-y-1.5 border-t border-border pt-3">
												{deliveries.length === 0 ? (
													<p className="text-muted-foreground">{t('settings.webhooks.deliveries-empty')}</p>
												) : (
													deliveries.map((del) => (
														<div
															key={del.id}
															className="flex flex-wrap items-center justify-between gap-2 rounded-md border border-border/60 bg-background px-3 py-2"
														>
															<div className="flex min-w-0 flex-wrap items-center gap-2">
																<span className="font-mono font-medium text-foreground">{del.eventType}</span>
																<Badge
																	tone={
																		del.status === 'delivered'
																			? 'success'
																			: del.status === 'failed'
																				? 'danger'
																				: 'secondary'
																	}
																>
																	{del.status}
																</Badge>
																<span className="text-muted-foreground tnum">
																	{del.attempts}x{del.lastStatusCode ? ` (${del.lastStatusCode})` : ''}
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
				</SettingsCardBody>
			</SettingsCard>
		</div>
	)
}
