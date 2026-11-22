/**
 * Shared request context, CSRF checks, and idempotency wrapper (§8.6, §12.2, §12.6).
 */
import { createHash } from 'node:crypto'
import { isUuid, type Queryable } from '@huriro/db'
import { type Auth, type AuthSession, requireSession } from '../modules/identity'
import { HttpError } from './error'

const SAFE_METHODS = new Set(['GET', 'HEAD', 'OPTIONS'])

export interface WorkspaceRequestContext {
	readonly session: AuthSession
	readonly workspaceId: string
	readonly requestId: string
}

/**
 * Validate auth session, credential exclusivity, CSRF headers (for cookie auth),
 * and the `X-Workspace-Id` header.
 */
export async function requireWorkspaceRequest(
	auth: Auth | null,
	request: Request,
	requestId: string
): Promise<WorkspaceRequestContext> {
	if (!auth) throw new HttpError(501, 'not_implemented', 'Auth not configured')

	const hasCookie = request.headers.has('cookie')
	const hasAuthHeader = request.headers.has('authorization')
	if (hasCookie && hasAuthHeader) {
		throw new HttpError(
			400,
			'credential_type_mismatch',
			'Present only one credential type (cookie or Authorization header)'
		)
	}

	const session = await requireSession(auth, request)

	// CSRF protection for cookie-authenticated state-changing requests (§12.6).
	if (hasCookie && !SAFE_METHODS.has(request.method.toUpperCase())) {
		const reqOrigin = new URL(request.url).origin
		const origin = request.headers.get('origin')
		const fetchSite = request.headers.get('sec-fetch-site')
		if (origin && origin !== reqOrigin) {
			throw new HttpError(403, 'forbidden', 'Cross-origin state-changing request rejected')
		}
		if (fetchSite && fetchSite !== 'same-origin' && fetchSite !== 'same-site' && fetchSite !== 'none') {
			throw new HttpError(403, 'forbidden', 'Cross-site request rejected')
		}
		if (!request.headers.get('x-huriro-client')) {
			throw new HttpError(403, 'forbidden', 'Missing X-Huriro-Client CSRF header')
		}
	}

	const workspaceId = request.headers.get('x-workspace-id')?.trim()
	if (!workspaceId || !isUuid(workspaceId)) {
		throw new HttpError(400, 'workspace_required', 'Valid X-Workspace-Id header is required')
	}

	return { session, workspaceId, requestId }
}

function canonicalStringify(value: unknown): string {
	if (value === null || typeof value !== 'object') {
		return JSON.stringify(value)
	}
	if (Array.isArray(value)) {
		return `[${value.map((v) => canonicalStringify(v)).join(',')}]`
	}
	const rec = value as Record<string, unknown>
	const keys = Object.keys(rec).sort()
	return `{${keys
		.filter((k) => rec[k] !== undefined)
		.map((k) => `${JSON.stringify(k)}:${canonicalStringify(rec[k])}`)
		.join(',')}}`
}

function hashPayload(payload: unknown): string {
	return createHash('sha256').update(canonicalStringify(payload)).digest('hex')
}

export interface IdempotentResult<T> {
	readonly replayed: boolean
	readonly status: number
	readonly body: T
}

/**
 * Execute an idempotent write inside the caller's tenant transaction (§8.6).
 * Same key + same payload → replay stored response.
 * Same key + different payload → 422 idempotency_conflict.
 * In-flight duplicate → 409 idempotency_in_flight.
 */
export async function withIdempotency<T>(
	tx: Queryable,
	args: {
		readonly workspaceId: string
		readonly key: string | null | undefined
		readonly endpoint: string
		readonly requestBody: unknown
		readonly successStatus?: number
		readonly execute: () => Promise<T>
	}
): Promise<IdempotentResult<T>> {
	const rawKey = args.key?.trim()
	const status = args.successStatus ?? 200
	if (!rawKey) {
		return { replayed: false, status, body: await args.execute() }
	}

	const requestHash = hashPayload(args.requestBody)
	const [existing] = await tx<
		{
			requestHash: string
			status: 'in_flight' | 'completed' | 'failed'
			responseCode: number | null
			responseBody: unknown
			expired: boolean
		}[]
	>`
		SELECT
			request_hash AS "requestHash",
			status,
			response_code AS "responseCode",
			response_body AS "responseBody",
			expires_at <= now() AS expired
		FROM idempotency_keys
		WHERE workspace_id = ${args.workspaceId} AND key = ${rawKey}
		FOR UPDATE
	`

	if (existing && !existing.expired) {
		if (existing.requestHash !== requestHash) {
			throw new HttpError(
				422,
				'idempotency_conflict',
				'Idempotency-Key was already used with a different request payload'
			)
		}
		if (existing.status === 'in_flight') {
			throw new HttpError(
				409,
				'idempotency_in_flight',
				'A request with this Idempotency-Key is currently in progress'
			)
		}
		if (existing.status === 'completed' && existing.responseCode !== null) {
			return {
				replayed: true,
				status: existing.responseCode,
				body: existing.responseBody as T
			}
		}
	}

	await tx`
		INSERT INTO idempotency_keys (workspace_id, key, endpoint, request_hash, status, expires_at)
		VALUES (${args.workspaceId}, ${rawKey}, ${args.endpoint}, ${requestHash}, 'in_flight', now() + interval '24 hours')
		ON CONFLICT (workspace_id, key) DO UPDATE
		SET endpoint = EXCLUDED.endpoint,
			request_hash = EXCLUDED.request_hash,
			status = 'in_flight',
			response_code = NULL,
			response_body = NULL,
			expires_at = EXCLUDED.expires_at
	`

	const body = await args.execute()

	await tx`
		UPDATE idempotency_keys
		SET status = 'completed',
			response_code = ${status},
			response_body = ${tx.json((body ?? null) as never)}
		WHERE workspace_id = ${args.workspaceId} AND key = ${rawKey}
	`

	return { replayed: false, status, body }
}
