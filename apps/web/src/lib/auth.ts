/**
 * Client-side identity & onboarding calls (§8.3, §12.2):
 *   - better-auth routes are mounted at /api/auth/* on the api service
 *   - setup, provider discovery, workspace creation, and invites live under /api/v1/*
 */
import { api } from './http'

export const SOCIAL_PROVIDER_IDS = ['google', 'github', 'apple'] as const
export type SocialProviderId = (typeof SOCIAL_PROVIDER_IDS)[number]

/** POST JSON and parse response; surfaces server error messages (problem+json or better-auth). */
async function post<T = void>(path: string, body: unknown): Promise<T> {
	const res = await api.post(path, body)
	if (res.status >= 300) {
		const parsed = (typeof res.data === 'object' ? res.data : null) as {
			message?: string
			detail?: string
			title?: string
		} | null
		const message = parsed?.message ?? parsed?.detail ?? parsed?.title ?? `Request failed (${res.status})`
		throw new Error(message)
	}
	if (res.status === 204) return undefined as T
	if (!res.data) return undefined as T
	// axios pre-parses JSON bodies; a raw string here means non-JSON content —
	// JSON.parse preserves the old res.text()+parse behavior (throws on junk).
	return (typeof res.data === 'string' ? JSON.parse(res.data) : res.data) as T
}

export interface SignInInput {
	readonly email: string
	readonly password: string
	readonly rememberMe?: boolean | undefined
}

export async function signIn(input: SignInInput): Promise<void> {
	await post('/api/auth/sign-in/email', {
		email: input.email,
		password: input.password,
		...(input.rememberMe !== undefined ? { rememberMe: input.rememberMe } : {})
	})
}

export interface SignUpInput {
	readonly name: string
	readonly email: string
	readonly password: string
}

export async function signUp(input: SignUpInput): Promise<void> {
	await post('/api/auth/sign-up/email', input)
}

export interface SocialSignInOptions {
	readonly callbackURL?: string | undefined
	readonly newUserCallbackURL?: string | undefined
	readonly errorCallbackURL?: string | undefined
}

export interface SocialSignInResult {
	readonly url?: string | undefined
	readonly redirect: boolean
}

export async function signInWithSocial(
	provider: SocialProviderId,
	opts?: SocialSignInOptions
): Promise<SocialSignInResult> {
	return post<SocialSignInResult>('/api/auth/sign-in/social', {
		provider,
		callbackURL: opts?.callbackURL ?? '/',
		newUserCallbackURL: opts?.newUserCallbackURL ?? '/onboarding',
		errorCallbackURL: opts?.errorCallbackURL ?? '/sign-in',
		disableRedirect: true
	})
}

export async function fetchAuthProviders(): Promise<readonly SocialProviderId[]> {
	try {
		const res = await api.get('/api/v1/auth/providers')
		if (res.status >= 300) return []
		const json = res.data as { providers?: readonly SocialProviderId[] }
		return Array.isArray(json.providers) ? json.providers : []
	} catch {
		return []
	}
}

export async function signOut(): Promise<void> {
	await post('/api/auth/sign-out', {})
}

export interface SetupInput {
	readonly token: string
	readonly workspaceName: string
	readonly slug: string
	readonly email: string
	readonly displayName: string
	readonly password: string
}

/** First-run wizard: provisions workspace + owner, then signs the owner in. */
export async function completeSetup(input: SetupInput): Promise<void> {
	await post('/api/v1/setup', input)
	await signIn({ email: input.email, password: input.password, rememberMe: true })
}

export interface CreateWorkspaceInput {
	readonly name: string
	readonly slug: string
}

export interface CreatedWorkspaceResponse {
	readonly id: string
	readonly slug: string
	readonly name: string
}

export async function createWorkspace(input: CreateWorkspaceInput): Promise<CreatedWorkspaceResponse> {
	return post<CreatedWorkspaceResponse>('/api/v1/workspaces', input)
}

export async function acceptInvitation(
	token: string
): Promise<{ readonly workspaceId: string; readonly membershipCreated: boolean }> {
	return post('/api/v1/invitations/accept', { token })
}

/** Convert a workspace display name into a valid URL slug (`^[a-z0-9][a-z0-9-]*$`). */
export function slugifyWorkspaceName(name: string): string {
	return name
		.toLowerCase()
		.trim()
		.replace(/[^a-z0-9]+/g, '-')
		.replace(/^-+|-+$/g, '')
		.slice(0, 48)
}
