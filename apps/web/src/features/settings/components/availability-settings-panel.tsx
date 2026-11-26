import type {
	AvailabilityWindowDto,
	AvailabilityWindowKind,
	WorkingHoursInterval,
	WorkingHoursSchedule
} from '@huriro/contracts'
import { type MessageId, t } from '@huriro/i18n'
import { CalendarPlus, Plus, Trash2 } from 'lucide-react'
import { useEffect, useState } from 'react'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import { Checkbox } from '@/components/ui/checkbox'
import { Input } from '@/components/ui/input'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select'
import {
	AVAILABILITY_STATE_LABEL_ID,
	availabilityStateTone
} from '@/features/availability/availability-state'
import { useWorkspaceAvailability } from '@/features/availability/hooks/use-availability'
import { useWorkspace } from '@/lib/workspace'

const WEEKDAYS = ['mon', 'tue', 'wed', 'thu', 'fri', 'sat', 'sun'] as const
const DAY_LABEL: Record<(typeof WEEKDAYS)[number], MessageId> = {
	mon: 'availability.working-hours.day.mon',
	tue: 'availability.working-hours.day.tue',
	wed: 'availability.working-hours.day.wed',
	thu: 'availability.working-hours.day.thu',
	fri: 'availability.working-hours.day.fri',
	sat: 'availability.working-hours.day.sat',
	sun: 'availability.working-hours.day.sun'
}

function emptyDays(): WorkingHoursSchedule['days'] {
	return { mon: [], tue: [], wed: [], thu: [], fri: [], sat: [], sun: [] }
}

