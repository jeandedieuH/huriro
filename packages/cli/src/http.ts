// HTTP client: tool calls against /api/v1/agent/tools/* with auth, tenant
// header, idempotency + safe retries, and problem+json → stable exit codes.
import type { Io } from './io'
import { normalizeServer } from './store'

export const EXIT = { ok: 0, error: 1, usage: 2, auth: 3, approval: 4, rateLimited: 5, notFound: 6 } as const

export interface ToolResult {
	readonly status: 'executed' | 'failed' | 'approval_required' | 'needs_confirmation'
	readonly data?: unknown
	readonly markdown?: string
	readonly trust?: string
	readonly nextCursor?: string
	readonly code?: string
	readonly approvalId?: string
	readonly approveUrl?: string
	readonly expiresAt?: string
}

export interface CallOptions {
	readonly tool: string
	readonly input: Record<string, unknown>
	readonly token: string
	readonly workspaceId: string
	readonly idempotencyKey?: string | undefined
	readonly isWrite: boolean
}

/** Map an HTTP/problem+json failure to a stable exit code + human message. */
export function exitForFailure(
	status: number,
	code: string | undefined,
	retryAfter?: string | undefined
): { code: number; message: string } {
	if (status === 429) {
		return {
			code: EXIT.rateLimited,
			message: `rate limited${retryAfter ? ` — retry after ${retryAfter}s` : ''}`
		}
	}
	if (status === 404) return { code: EXIT.notFound, message: `not found (${code ?? 'not_found'})` }
	if (status === 401 || status === 403) {
		const scopeHint = code === 'insufficient_scope' ? ' — the credential lacks a required scope' : ''
		return { code: EXIT.auth, message: `auth denied: ${code ?? 'unauthorized'}${scopeHint}` }
	}
	return { code: EXIT.error, message: `request failed (${status}): ${code ?? 'unknown'}` }
}

async function postJson(
	io: Io,
	url: string,
	body: unknown,
	headers: Record<string, string>
): Promise<Response> {
	return io.fetch(url, {
		method: 'POST',
		headers: { 'content-type': 'application/json', ...headers },
		body: JSON.stringify(body)
	})
}

/**
 * Call a tool. Write calls always carry an Idempotency-Key; network errors and
 * 429s retry with backoff (≤3 attempts) honoring Retry-After.
 */
export async function callTool(
	io: Io,
	server: string,
	opts: CallOptions
): Promise<{ result?: ToolResult; failure?: { code: number; message: string } }> {
	const url = `${normalizeServer(server)}/api/v1/agent/tools/${opts.tool}`
	const idem = opts.idempotencyKey ?? io.randomId()
	const headers: Record<string, string> = {
		authorization: `Bearer ${opts.token}`,
		'x-workspace-id': opts.workspaceId
	}
	if (opts.isWrite) headers['idempotency-key'] = idem

	let lastErr = 'network error'
	for (let attempt = 0; attempt < 3; attempt++) {
		try {
			const res = await postJson(io, url, opts.input, headers)
			const body = (await res.json().catch(() => ({}))) as Record<string, unknown>
			if (res.status === 429) {
				const retryAfter = res.headers.get('retry-after') ?? undefined
				if (attempt < 2) {
					await io.sleep((retryAfter ? Number(retryAfter) : 2 ** attempt) * 1000)
					continue
				}
				return { failure: exitForFailure(429, body['code'] as string | undefined, retryAfter) }
			}
			if (!res.ok) {
				const f = exitForFailure(res.status, (body['code'] ?? body['error']) as string | undefined)
				io.stderr(
					`${f.message}${res.status === 403 && body['requiredScope'] ? `: missing ${body['requiredScope']}` : ''}`
				)
				return { failure: f }
			}
			const result = body as unknown as ToolResult
			if (result.status === 'approval_required') return { result }
			if (result.status === 'failed') {
				// Refusals are recorded outcomes (HTTP 200) — map the well-known
				// problem codes to the same exit codes as transport errors.
				const code = result.code ?? 'unknown'
				if (code === 'insufficient_scope' || code === 'agent_suspended' || code === 'agent_not_connected') {
					io.stderr(`auth denied: ${code}${code === 'insufficient_scope' ? ' — missing scope' : ''}`)
					return { failure: { code: EXIT.auth, message: code } }
				}
				return { failure: { code: EXIT.error, message: `tool failed: ${code}` } }
			}
			return { result }
		} catch (err) {
			lastErr = err instanceof Error ? err.message : String(err)
			if (attempt < 2) await io.sleep(250 * 2 ** attempt)
		}
	}
	return { failure: { code: EXIT.error, message: `request failed: ${lastErr}` } }
}

export async function postAuthEndpoint(
	io: Io,
	server: string,
	path: string,
	form: Record<string, string>
): Promise<{ ok: boolean; status: number; json: Record<string, unknown> }> {
	const res = await io.fetch(`${normalizeServer(server)}/api/auth${path}`, {
		method: 'POST',
		headers: { 'content-type': 'application/x-www-form-urlencoded' },
		body: new URLSearchParams(form).toString()
	})
	const json = (await res.json().catch(() => ({}))) as Record<string, unknown>
	return { ok: res.ok, status: res.status, json }
}

export async function getJson(
	io: Io,
	server: string,
	path: string,
	headers: Record<string, string>
): Promise<{ ok: boolean; status: number; json: Record<string, unknown> }> {
	const res = await io.fetch(`${normalizeServer(server)}${path}`, { headers })
	const json = (await res.json().catch(() => ({}))) as Record<string, unknown>
	return { ok: res.ok, status: res.status, json }
}
