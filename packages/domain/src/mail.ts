/**
 * Mail threading & normalization helpers (§14.4) — pure, no I/O.
 *
 * Threading follows the RFC 8621 §3 heuristic: messages join a conversation
 * when they share a `Message-Id` link across `In-Reply-To`/`References` AND
 * have an equivalent normalized subject. Ambiguity resolves to "new
 * conversation" rather than attaching to the wrong customer.
 */

const RE_FWD_PREFIX = /^\s*(?:(?:re|fw|fwd|aw|sv|wg|odp|答复|转发)\s*:\s*|\[(?:re|fw|fwd)\]\s*:\s*)+/i

/** Strip reply/forward prefixes, list tags and noise so threading keys match. */
export function normalizeMailSubject(raw: string | null | undefined): string {
	if (!raw) return ''
	let s = raw
		.replace(/<[^>]*>/g, '')
		.replace(/\[[^\]]*\]/g, (m) => (/^\[(?:re|fw|fwd)\]/i.test(m) ? m : ' '))
		.replace(RE_FWD_PREFIX, '')
	// Some mailers repeat prefixes ("Re: Fwd: Re:") — strip until stable.
	for (let i = 0; i < 5; i++) {
		const next = s.replace(RE_FWD_PREFIX, '')
		if (next === s) break
		s = next
	}
	return s.replace(/\s+/g, ' ').trim().toLowerCase()
}

/** Canonical email form for matching (lowercase, trimmed). */
export function normalizeEmail(raw: string | null | undefined): string {
	return (raw ?? '').trim().toLowerCase()
}

/**
 * Decide whether a candidate inbound message joins an existing conversation.
 * `candidates` are previously-seen messages in the same account: a match needs
 * a shared Message-Id link AND equal normalized subjects (§14.4).
 */
export function threadingKeyMatches(
	a: { readonly normalizedSubject: string },
	b: { readonly normalizedSubject: string }
): boolean {
	return a.normalizedSubject !== '' && a.normalizedSubject === b.normalizedSubject
}

/** RFC 5322 addr-spec sanity check (deliberately conservative). */
export function isPlausibleEmail(raw: string): boolean {
	if (raw.length > 320) return false
	const at = raw.lastIndexOf('@')
	if (at <= 0 || at === raw.length - 1) return false
	const local = raw.slice(0, at)
	const domain = raw.slice(at + 1)
	if (local.length > 64 || domain.length > 253) return false
	return /^[^\s@<>(),;:\\[\]"]+$/.test(local) && /^[a-zA-Z0-9.-]+\.[a-zA-Z]{2,}$/.test(domain)
}
