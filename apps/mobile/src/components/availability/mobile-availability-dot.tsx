import type { EffectiveAvailabilityState } from '@huriro/contracts'
import { type MessageId, t } from '@huriro/i18n'
import { Text, View } from 'react-native'
import { resolveAvailabilityColor, useHuriroColors } from '../../lib/theme'

const LABEL_ID: Record<EffectiveAvailabilityState, MessageId> = {
	available: 'availability.state.available',
	busy: 'availability.state.busy',
	dnd: 'availability.state.dnd',
	away: 'availability.state.away',
	off_hours: 'availability.state.off_hours',
	ooo: 'availability.state.ooo',
	offline: 'availability.state.offline'
}

export function MobileAvailabilityDot({
	state,
	size = 9
}: {
	readonly state: EffectiveAvailabilityState
	readonly size?: number
}) {
	const colors = useHuriroColors()
	const dotColor = resolveAvailabilityColor(state, colors)
	return (
		<View
			accessibilityRole="image"
			accessibilityLabel={t(LABEL_ID[state])}
			style={{
				width: size,
				height: size,
				borderRadius: size / 2,
				backgroundColor: dotColor,
				borderWidth: 1.5,
				borderColor: colors.surface
			}}
		/>
	)
}

export function MobileAvailabilityChip({ state }: { readonly state: EffectiveAvailabilityState }) {
	const colors = useHuriroColors()
	const chipColor = resolveAvailabilityColor(state, colors)
	return (
		<View
			className="flex-row items-center gap-1 rounded-md px-1.5 py-0.5"
			style={{ backgroundColor: `${chipColor}1a` }}
		>
			<MobileAvailabilityDot state={state} size={7} />
			<Text className="text-[10px] font-medium" style={{ color: chipColor }}>
				{t(LABEL_ID[state])}
			</Text>
		</View>
	)
}
