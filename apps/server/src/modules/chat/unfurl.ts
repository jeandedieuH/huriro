/**
 * Async SSRF-safe OpenGraph link preview unfurler (§12.6, §15.1).
 *
 * Outbox claim and DB persistence happen inside `withWorkspace`; outbound HTTP
 * runs completely OUTSIDE any open PostgreSQL transaction via `safeEgressFetch`.
 */
import { createHash } from 'node:crypto'
import { type Sql, withWorkspace } from '@huriro/db'
import { isSafeUrl } from '@huriro/editor'
import { type DnsResolver, SsrfBlockedError, safeEgressFetch } from '../../api/egress'
import type { RealtimePubSub } from '../../realtime/pubsub'
import { CHAT_EVENTS } from './events'
import {
	allocateChannelSeqAndRev,
	findChannelsAndMessagesForPreview,
	getLinkPreviewByUrlHash,
	setMessageRev,
	updateLinkPreviewResult
} from './repo'

export interface ChatUnfurlOptions {
	readonly fetchImpl?: typeof fetch | undefined
	readonly resolver?: DnsResolver | undefined
}

const CHAT_UNFURL_CONSUMER = 'chat-unfurl'

function sha256Hex(value: string): string {
	return createHash('sha256').update(value).digest('hex')
}

