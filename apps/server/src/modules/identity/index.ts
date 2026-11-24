/**
 * Identity module seam (§5.4). Only index.ts is importable cross-module:
 *   - `createAuth(config)` builds the better-auth instance (mounted in app.ts)
 *   - `requireSession(auth, request)` resolves the caller's session or throws
 *     401 problem+json — the single auth gate every protected route uses.
 *
 * Sessions resolve through better-auth (DB session on the auth pool). The
 * resolved identity (users.id + email) is what downstream withWorkspace calls
 * put into app.user_id / app.user_email — the RLS link between auth and tenancy.
 */

import { Elysia } from 'elysia'
import { Type } from 'typebox'
import { HttpError } from '../../api/error'
import { type Auth, getEnabledSocialProviders, type SocialProviderId } from './auth'

export type { AgentAudience, VerifiedAgentCredential } from './agent-bearer'
export {
	agentAudienceUris,
	ensureAgentOAuthSeed,
	HURIRO_CLI_CLIENT_ID,
	revokeAgentGrants,
	verifyAgentBearer
} from './agent-bearer'
export type { Auth, SocialProviderId } from './auth'
export { createAuth, getEnabledSocialProviders, SOCIAL_PROVIDER_IDS } from './auth'

const ProvidersResponse = Type.Object({
	providers: Type.Array(Type.Union([Type.Literal('google'), Type.Literal('github'), Type.Literal('apple')]))
})

/** Public auth capability discovery so the client only enables configured OAuth flows. */
export function identityModule(auth: Auth | null) {
	return new Elysia({ name: 'huriro.identity' }).get(
		'/auth/providers',
		{ response: ProvidersResponse },
		(): { providers: SocialProviderId[] } => ({
			providers: getEnabledSocialProviders(auth)
		})
	)
}

export interface AuthSession {
	readonly userId: string
	readonly email: string
	readonly sessionId: string
}

/** Resolve the better-auth session, or throw a problem+json 401. */
export async function requireSession(auth: Auth, request: Request): Promise<AuthSession> {
	try {
		const session = await auth.api.getSession({ headers: request.headers })
		if (!session) throw new HttpError(401, 'unauthorized', 'Sign-in required')
		return {
			userId: session.user.id,
			email: session.user.email,
			sessionId: session.session.id
		}
	} catch (err) {
		if (err instanceof HttpError) throw err
		// Session-store failures degrade to 401, never 500-with-internals —
		// an unresolvable session is an unauthenticated request.
		throw new HttpError(401, 'unauthorized', 'Session could not be resolved')
	}
}
