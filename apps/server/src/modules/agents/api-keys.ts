/**
 * Workspace-bound agent API keys (§13.1a, ADR-0021).
 *
 * Key format: `hrk_<8-char prefix>_<32-byte base64url secret>`. The FULL key
 * is shown once at creation; only sha256(full) is stored and compared in
 * constant time. Keys resolve an `automation` principal owned by the creator;
 * `scopes` play the role of token scopes so the dispatcher's
 * scopes ∩ ceiling ∩ owner-role math applies unchanged.
 *
 * Keys are verified ONLY inside a tenant transaction (the caller's
 * X-Workspace-Id) — there is deliberately no cross-tenant prefix lookup, so a
 * key cannot even be probed outside its own workspace.
 */
import { createHash, randomBytes, timingSafeEqual } from 'node:crypto'
import type { Queryable, Sql } from '@huriro/db'
import { withWorkspace } from '@huriro/db'
import type { ActorContext } from '@huriro/domain'
import { AGENT_SCOPES } from '@huriro/domain'
import { Elysia } from 'elysia'
import { Type } from 'typebox'
import { HttpError } from '../../api/error'
import type { Auth, VerifiedAgentCredential } from '../identity'
import { verifyAgentBearer } from '../identity'
import { workspaceDerive } from '../tenancy'
import { getPrincipalById, insertPrincipal } from './repo'

export const API_KEY_CLIENT_ID = 'api-key'

const KEY_RE = /^hrk_([A-Za-z0-9_-]{8})_([A-Za-z0-9_-]{43})$/

export interface ApiKeyRow {
	readonly id: string
	readonly workspaceId: string
	readonly agentId: string
	readonly createdBy: string
	readonly name: string
	readonly prefix: string
	readonly secretHash: string
	readonly scopes: string[]
	readonly expiresAt: Date | null
	readonly lastUsedAt: Date | null
	readonly revokedAt: Date | null
	readonly createdAt: Date
}

export function isApiKeyValue(value: string): boolean {
	return KEY_RE.test(value)
}

/** Mint a new key. `full` is the only time the secret exists in cleartext. */
export function generateApiKey(): { full: string; prefix: string; secretHash: string } {
	const prefix = randomBytes(6).toString('base64url').slice(0, 8)
	const secret = randomBytes(32).toString('base64url') // 43 chars
	const full = `hrk_${prefix}_${secret}`
	return { full, prefix, secretHash: hashApiKey(full) }
}

export function hashApiKey(full: string): string {
	return createHash('sha256').update(full).digest('hex')
}

/** Constant-time hash comparison; inputs are equal-length hex digests. */
export function verifyApiKeyHash(full: string, storedHash: string): boolean {
	const a = Buffer.from(hashApiKey(full), 'utf8')
	const b = Buffer.from(storedHash, 'utf8')
	return a.length === b.length && timingSafeEqual(a, b)
}

// ---------- failure throttle (brute-force / enumeration, ADR-0021) ----------
const failures = new Map<string, { count: number; resetAt: number }>()
const THROTTLE_MAX = 10
const THROTTLE_WINDOW_MS = 60_000

export function apiKeyThrottled(key: string, now = Date.now()): boolean {
	const e = failures.get(key)
	if (!e || now >= e.resetAt) return false
	return e.count >= THROTTLE_MAX
}

export function recordApiKeyFailure(key: string, now = Date.now()): void {
	const e = failures.get(key)
	if (!e || now >= e.resetAt) {
		failures.set(key, { count: 1, resetAt: now + THROTTLE_WINDOW_MS })
	} else {
		e.count += 1
	}
}

/** Visible for tests. */
export function resetApiKeyThrottle(): void {
	failures.clear()
}

export async function findKeyByPrefix(
	tx: Queryable,
	workspaceId: string,
	prefix: string
): Promise<ApiKeyRow | null> {
	const rows = await tx<ApiKeyRow[]>`
		SELECT id, workspace_id AS "workspaceId", agent_id AS "agentId",
			created_by AS "createdBy", name, prefix, secret_hash AS "secretHash",
			scopes, expires_at AS "expiresAt", last_used_at AS "lastUsedAt",
			revoked_at AS "revokedAt", created_at AS "createdAt"
		FROM agent_api_keys
		WHERE workspace_id = ${workspaceId} AND prefix = ${prefix}
	`
	return rows[0] ?? null
}

async function touchLastUsed(tx: Queryable, workspaceId: string, id: string): Promise<void> {
	await tx`UPDATE agent_api_keys SET last_used_at = now() WHERE workspace_id = ${workspaceId} AND id = ${id}`
}

/**
 * Verify an `hrk_` bearer inside THIS workspace's tx. Returns the key row and
 * its principal on success; throws 401 otherwise. `ip` keys the in-process
 * failure throttle together with the prefix.
 */
