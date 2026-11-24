import { t } from '@huriro/i18n'
import { AlertCircle, CheckCircle2, KeyRound, Loader2 } from 'lucide-react'
import { useState } from 'react'
import { useForm } from 'react-hook-form'
import { Button } from '@/components/ui/button'
import { resetPassword } from '@/lib/auth'
import { zodResolver } from '@/lib/zod-resolver'
import { AuthNavLink } from '../context'
import { createResetPasswordSchema, type ResetPasswordValues } from '../schemas'
import { FormField } from './form-field'
import { PasswordInput } from './password-input'

export interface ResetPasswordFormProps {
	readonly token?: string | undefined
	readonly redirectTo?: string | undefined
}

/**
 * Completes password recovery using the one-time token emailed via Better Auth.
 */
export function ResetPasswordForm({ token, redirectTo }: ResetPasswordFormProps) {
	const [serverError, setServerError] = useState<string | null>(null)
	const [completed, setCompleted] = useState(false)
	const schema = createResetPasswordSchema()

	const {
		register,
		watch,
		handleSubmit,
		formState: { errors, isSubmitting }
	} = useForm<ResetPasswordValues>({
		resolver: zodResolver(schema),
		defaultValues: { password: '', confirmPassword: '' }
	})

	const passwordValue = watch('password')
	const trimmedToken = token?.trim() ?? ''

	if (!trimmedToken) {
		return (
			<div className="flex flex-col gap-4">
				<div
					role="alert"
					className="flex items-start gap-2.5 rounded-lg border border-destructive/40 bg-destructive/10 px-3.5 py-3 text-xs text-destructive"
				>
					<AlertCircle className="mt-0.5 size-4 shrink-0" aria-hidden />
					<p className="leading-relaxed">{t('auth.reset-password.missing-token')}</p>
				</div>
				<Button asChild className="w-full">
					<AuthNavLink to="/forgot-password" redirect={redirectTo}>
						{t('auth.forgot-password.submit')}
					</AuthNavLink>
				</Button>
			</div>
		)
	}

	if (completed) {
		return (
			<div className="flex flex-col items-center gap-4 py-2 text-center" role="status">
				<div className="inline-flex size-11 items-center justify-center rounded-full bg-(--success)/15 text-(--success)">
					<CheckCircle2 className="size-5" aria-hidden />
				</div>
				<div className="space-y-1.5">
					<h2 className="text-base font-semibold text-foreground">
						{t('auth.reset-password.success-title')}
					</h2>
					<p className="text-xs leading-relaxed text-muted-foreground">
						{t('auth.reset-password.success-desc')}
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

	async function onSubmit(values: ResetPasswordValues) {
		setServerError(null)
		try {
			await resetPassword({ newPassword: values.password, token: trimmedToken })
			setCompleted(true)
		} catch (err) {
			setServerError(err instanceof Error ? err.message : t('auth.error'))
		}
	}

	return (
		<form noValidate onSubmit={(ev) => void handleSubmit(onSubmit)(ev)} className="flex flex-col gap-3.5">
			<FormField
				id="reset-password-new"
				label={t('auth.reset-password.new-password')}
				error={errors.password?.message}
			>
				<PasswordInput
					id="reset-password-new"
					autoComplete="new-password"
					placeholder={t('auth.password.new-placeholder')}
					showStrength
					currentValue={passwordValue}
					invalid={Boolean(errors.password)}
					aria-describedby={errors.password ? 'reset-password-new-error' : undefined}
					{...register('password')}
				/>
			</FormField>

			<FormField
				id="reset-password-confirm"
				label={t('auth.confirm-password')}
				error={errors.confirmPassword?.message}
			>
				<PasswordInput
					id="reset-password-confirm"
					autoComplete="new-password"
					placeholder={t('auth.confirm-password.placeholder')}
					invalid={Boolean(errors.confirmPassword)}
					aria-describedby={errors.confirmPassword ? 'reset-password-confirm-error' : undefined}
					{...register('confirmPassword')}
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
					<KeyRound className="size-3.5" aria-hidden />
				)}
				<span>{t('auth.reset-password.submit')}</span>
			</Button>
		</form>
	)
}
