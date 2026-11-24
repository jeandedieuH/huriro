import { t } from '@huriro/i18n'
import axios from 'axios'
import { useRouter } from 'expo-router'
import {
	Alert,
	Button,
	Card,
	Chip,
	FieldError,
	Input,
	Label,
	Separator,
	Spinner,
	TextField
} from 'heroui-native'
import { Compass, Layers, ShieldCheck } from 'lucide-react-native'
import { useState } from 'react'
import { Platform, Text, View } from 'react-native'
import { z } from 'zod'
import { Container } from '../../src/components/app/container'
import { HuriroMobileApiClient } from '../../src/lib/api-client'
import { defaultServerUrl } from '../../src/lib/env'
import { useMobileRuntime } from '../../src/lib/runtime-context'

const SignInSchema = z.object({
	serverUrl: z.url('Enter a valid Huriro server URL'),
	email: z.email('Enter a valid email address'),
	password: z.string().min(8, 'Password must be at least 8 characters')
})

export default function SignInScreen() {
	const router = useRouter()
	const { signInWithSession, enterPreview } = useMobileRuntime()

	const [serverUrl, setServerUrl] = useState(() => defaultServerUrl())
	const [email, setEmail] = useState('')
	const [password, setPassword] = useState('')
	const [busy, setBusy] = useState(false)
	const [fieldErrors, setFieldErrors] = useState<{
		readonly serverUrl?: string | undefined
		readonly email?: string | undefined
		readonly password?: string | undefined
	}>({})
	const [submitError, setSubmitError] = useState<string | null>(null)

	async function handleSignIn() {
		const parsed = SignInSchema.safeParse({
			serverUrl: serverUrl.trim(),
			email: email.trim(),
			password
		})
		if (!parsed.success) {
			const nextErrors: { serverUrl?: string; email?: string; password?: string } = {}
			for (const issue of parsed.error.issues) {
				const key = issue.path[0]
				if (key === 'serverUrl') nextErrors.serverUrl = issue.message
				if (key === 'email') nextErrors.email = issue.message
				if (key === 'password') nextErrors.password = issue.message
			}
			setFieldErrors(nextErrors)
			return
		}
		setFieldErrors({})
		setBusy(true)
		setSubmitError(null)
		try {
			const cleanUrl = parsed.data.serverUrl.replace(/\/$/, '')
			const authRes = await axios.post(
				`${cleanUrl}/api/auth/sign-in/email`,
				{
					email: parsed.data.email,
					password: parsed.data.password
				},
				{
					headers: {
						'x-huriro-client': 'huriro-mobile',
						'x-huriro-platform': Platform.OS
					},
					// Resolve on any status — fetch-equivalent; branch on status below.
					validateStatus: () => true
				}
			)
			if (authRes.status >= 300) {
				throw new Error(`Sign-in rejected (${authRes.status})`)
			}
			const authBody = authRes.data as {
				token?: string
				user?: { id?: string; email?: string; name?: string }
			}
			const bearer = authBody.token ?? ''
			if (!bearer || !authBody.user?.id) {
				throw new Error('Server did not return a mobile bearer session token')
			}

			const probeClient = new HuriroMobileApiClient({
				serverUrl: cleanUrl,
				workspaceId: '',
				platform: Platform.OS === 'android' ? 'android' : 'ios',
				getToken: () => bearer
			})
			const workspaces = await probeClient.listWorkspaces()
			const ws = workspaces[0]
			if (!ws) {
				throw new Error('No workspaces available for this account')
			}

			await signInWithSession({
				serverUrl: cleanUrl,
				token: bearer,
				workspaceId: ws.id,
				userId: authBody.user.id,
				email: authBody.user.email ?? parsed.data.email,
				displayName: authBody.user.name ?? parsed.data.email
			})
			router.replace('/(tabs)/inbox' as never)
		} catch (err) {
			setSubmitError(err instanceof Error ? err.message : 'Unable to sign in')
		} finally {
			setBusy(false)
		}
	}

	async function handlePreview() {
		setBusy(true)
		setSubmitError(null)
		try {
			await enterPreview()
			router.replace('/(tabs)/inbox' as never)
		} finally {
			setBusy(false)
		}
	}

	return (
		<Container edges={['top', 'bottom']} padding="lg" gap={20} justify="center" keyboardToolbar>
			{/* Hero Identity Header */}
			<View className="gap-2">
				<View className="flex-row items-center gap-2.5">
					<View className="h-11 w-11 rounded-2xl bg-accent items-center justify-center">
						<Layers size={22} color="#ffffff" />
					</View>
					<View>
						<Text className="text-2xl font-bold tracking-tight text-foreground">
							{t('mobile.auth.title')}
						</Text>
						<View className="flex-row items-center gap-1.5 mt-0.5">
							<Chip size="sm" variant="soft" color="success">
								<ShieldCheck size={11} color="#16a34a" />
								<Chip.Label>Offline SQLite</Chip.Label>
							</Chip>
						</View>
					</View>
				</View>
			</View>

			{/* Sign-In Form Card */}
			<Card className="p-5 rounded-3xl border border-border/60 gap-4">
				<TextField isInvalid={Boolean(fieldErrors.serverUrl)} isRequired>
					<Label>{t('mobile.auth.server-url')}</Label>
					<Input
						value={serverUrl}
						onChangeText={setServerUrl}
						autoCapitalize="none"
						keyboardType="url"
						placeholder="https://app.huriro.dev"
					/>
					<FieldError>{fieldErrors.serverUrl}</FieldError>
				</TextField>

				<TextField isInvalid={Boolean(fieldErrors.email)} isRequired>
					<Label>{t('mobile.auth.email')}</Label>
					<Input
						value={email}
						onChangeText={setEmail}
						autoCapitalize="none"
						keyboardType="email-address"
						placeholder="you@company.rw"
					/>
					<FieldError>{fieldErrors.email}</FieldError>
				</TextField>

				<TextField isInvalid={Boolean(fieldErrors.password)} isRequired>
					<Label>{t('mobile.auth.password')}</Label>
					<Input value={password} onChangeText={setPassword} secureTextEntry placeholder="••••••••" />
					<FieldError>{fieldErrors.password}</FieldError>
				</TextField>

				{submitError ? (
					<Alert status="danger">
						<Alert.Indicator />
						<Alert.Content>
							<Alert.Title>Sign-in failed</Alert.Title>
							<Alert.Description>{submitError}</Alert.Description>
						</Alert.Content>
					</Alert>
				) : null}

				<Button variant="primary" size="lg" isDisabled={busy} onPress={() => void handleSignIn()}>
					{busy ? <Spinner size="sm" /> : null}
					<Button.Label>{t('mobile.auth.sign-in')}</Button.Label>
				</Button>

				<Separator />

				<Button variant="secondary" size="md" isDisabled={busy} onPress={() => void handlePreview()}>
					<Compass size={16} color="#18181b" />
					<Button.Label>{t('mobile.auth.preview-demo')}</Button.Label>
				</Button>
			</Card>

			<Alert status="accent">
				<Alert.Indicator />
				<Alert.Content>
					<Alert.Title>Web-only workspace billing</Alert.Title>
					<Alert.Description>{t('settings.billing.web-only-mobile')}</Alert.Description>
				</Alert.Content>
			</Alert>
		</Container>
	)
}
