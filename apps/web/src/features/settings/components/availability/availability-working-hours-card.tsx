import type { UpdateMyAvailabilityBody, UserAvailabilityDto, WorkingHoursInterval } from '@huriro/contracts'
import {
	isValidIanaTimezone,
	localTimeLabel,
	normalizeWorkingHours,
	validateWorkingHours,
	WEEKDAYS
} from '@huriro/domain'
import { type MessageId, t } from '@huriro/i18n'
import { Clock, Globe, Plus, Trash2 } from 'lucide-react'
import { type FormEvent, useEffect, useMemo, useState } from 'react'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Checkbox } from '@/components/ui/checkbox'
import { Input } from '@/components/ui/input'
import { useUiStore } from '@/stores/ui-store'
import {
	SettingsCard,
	SettingsCardBody,
	SettingsCardFooter,
	SettingsCardHeader,
	SettingsNotice
} from '../settings-primitives'

export interface AvailabilityWorkingHoursCardProps {
	readonly profile: UserAvailabilityDto
	readonly onSave: (patch: UpdateMyAvailabilityBody) => Promise<void>
}

type Weekday = (typeof WEEKDAYS)[number]

interface DraftInterval extends WorkingHoursInterval {
	readonly id: string
}

type DraftDays = Record<Weekday, DraftInterval[]>

const DAY_LABEL_ID: Record<Weekday, MessageId> = {
	mon: 'availability.working-hours.day.mon',
	tue: 'availability.working-hours.day.tue',
	wed: 'availability.working-hours.day.wed',
	thu: 'availability.working-hours.day.thu',
	fri: 'availability.working-hours.day.fri',
	sat: 'availability.working-hours.day.sat',
	sun: 'availability.working-hours.day.sun'
}

const COMMON_TIMEZONES = [
	'UTC',
	'America/New_York',
	'America/Chicago',
	'America/Denver',
	'America/Los_Angeles',
	'America/Toronto',
	'America/Sao_Paulo',
	'Europe/London',
	'Europe/Berlin',
	'Europe/Paris',
	'Asia/Dubai',
	'Asia/Kolkata',
	'Asia/Singapore',
	'Asia/Tokyo',
	'Australia/Sydney'
] as const

let intervalSeq = 0
function nextIntervalId(): string {
	intervalSeq += 1
	return `wh-${intervalSeq}`
}

type WorkingHoursDtoSchedule = UserAvailabilityDto['workingHours']

function toMutableSchedule(schedule: ReturnType<typeof normalizeWorkingHours>): WorkingHoursDtoSchedule {
	return {
		enabled: schedule.enabled,
		timezone: schedule.timezone,
		days: {
			mon: [...schedule.days.mon],
			tue: [...schedule.days.tue],
			wed: [...schedule.days.wed],
			thu: [...schedule.days.thu],
			fri: [...schedule.days.fri],
			sat: [...schedule.days.sat],
			sun: [...schedule.days.sun]
		}
	}
}

function toDraftDays(schedule: WorkingHoursDtoSchedule): DraftDays {
	return {
		mon: schedule.days.mon.map((iv) => ({ ...iv, id: nextIntervalId() })),
		tue: schedule.days.tue.map((iv) => ({ ...iv, id: nextIntervalId() })),
		wed: schedule.days.wed.map((iv) => ({ ...iv, id: nextIntervalId() })),
		thu: schedule.days.thu.map((iv) => ({ ...iv, id: nextIntervalId() })),
		fri: schedule.days.fri.map((iv) => ({ ...iv, id: nextIntervalId() })),
		sat: schedule.days.sat.map((iv) => ({ ...iv, id: nextIntervalId() })),
		sun: schedule.days.sun.map((iv) => ({ ...iv, id: nextIntervalId() }))
	}
}

function serializeDays(draft: DraftDays): WorkingHoursDtoSchedule['days'] {
	return {
		mon: draft.mon.map(({ start, end }) => ({ start, end })),
		tue: draft.tue.map(({ start, end }) => ({ start, end })),
		wed: draft.wed.map(({ start, end }) => ({ start, end })),
		thu: draft.thu.map(({ start, end }) => ({ start, end })),
		fri: draft.fri.map(({ start, end }) => ({ start, end })),
		sat: draft.sat.map(({ start, end }) => ({ start, end })),
		sun: draft.sun.map(({ start, end }) => ({ start, end }))
	}
}

