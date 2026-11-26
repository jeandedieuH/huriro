import { isIP } from 'node:net'
import {
	ApiConnectionException,
	ApiErrorException,
	Emailit,
	type EmailSendParams,
	RateLimitException
} from '@emailit/node'
import { Resend } from 'resend'
import { hashForLog, log } from '../api/observability'
import {
	EmailDeliveryError,
	type EmailMessage,
	type EmailPipelineConfig,
	type EmailProviderName,
	type EmailSendResult,
	type EmailTransport
} from './types'

export interface ParsedSmtpConfig {
	readonly host: string
	readonly port: number
	readonly secure: boolean
	readonly user?: string | undefined
	readonly pass?: string | undefined
}

export interface DnsLookupAddress {
	readonly address: string
	readonly family: number
}

export type SmtpDnsLookup = (
	hostname: string,
	options: { readonly all: true }
) => Promise<readonly DnsLookupAddress[]>

export interface ResolvedSmtpTarget {
	readonly host: string
	readonly servername?: string | undefined
}

async function defaultSmtpDnsLookup(
	hostname: string,
	options: { readonly all: true }
): Promise<readonly DnsLookupAddress[]> {
	const dns = await import('node:dns/promises')
	return dns.lookup(hostname, options)
}

/**
 * Pre-resolve an SMTP hostname via the OS resolver (`dns.lookup`) and prefer
 * IPv4 over IPv6.
 *
 * Nodemailer's internal DNS resolver runs parallel `resolve4` + `resolve6`
 * queries and waits for both before connecting; on networks where AAAA
 * queries stall or blackhole, the whole connection times out with `EDNS` even
 * when IPv4 resolves immediately. Passing the resolved IP with the original
 * hostname in `servername` preserves TLS SNI and certificate verification.
 */
export async function resolveSmtpConnectionTarget(
	host: string,
	dnsLookup?: SmtpDnsLookup,
	timeoutMs = 10_000
): Promise<ResolvedSmtpTarget> {
	const trimmed = host.trim()
	if (!trimmed || isIP(trimmed) !== 0) {
		// RFC 6066: never send an IP literal in TLS SNI `servername`.
		return { host: trimmed }
	}

	const lookupFn = dnsLookup ?? defaultSmtpDnsLookup
	let timer: ReturnType<typeof setTimeout> | undefined
	let records: readonly DnsLookupAddress[]
	try {
		const timeoutPromise = new Promise<never>((_resolve, reject) => {
			timer = setTimeout(() => {
				const err = new Error(`DNS lookup for ${trimmed} timed out`) as Error & { code?: string }
				err.code = 'EDNS'
				reject(err)
			}, timeoutMs)
		})
		records = await Promise.race([
			Promise.resolve().then(() => lookupFn(trimmed, { all: true })),
			timeoutPromise
		])
	} finally {
		if (timer !== undefined) clearTimeout(timer)
	}

	const valid = records.filter((r) => isIP(r.address) !== 0)
	const ipv4 = valid.filter((r) => r.family === 4 || isIP(r.address) === 4)
	const ipv6 = valid.filter((r) => r.family !== 4 && isIP(r.address) !== 4)
	const preferred = ipv4[0] ?? ipv6[0]
	if (!preferred) {
		const err = new Error(`DNS lookup returned no addresses for ${trimmed}`) as Error & { code?: string }
		err.code = 'EDNS'
		throw err
	}

	return {
		host: preferred.address,
		servername: trimmed
	}
}

export function sanitizeHeaderValue(raw: string): string {
	return raw.replace(/[\r\n]+/g, ' ').trim()
}

function sanitizeHeaders(headers?: Record<string, string>): Record<string, string> | undefined {
	if (!headers) return undefined
	const cleaned: Record<string, string> = {}
	for (const [key, value] of Object.entries(headers)) {
		const cleanKey = sanitizeHeaderValue(key)
		if (!cleanKey) continue
		cleaned[cleanKey] = sanitizeHeaderValue(value)
	}
	return Object.keys(cleaned).length > 0 ? cleaned : undefined
}

function sanitizeTagSegment(raw: string): string {
	const cleaned = raw.replace(/[^A-Za-z0-9_-]/g, '_').slice(0, 256)
	return cleaned.length > 0 ? cleaned : 'tag'
}

