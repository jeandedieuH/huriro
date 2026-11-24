import { t } from '@huriro/i18n'
import { AlertCircle, CheckCircle2, Loader2, LogOut } from 'lucide-react'
import { type ChangeEvent, useMemo, useRef, useState } from 'react'
import { useForm } from 'react-hook-form'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Separator } from '@/components/ui/separator'
import { completeSetup, slugifyWorkspaceName } from '@/lib/auth'
import type { OnboardingRequired } from '@/lib/sync-bootstrap'
import { zodResolver } from '@/lib/zod-resolver'
import { AuthNavLink } from '../context'
import { createSetupSchema, type SetupValues } from '../schemas'
import { FormField } from './form-field'
import { PasswordInput } from './password-input'

export interface SetupFormProps {
	readonly needsSetup?: boolean | undefined
	readonly signedInUser?: OnboardingRequired['user'] | null | undefined
	readonly redirectTo?: string | undefined
	readonly hideSwitchPrompt?: boolean | undefined
	readonly onComplete: (redirectTo?: string) => void
	readonly onSignOut?: (() => Promise<void>) | undefined
}

export function SetupSwitchPrompt({ redirectTo }: { readonly redirectTo?: string | undefined }) {
	return (
		<p>
			{t('auth.setup.have-account')}{' '}
			<AuthNavLink
				to="/sign-in"
				redirect={redirectTo}
				className="font-medium text-primary underline-offset-4 hover:underline"
			>
				{t('auth.setup.sign-in-link')}
			</AuthNavLink>
		</p>
	)
}

/**
 * First-run instance bootstrap (§12.2): burns the one-time setup token to
 * create the initial workspace + owner credential, then signs in.
 */
