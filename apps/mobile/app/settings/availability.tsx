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
type Days = Record<Weekday, WorkingHoursInterval[]>
const EMPTY_DAYS: Days = { mon: [], tue: [], wed: [], thu: [], fri: [], sat: [], sun: [] }
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
	const [days, setDays] = useState<Days>(EMPTY_DAYS)
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
				setDays({ ...EMPTY_DAYS, ...mine.workingHours.days })
				setWindows(list)
			})
			.catch((err) => {
				if (!cancelled) setError(err instanceof Error ? err.message : 'Could not load availability')
			})
		return () => {
			cancelled = true
		}
	}, [runtime, setMyAvailability])

	async function saveStatus() {
		if (!runtime || !myAvailability) return
		setBusy(true)
		try {
			const next = await runtime.api.updateMyAvailability({
				statusText,
				statusEmoji: statusText ? '💬' : null,
				expectedVersion: myAvailability.version
			})
			setMyAvailability(next)
		} catch (err) {
			setError(err instanceof Error ? err.message : 'Could not save status')
		} finally {
			setBusy(false)
		}
	}

	async function setManual(manualState: ManualAvailabilityState) {
		if (!runtime || !myAvailability) return
		const next = await runtime.api.updateMyAvailability({
			manualState,
			expectedVersion: myAvailability.version
		})
		setMyAvailability(next)
	}

	async function toggleSchedule(enabled: boolean) {
		if (!runtime || !myAvailability) return
		setScheduleEnabled(enabled)
		const next = await runtime.api.updateMyAvailability({
			workingHours: { enabled, timezone, days },
			timezone,
			expectedVersion: myAvailability.version
		})
		setMyAvailability(next)
	}

	async function saveWorkingHours() {
		if (!runtime || !myAvailability) return
		const next = await runtime.api.updateMyAvailability({
			workingHours: { enabled: scheduleEnabled, timezone, days },
			timezone,
			expectedVersion: myAvailability.version
		})
		setMyAvailability(next)
	}

	function setInterval(day: Weekday, index: number, field: keyof WorkingHoursInterval, value: string) {
		setDays((current) => {
			const list = [...current[day]]
			const existing = list[index] ?? { start: '09:00', end: '17:00' }
			list[index] = { ...existing, [field]: value }
			return { ...current, [day]: list }
		})
	}

	function addInterval(day: Weekday) {
		setDays((current) => ({
			...current,
			[day]: [...current[day], { start: '09:00', end: '17:00' } as WorkingHoursInterval]
		}))
	}

	function removeInterval(day: Weekday, index: number) {
		setDays((current) => ({
			...current,
			[day]: current[day].filter((_, i) => i !== index)
		}))
	}

	async function createWindow() {
		if (!runtime) return
		const start = new Date(Date.now() + 3_600_000)
		const end = new Date(Date.now() + 4 * 3_600_000)
		try {
			const created = await runtime.api.createAvailabilityWindow({
				kind: 'ooo',
				title: 'Out of office',
				startsAt: start.toISOString(),
				endsAt: end.toISOString()
			})
			setWindows((current) => [...current, created])
		} catch (err) {
			setError(err instanceof Error ? err.message : 'Could not create window')
		}
	}

	async function deleteWindow(id: string) {
		if (!runtime) return
		await runtime.api.deleteAvailabilityWindow(id)
		setWindows((current) => current.filter((window) => window.id !== id))
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
						<Switch isSelected={scheduleEnabled} onSelectedChange={(value) => void toggleSchedule(value)} />
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
								<Pressable
									onPress={() => addInterval(day)}
									accessibilityLabel={t('availability.working-hours.add-interval')}
									className="px-2 py-0.5"
								>
									<Text className="text-xs text-accent">+</Text>
								</Pressable>
							</View>
							{(days[day].length > 0 ? days[day] : [{ start: '', end: '' }]).map((interval, index) => (
								<View
									key={`${day}-${interval.start}-${interval.end}`}
									className="flex-row items-center gap-1"
								>
									<TextInput
										value={interval.start}
										onChangeText={(value) => setInterval(day, index, 'start', value)}
										placeholder="09:00"
										className="w-20 rounded-md border border-border bg-field px-2 py-1 text-xs text-foreground"
										accessibilityLabel={`${day} start`}
									/>
									<Text className="text-xs text-muted-foreground">–</Text>
									<TextInput
										value={interval.end}
										onChangeText={(value) => setInterval(day, index, 'end', value)}
										placeholder="17:00"
										className="w-20 rounded-md border border-border bg-field px-2 py-1 text-xs text-foreground"
										accessibilityLabel={`${day} end`}
									/>
									{days[day].length > 0 ? (
										<Pressable
											onPress={() => removeInterval(day, index)}
											accessibilityLabel={t('availability.working-hours.remove-interval')}
											className="px-1"
										>
											<Trash2 size={13} color="#dc2626" />
										</Pressable>
									) : null}
								</View>
							))}
						</View>
					))}
					<Button size="sm" variant="secondary" onPress={() => void saveWorkingHours()}>
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
					<Button size="sm" variant="secondary" onPress={() => void createWindow()}>
						<CalendarPlus size={14} color="#2563eb" />
						<Button.Label>{t('availability.windows.add')}</Button.Label>
					</Button>
				</Card>

				{error ? <Text className="text-xs text-destructive">{error}</Text> : null}
			</ScrollView>
		</View>
	)
}
