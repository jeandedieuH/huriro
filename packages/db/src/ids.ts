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

const SKEW_MS = 24 * 60 * 60 * 1000

/**
 * Validate a client-supplied id (§8.1). `referenceMs` defaults to now; offline
 * replays pass the queued-at timestamp instead.
 */
export function isAcceptableClientId(id: string, referenceMs: number = Date.now()): boolean {
	const ts = uuid7TimestampMs(id)
	return ts !== null && Math.abs(ts - referenceMs) <= SKEW_MS
}
