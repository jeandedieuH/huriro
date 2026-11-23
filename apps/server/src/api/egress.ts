/**
 * SSRF-safe outbound HTTP client (§12.6).
 *
 * Used by BOTH link preview unfurling and outbound webhook delivery:
 *   - http/https only; credentials in URL rejected
 *   - DNS resolved once per hop; blocks private, loopback, link-local,
 *     CGNAT, multicast, metadata (169.254.169.254), and IPv6 ULA/mapped ranges
 *   - At most 3 redirects, each re-validated before following
 *   - Bounded timeout and streamed response byte limit
 */
import { lookup } from 'node:dns/promises'
import { isIP } from 'node:net'

export interface ResolvedAddress {
	readonly address: string
	readonly family: number
}

export type DnsResolver = (hostname: string) => Promise<readonly ResolvedAddress[]>

export interface SafeEgressOptions {
	readonly method?: 'GET' | 'POST' | 'PATCH' | 'PUT' | 'DELETE' | 'HEAD'
	readonly headers?: Record<string, string>
	readonly body?: string | Uint8Array
	readonly timeoutMs?: number
	readonly maxBytes?: number
	readonly maxRedirects?: number
	readonly resolver?: DnsResolver
	readonly fetcher?: typeof fetch
}

export interface SafeEgressResponse {
	readonly status: number
	readonly headers: Headers
	readonly bodyBytes: Uint8Array
	readonly finalUrl: string
}

export class SsrfBlockedError extends Error {
	constructor(message: string) {
		super(message)
		this.name = 'SsrfBlockedError'
	}
}

const BLOCKED_HOSTNAMES = new Set([
	'localhost',
	'localhost.localdomain',
	'metadata.google.internal',
	'metadata',
	'ip6-localhost',
	'ip6-loopback'
])

function ipv4ToInt(ip: string): number | null {
	const parts = ip.split('.')
	if (parts.length !== 4) return null
	let out = 0
	for (const part of parts) {
		if (!/^\d{1,3}$/.test(part)) return null
		const n = Number.parseInt(part, 10)
		if (n < 0 || n > 255) return null
		out = (out << 8) | n
	}
	return out >>> 0
}

function isBlockedIpv4Int(n: number): boolean {
	const a = (n >>> 24) & 0xff
	const b = (n >>> 16) & 0xff
	const c = (n >>> 8) & 0xff

	if (a === 0) return true // 0.0.0.0/8 unspecified
	if (a === 10) return true // 10.0.0.0/8 RFC 1918
	if (a === 100 && b >= 64 && b <= 127) return true // 100.64.0.0/10 CGNAT
	if (a === 127) return true // 127.0.0.0/8 loopback
	if (a === 169 && b === 254) return true // 169.254.0.0/16 link-local & cloud metadata
	if (a === 172 && b >= 16 && b <= 31) return true // 172.16.0.0/12 RFC 1918
	if (a === 192 && b === 0 && c === 0) return true // 192.0.0.0/24
	if (a === 192 && b === 0 && c === 2) return true // 192.0.2.0/24 TEST-NET-1
	if (a === 192 && b === 168) return true // 192.168.0.0/16 RFC 1918
	if (a === 198 && (b === 18 || b === 19)) return true // 198.18.0.0/15 benchmark
	if (a === 198 && b === 51 && c === 100) return true // 198.51.100.0/24 TEST-NET-2
	if (a === 203 && b === 0 && c === 113) return true // 203.0.113.0/24 TEST-NET-3
	if (a >= 224) return true // multicast (224.0.0.0/4) + reserved/broadcast (240.0.0.0/4)
	return false
}

