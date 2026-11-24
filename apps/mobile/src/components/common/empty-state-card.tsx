import { Card, Surface } from 'heroui-native'
import type { ReactNode } from 'react'
import { View } from 'react-native'

export function EmptyStateCard({
	icon,
	title,
	description,
	action
}: {
	readonly icon: ReactNode
	readonly title: string
	readonly description: string
	readonly action?: ReactNode | undefined
}) {
	return (
		<Surface variant="secondary" className="mt-6 rounded-2xl p-6 items-center border border-border/50">
			<View className="h-12 w-12 rounded-full bg-accent/10 items-center justify-center mb-3">{icon}</View>
			<Card.Title className="text-center text-base font-semibold">{title}</Card.Title>
			<Card.Description className="text-center text-xs mt-1 max-w-xs">{description}</Card.Description>
			{action ? <View className="mt-4">{action}</View> : null}
		</Surface>
	)
}