export async function verifyApiKeyBearer(
	tx: Queryable,
	workspaceId: string,
	bearer: string,
	ip: string
): Promise<{ key: ApiKeyRow }> {
	const throttleKey = `${ip}:${bearer.slice(0, 12)}`
	if (apiKeyThrottled(throttleKey)) {
		throw new HttpError(401, 'unauthorized', 'Invalid API key')
	}
	const m = KEY_RE.exec(bearer)
	if (!m) {
		recordApiKeyFailure(throttleKey)
		throw new HttpError(401, 'unauthorized', 'Malformed API key')
	}
	const row = await findKeyByPrefix(tx, workspaceId, m[1] ?? '')
	if (!row || !verifyApiKeyHash(bearer, row.secretHash)) {
		recordApiKeyFailure(throttleKey)
		throw new HttpError(401, 'unauthorized', 'Invalid API key')
	}
	if (row.revokedAt) {
		throw new HttpError(401, 'unauthorized', 'API key is revoked')
	}
	if (row.expiresAt && row.expiresAt.getTime() <= Date.now()) {
		throw new HttpError(401, 'unauthorized', 'API key has expired')
	}
	await touchLastUsed(tx, workspaceId, row.id)
	return { key: row }
}

// ---------- bearer verification (REST audience only, ADR-0021) ----------

function bearerValue(request: Request): string | null {
	const h = request.headers.get('authorization')
	if (!h?.startsWith('Bearer ')) return null
	return h.slice(7).trim() || null
}

/** True when the Authorization bearer is an `hrk_` workspace API key. */
export function requestHasApiKey(request: Request): boolean {
	return bearerValue(request)?.startsWith('hrk_') ?? false
}

/**
 * Credential resolution for `/api/v1/agent/*`: `hrk_` keys verify inside the
 * tenant transaction keyed by X-Workspace-Id; anything else is an OAuth token
 * (verifyAgentBearer). API keys are REST-audience only — /mcp rejects them
 * before OAuth verification ever runs.
 */
export async function verifyRestAgentCredential(
	sql: Sql,
	auth: Auth | null,
	request: Request
): Promise<VerifiedAgentCredential> {
	const bearer = bearerValue(request)
	if (bearer?.startsWith('hrk_')) {
		if (!auth) throw new HttpError(501, 'not_implemented', 'Auth not configured')
		const workspaceId = request.headers.get('x-workspace-id')
		if (!workspaceId) {
			throw new HttpError(401, 'unauthorized', 'API keys require an X-Workspace-Id header')
		}
		const ip = request.headers.get('x-forwarded-for')?.split(',')[0]?.trim() ?? 'local'
		return withWorkspace(sql, { workspaceId }, async (tx) => {
			const { key } = await verifyApiKeyBearer(tx, workspaceId, bearer, ip)
			const principal = await getPrincipalById(tx, workspaceId, key.agentId)
			if (!principal) {
				throw new HttpError(403, 'agent_not_connected', 'API key principal is missing')
			}
			return {
				userId: principal.ownerUserId,
				clientId: API_KEY_CLIENT_ID,
				scopes: key.scopes,
				tokenId: key.id,
				audience: 'rest' as const,
				principalId: principal.id
			}
		})
	}
	if (!auth) throw new HttpError(501, 'not_implemented', 'Auth not configured')
	return verifyAgentBearer(auth, request, { audience: 'rest' })
}

// ---------- session-only management routes ----------

const CreateApiKeyBody = Type.Object(
	{
		name: Type.String({ minLength: 1, maxLength: 120 }),
		scopes: Type.Array(Type.String()),
		expiresInDays: Type.Optional(Type.Integer({ minimum: 1, maximum: 365 }))
	},
	{ additionalProperties: false }
)

const ApiKeyIdParam = Type.Object({ id: Type.String({ format: 'uuid' }) }, { additionalProperties: false })

function requireAgentManage(actor: ActorContext): void {
	if (actor.membership !== 'active') {
		throw new HttpError(403, 'not_workspace_member', 'Active membership required')
	}
	if (!actor.permissions.has('agent.manage' as never)) {
		throw new HttpError(403, 'insufficient_role', 'Missing agent.manage permission')
	}
}

function toDto(k: ApiKeyRow): Record<string, unknown> {
	const status = k.revokedAt
		? 'revoked'
		: k.expiresAt && k.expiresAt.getTime() <= Date.now()
			? 'expired'
			: 'active'
	return {
		id: k.id,
		name: k.name,
		prefix: k.prefix,
		agentId: k.agentId,
		scopes: k.scopes,
		status,
		expiresAt: k.expiresAt?.toISOString() ?? null,
		lastUsedAt: k.lastUsedAt?.toISOString() ?? null,
		createdAt: k.createdAt.toISOString()
	}
}