function parseIpv6ToBigInt(rawIp: string): bigint | null {
	const zoneIdx = rawIp.indexOf('%')
	const ip = zoneIdx >= 0 ? rawIp.slice(0, zoneIdx) : rawIp
	if (!ip.includes(':')) return null

	// Handle embedded IPv4 tail (e.g. ::ffff:127.0.0.1)
	const lastColon = ip.lastIndexOf(':')
	const tail = ip.slice(lastColon + 1)
	let normalized = ip
	if (tail.includes('.')) {
		const v4 = ipv4ToInt(tail)
		if (v4 === null) return null
		const hi = ((v4 >>> 16) & 0xffff).toString(16)
		const lo = (v4 & 0xffff).toString(16)
		normalized = `${ip.slice(0, lastColon)}:${hi}:${lo}`
	}

	const halves = normalized.split('::')
	if (halves.length > 2) return null

	const left = halves[0] ? halves[0].split(':').filter((s) => s.length > 0) : []
	const right = halves.length === 2 && halves[1] ? halves[1].split(':').filter((s) => s.length > 0) : []
	const missing = 8 - (left.length + right.length)
	if (halves.length === 1 && missing !== 0) return null
	if (halves.length === 2 && missing < 1) return null

	const groups = [...left, ...Array<string>(Math.max(0, missing)).fill('0'), ...right]
	if (groups.length !== 8) return null

	let value = 0n
	for (const g of groups) {
		if (!/^[0-9a-fA-F]{1,4}$/.test(g)) return null
		value = (value << 16n) | BigInt(Number.parseInt(g, 16))
	}
	return value
}

/** True when `rawIp` falls inside any non-public / internal / reserved network. */
export function isBlockedIp(rawIp: string): boolean {
	const cleaned = rawIp.trim().replace(/^\[|\]$/g, '')
	const version = isIP(cleaned)
	if (version === 4) {
		const n = ipv4ToInt(cleaned)
		return n === null || isBlockedIpv4Int(n)
	}
	if (version === 6) {
		const v6 = parseIpv6ToBigInt(cleaned)
		if (v6 === null) return true
		if (v6 === 0n || v6 === 1n) return true // :: unspecified, ::1 loopback
		// IPv4-mapped ::ffff:0:0/96
		const v4MappedPrefix = 0xffffn << 32n
		if (v6 >> 32n === 0xffffn) {
			return isBlockedIpv4Int(Number(v6 - v4MappedPrefix))
		}
		// IPv4-compatible ::/96
		if (v6 >> 32n === 0n) {
			return isBlockedIpv4Int(Number(v6 & 0xffffffffn))
		}
		// 64:ff9b::/96 NAT64
		if (v6 >> 32n === 0x0064ff9b0000000000000000n) {
			return isBlockedIpv4Int(Number(v6 & 0xffffffffn))
		}
		const firstHextet = Number((v6 >> 112n) & 0xffffn)
		const firstByte = (firstHextet >>> 8) & 0xff
		if (v6 >> 64n === 0x0100000000000000n) return true // 100::/64 discard
		if ((firstByte & 0xfe) === 0xfc) return true // fc00::/7 ULA private
		if ((firstHextet & 0xffc0) === 0xfe80) return true // fe80::/10 link-local
		if ((firstHextet & 0xffc0) === 0xfec0) return true // fec0::/10 site-local
		if (firstByte === 0xff) return true // ff00::/8 multicast
		return false
	}
	return true
}

const defaultResolver: DnsResolver = async (hostname) => {
	const results = await lookup(hostname, { all: true, verbatim: true })
	return results.map((r) => ({ address: r.address, family: r.family }))
}

export async function validateAndResolveEgressUrl(
	rawUrl: string,
	resolver: DnsResolver = defaultResolver
): Promise<{ readonly cleanUrl: string; readonly resolved: ResolvedAddress }> {
	let parsed: URL
	try {
		parsed = new URL(rawUrl)
	} catch {
		throw new SsrfBlockedError('Malformed egress URL')
	}

	if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') {
		throw new SsrfBlockedError(`Rejected non-HTTP(S) scheme "${parsed.protocol}"`)
	}
	if (parsed.username || parsed.password) {
		throw new SsrfBlockedError('URL credentials are not allowed')
	}

	const rawHost = parsed.hostname.replace(/^\[|\]$/g, '').toLowerCase()
	if (!rawHost) {
		throw new SsrfBlockedError('Missing hostname')
	}
	if (
		BLOCKED_HOSTNAMES.has(rawHost) ||
		rawHost.endsWith('.localhost') ||
		rawHost.endsWith('.local') ||
		rawHost.endsWith('.internal')
	) {
		throw new SsrfBlockedError(`Blocked internal hostname "${rawHost}"`)
	}

	if (isIP(rawHost) !== 0) {
		if (isBlockedIp(rawHost)) {
			throw new SsrfBlockedError(`Blocked private or reserved IP "${rawHost}"`)
		}
		return {
			cleanUrl: parsed.toString(),
			resolved: { address: rawHost, family: isIP(rawHost) }
		}
	}

	let resolvedList: readonly ResolvedAddress[]
	try {
		resolvedList = await resolver(rawHost)
	} catch {
		throw new SsrfBlockedError(`DNS resolution failed for "${rawHost}"`)
	}
	if (resolvedList.length === 0) {
		throw new SsrfBlockedError(`DNS returned no addresses for "${rawHost}"`)
	}

	for (const addr of resolvedList) {
		if (isBlockedIp(addr.address)) {
			throw new SsrfBlockedError(`DNS resolved "${rawHost}" to blocked address "${addr.address}"`)
		}
	}

	return {
		cleanUrl: parsed.toString(),
		resolved: resolvedList[0]!
	}
}

