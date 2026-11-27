import type {
	AvailabilityWindowDto,
	ManualAvailabilityState,
	UserAvailabilityDto,
	WorkingHoursInterval
} from '@huriro/contracts'
import { type MessageId, t } from '@huriro/i18n'
import { Stack } from 'expo-router'
import { Button, Card, Chip, Input, Switch } from 'heroui-native'
import { CalendarPlus, Trash2 } from 'lucide-react-native'
import { useEffect, useState } from 'react'
import { Pressable, ScrollView, Text, TextInput, View } from 'react-native'
import { MobileAvailabilityChip } from '../../src/components/availability/mobile-availability-dot'
import { useMobileRuntime } from '../../src/lib/runtime-context'
import { useMobileAvailabilityStore } from '../../src/stores/availability-store'

const STATES: readonly ManualAvailabilityState[] = ['auto', 'available', 'busy', 'dnd', 'away', 'ooo']
const WEEKDAYS = ['mon', 'tue', 'wed', 'thu', 'fri', 'sat', 'sun'] as const
type Weekday = (typeof WEEKDAYS)[number]
interface DraftInterval extends WorkingHoursInterval {
	readonly id: string
}
type DraftDays = Record<Weekday, DraftInterval[]>
const EMPTY_DAYS: DraftDays = { mon: [], tue: [], wed: [], thu: [], fri: [], sat: [], sun: [] }

let mobileIntervalSeq = 0
function nextMobileIntervalId(): string {
	mobileIntervalSeq += 1
	return `mwh-${mobileIntervalSeq}`
}

function toMobileDraftDays(source: Partial<Record<Weekday, readonly WorkingHoursInterval[]>>): DraftDays {
	return {
		mon: (source.mon ?? []).map((iv) => ({ ...iv, id: nextMobileIntervalId() })),
		tue: (source.tue ?? []).map((iv) => ({ ...iv, id: nextMobileIntervalId() })),
		wed: (source.wed ?? []).map((iv) => ({ ...iv, id: nextMobileIntervalId() })),
		thu: (source.thu ?? []).map((iv) => ({ ...iv, id: nextMobileIntervalId() })),
		fri: (source.fri ?? []).map((iv) => ({ ...iv, id: nextMobileIntervalId() })),
		sat: (source.sat ?? []).map((iv) => ({ ...iv, id: nextMobileIntervalId() })),
		sun: (source.sun ?? []).map((iv) => ({ ...iv, id: nextMobileIntervalId() }))
	}
}

