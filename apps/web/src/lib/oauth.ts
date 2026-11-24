/**
 * OAuth authorization-server helpers (§13.1b, M3):
 *   - `/oauth/consent` — signed consent decision via `/api/auth/oauth2/consent`
 *   - `/oauth2/continue` — resume the authorize flow after sign-in
 *   - `/device` — RFC 8628 device-code verify + approve/deny
 *
 * The consent redirect carries a server-signed query (`sig` + a `ba_param`
 * allowlist of covered parameter names). The consent POST must echo back only
 * the signed subset — this mirrors the oauth-provider plugin's
 * `buildSignedOAuthQuery` so the wire contract stays in one format.
 */
import { env } from './env'

const API_BASE = env.VITE_API_URL ?? ''

/** Pages that must keep `location.search` when the auth gate bounces to sign-in. */
export const OAUTH_PAGE_PATHS = ['/oauth/consent', '/device'] as const

export function isOAuthPagePathname(pathname: string): boolean {
	return OAUTH_PAGE_PATHS.some((path) => pathname === path || pathname.startsWith(`${path}/`))
}

/**
 * Reduce `window.location.search` to the server-signed subset expected in
 * `oauth_query` bodies: `sig`, `ba_param` (the name allowlist), and every
 * parameter named in it. Returns undefined when the URL is not a signed
 * OAuth redirect.
 */
export function buildSignedOAuthQuery(search: string): string | undefined {
	const params = new URLSearchParams(search)
	if (!params.has('sig')) return undefined
	const signedNames = params.getAll('ba_param')
	if (signedNames.length === 0) return undefined
	const keep = new Set(signedNames)
	const out = new URLSearchParams()
	for (const [key, value] of params.entries()) {
		if (key === 'sig' || key === 'ba_param' || keep.has(key)) out.append(key, value)
	}
	return out.toString()
}

/** True when the current URL looks like an OAuth redirect (signed params present). */
export function hasOAuthQuery(search: string): boolean {
	return buildSignedOAuthQuery(search) !== undefined
}

async function post<T>(path: string, body: unknown): Promise<T> {
	const res = await fetch(`${API_BASE}${path}`, {
		method: 'POST',
		credentials: 'include',
		headers: { 'content-type': 'application/json', 'x-huriro-client': 'huriro-web' },
		body: JSON.stringify(body)
	})
	const json = (await res.json().catch(() => ({}))) as Record<string, unknown>
	if (!res.ok) {
		const message =
			(typeof json['error_description'] === 'string' && json['error_description']) ||
			(typeof json['message'] === 'string' && json['message']) ||
			(typeof json['detail'] === 'string' && json['detail']) ||
			`Request failed (${res.status})`
		throw new OAuthRequestError(res.status, message)
	}
	return json as T
}

export class OAuthRequestError extends Error {
	readonly status: number
	constructor(status: number, message: string) {
		super(message)
		this.status = status
	}
}

export interface OAuthRedirectResult {
	readonly redirect: boolean
	readonly url: string
}

/** Approve or deny a signed consent request; resolves to the client redirect URL. */
export function decideConsent(signedQuery: string, accept: boolean): Promise<OAuthRedirectResult> {
	return post<OAuthRedirectResult>('/api/auth/oauth2/consent', { accept, oauth_query: signedQuery })
}

/**
 * Resume an authorize flow that was interrupted for sign-in: the plugin
 * redirects to `loginPage` with the signed query; after the session exists we
 * POST `/oauth2/continue` so the server picks up at consent/redirect.
 */
export function continueOAuth(signedQuery: string): Promise<OAuthRedirectResult> {
	return post<OAuthRedirectResult>('/api/auth/oauth2/continue', { oauth_query: signedQuery })
}

export interface DeviceVerification {
	readonly user_code: string
	readonly status: string
	readonly client_id?: string | undefined
	readonly scope?: string | undefined
	readonly resource?: string | readonly string[] | undefined
}

/** Look up a user_code without deciding — shows the user what is being asked. */
export async function deviceVerify(userCode: string): Promise<DeviceVerification> {
	const res = await fetch(`${API_BASE}/api/auth/device?user_code=${encodeURIComponent(userCode)}`, {
		credentials: 'include',
		headers: { 'x-huriro-client': 'huriro-web' }
	})
	const json = (await res.json().catch(() => ({}))) as Record<string, unknown>
	if (!res.ok) {
		const message =
			(typeof json['error_description'] === 'string' && json['error_description']) ||
			(typeof json['message'] === 'string' && json['message']) ||
			`Request failed (${res.status})`
		throw new OAuthRequestError(res.status, message)
	}
	return json as unknown as DeviceVerification
}

export function deviceApprove(userCode: string): Promise<{ readonly success: boolean }> {
	return post('/api/auth/device/approve', { userCode })
}

export function deviceDeny(userCode: string): Promise<{ readonly success: boolean }> {
	return post('/api/auth/device/deny', { userCode })
}