function schedulesEqual(a: WorkingHoursDtoSchedule, b: WorkingHoursDtoSchedule): boolean {
	if (a.enabled !== b.enabled || a.timezone !== b.timezone) return false
	return WEEKDAYS.every((day) => {
		const left = a.days[day]
		const right = b.days[day]
		if (left.length !== right.length) return false
		return left.every((item, idx) => item.start === right[idx]?.start && item.end === right[idx]?.end)
	})
}

function detectBrowserTimezone(): string {
	try {
		return Intl.DateTimeFormat().resolvedOptions().timeZone || 'UTC'
	} catch {
		return 'UTC'
	}
}

/** Card 2: timezone picker and 7-day working-hours schedule with split-shift support. */
export function AvailabilityWorkingHoursCard({ profile, onSave }: AvailabilityWorkingHoursCardProps) {
	const pushToast = useUiStore((s) => s.pushToast)
	const baselineSchedule = useMemo(
		() => toMutableSchedule(normalizeWorkingHours(profile.workingHours, profile.timezone)),
		[profile.timezone, profile.workingHours]
	)
	const [enabled, setEnabled] = useState(baselineSchedule.enabled)
	const [timezone, setTimezone] = useState(profile.timezone || baselineSchedule.timezone)
	const [days, setDays] = useState<DraftDays>(() => toDraftDays(baselineSchedule))
	const [saving, setSaving] = useState(false)
	const [error, setError] = useState<string | null>(null)

	useEffect(() => {
		setEnabled(baselineSchedule.enabled)
		setTimezone(profile.timezone || baselineSchedule.timezone)
		setDays(toDraftDays(baselineSchedule))
		setError(null)
	}, [baselineSchedule, profile.timezone])

	const timezoneOptions = useMemo(() => {
		const intlWithSupported = Intl as typeof Intl & { supportedValuesOf?: (key: string) => string[] }
		const supported =
			typeof intlWithSupported.supportedValuesOf === 'function'
				? intlWithSupported.supportedValuesOf('timeZone')
				: COMMON_TIMEZONES
		const merged = new Set([...COMMON_TIMEZONES, ...supported, timezone.trim()].filter(Boolean))
		return [...merged]
	}, [timezone])

	const trimmedTimezone = timezone.trim()
	const timezoneValid = isValidIanaTimezone(trimmedTimezone)
	const currentLocalTime = timezoneValid ? localTimeLabel(new Date().toISOString(), trimmedTimezone) : null

	const candidateSchedule: WorkingHoursDtoSchedule = useMemo(
		() => ({
			enabled,
			timezone: trimmedTimezone,
			days: serializeDays(days)
		}),
		[days, enabled, trimmedTimezone]
	)

	const isDirty = !schedulesEqual(candidateSchedule, baselineSchedule) || trimmedTimezone !== profile.timezone

	function toggleDay(day: Weekday, checked: boolean) {
		setError(null)
		setDays((current) => ({
			...current,
			[day]: checked
				? current[day].length > 0
					? current[day]
					: [{ id: nextIntervalId(), start: '09:00', end: '17:00' }]
				: []
		}))
	}

	function updateInterval(day: Weekday, id: string, field: 'start' | 'end', value: string) {
		setError(null)
		setDays((current) => ({
			...current,
			[day]: current[day].map((iv) => (iv.id === id ? { ...iv, [field]: value } : iv))
		}))
	}

	function addInterval(day: Weekday) {
		setError(null)
		setDays((current) => {
			if (current[day].length >= 4) return current
			const nextSlot =
				current[day].length === 0 ? { start: '09:00', end: '17:00' } : { start: '13:00', end: '17:00' }
			return {
				...current,
				[day]: [...current[day], { id: nextIntervalId(), ...nextSlot }]
			}
		})
	}

	function removeInterval(day: Weekday, id: string) {
		setError(null)
		setDays((current) => ({
			...current,
			[day]: current[day].filter((iv) => iv.id !== id)
		}))
	}

	function applyWeekdayPreset() {
		setError(null)
		setEnabled(true)
		setDays({
			mon: [{ id: nextIntervalId(), start: '09:00', end: '17:00' }],
			tue: [{ id: nextIntervalId(), start: '09:00', end: '17:00' }],
			wed: [{ id: nextIntervalId(), start: '09:00', end: '17:00' }],
			thu: [{ id: nextIntervalId(), start: '09:00', end: '17:00' }],
			fri: [{ id: nextIntervalId(), start: '09:00', end: '17:00' }],
			sat: [],
			sun: []
		})
	}

	function copyMondayToWeekdays() {
		setError(null)
		const template = days.mon.map(({ start, end }) => ({ start, end }))
		setDays((current) => ({
			...current,
			tue: template.map((iv) => ({ ...iv, id: nextIntervalId() })),
			wed: template.map((iv) => ({ ...iv, id: nextIntervalId() })),
			thu: template.map((iv) => ({ ...iv, id: nextIntervalId() })),
			fri: template.map((iv) => ({ ...iv, id: nextIntervalId() }))
		}))
	}

	async function handleSubmit(event: FormEvent) {
		event.preventDefault()
		if (saving) return
		if (!timezoneValid) {
			setError(t('availability.working-hours.invalid-tz'))
			return
		}
		const validation = validateWorkingHours(candidateSchedule, trimmedTimezone)
		if (!validation.ok) {
			setError(validation.errors.join(' · '))
			return
		}
		setSaving(true)
		setError(null)
		try {
			await onSave({
				expectedVersion: profile.version,
				timezone: trimmedTimezone,
				workingHours: toMutableSchedule(validation.normalized)
			})
			pushToast({ tone: 'success', title: t('availability.settings.saved') })
		} catch (err) {
			setError(err instanceof Error ? err.message : 'Could not save working hours')
		} finally {
			setSaving(false)
		}
	}

	return (
		<SettingsCard labelledBy="availability-working-hours-heading">
			<form onSubmit={handleSubmit}>
				<SettingsCardHeader
					headingId="availability-working-hours-heading"
					icon={<Clock className="size-4" aria-hidden />}
					title={t('availability.working-hours.title')}
					description={t('availability.working-hours.desc')}
					badge={
						<Badge tone={enabled ? 'success' : 'secondary'}>
							{t(enabled ? 'availability.working-hours.active' : 'availability.working-hours.inactive')}
						</Badge>
					}
				/>
				<SettingsCardBody>
					{error ? (
						<div className="py-3">
							<SettingsNotice tone="danger">{error}</SettingsNotice>
						</div>
					) : null}

					<div className="flex items-center justify-between gap-4 py-3.5">
						<label htmlFor="avail-wh-enabled" className="text-sm font-medium text-foreground">
							{t('availability.working-hours.enabled')}
						</label>
						<Checkbox
							id="avail-wh-enabled"
							checked={enabled}
							onCheckedChange={(checked) => {
								setError(null)
								setEnabled(checked === true)
							}}
						/>
					</div>

					<div className="space-y-2 py-3.5">
						<div className="flex flex-wrap items-center justify-between gap-2">
							<label
								htmlFor="avail-wh-timezone"
								className="flex items-center gap-1.5 text-sm font-medium text-foreground"
							>
								<Globe className="size-3.5 text-muted-foreground" aria-hidden />
								{t('availability.working-hours.timezone')}
							</label>
							{currentLocalTime ? (
								<span className="text-xs text-muted-foreground tabular-nums">
									{t('availability.working-hours.local-now', { time: currentLocalTime })}
								</span>
							) : null}
						</div>
						<div className="flex flex-wrap items-center gap-2">
							<Input
								id="avail-wh-timezone"
								list="avail-timezone-options"
								value={timezone}
								invalid={!timezoneValid}
								className="max-w-sm flex-1"
								onChange={(e) => {
									setError(null)
									setTimezone(e.target.value)
								}}
							/>
							<datalist id="avail-timezone-options">
								{timezoneOptions.map((tz) => (
									<option key={tz} value={tz} />
								))}
							</datalist>
							<Button
								type="button"
								tone="outline"
								size="sm"
								onClick={() => {
									setError(null)
									setTimezone(detectBrowserTimezone())
								}}
							>
								{t('availability.working-hours.detect-tz')}
							</Button>
						</div>
						{!timezoneValid ? (
							<p className="text-xs text-destructive">{t('availability.working-hours.invalid-tz')}</p>
						) : null}
					</div>

					<div className="space-y-2.5 py-3.5">
						<div className="flex flex-wrap items-center justify-between gap-2">
							<p className="text-xs text-muted-foreground">{t('availability.working-hours.split-hint')}</p>
							<div className="flex flex-wrap gap-1.5">
								<Button type="button" tone="outline" size="sm" onClick={applyWeekdayPreset}>
									{t('availability.working-hours.preset-weekdays')}
								</Button>
								<Button type="button" tone="ghost" size="sm" onClick={copyMondayToWeekdays}>
									{t('availability.working-hours.copy-monday')}
								</Button>
							</div>
						</div>

						<div className="divide-y divide-border rounded-lg border border-border">
							{WEEKDAYS.map((day) => {
								const dayLabel = t(DAY_LABEL_ID[day])
								const intervals = days[day]
								const isDayEnabled = intervals.length > 0
								return (
									<div key={day} className="flex flex-wrap items-start justify-between gap-3 px-3 py-2.5">
										<div className="flex min-w-36 items-center gap-2 pt-1.5">
											<Checkbox
												id={`avail-day-${day}`}
												checked={isDayEnabled}
												onCheckedChange={(checked) => toggleDay(day, checked === true)}
											/>
											<label htmlFor={`avail-day-${day}`} className="text-sm font-medium text-foreground">
												{dayLabel}
											</label>
										</div>

										<div className="flex flex-1 flex-wrap items-center justify-end gap-2">
											{intervals.length === 0 ? (
												<Badge tone="outline" className="my-1 text-muted-foreground">
													{t('availability.working-hours.day-off')}
												</Badge>
											) : (
												intervals.map((interval, idx) => (
													<div
														key={interval.id}
														className="flex items-center gap-1 rounded-md border border-border bg-muted/20 px-1.5 py-1"
													>
														<Input
															type="time"
															aria-label={`${dayLabel} start ${idx + 1}`}
															value={interval.start}
															className="h-7 w-28 border-0 bg-transparent px-1.5 text-xs shadow-none"
															onChange={(e) => updateInterval(day, interval.id, 'start', e.target.value)}
														/>
														<span className="text-xs text-muted-foreground">–</span>
														<Input
															type="time"
															aria-label={`${dayLabel} end ${idx + 1}`}
															value={interval.end}
															className="h-7 w-28 border-0 bg-transparent px-1.5 text-xs shadow-none"
															onChange={(e) => updateInterval(day, interval.id, 'end', e.target.value)}
														/>
														<Button
															type="button"
															tone="ghost"
															size="icon"
															className="size-7 text-muted-foreground hover:text-destructive"
															aria-label={`${t('availability.working-hours.remove-interval')} ${dayLabel} ${idx + 1}`}
															onClick={() => removeInterval(day, interval.id)}
														>
															<Trash2 className="size-3.5" aria-hidden />
														</Button>
													</div>
												))
											)}

											{intervals.length < 4 ? (
												<Button
													type="button"
													tone="ghost"
													size="sm"
													className="h-8 gap-1 px-2 text-xs"
													onClick={() => addInterval(day)}
												>
													<Plus className="size-3.5" aria-hidden />
													{t('availability.working-hours.add-interval')}
												</Button>
											) : null}
										</div>
									</div>
								)
							})}
						</div>
					</div>
				</SettingsCardBody>
				<SettingsCardFooter>
					<div className="min-h-5">{isDirty ? <Badge tone="warning">Unsaved changes</Badge> : null}</div>
					<Button type="submit" size="sm" loading={saving} disabled={!isDirty || saving}>
						{t('availability.settings.save-working-hours')}
					</Button>
				</SettingsCardFooter>
			</form>
		</SettingsCard>
	)
}
