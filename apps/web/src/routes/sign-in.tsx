import { t } from '@huriro/i18n'
import { createFileRoute } from '@tanstack/react-router'
import { AuthLayout } from '@/features/auth/components/auth-layout'
import { SignInForm, SignInSwitchPrompt } from '@/features/auth/components/sign-in-form'
import { useAuthFlow } from '@/features/auth/context'

export interface SignInSearch {
	readonly redirect?: string | undefined
	readonly error?: string | undefined
}

function readString(value: unknown): string | undefined {
	return typeof value === 'string' && value.length > 0 ? value : undefined
}

export const Route = createFileRoute('/sign-in')({
	validateSearch: (search: Record<string, unknown>): SignInSearch => {
		const redirect = readString(search['redirect'])
		const error = readString(search['error'])
		return {
			...(redirect ? { redirect } : {}),
			...(error ? { error } : {})
		}
	},
	component: SignInRoute
})

function SignInRoute() {
	const search = Route.useSearch()
	const { needsSetup, socialProviders, onAuthenticated, onUsePreview } = useAuthFlow()

	return (
		<AuthLayout
			title={t('auth.sign-in.title')}
			subtitle={t('auth.sign-in.subtitle')}
			footer={<SignInSwitchPrompt redirectTo={search.redirect} />}
			onUsePreview={onUsePreview}
		>
			<SignInForm
				socialProviders={socialProviders}
				needsSetup={needsSetup}
				redirectTo={search.redirect}
				oauthError={search.error}
				hideSwitchPrompt
				onComplete={onAuthenticated}
			/>
		</AuthLayout>
	)
}
