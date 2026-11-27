import type { UpdateUserStatusBody, UserAvailabilityDto, UserWorkspaceProfileDto } from '@huriro/contracts'
import { t } from '@huriro/i18n'
import { Button, Chip, Surface } from 'heroui-native'
import { BellOff, Check, Smile, X } from 'lucide-react-native'
import { useEffect, useState } from 'react'
import { TextInput, View } from 'react-native'
import { useHuriroColors } from '../../lib/theme'
import { MobileAvailabilityChip } from '../availability/mobile-availability-dot'

/**
 * Compact status & DND bar backed by `/api/v1/chat/me/status` so users can broadcast
 * availability or pause notifications directly from the mobile chat tab.
 */
export function MobileStatusBar({
	profile,
	availability,
	onUpdate
}: {
	readonly profile: UserWorkspaceProfileDto | null
	readonly availability?: UserAvailabilityDto | null
	readonly onUpdate: (body: UpdateUserStatusBody) => Promise<void> | void
}) {
	const [draft, setDraft] = useState(profile?.statusText ?? '')
	const [busy, setBusy] = useState(false)
	const colors = useHuriroColors()

	useEffect(() => {
		setDraft(profile?.statusText ?? '')
	}, [profile?.statusText])

	const dndActive = Boolean(profile?.dndUntil && Date.parse(profile.dndUntil) > Date.now())

	async function commit(body: UpdateUserStatusBody) {
		if (busy) return
		setBusy(true)
		try {
			await onUpdate(body)
		} finally {
			setBusy(false)
		}
	}

	return (
		<Surface variant="default" className="border-b border-border/50 px-4 py-2 gap-2">
			<View className="flex-row items-center gap-2">
				<Smile size={15} color={colors.muted} />
				{availability ? <MobileAvailabilityChip state={availability.effectiveState} /> : null}
				<TextInput
					className="flex-1 rounded-lg border border-border bg-field px-2.5 py-1.5 text-xs text-foreground"
					value={draft}
					onChangeText={setDraft}
					placeholder={t('chat.status.placeholder')}
					placeholderTextColor={colors.muted}
					selectionColor={colors.accent}
					accessibilityLabel={t('chat.status.title')}
					onSubmitEditing={() =>
						void commit({ statusText: draft.trim(), statusEmoji: draft.trim() ? '💬' : null })
					}
				/>
				<Button
					isIconOnly
					size="sm"
					variant="secondary"
					isDisabled={busy}
					onPress={() => void commit({ statusText: draft.trim(), statusEmoji: draft.trim() ? '💬' : null })}
					accessibilityLabel={t('chat.status.title')}
				>
					<Check size={14} color={colors.accent} />
				</Button>
				{profile?.statusText || dndActive ? (
					<Button
						isIconOnly
						size="sm"
						variant="secondary"
						isDisabled={busy}
						onPress={() => {
							setDraft('')
							void commit({ statusText: '', statusEmoji: null, dndUntil: null })
						}}
						accessibilityLabel={t('chat.status.clear')}
					>
						<X size={14} color={colors.muted} />
					</Button>
				) : null}
				<Chip
					size="sm"
					variant={dndActive ? 'primary' : 'soft'}
					color={dndActive ? 'warning' : 'default'}
					onPress={() =>
						void commit({
							dndUntil: dndActive ? null : new Date(Date.now() + 60 * 60 * 1000).toISOString()
						})
					}
				>
					<BellOff size={12} color={dndActive ? colors.warningForeground : colors.muted} />
					<Chip.Label>{dndActive ? t('chat.status.dnd-on') : t('chat.status.dnd-off')}</Chip.Label>
				</Chip>
			</View>
		</Surface>
	)
}
