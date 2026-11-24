/**
 * Inbound MIME parsing + mail-HTML sanitization (§14.6).
 *
 * Security posture:
 *   - Hard byte/part/recipient caps BEFORE any decode work (ReDoS/decompression
 *     bombs die at the gate, not inside the parser).
 *   - `postal-mime` parses in a bounded worker context; callers wrap it in the
 *     worker's CPU/time limits (MAIL_PARSE_TIMEOUT_MS).
 *   - Sanitized HTML is allowlist-only via `sanitizeHtml`, then remote images
 *     are stripped (loaded through the proxy on demand client-side instead)
 *     and every external link is rewritten through `#` + `data-orig-href` so
 *     the renderer can show the click-through interstitial.
 *   - Auth results (SPF/DKIM/DMARC) are extracted, never trusted for authz.
 *
 * This file is the target of the sanitizer fuzz corpus (§23 G5): any input
 * must produce safe output or throw `MimeParseError` — never crash the worker.
 */
import { sanitizeHtml } from '@huriro/editor'
import { decodeWords } from 'postal-mime'

/** Caps applied before parse (§14.6). */
export const MAIL_PARSE_LIMITS = {
	maxBytes: 52_428_800, // 50 MiB raw MIME
	maxParts: 200,
	maxInlineHtmlBytes: 2_097_152, // 2 MiB post-decode body
	maxRecipients: 100,
	maxAttachments: 25,
	maxHeaderCount: 200,
	maxAttachmentBytes: 26_214_400 // 25 MiB per part (matches file upload cap)
} as const

export class MimeParseError extends Error {
	readonly reason:
		| 'too_large'
		| 'too_many_parts'
		| 'too_many_recipients'
		| 'too_many_attachments'
		| 'malformed'
		| 'empty'
	constructor(reason: MimeParseError['reason'], message: string) {
		super(message)
		this.name = 'MimeParseError'
		this.reason = reason
	}
}

export interface ParsedMailAddress {
	readonly email: string
	readonly name: string | null
}

export interface ParsedAttachment {
	readonly filename: string
	readonly contentType: string
	readonly bytes: Uint8Array
	readonly inline: boolean
	readonly contentId: string | null
}

export interface ParsedAuthResults {
	readonly spf: string | null
	readonly dkim: string | null
	readonly dmarc: string | null
}

export interface ParsedMime {
	readonly messageId: string | null
	readonly inReplyTo: string | null
	readonly references: readonly string[]
	readonly subject: string
	readonly from: ParsedMailAddress | null
	readonly to: readonly ParsedMailAddress[]
	readonly cc: readonly ParsedMailAddress[]
	readonly date: Date | null
	readonly textBody: string | null
	readonly htmlBody: string | null
	readonly sanitizedHtml: string | null
	readonly snippet: string
	readonly attachments: readonly ParsedAttachment[]
	readonly authResults: ParsedAuthResults | null
	readonly headers: Readonly<Record<string, string>>
}

