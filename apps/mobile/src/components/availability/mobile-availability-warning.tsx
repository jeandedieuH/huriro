import type { UserAvailabilityDto } from '@huriro/contracts'
import { type MessageId, t } from '@huriro/i18n'
import { UserRoundCheck } from 'lucide-react-native'
import { Pressable, Text, View } from 'react-native'

const STATE_LABEL: Record<UserAvailabilityDto['effectiveState'], MessageId> = {
	available: 'availability.state.available',
	busy: 'availability.state.busy',
	dnd: 'availability.state.dnd',
	away: 'availability.state.away',
	off_hours: 'availability.state.off_hours',
	ooo: 'availability.state.ooo',
	offline: 'availability.state.offline'
}

export function MobileAvailabilityWarning({
	availability,
	displayName,
	onAssignDelegate
}: {
	readonly availability: UserAvailabilityDto | null
	readonly displayName?: string | undefined
	readonly onAssignDelegate?: (() => void) | undefined
}) {
	if (!availability) return null
	if (
		availability.effectiveState !== 'ooo' &&
		availability.effectiveState !== 'dnd' &&
		availability.effectiveState !== 'off_hours'
	) {
		return null
	}
	const warning = availability.effectiveState === 'ooo' || availability.effectiveState === 'dnd'
	return (
		<View className="mx-1 flex-row items-center gap-2 rounded-lg border border-warning/40 bg-warning/10 px-3 py-2">
			<Text className="flex-1 text-[11px] text-warning">
				{displayName ?? availability.displayName ?? 'Teammate'} ·{' '}
				{t(STATE_LABEL[availability.effectiveState])}
				{availability.nextAvailableAt ? ` · ${new Date(availability.nextAvailableAt).toLocaleString()}` : ''}
			</Text>
			{warning && availability.delegateUserId && onAssignDelegate ? (
				<Pressable
					onPress={onAssignDelegate}
					className="flex-row items-center gap-1 rounded-md border border-warning/40 px-2 py-1"
					accessibilityLabel={t('availability.warning.assign-backup')}
				>
					<UserRoundCheck size={12} color="#d97706" />
					<Text className="text-[10px] font-medium text-warning">
						{t('availability.warning.assign-backup')}
					</Text>
				</Pressable>
			) : null}
		</View>
	)
}
