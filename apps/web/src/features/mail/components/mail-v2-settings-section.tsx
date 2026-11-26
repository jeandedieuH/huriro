import type {
	MailInboxDto,
	MailMacroDto,
	MailRoutingConfigDto,
	MailSlaAnalyticsDto,
	MailSlaPolicyDto,
	MailSplitTabDto,
	MailTemplateDto
} from '@huriro/contracts'
import { t } from '@huriro/i18n'
import { Activity, FileText, LayoutGrid, Pencil, Route, Trash2, Zap } from 'lucide-react'
import { useEffect, useState } from 'react'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Checkbox } from '@/components/ui/checkbox'
import { Input } from '@/components/ui/input'
import {
	SettingsCard,
	SettingsCardBody,
	SettingsCardFooter,
	SettingsCardHeader
} from '@/features/settings/components/settings-primitives'
import { useWorkspace } from '@/lib/workspace'
import { parseInboxSplitTabs } from '../store/mail-store'
import { MailSlaAnalyticsCard } from './mail-sla-analytics-card'

export interface MailV2SettingsSectionProps {
	readonly inboxes: readonly MailInboxDto[]
	readonly onNotice: (message: string) => void
	readonly onError: (message: string) => void
}

/**
 * Mail v2 administration section mounted inside MailSettingsPanel:
 * round-robin routing, split-inbox tabs, SLA policies + analytics chart, snippets, and macros.
 */
