import type { BillingSummaryResponse } from '@huriro/contracts'
import { t } from '@huriro/i18n'
import { useSyncEngine, useSyncStatus } from '@huriro/sync-client'
import { useRouter } from 'expo-router'
import { Alert, Avatar, Button, Card, Chip, Separator, Switch } from 'heroui-native'
import { Bell, CreditCard, Database, LogOut, ShieldCheck } from 'lucide-react-native'
import { useEffect, useState } from 'react'
import { Platform, View } from 'react-native'
import { Container } from '../../src/components/app/container'
import { registerExpoPushDevice } from '../../src/lib/push'
import { useMobileRuntime } from '../../src/lib/runtime-context'
import { useMobileUiStore } from '../../src/stores/mobile-ui-store'

export default function SettingsTabScreen() {
	const router = useRouter()
	const { runtime, signOut } = useMobileRuntime()
	const engine = useSyncEngine()
	const syncStatus = useSyncStatus()
	const session = useMobileUiStore((s) => s.session)
	const registeredPush = useMobileUiStore((s) => s.registeredPush)
	const setRegisteredPush = useMobileUiStore((s) => s.setRegisteredPush)

	const [billing, setBilling] = useState<BillingSummaryResponse | null>(null)
	const [pushEnabled, setPushEnabled] = useState(Boolean(registeredPush))

	useEffect(() => {
		if (!runtime || runtime.isPreview) return
		let cancelled = false
		void runtime.api
			.getBillingSummaryReadOnly()
			.then((res) => {
				if (!cancelled) setBilling(res)
			})
			.catch(() => {})
		return () => {
			cancelled = true
		}
	}, [runtime])

	async function handlePushToggle(nextSelected: boolean) {
		setPushEnabled(nextSelected)
		if (!nextSelected) {
			if (registeredPush && runtime && !runtime.isPreview) {
				await runtime.api.revokeMobilePushToken(registeredPush.id).catch(() => {})
			}
			setRegisteredPush(null)
			return
		}
		if (!runtime || runtime.isPreview) {
			return
		}
		const registered = await registerExpoPushDevice({
			api: runtime.api,
			platform: Platform.OS === 'android' ? 'android' : 'ios',
			deviceId: `huriro-${Platform.OS}-device`,
			deviceName: `Huriro ${Platform.OS}`
		})
		if (registered) {
			setRegisteredPush(registered)
		}
	}

	async function handleSignOut() {
		await signOut()
		router.replace('/(auth)/sign-in' as never)
	}

	const displayName = session?.displayName ?? 'Huriro Preview'
	const initials = displayName.slice(0, 2).toUpperCase()

	return (
		<Container>
			{/* Profile Card */}
			<Card className="p-4 rounded-2xl border border-border/60">
				<View className="flex-row items-center gap-3">
					<Avatar size="md" variant="default" color="accent" alt={displayName}>
						<Avatar.Fallback>{initials}</Avatar.Fallback>
					</Avatar>
					<View className="flex-1">
						<Card.Title className="text-base font-semibold">{displayName}</Card.Title>
						<Card.Description className="text-xs mt-0.5">
							{session?.serverUrl ?? 'Offline SQLite Demo Workspace'}
						</Card.Description>
					</View>
					<Chip size="sm" variant="soft" color="success">
						<ShieldCheck size={11} color="#16a34a" />
						<Chip.Label>{runtime?.isPreview ? 'Preview' : 'Connected'}</Chip.Label>
					</Chip>
				</View>
			</Card>

			{/* Push Notifications */}
			<Card className="p-4 rounded-2xl border border-border/60 gap-3">
				<View className="flex-row items-center justify-between gap-3">
					<View className="flex-row items-center gap-2.5 flex-1">
						<Bell size={18} color="#71717a" />
						<View className="flex-1">
							<Card.Title className="text-sm font-semibold">{t('mobile.push.register')}</Card.Title>
							<Card.Description className="text-xs">
								Hint-only alerts — payloads fetch over Bearer TLS on tap.
							</Card.Description>
						</View>
					</View>
					<Switch isSelected={pushEnabled} onSelectedChange={(val) => void handlePushToggle(val)} />
				</View>
				{pushEnabled ? (
					<Chip size="sm" variant="soft" color="success" className="self-start">
						<Chip.Label>{t('mobile.push.enabled')}</Chip.Label>
					</Chip>
				) : null}
			</Card>

			{/* Web-Only Cloud Billing Card — strictly read-only on mobile */}
			<Card className="p-4 rounded-2xl border border-border/60 gap-3">
				<View className="flex-row items-center justify-between">
					<View className="flex-row items-center gap-2">
						<CreditCard size={18} color="#71717a" />
						<Card.Title className="text-sm font-semibold">{t('settings.billing.title')}</Card.Title>
					</View>
					<Chip size="sm" variant="soft" color="accent">
						<Chip.Label>{billing?.subscription.plan.toUpperCase() ?? 'WEB ONLY'}</Chip.Label>
					</Chip>
				</View>

				{billing ? (
					<View className="flex-row flex-wrap gap-2">
						<Chip size="sm" variant="secondary">
							<Chip.Label>Status: {billing.subscription.status}</Chip.Label>
						</Chip>
						<Chip size="sm" variant="secondary">
							<Chip.Label>$10 USD / {billing.quote.rwfAmount.toLocaleString('en-US')} RWF</Chip.Label>
						</Chip>
					</View>
				) : null}

				<Alert status="accent">
					<Alert.Indicator />
					<Alert.Content>
						<Alert.Title>Web Checkout Required</Alert.Title>
						<Alert.Description>{t('settings.billing.web-only-mobile')}</Alert.Description>
					</Alert.Content>
				</Alert>
			</Card>

			{/* Sync Diagnostics */}
			<Card className="p-4 rounded-2xl border border-border/60 gap-2">
				<View className="flex-row items-center gap-2">
					<Database size={16} color="#71717a" />
					<Card.Title className="text-sm font-semibold">Offline Replica Diagnostics</Card.Title>
				</View>
				<Separator />
				<View className="flex-row flex-wrap gap-2 pt-1">
					<Chip size="sm" variant="soft" color="default">
						<Chip.Label>Storage: {syncStatus.storageMode.toUpperCase()}</Chip.Label>
					</Chip>
					<Chip size="sm" variant="soft" color="default">
						<Chip.Label>Cursor: {syncStatus.cursor}</Chip.Label>
					</Chip>
					<Chip size="sm" variant="soft" color={syncStatus.pendingCount > 0 ? 'warning' : 'success'}>
						<Chip.Label>Pending outbox: {syncStatus.pendingCount}</Chip.Label>
					</Chip>
					<Chip size="sm" variant="soft" color="default">
						<Chip.Label>Workspace: {engine.workspaceId.slice(0, 8)}…</Chip.Label>
					</Chip>
				</View>
			</Card>

			<Button variant="danger" size="lg" onPress={() => void handleSignOut()}>
				<LogOut size={16} color="#ffffff" />
				<Button.Label>Sign out & wipe local replica</Button.Label>
			</Button>
		</Container>
	)
}
