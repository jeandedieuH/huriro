import { Card, type CardRootProps } from 'heroui-native'
import type { ReactNode } from 'react'

export interface SurfaceCardProps extends CardRootProps {
	readonly children: ReactNode
}

export function SurfaceCard({ children, className, ...props }: SurfaceCardProps) {
	return (
		<Card className={className ?? 'mb-3 p-4 rounded-2xl border border-border/60'} {...props}>
			{children}
		</Card>
	)
}
