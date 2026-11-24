import { t } from '@huriro/i18n'
import { AlertCircle, CheckCircle2, Loader2, Mail } from 'lucide-react'
import { useEffect, useState } from 'react'
import { useForm } from 'react-hook-form'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { resendVerificationEmail, verifyEmailToken } from '@/lib/auth'
import { zodResolver } from '@/lib/zod-resolver'
import { AuthNavLink } from '../context'
import { createForgotPasswordSchema, type ForgotPasswordValues } from '../schemas'
import { FormField } from './form-field'

export interface VerifyEmailPanelProps {
	readonly token?: string | undefined
	readonly defaultEmail?: string | undefined
	readonly redirectTo?: string | undefined
}

type VerificationState = 'idle' | 'verifying' | 'verified' | 'error'

/**
 * Verifies a user's email address when launched with a `?token=` link and
 * allows requesting a fresh verification email if missing or expired.
 */
export function VerifyEmailPanel({ token, defaultEmail = '', redirectTo }: VerifyEmailPanelProps) {
	const trimmedToken = token?.trim() ?? ''
	const [status, setStatus] = useState<VerificationState>(trimmedToken ? 'verifying' : 'idle')
	const [verifyError, setVerifyError] = useState<string | null>(null)
	const [resendError, setResendError] = useState<string | null>(null)
	const [resentEmail, setResentEmail] = useState<string | null>(null)

	const schema = createForgotPasswordSchema()
	const {
		register,
		handleSubmit,
		formState: { errors, isSubmitting }
	} = useForm<ForgotPasswordValues>({
		resolver: zodResolver(schema),
		defaultValues: { email: defaultEmail }
	})

	useEffect(() => {
		if (!trimmedToken) {
			setStatus('idle')
			setVerifyError(null)
			return
		}
		let cancelled = false
		setStatus('verifying')
		setVerifyError(null)
		void verifyEmailToken(trimmedToken)
			.then(() => {
				if (cancelled) return
				setStatus('verified')
			})
			.catch((err) => {
				if (cancelled) return
				setStatus('error')
				setVerifyError(err instanceof Error ? err.message : t('auth.verify-email.error-desc'))
			})
		return () => {
			cancelled = true
		}
	}, [trimmedToken])

	if (status === 'verifying') {
		return (
			<div className="flex flex-col items-center gap-3 py-6 text-center" role="status">
				<Loader2 className="size-6 animate-spin text-primary" aria-hidden />
				<p className="text-xs text-muted-foreground">{t('auth.verify-email.verifying')}</p>
			</div>
		)
	}

	if (status === 'verified') {
		return (
			<div className="flex flex-col items-center gap-4 py-2 text-center" role="status">
				<div className="inline-flex size-11 items-center justify-center rounded-full bg-(--success)/15 text-(--success)">
					<CheckCircle2 className="size-5" aria-hidden />
				</div>
				<div className="space-y-1.5">
					<h2 className="text-base font-semibold text-foreground">{t('auth.verify-email.success-title')}</h2>
					<p className="text-xs leading-relaxed text-muted-foreground">
						{t('auth.verify-email.success-desc')}
					</p>
				</div>
				<Button asChild className="w-full">
					<AuthNavLink to="/sign-in" redirect={redirectTo}>
						{t('auth.verify-email.continue')}
					</AuthNavLink>
				</Button>
			</div>
		)
	}

	if (resentEmail) {
		return (
			<div className="flex flex-col items-center gap-4 py-2 text-center" role="status">
				<div className="inline-flex size-11 items-center justify-center rounded-full bg-(--success)/15 text-(--success)">
					<Mail className="size-5" aria-hidden />
				</div>
				<div className="space-y-1.5">
					<h2 className="text-base font-semibold text-foreground">{t('auth.verify-email.resent-title')}</h2>
					<p className="text-xs leading-relaxed text-muted-foreground">
						{t('auth.verify-email.resent-desc', { email: resentEmail })}
					</p>
				</div>
				<Button asChild tone="outline" className="w-full">
					<AuthNavLink to="/sign-in" redirect={redirectTo}>
						{t('auth.forgot-password.back-to-sign-in')}
					</AuthNavLink>
				</Button>
			</div>
		)
	}

	async function onResend(values: ForgotPasswordValues) {
		setResendError(null)
		const email = values.email.trim()
		try {
			await resendVerificationEmail({ email })
			setResentEmail(email)
		} catch (err) {
			setResendError(err instanceof Error ? err.message : t('auth.error'))
		}
	}

	return (
		<div className="flex flex-col gap-4">
			{status === 'error' ? (
				<div
					role="alert"
					className="flex items-start gap-2.5 rounded-lg border border-destructive/40 bg-destructive/10 px-3.5 py-3 text-xs text-destructive"
				>
					<AlertCircle className="mt-0.5 size-4 shrink-0" aria-hidden />
					<p className="leading-relaxed">{verifyError ?? t('auth.verify-email.error-desc')}</p>
				</div>
			) : (
				<p className="text-xs leading-relaxed text-muted-foreground">{t('auth.verify-email.missing-desc')}</p>
			)}

			<form noValidate onSubmit={(ev) => void handleSubmit(onResend)(ev)} className="flex flex-col gap-3.5">
				<FormField id="verify-email-address" label={t('auth.email')} error={errors.email?.message}>
					<Input
						id="verify-email-address"
						type="email"
						autoComplete="email"
						placeholder={t('auth.email.placeholder')}
						invalid={Boolean(errors.email)}
						aria-describedby={errors.email ? 'verify-email-address-error' : undefined}
						{...register('email')}
					/>
				</FormField>

				{resendError ? (
					<div
						role="alert"
						className="rounded-lg border border-destructive/40 bg-destructive/10 px-3 py-2 text-xs text-destructive"
					>
						{resendError}
					</div>
				) : null}

				<Button type="submit" disabled={isSubmitting} className="w-full">
					{isSubmitting ? (
						<Loader2 className="size-3.5 animate-spin" aria-hidden />
					) : (
						<Mail className="size-3.5" aria-hidden />
					)}
					<span>{t('auth.verify-email.resend-submit')}</span>
				</Button>
			</form>
		</div>
	)
}
