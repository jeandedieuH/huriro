/**
 * Slack export normalizer (§17.13b):
 *   - Sanitizes Slack channel names into Huriro channel slugs
 *   - Rewrites `<@U12345>` user tokens using Slack users catalog
 *   - Orders messages chronologically so thread parents precede replies
 *   - Preserves reaction lists cleanly for idempotent execution.
 */
import type { SlackImportPayload } from '@huriro/contracts'

export interface NormalizedSlackChannel {
	readonly remoteId: string
	readonly slug: string
	readonly kind: 'public' | 'private'
	readonly topic: string
	readonly messages: NormalizedSlackMessage[]
}

export interface NormalizedSlackMessage {
	readonly remoteId: string
	readonly remoteIdentifier: string
	readonly ts: string
	readonly threadTs: string | null
	readonly authorEmail: string | null
	readonly authorRemoteId: string | null
	readonly bodyText: string
	readonly reactions: readonly {
		readonly emoji: string
		readonly authorEmails: readonly string[]
	}[]
}

export interface NormalizedSlackDataset {
	readonly channels: NormalizedSlackChannel[]
	readonly totalMessages: number
	readonly totalThreads: number
	readonly emails: string[]
}

function toValidChannelSlug(name: string): string {
	const cleaned = name
		.trim()
		.toLowerCase()
		.replace(/[^a-z0-9-_]+/g, '-')
		.replace(/^-+|-+$/g, '')
		.slice(0, 80)
	if (/^[a-z0-9]/.test(cleaned)) return cleaned
	return `slack-${cleaned || 'general'}`.slice(0, 80)
}

function rewriteSlackUserTokens(
	text: string,
	usersById: Map<string, { readonly handle: string; readonly email: string | null }>
): string {
	return text
		.replace(/<@([A-Z0-9]+)(?:\|[^>]+)?>/gi, (_, uid: string) => {
			const hit = usersById.get(uid)
			return hit ? `@${hit.handle}` : `@${uid}`
		})
		.replace(/<!channel>/gi, '@channel')
		.replace(/<!here>/gi, '@here')
}

export function normalizeSlackPayload(payload: SlackImportPayload): NormalizedSlackDataset {
	const usersById = new Map<string, { readonly handle: string; readonly email: string | null }>()
	const emailSet = new Set<string>()

	for (const u of payload.users ?? []) {
		const email = u.email?.toLowerCase() ?? null
		if (email) emailSet.add(email)
		const handle = (
			u.name ??
			(email ? email.split('@')[0] : null) ??
			u.realName?.replace(/\s+/g, '').toLowerCase() ??
			u.id
		).toLowerCase()
		usersById.set(u.id, { handle, email })
	}

	let totalMessages = 0
	let totalThreads = 0

	const channels: NormalizedSlackChannel[] = payload.channels.map((ch) => {
		const rawMsgs = payload.messagesByChannel[ch.id] ?? payload.messagesByChannel[ch.name] ?? []
		const sorted = [...rawMsgs].sort((a, b) => Number(a.ts) - Number(b.ts))
		const slug = toValidChannelSlug(ch.name)

		const messages: NormalizedSlackMessage[] = sorted.map((m) => {
			const isReply = Boolean(m.threadTs && m.threadTs !== m.ts)
			if (isReply) totalThreads++
			else totalMessages++

			const userMeta = m.user ? usersById.get(m.user) : undefined
			const reactions = (m.reactions ?? []).map((rx) => ({
				emoji: rx.name.startsWith(':') && rx.name.endsWith(':') ? rx.name : rx.name,
				authorEmails: rx.users
					.map((uid) => usersById.get(uid)?.email ?? null)
					.filter((e): e is string => e !== null)
			}))

			return {
				remoteId: `${ch.id}:${m.ts}`,
				remoteIdentifier: `${slug}:${m.ts}`,
				ts: m.ts,
				threadTs: isReply ? (m.threadTs ?? null) : null,
				authorEmail: userMeta?.email ?? null,
				authorRemoteId: m.user ?? null,
				bodyText: rewriteSlackUserTokens(m.text, usersById) || '(empty message)',
				reactions
			}
		})

		return {
			remoteId: ch.id,
			slug,
			kind: ch.isPrivate ? 'private' : 'public',
			topic: ch.topic ?? '',
			messages
		}
	})

	return {
		channels,
		totalMessages,
		totalThreads,
		emails: [...emailSet]
	}
}