export function MailV2SettingsSection({ inboxes, onNotice, onError }: MailV2SettingsSectionProps) {
	const { api } = useWorkspace()
	const [selectedInboxId, setSelectedInboxId] = useState(inboxes[0]?.id ?? '')
	const [routing, setRouting] = useState<MailRoutingConfigDto>({
		enabled: false,
		maxOpenCap: 10,
		requireOnline: true,
		respectDnd: true
	})
	const [slaPolicies, setSlaPolicies] = useState<MailSlaPolicyDto[]>([])
	const [slaAnalytics, setSlaAnalytics] = useState<MailSlaAnalyticsDto | null>(null)
	const [templates, setTemplates] = useState<MailTemplateDto[]>([])
	const [macros, setMacros] = useState<MailMacroDto[]>([])
	const [inboxSettingsVersionById, setInboxSettingsVersionById] = useState<Record<string, number>>({})
	const [splitTabsByInbox, setSplitTabsByInbox] = useState<Record<string, MailSplitTabDto[]>>({})

	const [editingSlaId, setEditingSlaId] = useState<string | null>(null)
	const [slaName, setSlaName] = useState('')
	const [firstReplyMinutes, setFirstReplyMinutes] = useState('60')
	const [resolutionMinutes, setResolutionMinutes] = useState('480')

	const [editingTplId, setEditingTplId] = useState<string | null>(null)
	const [tplName, setTplName] = useState('')
	const [tplShortcut, setTplShortcut] = useState(';quick')
	const [tplBody, setTplBody] = useState('')

	const [editingMacroId, setEditingMacroId] = useState<string | null>(null)
	const [macroName, setMacroName] = useState('')
	const [macroStatus, setMacroStatus] = useState<'open' | 'pending' | 'closed'>('closed')

	const [newTabName, setNewTabName] = useState('')
	const [newTabStatus, setNewTabStatus] = useState<'' | 'open' | 'pending' | 'closed'>('')
	const [newTabAssignee, setNewTabAssignee] = useState<'all' | 'me' | 'unassigned'>('all')
	const [busy, setBusy] = useState<string | null>(null)

	useEffect(() => {
		if (!selectedInboxId && inboxes[0]) {
			setSelectedInboxId(inboxes[0].id)
		}
		setSplitTabsByInbox((prev) => {
			const next = { ...prev }
			for (const inbox of inboxes) {
				if (!(inbox.id in next)) {
					next[inbox.id] = parseInboxSplitTabs(inbox.settings)
				}
			}
			return next
		})
		setInboxSettingsVersionById((prev) => {
			const next = { ...prev }
			for (const inbox of inboxes) {
				if (!(inbox.id in next)) next[inbox.id] = inbox.version ?? 1
			}
			return next
		})
	}, [inboxes, selectedInboxId])

	useEffect(() => {
		let cancelled = false
		const targetInbox = selectedInboxId || undefined
		void Promise.all([
			api.listMailSlaPolicies(targetInbox),
			api.getMailSlaAnalytics(targetInbox),
			api.listMailTemplates({ inboxId: targetInbox }),
			api.listMailMacros(targetInbox),
			targetInbox ? api.getMailRoutingConfig(targetInbox) : Promise.resolve(null)
		])
			.then(([policies, analytics, tpls, macs, routingCfg]) => {
				if (cancelled) return
				setSlaPolicies(policies)
				setSlaAnalytics(analytics)
				setTemplates(tpls)
				setMacros(macs)
				if (routingCfg) setRouting(routingCfg)
			})
			.catch((err) => {
				if (!cancelled) onError(err instanceof Error ? err.message : t('mail.error.load'))
			})
		return () => {
			cancelled = true
		}
	}, [api, onError, selectedInboxId])

	const selectedInbox = inboxes.find((inbox) => inbox.id === selectedInboxId) ?? null
	const activeSplitTabs = selectedInboxId ? (splitTabsByInbox[selectedInboxId] ?? []) : []

	const saveRouting = async (ev: React.FormEvent) => {
		ev.preventDefault()
		if (!selectedInboxId || busy !== null) return
		setBusy('routing')
		try {
			const next = await api.upsertMailRoutingConfig(selectedInboxId, routing)
			setRouting(next)
			onNotice(t('mail.routing.save'))
		} catch (err) {
			onError(err instanceof Error ? err.message : t('mail.error.load'))
		} finally {
			setBusy(null)
		}
	}

	const persistSplitTabs = async (nextTabs: MailSplitTabDto[]) => {
		if (!selectedInbox || busy !== null) return
		setBusy('split-tabs')
		try {
			const version = inboxSettingsVersionById[selectedInbox.id] ?? selectedInbox.version ?? 1
			const updated = await api.updateMailInboxSettings(selectedInbox.id, {
				settings: { ...selectedInbox.settings, split_tabs: nextTabs },
				expectedVersion: version
			})
			setSplitTabsByInbox((prev) => ({
				...prev,
				[selectedInbox.id]: parseInboxSplitTabs(updated.settings)
			}))
			setInboxSettingsVersionById((prev) => ({
				...prev,
				[selectedInbox.id]: updated.version ?? version + 1
			}))
			onNotice(t('mail.split-tabs.save'))
		} catch (err) {
			onError(err instanceof Error ? err.message : t('mail.error.load'))
		} finally {
			setBusy(null)
		}
	}

	const addSplitTab = async (ev: React.FormEvent) => {
		ev.preventDefault()
		if (!selectedInbox || !newTabName.trim() || busy !== null) return
		const tab: MailSplitTabDto = {
			id: `tab_${Date.now().toString(36)}`,
			name: newTabName.trim(),
			...(newTabStatus ? { status: newTabStatus } : {}),
			...(newTabAssignee !== 'all' ? { assignee: newTabAssignee } : {})
		}
		await persistSplitTabs([...activeSplitTabs, tab])
		setNewTabName('')
		setNewTabStatus('')
		setNewTabAssignee('all')
	}

	const submitSlaPolicy = async (ev: React.FormEvent) => {
		ev.preventDefault()
		if (!slaName.trim() || busy === 'sla') return
		setBusy('sla')
		try {
			const saved = await api.upsertMailSlaPolicy(
				{
					inboxId: selectedInboxId || null,
					name: slaName.trim(),
					firstReplyMinutes: Number(firstReplyMinutes) || 60,
					resolutionMinutes: Number(resolutionMinutes) || 480,
					active: true
				},
				editingSlaId ?? undefined
			)
			setSlaPolicies((prev) =>
				editingSlaId ? prev.map((p) => (p.id === saved.id ? saved : p)) : [...prev, saved]
			)
			setEditingSlaId(null)
			setSlaName('')
			onNotice(saved.name)
		} catch (err) {
			onError(err instanceof Error ? err.message : t('mail.error.load'))
		} finally {
			setBusy(null)
		}
	}

	const removeSlaPolicy = async (id: string) => {
		if (busy !== null) return
		setBusy(`del-sla-${id}`)
		try {
			await api.deleteMailSlaPolicy(id)
			setSlaPolicies((prev) => prev.filter((p) => p.id !== id))
			if (editingSlaId === id) {
				setEditingSlaId(null)
				setSlaName('')
			}
		} catch (err) {
			onError(err instanceof Error ? err.message : t('mail.error.load'))
		} finally {
			setBusy(null)
		}
	}

	const submitTemplate = async (ev: React.FormEvent) => {
		ev.preventDefault()
		if (!tplName.trim() || !tplBody.trim() || busy === 'tpl') return
		setBusy('tpl')
		try {
			const shortcut = tplShortcut.startsWith(';') ? tplShortcut.trim() : `;${tplShortcut.trim()}`
			const saved = await api.upsertMailTemplate(
				{
					inboxId: selectedInboxId || null,
					name: tplName.trim(),
					shortcut,
					bodyText: tplBody.trim()
				},
				editingTplId ?? undefined
			)
			setTemplates((prev) =>
				editingTplId ? prev.map((tpl) => (tpl.id === saved.id ? saved : tpl)) : [...prev, saved]
			)
			setEditingTplId(null)
			setTplName('')
			setTplBody('')
			onNotice(saved.name)
		} catch (err) {
			onError(err instanceof Error ? err.message : t('mail.error.load'))
		} finally {
			setBusy(null)
		}
	}

	const removeTemplate = async (id: string) => {
		if (busy !== null) return
		setBusy(`del-tpl-${id}`)
		try {
			await api.deleteMailTemplate(id)
			setTemplates((prev) => prev.filter((tpl) => tpl.id !== id))
			if (editingTplId === id) {
				setEditingTplId(null)
				setTplName('')
				setTplBody('')
			}
		} catch (err) {
			onError(err instanceof Error ? err.message : t('mail.error.load'))
		} finally {
			setBusy(null)
		}
	}

	const submitMacro = async (ev: React.FormEvent) => {
		ev.preventDefault()
		if (!macroName.trim() || busy === 'macro') return
		setBusy('macro')
		try {
			const saved = await api.upsertMailMacro(
				{
					inboxId: selectedInboxId || null,
					name: macroName.trim(),
					steps: [{ action: 'set_status', value: macroStatus }]
				},
				editingMacroId ?? undefined
			)
			setMacros((prev) =>
				editingMacroId ? prev.map((m) => (m.id === saved.id ? saved : m)) : [...prev, saved]
			)
			setEditingMacroId(null)
			setMacroName('')
			onNotice(saved.name)
		} catch (err) {
			onError(err instanceof Error ? err.message : t('mail.error.load'))
		} finally {
			setBusy(null)
		}
	}

	const removeMacro = async (id: string) => {
		if (busy !== null) return
		setBusy(`del-macro-${id}`)
		try {
			await api.deleteMailMacro(id)
			setMacros((prev) => prev.filter((m) => m.id !== id))
			if (editingMacroId === id) {
				setEditingMacroId(null)
				setMacroName('')
			}
		} catch (err) {
			onError(err instanceof Error ? err.message : t('mail.error.load'))
		} finally {
			setBusy(null)
		}
	}

	return (
		<div className="space-y-5">
			<SettingsCard>
				<SettingsCardHeader
					title={t('mail.routing.title')}
					icon={<Route className="size-4" />}
					action={
						inboxes.length > 0 ? (
							<select
								aria-label={t('mail.compose.inbox')}
								value={selectedInboxId}
								onChange={(e) => setSelectedInboxId(e.target.value)}
								className="h-8 rounded-md border border-border bg-background px-2 text-xs"
							>
								{inboxes.map((inbox) => (
									<option key={inbox.id} value={inbox.id}>
										{inbox.name}
									</option>
								))}
							</select>
						) : undefined
					}
				/>
				<form onSubmit={(ev) => void saveRouting(ev)}>
					<SettingsCardBody>
						<div className="flex items-center gap-2">
							<Checkbox
								id="mail-routing-enabled"
								checked={routing.enabled}
								onCheckedChange={(checked) => setRouting((r) => ({ ...r, enabled: checked === true }))}
							/>
							<label htmlFor="mail-routing-enabled" className="text-xs font-medium text-foreground">
								{t('mail.routing.enabled')}
							</label>
						</div>

						<div className="grid gap-3 sm:grid-cols-3">
							<div className="space-y-1">
								<label htmlFor="mail-routing-cap" className="text-xs font-medium text-foreground">
									{t('mail.routing.max-cap')}
								</label>
								<Input
									id="mail-routing-cap"
									type="number"
									min={1}
									max={500}
									value={routing.maxOpenCap}
									onChange={(e) =>
										setRouting((r) => ({
											...r,
											maxOpenCap: Math.max(1, Number(e.target.value) || 1)
										}))
									}
								/>
							</div>
							<div className="flex items-center gap-2 pt-5">
								<Checkbox
									id="mail-routing-online"
									checked={routing.requireOnline}
									onCheckedChange={(checked) =>
										setRouting((r) => ({ ...r, requireOnline: checked === true }))
									}
								/>
								<label htmlFor="mail-routing-online" className="text-xs text-foreground">
									{t('mail.routing.require-online')}
								</label>
							</div>
							<div className="flex items-center gap-2 pt-5">
								<Checkbox
									id="mail-routing-dnd"
									checked={routing.respectDnd}
									onCheckedChange={(checked) => setRouting((r) => ({ ...r, respectDnd: checked === true }))}
								/>
								<label htmlFor="mail-routing-dnd" className="text-xs text-foreground">
									{t('mail.routing.respect-dnd')}
								</label>
							</div>
						</div>
					</SettingsCardBody>
					<SettingsCardFooter className="justify-end">
						<Button size="sm" type="submit" disabled={busy === 'routing' || !selectedInboxId}>
							{t('mail.routing.save')}
						</Button>
					</SettingsCardFooter>
				</form>
			</SettingsCard>

			<SettingsCard>
				<SettingsCardHeader title={t('mail.split-tabs.title')} icon={<LayoutGrid className="size-4" />} />
				<form onSubmit={(ev) => void addSplitTab(ev)}>
					<SettingsCardBody>
						{activeSplitTabs.length === 0 ? (
							<p className="text-xs text-muted-foreground">{t('mail.split-tabs.empty')}</p>
						) : (
							<ul className="flex flex-wrap gap-2">
								{activeSplitTabs.map((tab) => (
									<li
										key={tab.id}
										className="inline-flex items-center gap-1 rounded-md border border-border px-2 py-1 text-xs"
									>
										<span className="font-medium">{tab.name}</span>
										<button
											type="button"
											aria-label={`${t('mail.split-tabs.delete')}: ${tab.name}`}
											onClick={() =>
												void persistSplitTabs(activeSplitTabs.filter((item) => item.id !== tab.id))
											}
											className="text-muted-foreground hover:text-destructive"
										>
											<Trash2 className="size-3" aria-hidden />
										</button>
									</li>
								))}
							</ul>
						)}
						<div className="grid gap-3 sm:grid-cols-3">
							<Input
								aria-label={t('mail.split-tabs.name-placeholder')}
								placeholder={t('mail.split-tabs.name-placeholder')}
								value={newTabName}
								onChange={(e) => setNewTabName(e.target.value)}
							/>
							<select
								aria-label={t('mail.split-tabs.status-label')}
								value={newTabStatus}
								onChange={(e) => setNewTabStatus(e.target.value as '' | 'open' | 'pending' | 'closed')}
								className="h-9 rounded-md border border-border bg-background px-2 text-xs"
							>
								<option value="">{t('mail.split-tabs.any')}</option>
								<option value="open">{t('mail.conv.status.open')}</option>
								<option value="pending">{t('mail.conv.status.pending')}</option>
								<option value="closed">{t('mail.conv.status.closed')}</option>
							</select>
							<select
								aria-label={t('mail.split-tabs.assignee-label')}
								value={newTabAssignee}
								onChange={(e) => setNewTabAssignee(e.target.value as 'all' | 'me' | 'unassigned')}
								className="h-9 rounded-md border border-border bg-background px-2 text-xs"
							>
								<option value="all">{t('mail.split-tabs.any')}</option>
								<option value="me">{t('mail.split-tabs.me')}</option>
								<option value="unassigned">{t('mail.split-tabs.unassigned')}</option>
							</select>
						</div>
					</SettingsCardBody>
					<SettingsCardFooter className="justify-end">
						<Button
							size="sm"
							tone="outline"
							type="submit"
							disabled={busy !== null || !selectedInbox || !newTabName.trim()}
						>
							{t('mail.split-tabs.add')}
						</Button>
					</SettingsCardFooter>
				</form>
			</SettingsCard>

			<SettingsCard>
				<SettingsCardHeader
					title={t('mail.sla.title')}
					icon={<Activity className="size-4" />}
					description={
						slaAnalytics
							? t('mail.sla.analytics', {
									total: slaAnalytics.conversationCount,
									replied: slaAnalytics.repliedCount,
									breached: slaAnalytics.breachedCount
								})
							: undefined
					}
				/>
				<form onSubmit={(ev) => void submitSlaPolicy(ev)}>
					<SettingsCardBody>
						{slaAnalytics ? <MailSlaAnalyticsCard analytics={slaAnalytics} /> : null}
						{slaPolicies.length > 0 ? (
							<ul className="space-y-1.5">
								{slaPolicies.map((pol) => (
									<li
										key={pol.id}
										className="flex flex-wrap items-center justify-between gap-2 rounded-md border border-border/80 bg-background px-2.5 py-1.5 text-xs"
									>
										<div className="flex items-center gap-2">
											<Badge tone="outline">{pol.name}</Badge>
											{pol.firstReplyMinutes ? (
												<span className="text-muted-foreground">
													{t('mail.sla.minutes', { minutes: pol.firstReplyMinutes })}
												</span>
											) : null}
										</div>
										<div className="flex items-center gap-1">
											<Button
												size="sm"
												tone="ghost"
												type="button"
												aria-label={`${t('mail.sla.edit')}: ${pol.name}`}
												onClick={() => {
													setEditingSlaId(pol.id)
													setSlaName(pol.name)
													setFirstReplyMinutes(String(pol.firstReplyMinutes ?? 60))
													setResolutionMinutes(String(pol.resolutionMinutes ?? 480))
												}}
											>
												<Pencil className="size-3" aria-hidden />
											</Button>
											<Button
												size="sm"
												tone="ghost"
												type="button"
												aria-label={`${t('mail.sla.delete')}: ${pol.name}`}
												onClick={() => void removeSlaPolicy(pol.id)}
											>
												<Trash2 className="size-3" aria-hidden />
											</Button>
										</div>
									</li>
								))}
							</ul>
						) : null}
						<div className="grid gap-3 sm:grid-cols-3">
							<Input
								aria-label={t('mail.sla.title')}
								placeholder={t('mail.sla.title')}
								value={slaName}
								onChange={(e) => setSlaName(e.target.value)}
							/>
							<Input
								aria-label={t('mail.sla.first-reply')}
								type="number"
								min={1}
								value={firstReplyMinutes}
								onChange={(e) => setFirstReplyMinutes(e.target.value)}
							/>
							<Input
								aria-label={t('mail.sla.resolution')}
								type="number"
								min={1}
								value={resolutionMinutes}
								onChange={(e) => setResolutionMinutes(e.target.value)}
							/>
						</div>
					</SettingsCardBody>
					<SettingsCardFooter className="justify-end gap-2">
						{editingSlaId ? (
							<Button
								size="sm"
								tone="ghost"
								type="button"
								onClick={() => {
									setEditingSlaId(null)
									setSlaName('')
								}}
							>
								{t('mail.settings.cancel-edit')}
							</Button>
						) : null}
						<Button size="sm" tone="outline" type="submit" disabled={busy === 'sla' || !slaName.trim()}>
							{editingSlaId ? t('mail.sla.update') : t('mail.sla.add')}
						</Button>
					</SettingsCardFooter>
				</form>
			</SettingsCard>

			<div className="grid gap-5 md:grid-cols-2">
				<SettingsCard>
					<SettingsCardHeader title={t('mail.templates.title')} icon={<FileText className="size-4" />} />
					<form onSubmit={(ev) => void submitTemplate(ev)}>
						<SettingsCardBody>
							<ul className="space-y-1.5">
								{templates.map((tpl) => (
									<li
										key={tpl.id}
										className="flex items-center justify-between gap-2 rounded-md border border-border/80 bg-background px-2.5 py-1.5 text-xs"
									>
										<span className="truncate font-medium">
											{tpl.name} <code className="text-muted-foreground">({tpl.shortcut})</code>
										</span>
										<div className="flex items-center gap-1">
											<Button
												size="sm"
												tone="ghost"
												type="button"
												aria-label={`${t('mail.templates.edit')}: ${tpl.name}`}
												onClick={() => {
													setEditingTplId(tpl.id)
													setTplName(tpl.name)
													setTplShortcut(tpl.shortcut)
													setTplBody(tpl.bodyText)
												}}
											>
												<Pencil className="size-3" aria-hidden />
											</Button>
											<Button
												size="sm"
												tone="ghost"
												type="button"
												aria-label={`${t('mail.templates.delete')}: ${tpl.name}`}
												onClick={() => void removeTemplate(tpl.id)}
											>
												<Trash2 className="size-3" aria-hidden />
											</Button>
										</div>
									</li>
								))}
							</ul>
							<Input
								aria-label={t('mail.templates.name')}
								placeholder={t('mail.templates.name')}
								value={tplName}
								onChange={(e) => setTplName(e.target.value)}
							/>
							<Input
								aria-label={t('mail.templates.shortcut')}
								placeholder={t('mail.templates.shortcut')}
								value={tplShortcut}
								onChange={(e) => setTplShortcut(e.target.value)}
							/>
							<Input
								aria-label={t('mail.templates.body')}
								placeholder={t('mail.templates.body')}
								value={tplBody}
								onChange={(e) => setTplBody(e.target.value)}
							/>
						</SettingsCardBody>
						<SettingsCardFooter className="justify-end gap-2">
							{editingTplId ? (
								<Button
									size="sm"
									tone="ghost"
									type="button"
									onClick={() => {
										setEditingTplId(null)
										setTplName('')
										setTplBody('')
									}}
								>
									{t('mail.settings.cancel-edit')}
								</Button>
							) : null}
							<Button
								size="sm"
								tone="outline"
								type="submit"
								disabled={busy === 'tpl' || !tplName.trim() || !tplBody.trim()}
							>
								{editingTplId ? t('mail.templates.update') : t('mail.templates.create')}
							</Button>
						</SettingsCardFooter>
					</form>
				</SettingsCard>

				<SettingsCard>
					<SettingsCardHeader title={t('mail.macros.title')} icon={<Zap className="size-4" />} />
					<form onSubmit={(ev) => void submitMacro(ev)}>
						<SettingsCardBody>
							<ul className="space-y-1.5">
								{macros.map((mac) => (
									<li
										key={mac.id}
										className="flex items-center justify-between gap-2 rounded-md border border-border/80 bg-background px-2.5 py-1.5 text-xs"
									>
										<span className="truncate font-medium">{mac.name}</span>
										<div className="flex items-center gap-1">
											<Button
												size="sm"
												tone="ghost"
												type="button"
												aria-label={`${t('mail.macros.edit')}: ${mac.name}`}
												onClick={() => {
													setEditingMacroId(mac.id)
													setMacroName(mac.name)
													const statusStep = mac.steps.find((st) => st.action === 'set_status')?.value
													if (statusStep === 'open' || statusStep === 'pending' || statusStep === 'closed') {
														setMacroStatus(statusStep)
													}
												}}
											>
												<Pencil className="size-3" aria-hidden />
											</Button>
											<Button
												size="sm"
												tone="ghost"
												type="button"
												aria-label={`${t('mail.macros.delete')}: ${mac.name}`}
												onClick={() => void removeMacro(mac.id)}
											>
												<Trash2 className="size-3" aria-hidden />
											</Button>
										</div>
									</li>
								))}
							</ul>
							<Input
								aria-label={t('mail.macros.name')}
								placeholder={t('mail.macros.name')}
								value={macroName}
								onChange={(e) => setMacroName(e.target.value)}
							/>
							<select
								aria-label={t('mail.macros.status-step')}
								value={macroStatus}
								onChange={(e) => setMacroStatus(e.target.value as 'open' | 'pending' | 'closed')}
								className="h-9 w-full rounded-md border border-border bg-background px-2.5 text-xs"
							>
								<option value="open">{t('mail.conv.status.open')}</option>
								<option value="pending">{t('mail.conv.status.pending')}</option>
								<option value="closed">{t('mail.conv.status.closed')}</option>
							</select>
						</SettingsCardBody>
						<SettingsCardFooter className="justify-end gap-2">
							{editingMacroId ? (
								<Button
									size="sm"
									tone="ghost"
									type="button"
									onClick={() => {
										setEditingMacroId(null)
										setMacroName('')
									}}
								>
									{t('mail.settings.cancel-edit')}
								</Button>
							) : null}
							<Button size="sm" tone="outline" type="submit" disabled={busy === 'macro' || !macroName.trim()}>
								{editingMacroId ? t('mail.macros.update') : t('mail.macros.create')}
							</Button>
						</SettingsCardFooter>
					</form>
				</SettingsCard>
			</div>
		</div>
	)
}
