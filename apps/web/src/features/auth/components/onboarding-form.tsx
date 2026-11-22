import { t } from '@huriro/i18n'
import { AlertCircle, Building2, KeyRound, Loader2, LogOut, Sparkles } from 'lucide-react'
import { type ChangeEvent, useMemo, useRef, useState } from 'react'
import { useForm } from 'react-hook-form'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs'
import { acceptInvitation, createWorkspace, slugifyWorkspaceName } from '@/lib/auth'
import type { OnboardingRequired } from '@/lib/sync-bootstrap'
import { zodResolver } from '@/lib/zod-resolver'
import { AuthNavLink } from '../context'
import {
	type AcceptInviteValues,
	type CreateWorkspaceValues,
	createAcceptInviteSchema,
	createWorkspaceSchema
} from '../schemas'
import { FormField } from './form-field'

export interface OnboardingFormProps {
	readonly user: OnboardingRequired['user'] | null
	readonly needsSetup?: boolean | undefined
	readonly redirectTo?: string | undefined
	readonly defaultInviteToken?: string | undefined
	readonly onComplete: (redirectTo?: string) => void
	readonly onSignOut: () => Promise<void>
}

/**
 * Post-auth onboarding for newly registered email/OAuth users who do not yet
 * belong to a workspace — lets them create a workspace or accept an invite.
 */
