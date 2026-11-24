import { t } from '@huriro/i18n'
import { createFileRoute } from '@tanstack/react-router'
import { AuthLayout } from '@/features/auth/components/auth-layout'
import { VerifyEmailPanel } from '@/features/auth/components/verify-email-panel'
import { AuthNavLink, useAuthFlow } from '@/features/auth/context'

export interface VerifyEmailSearch {
	readonly redirect?: string | undefined
	readonly token?: string | undefined
	readonly email?: string | undefined
}

function readString(value: unknown): string | undefined {
	return typeof value === 'string' && value.length > 0 ? value : undefined
}

export const Route = createFileRoute('/verify-email')({
	validateSearch: (search: Record<string, unknown>): VerifyEmailSearch => {
		const redirect = readString(search['redirect'])
		const token = readString(search['token'])
		const email = readString(search['email'])
		return {
			...(redirect ? { redirect } : {}),
			...(token ? { token } : {}),
			...(email ? { email } : {})
		}
	},
	component: VerifyEmailRoute
})

function VerifyEmailRoute() {
	const search = Route.useSearch()
	const { onUsePreview } = useAuthFlow()

	return (
		<AuthLayout
			title={t('auth.verify-email.title')}
			subtitle={t('auth.verify-email.subtitle')}
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
			<VerifyEmailPanel token={search.token} defaultEmail={search.email} redirectTo={search.redirect} />
		</AuthLayout>
	)
}