export function SetupForm({
	needsSetup = true,
	signedInUser = null,
	redirectTo,
	hideSwitchPrompt = false,
	onComplete,
	onSignOut
}: SetupFormProps) {
	const schema = useMemo(() => createSetupSchema(), [])
	const [serverError, setServerError] = useState<string | null>(null)
	const [isSigningOut, setIsSigningOut] = useState(false)
	const isSlugManuallyEdited = useRef(false)

	const {
		register,
		setValue,
		watch,
		handleSubmit,
		formState: { errors, isSubmitting, isSubmitted }
	} = useForm<SetupValues>({
		resolver: zodResolver(schema),
		defaultValues: {
			token: '',
			workspaceName: '',
			slug: '',
			displayName: signedInUser?.name ?? '',
			email: signedInUser?.email ?? '',
			password: ''
		}
	})

	const slugValue = watch('slug')
	const passwordValue = watch('password')

	if (!needsSetup) {
		return (
			<div className="flex flex-col items-center gap-4 py-2 text-center">
				<div className="inline-flex size-11 items-center justify-center rounded-full bg-(--success)/15 text-(--success)">
					<CheckCircle2 className="size-5" aria-hidden />
				</div>
				<div className="space-y-1">
					<h2 className="text-base font-semibold text-foreground">
						{t('auth.setup.already-configured.title')}
					</h2>
					<p className="text-xs leading-relaxed text-muted-foreground">
						{t('auth.setup.already-configured.desc')}
					</p>
				</div>
				<div className="flex w-full flex-col gap-2 pt-1 sm:flex-row">
					<Button asChild className="flex-1">
						<AuthNavLink to="/sign-in" redirect={redirectTo}>
							{t('auth.sign-in.title')}
						</AuthNavLink>
					</Button>
					<Button asChild tone="outline" className="flex-1">
						<AuthNavLink to="/sign-up" redirect={redirectTo}>
							{t('auth.sign-up.title')}
						</AuthNavLink>
					</Button>
				</div>
			</div>
		)
	}

	function handleWorkspaceNameChange(event: ChangeEvent<HTMLInputElement>) {
		if (!isSlugManuallyEdited.current) {
			setValue('slug', slugifyWorkspaceName(event.target.value), {
				shouldValidate: isSubmitted
			})
		}
	}

	async function onSubmit(values: SetupValues) {
		setServerError(null)
		try {
			await completeSetup(values)
			onComplete(redirectTo)
		} catch (err) {
			setServerError(err instanceof Error ? err.message : t('auth.error'))
		}
	}

	async function handleSignOut() {
		if (!onSignOut) return
		setIsSigningOut(true)
		try {
			await onSignOut()
		} finally {
			setIsSigningOut(false)
		}
	}

	return (
		<div className="flex flex-col gap-4">
			{signedInUser?.email ? (
				<div className="flex items-center justify-between gap-3 rounded-lg border border-border bg-surface-2 px-3 py-2 text-xs">
					<span className="truncate text-muted-foreground">
						{t('auth.onboarding.signed-in-as', { email: signedInUser.email })}
					</span>
					{onSignOut ? (
						<button
							type="button"
							disabled={isSigningOut}
							onClick={() => void handleSignOut()}
							className="inline-flex shrink-0 items-center gap-1 font-medium text-foreground underline-offset-4 hover:text-primary hover:underline disabled:opacity-50"
						>
							<LogOut className="size-3" aria-hidden />
							<span>{t('auth.sign-out')}</span>
						</button>
					) : null}
				</div>
			) : null}

			<form noValidate onSubmit={(ev) => void handleSubmit(onSubmit)(ev)} className="flex flex-col gap-4">
				<div className="flex flex-col gap-3">
					<p className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">
						{t('auth.setup.section-workspace')}
					</p>

					<FormField
						id="setup-token"
						label={t('auth.setup-token')}
						hint={t('auth.setup-token.hint')}
						error={errors.token?.message}
					>
						<PasswordInput
							id="setup-token"
							autoComplete="off"
							placeholder={t('auth.setup.token-placeholder')}
							invalid={Boolean(errors.token)}
							aria-describedby={errors.token ? 'setup-token-error' : 'setup-token-hint'}
							{...register('token')}
						/>
					</FormField>

					<div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
						<FormField
							id="setup-workspace"
							label={t('auth.workspace-name')}
							error={errors.workspaceName?.message}
						>
							<Input
								id="setup-workspace"
								placeholder={t('auth.setup.workspace-placeholder')}
								invalid={Boolean(errors.workspaceName)}
								aria-describedby={errors.workspaceName ? 'setup-workspace-error' : undefined}
								{...register('workspaceName', { onChange: handleWorkspaceNameChange })}
							/>
						</FormField>

						<FormField
							id="setup-slug"
							label={t('auth.workspace-slug')}
							hint={t('auth.slug.hint')}
							error={errors.slug?.message}
							action={
								slugValue ? (
									<span className="font-mono text-[11px] text-muted-foreground">/{slugValue}</span>
								) : undefined
							}
						>
							<Input
								id="setup-slug"
								placeholder={t('auth.setup.slug-placeholder')}
								invalid={Boolean(errors.slug)}
								aria-describedby={errors.slug ? 'setup-slug-error' : 'setup-slug-hint'}
								{...register('slug', {
									onChange: () => {
										isSlugManuallyEdited.current = true
									}
								})}
							/>
						</FormField>
					</div>
				</div>

				<Separator />

				<div className="flex flex-col gap-3">
					<p className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">
						{t('auth.setup.section-owner')}
					</p>

					<div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
						<FormField
							id="setup-display-name"
							label={t('auth.display-name')}
							error={errors.displayName?.message}
						>
							<Input
								id="setup-display-name"
								autoComplete="name"
								placeholder={t('auth.display-name.placeholder')}
								invalid={Boolean(errors.displayName)}
								aria-describedby={errors.displayName ? 'setup-display-name-error' : undefined}
								{...register('displayName')}
							/>
						</FormField>

						<FormField id="setup-email" label={t('auth.email')} error={errors.email?.message}>
							<Input
								id="setup-email"
								type="email"
								autoComplete="email"
								placeholder={t('auth.email.placeholder')}
								invalid={Boolean(errors.email)}
								aria-describedby={errors.email ? 'setup-email-error' : undefined}
								{...register('email')}
							/>
						</FormField>
					</div>

					<FormField id="setup-password" label={t('auth.password')} error={errors.password?.message}>
						<PasswordInput
							id="setup-password"
							autoComplete="new-password"
							placeholder={t('auth.password.new-placeholder')}
							invalid={Boolean(errors.password)}
							aria-describedby={errors.password ? 'setup-password-error' : undefined}
							showStrength
							currentValue={passwordValue}
							{...register('password')}
						/>
					</FormField>
				</div>

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
					<span>{t('auth.setup.submit')}</span>
				</Button>
			</form>

			{!hideSwitchPrompt ? (
				<div className="border-t border-border pt-3.5 text-center text-xs text-muted-foreground">
					<SetupSwitchPrompt redirectTo={redirectTo} />
				</div>
			) : null}
		</div>
	)
}
