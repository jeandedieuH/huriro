import { createElement, type ReactElement } from 'react'
import { emailsTotal, hashForLog, log } from '../api/observability'
import type { Config } from '../env'
import { renderEmail } from './render'
import { AccountErasedEmail } from './templates/account-erased'
import { AgentApprovalRequestedEmail } from './templates/agent-approval-requested'
import { BillingUpdateEmail } from './templates/billing-update'
import { ChangeEmailConfirmationEmail } from './templates/change-email-confirmation'
import { InstantNotificationEmail } from './templates/instant-notification'
import { InvitationAcceptedEmail } from './templates/invitation-accepted'
import { type DigestNotificationItem, NotificationDigestEmail } from './templates/notification-digest'
import { PasswordChangedEmail } from './templates/password-changed'
import { PasswordResetEmail } from './templates/password-reset'
import { TestEmail } from './templates/test-email'
import { VerifyEmail } from './templates/verify-email'
import { WelcomeEmail } from './templates/welcome'
import { WorkspaceExportReadyEmail } from './templates/workspace-export-ready'
import { WorkspaceInvitationEmail } from './templates/workspace-invitation'
import { resolveEmailTransport, type TransportOverrides } from './transports'
import type {
	EmailMessage,
	EmailPipelineConfig,
	EmailPipelineStatus,
	EmailProviderName,
	EmailSendResult,
	EmailTransport
} from './types'

export interface EmailPipeline {
	readonly provider: EmailProviderName
	readonly configured: boolean
	readonly mode: 'selfhost' | 'cloud'
	readonly from: string
	readonly emailVerificationRequired: boolean
	readonly baseUrl: string
	readonly appName: string
	readonly transport: EmailTransport
	getStatus(): EmailPipelineStatus
	sendRaw(message: EmailMessage, templateName?: string): Promise<EmailSendResult>
	sendVerifyEmail(args: {
		readonly to: string
		readonly recipientName?: string | undefined
		readonly verificationUrl: string
		readonly expiresInLabel?: string | undefined
	}): Promise<EmailSendResult>
	sendPasswordReset(args: {
		readonly to: string
		readonly recipientName?: string | undefined
		readonly resetUrl: string
		readonly expiresInLabel?: string | undefined
	}): Promise<EmailSendResult>
	sendPasswordChanged(args: {
		readonly to: string
		readonly recipientName?: string | undefined
		readonly changedAtIso?: string | undefined
	}): Promise<EmailSendResult>
	sendChangeEmailConfirmation(args: {
		readonly to: string
		readonly recipientName?: string | undefined
		readonly currentEmail: string
		readonly newEmail: string
		readonly confirmUrl: string
	}): Promise<EmailSendResult>
	sendWorkspaceInvitation(args: {
		readonly to: string
		readonly workspaceName: string
		readonly inviterName: string
		readonly role: string
		readonly inviteToken: string
		readonly expiresAtLabel?: string | undefined
	}): Promise<EmailSendResult>
	sendInvitationAccepted(args: {
		readonly to: string
		readonly inviterName: string
		readonly memberName: string
		readonly memberEmail: string
		readonly workspaceName: string
		readonly role: string
	}): Promise<EmailSendResult>
	sendWelcome(args: {
		readonly to: string
		readonly recipientName: string
		readonly workspaceName: string
		readonly workspaceSlug: string
	}): Promise<EmailSendResult>
	sendNotificationDigest(args: {
		readonly to: string
		readonly recipientName: string
		readonly workspaceName: string
		readonly cadence: 'hourly' | 'daily'
		readonly totalUnread: number
		readonly items: readonly DigestNotificationItem[]
	}): Promise<EmailSendResult>
	sendInstantNotification(args: {
		readonly to: string
		readonly recipientName: string
		readonly workspaceName: string
		readonly kind: string
		readonly title: string
		readonly body?: string | undefined
		readonly contextLabel?: string | undefined
		readonly actionPath?: string | undefined
		readonly idempotencyKey?: string | undefined
	}): Promise<EmailSendResult>
	sendAgentApprovalRequested(args: {
		readonly to: string
		readonly recipientName: string
		readonly workspaceName: string
		readonly agentName: string
		readonly toolName: string
		readonly tier: string
		readonly approvalId: string
		readonly idempotencyKey?: string | undefined
	}): Promise<EmailSendResult>
	sendBillingUpdate(args: {
		readonly to: string
		readonly recipientName?: string | undefined
		readonly workspaceName: string
		readonly plan: 'free' | 'pro' | 'enterprise'
		readonly status: 'active' | 'trialing' | 'past_due' | 'canceled' | 'incomplete'
		readonly provider: string
		readonly currency: 'USD' | 'RWF'
		readonly amountCharged: number
		readonly periodEndIso?: string | null | undefined
		readonly idempotencyKey?: string | undefined
	}): Promise<EmailSendResult>
	sendWorkspaceExportReady(args: {
		readonly to: string
		readonly recipientName: string
		readonly workspaceName: string
		readonly exportId: string
		readonly byteSize: number
		readonly expiresAtIso?: string | null | undefined
		readonly manifestSummary: {
			readonly issues?: number | undefined
			readonly docPages?: number | undefined
			readonly chatMessages?: number | undefined
			readonly mailConversations?: number | undefined
		}
		readonly idempotencyKey?: string | undefined
	}): Promise<EmailSendResult>
	sendAccountErased(args: {
		readonly to: string
		readonly erasedAtIso?: string | undefined
		readonly revokedWorkspaceCount: number
	}): Promise<EmailSendResult>
	sendTestEmail(args: { readonly to: string; readonly workspaceName: string }): Promise<EmailSendResult>
}

