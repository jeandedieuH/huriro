import { t } from '@huriro/i18n'
import { createFileRoute } from '@tanstack/react-router'
import { AuthLayout } from '@/features/auth/components/auth-layout'
import { OnboardingForm } from '@/features/auth/components/onboarding-form'
import { useAuthFlow } from '@/features/auth/context'

export interface OnboardingSearch {
	readonly redirect?: string | undefined
	readonly invite?: string | undefined
}

function readString(value: unknown): string | undefined {
	return typeof value === 'string' && value.length > 0 ? value : undefined
}

export const Route = createFileRoute('/onboarding')({
	validateSearch: (search: Record<string, unknown>): OnboardingSearch => {
		const redirect = readString(search['redirect'])
		const invite = readString(search['invite'])
		return {
			...(redirect ? { redirect } : {}),
			...(invite ? { invite } : {})
		}
	},
	component: OnboardingRoute
})

function OnboardingRoute() {
	const search = Route.useSearch()
	const { needsSetup, onboardingUser, onAuthenticated, onSignOut, onUsePreview } = useAuthFlow()

	return (
		<AuthLayout
			title={t('auth.onboarding.title')}
			subtitle={t('auth.onboarding.subtitle')}
			onUsePreview={onUsePreview}
		>
			<OnboardingForm
				user={onboardingUser}
				needsSetup={needsSetup}
				redirectTo={search.redirect}
				defaultInviteToken={search.invite}
				onComplete={onAuthenticated}
				onSignOut={onSignOut}
			/>
		</AuthLayout>
	)
}
