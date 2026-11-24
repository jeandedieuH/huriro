import { t } from '@huriro/i18n'
import { Button, Surface } from 'heroui-native'
import { Send } from 'lucide-react-native'
import { useState } from 'react'
import { TextInput, View } from 'react-native'

/**
 * 100% native React Native chat composer (§18.2: chat feeds + composers never run in a WebView).
 */
export function NativeChatComposer({
	channelName,
	onSend,
	onTyping
}: {
	readonly channelName: string
	readonly onSend: (text: string) => Promise<void> | void
	readonly onTyping?: () => void
}) {
	const [draft, setDraft] = useState('')
	const [sending, setSending] = useState(false)
	const canSend = draft.trim().length > 0 && !sending

	async function handleSubmit() {
		const trimmed = draft.trim()
		if (!trimmed || sending) return
		setSending(true)
		try {
			await onSend(trimmed)
			setDraft('')
		} finally {
			setSending(false)
		}
	}

	return (
		<Surface variant="default" className="border-t border-border/60 px-3 py-2.5">
			<View className="flex-row items-end gap-2">
				<TextInput
					className="flex-1 rounded-xl border border-border bg-field px-3.5 py-2.5 text-sm text-foreground max-h-28"
					value={draft}
					onChangeText={(next) => {
						setDraft(next)
						if (next.trim()) onTyping?.()
					}}
					placeholder={t('mobile.chat.reply-placeholder', { name: channelName })}
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
					<Send size={16} color="#ffffff" />
				</Button>
			</View>
		</Surface>
	)
}