export function parseSmtpConfig(cfg: {
	readonly smtpUrl?: string | undefined
	readonly smtpHost?: string | undefined
	readonly smtpPort?: number | undefined
	readonly smtpSecure?: boolean | undefined
	readonly smtpUser?: string | undefined
	readonly smtpPass?: string | undefined
}): ParsedSmtpConfig | null {
	if (cfg.smtpUrl?.trim()) {
		const rawUrl = cfg.smtpUrl.trim()
		try {
			const parsed = new URL(rawUrl)
			const secure = cfg.smtpSecure ?? parsed.protocol === 'smtps:'
			const port = cfg.smtpPort ?? (parsed.port ? Number.parseInt(parsed.port, 10) : secure ? 465 : 587)
			const host = cfg.smtpHost?.trim() || parsed.hostname
			if (!host) return null
			const user = cfg.smtpUser ?? (parsed.username ? decodeURIComponent(parsed.username) : undefined)
			const pass = cfg.smtpPass ?? (parsed.password ? decodeURIComponent(parsed.password) : undefined)
			return {
				host,
				port,
				secure,
				...(user ? { user } : {}),
				...(pass !== undefined ? { pass } : {})
			}
		} catch {
			const host = cfg.smtpHost?.trim() || rawUrl
			const secure = cfg.smtpSecure ?? cfg.smtpPort === 465
			const port = cfg.smtpPort ?? (secure ? 465 : 587)
			return {
				host,
				port,
				secure,
				...(cfg.smtpUser ? { user: cfg.smtpUser } : {}),
				...(cfg.smtpPass !== undefined ? { pass: cfg.smtpPass } : {})
			}
		}
	}

	if (cfg.smtpHost?.trim()) {
		const secure = cfg.smtpSecure ?? cfg.smtpPort === 465
		const port = cfg.smtpPort ?? (secure ? 465 : 587)
		return {
			host: cfg.smtpHost.trim(),
			port,
			secure,
			...(cfg.smtpUser ? { user: cfg.smtpUser } : {}),
			...(cfg.smtpPass !== undefined ? { pass: cfg.smtpPass } : {})
		}
	}

	return null
}

export interface EmailitClientLike {
	readonly emails: {
		// Minimal structural seam — the pipeline only consumes `.id`, so test/self-host
		// fakes don't have to implement the SDK response object's helper methods.
		send(params: EmailSendParams): Promise<{ readonly id?: string | undefined }>
	}
}

export function createEmailitTransport(opts: {
	readonly apiKey: string
	readonly apiBase?: string | undefined
	readonly defaultFrom: string
	readonly defaultReplyTo?: string | undefined
	readonly fetchImpl?: typeof fetch | undefined
	readonly clientOverride?: EmailitClientLike | undefined
}): EmailTransport {
	const client: EmailitClientLike =
		opts.clientOverride ??
		new Emailit({
			apiKey: opts.apiKey,
			...(opts.apiBase ? { apiBase: opts.apiBase } : {}),
			...(opts.fetchImpl ? { fetch: opts.fetchImpl } : {})
		})

	return {
		provider: 'emailit',
		async send(msg: EmailMessage): Promise<EmailSendResult> {
			const from = sanitizeHeaderValue(msg.from ?? opts.defaultFrom)
			const to = sanitizeHeaderValue(msg.to)
			const subject = sanitizeHeaderValue(msg.subject)
			const replyToRaw = msg.replyTo ?? opts.defaultReplyTo
			const headers = sanitizeHeaders(msg.headers)

			try {
				const res = await client.emails.send({
					from,
					to: [to],
					subject,
					html: msg.html,
					text: msg.text,
					...(replyToRaw ? { reply_to: sanitizeHeaderValue(replyToRaw) } : {}),
					...(headers ? { headers } : {})
				})
				return {
					provider: 'emailit',
					messageId: typeof res.id === 'string' ? res.id : null
				}
			} catch (err) {
				const retryable =
					err instanceof ApiConnectionException ||
					err instanceof RateLimitException ||
					(err instanceof ApiErrorException && err.httpStatus >= 500)
				const detail = err instanceof Error ? err.message : 'Emailit request failed'
				throw new EmailDeliveryError('emailit', detail, { retryable, cause: err })
			}
		}
	}
}

export interface ResendClientLike {
	readonly emails: {
		send(
			payload: {
				from: string
				to: string | string[]
				subject: string
				html: string
				text: string
				replyTo?: string | string[]
				headers?: Record<string, string>
				tags?: { name: string; value: string }[]
			},
			options?: { idempotencyKey?: string }
		): Promise<{
			readonly data: { readonly id: string } | null
			readonly error: {
				readonly message: string
				readonly statusCode: number | null
				readonly name: string
			} | null
		}>
	}
}

