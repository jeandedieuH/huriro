import { describe, expect, test } from 'bun:test'
import { ApiConnectionException, ApiErrorException, RateLimitException } from '@emailit/node'
import { createElement } from 'react'
import type { Config } from '../env'
import {
	createEmailitTransport,
	createEmailPipeline,
	createEmailPipelineFromConfig,
	createNoopEmailTransport,
	createResendTransport,
	createSmtpTransport,
	EmailDeliveryError,
	type EmailMessage,
	type EmailTransport,
	parseSmtpConfig,
	renderEmail,
	resolveEmailTransport,
	resolveSmtpConnectionTarget,
	sanitizeHeaderValue,
	toSafeEmailHref,
	VerifyEmail
} from './index'

function createRecorderTransport(): {
	readonly transport: EmailTransport
	readonly messages: EmailMessage[]
} {
	const messages: EmailMessage[] = []
	return {
		messages,
		transport: {
			provider: 'custom',
			async send(message) {
				messages.push(message)
				return {
					provider: 'custom',
					messageId: `rec_${messages.length}`
				}
			}
		}
	}
}

describe('parseSmtpConfig & sanitization', () => {
	test('parses smtps:// and smtp:// URLs with URL-encoded credentials', () => {
		const smtps = parseSmtpConfig({ smtpUrl: 'smtps://user%40dom.com:p%40ss%2B1@smtp.example.com:465' })
		expect(smtps).toEqual({
			host: 'smtp.example.com',
			port: 465,
			secure: true,
			user: 'user@dom.com',
			pass: 'p@ss+1'
		})

		const starttls = parseSmtpConfig({ smtpUrl: 'smtp://mail.internal' })
		expect(starttls).toEqual({
			host: 'mail.internal',
			port: 587,
			secure: false
		})
	})

	test('falls back to structured SMTP_* fields and returns null when unconfigured', () => {
		expect(parseSmtpConfig({})).toBeNull()
		expect(
			parseSmtpConfig({
				smtpHost: 'smtp.postmarkapp.com',
				smtpPort: 587,
				smtpSecure: false,
				smtpUser: 'pm-key',
				smtpPass: 'secret'
			})
		).toEqual({
			host: 'smtp.postmarkapp.com',
			port: 587,
			secure: false,
			user: 'pm-key',
			pass: 'secret'
		})
	})

	test('strips CRLF header injection and unsafe link protocols', () => {
		expect(sanitizeHeaderValue('Hello\r\nBcc: evil@attacker.tld')).toBe('Hello Bcc: evil@attacker.tld')
		expect(toSafeEmailHref('javascript:alert(1)')).toBe('#')
		expect(toSafeEmailHref('data:text/html,<script>alert(1)</script>')).toBe('#')
		expect(toSafeEmailHref('https://app.huriro.dev/reset?token=abc')).toBe(
			'https://app.huriro.dev/reset?token=abc'
		)
	})
})

describe('resolveEmailTransport', () => {
	const baseCfg = {
		from: 'Huriro <noreply@huriro.local>',
		baseUrl: 'https://app.huriro.dev'
	} as const

	test('cloud mode auto selects Emailit when key present and noop when absent', () => {
		const noopRes = resolveEmailTransport({
			...baseCfg,
			mode: 'cloud',
			provider: 'auto'
		})
		expect(noopRes.provider).toBe('noop')
		expect(noopRes.configured).toBe(false)

		const cloudRes = resolveEmailTransport(
			{
				...baseCfg,
				mode: 'cloud',
				provider: 'auto',
				emailitApiKey: 'em_test_key'
			},
			{
				emailitClient: {
					emails: {
						send: async () => ({ id: 'em_1' })
					}
				}
			}
		)
		expect(cloudRes.provider).toBe('emailit')
		expect(cloudRes.configured).toBe(true)
	})

	test('selfhost mode prefers Resend, falls back to SMTP, otherwise noop', () => {
		const resendPreferred = resolveEmailTransport(
			{
				...baseCfg,
				mode: 'selfhost',
				provider: 'auto',
				resendApiKey: 're_test_key',
				smtpHost: 'smtp.example.com'
			},
			{
				resendClient: {
					emails: {
						send: async () => ({ data: { id: 're_1' }, error: null })
					}
				}
			}
		)
		expect(resendPreferred.provider).toBe('resend')
		expect(resendPreferred.configured).toBe(true)

		const smtpFallback = resolveEmailTransport({
			...baseCfg,
			mode: 'selfhost',
			provider: 'auto',
			smtpHost: 'smtp.example.com'
		})
		expect(smtpFallback.provider).toBe('smtp')
		expect(smtpFallback.configured).toBe(true)

		const selfhostNoop = resolveEmailTransport({
			...baseCfg,
			mode: 'selfhost',
			provider: 'auto'
		})
		expect(selfhostNoop.provider).toBe('noop')
		expect(selfhostNoop.configured).toBe(false)
	})

	test('explicit provider missing credentials throws EmailDeliveryError', () => {
		expect(() => resolveEmailTransport({ ...baseCfg, mode: 'selfhost', provider: 'resend' })).toThrow(
			EmailDeliveryError
		)
		expect(() => resolveEmailTransport({ ...baseCfg, mode: 'selfhost', provider: 'smtp' })).toThrow(
			EmailDeliveryError
		)
		expect(() => resolveEmailTransport({ ...baseCfg, mode: 'cloud', provider: 'emailit' })).toThrow(
			EmailDeliveryError
		)

		const explicitNoop = resolveEmailTransport({
			...baseCfg,
			mode: 'cloud',
			provider: 'noop',
			emailitApiKey: 'em_ignored'
		})
		expect(explicitNoop.provider).toBe('noop')
		expect(explicitNoop.configured).toBe(false)
	})
})

