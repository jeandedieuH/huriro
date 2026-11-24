import { t } from '@huriro/i18n'
import { createFileRoute } from '@tanstack/react-router'
import { AuthLayout } from '@/features/auth/components/auth-layout'
import { SignUpForm, SignUpSwitchPrompt } from '@/features/auth/components/sign-up-form'
import { useAuthFlow } from '@/features/auth/context'

export interface SignUpSearch {
	readonly redirect?: string | undefined
	readonly error?: string | undefined
}

function readString(value: unknown): string | undefined {
	return typeof value === 'string' && value.length > 0 ? value : undefined
}

export const Route = createFileRoute('/sign-up')({
	validateSearch: (search: Record<string, unknown>): SignUpSearch => {
		const redirect = readString(search['redirect'])
		const error = readString(search['error'])
		return {
			...(redirect ? { redirect } : {}),
			...(error ? { error } : {})
		}
	},
	component: SignUpRoute
})

function SignUpRoute() {
	const search = Route.useSearch()
	const { needsSetup, socialProviders, onAuthenticated, onUsePreview } = useAuthFlow()

	return (
		<AuthLayout
			title={t('auth.sign-up.title')}
			subtitle={t('auth.sign-up.subtitle')}
			footer={needsSetup ? undefined : <SignUpSwitchPrompt redirectTo={search.redirect} />}
			onUsePreview={onUsePreview}
		>
			<SignUpForm
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
