import type { ChatPinnedMessageDto } from '@huriro/contracts'
import { t } from '@huriro/i18n'
import { Button, Card } from 'heroui-native'
import { Pin, PinOff, X } from 'lucide-react-native'
import { Modal, Pressable, ScrollView, Text, View } from 'react-native'

/**
 * Native modal sheet presenting pinned channel messages with jump-to-message and unpin actions.
 */
export function MobilePinsSheet({
	visible,
	pins,
	onClose,
	onSelectMessage,
	onUnpin
}: {
	readonly visible: boolean
	readonly pins: readonly ChatPinnedMessageDto[]
	readonly onClose: () => void
	readonly onSelectMessage: (messageId: string) => void
	readonly onUnpin: (messageId: string) => void
}) {
	return (
		<Modal visible={visible} transparent animationType="slide" onRequestClose={onClose}>
			<View className="flex-1 justify-end bg-black/40">
				<View className="max-h-[75%] rounded-t-3xl bg-background border-t border-border p-4 gap-3">
					<View className="flex-row items-center justify-between pb-1">
						<View className="flex-row items-center gap-2">
							<Pin size={16} color="#2563eb" />
							<Text className="text-base font-semibold text-foreground">{t('chat.pins.title')}</Text>
						</View>
						<Button
							isIconOnly
							size="sm"
							variant="secondary"
							onPress={onClose}
							accessibilityLabel={t('chat.pins.close')}
						>
							<X size={16} color="#71717a" />
						</Button>
					</View>

					{pins.length === 0 ? (
						<Card className="p-4 rounded-2xl border border-default-soft-hover">
							<Card.Description className="text-xs text-center">{t('chat.pins.empty')}</Card.Description>
						</Card>
					) : (
						<ScrollView className="gap-2">
							{pins.map((pin) => (
								<Card key={pin.messageId} className="mb-2 p-3 rounded-2xl border border-default-soft-hover">
									<View className="flex-row items-start justify-between gap-2">
										<Pressable
											className="flex-1"
											onPress={() => {
												onSelectMessage(pin.messageId)
												onClose()
											}}
											accessibilityRole="button"
										>
											<Text className="text-sm text-foreground">{pin.bodyText}</Text>
											<Text className="text-[11px] text-muted mt-1">{pin.createdAt.slice(0, 16)}</Text>
										</Pressable>
										<Button
											isIconOnly
											size="sm"
											variant="secondary"
											onPress={() => onUnpin(pin.messageId)}
											accessibilityLabel="Unpin message"
										>
											<PinOff size={14} color="#71717a" />
										</Button>
									</View>
								</Card>
							))}
						</ScrollView>
					)}
				</View>
			</View>
		</Modal>
	)
}
