/**
 * Pure chat, notification quiet-hours, and webhook backoff helpers (§15.1, §15.2, §16.5).
 * Zero I/O, zero workspace imports, deterministic.
 */

export interface ExtractedChatMentions {
	readonly handles: readonly string[]
	readonly mentionChannel: boolean
	readonly mentionHere: boolean
}

export interface ExtractedRichLink {
	readonly kind: 'issue' | 'doc_page' | 'conversation'
	readonly ref: string
	readonly raw: string
}

const HANDLE_RE = /(?:^|[\s(])@([a-zA-Z0-9._+-]+@[a-zA-Z0-9.-]+\.[a-zA-Z]{2,}|[a-zA-Z0-9._-]{2,})/g
const URL_RE = /https?:\/\/[^\s<>"')`]+/gi
const RICH_ISSUE_RE = /(?:issue:|\/tasks\/issues\/)([A-Z][A-Z0-9]{1,9}-\d+)\b/gi
const RICH_DOC_RE = /(?:doc:|\/docs\/)([a-z0-9][a-z0-9-]{0,120})\b/gi
const RICH_CONV_RE = /\bconversation:([a-zA-Z0-9_-]{3,80})\b/gi

/** Extract @handle mentions plus @channel / @here broadcast triggers. */
export function extractChatMentions(text: string): ExtractedChatMentions {
	const handles = new Set<string>()
	let mentionChannel = false
	let mentionHere = false
	for (const match of text.matchAll(HANDLE_RE)) {
		const raw = match[1]?.toLowerCase()
		if (!raw) continue
		if (raw === 'channel') {
			mentionChannel = true
		} else if (raw === 'here') {
			mentionHere = true
		} else {
			handles.add(raw)
		}
	}
	return {
		handles: [...handles],
		mentionChannel,
		mentionHere
	}
}

/** Extract deduped http/https URLs from message text (capped at 5 per §15.1). */
export function extractUrls(text: string, maxUrls = 5): string[] {
	const seen = new Set<string>()
	const out: string[] = []
	for (const match of text.matchAll(URL_RE)) {
		let candidate = match[0] ?? ''
		candidate = candidate.replace(/[.,;:!?]+$/, '')
		if (!candidate) continue
		try {
			const parsed = new URL(candidate)
			if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') continue
			const normalized = parsed.toString()
			if (seen.has(normalized)) continue
			seen.add(normalized)
			out.push(normalized)
			if (out.length >= maxUrls) break
		} catch {
			// Skip malformed URLs
		}
	}
	return out
}

/** Extract typed inline rich links (`issue:KEY-1`, `doc:slug`, `conversation:id`). */
export function extractRichLinks(text: string, maxLinks = 10): ExtractedRichLink[] {
	const seen = new Set<string>()
	const links: ExtractedRichLink[] = []

	for (const m of text.matchAll(RICH_ISSUE_RE)) {
		const ref = (m[1] ?? '').toUpperCase()
		if (!ref) continue
		const key = `issue:${ref}`
		if (!seen.has(key)) {
			seen.add(key)
			links.push({ kind: 'issue', ref, raw: m[0] ?? key })
		}
		if (links.length >= maxLinks) return links
	}

	for (const m of text.matchAll(RICH_DOC_RE)) {
		const ref = (m[1] ?? '').toLowerCase()
		if (!ref) continue
		const key = `doc_page:${ref}`
		if (!seen.has(key)) {
			seen.add(key)
			links.push({ kind: 'doc_page', ref, raw: m[0] ?? key })
		}
		if (links.length >= maxLinks) return links
	}

	for (const m of text.matchAll(RICH_CONV_RE)) {
		const ref = m[1] ?? ''
		if (!ref) continue
		const key = `conversation:${ref}`
		if (!seen.has(key)) {
			seen.add(key)
			links.push({ kind: 'conversation', ref, raw: m[0] ?? key })
		}
		if (links.length >= maxLinks) return links
	}

	return links
}

/** Canonical dedupe key for 2–8 member DMs (§15.1). */
export function computeDmKey(memberIds: readonly string[]): string {
	const unique = [...new Set(memberIds.map((id) => id.trim().toLowerCase()).filter((id) => id.length > 0))]
	unique.sort((a, b) => (a < b ? -1 : a > b ? 1 : 0))
	return unique.join(':')
}

function parseHHMM(raw: string | null | undefined): number | null {
	if (!raw) return null
	const m = /^(\d{2}):(\d{2})$/.exec(raw.trim())
	if (!m) return null
	const hh = Number.parseInt(m[1] ?? '', 10)
	const mm = Number.parseInt(m[2] ?? '', 10)
	if (hh < 0 || hh > 23 || mm < 0 || mm > 59) return null
	return hh * 60 + mm
}

function localMinutesOfDay(nowUtcIso: string, timezone: string): number {
	const date = new Date(nowUtcIso)
	if (Number.isNaN(date.getTime())) return 0
	let tz = timezone || 'UTC'
	try {
		const fmt = new Intl.DateTimeFormat('en-GB', {
			timeZone: tz,
			hour: '2-digit',
			minute: '2-digit',
			hourCycle: 'h23'
		})
		const parts = fmt.formatToParts(date)
		const hour = Number.parseInt(parts.find((p) => p.type === 'hour')?.value ?? '0', 10)
		const minute = Number.parseInt(parts.find((p) => p.type === 'minute')?.value ?? '0', 10)
		return (hour % 24) * 60 + (minute % 60)
	} catch {
		tz = 'UTC'
		return date.getUTCHours() * 60 + date.getUTCMinutes()
	}
}

/**
 * Pure quiet-hours check handling same-day (`09:00`–`17:00`) and overnight
 * (`22:00`–`07:00`) windows in the user's configured IANA timezone (§15.2).
 */
export function isWithinQuietHours(
	nowUtcIso: string,
	startHHMM: string | null | undefined,
	endHHMM: string | null | undefined,
	timezone: string
): boolean {
	const start = parseHHMM(startHHMM)
	const end = parseHHMM(endHHMM)
	if (start === null || end === null || start === end) return false
	const current = localMinutesOfDay(nowUtcIso, timezone)
	if (start < end) {
		return current >= start && current < end
	}
	// Overnight window: e.g. 22:00 -> 07:00
	return current >= start || current < end
}

const WEBHOOK_BACKOFF_SCHEDULE_MS = [
	30_000, // 30s
	120_000, // 2m
	600_000, // 10m
	1_800_000, // 30m
	7_200_000, // 2h
	21_600_000, // 6h
	54_000_000 // 15h (~24h total)
] as const

/** Exponential backoff over a 24h retry window (§16.5). Returns null when exhausted. */
export function computeWebhookBackoffMs(attemptsDone: number, maxAttempts = 8): number | null {
	if (attemptsDone >= maxAttempts) return null
	const idx = Math.max(0, Math.min(attemptsDone - 1, WEBHOOK_BACKOFF_SCHEDULE_MS.length - 1))
	return WEBHOOK_BACKOFF_SCHEDULE_MS[idx] ?? null
}
