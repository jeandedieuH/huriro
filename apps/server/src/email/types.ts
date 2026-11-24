export type EmailProviderName = 'emailit' | 'resend' | 'smtp' | 'noop' | 'custom'

export interface EmailMessage {
	readonly to: string
	readonly subject: string
	readonly text: string
	readonly html: string
	readonly from?: string | undefined
	readonly replyTo?: string | undefined
	readonly headers?: Record<string, string> | undefined
	readonly tags?: Record<string, string> | undefined
	readonly idempotencyKey?: string | undefined
}

export interface EmailSendResult {
	readonly provider: EmailProviderName
	readonly messageId: string | null
	readonly skipped?: boolean | undefined
}

export interface EmailTransport {
	readonly provider?: EmailProviderName | undefined
	send(message: EmailMessage): Promise<EmailSendResult | void>
}

export interface EmailPipelineConfig {
	readonly mode: 'selfhost' | 'cloud'
	readonly provider: 'auto' | 'resend' | 'smtp' | 'emailit' | 'noop'
	readonly from: string
	readonly replyTo?: string | undefined
	readonly baseUrl: string
	readonly appName?: string | undefined
	readonly requireVerification?: boolean | undefined
	readonly resendApiKey?: string | undefined
	readonly emailitApiKey?: string | undefined
	readonly emailitApiBase?: string | undefined
	readonly smtpUrl?: string | undefined
	readonly smtpHost?: string | undefined
	readonly smtpPort?: number | undefined
	readonly smtpSecure?: boolean | undefined
	readonly smtpUser?: string | undefined
	readonly smtpPass?: string | undefined
}

export interface EmailPipelineStatus {
	readonly configured: boolean
	readonly mode: 'selfhost' | 'cloud'
	readonly provider: EmailProviderName
	readonly from: string
	readonly emailVerificationRequired: boolean
}

export class EmailDeliveryError extends Error {
	readonly provider: EmailProviderName
	readonly retryable: boolean
	override readonly cause?: unknown

	constructor(
		provider: EmailProviderName,
		message: string,
		opts?: { readonly retryable?: boolean | undefined; readonly cause?: unknown }
	) {
		super(message)
		this.name = 'EmailDeliveryError'
		this.provider = provider
		this.retryable = opts?.retryable ?? false
		this.cause = opts?.cause
	}
}
