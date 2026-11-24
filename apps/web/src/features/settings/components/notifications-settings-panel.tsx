import type {
	ChatNotificationLevel,
	EmailDigestFrequency,
	NotificationPreferencesDto,
	WebPushSubscriptionDto
} from '@huriro/contracts'
import { t } from '@huriro/i18n'
import { Bell, Trash2 } from 'lucide-react'
import { useEffect, useState } from 'react'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Checkbox } from '@/components/ui/checkbox'
import { Input } from '@/components/ui/input'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select'
import { Skeleton } from '@/components/ui/skeleton'
import { useWorkspace } from '@/lib/workspace'
import { useUiStore } from '@/stores/ui-store'

export function NotificationsSettingsPanel() {
	const { api } = useWorkspace()
	const pushToast = useUiStore((s) => s.pushToast)

	const [prefs, setPrefs] = useState<NotificationPreferencesDto | null>(null)
	const [subs, setSubs] = useState<WebPushSubscriptionDto[]>([])
	const [vapidPublicKey, setVapidPublicKey] = useState<string | null>(null)
	const [loading, setLoading] = useState(true)
	const [saving, setSaving] = useState(false)
	const [error, setError] = useState<string | null>(null)

	useEffect(() => {
		let cancelled = false
		void Promise.all([
			api.getNotificationPreferences(),
			api.listWebPushSubscriptions(),
			api.getVapidPublicKey()
		])
			.then(([p, list, key]) => {
				if (cancelled) return
				setPrefs(p)
				setSubs(list)
				setVapidPublicKey(key)
				setLoading(false)
			})
			.catch((err) => {
				if (cancelled) return
				setError(err instanceof Error ? err.message : 'Failed to load preferences')
				setLoading(false)
			})
		return () => {
			cancelled = true
		}
	}, [api])

	async function handleSave(ev: React.FormEvent) {
		ev.preventDefault()
		if (!prefs || saving) return
		setSaving(true)
		setError(null)
		try {
			const updated = await api.updateNotificationPreferences({
				chatLevel: prefs.chatLevel,
				emailDigestFrequency: prefs.emailDigestFrequency,
				quietHoursStart: prefs.quietHoursStart || null,
				quietHoursEnd: prefs.quietHoursEnd || null,
				timezone: prefs.timezone.trim() || 'UTC',
				webPushEnabled: prefs.webPushEnabled,
				mobilePushEnabled: prefs.mobilePushEnabled
			})
			setPrefs(updated)
			pushToast({ tone: 'success', title: t('settings.notifications.saved') })
		} catch (err) {
			setError(err instanceof Error ? err.message : 'Failed to save preferences')
		} finally {
			setSaving(false)
		}
	}

	async function handleRevokeSub(id: string) {
		try {
			await api.deleteWebPushSubscription(id)
			setSubs((prev) => prev.filter((s) => s.id !== id))
		} catch (err) {
			setError(err instanceof Error ? err.message : 'Failed to revoke push subscription')
		}
	}

	if (loading) {
		return (
			<div className="space-y-3 rounded-lg border border-border bg-card p-4">
				<Skeleton className="h-5 w-48" />
				<Skeleton className="h-24 w-full" />
			</div>
		)
	}

	if (!prefs) {
		return (
			<div
				role="alert"
				className="rounded-lg border border-destructive/40 bg-destructive/10 p-4 text-xs text-destructive"
			>
				{error ?? 'Failed to load notification preferences'}
			</div>
		)
	}

	return (
		<section
			aria-labelledby="notif-settings-heading"
			className="space-y-4 rounded-lg border border-border bg-card p-4"
		>
			<div className="flex items-start justify-between gap-2">
				<div>
					<h2 id="notif-settings-heading" className="flex items-center gap-2 text-sm font-semibold">
						<Bell className="size-4 text-muted-foreground" aria-hidden />
						<span>{t('settings.notifications.title')}</span>
					</h2>
					<p className="mt-0.5 text-xs text-muted-foreground">{t('settings.notifications.desc')}</p>
				</div>
				{vapidPublicKey ? <Badge tone="secondary">VAPID</Badge> : null}
			</div>

			<form onSubmit={(ev) => void handleSave(ev)} className="space-y-3">
				<div className="grid gap-3 sm:grid-cols-2">
					<div className="space-y-1">
						<label htmlFor="notif-chat-level" className="text-xs font-medium">
							{t('settings.notifications.chat-level')}
						</label>
						<Select
							value={prefs.chatLevel}
							onValueChange={(v) => setPrefs({ ...prefs, chatLevel: v as ChatNotificationLevel })}
						>
							<SelectTrigger id="notif-chat-level" aria-label={t('settings.notifications.chat-level')}>
								<SelectValue />
							</SelectTrigger>
							<SelectContent>
								<SelectItem value="all">{t('settings.notifications.level.all')}</SelectItem>
								<SelectItem value="mentions">{t('settings.notifications.level.mentions')}</SelectItem>
								<SelectItem value="none">{t('settings.notifications.level.none')}</SelectItem>
							</SelectContent>
						</Select>
					</div>

					<div className="space-y-1">
						<label htmlFor="notif-digest-freq" className="text-xs font-medium">
							{t('settings.notifications.digest')}
						</label>
						<Select
							value={prefs.emailDigestFrequency}
							onValueChange={(v) => setPrefs({ ...prefs, emailDigestFrequency: v as EmailDigestFrequency })}
						>
							<SelectTrigger id="notif-digest-freq" aria-label={t('settings.notifications.digest')}>
								<SelectValue />
							</SelectTrigger>
							<SelectContent>
								<SelectItem value="off">{t('settings.notifications.digest.off')}</SelectItem>
								<SelectItem value="hourly">{t('settings.notifications.digest.hourly')}</SelectItem>
								<SelectItem value="daily">{t('settings.notifications.digest.daily')}</SelectItem>
							</SelectContent>
						</Select>
					</div>

					<div className="space-y-1">
						<label htmlFor="notif-quiet-start" className="text-xs font-medium">
							{t('settings.notifications.quiet-start')}
						</label>
						<Input
							id="notif-quiet-start"
							placeholder="22:00"
							value={prefs.quietHoursStart ?? ''}
							onChange={(ev) => setPrefs({ ...prefs, quietHoursStart: ev.target.value || null })}
						/>
					</div>

					<div className="space-y-1">
						<label htmlFor="notif-quiet-end" className="text-xs font-medium">
							{t('settings.notifications.quiet-end')}
						</label>
						<Input
							id="notif-quiet-end"
							placeholder="07:00"
							value={prefs.quietHoursEnd ?? ''}
							onChange={(ev) => setPrefs({ ...prefs, quietHoursEnd: ev.target.value || null })}
						/>
					</div>
				</div>

				<div className="space-y-1">
					<label htmlFor="notif-timezone" className="text-xs font-medium">
						{t('settings.notifications.timezone')}
					</label>
					<Input
						id="notif-timezone"
						value={prefs.timezone}
						onChange={(ev) => setPrefs({ ...prefs, timezone: ev.target.value })}
					/>
				</div>

				<div className="flex items-center gap-2">
					<Checkbox
						id="notif-web-push"
						checked={prefs.webPushEnabled}
						onCheckedChange={(checked) => setPrefs({ ...prefs, webPushEnabled: checked === true })}
					/>
					<label htmlFor="notif-web-push" className="text-xs font-medium">
						{t('settings.notifications.web-push')}
					</label>
				</div>

				<div className="flex items-center gap-2">
					<Checkbox
						id="notif-mobile-push"
						checked={prefs.mobilePushEnabled}
						onCheckedChange={(checked) => setPrefs({ ...prefs, mobilePushEnabled: checked === true })}
					/>
					<label htmlFor="notif-mobile-push" className="text-xs font-medium">
						{t('settings.notifications.mobile-push')}
					</label>
				</div>

				{error ? (
					<p role="alert" className="text-xs text-destructive">
						{error}
					</p>
				) : null}

				<div className="flex justify-end">
					<Button size="sm" type="submit" loading={saving}>
						{t('settings.notifications.save')}
					</Button>
				</div>
			</form>

			{subs.length > 0 ? (
				<div className="space-y-2 border-t border-border pt-3">
					<h3 className="text-xs font-semibold text-muted-foreground">
						{t('settings.notifications.push-devices', { count: subs.length })}
					</h3>
					{subs.map((sub) => (
						<div
							key={sub.id}
							className="flex items-center justify-between gap-2 rounded-md border border-border bg-muted/40 px-3 py-2 text-xs"
						>
							<span className="truncate font-mono">{sub.endpoint}</span>
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
			) : null}
		</section>
	)
}
