import type {
	ManualAvailabilityState,
	UpdateMyAvailabilityBody,
	UserAvailabilityDto
} from '@huriro/contracts'
import { type MessageId, t } from '@huriro/i18n'
import { BellOff, Check, Sparkles } from 'lucide-react'
import { type FormEvent, useEffect, useState } from 'react'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Checkbox } from '@/components/ui/checkbox'
import { Input } from '@/components/ui/input'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select'
import { AVAILABILITY_STATE_LABEL_ID, AvailabilityDot, availabilityStateTone } from '@/features/availability'
import { navigateToSettingsSection } from '@/lib/navigation'
import { cn } from '@/lib/utils'
import { useUiStore } from '@/stores/ui-store'
import {
	SettingsCard,
	SettingsCardBody,
	SettingsCardFooter,
	SettingsCardHeader,
	SettingsNotice,
	SettingsRow
} from '../settings-primitives'

export interface AvailabilityStatusCardProps {
	readonly profile: UserAvailabilityDto
	readonly onSave: (patch: UpdateMyAvailabilityBody) => Promise<void>
}

type DurationChoice = 'forever' | '30m' | '1h' | '4h' | 'today' | 'tomorrow'

const MANUAL_STATES: readonly {
	readonly value: ManualAvailabilityState
	readonly dot: 'available' | 'busy' | 'dnd' | 'away' | 'ooo'
	readonly labelId: MessageId
}[] = [
	{ value: 'auto', dot: 'available', labelId: 'availability.manual.auto' },
	{ value: 'available', dot: 'available', labelId: 'availability.manual.available' },
	{ value: 'busy', dot: 'busy', labelId: 'availability.manual.busy' },
	{ value: 'dnd', dot: 'dnd', labelId: 'availability.manual.dnd' },
	{ value: 'away', dot: 'away', labelId: 'availability.manual.away' },
	{ value: 'ooo', dot: 'ooo', labelId: 'availability.manual.ooo' }
]

const DURATION_OPTIONS: readonly { readonly value: DurationChoice; readonly labelId: MessageId }[] = [
	{ value: 'forever', labelId: 'availability.settings.duration.forever' },
	{ value: '30m', labelId: 'availability.settings.duration.30m' },
	{ value: '1h', labelId: 'availability.settings.duration.1h' },
	{ value: '4h', labelId: 'availability.settings.duration.4h' },
	{ value: 'today', labelId: 'availability.settings.duration.today' },
	{ value: 'tomorrow', labelId: 'availability.settings.duration.tomorrow' }
]

const STATUS_PRESETS: readonly { readonly emoji: string; readonly labelId: MessageId }[] = [
	{ emoji: '📅', labelId: 'availability.preset.meeting' },
	{ emoji: '🎯', labelId: 'availability.preset.focus' },
	{ emoji: '🚗', labelId: 'availability.preset.commuting' },
	{ emoji: '🤒', labelId: 'availability.preset.sick' },
	{ emoji: '🌴', labelId: 'availability.preset.vacation' }
]

const QUICK_EMOJIS = ['💻', '🎯', '📅', '🌴', '☕', '🚀'] as const

function resolveDurationIso(choice: DurationChoice): string | null {
	const now = new Date()
	switch (choice) {
		case 'forever':
			return null
		case '30m':
			return new Date(now.getTime() + 30 * 60_000).toISOString()
		case '1h':
			return new Date(now.getTime() + 60 * 60_000).toISOString()
		case '4h':
			return new Date(now.getTime() + 4 * 60 * 60_000).toISOString()
		case 'today': {
			const end = new Date(now)
			end.setHours(23, 59, 59, 0)
			return end.toISOString()
		}
		case 'tomorrow': {
			const next = new Date(now)
			next.setDate(next.getDate() + 1)
			next.setHours(9, 0, 0, 0)
			return next.toISOString()
		}
	}
}

function formatExpiryLabel(iso: string | null): string | null {
	if (!iso) return null
	const parsed = Date.parse(iso)
	if (Number.isNaN(parsed) || parsed <= Date.now()) return null
	return new Intl.DateTimeFormat(undefined, {
		month: 'short',
		day: 'numeric',
		hour: '2-digit',
		minute: '2-digit'
	}).format(new Date(parsed))
}

