import { Stack, useLocalSearchParams } from 'expo-router'
import { Alert, Card, Chip } from 'heroui-native'
import { Mail } from 'lucide-react-native'
import { View } from 'react-native'

export default function MailConversationScreen() {
	const params = useLocalSearchParams<{ conversationId?: string }>()
	const conversationId = typeof params['conversationId'] === 'string' ? params['conversationId'] : ''

	return (
		<>
			<Stack.Screen options={{ headerShown: true, title: 'Shared Inbox Thread' }} />
			<View className="flex-1 bg-background p-4 gap-3">
				<Card className="p-4 rounded-2xl border border-border/60 gap-2">
					<View className="flex-row items-center justify-between">
						<View className="flex-row items-center gap-2">
							<Mail size={18} color="#059669" />
							<Card.Title className="text-base font-semibold">Conversation {conversationId}</Card.Title>
						</View>
						<Chip size="sm" variant="soft" color="default">
							<Chip.Label>Shared Inbox</Chip.Label>
						</Chip>
					</View>
					<Card.Description className="text-xs">
						Deep-linked securely via Huriro session context.
					</Card.Description>
				</Card>

				<Alert status="accent">
					<Alert.Indicator />
					<Alert.Content>
						<Alert.Title>Full HTML Timeline on Web</Alert.Title>
						<Alert.Description>
							Open Huriro on the web to view full sanitized HTML emails, compose replies with undo-send, and
							download quarantined attachments.
						</Alert.Description>
					</Alert.Content>
				</Alert>
			</View>
		</>
	)
}