async function readBoundedBody(res: Response, maxBytes: number): Promise<Uint8Array> {
	const contentLength = res.headers.get('content-length')
	if (contentLength) {
		const declared = Number.parseInt(contentLength, 10)
		if (Number.isFinite(declared) && declared > maxBytes) {
			throw new SsrfBlockedError(`Response exceeds maximum size of ${maxBytes} bytes`)
		}
	}

	if (!res.body) return new Uint8Array(0)
	const reader = res.body.getReader()
	const chunks: Uint8Array[] = []
	let total = 0
	try {
		while (true) {
			const { done, value } = await reader.read()
			if (done) break
			if (!value) continue
			total += value.byteLength
			if (total > maxBytes) {
				await reader.cancel().catch(() => {})
				throw new SsrfBlockedError(`Response exceeded maximum size of ${maxBytes} bytes`)
			}
			chunks.push(value)
		}
	} finally {
		reader.releaseLock()
	}

	const merged = new Uint8Array(total)
	let offset = 0
	for (const c of chunks) {
		merged.set(c, offset)
		offset += c.byteLength
	}
	return merged
}

export async function safeEgressFetch(
	rawUrl: string,
	opts: SafeEgressOptions = {}
): Promise<SafeEgressResponse> {
	const maxRedirects = opts.maxRedirects ?? 3
	const timeoutMs = opts.timeoutMs ?? 5_000
	const maxBytes = opts.maxBytes ?? 512 * 1024
	const resolver = opts.resolver ?? defaultResolver
	const fetcher = opts.fetcher ?? fetch

	let currentUrl = rawUrl
	let currentMethod = opts.method ?? 'GET'
	let currentBody = opts.body

	for (let hop = 0; hop <= maxRedirects; hop++) {
		const { cleanUrl } = await validateAndResolveEgressUrl(currentUrl, resolver)
		const controller = new AbortController()
		const timer = setTimeout(() => controller.abort(new Error('Egress fetch timed out')), timeoutMs)
		let res: Response
		try {
			res = await fetcher(cleanUrl, {
				method: currentMethod,
				...(opts.headers ? { headers: opts.headers } : {}),
				...(currentBody !== undefined && currentMethod !== 'GET' && currentMethod !== 'HEAD'
					? { body: currentBody as BodyInit }
					: {}),
				redirect: 'manual',
				signal: controller.signal
			})
		} finally {
			clearTimeout(timer)
		}

		if (res.status >= 300 && res.status < 400) {
			const location = res.headers.get('location')
			if (!location) {
				throw new SsrfBlockedError(`Redirect status ${res.status} without Location header`)
			}
			if (hop === maxRedirects) {
				throw new SsrfBlockedError(`Exceeded maximum of ${maxRedirects} redirects`)
			}
			currentUrl = new URL(location, cleanUrl).toString()
			if (res.status === 303 || ((res.status === 301 || res.status === 302) && currentMethod === 'POST')) {
				currentMethod = 'GET'
				currentBody = undefined
			}
			continue
		}

		const bodyBytes = await readBoundedBody(res, maxBytes)
		return {
			status: res.status,
			headers: res.headers,
			bodyBytes,
			finalUrl: cleanUrl
		}
	}

	throw new SsrfBlockedError(`Exceeded maximum of ${maxRedirects} redirects`)
}
