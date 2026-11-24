/**
 * Mail provider adapters (§14.2, §14.7). External mailboxes are ADAPTERS —
 * Huriro tables remain the canonical store; provider ids live in
 * `provider_ref` as a cache, never as keys.
 *
 * Phase coverage:
 *   phase 1 — inbound-parse webhook (token-authed) + outbound relay (SMTP)
 *   phase 2 — Gmail API, Microsoft Graph, generic IMAP via imapflow
 *
 * Credentials come out of `mail_accounts.credentials_encrypted`
 * (envelope-decrypted in service.ts) — adapters only see plain config and
 * never log them.
 */
import { createHash } from 'node:crypto'

export interface MailAddress {
	readonly email: string
	readonly name?: string | null
}

export interface OutboundMail {
	readonly from: MailAddress
	readonly to: readonly MailAddress[]
	readonly cc: readonly MailAddress[]
	readonly bcc: readonly MailAddress[]
	readonly subject: string
	readonly textBody: string
	readonly htmlBody: string | null
	readonly inReplyTo: string | null
	readonly references: readonly string[]
	readonly messageId: string | null
	readonly attachments: readonly {
		readonly filename: string
		readonly contentType: string
		readonly content: Uint8Array
	}[]
}

export interface SendResult {
	readonly providerMessageId: string | null
	readonly accepted: readonly string[]
	readonly rejected: readonly string[]
}

/** Outbound transport — relay (phase 1) or provider API (phase 2). */
export interface MailTransport {
	send(mail: OutboundMail): Promise<SendResult>
}

export interface FetchedInbound {
	readonly raw: Uint8Array
	/** Provider message id — cache only (dedupe happens on rfc_message_id). */
	readonly providerMessageId: string | null
}

export interface SyncBatch {
	readonly messages: readonly FetchedInbound[]
	/** Opaque next cursor for the provider (uidnext / historyId / delta link). */
	readonly nextSyncState: Record<string, unknown>
	/** True when the provider wants another cycle immediately. */
	readonly more: boolean
}

/** Inbound poller for connected-mailbox providers. */
export interface MailPoller {
	poll(args: {
		readonly accountAddress: string
		readonly credentials: Record<string, unknown>
		readonly syncState: Record<string, unknown>
		readonly maxMessages: number
	}): Promise<SyncBatch>
}

// ---------- shared helpers ----------

/** SHA-256 hex of an inbound-parse URL token (stored, never the raw token). */
export function hashInboundToken(token: string): string {
	return createHash('sha256').update(token, 'utf8').digest('hex')
}