describe('provider adapters', () => {
	test('createEmailitTransport sanitizes headers and distinguishes retryable errors', async () => {
		const captured: unknown[] = []
		const okTransport = createEmailitTransport({
			apiKey: 'em_test',
			defaultFrom: 'Huriro <noreply@huriro.dev>',
			defaultReplyTo: 'support@huriro.dev',
			clientOverride: {
				emails: {
					send: async (params) => {
						captured.push(params)
						return { id: 'emailit_msg_1' }
					}
				}
			}
		})

		const res = await okTransport.send({
			to: 'ada@example.com\r\nCc: evil@example.com',
			subject: 'Hello\nWorld',
			html: '<p>Hi</p>',
			text: 'Hi',
			headers: { 'X-Custom': 'val\r\nX-Injected: bad' }
		})
		expect(res).toEqual({ provider: 'emailit', messageId: 'emailit_msg_1' })
		expect(captured[0]).toMatchObject({
			from: 'Huriro <noreply@huriro.dev>',
			to: ['ada@example.com Cc: evil@example.com'],
			subject: 'Hello World',
			reply_to: 'support@huriro.dev',
			headers: { 'X-Custom': 'val X-Injected: bad' }
		})

		const rateLimited = createEmailitTransport({
			apiKey: 'em_test',
			defaultFrom: 'noreply@huriro.dev',
			clientOverride: {
				emails: {
					send: async () => {
						throw new RateLimitException('slow down', 429)
					}
				}
			}
		})
		await expect(
			rateLimited.send({ to: 'a@b.com', subject: 's', html: '<p>x</p>', text: 'x' })
		).rejects.toMatchObject({ provider: 'emailit', retryable: true })

		const validationErr = createEmailitTransport({
			apiKey: 'em_test',
			defaultFrom: 'noreply@huriro.dev',
			clientOverride: {
				emails: {
					send: async () => {
						throw new ApiErrorException('invalid address', 422)
					}
				}
			}
		})
		await expect(
			validationErr.send({ to: 'bad', subject: 's', html: '<p>x</p>', text: 'x' })
		).rejects.toMatchObject({ provider: 'emailit', retryable: false })

		const connErr = createEmailitTransport({
			apiKey: 'em_test',
			defaultFrom: 'noreply@huriro.dev',
			clientOverride: {
				emails: {
					send: async () => {
						throw new ApiConnectionException('network error')
					}
				}
			}
		})
		await expect(
			connErr.send({ to: 'a@b.com', subject: 's', html: '<p>x</p>', text: 'x' })
		).rejects.toMatchObject({ provider: 'emailit', retryable: true })
	})

	test('createResendTransport sends idempotencyKey + sanitized tags and handles API errors', async () => {
		const calls: { payload: unknown; options: unknown }[] = []
		const transport = createResendTransport({
			apiKey: 're_test',
			defaultFrom: 'Huriro <noreply@huriro.dev>',
			clientOverride: {
				emails: {
					send: async (payload, options) => {
						calls.push({ payload, options })
						return { data: { id: 're_msg_42' }, error: null }
					}
				}
			}
		})

		const res = await transport.send({
			to: 'grace@example.com',
			subject: 'Invite',
			html: '<p>Join</p>',
			text: 'Join',
			idempotencyKey: 'invite:1',
			tags: { 'template.name': 'workspace/invite:v1' }
		})
		expect(res).toEqual({ provider: 'resend', messageId: 're_msg_42' })
		expect(calls[0]?.options).toEqual({ idempotencyKey: 'invite:1' })
		expect(calls[0]?.payload).toMatchObject({
			tags: [{ name: 'template_name', value: 'workspace_invite_v1' }]
		})

		const failing = createResendTransport({
			apiKey: 're_test',
			defaultFrom: 'noreply@huriro.dev',
			clientOverride: {
				emails: {
					send: async () => ({
						data: null,
						error: { message: 'server error', statusCode: 500, name: 'internal_server_error' }
					})
				}
			}
		})
		await expect(
			failing.send({ to: 'a@b.com', subject: 's', html: '<p>x</p>', text: 'x' })
		).rejects.toMatchObject({ provider: 'resend', retryable: true })
	})

	test('createSmtpTransport sends mail via nodemailer and closes transport on both success and failure', async () => {
		let closedCount = 0
		const smtpOk = createSmtpTransport({
			host: 'smtp.example.com',
			port: 587,
			secure: false,
			user: 'smtp-user',
			pass: 'smtp-pass',
			defaultFrom: 'noreply@huriro.dev',
			nodemailerOverride: {
				createTransport: () => ({
					sendMail: async () => ({ messageId: '<smtp-1@huriro.dev>' }),
					close: () => {
						closedCount += 1
					}
				})
			}
		})
		const ok = await smtpOk.send({ to: 'a@b.com', subject: 'Hello', html: '<p>Hi</p>', text: 'Hi' })
		expect(ok).toEqual({ provider: 'smtp', messageId: '<smtp-1@huriro.dev>' })
		expect(closedCount).toBe(1)

		const smtpFail = createSmtpTransport({
			host: 'smtp.example.com',
			port: 587,
			secure: false,
			defaultFrom: 'noreply@huriro.dev',
			nodemailerOverride: {
				createTransport: () => ({
					sendMail: async () => {
						throw new Error('ECONNREFUSED')
					},
					close: () => {
						closedCount += 1
					}
				})
			}
		})
		await expect(
			smtpFail.send({ to: 'a@b.com', subject: 'Hello', html: '<p>Hi</p>', text: 'Hi' })
		).rejects.toBeInstanceOf(EmailDeliveryError)
		expect(closedCount).toBe(2)
	})

	test('resolveSmtpConnectionTarget handles IP literals, prefers IPv4, falls back to IPv6, and surfaces EDNS errors', async () => {
		expect(await resolveSmtpConnectionTarget('96.9.126.2')).toEqual({ host: '96.9.126.2' })
		expect(await resolveSmtpConnectionTarget(' 2001:db8::1 ')).toEqual({ host: '2001:db8::1' })

		const v4Preferred = await resolveSmtpConnectionTarget('smtp.emailit.com', async () => [
			{ address: '2001:db8::2', family: 6 },
			{ address: '96.9.126.2', family: 4 }
		])
		expect(v4Preferred).toEqual({ host: '96.9.126.2', servername: 'smtp.emailit.com' })

		const v6Fallback = await resolveSmtpConnectionTarget('v6only.example.com', async () => [
			{ address: '2001:db8::9', family: 6 }
		])
		expect(v6Fallback).toEqual({ host: '2001:db8::9', servername: 'v6only.example.com' })

		await expect(resolveSmtpConnectionTarget('empty.example.com', async () => [])).rejects.toMatchObject({
			code: 'EDNS'
		})
		await expect(
			resolveSmtpConnectionTarget('slow.example.com', () => new Promise(() => {}), 10)
		).rejects.toMatchObject({ code: 'EDNS' })
	})

	test('createSmtpTransport passes pre-resolved IP + SNI servername and wraps DNS failures without calling close', async () => {
		const capturedOptions: unknown[] = []
		let closeCalls = 0
		const smtpWithDns = createSmtpTransport({
			host: 'smtp.emailit.com',
			port: 587,
			secure: false,
			user: 'emailit',
			pass: 'secret',
			defaultFrom: 'noreply@huriro.dev',
			dnsLookup: async () => [{ address: '96.9.126.2', family: 4 }],
			nodemailerOverride: {
				createTransport: (options) => {
					capturedOptions.push(options)
					return {
						sendMail: async () => ({ messageId: '<smtp-dns-1@huriro.dev>' }),
						close: () => {
							closeCalls += 1
						}
					}
				}
			}
		})

		const res = await smtpWithDns.send({ to: 'a@b.com', subject: 'Hello', html: '<p>Hi</p>', text: 'Hi' })
		expect(res).toEqual({ provider: 'smtp', messageId: '<smtp-dns-1@huriro.dev>' })
		expect(capturedOptions[0]).toMatchObject({
			host: '96.9.126.2',
			port: 587,
			secure: false,
			servername: 'smtp.emailit.com',
			tls: { servername: 'smtp.emailit.com' }
		})
		expect(closeCalls).toBe(1)

		const dnsCause = Object.assign(new Error('lookup failed'), { code: 'EDNS' })
		const smtpDnsFail = createSmtpTransport({
			host: 'smtp.emailit.com',
			port: 587,
			secure: false,
			defaultFrom: 'noreply@huriro.dev',
			dnsLookup: async () => {
				throw dnsCause
			},
			nodemailerOverride: {
				createTransport: () => ({
					sendMail: async () => ({ messageId: 'never' }),
					close: () => {
						closeCalls += 1
					}
				})
			}
		})

		let caught: unknown
		try {
			await smtpDnsFail.send({ to: 'a@b.com', subject: 'Hello', html: '<p>Hi</p>', text: 'Hi' })
		} catch (err) {
			caught = err
		}
		expect(caught).toBeInstanceOf(EmailDeliveryError)
		expect((caught as EmailDeliveryError).provider).toBe('smtp')
		expect((caught as EmailDeliveryError).cause).toBe(dnsCause)
		expect(closeCalls).toBe(1)
	})

	test('createNoopEmailTransport marks result skipped', async () => {
		const noop = createNoopEmailTransport('test-reason')
		const res = await noop.send({ to: 'a@b.com', subject: 'Sub', html: '<p>Hi</p>', text: 'Hi' })
		expect(res).toEqual({ provider: 'noop', messageId: null, skipped: true })
	})
})

