import type {
	ChatNotificationLevel,
	EmailDigestFrequency,
	EmailPipelineStatusDto,
	NotificationPreferencesDto,
	WebPushSubscriptionDto
} from '@huriro/contracts'
import { t } from '@huriro/i18n'
import { Bell, Globe, Mail, Smartphone, Trash2 } from 'lucide-react'
import { useCallback, useEffect, useState } from 'react'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Checkbox } from '@/components/ui/checkbox'
import { Input } from '@/components/ui/input'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select'
import { useWorkspace } from '@/lib/workspace'
import { useUiStore } from '@/stores/ui-store'
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

export function NotificationsSettingsPanel() {
	const { api } = useWorkspace()
	const pushToast = useUiStore((s) => s.pushToast)

	const [prefs, setPrefs] = useState<NotificationPreferencesDto | null>(null)
	const [savedPrefs, setSavedPrefs] = useState<NotificationPreferencesDto | null>(null)
	const [subs, setSubs] = useState<WebPushSubscriptionDto[]>([])
	const [vapidPublicKey, setVapidPublicKey] = useState<string | null>(null)
	const [emailStatus, setEmailStatus] = useState<EmailPipelineStatusDto | null>(null)
	const [testRecipient, setTestRecipient] = useState('')
	const [sendingTest, setSendingTest] = useState(false)
	const [testNotice, setTestNotice] = useState<{
		readonly tone: 'success' | 'danger'
		readonly message: string
	} | null>(null)
	const [loading, setLoading] = useState(true)
	const [saving, setSaving] = useState(false)
	const [error, setError] = useState<string | null>(null)

	const loadPreferences = useCallback(() => {
		setLoading(true)
		setError(null)
		void Promise.all([
			api.getNotificationPreferences(),
			api.listWebPushSubscriptions(),
			api.getVapidPublicKey(),
			api.getEmailStatus().catch(() => null)
		])
			.then(([p, list, key, mailStatus]) => {
				setPrefs(p)
				setSavedPrefs(p)
				setSubs(list)
				setVapidPublicKey(key)
				setEmailStatus(mailStatus)
				setLoading(false)
			})
			.catch((err) => {
				setError(err instanceof Error ? err.message : 'Failed to load preferences')
				setLoading(false)
			})
	}, [api])

	useEffect(() => {
		loadPreferences()
	}, [loadPreferences])

	async function handleSave(ev: React.FormEvent) {
		ev.preventDefault()
		if (!prefs || saving) return
		setSaving(true)
		setError(null)
		try {
			const updated = await api.updateNotificationPreferences({
				chatLevel: prefs.chatLevel,
				emailDigestFrequency: prefs.emailDigestFrequency,
				emailInstantEnabled: prefs.emailInstantEnabled,
				quietHoursStart: prefs.quietHoursStart || null,
				quietHoursEnd: prefs.quietHoursEnd || null,
				timezone: prefs.timezone.trim() || 'UTC',
				webPushEnabled: prefs.webPushEnabled,
				mobilePushEnabled: prefs.mobilePushEnabled
			})
			setPrefs(updated)
			setSavedPrefs(updated)
			pushToast({ tone: 'success', title: t('settings.notifications.saved') })
		} catch (err) {
			setError(err instanceof Error ? err.message : 'Failed to save preferences')
		} finally {
			setSaving(false)
		}
	}

	async function handleSendTestEmail(ev: React.FormEvent) {
		ev.preventDefault()
		if (sendingTest) return
		setSendingTest(true)
		setTestNotice(null)
		try {
			const recipient = testRecipient.trim() || undefined
			const res = await api.sendTestEmail(recipient)
			const message = t('settings.notifications.email-test-sent', {
				recipient: res.to,
				provider: res.provider
			})
			setTestNotice({ tone: 'success', message })
			pushToast({ tone: 'success', title: message })
		} catch (err) {
			setTestNotice({
				tone: 'danger',
				message: err instanceof Error ? err.message : t('settings.notifications.email-test-failed')
			})
		} finally {
			setSendingTest(false)
		}
	}

	async function handleRevokeSub(id: string) {
		setError(null)
		try {
			await api.deleteWebPushSubscription(id)
			setSubs((prev) => prev.filter((s) => s.id !== id))
		} catch (err) {
			setError(err instanceof Error ? err.message : 'Failed to revoke push subscription')
		}
	}

	function handleUseLocalTimezone() {
		if (!prefs) return
		try {
			const localTz = Intl.DateTimeFormat().resolvedOptions().timeZone
			if (localTz) setPrefs({ ...prefs, timezone: localTz })
		} catch {
			// Fallback: leave current timezone unchanged if Intl lookup fails.
		}
	}

	if (loading) {
		return <SettingsSkeleton rows={4} />
	}

	if (!prefs) {
		return (
			<SettingsNotice
				tone="danger"
				action={
					<Button type="button" size="sm" tone="outline" onClick={loadPreferences}>
						{t('error.retry')}
					</Button>
				}
			>
				{error ?? 'Failed to load notification preferences'}
			</SettingsNotice>
		)
	}

	const isDirty =
		savedPrefs !== null &&
		(prefs.chatLevel !== savedPrefs.chatLevel ||
			prefs.emailDigestFrequency !== savedPrefs.emailDigestFrequency ||
			prefs.emailInstantEnabled !== savedPrefs.emailInstantEnabled ||
			(prefs.quietHoursStart ?? '') !== (savedPrefs.quietHoursStart ?? '') ||
			(prefs.quietHoursEnd ?? '') !== (savedPrefs.quietHoursEnd ?? '') ||
			prefs.timezone !== savedPrefs.timezone ||
			prefs.webPushEnabled !== savedPrefs.webPushEnabled ||
			prefs.mobilePushEnabled !== savedPrefs.mobilePushEnabled)

	return (
		<div className="space-y-5">
			<SettingsCard labelledBy="notif-settings-heading">
				<SettingsCardHeader
					headingId="notif-settings-heading"
					icon={<Bell className="size-4" />}
					title={t('settings.notifications.title')}
					description={t('settings.notifications.desc')}
					badge={
						vapidPublicKey ? <Badge tone="success">{t('settings.notifications.vapid-ready')}</Badge> : null
					}
				/>

				<form onSubmit={(ev) => void handleSave(ev)}>
					<SettingsCardBody className="space-y-6">
						<div className="space-y-3">
							<h3 className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">
								{t('settings.notifications.section-delivery')}
							</h3>
							<div className="divide-y divide-border/70">
								<SettingsRow label={t('settings.notifications.chat-level')} htmlFor="notif-chat-level">
									<Select
										value={prefs.chatLevel}
										onValueChange={(v) => setPrefs({ ...prefs, chatLevel: v as ChatNotificationLevel })}
									>
										<SelectTrigger
											id="notif-chat-level"
											aria-label={t('settings.notifications.chat-level')}
											className="sm:w-56"
										>
											<SelectValue />
										</SelectTrigger>
										<SelectContent>
											<SelectItem value="all">{t('settings.notifications.level.all')}</SelectItem>
											<SelectItem value="mentions">{t('settings.notifications.level.mentions')}</SelectItem>
											<SelectItem value="none">{t('settings.notifications.level.none')}</SelectItem>
										</SelectContent>
									</Select>
								</SettingsRow>

								<SettingsRow label={t('settings.notifications.digest')} htmlFor="notif-digest-freq">
									<Select
										value={prefs.emailDigestFrequency}
										onValueChange={(v) =>
											setPrefs({ ...prefs, emailDigestFrequency: v as EmailDigestFrequency })
										}
									>
										<SelectTrigger
											id="notif-digest-freq"
											aria-label={t('settings.notifications.digest')}
											className="sm:w-56"
										>
											<SelectValue />
										</SelectTrigger>
										<SelectContent>
											<SelectItem value="off">{t('settings.notifications.digest.off')}</SelectItem>
											<SelectItem value="hourly">{t('settings.notifications.digest.hourly')}</SelectItem>
											<SelectItem value="daily">{t('settings.notifications.digest.daily')}</SelectItem>
										</SelectContent>
									</Select>
								</SettingsRow>
							</div>

							<label
								htmlFor="notif-email-instant"
								className="flex cursor-pointer items-start gap-3 rounded-lg border border-border bg-surface-2/40 px-3.5 py-2.5 text-xs transition-colors hover:bg-accent/50"
							>
								<Checkbox
									id="notif-email-instant"
									className="mt-0.5"
									checked={prefs.emailInstantEnabled}
									onCheckedChange={(checked) => setPrefs({ ...prefs, emailInstantEnabled: checked === true })}
								/>
								<span className="min-w-0 flex-1 space-y-0.5">
									<span className="block font-medium text-foreground">
										{t('settings.notifications.email-instant')}
									</span>
									<span className="block text-muted-foreground">
										{t('settings.notifications.email-instant-hint')}
									</span>
								</span>
							</label>
						</div>

						<div className="space-y-3 border-t border-border/70 pt-5">
							<h3 className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">
								{t('settings.notifications.section-quiet')}
							</h3>
							<div className="grid gap-3 sm:grid-cols-2">
								<div className="space-y-1.5">
									<label htmlFor="notif-quiet-start" className="text-xs font-medium text-foreground">
										{t('settings.notifications.quiet-start')}
									</label>
									<Input
										id="notif-quiet-start"
										placeholder="22:00"
										className="font-mono tnum"
										value={prefs.quietHoursStart ?? ''}
										onChange={(ev) => setPrefs({ ...prefs, quietHoursStart: ev.target.value || null })}
									/>
								</div>

								<div className="space-y-1.5">
									<label htmlFor="notif-quiet-end" className="text-xs font-medium text-foreground">
										{t('settings.notifications.quiet-end')}
									</label>
									<Input
										id="notif-quiet-end"
										placeholder="07:00"
										className="font-mono tnum"
										value={prefs.quietHoursEnd ?? ''}
										onChange={(ev) => setPrefs({ ...prefs, quietHoursEnd: ev.target.value || null })}
									/>
								</div>
							</div>

							<div className="space-y-1.5">
								<label htmlFor="notif-timezone" className="text-xs font-medium text-foreground">
									{t('settings.notifications.timezone')}
								</label>
								<div className="flex flex-wrap gap-2">
									<Input
										id="notif-timezone"
										className="min-w-0 flex-1"
										value={prefs.timezone}
										onChange={(ev) => setPrefs({ ...prefs, timezone: ev.target.value })}
									/>
									<Button type="button" size="sm" tone="outline" onClick={handleUseLocalTimezone}>
										<Globe className="size-3.5" aria-hidden />
										<span>{t('settings.notifications.detect-timezone')}</span>
									</Button>
								</div>
							</div>
						</div>

						<div className="space-y-3 border-t border-border/70 pt-5">
							<h3 className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">
								{t('settings.notifications.section-push')}
							</h3>
							<div className="grid gap-2.5 sm:grid-cols-2">
								<label
									htmlFor="notif-web-push"
									className="flex cursor-pointer items-center gap-3 rounded-lg border border-border bg-surface-2/40 px-3.5 py-2.5 text-xs font-medium text-foreground transition-colors hover:bg-accent/50"
								>
									<Checkbox
										id="notif-web-push"
										checked={prefs.webPushEnabled}
										onCheckedChange={(checked) => setPrefs({ ...prefs, webPushEnabled: checked === true })}
									/>
									<span>{t('settings.notifications.web-push')}</span>
								</label>

								<label
									htmlFor="notif-mobile-push"
									className="flex cursor-pointer items-center gap-3 rounded-lg border border-border bg-surface-2/40 px-3.5 py-2.5 text-xs font-medium text-foreground transition-colors hover:bg-accent/50"
								>
									<Checkbox
										id="notif-mobile-push"
										checked={prefs.mobilePushEnabled}
										onCheckedChange={(checked) => setPrefs({ ...prefs, mobilePushEnabled: checked === true })}
									/>
									<span>{t('settings.notifications.mobile-push')}</span>
								</label>
							</div>
						</div>

						{error ? <SettingsNotice tone="danger">{error}</SettingsNotice> : null}
					</SettingsCardBody>

					<SettingsCardFooter>
						<div>{isDirty ? <Badge tone="warning">{t('settings.common.unsaved')}</Badge> : null}</div>
						<Button size="sm" type="submit" loading={saving}>
							{t('settings.notifications.save')}
						</Button>
					</SettingsCardFooter>
				</form>
			</SettingsCard>

			<SettingsCard labelledBy="notif-email-delivery-heading">
				<SettingsCardHeader
					headingId="notif-email-delivery-heading"
					icon={<Mail className="size-4" />}
					title={t('settings.notifications.email-delivery-title')}
					description={t('settings.notifications.email-delivery-desc')}
					badge={
						emailStatus ? (
							<Badge tone={emailStatus.configured ? 'success' : 'warning'}>
								{emailStatus.configured
									? t('settings.notifications.email-status-configured')
									: t('settings.notifications.email-status-unconfigured')}
							</Badge>
						) : null
					}
				/>
				<SettingsCardBody>
					<div className="grid gap-3 sm:grid-cols-2">
						<div className="rounded-lg border border-border bg-surface-2/40 px-3.5 py-2.5">
							<p className="text-[11px] font-medium text-muted-foreground">
								{t('settings.notifications.email-provider')}
							</p>
							<p className="mt-1 font-mono text-xs font-semibold uppercase text-foreground">
								{emailStatus?.provider ?? 'noop'}
							</p>
						</div>
						<div className="rounded-lg border border-border bg-surface-2/40 px-3.5 py-2.5">
							<p className="text-[11px] font-medium text-muted-foreground">
								{t('settings.notifications.email-from')}
							</p>
							<p className="mt-1 truncate font-mono text-xs font-semibold text-foreground">
								{emailStatus?.from ?? 'noreply@huriro.local'}
							</p>
						</div>
					</div>

					{emailStatus && !emailStatus.configured ? (
						<SettingsNotice tone="warning">
							{t('settings.notifications.email-unconfigured-hint')}
						</SettingsNotice>
					) : null}

					<form onSubmit={(ev) => void handleSendTestEmail(ev)} className="space-y-2">
						<label htmlFor="notif-email-test-to" className="block text-xs font-medium text-foreground">
							{t('settings.notifications.email-test-recipient')}
						</label>
						<div className="flex flex-wrap gap-2">
							<Input
								id="notif-email-test-to"
								type="email"
								value={testRecipient}
								onChange={(ev) => setTestRecipient(ev.target.value)}
								placeholder={t('settings.notifications.email-test-placeholder')}
								disabled={!emailStatus?.configured || sendingTest}
								className="min-w-0 flex-1"
							/>
							<Button
								type="submit"
								size="sm"
								tone="outline"
								loading={sendingTest}
								disabled={!emailStatus?.configured}
							>
								<Mail className="size-3.5" aria-hidden />
								<span>
									{sendingTest
										? t('settings.notifications.email-test-sending')
										: t('settings.notifications.email-test-send')}
								</span>
							</Button>
						</div>
					</form>

					{testNotice ? <SettingsNotice tone={testNotice.tone}>{testNotice.message}</SettingsNotice> : null}
				</SettingsCardBody>
			</SettingsCard>

			<SettingsCard labelledBy="notif-push-devices-heading">
				<SettingsCardHeader
					headingId="notif-push-devices-heading"
					icon={<Smartphone className="size-4" />}
					title={t('settings.notifications.push-devices', { count: subs.length })}
					badge={vapidPublicKey ? <Badge tone="secondary">VAPID</Badge> : null}
				/>
				<SettingsCardBody>
					{subs.length === 0 ? (
						<SettingsEmptyState
							icon={<Smartphone className="size-4" />}
							message={t('settings.notifications.push-empty')}
						/>
					) : (
						<div className="space-y-2">
							{subs.map((sub) => (
								<div
									key={sub.id}
									className="flex items-center justify-between gap-2 rounded-lg border border-border bg-surface-2/40 px-3.5 py-2.5 text-xs"
								>
									<span className="truncate font-mono text-foreground">{sub.endpoint}</span>
									<Button
										size="icon"
										tone="ghost"
										type="button"
										aria-label={t('settings.notifications.push-revoke')}
										onClick={() => void handleRevokeSub(sub.id)}
									>
										<Trash2 className="size-3.5 text-destructive" aria-hidden />
									</Button>
								</div>
							))}
						</div>
					)}
				</SettingsCardBody>
			</SettingsCard>
		</div>
	)
}