/** Card 1: presence override, custom status message, DND timers, and notification behavior. */
export function AvailabilityStatusCard({ profile, onSave }: AvailabilityStatusCardProps) {
	const pushToast = useUiStore((s) => s.pushToast)
	const [manualState, setManualState] = useState<ManualAvailabilityState>(profile.manualState)
	const [overrideDuration, setOverrideDuration] = useState<DurationChoice>('forever')
	const [overrideExpiryDirty, setOverrideExpiryDirty] = useState(false)
	const [statusEmoji, setStatusEmoji] = useState(profile.statusEmoji ?? '')
	const [statusText, setStatusText] = useState(profile.statusText)
	const [statusDuration, setStatusDuration] = useState<DurationChoice>('forever')
	const [statusExpiryDirty, setStatusExpiryDirty] = useState(false)
	const [suppressOffHours, setSuppressOffHours] = useState(profile.suppressNotificationsOffHours)
	const [allowUrgent, setAllowUrgent] = useState(profile.allowUrgentOverride)
	const [saving, setSaving] = useState(false)
	const [dndBusy, setDndBusy] = useState(false)
	const [error, setError] = useState<string | null>(null)

	useEffect(() => {
		setManualState(profile.manualState)
		setOverrideDuration('forever')
		setOverrideExpiryDirty(false)
		setStatusEmoji(profile.statusEmoji ?? '')
		setStatusText(profile.statusText)
		setStatusDuration('forever')
		setStatusExpiryDirty(false)
		setSuppressOffHours(profile.suppressNotificationsOffHours)
		setAllowUrgent(profile.allowUrgentOverride)
		setError(null)
	}, [
		profile.allowUrgentOverride,
		profile.manualState,
		profile.statusEmoji,
		profile.statusText,
		profile.suppressNotificationsOffHours
	])

	const dndUntilLabel = formatExpiryLabel(profile.dndUntil)
	const manualExpiryLabel = formatExpiryLabel(profile.manualStateExpiresAt)
	const statusExpiryLabel = formatExpiryLabel(profile.statusExpiresAt)
	const effectiveTone = availabilityStateTone(profile.effectiveState)

	const isDirty =
		manualState !== profile.manualState ||
		overrideExpiryDirty ||
		(statusEmoji.trim() || null) !== profile.statusEmoji ||
		statusText !== profile.statusText ||
		statusExpiryDirty ||
		suppressOffHours !== profile.suppressNotificationsOffHours ||
		allowUrgent !== profile.allowUrgentOverride

	async function handleSubmit(event: FormEvent) {
		event.preventDefault()
		if (saving) return
		setSaving(true)
		setError(null)
		try {
			const nextEmoji = statusEmoji.trim() || null
			const nextText = statusText.trim()
			const patch: UpdateMyAvailabilityBody = {
				expectedVersion: profile.version,
				manualState,
				statusEmoji: nextEmoji,
				statusText: nextText,
				suppressNotificationsOffHours: suppressOffHours,
				allowUrgentOverride: allowUrgent,
				...(manualState === 'auto'
					? { manualStateExpiresAt: null }
					: overrideExpiryDirty || manualState !== profile.manualState
						? { manualStateExpiresAt: resolveDurationIso(overrideDuration) }
						: {}),
				...(statusExpiryDirty || nextEmoji !== profile.statusEmoji || nextText !== profile.statusText
					? {
							statusExpiresAt:
								nextEmoji === null && nextText === '' ? null : resolveDurationIso(statusDuration)
						}
					: {})
			}
			await onSave(patch)
			setOverrideExpiryDirty(false)
			setStatusExpiryDirty(false)
			pushToast({ tone: 'success', title: t('availability.settings.saved') })
		} catch (err) {
			setError(err instanceof Error ? err.message : 'Could not update availability')
		} finally {
			setSaving(false)
		}
	}

	async function applyDnd(choice: DurationChoice | 'off') {
		if (dndBusy || saving) return
		setDndBusy(true)
		setError(null)
		try {
			await onSave({
				expectedVersion: profile.version,
				dndUntil: choice === 'off' ? null : resolveDurationIso(choice)
			})
			pushToast({ tone: 'success', title: t('availability.settings.saved') })
		} catch (err) {
			setError(err instanceof Error ? err.message : 'Could not update Do Not Disturb')
		} finally {
			setDndBusy(false)
		}
	}

	function handleClearStatus() {
		setStatusEmoji('')
		setStatusText('')
		setStatusDuration('forever')
		setStatusExpiryDirty(true)
	}

	function handlePreset(emoji: string, labelId: MessageId) {
		setStatusEmoji(emoji)
		setStatusText(t(labelId))
		setStatusExpiryDirty(true)
	}

	function openNotificationSettings() {
		useUiStore.getState().setSettingsSection('notifications')
		navigateToSettingsSection('notifications')
	}

	return (
		<SettingsCard labelledBy="availability-status-heading">
			<form onSubmit={handleSubmit}>
				<SettingsCardHeader
					headingId="availability-status-heading"
					icon={<Sparkles className="size-4" aria-hidden />}
					title={t('availability.settings.status-card-title')}
					description={t('availability.settings.status-card-desc')}
					badge={
						<span
							className={cn(
								'inline-flex items-center gap-1.5 rounded-full px-2.5 py-0.5 text-xs font-medium',
								effectiveTone.badge
							)}
						>
							<AvailabilityDot state={profile.effectiveState} size="sm" />
							{t(AVAILABILITY_STATE_LABEL_ID[profile.effectiveState])}
						</span>
					}
				/>
				<SettingsCardBody>
					{error ? (
						<div className="py-3">
							<SettingsNotice tone="danger">{error}</SettingsNotice>
						</div>
					) : null}

					<div className="space-y-2.5 py-4">
						<div className="flex flex-wrap items-center justify-between gap-2">
							<div>
								<h3 className="text-sm font-medium text-foreground">
									{t('availability.settings.override-label')}
								</h3>
								<p className="text-xs text-muted-foreground">{t('availability.settings.override-hint')}</p>
							</div>
							{manualExpiryLabel && profile.manualState !== 'auto' ? (
								<Badge tone="outline">
									{t('availability.hover.until')} {manualExpiryLabel}
								</Badge>
							) : null}
						</div>

						<div className="grid grid-cols-2 gap-2 sm:grid-cols-3">
							{MANUAL_STATES.map((item) => {
								const selected = manualState === item.value
								return (
									<button
										key={item.value}
										type="button"
										aria-pressed={selected}
										onClick={() => {
											setManualState(item.value)
											setOverrideExpiryDirty(true)
										}}
										className={cn(
											'flex items-center gap-2 rounded-md border px-3 py-2 text-start text-sm transition-colors',
											selected
												? 'border-primary bg-primary/8 font-medium text-foreground'
												: 'border-border bg-background text-muted-foreground hover:bg-muted/50 hover:text-foreground'
										)}
									>
										<AvailabilityDot state={item.dot} size="sm" />
										<span className="min-w-0 flex-1 truncate">{t(item.labelId)}</span>
										{selected ? <Check className="size-3.5 shrink-0 text-primary" aria-hidden /> : null}
									</button>
								)
							})}
						</div>

						{manualState !== 'auto' ? (
							<div className="flex flex-wrap items-center gap-2 pt-1">
								<label
									htmlFor="avail-override-duration"
									className="text-xs font-medium text-muted-foreground"
								>
									{t('availability.settings.override-duration')}
								</label>
								<Select
									value={overrideDuration}
									onValueChange={(value) => {
										setOverrideDuration(value as DurationChoice)
										setOverrideExpiryDirty(true)
									}}
								>
									<SelectTrigger
										id="avail-override-duration"
										aria-label={t('availability.settings.override-duration')}
										className="h-8 w-44 text-xs"
									>
										<SelectValue />
									</SelectTrigger>
									<SelectContent>
										{DURATION_OPTIONS.map((option) => (
											<SelectItem key={option.value} value={option.value}>
												{t(option.labelId)}
											</SelectItem>
										))}
									</SelectContent>
								</Select>
							</div>
						) : null}
					</div>

					<div className="space-y-3 py-4">
						<div className="flex flex-wrap items-center justify-between gap-2">
							<div className="flex items-center gap-2">
								<BellOff className="size-4 text-muted-foreground" aria-hidden />
								<span className="text-sm font-medium text-foreground">{t('availability.dnd.title')}</span>
							</div>
							{dndUntilLabel ? (
								<Badge tone="warning">{t('availability.dnd.active-until', { until: dndUntilLabel })}</Badge>
							) : null}
						</div>
						<div className="flex flex-wrap gap-2">
							<Button
								type="button"
								tone="outline"
								size="sm"
								disabled={dndBusy || saving}
								onClick={() => void applyDnd('30m')}
							>
								{t('availability.dnd.30m')}
							</Button>
							<Button
								type="button"
								tone="outline"
								size="sm"
								disabled={dndBusy || saving}
								onClick={() => void applyDnd('1h')}
							>
								{t('availability.dnd.1h')}
							</Button>
							<Button
								type="button"
								tone="outline"
								size="sm"
								disabled={dndBusy || saving}
								onClick={() => void applyDnd('tomorrow')}
							>
								{t('availability.dnd.today')}
							</Button>
							{dndUntilLabel ? (
								<Button
									type="button"
									tone="ghost"
									size="sm"
									disabled={dndBusy || saving}
									onClick={() => void applyDnd('off')}
								>
									{t('availability.dnd.off')}
								</Button>
							) : null}
						</div>
					</div>

					<div className="space-y-3 py-4">
						<div className="flex flex-wrap items-center justify-between gap-2">
							<label htmlFor="avail-status-text" className="text-sm font-medium text-foreground">
								{t('availability.settings.custom-status')}
							</label>
							{statusExpiryLabel ? (
								<Badge tone="outline">
									{t('availability.hover.until')} {statusExpiryLabel}
								</Badge>
							) : null}
						</div>

						<div className="grid gap-2 sm:grid-cols-[5.5rem_1fr_11rem_auto]">
							<Input
								id="avail-status-emoji"
								value={statusEmoji}
								maxLength={16}
								placeholder="💬"
								aria-label={t('availability.settings.emoji')}
								onChange={(e) => setStatusEmoji(e.target.value)}
							/>
							<Input
								id="avail-status-text"
								value={statusText}
								maxLength={140}
								placeholder={t('availability.status.placeholder')}
								onChange={(e) => setStatusText(e.target.value)}
							/>
							<Select
								value={statusDuration}
								onValueChange={(value) => {
									setStatusDuration(value as DurationChoice)
									setStatusExpiryDirty(true)
								}}
							>
								<SelectTrigger id="avail-status-duration" aria-label={t('availability.settings.clear-after')}>
									<SelectValue />
								</SelectTrigger>
								<SelectContent>
									{DURATION_OPTIONS.map((option) => (
										<SelectItem key={option.value} value={option.value}>
											{t(option.labelId)}
										</SelectItem>
									))}
								</SelectContent>
							</Select>
							<Button
								type="button"
								tone="ghost"
								size="sm"
								disabled={!statusEmoji && !statusText}
								onClick={handleClearStatus}
							>
								{t('availability.status.clear')}
							</Button>
						</div>

						<div className="flex flex-wrap items-center gap-1.5">
							<span className="me-1 text-xs text-muted-foreground">
								{t('availability.settings.presets')}:
							</span>
							{QUICK_EMOJIS.map((emoji) => (
								<Button
									key={emoji}
									type="button"
									tone="ghost"
									size="sm"
									className="h-7 px-2"
									aria-label={`${t('availability.settings.emoji')} ${emoji}`}
									onClick={() => setStatusEmoji(emoji)}
								>
									{emoji}
								</Button>
							))}
							{STATUS_PRESETS.map((preset) => (
								<Button
									key={preset.labelId}
									type="button"
									tone="outline"
									size="sm"
									className="h-7 px-2.5 text-xs"
									onClick={() => handlePreset(preset.emoji, preset.labelId)}
								>
									<span aria-hidden>{preset.emoji}</span>
									<span>{t(preset.labelId)}</span>
								</Button>
							))}
						</div>
					</div>

					<div className="space-y-1 pt-2">
						<p className="pt-2 text-xs font-medium uppercase tracking-wide text-muted-foreground">
							{t('availability.notifications.section')}
						</p>
						<SettingsRow
							label={t('availability.notifications.suppress-off-hours')}
							htmlFor="avail-suppress-off-hours"
						>
							<Checkbox
								id="avail-suppress-off-hours"
								checked={suppressOffHours}
								onCheckedChange={(checked) => setSuppressOffHours(checked === true)}
							/>
						</SettingsRow>
						<SettingsRow label={t('availability.notifications.allow-urgent')} htmlFor="avail-allow-urgent">
							<Checkbox
								id="avail-allow-urgent"
								checked={allowUrgent}
								onCheckedChange={(checked) => setAllowUrgent(checked === true)}
							/>
						</SettingsRow>
						<div className="pt-1 pb-2">
							<Button
								type="button"
								tone="link"
								size="sm"
								className="h-auto p-0 text-xs"
								onClick={openNotificationSettings}
							>
								{t('availability.notifications.quiet-hours-link')}
							</Button>
						</div>
					</div>
				</SettingsCardBody>
				<SettingsCardFooter>
					<div className="min-h-5">{isDirty ? <Badge tone="warning">Unsaved changes</Badge> : null}</div>
					<Button type="submit" size="sm" loading={saving} disabled={!isDirty || saving}>
						{t('availability.settings.save-status')}
					</Button>
				</SettingsCardFooter>
			</form>
		</SettingsCard>
	)
}
