import { t } from '@huriro/i18n'
import { createFileRoute } from '@tanstack/react-router'
import { AuthLayout } from '@/features/auth/components/auth-layout'
import { ResetPasswordForm } from '@/features/auth/components/reset-password-form'
import { AuthNavLink, useAuthFlow } from '@/features/auth/context'

export interface ResetPasswordSearch {
	readonly redirect?: string | undefined
	readonly token?: string | undefined
}

function readString(value: unknown): string | undefined {
	return typeof value === 'string' && value.length > 0 ? value : undefined
}

export const Route = createFileRoute('/reset-password')({
	validateSearch: (search: Record<string, unknown>): ResetPasswordSearch => {
		const redirect = readString(search['redirect'])
		const token = readString(search['token'])
		return {
			...(redirect ? { redirect } : {}),
			...(token ? { token } : {})
		}
	},
	component: ResetPasswordRoute
})

function ResetPasswordRoute() {
	const search = Route.useSearch()
	const { onUsePreview } = useAuthFlow()

	return (
		<AuthLayout
			title={t('auth.reset-password.title')}
			subtitle={t('auth.reset-password.subtitle')}
			footer={
				<p className="text-center text-xs text-muted-foreground">
					<AuthNavLink
						to="/sign-in"
						redirect={search.redirect}
						className="font-medium text-foreground underline-offset-4 hover:underline"
					>
						{t('auth.forgot-password.back-to-sign-in')}
					</AuthNavLink>
				</p>
			}
			onUsePreview={onUsePreview}
		>
			<ResetPasswordForm token={search.token} redirectTo={search.redirect} />
		</AuthLayout>
	)
}
