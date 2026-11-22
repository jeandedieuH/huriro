/**
 * Strict URL and HTML sanitization for collaborative docs and Markdown imports (§12.6).
 * Pure TS/JS — executes identically on Bun server and in browsers without DOM dependencies.
 */

const SAFE_SCHEMES = new Set(['http:', 'https:', 'mailto:'])

const DANGEROUS_CONTAINER_TAGS = new Set([
	'script',
	'style',
	'iframe',
	'object',
	'embed',
	'svg',
	'math',
	'noscript',
	'template'
])

const ALLOWED_TAGS = new Set([
	'p',
	'br',
	'h1',
	'h2',
	'h3',
	'h4',
	'h5',
	'h6',
	'strong',
	'b',
	'em',
	'i',
	'u',
	's',
	'del',
	'code',
	'pre',
	'blockquote',
	'ul',
	'ol',
	'li',
	'a',
	'table',
	'thead',
	'tbody',
	'tr',
	'th',
	'td',
	'hr',
	'details',
	'summary',
	'span',
	'div',
	'img'
])

const VOID_TAGS = new Set(['br', 'hr', 'img'])

const GLOBAL_ATTRS = new Set([
	'data-block-id',
	'data-callout-tone',
	'data-toggle',
	'data-comment-id',
	'data-comment-resolved',
	'data-entity-type',
	'data-entity-id',
	'class',
	'id'
])

const TAG_ATTRS: Record<string, ReadonlySet<string>> = {
	a: new Set(['href', 'title']),
	img: new Set(['src', 'alt', 'title']),
	th: new Set(['colspan', 'rowspan', 'align']),
	td: new Set(['colspan', 'rowspan', 'align']),
	details: new Set(['open'])
}

function decodeHtmlEntities(input: string): string {
	return input
		.replace(/&#(\d+);?/g, (_, dec) => {
			const code = Number.parseInt(dec, 10)
			return Number.isFinite(code) && code > 0 ? String.fromCodePoint(code) : ''
		})
		.replace(/&#x([0-9a-f]+);?/gi, (_, hex) => {
			const code = Number.parseInt(hex, 16)
			return Number.isFinite(code) && code > 0 ? String.fromCodePoint(code) : ''
		})
		.replace(/&colon;/gi, ':')
		.replace(/&newline;/gi, '\n')
		.replace(/&tab;/gi, '\t')
		.replace(/&amp;/gi, '&')
}

export function isSafeUrl(rawUrl: string): boolean {
	if (typeof rawUrl !== 'string') return false
	const decoded = decodeHtmlEntities(rawUrl)
	// biome-ignore lint/suspicious/noControlCharactersInRegex: intentionally strip ASCII control bytes
	const stripped = decoded.replace(/[\u0000-\u0020\u007F]+/g, '').trim()
	if (stripped.length === 0) return false
	if (stripped.startsWith('#')) return true
	if (stripped.startsWith('/') && !stripped.startsWith('//')) return true
	if (stripped.startsWith('./') || stripped.startsWith('../')) return true

	const colonIdx = stripped.indexOf(':')
	const slashIdx = stripped.indexOf('/')
	const queryIdx = stripped.indexOf('?')
	const hashIdx = stripped.indexOf('#')
	const firstDelim = [slashIdx, queryIdx, hashIdx]
		.filter((n) => n >= 0)
		.reduce((a, b) => Math.min(a, b), Number.POSITIVE_INFINITY)

	// Relative path without explicit scheme.
	if (colonIdx === -1 || colonIdx > firstDelim) {
		return !stripped.startsWith('//')
	}

	const scheme = stripped.slice(0, colonIdx + 1).toLowerCase()
	if (!SAFE_SCHEMES.has(scheme)) return false
	try {
		const parsed = new URL(stripped)
		return SAFE_SCHEMES.has(parsed.protocol.toLowerCase())
	} catch {
		return false
	}
}

function escapeAttr(val: string): string {
	return val.replace(/&/g, '&amp;').replace(/"/g, '&quot;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
}

function sanitizeAttributes(tag: string, rawAttrs: string): string {
	const allowedForTag = TAG_ATTRS[tag]
	const out: string[] = []
	let hasExternalHref = false

	const attrRe = /([a-zA-Z_:][a-zA-Z0-9_.:-]*)(?:\s*=\s*(?:"([^"]*)"|'([^']*)'|([^\s"'=<>`]+)))?/g
	let match = attrRe.exec(rawAttrs)
	while (match !== null) {
		const attrName = (match[1] ?? '').toLowerCase()
		const attrVal = match[2] ?? match[3] ?? match[4] ?? ''
		match = attrRe.exec(rawAttrs)

		if (attrName.startsWith('on') || attrName === 'style' || attrName === 'srcdoc') {
			continue
		}
		if (!GLOBAL_ATTRS.has(attrName) && !allowedForTag?.has(attrName)) {
			continue
		}

		if (attrName === 'href' || attrName === 'src') {
			if (!isSafeUrl(attrVal)) continue
			if (attrName === 'href' && /^https?:/i.test(attrVal.trim())) {
				hasExternalHref = true
			}
			out.push(`${attrName}="${escapeAttr(attrVal.trim())}"`)
			continue
		}

		if (attrName === 'class' || attrName === 'id' || attrName === 'data-block-id') {
			const clean = attrVal.replace(/[^a-zA-Z0-9 _-]/g, '').trim()
			if (clean) out.push(`${attrName}="${escapeAttr(clean)}"`)
			continue
		}

		if (attrName === 'colspan' || attrName === 'rowspan') {
			const n = Number.parseInt(attrVal, 10)
			if (Number.isInteger(n) && n >= 1 && n <= 100) out.push(`${attrName}="${n}"`)
			continue
		}

		if (attrName === 'align') {
			const v = attrVal.toLowerCase().trim()
			if (v === 'left' || v === 'center' || v === 'right') out.push(`align="${v}"`)
			continue
		}

		if (attrName === 'open') {
			out.push('open=""')
			continue
		}

		out.push(`${attrName}="${escapeAttr(attrVal)}"`)
	}

	if (tag === 'a' && hasExternalHref) {
		out.push('rel="noopener noreferrer"')
	}
	return out.length > 0 ? ` ${out.join(' ')}` : ''
}

export function sanitizeHtml(html: string): string {
	if (!html) return ''
	// 1. Strip HTML comments.
	let cleaned = html.replace(/<!--[\s\S]*?-->/g, '')

	// 2. Drop dangerous container tags together with their body (loop handles nesting).
	let prev = ''
	while (prev !== cleaned) {
		prev = cleaned
		for (const tag of DANGEROUS_CONTAINER_TAGS) {
			const pairRe = new RegExp(`<${tag}\\b[^>]*>[\\s\\S]*?<\\/${tag}\\s*>`, 'gi')
			cleaned = cleaned.replace(pairRe, '')
			const openRe = new RegExp(`<\\/?${tag}\\b[^>]*>`, 'gi')
			cleaned = cleaned.replace(openRe, '')
		}
	}

	// 3. Filter remaining tags against allowlist & attribute allowlist.
	return cleaned.replace(
		/<(\/?)([a-zA-Z0-9-]+)([^>]*)>/g,
		(_full, slash: string, rawTag: string, rawAttrs: string) => {
			const tag = rawTag.toLowerCase()
			if (!ALLOWED_TAGS.has(tag)) return ''
			if (slash === '/') {
				return VOID_TAGS.has(tag) ? '' : `</${tag}>`
			}
			const attrs = sanitizeAttributes(tag, rawAttrs)
			return `<${tag}${attrs}>`
		}
	)
}
