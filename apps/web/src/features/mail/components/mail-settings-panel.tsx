import type { MailAccountDto, MailInboxDto } from '@huriro/contracts'
import { t } from '@huriro/i18n'
import { Inbox, Mail, RefreshCw, ShieldCheck } from 'lucide-react'
import { useEffect, useState } from 'react'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select'
import {
	CopyableSecretField,
	SettingsCard,
	SettingsCardBody,
	SettingsCardFooter,
	SettingsCardHeader,
	SettingsEmptyState,
	SettingsNotice,
	SettingsSkeleton
} from '@/features/settings/components/settings-primitives'
import { useWorkspace } from '@/lib/workspace'
import { MailV2SettingsSection } from './mail-v2-settings-section'

const PROVIDERS = ['inbound_parse', 'imap', 'jmap', 'gmail', 'graph'] as const

function statusTone(status: MailAccountDto['status']): 'success' | 'warning' | 'danger' | 'secondary' {
	if (status === 'active') return 'success'
	if (status === 'pending_verification') return 'warning'
	if (status === 'error') return 'danger'
	return 'secondary'
}

export function MailSettingsPanel() {
	const { api } = useWorkspace()
	const [accounts, setAccounts] = useState<MailAccountDto[]>([])
	const [inboxes, setInboxes] = useState<MailInboxDto[]>([])
	const [loading, setLoading] = useState(true)
	const [busy, setBusy] = useState<string | null>(null)
	const [form, setForm] = useState<{ provider: string; address: string; displayName: string }>({
		provider: 'inbound_parse',
		address: '',
		displayName: ''
	})
	const [inboxName, setInboxName] = useState('')
	const [inboxVisibility, setInboxVisibility] = useState<'shared' | 'private'>('shared')
	const [notice, setNotice] = useState<string | null>(null)
	const [error, setError] = useState<string | null>(null)

	useEffect(() => {
		let cancelled = false
		void Promise.all([api.listMailAccounts(), api.listMailInboxes()])
			.then(([a, i]) => {
				if (!cancelled) {
					setAccounts(a)
					setInboxes(i)
					setLoading(false)
				}
			})
			.catch((err) => {
				if (!cancelled) {
					setError(err instanceof Error ? err.message : t('mail.error.load'))
					setLoading(false)
				}
			})
		return () => {
			cancelled = true
		}
	}, [api])

	const createAccount = async (ev: React.FormEvent) => {
		ev.preventDefault()
		if (busy || form.address.trim().length < 3) return
		setBusy('create-account')
		setError(null)
		try {
			const account = await api.createMailAccount({
				provider: form.provider as MailAccountDto['provider'],
				address: form.address.trim(),
				...(form.displayName.trim() ? { displayName: form.displayName.trim() } : {})
			})
			setAccounts((prev) => [...prev, account])
			setForm((f) => ({ ...f, address: '', displayName: '' }))
			setNotice(t('mail.settings.account-created'))
		} catch (err) {
			setError(err instanceof Error ? err.message : 'Failed to create mail account')
		} finally {
			setBusy(null)
		}
	}

	const createInbox = async (ev: React.FormEvent) => {
		ev.preventDefault()
		if (busy || inboxName.trim().length === 0) return
		setBusy('create-inbox')
		setError(null)
		try {
			const inbox = await api.createMailInbox({
				name: inboxName.trim(),
				visibility: inboxVisibility
			})
			setInboxes((prev) => [...prev, inbox])
			setInboxName('')
			setInboxVisibility('shared')
			setNotice(t('mail.settings.inbox-created'))
		} catch (err) {
			setError(err instanceof Error ? err.message : 'Failed to create shared inbox')
		} finally {
			setBusy(null)
		}
	}

	if (loading) {
		return <SettingsSkeleton rows={3} />
	}

	return (
		<div className="space-y-5">
			{notice ? (
				<SettingsNotice tone="success" onDismiss={() => setNotice(null)}>
					{notice}
				</SettingsNotice>
			) : null}

			{error ? <SettingsNotice tone="danger">{error}</SettingsNotice> : null}

			<SettingsCard labelledBy="mail-settings-heading">
				<SettingsCardHeader
					headingId="mail-settings-heading"
					icon={<Mail className="size-4" />}
					title={t('mail.settings.title')}
					description={t('settings.mail.desc')}
					badge={
						<Badge tone="secondary" className="tnum">
							{accounts.length}
						</Badge>
					}
				/>
				<SettingsCardBody>
					{accounts.length === 0 ? (
						<SettingsEmptyState icon={<Mail className="size-4" />} message={t('mail.settings.empty')} />
					) : (
						<ul className="space-y-3">
							{accounts.map((account) => (
								<li
									key={account.id}
									className="space-y-3 rounded-lg border border-border bg-surface-2/40 p-4 text-xs"
								>
									<div className="flex flex-wrap items-center justify-between gap-2">
										<div className="min-w-0">
											<div className="flex flex-wrap items-center gap-2">
												<span className="text-sm font-semibold text-foreground">
													{account.displayName ?? account.address}
												</span>
												<Badge tone={statusTone(account.status)}>{account.status}</Badge>
												<Badge tone="outline" className="font-mono">
													{account.provider}
												</Badge>
											</div>
											<p className="mt-0.5 font-mono text-muted-foreground">{account.address}</p>
										</div>
										<div className="flex flex-wrap gap-1.5">
											<Button
												size="sm"
												tone="outline"
												type="button"
												disabled={busy === `sync-${account.id}`}
												onClick={() => {
													setBusy(`sync-${account.id}`)
													void api.syncMailAccount(account.id).finally(() => setBusy(null))
												}}
											>
												<RefreshCw className="size-3.5" aria-hidden />
												<span>{t('mail.settings.sync-now')}</span>
											</Button>
											{account.provider === 'inbound_parse' ? (
												<Button
													size="sm"
													tone="outline"
													type="button"
													disabled={busy === `verify-${account.id}`}
													onClick={() => {
														setBusy(`verify-${account.id}`)
														void api
															.verifyMailAccountDomain(account.id)
															.then((res) => {
																setAccounts((prev) =>
																	prev.map((a) =>
																		a.id === account.id
																			? { ...a, status: res.verified ? 'active' : a.status }
																			: a
																	)
																)
															})
															.finally(() => setBusy(null))
													}}
												>
													<ShieldCheck className="size-3.5" aria-hidden />
													<span>{t('mail.settings.verify-domain')}</span>
												</Button>
											) : null}
										</div>
									</div>

									{account.inboundUrl ? (
										<div className="space-y-1">
											<p className="font-medium text-muted-foreground">{t('mail.settings.inbound-url')}</p>
											<CopyableSecretField
												value={account.inboundUrl}
												label={t('mail.settings.inbound-url')}
											/>
										</div>
									) : null}

									{account.domainRecords && account.domainRecords.length > 0 ? (
										<div className="space-y-1.5">
											<p className="font-medium text-muted-foreground">{t('mail.settings.domain-records')}</p>
											<div className="overflow-x-auto rounded-md border border-border bg-background">
												<table className="w-full border-collapse text-left text-xs">
													<thead>
														<tr className="border-b border-border bg-surface-2/60">
															<th scope="col" className="px-2.5 py-1.5 font-medium text-muted-foreground">
																{t('settings.mail.dns-type')}
															</th>
															<th scope="col" className="px-2.5 py-1.5 font-medium text-muted-foreground">
																{t('settings.mail.dns-host')}
															</th>
															<th scope="col" className="px-2.5 py-1.5 font-medium text-muted-foreground">
																{t('settings.mail.dns-value')}
															</th>
														</tr>
													</thead>
													<tbody className="divide-y divide-border/70 font-mono">
														{account.domainRecords.map((r) => (
															<tr key={`${r['kind']}-${r['host']}`}>
																<td className="px-2.5 py-1.5 text-foreground">{String(r['kind'])}</td>
																<td className="px-2.5 py-1.5 text-muted-foreground">{String(r['host'])}</td>
																<td className="px-2.5 py-1.5 break-all text-foreground">
																	{String(r['value'])}
																</td>
															</tr>
														))}
													</tbody>
												</table>
											</div>
										</div>
									) : null}
								</li>
							))}
						</ul>
					)}

					<form
						onSubmit={(ev) => void createAccount(ev)}
						className="space-y-3 border-t border-border/70 pt-4"
					>
						<h3 className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">
							{t('mail.settings.add-account')}
						</h3>
						<div className="grid gap-3 sm:grid-cols-3">
							<div className="space-y-1.5">
								<label htmlFor="mail-account-provider" className="text-xs font-medium text-foreground">
									{t('mail.settings.provider')}
								</label>
								<Select value={form.provider} onValueChange={(v) => setForm((f) => ({ ...f, provider: v }))}>
									<SelectTrigger id="mail-account-provider" aria-label={t('mail.settings.provider')}>
										<SelectValue />
									</SelectTrigger>
									<SelectContent>
										{PROVIDERS.map((p) => (
											<SelectItem key={p} value={p}>
												{p}
											</SelectItem>
										))}
									</SelectContent>
								</Select>
							</div>
							<div className="space-y-1.5">
								<label htmlFor="mail-account-address" className="text-xs font-medium text-foreground">
									{t('mail.settings.address')}
								</label>
								<Input
									id="mail-account-address"
									placeholder="support@company.com"
									value={form.address}
									onChange={(e) => setForm((f) => ({ ...f, address: e.target.value }))}
								/>
							</div>
							<div className="space-y-1.5">
								<label htmlFor="mail-account-display" className="text-xs font-medium text-foreground">
									{t('mail.settings.display-name')}
								</label>
								<Input
									id="mail-account-display"
									placeholder="Support"
									value={form.displayName}
									onChange={(e) => setForm((f) => ({ ...f, displayName: e.target.value }))}
								/>
							</div>
						</div>
						<div className="flex justify-end">
							<Button
								size="sm"
								type="submit"
								loading={busy === 'create-account'}
								disabled={busy === 'create-account' || form.address.trim().length < 3}
							>
								{t('mail.settings.add-account')}
							</Button>
						</div>
					</form>
				</SettingsCardBody>
			</SettingsCard>

			<SettingsCard labelledBy="mail-inboxes-heading">
				<SettingsCardHeader
					headingId="mail-inboxes-heading"
					icon={<Inbox className="size-4" />}
					title={t('settings.mail.inboxes-title')}
					badge={
						<Badge tone="secondary" className="tnum">
							{inboxes.length}
						</Badge>
					}
				/>
				<form onSubmit={(ev) => void createInbox(ev)}>
					<SettingsCardBody>
						{inboxes.length === 0 ? (
							<SettingsEmptyState
								icon={<Inbox className="size-4" />}
								message={t('settings.mail.inboxes-empty')}
							/>
						) : (
							<ul className="flex flex-wrap gap-2">
								{inboxes.map((inbox) => (
									<li key={inbox.id}>
										<Badge tone="outline" className="px-2.5 py-1 text-xs">
											{inbox.name}
										</Badge>
									</li>
								))}
							</ul>
						)}

						<div className="grid gap-3 pt-1 sm:grid-cols-2">
							<div className="space-y-1.5">
								<label htmlFor="mail-inbox-name" className="text-xs font-medium text-foreground">
									{t('settings.mail.inbox-name-label')}
								</label>
								<Input
									id="mail-inbox-name"
									placeholder={t('mail.settings.inboxes')}
									value={inboxName}
									onChange={(e) => setInboxName(e.target.value)}
								/>
							</div>
							<div className="space-y-1.5">
								<label htmlFor="mail-inbox-visibility" className="text-xs font-medium text-foreground">
									{t('mail.inbox.visibility')}
								</label>
								<select
									id="mail-inbox-visibility"
									value={inboxVisibility}
									onChange={(e) => setInboxVisibility(e.target.value as 'shared' | 'private')}
									className="h-9 w-full rounded-md border border-border bg-background px-2.5 text-sm"
								>
									<option value="shared">{t('mail.inbox.visibility.shared')}</option>
									<option value="private">{t('mail.inbox.visibility.private')}</option>
								</select>
							</div>
						</div>
					</SettingsCardBody>
					<SettingsCardFooter className="justify-end">
						<Button
							size="sm"
							tone="outline"
							type="submit"
							loading={busy === 'create-inbox'}
							disabled={busy === 'create-inbox' || inboxName.trim().length === 0}
						>
							{t('mail.settings.add-inbox')}
						</Button>
					</SettingsCardFooter>
				</form>
			</SettingsCard>

			<MailV2SettingsSection inboxes={inboxes} onNotice={setNotice} onError={setError} />
		</div>
	)
}