export function createResendTransport(opts: {
	readonly apiKey: string
	readonly defaultFrom: string
	readonly defaultReplyTo?: string | undefined
	readonly clientOverride?: ResendClientLike | undefined
}): EmailTransport {
	const client: ResendClientLike =
		opts.clientOverride ?? (new Resend(opts.apiKey) as unknown as ResendClientLike)

	return {
		provider: 'resend',
		async send(msg: EmailMessage): Promise<EmailSendResult> {
			const from = sanitizeHeaderValue(msg.from ?? opts.defaultFrom)
			const to = sanitizeHeaderValue(msg.to)
			const subject = sanitizeHeaderValue(msg.subject)
			const replyToRaw = msg.replyTo ?? opts.defaultReplyTo
			const headers = sanitizeHeaders(msg.headers)
			const tags = msg.tags
				? Object.entries(msg.tags).map(([name, value]) => ({
						name: sanitizeTagSegment(name),
						value: sanitizeTagSegment(value)
					}))
				: undefined

			try {
				const { data, error } = await client.emails.send(
					{
						from,
						to: [to],
						subject,
						html: msg.html,
						text: msg.text,
						...(replyToRaw ? { replyTo: sanitizeHeaderValue(replyToRaw) } : {}),
						...(headers ? { headers } : {}),
						...(tags && tags.length > 0 ? { tags } : {})
					},
					msg.idempotencyKey ? { idempotencyKey: msg.idempotencyKey } : undefined
				)
				if (error) {
					const retryable = error.statusCode === 429 || (error.statusCode !== null && error.statusCode >= 500)
					throw new EmailDeliveryError('resend', error.message, { retryable, cause: error })
				}
				return {
					provider: 'resend',
					messageId: data?.id ?? null
				}
			} catch (err) {
				if (err instanceof EmailDeliveryError) throw err
				const detail = err instanceof Error ? err.message : 'Resend request failed'
				throw new EmailDeliveryError('resend', detail, { retryable: true, cause: err })
			}
		}
	}
}

export interface NodemailerTransportLike {
	sendMail(options: {
		readonly from: string
		readonly to: string
		readonly replyTo?: string | undefined
		readonly subject: string
		readonly text: string
		readonly html: string
		readonly headers?: Record<string, string> | undefined
	}): Promise<{ readonly messageId?: string | undefined }>
	close(): void
}

export interface NodemailerFactoryLike {
	createTransport(options: {
		readonly host: string
		readonly port: number
		readonly secure: boolean
		readonly servername?: string | undefined
		readonly tls?: { readonly servername?: string | undefined } | undefined
		readonly auth?: { readonly user: string; readonly pass: string } | undefined
		readonly connectionTimeout?: number
		readonly greetingTimeout?: number
		readonly socketTimeout?: number
	}): NodemailerTransportLike
}

export function createSmtpTransport(opts: {
	readonly host: string
	readonly port: number
	readonly secure: boolean
	readonly user?: string | undefined
	readonly pass?: string | undefined
	readonly defaultFrom: string
	readonly defaultReplyTo?: string | undefined
	readonly nodemailerOverride?: NodemailerFactoryLike | undefined
	readonly dnsLookup?: SmtpDnsLookup | undefined
}): EmailTransport {
	return {
		provider: 'smtp',
		async send(msg: EmailMessage): Promise<EmailSendResult> {
			let transporter: NodemailerTransportLike | null = null
			try {
				// Skip network DNS when unit tests supply a mock nodemailer factory without a custom dnsLookup.
				const target: ResolvedSmtpTarget =
					opts.nodemailerOverride && !opts.dnsLookup
						? { host: opts.host }
						: await resolveSmtpConnectionTarget(opts.host, opts.dnsLookup)
				const mailerFactory: NodemailerFactoryLike =
					opts.nodemailerOverride ?? ((await import('nodemailer')) as unknown as NodemailerFactoryLike)
				transporter = mailerFactory.createTransport({
					host: target.host,
					port: opts.port,
					secure: opts.secure,
					...(target.servername
						? { servername: target.servername, tls: { servername: target.servername } }
						: {}),
					...(opts.user ? { auth: { user: opts.user, pass: opts.pass ?? '' } } : {}),
					connectionTimeout: 15_000,
					greetingTimeout: 10_000,
					socketTimeout: 30_000
				})

				const from = sanitizeHeaderValue(msg.from ?? opts.defaultFrom)
				const to = sanitizeHeaderValue(msg.to)
				const subject = sanitizeHeaderValue(msg.subject)
				const replyToRaw = msg.replyTo ?? opts.defaultReplyTo
				const headers = sanitizeHeaders(msg.headers)

				const info = await transporter.sendMail({
					from,
					to,
					...(replyToRaw ? { replyTo: sanitizeHeaderValue(replyToRaw) } : {}),
					subject,
					text: msg.text,
					html: msg.html,
					...(headers ? { headers } : {})
				})
				return {
					provider: 'smtp',
					messageId: typeof info.messageId === 'string' ? info.messageId : null
				}
			} catch (err) {
				const detail = err instanceof Error ? err.message : 'SMTP delivery failed'
				throw new EmailDeliveryError('smtp', detail, { retryable: true, cause: err })
			} finally {
				transporter?.close()
			}
		}
	}
}