export function OnboardingForm({
	user,
	needsSetup = false,
	redirectTo,
	defaultInviteToken,
	onComplete,
	onSignOut
}: OnboardingFormProps) {
	const workspaceSchema = useMemo(() => createWorkspaceSchema(), [])
	const inviteSchema = useMemo(() => createAcceptInviteSchema(), [])
	const [serverError, setServerError] = useState<string | null>(null)
	const [isSigningOut, setIsSigningOut] = useState(false)
	const isSlugManuallyEdited = useRef(false)

	const workspaceForm = useForm<CreateWorkspaceValues>({
		resolver: zodResolver(workspaceSchema),
		defaultValues: { name: '', slug: '' }
	})

	const inviteForm = useForm<AcceptInviteValues>({
		resolver: zodResolver(inviteSchema),
		defaultValues: { token: defaultInviteToken ?? '' }
	})

	const slugValue = workspaceForm.watch('slug')

	function handleNameChange(event: ChangeEvent<HTMLInputElement>) {
		if (!isSlugManuallyEdited.current) {
			workspaceForm.setValue('slug', slugifyWorkspaceName(event.target.value), {
				shouldValidate: workspaceForm.formState.isSubmitted
			})
		}
	}

	async function onCreateWorkspace(values: CreateWorkspaceValues) {
		setServerError(null)
		try {
			await createWorkspace({ name: values.name, slug: values.slug })
			onComplete(redirectTo)
		} catch (err) {
			setServerError(err instanceof Error ? err.message : t('auth.error'))
		}
	}

	async function onAcceptInvite(values: AcceptInviteValues) {
		setServerError(null)
		try {
			await acceptInvitation(values.token)
			onComplete(redirectTo)
		} catch (err) {
			setServerError(err instanceof Error ? err.message : t('auth.error'))
		}
	}

	async function handleSignOut() {
		setIsSigningOut(true)
		try {
			await onSignOut()
		} finally {
			setIsSigningOut(false)
		}
	}

	return (
		<div className="flex flex-col gap-4">
			{user?.email ? (
				<div className="flex items-center justify-between gap-3 rounded-lg border border-border bg-surface-2 px-3 py-2 text-xs">
					<span className="truncate text-muted-foreground">
						{t('auth.onboarding.signed-in-as', { email: user.email })}
					</span>
					<button
						type="button"
						disabled={isSigningOut}
						onClick={() => void handleSignOut()}
						className="inline-flex shrink-0 items-center gap-1 font-medium text-foreground underline-offset-4 hover:text-primary hover:underline disabled:opacity-50"
					>
						<LogOut className="size-3" aria-hidden />
						<span>{t('auth.sign-out')}</span>
					</button>
				</div>
			) : null}

			{needsSetup ? (
				<div className="flex flex-col gap-3 rounded-lg border border-primary/25 bg-primary/8 p-4 text-xs">
					<div className="flex items-start gap-2 text-foreground">
						<Sparkles className="mt-0.5 size-4 shrink-0 text-primary" aria-hidden />
						<p className="leading-relaxed">{t('auth.onboarding.setup-required')}</p>
					</div>
					<Button asChild size="sm">
						<AuthNavLink to="/setup" redirect={redirectTo}>
							{t('auth.sign-in.setup-link')}
						</AuthNavLink>
					</Button>
				</div>
			) : (
				<Tabs
					defaultValue={defaultInviteToken ? 'invite' : 'create'}
					onValueChange={() => setServerError(null)}
				>
					<TabsList className="grid w-full grid-cols-2">
						<TabsTrigger value="create" className="gap-1.5 text-xs">
							<Building2 className="size-3.5" aria-hidden />
							<span>{t('auth.onboarding.tab-create')}</span>
						</TabsTrigger>
						<TabsTrigger value="invite" className="gap-1.5 text-xs">
							<KeyRound className="size-3.5" aria-hidden />
							<span>{t('auth.onboarding.tab-invite')}</span>
						</TabsTrigger>
					</TabsList>

					<TabsContent value="create" className="mt-4">
						<form
							noValidate
							onSubmit={(ev) => void workspaceForm.handleSubmit(onCreateWorkspace)(ev)}
							className="flex flex-col gap-3.5"
						>
							<FormField
								id="onboarding-ws-name"
								label={t('auth.workspace-name')}
								error={workspaceForm.formState.errors.name?.message}
							>
								<Input
									id="onboarding-ws-name"
									placeholder={t('auth.setup.workspace-placeholder')}
									invalid={Boolean(workspaceForm.formState.errors.name)}
									aria-describedby={
										workspaceForm.formState.errors.name ? 'onboarding-ws-name-error' : undefined
									}
									{...workspaceForm.register('name', { onChange: handleNameChange })}
								/>
							</FormField>

							<FormField
								id="onboarding-ws-slug"
								label={t('auth.workspace-slug')}
								hint={t('auth.slug.hint')}
								error={workspaceForm.formState.errors.slug?.message}
								action={
									slugValue ? (
										<span className="font-mono text-[11px] text-muted-foreground">/{slugValue}</span>
									) : undefined
								}
							>
								<Input
									id="onboarding-ws-slug"
									placeholder={t('auth.setup.slug-placeholder')}
									invalid={Boolean(workspaceForm.formState.errors.slug)}
									aria-describedby={
										workspaceForm.formState.errors.slug
											? 'onboarding-ws-slug-error'
											: 'onboarding-ws-slug-hint'
									}
									{...workspaceForm.register('slug', {
										onChange: () => {
											isSlugManuallyEdited.current = true
										}
									})}
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

							<Button type="submit" className="mt-1 w-full" loading={workspaceForm.formState.isSubmitting}>
								{workspaceForm.formState.isSubmitting ? (
									<Loader2 className="size-4 animate-spin" aria-hidden />
								) : null}
								<span>{t('auth.onboarding.create-submit')}</span>
							</Button>
						</form>
					</TabsContent>

					<TabsContent value="invite" className="mt-4">
						<form
							noValidate
							onSubmit={(ev) => void inviteForm.handleSubmit(onAcceptInvite)(ev)}
							className="flex flex-col gap-3.5"
						>
							<FormField
								id="onboarding-invite-token"
								label={t('auth.onboarding.invite-token')}
								hint={t('auth.onboarding.invite-token.hint')}
								error={inviteForm.formState.errors.token?.message}
							>
								<Input
									id="onboarding-invite-token"
									autoComplete="off"
									placeholder={t('auth.onboarding.invite-token.placeholder')}
									invalid={Boolean(inviteForm.formState.errors.token)}
									aria-describedby={
										inviteForm.formState.errors.token
											? 'onboarding-invite-token-error'
											: 'onboarding-invite-token-hint'
									}
									{...inviteForm.register('token')}
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

							<Button type="submit" className="mt-1 w-full" loading={inviteForm.formState.isSubmitting}>
								{inviteForm.formState.isSubmitting ? (
									<Loader2 className="size-4 animate-spin" aria-hidden />
								) : null}
								<span>{t('auth.onboarding.invite-submit')}</span>
							</Button>
						</form>
					</TabsContent>
				</Tabs>
			)}
		</div>
	)
}
