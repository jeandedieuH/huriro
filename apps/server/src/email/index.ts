export {
	HuriroEmailLayout,
	type HuriroEmailLayoutProps
} from './components/email-layout'
export {
	CalloutCard,
	CodeBlock,
	EmailDivider,
	FallbackLink,
	MetadataTable,
	NotificationItemCard,
	Paragraph,
	PrimaryButton,
	SecondaryButton,
	StatusBadge
} from './components/email-primitives'
export { EMAIL_COLORS, EMAIL_TONES, type EmailTone, toSafeEmailHref } from './components/theme'
export { type RenderedEmail, renderEmail } from './render'
export {
	createEmailPipeline,
	createEmailPipelineFromConfig,
	type EmailPipeline
} from './service'
export { AccountErasedEmail, type AccountErasedEmailProps } from './templates/account-erased'
export {
	AgentApprovalRequestedEmail,
	type AgentApprovalRequestedEmailProps
} from './templates/agent-approval-requested'
export { BillingUpdateEmail, type BillingUpdateEmailProps } from './templates/billing-update'
export {
	ChangeEmailConfirmationEmail,
	type ChangeEmailConfirmationProps
} from './templates/change-email-confirmation'
export {
	InstantNotificationEmail,
	type InstantNotificationEmailProps
} from './templates/instant-notification'
export {
	InvitationAcceptedEmail,
	type InvitationAcceptedEmailProps
} from './templates/invitation-accepted'
export {
	type DigestNotificationItem,
	NotificationDigestEmail,
	type NotificationDigestEmailProps
} from './templates/notification-digest'
export { PasswordChangedEmail, type PasswordChangedEmailProps } from './templates/password-changed'
export { PasswordResetEmail, type PasswordResetEmailProps } from './templates/password-reset'
export { TestEmail, type TestEmailProps } from './templates/test-email'
export { VerifyEmail, type VerifyEmailProps } from './templates/verify-email'
export { WelcomeEmail, type WelcomeEmailProps } from './templates/welcome'
export {
	WorkspaceExportReadyEmail,
	type WorkspaceExportReadyEmailProps
} from './templates/workspace-export-ready'
export {
	WorkspaceInvitationEmail,
	type WorkspaceInvitationEmailProps
} from './templates/workspace-invitation'
export {
	createEmailitTransport,
	createNoopEmailTransport,
	createResendTransport,
	createSmtpTransport,
	type DnsLookupAddress,
	type EmailitClientLike,
	type NodemailerFactoryLike,
	type NodemailerTransportLike,
	type ParsedSmtpConfig,
	parseSmtpConfig,
	type ResendClientLike,
	type ResolvedSmtpTarget,
	type ResolvedTransport,
	resolveEmailTransport,
	resolveSmtpConnectionTarget,
	type SmtpDnsLookup,
	sanitizeHeaderValue,
	type TransportOverrides
} from './transports'
export {
	EmailDeliveryError,
	type EmailMessage,
	type EmailPipelineConfig,
	type EmailPipelineStatus,
	type EmailProviderName,
	type EmailSendResult,
	type EmailTransport
} from './types'
