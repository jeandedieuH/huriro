import type { NotificationDto } from '@huriro/contracts'
import { Avatar, Card, Chip } from 'heroui-native'
import { Bell, CheckSquare, FileText, Mail, MessageSquare } from 'lucide-react-native'
import { Pressable, Text, View } from 'react-native'
import { type HuriroMobileColors, useHuriroColors } from '../../lib/theme'

function renderEntityIcon(
	entityType: string,
	colors: Pick<HuriroMobileColors, 'accent' | 'info' | 'success' | 'muted'>
) {
	switch (entityType) {
		case 'issue':
			return <CheckSquare size={15} color={colors.accent} />
		case 'chat_message':
		case 'chat_channel':
			return <MessageSquare size={15} color={colors.info} />
		case 'doc_page':
			return <FileText size={15} color={colors.accent} />
		case 'mail_conversation':
			return <Mail size={15} color={colors.success} />
		default:
			return <Bell size={15} color={colors.muted} />
	}
}

export function NotificationRow({
	notification,
	onPress
}: {
	readonly notification: NotificationDto
	readonly onPress: (notification: NotificationDto) => void
}) {
	const colors = useHuriroColors()
	const unread = notification.readAt === null
	const timeLabel = notification.createdAt.slice(11, 16)

	return (
		<Pressable onPress={() => onPress(notification)} accessibilityRole="button">
			<Card className="mb-3 p-4 rounded-2xl border border-border/60">
				<View className="flex-row items-start gap-3">
					<Avatar size="sm" variant="soft" color={unread ? 'accent' : 'default'} alt={notification.kind}>
						<Avatar.Fallback>{renderEntityIcon(notification.entityType, colors)}</Avatar.Fallback>
					</Avatar>

					<View className="flex-1 min-w-0">
						<View className="flex-row items-center justify-between gap-2">
							<Card.Title className="text-sm font-semibold flex-1" numberOfLines={1}>
								{notification.title}
							</Card.Title>
							<Text className="text-[11px] text-muted">{timeLabel}</Text>
						</View>

						{notification.body ? (
							<Card.Description className="text-xs mt-1" numberOfLines={2}>
								{notification.body}
							</Card.Description>
						) : null}

						<View className="flex-row items-center gap-2 mt-2.5">
							<Chip size="sm" variant="soft" color={unread ? 'accent' : 'default'}>
								<Chip.Label>{notification.kind}</Chip.Label>
							</Chip>
							{unread ? <View className="h-2 w-2 rounded-full bg-accent" /> : null}
						</View>
					</View>
				</View>
			</Card>
		</Pressable>
	)
}
