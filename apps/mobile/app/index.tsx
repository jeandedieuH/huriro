import { Redirect } from 'expo-router'
import { Spinner } from 'heroui-native'
import { Text, View } from 'react-native'
import { useMobileRuntime } from '../src/lib/runtime-context'

export default function EntryIndex() {
	const { runtime, loading } = useMobileRuntime()

	if (loading) {
		return (
			<View className="flex-1 bg-background items-center justify-center gap-3">
				<Spinner size="lg" />
				<Text className="text-xs text-muted font-medium">Loading workspace replica…</Text>
			</View>
		)
	}

	if (runtime) {
		return <Redirect href={'/(tabs)/inbox' as never} />
	}
	return <Redirect href={'/(auth)/sign-in' as never} />
}
