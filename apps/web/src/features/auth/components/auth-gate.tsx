import { t } from '@huriro/i18n'
import type { SocialProviderId } from '@/lib/auth'
import { AuthLayout } from './auth-layout'
import { SetupForm, SetupSwitchPrompt } from './setup-form'
import { SignInForm, SignInSwitchPrompt } from './sign-in-form'

export interface AuthGateProps {
	readonly needsSetup: boolean
	readonly socialProviders?: readonly SocialProviderId[] | undefined
	readonly redirectTo?: string | undefined
	readonly onAuthenticated: (redirectTo?: string) => void
	readonly onUsePreview: () => void
}

/**
 * Fallback session gate rendered if boot phase reaches `auth` prior to router
 * redirect completion — keeps the exact same sleek editorial shell and routes.
 */
export function AuthGate({
	needsSetup,
	socialProviders = [],
	redirectTo,
	onAuthenticated,
	onUsePreview
}: AuthGateProps) {
	return (
		<AuthLayout
			title={needsSetup ? t('auth.setup.title') : t('auth.sign-in.title')}
			subtitle={needsSetup ? t('auth.setup.subtitle') : t('auth.sign-in.subtitle')}
			wide={needsSetup}
			footer={
				needsSetup ? (
					<SetupSwitchPrompt redirectTo={redirectTo} />
				) : (
					<SignInSwitchPrompt redirectTo={redirectTo} />
				)
			}
			onUsePreview={onUsePreview}
		>
			{needsSetup ? (
				<SetupForm needsSetup onComplete={onAuthenticated} redirectTo={redirectTo} hideSwitchPrompt />
			) : (
				<SignInForm
					socialProviders={socialProviders}
					needsSetup={false}
					redirectTo={redirectTo}
					hideSwitchPrompt
					onComplete={onAuthenticated}
				/>
			)}
		</AuthLayout>
	)
}