function fmtAddr(a: MailAddress): string {
	const name = a.name?.replace(/["\\\r\n]/g, ' ').trim()
	return name ? `"${name}" <${a.email}>` : `<${a.email}>`
}

/**
 * Build a safe RFC 822 message. nodemailer's MailComposer handles encoding —
 * we still sanitize headers' worth of injection vectors up-front so a hostile
 * display name can never fold a header.
 */
export function buildRfc822(mail: OutboundMail): Promise<Buffer> {
	const clean = (s: string) => s.replace(/[\r\n]/g, ' ').trim()
	return new Promise((resolve, reject) => {
		import('nodemailer/lib/mail-composer/index.js')
			.then((mod) => {
				const Composer = (
					mod as {
						default?: new (
							opts: Record<string, unknown>
						) => { compile(): { build(cb: (e: Error | null, b: Buffer) => void): void } }
					}
				).default
				if (!Composer) return reject(new Error('nodemailer MailComposer unavailable'))
				const composer = new Composer({
					from: fmtAddr(mail.from),
					to: mail.to.map(fmtAddr).join(', '),
					cc: mail.cc.length > 0 ? mail.cc.map(fmtAddr).join(', ') : undefined,
					bcc: mail.bcc.length > 0 ? mail.bcc.map(fmtAddr).join(', ') : undefined,
					subject: clean(mail.subject).slice(0, 400),
					text: mail.textBody,
					html: mail.htmlBody ?? undefined,
					inReplyTo: mail.inReplyTo ?? undefined,
					references: mail.references.length > 0 ? [...mail.references] : undefined,
					messageId: mail.messageId ?? undefined,
					attachments: mail.attachments.map((a) => ({
						filename: a.filename.replace(/[\r\n"]/g, '_').slice(0, 200),
						contentType: a.contentType,
						content: Buffer.from(a.content)
					}))
				})
				composer.compile().build((err, buf) => (err ? reject(err) : resolve(buf)))
			})
			.catch(reject)
	})
}

interface SmtpTransportConfig {
	readonly host: string
	readonly port: number
	readonly secure: boolean
	readonly user?: string | undefined
	readonly pass?: string | undefined
}

/** nodemailer SMTP transport — instance relay or per-account SMTP (IMAP accounts). */
export function createSmtpTransport(cfg: SmtpTransportConfig): MailTransport {
	return {
		async send(mail) {
			const nodemailer = await import('nodemailer')
			const transport = nodemailer.createTransport({
				host: cfg.host,
				port: cfg.port,
				secure: cfg.secure,
				auth: cfg.user ? { user: cfg.user, pass: cfg.pass ?? '' } : undefined,
				connectionTimeout: 15_000,
				socketTimeout: 30_000
			})
			try {
				const raw = await buildRfc822(mail)
				const envelope = {
					from: mail.from.email,
					to: [...mail.to, ...mail.cc, ...mail.bcc].map((a) => a.email)
				}
				const info = await transport.sendMail({ envelope, raw })
				return {
					providerMessageId: typeof info.messageId === 'string' ? info.messageId : null,
					accepted: (info.accepted ?? []).map(String),
					rejected: (info.rejected ?? []).map(String)
				}
			} finally {
				transport.close()
			}
		}
	}
}

/** Gmail API sender (users.messages.send with raw RFC 822). */
export function createGmailTransport(accessToken: string): MailTransport {
	return {
		async send(mail) {
			const raw = await buildRfc822(mail)
			const res = await fetch('https://gmail.googleapis.com/gmail/v1/users/me/messages/send', {
				method: 'POST',
				headers: { authorization: `Bearer ${accessToken}`, 'content-type': 'application/json' },
				body: JSON.stringify({ raw: raw.toString('base64url') })
			})
			if (!res.ok) throw new MailProviderError('gmail_send_failed', `Gmail send failed (${res.status})`)
			const body = (await res.json()) as { id?: string }
			return { providerMessageId: body.id ?? null, accepted: mail.to.map((a) => a.email), rejected: [] }
		}
	}
}

/** Microsoft Graph sender (POST /me/sendMail with MIME item). */
export function createGraphTransport(accessToken: string): MailTransport {
	return {
		async send(mail) {
			const raw = await buildRfc822(mail)
			const res = await fetch('https://graph.microsoft.com/v1.0/me/sendMail', {
				method: 'POST',
				headers: { authorization: `Bearer ${accessToken}`, 'content-type': 'text/plain' },
				body: raw.toString('utf8')
			})
			if (!res.ok && res.status !== 202) {
				throw new MailProviderError('graph_send_failed', `Graph send failed (${res.status})`)
			}
			return { providerMessageId: null, accepted: mail.to.map((a) => a.email), rejected: [] }
		}
	}
}

export class MailProviderError extends Error {
	readonly providerCode: string
	constructor(providerCode: string, message: string) {
		super(message)
		this.name = 'MailProviderError'
		this.providerCode = providerCode
	}
}

// ---------- inbound pollers ----------

const MAX_SYNC_MESSAGES = 500

/** Generic IMAP poller via imapflow — UID-validity aware, markSeen=false. */
export function createImapPoller(): MailPoller {
	return {
		async poll({ credentials, syncState, maxMessages }) {
			const { ImapFlow } = await import('imapflow')
			const host = String(credentials['imapHost'] ?? '')
			const user = String(credentials['imapUser'] ?? '')
			const pass = String(credentials['imapPassword'] ?? '')
			if (!host || !user) throw new MailProviderError('imap_unconfigured', 'IMAP host/user missing')

			const client = new ImapFlow({
				host,
				port: Number(credentials['imapPort'] ?? 993),
				secure: credentials['imapTls'] !== false,
				auth: { user, pass },
				logger: false
			})
			const out: FetchedInbound[] = []
			try {
				await client.connect()
				const mailbox = String(credentials['imapMailbox'] ?? 'INBOX')
				const lock = await client.getMailboxLock(mailbox)
				try {
					const state = client.mailbox
					const prevUidNext = Number(syncState['uidNext'] ?? 0)
					const uidValidity =
						state && typeof state === 'object' && state.uidValidity ? String(state.uidValidity) : null
					const prevValidity = syncState['uidValidity'] ? String(syncState['uidValidity']) : null

					// UIDVALIDITY changed → server reassigned UIDs; resync from scratch.
					const startUid = uidValidity && prevValidity && uidValidity !== prevValidity ? 1 : prevUidNext
					const range = `${Math.max(startUid, 1)}:*`
					const limit = Math.min(maxMessages, MAX_SYNC_MESSAGES)
					let lastUid = startUid
					for await (const msg of client.fetch(range, { source: true, uid: true }, { uid: true })) {
						if (msg.uid <= startUid) continue
						if (out.length >= limit) break
						if (msg.source) out.push({ raw: new Uint8Array(msg.source), providerMessageId: String(msg.uid) })
						if (msg.uid > lastUid) lastUid = msg.uid
					}
					const serverUidNext =
						state && typeof state === 'object' && state.uidNext ? Number(state.uidNext) : 0
					const nextState: Record<string, unknown> = {
						uidNext: Math.max(lastUid + 1, serverUidNext),
						...(uidValidity ? { uidValidity } : {})
					}
					return { messages: out, nextSyncState: nextState, more: out.length >= limit }
				} finally {
					lock.release()
				}
			} finally {
				await client.logout().catch(() => client.close())
			}
		}
	}
}

async function gmailApi(accessToken: string, path: string): Promise<Record<string, unknown>> {
	const res = await fetch(`https://gmail.googleapis.com/gmail/v1/users/me/${path}`, {
		headers: { authorization: `Bearer ${accessToken}` }
	})
	if (!res.ok) throw new MailProviderError('gmail_api_error', `Gmail API ${res.status}`)
	return (await res.json()) as Record<string, unknown>
}

/** Gmail poller — history.list delta when we hold a historyId, else recent list. */
export function createGmailPoller(accessToken: string): MailPoller {
	return {
		async poll({ syncState, maxMessages }) {
			const out: FetchedInbound[] = []
			const limit = Math.min(maxMessages, MAX_SYNC_MESSAGES)
			let nextHistoryId: string | null = syncState['historyId'] ? String(syncState['historyId']) : null

			const ids: string[] = []
			if (nextHistoryId) {
				// Incremental history sync (§14.2): list message-added records.
				const hist = (await gmailApi(
					accessToken,
					`history?startHistoryId=${encodeURIComponent(nextHistoryId)}&historyTypes=messageAdded&maxResults=${limit}`
				)) as { history?: { messagesAdded?: { message?: { id?: string } }[] }[]; historyId?: string }
				for (const h of hist.history ?? []) {
					for (const m of h.messagesAdded ?? []) {
						if (m.message?.id) ids.push(m.message.id)
					}
				}
				nextHistoryId = hist.historyId ?? nextHistoryId
			} else {
				// Bootstrap: most recent N message ids in INBOX.
				const list = (await gmailApi(accessToken, `messages?labelIds=INBOX&maxResults=${limit}`)) as {
					messages?: { id?: string }[]
				}
				for (const m of list.messages ?? []) if (m.id) ids.push(m.id)
				const profile = (await gmailApi(accessToken, 'profile')) as { historyId?: string }
				nextHistoryId = profile.historyId ?? null
			}

			for (const id of ids.slice(0, limit)) {
				const msg = (await gmailApi(accessToken, `messages/${id}?format=raw`)) as { raw?: string }
				if (msg.raw) {
					out.push({ raw: Buffer.from(msg.raw, 'base64url'), providerMessageId: id })
				}
			}
			return {
				messages: out,
				nextSyncState: { ...(nextHistoryId ? { historyId: nextHistoryId } : {}) },
				more: ids.length >= limit
			}
		}
	}
}

async function graphApi(accessToken: string, url: string): Promise<Record<string, unknown>> {
	const res = await fetch(url, { headers: { authorization: `Bearer ${accessToken}` } })
	if (!res.ok) throw new MailProviderError('graph_api_error', `Graph API ${res.status}`)
	return (await res.json()) as Record<string, unknown>
}

/** Microsoft Graph poller — delta query on the Inbox folder. */
export function createGraphPoller(accessToken: string): MailPoller {
	return {
		async poll({ syncState, maxMessages }) {
			const limit = Math.min(maxMessages, MAX_SYNC_MESSAGES)
			let url =
				(syncState['deltaLink'] as string | undefined) ??
				`https://graph.microsoft.com/v1.0/me/mailFolders/inbox/messages/delta?$top=${Math.min(limit, 50)}`
			const out: FetchedInbound[] = []
			let deltaLink: string | null = null
			let more = false

			while (url && out.length < limit) {
				const page = (await graphApi(accessToken, url)) as {
					value?: { id?: string }[]
					'@odata.nextLink'?: string
					'@odata.deltaLink'?: string
				}
				for (const m of page.value ?? []) {
					if (!m.id || out.length >= limit) continue
					const mimeRes = await fetch(
						`https://graph.microsoft.com/v1.0/me/messages/${encodeURIComponent(m.id)}/$value`,
						{ headers: { authorization: `Bearer ${accessToken}` } }
					)
					if (mimeRes.ok) {
						out.push({ raw: new Uint8Array(await mimeRes.arrayBuffer()), providerMessageId: m.id })
					}
				}
				if (page['@odata.deltaLink']) {
					deltaLink = page['@odata.deltaLink']
					break
				}
				url = page['@odata.nextLink'] ?? ''
				if (!url) break
				more = true
			}
			return {
				messages: out,
				nextSyncState: { ...(deltaLink ? { deltaLink } : {}) },
				more: more || out.length >= limit
			}
		}
	}
}

// ---------- OAuth token refresh ----------

export interface OAuthCredentials {
	readonly refreshToken: string
	readonly accessToken?: string | undefined
	readonly expiresAt?: number | undefined
}

/** Refresh an OAuth access token for gmail/graph accounts (worker-side). */
export async function refreshOAuthToken(
	provider: 'gmail' | 'graph',
	creds: OAuthCredentials,
	clientId: string,
	clientSecret: string
): Promise<{ accessToken: string; expiresAt: number }> {
	if (creds.accessToken && creds.expiresAt && creds.expiresAt > Date.now() + 60_000) {
		return { accessToken: creds.accessToken, expiresAt: creds.expiresAt }
	}
	const url =
		provider === 'gmail'
			? 'https://oauth2.googleapis.com/token'
			: 'https://login.microsoftonline.com/common/oauth2/v2.0/token'
	const body = new URLSearchParams({
		client_id: clientId,
		client_secret: clientSecret,
		refresh_token: creds.refreshToken,
		grant_type: 'refresh_token',
		...(provider === 'graph'
			? {
					scope:
						'https://graph.microsoft.com/Mail.ReadWrite https://graph.microsoft.com/Mail.Send offline_access'
				}
			: {})
	})
	const res = await fetch(url, {
		method: 'POST',
		headers: { 'content-type': 'application/x-www-form-urlencoded' },
		body: body.toString()
	})
	if (!res.ok) throw new MailProviderError('oauth_refresh_failed', `Token refresh failed (${res.status})`)
	const json = (await res.json()) as { access_token?: string; expires_in?: number }
	if (!json.access_token)
		throw new MailProviderError('oauth_refresh_failed', 'Token refresh returned no access token')
	return { accessToken: json.access_token, expiresAt: Date.now() + (json.expires_in ?? 3600) * 1000 }
}

// ---------- domain verification (phase 1: DKIM/SPF/DMARC) ----------

export interface DnsLike {
	resolveTxt(hostname: string): Promise<string[][]>
	resolveMx?(hostname: string): Promise<{ exchange: string; priority: number }[]>
}

export function nodeDnsResolver(): DnsLike {
	return {
		async resolveTxt(hostname) {
			const dns = await import('node:dns/promises')
			return dns.resolveTxt(hostname)
		},
		async resolveMx(hostname) {
			const dns = await import('node:dns/promises')
			return dns.resolveMx(hostname)
		}
	}
}

/**
 * Verify a customer sending domain (§14.2): looks for the TXT records the
 * account config recorded at creation (`expectedTxts`: host → required value
 * fragment). Returns the missing entries so the settings UI can render them.
 */
export async function verifyDomainRecords(
	expectedTxts: readonly { host: string; value: string }[],
	dns: DnsLike
): Promise<{ verified: boolean; missing: string[] }> {
	const missing: string[] = []
	for (const rec of expectedTxts) {
		try {
			const txts = await dns.resolveTxt(rec.host)
			const flat = txts.map((chunks) => chunks.join(''))
			if (!flat.some((v) => v.includes(rec.value))) missing.push(`TXT ${rec.host} = ${rec.value}`)
		} catch {
			missing.push(`TXT ${rec.host} = ${rec.value}`)
		}
	}
	return { verified: missing.length === 0, missing }
}

/** DNS records we ask a customer domain to publish (DKIM via relay + SPF include). */
export function buildDomainRecords(args: {
	readonly domain: string
	readonly selector: string
	readonly dkimPublicKey: string
	readonly spfInclude: string
}): { host: string; value: string; kind: string }[] {
	return [
		{
			host: `${args.selector}._domainkey.${args.domain}`,
			value: `v=DKIM1; k=rsa; p=${args.dkimPublicKey}`,
			kind: 'dkim'
		},
		{ host: args.domain, value: `v=spf1 include:${args.spfInclude} ~all`, kind: 'spf' },
		{ host: `_dmarc.${args.domain}`, value: 'v=DMARC1; p=none; rua=mailto:dmarc@huriro.local', kind: 'dmarc' }
	]
}
