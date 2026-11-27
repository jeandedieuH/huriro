import { t } from '@huriro/i18n'
import { Button, Chip, Surface } from 'heroui-native'
import { Send } from 'lucide-react-native'
import { useState } from 'react'
import { TextInput, View } from 'react-native'
import { useHuriroColors } from '../../lib/theme'

/**
 * 100% native React Native chat composer (§18.2: chat feeds + composers never run in a WebView).
 */
export function NativeChatComposer({
	channelName,
	inThread = false,
	onSend,
	onTyping
}: {
	readonly channelName: string
	readonly inThread?: boolean
	readonly onSend: (text: string, opts?: { readonly broadcastToChannel?: boolean }) => Promise<void> | void
	readonly onTyping?: () => void
}) {
	const [draft, setDraft] = useState('')
	const [sending, setSending] = useState(false)
	const [broadcastToChannel, setBroadcastToChannel] = useState(false)
	const colors = useHuriroColors()
	const canSend = draft.trim().length > 0 && !sending

	async function handleSubmit() {
		const trimmed = draft.trim()
		if (!trimmed || sending) return
		setSending(true)
		try {
			await onSend(trimmed, inThread ? { broadcastToChannel } : undefined)
			setDraft('')
			setBroadcastToChannel(false)
		} finally {
			setSending(false)
		}
	}

	return (
		<Surface variant="default" className="border-t border-border/60 px-3 py-2.5 gap-2">
			{inThread ? (
				<View className="flex-row items-center">
					<Chip
						size="sm"
						variant={broadcastToChannel ? 'primary' : 'soft'}
						color={broadcastToChannel ? 'accent' : 'default'}
						onPress={() => setBroadcastToChannel((v) => !v)}
					>
						<Chip.Label>{t('chat.thread.broadcast')}</Chip.Label>
					</Chip>
				</View>
			) : null}
			<View className="flex-row items-end gap-2">
				<TextInput
					className="flex-1 rounded-xl border border-border bg-field px-3.5 py-2.5 text-sm text-foreground max-h-28"
					value={draft}
					onChangeText={(next) => {
						setDraft(next)
						if (next.trim()) onTyping?.()
					}}
					placeholder={t('mobile.chat.reply-placeholder', { name: channelName })}
					placeholderTextColor={colors.muted}
					selectionColor={colors.accent}
					multiline
					accessibilityLabel="Chat message input"
				/>
				<Button
					isIconOnly
					size="md"
					variant="primary"
					isDisabled={!canSend}
					onPress={() => void handleSubmit()}
					accessibilityLabel="Send message"
				>
					<Send size={16} color={colors.accentForeground} />
				</Button>
			</View>
		</Surface>
	)
}
