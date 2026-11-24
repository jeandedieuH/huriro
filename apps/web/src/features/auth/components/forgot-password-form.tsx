import { t } from '@huriro/i18n'
import { ArrowLeft, CheckCircle2, Loader2, Mail } from 'lucide-react'
import { useState } from 'react'
import { useForm } from 'react-hook-form'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { requestPasswordReset } from '@/lib/auth'
import { zodResolver } from '@/lib/zod-resolver'
import { AuthNavLink } from '../context'
import { createForgotPasswordSchema, type ForgotPasswordValues } from '../schemas'
import { FormField } from './form-field'

export interface ForgotPasswordFormProps {
	readonly defaultEmail?: string | undefined
	readonly redirectTo?: string | undefined
}

/**
 * Self-service password recovery request form backed by Better Auth's
 * `/api/auth/request-password-reset` endpoint.
 */
export function ForgotPasswordForm({ defaultEmail = '', redirectTo }: ForgotPasswordFormProps) {
	const [serverError, setServerError] = useState<string | null>(null)
	const [submittedEmail, setSubmittedEmail] = useState<string | null>(null)
	const schema = createForgotPasswordSchema()

	const {
		register,
		handleSubmit,
		formState: { errors, isSubmitting }
	} = useForm<ForgotPasswordValues>({
		resolver: zodResolver(schema),
		defaultValues: { email: defaultEmail }
	})

	async function onSubmit(values: ForgotPasswordValues) {
		setServerError(null)
		const email = values.email.trim()
		try {
			await requestPasswordReset({ email })
			setSubmittedEmail(email)
		} catch (err) {
			setServerError(err instanceof Error ? err.message : t('auth.error'))
		}
	}

	if (submittedEmail) {
		return (
			<div className="flex flex-col items-center gap-4 py-2 text-center" role="status">
				<div className="inline-flex size-11 items-center justify-center rounded-full bg-(--success)/15 text-(--success)">
					<CheckCircle2 className="size-5" aria-hidden />
				</div>
				<div className="space-y-1.5">
					<h2 className="text-base font-semibold text-foreground">{t('auth.forgot-password.sent-title')}</h2>
					<p className="text-xs leading-relaxed text-muted-foreground">
						{t('auth.forgot-password.sent-desc', { email: submittedEmail })}
					</p>
				</div>
				<Button asChild tone="outline" className="w-full">
					<AuthNavLink to="/sign-in" redirect={redirectTo}>
						<ArrowLeft className="size-3.5" aria-hidden />
						<span>{t('auth.forgot-password.back-to-sign-in')}</span>
					</AuthNavLink>
				</Button>
			</div>
		)
	}

	return (
		<div className="flex flex-col gap-4">
			<form noValidate onSubmit={(ev) => void handleSubmit(onSubmit)(ev)} className="flex flex-col gap-3.5">
				<FormField id="forgot-password-email" label={t('auth.email')} error={errors.email?.message}>
					<Input
						id="forgot-password-email"
						type="email"
						autoComplete="email"
						placeholder={t('auth.email.placeholder')}
						invalid={Boolean(errors.email)}
						aria-describedby={errors.email ? 'forgot-password-email-error' : undefined}
						{...register('email')}
					/>
				</FormField>

				{serverError ? (
					<div
						role="alert"
						className="rounded-lg border border-destructive/40 bg-destructive/10 px-3 py-2 text-xs text-destructive"
					>
						{serverError}
					</div>
				) : null}

				<Button type="submit" disabled={isSubmitting} className="w-full">
					{isSubmitting ? (
						<Loader2 className="size-3.5 animate-spin" aria-hidden />
					) : (
						<Mail className="size-3.5" aria-hidden />
					)}
					<span>{t('auth.forgot-password.submit')}</span>
				</Button>
			</form>
		</div>
	)
}
