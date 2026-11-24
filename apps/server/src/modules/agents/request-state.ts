/**
 * HMAC-SHA256-signed MRTR requestState (§13.5, MCP 2026-07-28 MRTR).
 * requestState travels through the client and returns attacker-controlled:
 * every retry re-verifies signature, expiry, and the bound principal/tool/
 * argsHash before the dispatcher is allowed to execute (spec: the server
 * MUST integrity-protect state it acts on).
 */
import { createHmac, timingSafeEqual } from 'node:crypto'

const TTL_MS = 10 * 60 * 1000 // 10 minutes

export interface ConfirmationState {
	readonly principalId: string
	readonly tool: string
	readonly argsHash: string
	readonly issuedAt: number
}

function b64u(buf: Buffer | string): string {
	return Buffer.from(buf).toString('base64url')
}

export function mintRequestState(secret: string, state: Omit<ConfirmationState, 'issuedAt'>): string {
	const payload = b64u(JSON.stringify({ ...state, issuedAt: Date.now() }))
	const sig = createHmac('sha256', secret).update(payload).digest('base64url')
	return `${payload}.${sig}`
}

/**
 * Verify signature + 10-min expiry. Returns the decoded state or null —
 * callers treat null as a refusal (`confirmation_invalid`), never a retry.
 */
export function verifyRequestState(secret: string, raw: string): ConfirmationState | null {
	const [payload, sig] = raw.split('.')
	if (!payload || !sig) return null
	const expected = createHmac('sha256', secret).update(payload).digest('base64url')
	const a = Buffer.from(sig)
	const b = Buffer.from(expected)
	if (a.length !== b.length || !timingSafeEqual(a, b)) return null
	try {
		const decoded = JSON.parse(Buffer.from(payload, 'base64url').toString('utf8')) as ConfirmationState
		if (
			typeof decoded.principalId !== 'string' ||
			typeof decoded.tool !== 'string' ||
			typeof decoded.argsHash !== 'string' ||
			typeof decoded.issuedAt !== 'number'
		) {
			return null
		}
		if (Date.now() - decoded.issuedAt > TTL_MS) return null
		return decoded
	} catch {
		return null
	}
}
