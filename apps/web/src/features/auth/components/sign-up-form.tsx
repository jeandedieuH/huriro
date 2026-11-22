import { t } from '@huriro/i18n'
import { AlertCircle, ArrowRight, Loader2, Sparkles } from 'lucide-react'
import { useMemo, useState } from 'react'
import { useForm } from 'react-hook-form'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { type SocialProviderId, signUp } from '@/lib/auth'
import { sanitizeRedirectPath } from '@/lib/navigation'
import { zodResolver } from '@/lib/zod-resolver'
import { AuthNavLink } from '../context'
import { createSignUpSchema, type SignUpValues } from '../schemas'
import { FormField } from './form-field'
import { PasswordInput } from './password-input'
import { SocialAuthButtons } from './social-auth-buttons'

export interface SignUpFormProps {
	readonly socialProviders?: readonly SocialProviderId[] | undefined
	readonly needsSetup?: boolean | undefined
	readonly redirectTo?: string | undefined
	readonly oauthError?: string | undefined
	readonly hideSwitchPrompt?: boolean | undefined
	readonly onComplete: (redirectTo?: string) => void
}

export function SignUpSwitchPrompt({ redirectTo }: { readonly redirectTo?: string | undefined }) {
	return (
		<p>
			{t('auth.sign-up.have-account')}{' '}
			<AuthNavLink
				to="/sign-in"
				redirect={redirectTo}
				className="font-medium text-primary underline-offset-4 hover:underline"
			>
				{t('auth.sign-up.sign-in-link')}
			</AuthNavLink>
		</p>
	)
}

/** Account registration via Better Auth (`/api/auth/sign-up/email`) or social OAuth. */
export function SignUpForm({
	socialProviders = [],
	needsSetup = false,
	redirectTo,
	oauthError,
	hideSwitchPrompt = false,
	onComplete
}: SignUpFormProps) {
	const schema = useMemo(() => createSignUpSchema(), [])
	const [serverError, setServerError] = useState<string | null>(() =>
		oauthError ? t('auth.social.error.default') : null
	)
	const safeRedirect = sanitizeRedirectPath(redirectTo)

	const {
		register,
		watch,
		handleSubmit,
		formState: { errors, isSubmitting }
	} = useForm<SignUpValues>({
		resolver: zodResolver(schema),
		defaultValues: {
			displayName: '',
			email: '',
			password: '',
			confirmPassword: ''
		}
	})

	const passwordValue = watch('password')

	async function onSubmit(values: SignUpValues) {
		setServerError(null)
		try {
			await signUp({
				name: values.displayName,
				email: values.email,
				password: values.password
			})
			onComplete(redirectTo)
		} catch (err) {
			setServerError(err instanceof Error ? err.message : t('auth.error'))
		}
	}

	return (
		<div className="flex flex-col gap-4">
			{needsSetup ? (
				<div className="flex items-center justify-between gap-3 rounded-lg border border-primary/25 bg-primary/8 px-3 py-2.5 text-xs">
					<div className="flex items-center gap-2 text-foreground">
						<Sparkles className="size-3.5 shrink-0 text-primary" aria-hidden />
						<span>{t('auth.sign-in.setup-notice')}</span>
					</div>
					<AuthNavLink
						to="/setup"
						redirect={redirectTo}
						className="inline-flex shrink-0 items-center gap-1 font-medium text-primary underline-offset-4 hover:underline"
					>
						<span>{t('auth.sign-in.setup-link')}</span>
						<ArrowRight className="size-3" aria-hidden />
					</AuthNavLink>
				</div>
			) : null}

			<SocialAuthButtons
				enabledProviders={socialProviders}
				callbackURL={safeRedirect}
				errorCallbackURL="/sign-up"
				disabled={isSubmitting}
			/>

			<form noValidate onSubmit={(ev) => void handleSubmit(onSubmit)(ev)} className="flex flex-col gap-3.5">
				<FormField
					id="sign-up-display-name"
					label={t('auth.display-name')}
					error={errors.displayName?.message}
				>
					<Input
						id="sign-up-display-name"
						autoComplete="name"
						placeholder={t('auth.display-name.placeholder')}
						invalid={Boolean(errors.displayName)}
						aria-describedby={errors.displayName ? 'sign-up-display-name-error' : undefined}
						{...register('displayName')}
					/>
				</FormField>

				<FormField id="sign-up-email" label={t('auth.email')} error={errors.email?.message}>
					<Input
						id="sign-up-email"
						type="email"
						autoComplete="email"
						placeholder={t('auth.email.placeholder')}
						invalid={Boolean(errors.email)}
						aria-describedby={errors.email ? 'sign-up-email-error' : undefined}
						{...register('email')}
					/>
				</FormField>

				<FormField id="sign-up-password" label={t('auth.password')} error={errors.password?.message}>
					<PasswordInput
						id="sign-up-password"
						autoComplete="new-password"
						placeholder={t('auth.password.new-placeholder')}
						invalid={Boolean(errors.password)}
						aria-describedby={errors.password ? 'sign-up-password-error' : undefined}
						showStrength
						currentValue={passwordValue}
						{...register('password')}
					/>
				</FormField>

				<FormField
					id="sign-up-confirm-password"
					label={t('auth.confirm-password')}
					error={errors.confirmPassword?.message}
				>
					<PasswordInput
						id="sign-up-confirm-password"
						autoComplete="new-password"
						placeholder={t('auth.confirm-password.placeholder')}
						invalid={Boolean(errors.confirmPassword)}
						aria-describedby={errors.confirmPassword ? 'sign-up-confirm-password-error' : undefined}
						{...register('confirmPassword')}
					/>
				</FormField>

				{serverError ? (
					<div
						role="alert"
						className="flex items-start gap-2 rounded-lg border border-destructive/30 bg-destructive/10 px-3 py-2 text-xs text-destructive"
					>
						<AlertCircle className="mt-0.5 size-3.5 shrink-0" aria-hidden />
						<span>{serverError}</span>
					</div>
				) : null}

				<Button type="submit" className="mt-1 w-full" loading={isSubmitting}>
					{isSubmitting ? <Loader2 className="size-4 animate-spin" aria-hidden /> : null}
					<span>{t('auth.sign-up.submit')}</span>
				</Button>
			</form>

			{!hideSwitchPrompt ? (
				<div className="border-t border-border pt-3.5 text-center text-xs text-muted-foreground">
					<SignUpSwitchPrompt redirectTo={redirectTo} />
				</div>
			) : null}
		</div>
	)
}
