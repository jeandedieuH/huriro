import type { ReactNode } from 'react'
import { useReanimatedKeyboardAnimation } from 'react-native-keyboard-controller'
import Reanimated, { interpolate, useAnimatedStyle } from 'react-native-reanimated'

interface ContainerFooterProps {
	readonly children: ReactNode
	/** Safe-area bottom inset applied while the keyboard is closed. */
	readonly bottomInset: number
}

/**
 * Footer wrapper whose bottom safe-area padding collapses to zero as the keyboard
 * opens, so a pinned composer/CTA rides flush on top of the keyboard with no dead gap.
 */
export function ContainerFooter({ children, bottomInset }: ContainerFooterProps) {
	const { progress } = useReanimatedKeyboardAnimation()

	const animatedStyle = useAnimatedStyle(() => ({
		paddingBottom: interpolate(progress.value, [0, 1], [bottomInset, 0])
	}))

	return <Reanimated.View style={animatedStyle}>{children}</Reanimated.View>
}