/**
 * `/agents/api-keys*` — human session only (workspaceDerive → cookie session;
 * bearer credentials never reach it). Key creation is an R3 operation and is
 * deliberately NOT a registry tool — agents cannot mint their own keys.
 */
export function apiKeyRoutes(sql: Sql, auth: Auth | null) {
	return new Elysia({ name: 'huriro.agent-api-keys' })
		.derive(workspaceDerive(sql, auth))
		.post('/agents/api-keys', { body: CreateApiKeyBody }, async ({ body, inWorkspace }) => ({
			data: await inWorkspace((tx, actor) => {
				requireAgentManage(actor)
				return createKey(tx, actor, body)
			})
		}))
		.get('/agents/api-keys', ({ inWorkspace }) =>
			inWorkspace(async (tx, actor) => {
				requireAgentManage(actor)
				const rows = await tx<ApiKeyRow[]>`
					SELECT id, workspace_id AS "workspaceId", agent_id AS "agentId",
						created_by AS "createdBy", name, prefix, secret_hash AS "secretHash",
						scopes, expires_at AS "expiresAt", last_used_at AS "lastUsedAt",
						revoked_at AS "revokedAt", created_at AS "createdAt"
					FROM agent_api_keys
					WHERE workspace_id = ${actor.workspaceId}
					ORDER BY created_at DESC
				`
				return { data: rows.map(toDto) }
			})
		)
		.delete('/agents/api-keys/:id', { params: ApiKeyIdParam }, async ({ params, inWorkspace }) => ({
			data: await inWorkspace(async (tx, actor) => {
				requireAgentManage(actor)
				const rows = await tx<ApiKeyRow[]>`
					UPDATE agent_api_keys SET revoked_at = now()
					WHERE workspace_id = ${actor.workspaceId} AND id = ${params.id} AND revoked_at IS NULL
					RETURNING id, workspace_id AS "workspaceId", agent_id AS "agentId",
						created_by AS "createdBy", name, prefix, secret_hash AS "secretHash",
						scopes, expires_at AS "expiresAt", last_used_at AS "lastUsedAt",
						revoked_at AS "revokedAt", created_at AS "createdAt"
				`
				const row = rows[0]
				if (!row) throw new HttpError(404, 'not_found', 'API key not found')
				return toDto(row)
			})
		}))
}

/**
 * Create key + principal in one tenant tx: reuse an active automation
 * principal with the same name for this owner, else create one with
 * ceiling = key scopes (§13.1a — principals are revocable, auditable actors).
 */
async function createKey(
	tx: Queryable,
	actor: ActorContext,
	body: { name: string; scopes: string[]; expiresInDays?: number | undefined }
): Promise<Record<string, unknown>> {
	const scopes = body.scopes.filter((s) => (AGENT_SCOPES as readonly string[]).includes(s))
	if (scopes.length === 0) {
		throw new HttpError(422, 'validation_failed', 'scopes must contain at least one agent scope')
	}
	const principalName = `API key: ${body.name}`
	const existing = await tx<{ id: string }[]>`
		SELECT id FROM agent_principals
		WHERE workspace_id = ${actor.workspaceId}
			AND owner_user_id = ${actor.userId}
			AND kind = 'automation'
			AND name = ${principalName}
			AND status = 'active'
	`
	let agentId = existing[0]?.id
	if (!agentId) {
		const p = await insertPrincipal(tx, {
			workspaceId: actor.workspaceId,
			ownerUserId: actor.userId,
			oauthClientId: null,
			kind: 'automation',
			name: principalName,
			scopeCeiling: scopes
		})
		agentId = p.id
	}
	const { full, prefix, secretHash } = generateApiKey()
	const expiresAt =
		body.expiresInDays !== undefined ? new Date(Date.now() + body.expiresInDays * 86_400_000) : null
	const rows = await tx<ApiKeyRow[]>`
		INSERT INTO agent_api_keys (workspace_id, agent_id, created_by, name, prefix, secret_hash, scopes, expires_at)
		VALUES (${actor.workspaceId}, ${agentId}, ${actor.userId}, ${body.name}, ${prefix}, ${secretHash}, ${scopes}, ${expiresAt})
		RETURNING id, workspace_id AS "workspaceId", agent_id AS "agentId",
			created_by AS "createdBy", name, prefix, secret_hash AS "secretHash",
			scopes, expires_at AS "expiresAt", last_used_at AS "lastUsedAt",
			revoked_at AS "revokedAt", created_at AS "createdAt"
	`
	const row = rows[0]
	if (!row) throw new HttpError(500, 'internal', 'Key insert failed')
	return { ...toDto(row), key: full }
}