export function AvailabilitySettingsPanel() {
	const { myAvailability, updateMyAvailability } = useWorkspaceAvailability()
	const { api } = useWorkspace()
	const [schedule, setSchedule] = useState<WorkingHoursSchedule>({
		enabled: false,
		timezone: 'UTC',
		days: emptyDays()
	})
	const [statusText, setStatusText] = useState('')
	const [statusEmoji, setStatusEmoji] = useState('')
	const [windows, setWindows] = useState<AvailabilityWindowDto[]>([])
	const [newKind, setNewKind] = useState<AvailabilityWindowKind>('ooo')
	const [newTitle, setNewTitle] = useState('')
	const [newStart, setNewStart] = useState('')
	const [newEnd, setNewEnd] = useState('')
	const [newDelegate, setNewDelegate] = useState('')
	const [error, setError] = useState<string | null>(null)
	const [saving, setSaving] = useState(false)

	// biome-ignore lint/correctness/useExhaustiveDependencies: resync only when the authoritative version changes, not every 60s clock tick
	useEffect(() => {
		if (!myAvailability) return
		setSchedule(myAvailability.workingHours)
		setStatusText(myAvailability.statusText)
		setStatusEmoji(myAvailability.statusEmoji ?? '')
		setWindows(myAvailability.windows)
	}, [myAvailability?.version])

	if (!myAvailability) return null
	const row = myAvailability
	const tone = availabilityStateTone(row.effectiveState)

	async function saveProfile() {
		setSaving(true)
		setError(null)
		try {
			await updateMyAvailability({
				statusText,
				statusEmoji: statusEmoji || null,
				workingHours: schedule,
				timezone: schedule.timezone,
				expectedVersion: row.version
			})
		} catch (err) {
			setError(err instanceof Error ? err.message : 'Could not save availability')
		} finally {
			setSaving(false)
		}
	}

	function setIntervalValue(
		day: (typeof WEEKDAYS)[number],
		index: number,
		field: keyof WorkingHoursInterval,
		value: string
	) {
		setSchedule((current) => {
			const list = [...current.days[day]]
			const existing = list[index] ?? { start: '09:00', end: '17:00' }
			list[index] = { ...existing, [field]: value }
			return { ...current, days: { ...current.days, [day]: list } }
		})
	}

	function addInterval(day: (typeof WEEKDAYS)[number]) {
		setSchedule((current) => ({
			...current,
			days: { ...current.days, [day]: [...current.days[day], { start: '09:00', end: '17:00' }] }
		}))
	}

	function removeInterval(day: (typeof WEEKDAYS)[number], index: number) {
		setSchedule((current) => ({
			...current,
			days: { ...current.days, [day]: current.days[day].filter((_, i) => i !== index) }
		}))
	}

	async function createWindow() {
		if (!newStart || !newEnd) return
		setError(null)
		try {
			const created = await api.createAvailabilityWindow({
				kind: newKind,
				title: newTitle,
				startsAt: new Date(newStart).toISOString(),
				endsAt: new Date(newEnd).toISOString(),
				...(newDelegate.trim() ? { delegateUserId: newDelegate.trim() } : {})
			})
			setWindows((current) => [...current, created])
			setNewTitle('')
			setNewStart('')
			setNewEnd('')
			setNewDelegate('')
		} catch (err) {
			setError(err instanceof Error ? err.message : 'Could not create the window')
		}
	}

	async function deleteWindow(id: string) {
		setError(null)
		try {
			await api.deleteAvailabilityWindow(id)
			setWindows((current) => current.filter((window) => window.id !== id))
		} catch (err) {
			setError(err instanceof Error ? err.message : 'Could not delete the window')
		}
	}

	return (
		<div className="space-y-4">
			<Card>
				<CardHeader>
					<CardTitle className="flex items-center gap-2">
						{t('availability.title')}
						<Badge className={tone.badge}>{t(AVAILABILITY_STATE_LABEL_ID[row.effectiveState])}</Badge>
					</CardTitle>
					<CardDescription>{t('availability.settings-desc')}</CardDescription>
				</CardHeader>
				<CardContent className="space-y-3">
					<div className="grid gap-2 sm:grid-cols-2">
						<div className="space-y-1">
							<label className="text-muted-foreground text-xs" htmlFor="availability-status">
								{t('availability.status.placeholder')}
							</label>
							<Input
								id="availability-status"
								value={statusText}
								onChange={(event) => setStatusText(event.target.value)}
								maxLength={200}
							/>
						</div>
						<div className="space-y-1">
							<label className="text-muted-foreground text-xs" htmlFor="availability-emoji">
								Emoji
							</label>
							<Input
								id="availability-emoji"
								value={statusEmoji}
								onChange={(event) => setStatusEmoji(event.target.value.slice(0, 32))}
								maxLength={32}
							/>
						</div>
					</div>
					<label htmlFor="availability-suppress-off-hours" className="flex items-center gap-2 text-xs">
						<Checkbox
							id="availability-suppress-off-hours"
							checked={row.suppressNotificationsOffHours}
							onCheckedChange={(checked) =>
								void updateMyAvailability({
									suppressNotificationsOffHours: checked === true,
									expectedVersion: row.version
								})
							}
						/>
						<span>{t('availability.notifications.suppress-off-hours')}</span>
					</label>
					<label htmlFor="availability-allow-urgent" className="flex items-center gap-2 text-xs">
						<Checkbox
							id="availability-allow-urgent"
							checked={row.allowUrgentOverride}
							onCheckedChange={(checked) =>
								void updateMyAvailability({
									allowUrgentOverride: checked === true,
									expectedVersion: row.version
								})
							}
						/>
						<span>{t('availability.notifications.allow-urgent')}</span>
					</label>
				</CardContent>
			</Card>

			<Card>
				<CardHeader>
					<CardTitle>{t('availability.working-hours.title')}</CardTitle>
					<CardDescription>{t('availability.working-hours.split-hint')}</CardDescription>
				</CardHeader>
				<CardContent className="space-y-3">
					<div className="flex flex-wrap items-center gap-3">
						<label htmlFor="availability-working-hours-enabled" className="flex items-center gap-2 text-xs">
							<Checkbox
								id="availability-working-hours-enabled"
								checked={schedule.enabled}
								onCheckedChange={(checked) =>
									setSchedule((current) => ({ ...current, enabled: checked === true }))
								}
							/>
							<span>{t('availability.working-hours.enabled')}</span>
						</label>
						<div className="flex items-center gap-2">
							<label className="text-muted-foreground text-xs" htmlFor="availability-timezone">
								{t('availability.working-hours.timezone')}
							</label>
							<Input
								id="availability-timezone"
								value={schedule.timezone}
								onChange={(event) => setSchedule((current) => ({ ...current, timezone: event.target.value }))}
								className="h-8 w-44 text-xs"
							/>
						</div>
					</div>
					<div className="space-y-2">
						{WEEKDAYS.map((day) => (
							<div key={day} className="flex flex-wrap items-center gap-2">
								<span className="w-20 text-xs">{t(DAY_LABEL[day])}</span>
								{(schedule.days[day].length > 0 ? schedule.days[day] : [{ start: '', end: '' }]).map(
									(interval, index) => (
										<span
											key={`${day}-${interval.start}-${interval.end}`}
											className="flex items-center gap-1"
										>
											<Input
												type="time"
												value={interval.start}
												onChange={(event) => setIntervalValue(day, index, 'start', event.target.value)}
												className="h-8 w-24 text-xs"
												aria-label={`${t(DAY_LABEL[day])} start`}
											/>
											<span className="text-muted-foreground text-xs">–</span>
											<Input
												type="time"
												value={interval.end}
												onChange={(event) => setIntervalValue(day, index, 'end', event.target.value)}
												className="h-8 w-24 text-xs"
												aria-label={`${t(DAY_LABEL[day])} end`}
											/>
											{schedule.days[day].length > 0 ? (
												<Button
													type="button"
													size="icon"
													tone="ghost"
													className="size-7"
													aria-label={t('availability.working-hours.remove-interval')}
													onClick={() => removeInterval(day, index)}
												>
													<Trash2 className="size-3.5" aria-hidden />
												</Button>
											) : null}
										</span>
									)
								)}
								<Button
									type="button"
									size="sm"
									tone="ghost"
									className="h-7 gap-1 text-xs"
									onClick={() => addInterval(day)}
								>
									<Plus className="size-3.5" aria-hidden />
									{t('availability.working-hours.add-interval')}
								</Button>
							</div>
						))}
					</div>
					<Button type="button" size="sm" disabled={saving} onClick={() => void saveProfile()}>
						{t('common.save')}
					</Button>
				</CardContent>
			</Card>

			<Card>
				<CardHeader>
					<CardTitle>{t('availability.windows.title')}</CardTitle>
				</CardHeader>
				<CardContent className="space-y-3">
					{windows.length === 0 ? (
						<p className="text-muted-foreground text-sm">{t('availability.windows.empty')}</p>
					) : (
						<ul className="space-y-2">
							{windows.map((window) => (
								<li
									key={window.id}
									className="flex flex-wrap items-center justify-between gap-2 rounded-md border border-border px-3 py-2 text-sm"
								>
									<span className="min-w-0">
										<span className="font-medium">{window.title || t('availability.windows.kind.ooo')}</span>
										<span className="ms-2 text-muted-foreground text-xs">
											{new Date(window.startsAt).toLocaleString()} –{' '}
											{new Date(window.endsAt).toLocaleString()}
										</span>
									</span>
									<Button
										type="button"
										size="icon"
										tone="ghost"
										className="size-7"
										aria-label={t('availability.windows.delete')}
										onClick={() => void deleteWindow(window.id)}
									>
										<Trash2 className="size-3.5" aria-hidden />
									</Button>
								</li>
							))}
						</ul>
					)}

					<div className="grid gap-2 sm:grid-cols-2">
						<Select value={newKind} onValueChange={(value) => setNewKind(value as AvailabilityWindowKind)}>
							<SelectTrigger className="h-8 text-xs">
								<SelectValue />
							</SelectTrigger>
							<SelectContent>
								<SelectItem value="ooo">{t('availability.windows.kind.ooo')}</SelectItem>
								<SelectItem value="focus">{t('availability.windows.kind.focus')}</SelectItem>
								<SelectItem value="dnd">{t('availability.windows.kind.dnd')}</SelectItem>
							</SelectContent>
						</Select>
						<Input
							value={newTitle}
							onChange={(event) => setNewTitle(event.target.value)}
							placeholder={t('availability.windows.kind.ooo')}
							className="h-8 text-xs"
						/>
						<Input
							type="datetime-local"
							value={newStart}
							onChange={(event) => setNewStart(event.target.value)}
							aria-label={t('availability.windows.starts')}
							className="h-8 text-xs"
						/>
						<Input
							type="datetime-local"
							value={newEnd}
							onChange={(event) => setNewEnd(event.target.value)}
							aria-label={t('availability.windows.ends')}
							className="h-8 text-xs"
						/>
						<Input
							value={newDelegate}
							onChange={(event) => setNewDelegate(event.target.value)}
							placeholder={t('availability.windows.delegate')}
							className="h-8 text-xs sm:col-span-2"
						/>
					</div>
					<Button
						type="button"
						size="sm"
						className="gap-1.5"
						onClick={() => void createWindow()}
						disabled={!newStart || !newEnd}
					>
						<CalendarPlus className="size-3.5" aria-hidden />
						{t('availability.windows.add')}
					</Button>
					{error ? <p className="text-destructive text-xs">{error}</p> : null}
				</CardContent>
			</Card>
		</div>
	)
}
