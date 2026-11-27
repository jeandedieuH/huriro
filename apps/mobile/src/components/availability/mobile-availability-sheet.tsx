import type { ManualAvailabilityState, UserAvailabilityDto } from '@huriro/contracts'
import { type MessageId, t } from '@huriro/i18n'
import { Check, X } from 'lucide-react-native'
import { Modal, Pressable, ScrollView, Text, View } from 'react-native'
import { resolveAvailabilityColor, useHuriroColors } from '../../lib/theme'

const STATES: readonly ManualAvailabilityState[] = ['auto', 'available', 'busy', 'dnd', 'away', 'ooo']
const LABEL: Record<ManualAvailabilityState, MessageId> = {
	auto: 'availability.manual.auto',
	available: 'availability.manual.available',
	busy: 'availability.manual.busy',
	dnd: 'availability.manual.dnd',
	away: 'availability.manual.away',
	ooo: 'availability.manual.ooo'
}

export function MobileAvailabilitySheet({
	visible,
	onClose,
	availability,
	onUpdate
}: {
	readonly visible: boolean
	readonly onClose: () => void
	readonly availability: UserAvailabilityDto | null
	readonly onUpdate: (patch: { manualState?: ManualAvailabilityState; dndUntil?: string | null }) => void
}) {
	const colors = useHuriroColors()
	if (!availability) return null
	const dndActive = availability.dndUntil !== null && Date.parse(availability.dndUntil) > Date.now()
	return (
		<Modal visible={visible} transparent animationType="slide" onRequestClose={onClose}>
			<Pressable className="flex-1 bg-black/40" onPress={onClose} accessibilityLabel={t('common.close')} />
			<View className="rounded-t-3xl border border-border bg-background px-4 pb-8 pt-4">
				<View className="mb-3 flex-row items-center justify-between">
					<Text className="text-base font-semibold text-foreground">{t('availability.title')}</Text>
					<Pressable onPress={onClose} accessibilityLabel={t('common.close')} className="p-1">
						<X size={18} color={colors.muted} />
					</Pressable>
				</View>
				<Text className="mb-3 text-xs text-muted-foreground">
					{availability.statusEmoji ? `${availability.statusEmoji} ` : ''}
					{availability.statusText || t('availability.status.placeholder')}
				</Text>
				<ScrollView className="max-h-80">
					{STATES.map((state) => {
						const selected = availability.manualState === state
						return (
							<Pressable
								key={state}
								onPress={() => {
									onUpdate({ manualState: state })
									onClose()
								}}
								className="flex-row items-center justify-between border-border/50 border-b py-3"
							>
								<View className="flex-row items-center gap-2">
									<View
										style={{
											width: 8,
											height: 8,
											borderRadius: 4,
											backgroundColor: resolveAvailabilityColor(
												state === 'auto' ? availability.effectiveState : state,
												colors
											)
										}}
									/>
									<Text className="text-sm text-foreground">{t(LABEL[state])}</Text>
								</View>
								{selected ? <Check size={16} color={colors.accent} /> : null}
							</Pressable>
						)
					})}
					<Pressable
						onPress={() => {
							onUpdate({
								dndUntil: dndActive ? null : new Date(Date.now() + 3_600_000).toISOString()
							})
							onClose()
						}}
						className="flex-row items-center justify-between py-3"
					>
						<Text className="text-sm text-foreground">
							{dndActive ? t('availability.dnd.off') : t('availability.dnd.1h')}
						</Text>
					</Pressable>
				</ScrollView>
			</View>
		</Modal>
	)
}
