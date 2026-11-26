import type { EffectiveAvailabilityState } from '@huriro/contracts'
import { type MessageId, t } from '@huriro/i18n'
import { Text, View } from 'react-native'
import { availabilityColor } from '../../stores/availability-store'

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
	return (
		<View
			accessibilityRole="image"
			accessibilityLabel={t(LABEL_ID[state])}
			style={{
				width: size,
				height: size,
				borderRadius: size / 2,
				backgroundColor: availabilityColor(state),
				borderWidth: 1.5,
				borderColor: '#ffffff'
			}}
		/>
	)
}

export function MobileAvailabilityChip({ state }: { readonly state: EffectiveAvailabilityState }) {
	return (
		<View
			className="flex-row items-center gap-1 rounded-md px-1.5 py-0.5"
			style={{ backgroundColor: `${availabilityColor(state)}1a` }}
		>
			<MobileAvailabilityDot state={state} size={7} />
			<Text className="text-[10px] font-medium" style={{ color: availabilityColor(state) }}>
				{t(LABEL_ID[state])}
			</Text>
		</View>
	)
}