function decodeHtmlEntities(raw: string): string {
	return raw
		.replace(/&amp;/gi, '&')
		.replace(/&lt;/gi, '<')
		.replace(/&gt;/gi, '>')
		.replace(/&quot;/gi, '"')
		.replace(/&#39;/gi, "'")
		.replace(/&#x27;/gi, "'")
		.trim()
}

function readMetaTag(html: string, key: string): string | null {
	const escaped = key.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
	const patterns = [
		new RegExp(
			`<meta[^>]+(?:property|name)=["']${escaped}["'][^>]+content=["']([^"']{1,1000})["'][^>]*>`,
			'i'
		),
		new RegExp(
			`<meta[^>]+content=["']([^"']{1,1000})["'][^>]+(?:property|name)=["']${escaped}["'][^>]*>`,
			'i'
		)
	]
	for (const re of patterns) {
		const m = re.exec(html)
		if (m?.[1]) return decodeHtmlEntities(m[1])
	}
	return null
}

function extractOpenGraph(
	html: string,
	fallbackUrl: string
): {
	readonly title: string
	readonly description: string
	readonly siteName: string
	readonly imageUrl: string | null
	readonly canonicalUrl: string | null
} {
	const ogTitle = readMetaTag(html, 'og:title') ?? readMetaTag(html, 'twitter:title')
	const titleMatch = /<title[^>]*>([^<]{1,400})<\/title>/i.exec(html)
	const title = (ogTitle ?? (titleMatch?.[1] ? decodeHtmlEntities(titleMatch[1]) : '')).slice(0, 240)

	const description = (
		readMetaTag(html, 'og:description') ??
		readMetaTag(html, 'description') ??
		readMetaTag(html, 'twitter:description') ??
		''
	).slice(0, 500)

	let siteName = (readMetaTag(html, 'og:site_name') ?? '').slice(0, 120)
	if (!siteName) {
		try {
			siteName = new URL(fallbackUrl).hostname
		} catch {
			siteName = ''
		}
	}

	const rawCanonical = readMetaTag(html, 'og:url')
	let canonicalUrl: string | null = null
	if (rawCanonical) {
		try {
			const resolved = new URL(rawCanonical, fallbackUrl).toString()
			if (isSafeUrl(resolved)) canonicalUrl = resolved
		} catch {
			canonicalUrl = null
		}
	}

	const rawImage = readMetaTag(html, 'og:image') ?? readMetaTag(html, 'twitter:image')
	let imageUrl: string | null = null
	if (rawImage) {
		try {
			const resolved = new URL(rawImage, fallbackUrl).toString()
			if (isSafeUrl(resolved)) imageUrl = resolved
		} catch {
			imageUrl = null
		}
	}

	return { title, description, siteName, imageUrl, canonicalUrl }
}

export async function processChatLinkPreviewOutboxEvent(
	app: Sql,
	event: {
		readonly id: string
		readonly workspaceId: string | null
		readonly eventType: string
		readonly payload: Record<string, unknown>
	},
	opts?: ChatUnfurlOptions,
	pubsub?: RealtimePubSub
): Promise<number> {
	if (!event.workspaceId) return 0
	if (event.eventType !== CHAT_EVENTS.MessageCreated && event.eventType !== CHAT_EVENTS.MessageUpdated) {
		return 0
	}

	const rawUrls = Array.isArray(event.payload['previewUrls'])
		? event.payload['previewUrls'].filter((u): u is string => typeof u === 'string').slice(0, 5)
		: []
	if (rawUrls.length === 0) return 0

	const pending: { readonly id: string; readonly url: string }[] = await withWorkspace(
		app,
		{ workspaceId: event.workspaceId },
		async (tx) => {
			const claimed = await tx<{ eventId: string }[]>`
				INSERT INTO processed_events (consumer, event_id)
				VALUES (${CHAT_UNFURL_CONSUMER}, ${event.id})
				ON CONFLICT (consumer, event_id) DO NOTHING
				RETURNING event_id AS "eventId"
			`
			if (claimed.length === 0) return []

			const todo: { id: string; url: string }[] = []
			for (const url of rawUrls) {
				const row = await getLinkPreviewByUrlHash(tx, event.workspaceId!, sha256Hex(url))
				if (!row) continue
				const expired = row.expiresAt !== null && new Date(row.expiresAt).getTime() <= Date.now()
				if (row.status === 'pending' || expired) {
					todo.push({ id: row.id, url: row.url })
				}
			}
			return todo
		}
	)

	if (pending.length === 0) return 0

	const results: {
		readonly previewId: string
		readonly status: 'ok' | 'blocked' | 'failed'
		readonly canonicalUrl: string | null
		readonly title: string
		readonly description: string
		readonly siteName: string
		readonly imageUrl: string | null
		readonly errorDetail: string | null
		readonly ttlHours: number
	}[] = []

	for (const item of pending) {
		try {
			const res = await safeEgressFetch(item.url, {
				method: 'GET',
				timeoutMs: 4_000,
				maxBytes: 512_000,
				headers: { accept: 'text/html,application/xhtml+xml' },
				...(opts?.fetchImpl ? { fetcher: opts.fetchImpl } : {}),
				...(opts?.resolver ? { resolver: opts.resolver } : {})
			})

			if (res.status < 200 || res.status >= 300) {
				results.push({
					previewId: item.id,
					status: 'failed',
					canonicalUrl: null,
					title: '',
					description: '',
					siteName: '',
					imageUrl: null,
					errorDetail: `HTTP ${res.status}`,
					ttlHours: 1
				})
				continue
			}

			const html = new TextDecoder('utf-8', { fatal: false }).decode(res.bodyBytes)
			const og = extractOpenGraph(html, res.finalUrl)
			results.push({
				previewId: item.id,
				status: 'ok',
				canonicalUrl: og.canonicalUrl ?? (isSafeUrl(res.finalUrl) ? res.finalUrl : null),
				title: og.title,
				description: og.description,
				siteName: og.siteName,
				imageUrl: og.imageUrl,
				errorDetail: null,
				ttlHours: 24
			})
		} catch (err) {
			if (err instanceof SsrfBlockedError) {
				results.push({
					previewId: item.id,
					status: 'blocked',
					canonicalUrl: null,
					title: '',
					description: '',
					siteName: '',
					imageUrl: null,
					errorDetail: err.message.slice(0, 240),
					ttlHours: 24
				})
			} else {
				results.push({
					previewId: item.id,
					status: 'failed',
					canonicalUrl: null,
					title: '',
					description: '',
					siteName: '',
					imageUrl: null,
					errorDetail: (err instanceof Error ? err.message : 'Preview fetch failed').slice(0, 240),
					ttlHours: 1
				})
			}
		}
	}

	const signals = await withWorkspace(app, { workspaceId: event.workspaceId }, async (tx) => {
		const updatedChannels = new Map<string, { lastMsgSeq: number; lastRev: number }>()
		for (const r of results) {
			await updateLinkPreviewResult(tx, {
				workspaceId: event.workspaceId!,
				previewId: r.previewId,
				status: r.status,
				canonicalUrl: r.canonicalUrl,
				title: r.title,
				description: r.description,
				siteName: r.siteName,
				imageUrl: r.imageUrl,
				errorDetail: r.errorDetail,
				ttlHours: r.ttlHours
			})
			const links = await findChannelsAndMessagesForPreview(tx, event.workspaceId!, r.previewId)
			for (const l of links) {
				const seq = await allocateChannelSeqAndRev(tx, event.workspaceId!, l.channelId, false)
				await setMessageRev(tx, event.workspaceId!, l.messageId, seq.lastRev)
				updatedChannels.set(l.channelId, seq)
			}
		}
		return updatedChannels
	})

	if (pubsub) {
		for (const [channelId, seq] of signals) {
			await pubsub.publishChat(event.workspaceId, channelId, seq.lastRev, seq.lastMsgSeq)
		}
	}

	return results.length
}
