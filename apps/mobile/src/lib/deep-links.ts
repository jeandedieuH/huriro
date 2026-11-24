export type MobileDeepLinkTarget =
	| { readonly kind: 'issue'; readonly id: string; readonly href: `/issue/${string}` }
	| { readonly kind: 'chat'; readonly channelId: string; readonly href: `/chat/${string}` }
	| { readonly kind: 'doc'; readonly slug: string; readonly href: `/doc/${string}` }
	| { readonly kind: 'mail'; readonly conversationId: string; readonly href: `/mail/${string}` }

function isValidSegment(segment: string): boolean {
	if (!segment || segment.length > 160) return false
	if (segment === '.' || segment === '..' || segment.includes('/') || segment.includes('\\')) return false
	return /^[a-zA-Z0-9._-]+$/.test(segment)
}

/**
 * Parses `huriro://...` and universal `https://...` deep links into safe typed
 * Expo Router routes. Rejects untrusted schemes (`javascript:`, `file:`, etc.)
 * and path-traversal segments.
 */
export function parseHuriroDeepLink(rawUrl: string | null | undefined): MobileDeepLinkTarget | null {
	if (!rawUrl || typeof rawUrl !== 'string') return null
	const trimmed = rawUrl.trim()
	if (!trimmed) return null

	let routePath = ''
	if (trimmed.startsWith('/')) {
		routePath = trimmed
	} else {
		let parsed: URL
		try {
			parsed = new URL(trimmed)
		} catch {
			return null
		}
		const scheme = parsed.protocol.toLowerCase()
		if (scheme === 'huriro:') {
			const hostPart = parsed.hostname ? `/${parsed.hostname}` : ''
			routePath = `${hostPart}${parsed.pathname}`
		} else if (scheme === 'https:' || scheme === 'http:') {
			routePath = parsed.pathname
		} else {
			return null
		}
	}

	const parts = routePath
		.split('/')
		.map((p) => p.trim())
		.filter(Boolean)
	if (parts.length < 2) return null

	const section = parts[0]
	const targetId = parts[1]
	if (!section || !targetId || !isValidSegment(targetId)) return null

	if (section === 'issues' || section === 'issue') {
		return { kind: 'issue', id: targetId, href: `/issue/${targetId}` }
	}
	if (section === 'chat' || section === 'channels') {
		return { kind: 'chat', channelId: targetId, href: `/chat/${targetId}` }
	}
	if (section === 'docs' || section === 'doc') {
		return { kind: 'doc', slug: targetId, href: `/doc/${targetId}` }
	}
	if (section === 'mail' || section === 'conversations') {
		return { kind: 'mail', conversationId: targetId, href: `/mail/${targetId}` }
	}
	return null
}