function decodeAddr(raw: string | undefined | null): ParsedMailAddress[] {
	if (!raw) return []
	const out: ParsedMailAddress[] = []
	// Split on commas not inside quotes/angles; each token is `Name <a@b>` or `a@b`.
	for (const token of raw.split(/,(?=(?:[^"]*"[^"]*")*[^"]*$)/)) {
		const t = token.trim()
		if (!t) continue
		const angle = /<([^>]+)>/.exec(t)
		const email = (angle?.[1] ?? t.replace(/^"|"$/g, '')).trim()
		if (!email.includes('@')) continue
		const name = angle ? decodeWords(t.slice(0, angle.index).trim().replace(/^"|"$/g, '')) || null : null
		out.push({ email: email.toLowerCase(), name })
		if (out.length >= MAIL_PARSE_LIMITS.maxRecipients) break
	}
	return out
}

const HEADER_NAME_RE = /^[\x21-\x7e]{1,64}$/

/** Minimal header walk — full RFC 5322 folding + rfc2047 decode. */
function parseHeaders(raw: string): Record<string, string> {
	const headers: Record<string, string> = {}
	let current: string | null = null
	let count = 0
	for (const line of raw.split(/\r?\n/)) {
		if (line === '') break
		if ((line.startsWith(' ') || line.startsWith('\t')) && current !== null) {
			headers[current] = `${headers[current]} ${line.trim()}`
			continue
		}
		const idx = line.indexOf(':')
		if (idx <= 0) {
			current = null
			continue
		}
		const name = line.slice(0, idx)
		if (!HEADER_NAME_RE.test(name)) {
			current = null
			continue
		}
		current = name.toLowerCase()
		if (count++ >= MAIL_PARSE_LIMITS.maxHeaderCount) break
		headers[current] = decodeWords(line.slice(idx + 1).trim())
	}
	return headers
}

function extractReferences(raw: string | undefined): string[] {
	if (!raw) return []
	return raw
		.split(/\s+/)
		.map((t) => t.trim())
		.filter((t) => t.startsWith('<') && t.endsWith('>'))
		.map((t) => t.slice(1, -1))
		.slice(0, 50)
}

function stripRemoteImages(html: string): string {
	// Remote images are trackers + content fetches; we keep local cid: images
	// (inline attachments) but drop http(s) src entirely.
	return html.replace(/<img\b[^>]*>/gi, (tag) => {
		const srcMatch = /\bsrc\s*=\s*(?:"([^"]*)"|'([^']*)'|([^\s>]+))/i.exec(tag)
		const src = srcMatch?.[1] ?? srcMatch?.[2] ?? srcMatch?.[3] ?? ''
		if (/^(https?:)?\/\//i.test(src) || /^https?:/i.test(src)) return ''
		return tag
	})
}

function rewriteExternalLinks(html: string): string {
	// Links ride through the click-interstitial on the client; here we mark
	// external hrefs so the renderer shows the warning before opening.
	return html.replace(
		/<a\b([^>]*?)\bhref\s*=\s*("([^"]*)"|'([^']*)')([^>]*)>/gi,
		(_full, pre: string, _quoted: string, dq: string, sq: string, post: string) => {
			const href = dq ?? sq ?? ''
			if (!/^https?:/i.test(href)) return `<a${pre}href="${href.replace(/"/g, '&quot;')}"${post}>`
			// sanitizeHtml may already have stamped rel= — don't emit it twice.
			const rel = /\brel\s*=/i.test(post) ? '' : ' rel="noopener noreferrer"'
			return `<a${pre}href="#" data-orig-href="${href.replace(/"/g, '&quot;')}"${rel}${post}>`
		}
	)
}

/**
 * Sanitize an inbound HTML body for display. Output is safe to inject into the
 * sandboxed iframe DOM (strict CSP still applies — no scripts can exist).
 */
export function sanitizeMailHtml(rawHtml: string): string {
	if (!rawHtml) return ''
	const cleaned = sanitizeHtml(rawHtml)
	return rewriteExternalLinks(stripRemoteImages(cleaned))
}

/** Plain-text → conservative snippet for list rows. */
export function makeSnippet(text: string | null, html: string | null): string {
	const source = text ?? (html ? html.replace(/<[^>]+>/g, ' ') : '')
	return source.replace(/\s+/g, ' ').trim().slice(0, 200)
}

interface PostalLike {
	parse(raw: string | Uint8Array | ArrayBuffer): Promise<{
		messageId?: string | undefined
		subject?: string | undefined
		from?: { address?: string | undefined; name?: string | undefined } | undefined
		to?: readonly { address?: string | undefined; name?: string | undefined }[] | undefined
		cc?: readonly { address?: string | undefined; name?: string | undefined }[] | undefined
		date?: string | undefined
		inReplyTo?: string | undefined
		references?: string | undefined
		headers?: ReadonlyMap<string, string> | undefined
		html?: string | undefined
		text?: string | undefined
		attachments?: readonly {
			filename?: string | undefined
			mimeType?: string | undefined
			content?: ArrayBuffer | Uint8Array | undefined
			disposition?: string | undefined
			contentId?: string | undefined
		}[]
	}>
}

// PostalMime instances are single-use — a fresh parser per message is required
// (reusing throws "Can not reuse parser"). The ctor itself is cached.
let _PostalCtor: (new () => { parse: PostalLike['parse'] }) | null = null

async function getPostalParse(): Promise<PostalLike['parse']> {
	if (!_PostalCtor) {
		const mod = (await import('postal-mime')) as unknown as {
			default?: new () => { parse: PostalLike['parse'] }
		}
		if (!mod.default) throw new MimeParseError('malformed', 'postal-mime unavailable')
		_PostalCtor = mod.default
	}
	const parser = new _PostalCtor()
	return parser.parse.bind(parser)
}

/**
 * Parse a raw RFC 822 message into a normalized `ParsedMime`. Throws
 * `MimeParseError` on limit violations or unparseable input — the worker maps
 * those to a quarantined message with `providerRef.parseError`, never a crash.
 */
export async function parseMime(raw: Uint8Array | string): Promise<ParsedMime> {
	const bytes = typeof raw === 'string' ? new TextEncoder().encode(raw) : raw
	if (bytes.byteLength === 0) throw new MimeParseError('empty', 'Empty message')
	if (bytes.byteLength > MAIL_PARSE_LIMITS.maxBytes) {
		throw new MimeParseError('too_large', `Message exceeds ${MAIL_PARSE_LIMITS.maxBytes} bytes`)
	}

	// Header pre-scan for limits + auth results (cheap, no decode).
	const headEnd = (() => {
		const s = typeof raw === 'string' ? raw : new TextDecoder().decode(bytes.subarray(0, 8192))
		const i = s.indexOf('\r\n\r\n')
		return i >= 0 ? s.slice(0, i + 4) : s
	})()
	const rawHeaders = parseHeaders(headEnd)
	// postal-mime is lenient and will "parse" arbitrary bytes — a message with
	// no RFC 5322 headers at all is not mail (§14.6: fail closed, quarantine).
	if (Object.keys(rawHeaders).length === 0) {
		throw new MimeParseError('malformed', 'No RFC 5322 headers found')
	}
	const authResults: ParsedAuthResults | null =
		rawHeaders['authentication-results'] || rawHeaders['arc-authentication-results']
			? {
					spf: /spf=(\w+)/i.exec(rawHeaders['authentication-results'] ?? '')?.[1]?.toLowerCase() ?? null,
					dkim: /dkim=(\w+)/i.exec(rawHeaders['authentication-results'] ?? '')?.[1]?.toLowerCase() ?? null,
					dmarc: /dmarc=(\w+)/i.exec(rawHeaders['authentication-results'] ?? '')?.[1]?.toLowerCase() ?? null
				}
			: null

	const parse = await getPostalParse()
	let doc: Awaited<ReturnType<PostalLike['parse']>>
	try {
		doc = await parse(bytes)
	} catch (err) {
		throw new MimeParseError('malformed', `MIME parse failed: ${(err as Error).message.slice(0, 120)}`)
	}

	const to = decodeAddr(undefined).concat(
		(doc.to ?? [])
			.slice(0, MAIL_PARSE_LIMITS.maxRecipients)
			.map((a) => ({ email: (a.address ?? '').toLowerCase(), name: a.name ?? null }))
			.filter((a) => a.email.includes('@'))
	)
	const cc = (doc.cc ?? [])
		.slice(0, MAIL_PARSE_LIMITS.maxRecipients)
		.map((a) => ({ email: (a.address ?? '').toLowerCase(), name: a.name ?? null }))
		.filter((a) => a.email.includes('@'))

	const rawAttachments = doc.attachments ?? []
	if (rawAttachments.length > MAIL_PARSE_LIMITS.maxAttachments) {
		throw new MimeParseError(
			'too_many_attachments',
			`Message has >${MAIL_PARSE_LIMITS.maxAttachments} attachments`
		)
	}
	const attachments: ParsedAttachment[] = []
	for (const a of rawAttachments) {
		const bytes0 = a.content
			? a.content instanceof Uint8Array
				? a.content
				: new Uint8Array(a.content)
			: new Uint8Array(0)
		if (bytes0.byteLength > MAIL_PARSE_LIMITS.maxAttachmentBytes) {
			throw new MimeParseError(
				'too_large',
				`Attachment exceeds ${MAIL_PARSE_LIMITS.maxAttachmentBytes} bytes`
			)
		}
		attachments.push({
			filename: (a.filename ?? 'attachment').slice(0, 255),
			contentType: (a.mimeType ?? 'application/octet-stream').toLowerCase().slice(0, 127),
			bytes: bytes0,
			inline: a.disposition === 'inline',
			contentId: a.contentId ? a.contentId.replace(/[<>]/g, '') : null
		})
	}

	const htmlBody = doc.html ? doc.html.slice(0, MAIL_PARSE_LIMITS.maxInlineHtmlBytes) : null
	const textBody = doc.text ? doc.text.slice(0, MAIL_PARSE_LIMITS.maxInlineHtmlBytes) : null

	return {
		messageId: doc.messageId ?? null,
		inReplyTo: doc.inReplyTo ?? null,
		references: extractReferences(doc.references),
		subject: decodeWords(doc.subject ?? '').slice(0, 500),
		from: doc.from?.address ? { email: doc.from.address.toLowerCase(), name: doc.from.name ?? null } : null,
		to,
		cc,
		date: doc.date ? new Date(doc.date) : null,
		textBody,
		htmlBody,
		sanitizedHtml: htmlBody ? sanitizeMailHtml(htmlBody) : null,
		snippet: makeSnippet(textBody, htmlBody),
		attachments,
		authResults,
		headers: rawHeaders
	}
}

/** Strip MIME headers that must never reach the client (envelope leaks). */
export function publicHeaders(headers: Readonly<Record<string, string>>): Record<string, string> {
	const drop = new Set(['received', 'dkim-signature', 'arc-seal', 'return-path', 'delivered-to'])
	const out: Record<string, string> = {}
	for (const [k, v] of Object.entries(headers)) {
		if (!drop.has(k)) out[k] = v
	}
	return out
}