function serializeMobileDays(draft: DraftDays): Record<Weekday, WorkingHoursInterval[]> {
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
const LABEL: Record<ManualAvailabilityState, MessageId> = {
	auto: 'availability.manual.auto',
	available: 'availability.manual.available',
	busy: 'availability.manual.busy',
	dnd: 'availability.manual.dnd',
	away: 'availability.manual.away',
	ooo: 'availability.manual.ooo'
}

export default function AvailabilitySettingsScreen() {
	const { runtime } = useMobileRuntime()
	const myAvailability = useMobileAvailabilityStore((s) => s.myAvailability)
	const setMyAvailability = useMobileAvailabilityStore((s) => s.setMyAvailability)
	const [statusText, setStatusText] = useState('')
	const [scheduleEnabled, setScheduleEnabled] = useState(false)
	const [timezone, setTimezone] = useState('UTC')
	const [days, setDays] = useState<DraftDays>(EMPTY_DAYS)
	const [windows, setWindows] = useState<AvailabilityWindowDto[]>([])
	const [busy, setBusy] = useState(false)
	const [error, setError] = useState<string | null>(null)

	useEffect(() => {
		if (!runtime) return
		let cancelled = false
		void Promise.all([runtime.api.getMyAvailability(), runtime.api.listAvailabilityWindows()])
			.then(([mine, list]) => {
				if (cancelled) return
				setMyAvailability(mine as UserAvailabilityDto)
				setStatusText(mine.statusText)
				setScheduleEnabled(mine.workingHours.enabled)
				setTimezone(mine.timezone)
				setDays(toMobileDraftDays(mine.workingHours.days))
				setWindows(list)
			})
			.catch((err) => {
				if (!cancelled) setError(err instanceof Error ? err.message : 'Could not load availability')
			})
		return () => {
			cancelled = true
		}
	}, [runtime, setMyAvailability])

	async function runMutation(fallbackMessage: string, fn: () => Promise<void>) {
		if (busy) return
		setBusy(true)
		setError(null)
		try {
			await fn()
		} catch (err) {
			setError(err instanceof Error ? err.message : fallbackMessage)
		} finally {
			setBusy(false)
		}
	}

	async function saveStatus() {
		if (!runtime || !myAvailability) return
		const version = myAvailability.version
		await runMutation('Could not save status', async () => {
			const next = await runtime.api.updateMyAvailability({
				statusText,
				statusEmoji: statusText ? '💬' : null,
				expectedVersion: version
			})
			setMyAvailability(next)
		})
	}

	async function setManual(manualState: ManualAvailabilityState) {
		if (!runtime || !myAvailability) return
		const version = myAvailability.version
		await runMutation('Could not update availability', async () => {
			const next = await runtime.api.updateMyAvailability({
				manualState,
				expectedVersion: version
			})
			setMyAvailability(next)
		})
	}

	async function toggleSchedule(enabled: boolean) {
		if (!runtime || !myAvailability) return
		const previous = scheduleEnabled
		const version = myAvailability.version
		setScheduleEnabled(enabled)
		setBusy(true)
		setError(null)
		try {
			const next = await runtime.api.updateMyAvailability({
				workingHours: { enabled, timezone, days: serializeMobileDays(days) },
				timezone,
				expectedVersion: version
			})
			setMyAvailability(next)
		} catch (err) {
			setScheduleEnabled(previous)
			setError(err instanceof Error ? err.message : 'Could not update working hours')
		} finally {
			setBusy(false)
		}
	}

	async function saveWorkingHours() {
		if (!runtime || !myAvailability) return
		const version = myAvailability.version
		await runMutation('Could not save working hours', async () => {
			const next = await runtime.api.updateMyAvailability({
				workingHours: { enabled: scheduleEnabled, timezone, days: serializeMobileDays(days) },
				timezone,
				expectedVersion: version
			})
			setMyAvailability(next)
		})
	}

	function updateInterval(day: Weekday, id: string, field: keyof WorkingHoursInterval, value: string) {
		setDays((current) => ({
			...current,
			[day]: current[day].map((item) => (item.id === id ? { ...item, [field]: value } : item))
		}))
	}

	function addInterval(day: Weekday) {
		setDays((current) => {
			if (current[day].length >= 4) return current
			return {
				...current,
				[day]: [...current[day], { id: nextMobileIntervalId(), start: '09:00', end: '17:00' }]
			}
		})
	}

	function removeInterval(day: Weekday, id: string) {
		setDays((current) => ({
			...current,
			[day]: current[day].filter((item) => item.id !== id)
		}))
	}

	async function createWindow() {
		if (!runtime) return
		const start = new Date(Date.now() + 3_600_000)
		const end = new Date(Date.now() + 4 * 3_600_000)
		await runMutation('Could not create window', async () => {
			const created = await runtime.api.createAvailabilityWindow({
				kind: 'ooo',
				title: 'Out of office',
				startsAt: start.toISOString(),
				endsAt: end.toISOString()
			})
			setWindows((current) => [...current, created])
		})
	}

	async function deleteWindow(id: string) {
		if (!runtime) return
		await runMutation('Could not delete window', async () => {
			await runtime.api.deleteAvailabilityWindow(id)
			setWindows((current) => current.filter((window) => window.id !== id))
		})
	}

	return (
		<View className="flex-1 bg-background">
			<Stack.Screen options={{ title: t('availability.title') }} />
			<ScrollView className="flex-1" contentContainerStyle={{ gap: 16, padding: 16, paddingBottom: 40 }}>
				<Card className="gap-3 rounded-2xl border border-border/60 p-4">
					<View className="flex-row items-center justify-between">
						<Text className="text-sm font-semibold text-foreground">{t('availability.title')}</Text>
						{myAvailability ? <MobileAvailabilityChip state={myAvailability.effectiveState} /> : null}
					</View>
					<Input
						value={statusText}
						onChangeText={setStatusText}
						placeholder={t('availability.status.placeholder')}
						className="text-xs"
					/>
					<Button size="sm" isDisabled={busy} onPress={() => void saveStatus()}>
						<Button.Label>{t('common.save')}</Button.Label>
					</Button>
					<View className="flex-row flex-wrap gap-1.5">
						{STATES.map((state) => (
							<Chip
								key={state}
								size="sm"
								variant={myAvailability?.manualState === state ? 'primary' : 'soft'}
								onPress={() => void setManual(state)}
							>
								<Chip.Label>{t(LABEL[state])}</Chip.Label>
							</Chip>
						))}
					</View>
				</Card>

				<Card className="gap-3 rounded-2xl border border-border/60 p-4">
					<View className="flex-row items-center justify-between">
						<Text className="text-sm font-semibold text-foreground">
							{t('availability.working-hours.title')}
						</Text>
						<Switch
							isSelected={scheduleEnabled}
							isDisabled={busy}
							onSelectedChange={(value) => void toggleSchedule(value)}
						/>
					</View>
					<View className="flex-row items-center gap-2">
						<Text className="text-xs text-muted-foreground">{t('availability.working-hours.timezone')}</Text>
						<Input value={timezone} onChangeText={setTimezone} className="flex-1 text-xs" />
					</View>
					<Text className="text-[11px] text-muted-foreground">
						{t('availability.working-hours.split-hint')}
					</Text>
					{WEEKDAYS.map((day) => (
						<View key={day} className="gap-1">
							<View className="flex-row items-center justify-between">
								<Text className="text-xs font-medium text-foreground">{day.toUpperCase()}</Text>
								{days[day].length < 4 ? (
									<Pressable
										onPress={() => addInterval(day)}
										accessibilityLabel={t('availability.working-hours.add-interval')}
										className="px-2 py-0.5"
									>
										<Text className="text-xs text-accent">+</Text>
									</Pressable>
								) : null}
							</View>
							{days[day].length === 0 ? (
								<Text className="text-xs text-muted-foreground">
									{t('availability.working-hours.day-off')}
								</Text>
							) : (
								days[day].map((interval, index) => (
									<View key={interval.id} className="flex-row items-center gap-1">
										<TextInput
											value={interval.start}
											onChangeText={(value) => updateInterval(day, interval.id, 'start', value)}
											placeholder="09:00"
											className="w-20 rounded-md border border-border bg-field px-2 py-1 text-xs text-foreground"
											accessibilityLabel={`${day} start ${index + 1}`}
										/>
										<Text className="text-xs text-muted-foreground">–</Text>
										<TextInput
											value={interval.end}
											onChangeText={(value) => updateInterval(day, interval.id, 'end', value)}
											placeholder="17:00"
											className="w-20 rounded-md border border-border bg-field px-2 py-1 text-xs text-foreground"
											accessibilityLabel={`${day} end ${index + 1}`}
										/>
										<Pressable
											onPress={() => removeInterval(day, interval.id)}
											accessibilityLabel={t('availability.working-hours.remove-interval')}
											className="px-1"
										>
											<Trash2 size={13} color="#dc2626" />
										</Pressable>
									</View>
								))
							)}
						</View>
					))}
					<Button size="sm" variant="secondary" isDisabled={busy} onPress={() => void saveWorkingHours()}>
						<Button.Label>{t('common.save')}</Button.Label>
					</Button>
				</Card>

				<Card className="gap-3 rounded-2xl border border-border/60 p-4">
					<Text className="text-sm font-semibold text-foreground">{t('availability.windows.title')}</Text>
					{windows.length === 0 ? (
						<Text className="text-xs text-muted-foreground">{t('availability.windows.empty')}</Text>
					) : (
						windows.map((window) => (
							<View
								key={window.id}
								className="flex-row items-center justify-between border-border/50 border-b pb-2"
							>
								<View className="flex-1">
									<Text className="text-xs font-medium text-foreground">{window.title}</Text>
									<Text className="text-[10px] text-muted-foreground">
										{new Date(window.startsAt).toLocaleString()} – {new Date(window.endsAt).toLocaleString()}
									</Text>
								</View>
								<Pressable
									onPress={() => void deleteWindow(window.id)}
									accessibilityLabel={t('availability.windows.delete')}
									className="p-1"
								>
									<Trash2 size={15} color="#dc2626" />
								</Pressable>
							</View>
						))
					)}
					<Button size="sm" variant="secondary" isDisabled={busy} onPress={() => void createWindow()}>
						<CalendarPlus size={14} color="#2563eb" />
						<Button.Label>{t('availability.windows.add')}</Button.Label>
					</Button>
				</Card>

				{error ? <Text className="text-xs text-destructive">{error}</Text> : null}
			</ScrollView>
		</View>
	)
}
