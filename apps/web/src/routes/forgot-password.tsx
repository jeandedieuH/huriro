import { t } from '@huriro/i18n'
import { createFileRoute } from '@tanstack/react-router'
import { AuthLayout } from '@/features/auth/components/auth-layout'
import { ForgotPasswordForm } from '@/features/auth/components/forgot-password-form'
import { AuthNavLink, useAuthFlow } from '@/features/auth/context'

export interface ForgotPasswordSearch {
	readonly redirect?: string | undefined
	readonly email?: string | undefined
}

function readString(value: unknown): string | undefined {
	return typeof value === 'string' && value.length > 0 ? value : undefined
}

export const Route = createFileRoute('/forgot-password')({
	validateSearch: (search: Record<string, unknown>): ForgotPasswordSearch => {
		const redirect = readString(search['redirect'])
		const email = readString(search['email'])
		return {
			...(redirect ? { redirect } : {}),
			...(email ? { email } : {})
		}
	},
	component: ForgotPasswordRoute
})

function ForgotPasswordRoute() {
	const search = Route.useSearch()
	const { onUsePreview } = useAuthFlow()

	return (
		<AuthLayout
			title={t('auth.forgot-password.title')}
			subtitle={t('auth.forgot-password.subtitle')}
			footer={
				<p className="text-center text-xs text-muted-foreground">
					{t('auth.sign-up.have-account')}{' '}
					<AuthNavLink
						to="/sign-in"
						redirect={search.redirect}
						className="font-medium text-foreground underline-offset-4 hover:underline"
					>
						{t('auth.sign-up.sign-in-link')}
					</AuthNavLink>
				</p>
			}
			onUsePreview={onUsePreview}
		>
			<ForgotPasswordForm defaultEmail={search.email} redirectTo={search.redirect} />
		</AuthLayout>
	)
}
