import { t } from '@huriro/i18n'
import { useCollectionItems, useSyncEngine } from '@huriro/sync-client'
import { Redirect, Tabs } from 'expo-router'
import { CheckSquare, FileText, Inbox, MessageSquare, Settings } from 'lucide-react-native'
import { useMobileRuntime } from '../../src/lib/runtime-context'

function TabLayoutInner() {
	const engine = useSyncEngine()
	const notifications = useCollectionItems(engine.collections.notifications)
	const unreadCount = notifications.filter((n) => n.archivedAt === null && n.readAt === null).length

	return (
		<Tabs
			screenOptions={{
				headerShadowVisible: false,
				tabBarShowLabel: true
			}}
		>
			<Tabs.Screen
				name="inbox"
				options={{
					title: t('mobile.tabs.inbox'),
					...(unreadCount > 0 ? { tabBarBadge: unreadCount } : {}),
					tabBarIcon: ({ color, size }) => <Inbox size={size} color={color} />
				}}
			/>
			<Tabs.Screen
				name="issues"
				options={{
					title: t('mobile.tabs.issues'),
					tabBarIcon: ({ color, size }) => <CheckSquare size={size} color={color} />
				}}
			/>
			<Tabs.Screen
				name="chat"
				options={{
					title: t('mobile.tabs.chat'),
					tabBarIcon: ({ color, size }) => <MessageSquare size={size} color={color} />
				}}
			/>
			<Tabs.Screen
				name="docs"
				options={{
					title: t('mobile.tabs.docs'),
					tabBarIcon: ({ color, size }) => <FileText size={size} color={color} />
				}}
			/>
			<Tabs.Screen
				name="settings"
				options={{
					title: t('mobile.tabs.settings'),
					tabBarIcon: ({ color, size }) => <Settings size={size} color={color} />
				}}
			/>
		</Tabs>
	)
}

export default function TabsLayout() {
	const { runtime, loading } = useMobileRuntime()
	if (!loading && !runtime) {
		return <Redirect href={'/(auth)/sign-in' as never} />
	}
	if (!runtime) return null

	return <TabLayoutInner />
}
