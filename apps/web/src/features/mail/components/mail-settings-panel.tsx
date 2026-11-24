import type { MailAccountDto, MailInboxDto } from '@huriro/contracts'
import { t } from '@huriro/i18n'
import { Copy, RefreshCw, ShieldCheck } from 'lucide-react'
import { useEffect, useState } from 'react'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select'
import { useWorkspace } from '@/lib/workspace'

const PROVIDERS = ['inbound_parse', 'imap', 'gmail', 'graph'] as const

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
	const [notice, setNotice] = useState<string | null>(null)

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
			.catch(() => {
				if (!cancelled) setLoading(false)
			})
		return () => {
			cancelled = true
		}
	}, [api])

	const createAccount = async () => {
		setBusy('create-account')
		try {
			const account = await api.createMailAccount({
				provider: form.provider as MailAccountDto['provider'],
				address: form.address.trim(),
				...(form.displayName.trim() ? { displayName: form.displayName.trim() } : {})
			})
			setAccounts((prev) => [...prev, account])
			setForm((f) => ({ ...f, address: '', displayName: '' }))
			setNotice(t('mail.settings.account-created'))
		} finally {
			setBusy(null)
		}
	}

	const createInbox = async () => {
		setBusy('create-inbox')
		try {
			const inbox = await api.createMailInbox({ name: inboxName.trim() })
			setInboxes((prev) => [...prev, inbox])
			setInboxName('')
			setNotice(t('mail.settings.inbox-created'))
		} finally {
			setBusy(null)
		}
	}

	return (
		<section className="space-y-4 rounded-lg border border-border bg-card p-4">
			<h2 className="text-sm font-medium">{t('mail.settings.title')}</h2>

			{loading ? (
				<p className="text-sm text-muted-foreground">{t('mail.list.loading')}</p>
			) : (
				<>
					{accounts.length === 0 ? (
						<p className="text-sm text-muted-foreground">{t('mail.settings.empty')}</p>
					) : (
						<ul className="space-y-2">
							{accounts.map((account) => (
								<li key={account.id} className="rounded-md border border-border p-3">
									<div className="flex flex-wrap items-center gap-2">
										<span className="text-sm font-medium">{account.displayName ?? account.address}</span>
										<Badge tone={statusTone(account.status)}>{account.status}</Badge>
										<span className="text-xs text-muted-foreground">{account.provider}</span>
										<span className="ml-auto flex gap-1">
											<Button
												size="sm"
												tone="outline"
												disabled={busy === `sync-${account.id}`}
												onClick={() => {
													setBusy(`sync-${account.id}`)
													void api.syncMailAccount(account.id).finally(() => setBusy(null))
												}}
											>
												<RefreshCw className="size-3.5" aria-hidden />
												{t('mail.settings.sync-now')}
											</Button>
											{account.provider === 'inbound_parse' ? (
												<Button
													size="sm"
													tone="outline"
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
													{t('mail.settings.verify-domain')}
												</Button>
											) : null}
										</span>
									</div>
									<p className="mt-1 text-xs text-muted-foreground">{account.address}</p>
									{account.inboundUrl ? (
										<div className="mt-2 flex items-center gap-2 rounded bg-muted px-2 py-1.5">
											<code className="min-w-0 flex-1 truncate text-xs">{account.inboundUrl}</code>
											<button
												type="button"
												className="shrink-0 text-muted-foreground hover:text-foreground"
												aria-label={t('mail.settings.inbound-url')}
												onClick={() => void navigator.clipboard.writeText(account.inboundUrl ?? '')}
											>
												<Copy className="size-3.5" aria-hidden />
											</button>
										</div>
									) : null}
									{account.domainRecords && account.domainRecords.length > 0 ? (
										<div className="mt-2 space-y-1">
											<p className="text-xs font-medium text-muted-foreground">
												{t('mail.settings.domain-records')}
											</p>
											{account.domainRecords.map((r) => (
												<code key={`${r['kind']}-${r['host']}`} className="block truncate text-xs">
													{r['kind']} {r['host']} → {r['value']}
												</code>
											))}
										</div>
									) : null}
								</li>
							))}
						</ul>
					)}

					<div className="space-y-2">
						<h3 className="text-xs font-medium uppercase tracking-wide text-muted-foreground">
							{t('mail.settings.add-account')}
						</h3>
						<div className="flex flex-wrap items-center gap-2">
							<Select value={form.provider} onValueChange={(v) => setForm((f) => ({ ...f, provider: v }))}>
								<SelectTrigger className="h-9 w-40" aria-label={t('mail.settings.provider')}>
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
							<Input
								className="h-9 w-56"
								placeholder={t('mail.settings.address')}
								aria-label={t('mail.settings.address')}
								value={form.address}
								onChange={(e) => setForm((f) => ({ ...f, address: e.target.value }))}
							/>
							<Input
								className="h-9 w-40"
								placeholder={t('mail.settings.display-name')}
								aria-label={t('mail.settings.display-name')}
								value={form.displayName}
								onChange={(e) => setForm((f) => ({ ...f, displayName: e.target.value }))}
							/>
							<Button
								size="sm"
								disabled={busy === 'create-account' || form.address.trim().length < 3}
								onClick={() => void createAccount()}
							>
								{t('mail.settings.add-account')}
							</Button>
						</div>
					</div>

					<div className="space-y-2">
						<h3 className="text-xs font-medium uppercase tracking-wide text-muted-foreground">
							{t('mail.settings.inboxes')}
						</h3>
						<ul className="flex flex-wrap gap-1.5">
							{inboxes.map((inbox) => (
								<li key={inbox.id}>
									<Badge tone="outline">{inbox.name}</Badge>
								</li>
							))}
						</ul>
						<div className="flex items-center gap-2">
							<Input
								className="h-9 w-56"
								placeholder={t('mail.settings.inboxes')}
								aria-label={t('mail.settings.inboxes')}
								value={inboxName}
								onChange={(e) => setInboxName(e.target.value)}
							/>
							<Button
								size="sm"
								tone="outline"
								disabled={busy === 'create-inbox' || inboxName.trim().length === 0}
								onClick={() => void createInbox()}
							>
								{t('mail.settings.add-inbox')}
							</Button>
						</div>
					</div>

					{notice ? <p className="text-sm text-(--success)">{notice}</p> : null}
				</>
			)}
		</section>
	)
}
