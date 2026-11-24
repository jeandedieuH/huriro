import { t } from '@huriro/i18n'
import { createFileRoute } from '@tanstack/react-router'
import { AuthLayout } from '@/features/auth/components/auth-layout'
import { SetupForm, SetupSwitchPrompt } from '@/features/auth/components/setup-form'
import { useAuthFlow } from '@/features/auth/context'

export interface SetupSearch {
	readonly redirect?: string | undefined
}

function readString(value: unknown): string | undefined {
	return typeof value === 'string' && value.length > 0 ? value : undefined
}

export const Route = createFileRoute('/setup')({
	validateSearch: (search: Record<string, unknown>): SetupSearch => {
		const redirect = readString(search['redirect'])
		return redirect ? { redirect } : {}
	},
	component: SetupRoute
})

function SetupRoute() {
	const search = Route.useSearch()
	const { needsSetup, onboardingUser, onAuthenticated, onSignOut, onUsePreview } = useAuthFlow()
	const showSwitchPrompt = needsSetup && !onboardingUser

	return (
		<AuthLayout
			title={t('auth.setup.title')}
			subtitle={t('auth.setup.subtitle')}
			wide={needsSetup}
			footer={showSwitchPrompt ? <SetupSwitchPrompt redirectTo={search.redirect} /> : undefined}
			onUsePreview={onUsePreview}
		>
			<SetupForm
				key={onboardingUser?.id ?? 'anon'}
				needsSetup={needsSetup}
				signedInUser={onboardingUser}
				redirectTo={search.redirect}
				hideSwitchPrompt
				onComplete={onAuthenticated}
				onSignOut={onSignOut}
			/>
		</AuthLayout>
	)
}
