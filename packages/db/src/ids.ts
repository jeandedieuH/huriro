/**
 * uuidv7 id rules (§8.1): server generates via `uuidv7()`; client-supplied ids
 * are accepted only if version 7 and within ±24 h of server time (or of the
 * queued mutation's timestamp for offline replays).
 */

const UUID_V7_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-7[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i

export function isUuidV7(id: string): boolean {
	return UUID_V7_RE.test(id)
}

export function isUuid(id: string): boolean {
	return /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(id)
}

/** Milliseconds since epoch encoded in a v7 uuid's first 48 bits. */
export function uuid7TimestampMs(id: string): number | null {
	if (!isUuidV7(id)) return null
	const hex = id.replace(/-/g, '').slice(0, 12)
	return Number.parseInt(hex, 16)
}

/**
 * Client-side uuidv7 generator (§8.1) — mirrors the DB `uuidv7()`: 48-bit
 * unix-ms timestamp, version 7, variant 10xx, rest random. Used by
 * better-auth's `generateId` so auth-created rows keep the platform's id shape.
 */
export function uuid7(nowMs: number = Date.now()): string {
	const bytes = new Uint8Array(16)
	crypto.getRandomValues(bytes)
	const ts = BigInt(nowMs) & 0xffffffffffffn
	for (let i = 0; i < 6; i++) bytes[i] = Number((ts >> BigInt(8 * (5 - i))) & 0xffn)
	bytes[6] = (bytes[6]! & 0x0f) | 0x70
	bytes[8] = (bytes[8]! & 0x3f) | 0x80
	const hex = [...bytes].map((b) => b.toString(16).padStart(2, '0')).join('')
	return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20)}`
}

const SKEW_MS = 24 * 60 * 60 * 1000

/**
 * Validate a client-supplied id (§8.1). `referenceMs` defaults to now; offline
 * replays pass the queued-at timestamp instead.
 */
export function isAcceptableClientId(id: string, referenceMs: number = Date.now()): boolean {
	const ts = uuid7TimestampMs(id)
	return ts !== null && Math.abs(ts - referenceMs) <= SKEW_MS
}