function joinBaseUrl(baseUrl: string, path: string): string {
	const base = baseUrl.replace(/\/+$/, '')
	if (path.startsWith('http://') || path.startsWith('https://')) return path
	return `${base}${path.startsWith('/') ? path : `/${path}`}`
}

export function createEmailPipeline(cfg: EmailPipelineConfig, overrides?: TransportOverrides): EmailPipeline {
	const resolved = resolveEmailTransport(cfg, overrides)
	const baseUrl = cfg.baseUrl.replace(/\/+$/, '')
	const appName = cfg.appName?.trim() || 'Huriro'
	const emailVerificationRequired = Boolean(cfg.requireVerification && resolved.configured)

	async function sendRaw(message: EmailMessage, templateName = 'custom'): Promise<EmailSendResult> {
		const msg: EmailMessage = {
			...message,
			from: message.from ?? cfg.from,
			...((message.replyTo ?? cfg.replyTo) ? { replyTo: message.replyTo ?? cfg.replyTo } : {})
		}
		try {
			const result = await resolved.transport.send(msg)
			const normalized: EmailSendResult = result ?? {
				provider: resolved.provider,
				messageId: null,
				skipped: resolved.provider === 'noop'
			}
			const metricStatus = normalized.skipped ? 'skipped' : 'sent'
			emailsTotal.labels(templateName, normalized.provider, metricStatus).inc()
			log.info(
				{
					template: templateName,
					provider: normalized.provider,
					status: metricStatus,
					toHash: hashForLog(msg.to),
					messageId: normalized.messageId
				},
				'email processed'
			)
			return normalized
		} catch (err) {
			emailsTotal.labels(templateName, resolved.provider, 'failed').inc()
			log.error(
				{
					err,
					template: templateName,
					provider: resolved.provider,
					toHash: hashForLog(msg.to)
				},
				'email delivery failed'
			)
			throw err
		}
	}

	async function renderAndSend(args: {
		readonly template: string
		readonly to: string
		readonly subject: string
		readonly element: ReactElement
		readonly idempotencyKey?: string | undefined
		readonly tags?: Record<string, string> | undefined
	}): Promise<EmailSendResult> {
		const rendered = await renderEmail(args.element, args.template)
		return sendRaw(
			{
				to: args.to,
				subject: args.subject,
				html: rendered.html,
				text: rendered.text,
				...(args.idempotencyKey ? { idempotencyKey: args.idempotencyKey } : {}),
				tags: { template: args.template, ...args.tags }
			},
			args.template
		)
	}

	const preferencesUrl = joinBaseUrl(baseUrl, '/settings?section=notifications')

	return {
		provider: resolved.provider,
		configured: resolved.configured,
		mode: cfg.mode,
		from: cfg.from,
		emailVerificationRequired,
		baseUrl,
		appName,
		transport: resolved.transport,

		getStatus(): EmailPipelineStatus {
			return {
				configured: resolved.configured,
				mode: cfg.mode,
				provider: resolved.provider,
				from: cfg.from,
				emailVerificationRequired
			}
		},

		sendRaw,

		async sendVerifyEmail(args) {
			return renderAndSend({
				template: 'verify_email',
				to: args.to,
				subject: `Verify your ${appName} email address`,
				element: createElement(VerifyEmail, {
					recipientName: args.recipientName,
					verificationUrl: args.verificationUrl,
					expiresInLabel: args.expiresInLabel,
					appName,
					baseUrl
				})
			})
		},

		async sendPasswordReset(args) {
			return renderAndSend({
				template: 'password_reset',
				to: args.to,
				subject: `Reset your ${appName} password`,
				element: createElement(PasswordResetEmail, {
					recipientName: args.recipientName,
					resetUrl: args.resetUrl,
					expiresInLabel: args.expiresInLabel,
					appName,
					baseUrl
				})
			})
		},

		async sendPasswordChanged(args) {
			return renderAndSend({
				template: 'password_changed',
				to: args.to,
				subject: `Your ${appName} password was changed`,
				element: createElement(PasswordChangedEmail, {
					recipientName: args.recipientName,
					changedAtIso: args.changedAtIso ?? new Date().toISOString(),
					signInUrl: joinBaseUrl(baseUrl, '/sign-in'),
					appName,
					baseUrl
				})
			})
		},

		async sendChangeEmailConfirmation(args) {
			return renderAndSend({
				template: 'change_email_confirmation',
				to: args.to,
				subject: `Approve email address change on ${appName}`,
				element: createElement(ChangeEmailConfirmationEmail, {
					recipientName: args.recipientName,
					currentEmail: args.currentEmail,
					newEmail: args.newEmail,
					confirmUrl: args.confirmUrl,
					appName,
					baseUrl
				})
			})
		},

		async sendWorkspaceInvitation(args) {
			const acceptUrl = joinBaseUrl(baseUrl, `/onboarding?invite=${encodeURIComponent(args.inviteToken)}`)
			return renderAndSend({
				template: 'workspace_invitation',
				to: args.to,
				subject: `${args.inviterName} invited you to join ${args.workspaceName} on ${appName}`,
				element: createElement(WorkspaceInvitationEmail, {
					workspaceName: args.workspaceName,
					inviterName: args.inviterName,
					role: args.role,
					acceptUrl,
					inviteToken: args.inviteToken,
					expiresAtLabel: args.expiresAtLabel,
					appName,
					baseUrl
				})
			})
		},

		async sendInvitationAccepted(args) {
			return renderAndSend({
				template: 'invitation_accepted',
				to: args.to,
				subject: `${args.memberName} joined ${args.workspaceName}`,
				element: createElement(InvitationAcceptedEmail, {
					inviterName: args.inviterName,
					memberName: args.memberName,
					memberEmail: args.memberEmail,
					workspaceName: args.workspaceName,
					role: args.role,
					membersUrl: joinBaseUrl(baseUrl, '/settings?section=members'),
					appName,
					baseUrl
				})
			})
		},

		async sendWelcome(args) {
			return renderAndSend({
				template: 'welcome',
				to: args.to,
				subject: `Welcome to ${appName} — ${args.workspaceName} is ready`,
				element: createElement(WelcomeEmail, {
					recipientName: args.recipientName,
					workspaceName: args.workspaceName,
					workspaceSlug: args.workspaceSlug,
					workspaceUrl: joinBaseUrl(baseUrl, '/'),
					appName,
					baseUrl
				})
			})
		},

		async sendNotificationDigest(args) {
			return renderAndSend({
				template: 'notification_digest',
				to: args.to,
				subject: `[${args.workspaceName}] ${args.totalUnread} unread notification${args.totalUnread === 1 ? '' : 's'}`,
				element: createElement(NotificationDigestEmail, {
					recipientName: args.recipientName,
					workspaceName: args.workspaceName,
					cadence: args.cadence,
					totalUnread: args.totalUnread,
					items: args.items,
					inboxUrl: joinBaseUrl(baseUrl, '/inbox'),
					preferencesUrl,
					appName,
					baseUrl
				})
			})
		},

		async sendInstantNotification(args) {
			return renderAndSend({
				template: 'instant_notification',
				to: args.to,
				subject: `[${args.workspaceName}] ${args.title}`,
				idempotencyKey: args.idempotencyKey,
				element: createElement(InstantNotificationEmail, {
					recipientName: args.recipientName,
					workspaceName: args.workspaceName,
					kind: args.kind,
					title: args.title,
					body: args.body,
					contextLabel: args.contextLabel,
					actionUrl: joinBaseUrl(baseUrl, args.actionPath ?? '/inbox'),
					preferencesUrl,
					appName,
					baseUrl
				})
			})
		},

		async sendAgentApprovalRequested(args) {
			return renderAndSend({
				template: 'agent_approval_requested',
				to: args.to,
				subject: `[${args.workspaceName}] Approval needed: ${args.toolName} (${args.agentName})`,
				idempotencyKey: args.idempotencyKey,
				element: createElement(AgentApprovalRequestedEmail, {
					recipientName: args.recipientName,
					workspaceName: args.workspaceName,
					agentName: args.agentName,
					toolName: args.toolName,
					tier: args.tier,
					approvalId: args.approvalId,
					reviewUrl: joinBaseUrl(baseUrl, '/settings?section=approvals'),
					preferencesUrl,
					appName,
					baseUrl
				})
			})
		},

		async sendBillingUpdate(args) {
			const statusLabel =
				args.status === 'past_due'
					? 'Payment attention needed'
					: args.status === 'canceled'
						? 'Subscription canceled'
						: `${args.plan.toUpperCase()} subscription active`
			return renderAndSend({
				template: 'billing_update',
				to: args.to,
				subject: `[${args.workspaceName}] ${statusLabel}`,
				idempotencyKey: args.idempotencyKey,
				element: createElement(BillingUpdateEmail, {
					recipientName: args.recipientName,
					workspaceName: args.workspaceName,
					plan: args.plan,
					status: args.status,
					provider: args.provider,
					currency: args.currency,
					amountCharged: args.amountCharged,
					periodEndIso: args.periodEndIso,
					billingUrl: joinBaseUrl(baseUrl, '/settings?section=billing'),
					appName,
					baseUrl
				})
			})
		},

		async sendWorkspaceExportReady(args) {
			return renderAndSend({
				template: 'workspace_export_ready',
				to: args.to,
				subject: `[${args.workspaceName}] Workspace export ready for download`,
				idempotencyKey: args.idempotencyKey,
				element: createElement(WorkspaceExportReadyEmail, {
					recipientName: args.recipientName,
					workspaceName: args.workspaceName,
					exportId: args.exportId,
					byteSize: args.byteSize,
					expiresAtIso: args.expiresAtIso,
					downloadUrl: joinBaseUrl(baseUrl, '/settings?section=governance'),
					manifestSummary: args.manifestSummary,
					appName,
					baseUrl
				})
			})
		},

		async sendAccountErased(args) {
			return renderAndSend({
				template: 'account_erased',
				to: args.to,
				subject: `Your ${appName} account erasure is complete`,
				element: createElement(AccountErasedEmail, {
					erasedAtIso: args.erasedAtIso ?? new Date().toISOString(),
					revokedWorkspaceCount: args.revokedWorkspaceCount,
					appName,
					baseUrl
				})
			})
		},

		async sendTestEmail(args) {
			return renderAndSend({
				template: 'test_email',
				to: args.to,
				subject: `[${args.workspaceName}] ${appName} email pipeline test (${resolved.provider})`,
				element: createElement(TestEmail, {
					workspaceName: args.workspaceName,
					provider: resolved.provider,
					fromAddress: cfg.from,
					recipientEmail: args.to,
					sentAtIso: new Date().toISOString(),
					settingsUrl: preferencesUrl,
					appName,
					baseUrl
				})
			})
		}
	}
}

export function createEmailPipelineFromConfig(config: Config, overrides?: TransportOverrides): EmailPipeline {
	return createEmailPipeline(
		{
			mode: config.HURIRO_MODE ?? 'selfhost',
			provider: config.EMAIL_PROVIDER ?? 'auto',
			from: config.emailFrom ?? config.SMTP_FROM ?? 'noreply@huriro.local',
			replyTo: config.EMAIL_REPLY_TO,
			baseUrl: config.HURIRO_URL,
			appName: config.PASSKEY_RP_NAME ?? 'Huriro',
			requireVerification: config.EMAIL_REQUIRE_VERIFICATION ?? false,
			resendApiKey: config.resendApiKey,
			emailitApiKey: config.emailitApiKey,
			emailitApiBase: config.EMAILIT_API_BASE,
			smtpUrl: config.smtpUrl,
			smtpHost: config.SMTP_HOST,
			smtpPort: config.SMTP_PORT,
			smtpSecure: config.SMTP_SECURE,
			smtpUser: config.SMTP_USER,
			smtpPass: config.smtpPass
		},
		overrides
	)
}