describe('React Email composition & EmailPipeline templates', () => {
	test('escapes untrusted text and neutralizes javascript: links during rendering', async () => {
		const rendered = await renderEmail(
			createElement(VerifyEmail, {
				recipientName: '<script>alert("xss")</script>',
				verificationUrl: 'javascript:alert(1)',
				appName: 'Huriro',
				baseUrl: 'https://app.huriro.dev'
			}),
			'verify_email'
		)
		expect(rendered.html).not.toContain('<script>alert("xss")</script>')
		expect(rendered.html).toContain('&lt;script&gt;')
		expect(rendered.html).not.toContain('javascript:alert(1)')
		expect(rendered.text.length).toBeGreaterThan(20)
	})

	test('renders and delivers all 14 transactional, notification, billing, and governance templates', async () => {
		const { transport, messages } = createRecorderTransport()
		const pipeline = createEmailPipeline(
			{
				mode: 'cloud',
				provider: 'auto',
				from: 'Huriro <noreply@huriro.dev>',
				replyTo: 'support@huriro.dev',
				baseUrl: 'https://app.huriro.dev',
				requireVerification: true
			},
			{ transport }
		)

		expect(pipeline.getStatus()).toEqual({
			configured: true,
			mode: 'cloud',
			provider: 'custom',
			from: 'Huriro <noreply@huriro.dev>',
			emailVerificationRequired: true
		})

		await pipeline.sendVerifyEmail({
			to: 'u@example.com',
			recipientName: 'Ada',
			verificationUrl: 'https://app.huriro.dev/verify-email?token=v1'
		})
		await pipeline.sendPasswordReset({
			to: 'u@example.com',
			recipientName: 'Ada',
			resetUrl: 'https://app.huriro.dev/reset-password?token=r1'
		})
		await pipeline.sendPasswordChanged({
			to: 'u@example.com',
			recipientName: 'Ada',
			changedAtIso: '2026-11-24T12:00:00.000Z'
		})
		await pipeline.sendChangeEmailConfirmation({
			to: 'u@example.com',
			recipientName: 'Ada',
			currentEmail: 'old@example.com',
			newEmail: 'new@example.com',
			confirmUrl: 'https://app.huriro.dev/api/auth/change-email?token=c1'
		})
		await pipeline.sendWorkspaceInvitation({
			to: 'invitee@example.com',
			workspaceName: 'Acme Eng',
			inviterName: 'Grace',
			role: 'member',
			inviteToken: 'tok_invite_12345'
		})
		await pipeline.sendInvitationAccepted({
			to: 'grace@example.com',
			inviterName: 'Grace',
			memberName: 'Ada',
			memberEmail: 'ada@example.com',
			workspaceName: 'Acme Eng',
			role: 'member'
		})
		await pipeline.sendWelcome({
			to: 'ada@example.com',
			recipientName: 'Ada',
			workspaceName: 'Acme Eng',
			workspaceSlug: 'acme-eng'
		})
		await pipeline.sendNotificationDigest({
			to: 'ada@example.com',
			recipientName: 'Ada',
			workspaceName: 'Acme Eng',
			cadence: 'daily',
			totalUnread: 2,
			items: [
				{
					kind: 'issue.mentioned',
					title: 'Grace mentioned you on ENG-42',
					body: 'Ready for security review',
					createdAt: '2026-11-24T10:00:00Z'
				},
				{
					kind: 'chat.dm',
					title: 'New DM from Grace',
					createdAt: '2026-11-24T11:00:00Z'
				}
			]
		})
		await pipeline.sendInstantNotification({
			to: 'ada@example.com',
			recipientName: 'Ada',
			workspaceName: 'Acme Eng',
			kind: 'issue.assigned',
			title: 'ENG-99 assigned to you',
			body: 'Finalize email templates',
			contextLabel: 'ENG-99',
			actionPath: '/tasks',
			idempotencyKey: 'instant:1'
		})
		await pipeline.sendAgentApprovalRequested({
			to: 'ada@example.com',
			recipientName: 'Ada',
			workspaceName: 'Acme Eng',
			agentName: 'triage-bot',
			toolName: 'issues.close',
			tier: 'R2',
			approvalId: 'apr_1'
		})
		await pipeline.sendBillingUpdate({
			to: 'billing@example.com',
			recipientName: 'Ada',
			workspaceName: 'Acme Eng',
			plan: 'pro',
			status: 'active',
			provider: 'irembopay',
			currency: 'RWF',
			amountCharged: 13850,
			periodEndIso: '2026-12-24T00:00:00Z'
		})
		await pipeline.sendWorkspaceExportReady({
			to: 'ada@example.com',
			recipientName: 'Ada',
			workspaceName: 'Acme Eng',
			exportId: 'exp_1',
			byteSize: 245760,
			expiresAtIso: '2026-11-25T12:00:00Z',
			manifestSummary: { issues: 14, docPages: 8, chatMessages: 120, mailConversations: 5 }
		})
		await pipeline.sendAccountErased({
			to: 'ada@example.com',
			erasedAtIso: '2026-11-24T12:30:00Z',
			revokedWorkspaceCount: 2
		})
		await pipeline.sendTestEmail({
			to: 'ops@example.com',
			workspaceName: 'Acme Eng'
		})

		expect(messages).toHaveLength(14)
		for (const msg of messages) {
			expect(msg.from).toBe('Huriro <noreply@huriro.dev>')
			expect(msg.replyTo).toBe('support@huriro.dev')
			expect(msg.html).toContain('<!DOCTYPE html')
			expect(msg.html).toContain('#D91E48')
			expect(msg.text.trim().length).toBeGreaterThan(20)
		}
		expect(messages[4]?.html).toContain('invite=tok_invite_12345')
		expect(messages[10]?.html).toContain('13,850 RWF')
	})

	test('createEmailPipelineFromConfig degrades gracefully on minimal config', () => {
		const pipeline = createEmailPipelineFromConfig({
			HURIRO_URL: 'https://app.test.huriro.dev',
			HURIRO_ENV: 'test',
			HURIRO_MODE: 'selfhost',
			PASSKEY_RP_NAME: 'Huriro'
		} as Config)
		expect(pipeline.provider).toBe('noop')
		expect(pipeline.configured).toBe(false)
		expect(pipeline.emailVerificationRequired).toBe(false)
		expect(pipeline.from).toBe('noreply@huriro.local')
	})
})
