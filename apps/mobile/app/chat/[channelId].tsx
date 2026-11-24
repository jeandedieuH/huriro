import { Stack, useLocalSearchParams } from 'expo-router'
import { Card } from 'heroui-native'
import { useState } from 'react'
import { Text } from 'react-native'
import { Container } from '../../src/components/app/container'
import { NativeChatComposer } from '../../src/components/chat/native-chat-composer'
import { FlashList } from '../../src/components/common/flash-list'

export default function ChannelDetailScreen() {
	const params = useLocalSearchParams<{ channelId?: string }>()
	const channelId = typeof params['channelId'] === 'string' ? params['channelId'] : 'general'
	const [messages, setMessages] = useState<{ id: string; bodyText: string }[]>([])

	return (
		<>
			<Stack.Screen options={{ headerShown: true, title: `#${channelId}` }} />
			<Container
				scroll={false}
				edges={['bottom']}
				footer={
					<NativeChatComposer
						channelName={channelId}
						onSend={(text) => setMessages((prev) => [...prev, { id: String(Date.now()), bodyText: text }])}
					/>
				}
			>
				<FlashList
					className="flex-1"
					data={messages}
					keyExtractor={(m) => m.id}
					contentContainerClassName="p-4 gap-2.5"
					renderItem={({ item }) => (
						<Card className="p-3.5 rounded-2xl border border-border/60">
							<Text className="text-sm text-foreground">{item.bodyText}</Text>
						</Card>
					)}
				/>
			</Container>
		</>
	)
}
