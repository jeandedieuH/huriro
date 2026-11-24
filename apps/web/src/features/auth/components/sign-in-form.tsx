import { t } from '@huriro/i18n'
import { AlertCircle, ArrowRight, Loader2, Sparkles } from 'lucide-react'
import { useMemo, useState } from 'react'
import { Controller, useForm } from 'react-hook-form'
import { Button } from '@/components/ui/button'
import { Checkbox } from '@/components/ui/checkbox'
import { Input } from '@/components/ui/input'
import { type SocialProviderId, signIn } from '@/lib/auth'
import { sanitizeRedirectPath } from '@/lib/navigation'
import { zodResolver } from '@/lib/zod-resolver'
import { AuthNavLink } from '../context'
import { createSignInSchema, type SignInValues } from '../schemas'
import { FormField } from './form-field'
import { PasswordInput } from './password-input'
import { SocialAuthButtons } from './social-auth-buttons'

export interface SignInFormProps {
	readonly socialProviders?: readonly SocialProviderId[] | undefined
	readonly needsSetup?: boolean | undefined
	readonly redirectTo?: string | undefined
	readonly oauthError?: string | undefined
	readonly hideSwitchPrompt?: boolean | undefined
	readonly onComplete: (redirectTo?: string) => void
}

function resolveOAuthErrorMessage(code: string | undefined): string | null {
	if (!code) return null
	const normalized = code.toLowerCase()
	if (normalized === 'access_denied') return t('auth.social.error.access-denied')
	if (normalized.includes('link') || normalized.includes('email')) return t('auth.social.error.link-failed')
	return t('auth.social.error.default')
}

export function SignInSwitchPrompt({ redirectTo }: { readonly redirectTo?: string | undefined }) {
	return (
		<p>
			{t('auth.sign-in.no-account')}{' '}
			<AuthNavLink
				to="/sign-up"
				redirect={redirectTo}
				className="font-medium text-primary underline-offset-4 hover:underline"
			>
				{t('auth.sign-in.create-link')}
			</AuthNavLink>
		</p>
	)
}

/** Email+password + OAuth sign-in against Better Auth (`/api/auth/sign-in/*`). */
export function SignInForm({
	socialProviders = [],
	needsSetup = false,
	redirectTo,
	oauthError,
	hideSwitchPrompt = false,
	onComplete
}: SignInFormProps) {
	const schema = useMemo(() => createSignInSchema(), [])
	const [serverError, setServerError] = useState<string | null>(() => resolveOAuthErrorMessage(oauthError))
	const safeRedirect = sanitizeRedirectPath(redirectTo)

	const {
		register,
		control,
		handleSubmit,
		formState: { errors, isSubmitting }
	} = useForm<SignInValues>({
		resolver: zodResolver(schema),
		defaultValues: {
			email: '',
			password: '',
			rememberMe: true
		}
	})

	async function onSubmit(values: SignInValues) {
		setServerError(null)
		try {
			await signIn({
				email: values.email,
				password: values.password,
				rememberMe: values.rememberMe
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
				errorCallbackURL="/sign-in"
				disabled={isSubmitting}
			/>

			<form noValidate onSubmit={(ev) => void handleSubmit(onSubmit)(ev)} className="flex flex-col gap-3.5">
				<FormField id="sign-in-email" label={t('auth.email')} error={errors.email?.message}>
					<Input
						id="sign-in-email"
						type="email"
						autoComplete="email"
						placeholder={t('auth.email.placeholder')}
						invalid={Boolean(errors.email)}
						aria-describedby={errors.email ? 'sign-in-email-error' : undefined}
						{...register('email')}
					/>
				</FormField>

				<FormField
					id="sign-in-password"
					label={t('auth.password')}
					error={errors.password?.message}
					action={
						<AuthNavLink
							to="/forgot-password"
							redirect={redirectTo}
							className="font-medium text-primary underline-offset-4 hover:underline"
						>
							{t('auth.forgot-password.link')}
						</AuthNavLink>
					}
				>
					<PasswordInput
						id="sign-in-password"
						autoComplete="current-password"
						placeholder={t('auth.password.placeholder')}
						invalid={Boolean(errors.password)}
						aria-describedby={errors.password ? 'sign-in-password-error' : undefined}
						{...register('password')}
					/>
				</FormField>

				<Controller
					control={control}
					name="rememberMe"
					render={({ field }) => (
						<div className="flex items-center gap-2 pt-0.5">
							<Checkbox
								id="sign-in-remember"
								checked={field.value}
								onCheckedChange={(checked) => field.onChange(checked === true)}
							/>
							<label
								htmlFor="sign-in-remember"
								className="cursor-pointer select-none text-xs text-muted-foreground"
							>
								{t('auth.remember-me')}
							</label>
						</div>
					)}
				/>

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
					<span>{t('auth.sign-in.submit')}</span>
				</Button>
			</form>

			{!hideSwitchPrompt ? (
				<div className="border-t border-border pt-3.5 text-center text-xs text-muted-foreground">
					<SignInSwitchPrompt redirectTo={redirectTo} />
				</div>
			) : null}
		</div>
	)
}
