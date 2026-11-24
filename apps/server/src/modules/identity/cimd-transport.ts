/**
 * CIMD client-metadata transport (§13.1, ADR-0019).
 *
 * better-auth's `fetchClientMetadataResource` is a fetch-shaped transport for
 * fetching Client ID Metadata Documents (and discovery-owned JWKS). The
 * security boundary the plugin expects — resolve DNS once, reject
 * private/RFC 6890 ranges, pin the address, refuse redirects — is exactly what
 * `api/egress.ts` already enforces for every other outbound fetch, so this is
 * a thin adapter, not a second network path.
 *
 * Redirects are refused outright (`maxRedirects: 0`): a client_id URL that
 * redirects is not the URL the user consented to, and the CIMD draft requires
 * the document to be served from the client_id itself.
 */
import type { ClientMetadataResourceFetch } from '@better-auth/oauth-provider'
import { type DnsResolver, safeEgressFetch } from '../../api/egress'

const CIMD_TIMEOUT_MS = 5_000
/** Client metadata documents are small; cap well under the egress default. */
const CIMD_MAX_BYTES = 64 * 1024

export function createCimdFetch(
	opts: { resolver?: DnsResolver; fetcher?: typeof fetch } = {}
): ClientMetadataResourceFetch {
	return async (input, init) => {
		const url = typeof input === 'string' ? input : input instanceof URL ? input.toString() : input.url
		const headers: Record<string, string> = {}
		if (init?.headers) {
			for (const [k, v] of new Headers(init.headers)) headers[k] = v
		}
		const res = await safeEgressFetch(url, {
			method: 'GET',
			headers,
			timeoutMs: CIMD_TIMEOUT_MS,
			maxBytes: CIMD_MAX_BYTES,
			maxRedirects: 0,
			...(opts.resolver ? { resolver: opts.resolver } : {}),
			...(opts.fetcher ? { fetcher: opts.fetcher } : {})
		})
		return new Response(res.bodyBytes.slice().buffer as ArrayBuffer, {
			status: res.status,
			headers: res.headers
		})
	}
}