export function createNoopEmailTransport(reason = 'email provider not configured'): EmailTransport {
	return {
		provider: 'noop',
		async send(msg: EmailMessage): Promise<EmailSendResult> {
			log.info(
				{ toHash: hashForLog(msg.to), subject: msg.subject, reason },
				'email delivery skipped (noop transport)'
			)
			return {
				provider: 'noop',
				messageId: null,
				skipped: true
			}
		}
	}
}

export interface TransportOverrides {
	readonly transport?: EmailTransport | undefined
	readonly emailitClient?: EmailitClientLike | undefined
	readonly resendClient?: ResendClientLike | undefined
	readonly nodemailer?: NodemailerFactoryLike | undefined
	readonly dnsLookup?: SmtpDnsLookup | undefined
	readonly fetchImpl?: typeof fetch | undefined
}

export interface ResolvedTransport {
	readonly provider: EmailProviderName
	readonly configured: boolean
	readonly transport: EmailTransport
}

/**
 * Resolve the outbound transport based on `HURIRO_MODE` and `EMAIL_PROVIDER`:
 * - `cloud` (`auto`): uses Emailit (`@emailit/node`) when `EMAILIT_API_KEY` is configured.
 * - `selfhost` (`auto`): prefers Resend (`resend`) when `RESEND_API_KEY` is configured,
 *   otherwise falls back to SMTP (`nodemailer`) when `SMTP_URL` or `SMTP_HOST` is configured.
 * - Unconfigured environments degrade cleanly to `noop`.
 */
export function resolveEmailTransport(
	cfg: EmailPipelineConfig,
	overrides?: TransportOverrides
): ResolvedTransport {
	if (overrides?.transport) {
		const provider = overrides.transport.provider ?? 'custom'
		return {
			provider,
			configured: provider !== 'noop',
			transport: overrides.transport
		}
	}

	const requested = cfg.provider
	const smtp = parseSmtpConfig(cfg)

	const makeEmailit = (): ResolvedTransport => {
		if (!cfg.emailitApiKey) {
			throw new EmailDeliveryError('emailit', 'EMAILIT_API_KEY is required when EMAIL_PROVIDER=emailit')
		}
		return {
			provider: 'emailit',
			configured: true,
			transport: createEmailitTransport({
				apiKey: cfg.emailitApiKey,
				apiBase: cfg.emailitApiBase,
				defaultFrom: cfg.from,
				defaultReplyTo: cfg.replyTo,
				fetchImpl: overrides?.fetchImpl,
				clientOverride: overrides?.emailitClient
			})
		}
	}

	const makeResend = (): ResolvedTransport => {
		if (!cfg.resendApiKey) {
			throw new EmailDeliveryError('resend', 'RESEND_API_KEY is required when EMAIL_PROVIDER=resend')
		}
		return {
			provider: 'resend',
			configured: true,
			transport: createResendTransport({
				apiKey: cfg.resendApiKey,
				defaultFrom: cfg.from,
				defaultReplyTo: cfg.replyTo,
				clientOverride: overrides?.resendClient
			})
		}
	}

	const makeSmtp = (): ResolvedTransport => {
		if (!smtp) {
			throw new EmailDeliveryError('smtp', 'SMTP_URL or SMTP_HOST is required when EMAIL_PROVIDER=smtp')
		}
		return {
			provider: 'smtp',
			configured: true,
			transport: createSmtpTransport({
				host: smtp.host,
				port: smtp.port,
				secure: smtp.secure,
				user: smtp.user,
				pass: smtp.pass,
				defaultFrom: cfg.from,
				defaultReplyTo: cfg.replyTo,
				nodemailerOverride: overrides?.nodemailer,
				dnsLookup: overrides?.dnsLookup
			})
		}
	}

	if (requested === 'noop') {
		return {
			provider: 'noop',
			configured: false,
			transport: createNoopEmailTransport('EMAIL_PROVIDER=noop')
		}
	}
	if (requested === 'emailit') return makeEmailit()
	if (requested === 'resend') return makeResend()
	if (requested === 'smtp') return makeSmtp()

	// Auto selection: Cloud uses Emailit; Self-hosted prefers Resend then SMTP.
	if (cfg.mode === 'cloud') {
		if (cfg.emailitApiKey) return makeEmailit()
		return {
			provider: 'noop',
			configured: false,
			transport: createNoopEmailTransport('cloud Emailit API key not configured')
		}
	}

	if (cfg.resendApiKey) return makeResend()
	if (smtp) return makeSmtp()

	return {
		provider: 'noop',
		configured: false,
		transport: createNoopEmailTransport('self-host Resend or SMTP not configured')
	}
}
