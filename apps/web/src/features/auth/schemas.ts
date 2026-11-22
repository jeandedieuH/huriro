import { type MessageId, t } from '@huriro/i18n'
import { z } from 'zod'

const SLUG_REGEX = /^[a-z0-9][a-z0-9-]*$/

export interface SignInValues {
	email: string
	password: string
	rememberMe: boolean
}

export interface SignUpValues {
	displayName: string
	email: string
	password: string
	confirmPassword: string
}

export interface SetupValues {
	token: string
	workspaceName: string
	slug: string
	displayName: string
	email: string
	password: string
}

export interface CreateWorkspaceValues {
	name: string
	slug: string
}

export interface AcceptInviteValues {
	token: string
}

export function createSignInSchema(): z.ZodType<SignInValues> {
	return z.object({
		email: z
			.string()
			.trim()
			.min(1, t('auth.validation.email-required'))
			.pipe(z.email(t('auth.validation.email-invalid'))),
		password: z.string().min(1, t('auth.validation.password-required')),
		rememberMe: z.boolean()
	})
}

export function createSignUpSchema(): z.ZodType<SignUpValues> {
	return z
		.object({
			displayName: z
				.string()
				.trim()
				.min(1, t('auth.validation.display-name-required'))
				.min(2, t('auth.validation.display-name-min'))
				.max(120, t('auth.validation.display-name-max')),
			email: z
				.string()
				.trim()
				.min(1, t('auth.validation.email-required'))
				.pipe(z.email(t('auth.validation.email-invalid'))),
			password: z
				.string()
				.min(8, t('auth.validation.password-min'))
				.max(128, t('auth.validation.password-max')),
			confirmPassword: z.string().min(1, t('auth.validation.confirm-password-required'))
		})
		.refine((data) => data.password === data.confirmPassword, {
			path: ['confirmPassword'],
			message: t('auth.validation.passwords-mismatch')
		})
}

export function createSetupSchema(): z.ZodType<SetupValues> {
	return z.object({
		token: z.string().trim().min(32, t('auth.validation.setup-token-min')),
		workspaceName: z
			.string()
			.trim()
			.min(1, t('auth.validation.workspace-name-required'))
			.max(80, t('auth.validation.workspace-name-max')),
		slug: z
			.string()
			.trim()
			.min(2, t('auth.validation.slug-min'))
			.max(48, t('auth.validation.slug-max'))
			.regex(SLUG_REGEX, t('auth.validation.slug-pattern')),
		displayName: z
			.string()
			.trim()
			.min(1, t('auth.validation.display-name-required'))
			.min(2, t('auth.validation.display-name-min'))
			.max(120, t('auth.validation.display-name-max')),
		email: z
			.string()
			.trim()
			.min(1, t('auth.validation.email-required'))
			.pipe(z.email(t('auth.validation.email-invalid'))),
		password: z.string().min(8, t('auth.validation.password-min')).max(128, t('auth.validation.password-max'))
	})
}

export function createWorkspaceSchema(): z.ZodType<CreateWorkspaceValues> {
	return z.object({
		name: z
			.string()
			.trim()
			.min(1, t('auth.validation.workspace-name-required'))
			.max(80, t('auth.validation.workspace-name-max')),
		slug: z
			.string()
			.trim()
			.min(2, t('auth.validation.slug-min'))
			.max(48, t('auth.validation.slug-max'))
			.regex(SLUG_REGEX, t('auth.validation.slug-pattern'))
	})
}

export function createAcceptInviteSchema(): z.ZodType<AcceptInviteValues> {
	return z.object({
		token: z.string().trim().min(20, t('auth.validation.invite-token-min'))
	})
}

export interface PasswordStrengthResult {
	readonly score: 0 | 1 | 2 | 3 | 4
	readonly labelKey: MessageId
	readonly tone: 'danger' | 'warning' | 'info' | 'success'
}

/** Heuristic 4-step password strength indicator for immediate inline guidance. */
export function evaluatePasswordStrength(password: string): PasswordStrengthResult {
	if (!password) {
		return { score: 0, labelKey: 'auth.password.strength.weak', tone: 'danger' }
	}
	let points = 0
	if (password.length >= 8) points += 1
	if (password.length >= 12) points += 1
	if (/[a-z]/.test(password) && /[A-Z]/.test(password)) points += 1
	if (/\d/.test(password) && /[^A-Za-z0-9]/.test(password)) points += 1
	else if (/\d/.test(password) || /[^A-Za-z0-9]/.test(password)) points += 0.5

	if (points <= 1) return { score: 1, labelKey: 'auth.password.strength.weak', tone: 'danger' }
	if (points <= 2) return { score: 2, labelKey: 'auth.password.strength.fair', tone: 'warning' }
	if (points <= 3) return { score: 3, labelKey: 'auth.password.strength.good', tone: 'info' }
	return { score: 4, labelKey: 'auth.password.strength.strong', tone: 'success' }
}
