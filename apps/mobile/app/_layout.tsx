import '../global.css'
import '../src/lib/crypto-polyfill'
import * as Linking from 'expo-linking'
import * as Notifications from 'expo-notifications'
import { Stack, useRouter } from 'expo-router'
import { StatusBar } from 'expo-status-bar'
import * as SystemUI from 'expo-system-ui'
import { HeroUINativeProvider } from 'heroui-native'
import { useEffect } from 'react'
import { GestureHandlerRootView } from 'react-native-gesture-handler'
import { KeyboardProvider } from 'react-native-keyboard-controller'
import { SafeAreaProvider } from 'react-native-safe-area-context'
import { useUniwind } from 'uniwind'
import { parseHuriroDeepLink } from '../src/lib/deep-links'
import { type PushNotificationHintPayload, resolvePushHintTarget } from '../src/lib/push'
import { MobileRuntimeProvider, useMobileRuntime } from '../src/lib/runtime-context'
import { useHuriroColors } from '../src/lib/theme'

function RootNavigator() {
	const router = useRouter()
	const { runtime } = useMobileRuntime()
	const { theme } = useUniwind()
	const colors = useHuriroColors()

	useEffect(() => {
		void SystemUI.setBackgroundColorAsync(colors.background).catch(() => {})
	}, [colors.background])

	useEffect(() => {
		const urlSub = Linking.addEventListener('url', ({ url }) => {
			if (!runtime) return
			const target = parseHuriroDeepLink(url)
			if (target) router.push(target.href as never)
		})

		const notifSub = Notifications.addNotificationResponseReceivedListener((response) => {
			if (!runtime) return
			const data = response.notification.request.content.data as PushNotificationHintPayload
			const target = resolvePushHintTarget(data)
			if (target) router.push(target.href as never)
		})

		return () => {
			urlSub.remove()
			notifSub.remove()
		}
	}, [router, runtime])

	return (
		<>
			<StatusBar style={theme === 'dark' ? 'light' : 'dark'} />
			<Stack
				screenOptions={{
					headerShown: false,
					contentStyle: { backgroundColor: colors.background },
					headerStyle: { backgroundColor: colors.surface },
					headerTintColor: colors.accent,
					headerTitleStyle: { color: colors.foreground },
					headerShadowVisible: false
				}}
			/>
		</>
	)
}

export default function RootLayout() {
	return (
		<GestureHandlerRootView style={{ flex: 1 }}>
			<KeyboardProvider>
				<SafeAreaProvider>
					<HeroUINativeProvider config={{ devInfo: { stylingPrinciples: false } }}>
						<MobileRuntimeProvider>
							<RootNavigator />
						</MobileRuntimeProvider>
					</HeroUINativeProvider>
				</SafeAreaProvider>
			</KeyboardProvider>
		</GestureHandlerRootView>
	)
}
