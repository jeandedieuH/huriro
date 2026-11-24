import { type ReactNode, useCallback, useMemo, useState } from 'react'
import {
	type LayoutChangeEvent,
	Platform,
	RefreshControl,
	type StyleProp,
	View,
	type ViewStyle
} from 'react-native'
import {
	DefaultKeyboardToolbarTheme,
	KeyboardAvoidingView,
	KeyboardAwareScrollView,
	KeyboardStickyView,
	KeyboardToolbar
} from 'react-native-keyboard-controller'
import { useSafeAreaInsets } from 'react-native-safe-area-context'
import { ContainerFooter } from './container-footer'

type ContainerEdge = 'top' | 'bottom'
type ContainerPadding = 'none' | 'sm' | 'md' | 'lg'

/** Named spacing scale so screens stop hand-tuning px-/p- classes. */
const CONTENT_PADDING: Record<ContainerPadding, number> = {
	none: 0,
	sm: 12,
	md: 16,
	lg: 20
}

export interface ContainerProps {
	readonly children: ReactNode
	/**
	 * `true` (default) renders the body in a `KeyboardAwareScrollView`.
	 * Pass `false` for screens that own a virtualized list (FlatList/FlashList);
	 * the body is then a plain flex-1 view inside a `KeyboardAvoidingView`.
	 */
	readonly scroll?: boolean
	/** Non-scrolling slot rendered above the body (sync banner, chips, search). */
	readonly header?: ReactNode
	/** Slot pinned below the body (chat composer, primary CTA). */
	readonly footer?: ReactNode
	/**
	 * Safe-area edges the container applies itself. Tabs/headers already handle
	 * insets, so the default is none; standalone screens like sign-in pass both.
	 */
	readonly edges?: readonly ContainerEdge[]
	/** Horizontal/vertical content padding scale. Default `'md'` (16). */
	readonly padding?: ContainerPadding
	/** Gap between direct children in scroll mode. Default 16. */
	readonly gap?: number
	/** `'center'` vertically centers short content (auth, empty states). */
	readonly justify?: 'start' | 'center'
	/** Enables pull-to-refresh in scroll mode when provided. */
	readonly onRefresh?: () => Promise<void> | void
	/** Renders the native prev/next/done `KeyboardToolbar` (iOS/Android only). */
	readonly keyboardToolbar?: boolean
	/** Extra classes for the outer container view. */
	readonly className?: string
	/** Extra style merged into the scroll content container. */
	readonly contentStyle?: StyleProp<ViewStyle>
	/** Breathing room kept between a focused input and the keyboard. Default 24. */
	readonly bottomOffset?: number
	readonly testID?: string
}

/**
 * Keyboard-aware screen wrapper: every screen renders inside `Container` instead of
 * wiring its own ScrollView/KeyboardAvoidingView. Requires `KeyboardProvider`
 * mounted at the root (see `app/_layout.tsx`).
 */
export function Container({
	children,
	scroll = true,
	header,
	footer,
	edges = [],
	padding = 'md',
	gap = 16,
	justify = 'start',
	onRefresh,
	keyboardToolbar = false,
	className,
	contentStyle,
	bottomOffset = 24,
	testID
}: ContainerProps) {
	const insets = useSafeAreaInsets()
	const [refreshing, setRefreshing] = useState(false)
	// Height of the sticky footer, fed back into the scroll view so the last
	// field is never trapped behind it when the keyboard opens.
	const [footerHeight, setFooterHeight] = useState(0)

	const applyTopInset = edges.includes('top')
	const applyBottomInset = edges.includes('bottom')

	const contentContainerStyle = useMemo<StyleProp<ViewStyle>>(
		() => [
			{
				padding: CONTENT_PADDING[padding],
				gap,
				flexGrow: 1,
				justifyContent: justify === 'center' ? 'center' : 'flex-start',
				// With a pinned footer the bottom inset lives on the footer instead.
				paddingBottom: CONTENT_PADDING[padding] + (applyBottomInset && !footer ? insets.bottom : 0)
			},
			contentStyle
		],
		[padding, gap, justify, applyBottomInset, footer, insets.bottom, contentStyle]
	)

	const outerStyle = useMemo<ViewStyle>(
		() => ({ flex: 1, paddingTop: applyTopInset ? insets.top : 0 }),
		[applyTopInset, insets.top]
	)

	const handleRefresh = useCallback(async () => {
		if (!onRefresh) return
		setRefreshing(true)
		try {
			await onRefresh()
		} catch {
			// Screens surface their own refresh errors; the spinner must never stick.
		} finally {
			setRefreshing(false)
		}
	}, [onRefresh])

	const handleFooterLayout = useCallback((event: LayoutChangeEvent) => {
		setFooterHeight(event.nativeEvent.layout.height)
	}, [])

	const footerInset = applyBottomInset ? insets.bottom : 0
	const showToolbar = keyboardToolbar && (Platform.OS === 'ios' || Platform.OS === 'android')
	const outerClassName = className ? `bg-background ${className}` : 'bg-background'

	if (!scroll) {
		return (
			<View className={outerClassName} style={outerStyle} testID={testID}>
				<KeyboardAvoidingView behavior="padding" automaticOffset style={{ flex: 1 }}>
					{header}
					<View style={{ flex: 1 }}>{children}</View>
					{footer ? <ContainerFooter bottomInset={footerInset}>{footer}</ContainerFooter> : null}
				</KeyboardAvoidingView>
				{showToolbar ? <KeyboardToolbar theme={DefaultKeyboardToolbarTheme} /> : null}
			</View>
		)
	}

	return (
		<View className={outerClassName} style={outerStyle} testID={testID}>
			{header}
			<KeyboardAwareScrollView
				style={{ flex: 1 }}
				bottomOffset={bottomOffset}
				extraKeyboardSpace={footer ? footerHeight : 0}
				keyboardShouldPersistTaps="handled"
				keyboardDismissMode={Platform.OS === 'ios' ? 'interactive' : 'on-drag'}
				showsVerticalScrollIndicator={false}
				alwaysBounceVertical={Boolean(onRefresh)}
				contentContainerStyle={contentContainerStyle}
				refreshControl={
					onRefresh ? (
						<RefreshControl refreshing={refreshing} onRefresh={() => void handleRefresh()} />
					) : undefined
				}
			>
				{children}
			</KeyboardAwareScrollView>
			{footer ? (
				<KeyboardStickyView>
					<View onLayout={handleFooterLayout}>
						<ContainerFooter bottomInset={footerInset}>{footer}</ContainerFooter>
					</View>
				</KeyboardStickyView>
			) : null}
			{showToolbar ? <KeyboardToolbar theme={DefaultKeyboardToolbarTheme} /> : null}
		</View>
	)
}

export default Container
