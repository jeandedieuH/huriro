import { HuriroEmailLayout } from '../components/email-layout'
import {
	CalloutCard,
	FallbackLink,
	MetadataTable,
	Paragraph,
	PrimaryButton
} from '../components/email-primitives'

export interface PasswordResetEmailProps {
	readonly recipientName?: string | undefined
	readonly resetUrl: string
	readonly expiresInLabel?: string | undefined
	readonly appName?: string | undefined
	readonly baseUrl?: string | undefined
}

export function PasswordResetEmail({
	recipientName,
	resetUrl,
	expiresInLabel = '1 hour',
	appName = 'Huriro',
	baseUrl
}: PasswordResetEmailProps) {
	const greeting = recipientName?.trim() ? `Hi ${recipientName.trim()},` : 'Hi there,'
	return (
		<HuriroEmailLayout
			previewText={`Reset your ${appName} password`}
			eyebrow="Password recovery"
			heading="Reset your password"
			subtitle="Use this one-time link to choose a new password for your account."
			tone="warning"
			appName={appName}
			baseUrl={baseUrl}
			footerReason={`You received this email because someone requested a password reset for your ${appName} account.`}
		>
			<Paragraph>{greeting}</Paragraph>
			<Paragraph>
				We received a request to reset your {appName} password. Select the button below to set a new password.
			</Paragraph>
			<PrimaryButton href={resetUrl} label="Reset password" tone="brand" />
			<MetadataTable
				rows={[
					{ label: 'Expires in', value: expiresInLabel },
					{ label: 'Session impact', value: 'Active sessions revoke on reset' }
				]}
			/>
			<CalloutCard tone="warning" title="Didn't request a reset?">
				Your password has not changed. If you did not request this link, you can safely ignore this email—we
				recommend reviewing your active passkeys and two-factor authentication settings if this persists.
			</CalloutCard>
			<FallbackLink url={resetUrl} />
		</HuriroEmailLayout>
	)
}

PasswordResetEmail.PreviewProps = {
	recipientName: 'Ada Lovelace',
	resetUrl: 'https://app.huriro.dev/reset-password?token=sample_reset_token',
	expiresInLabel: '1 hour',
	appName: 'Huriro',
	baseUrl: 'https://app.huriro.dev'
} satisfies PasswordResetEmailProps

export default PasswordResetEmail
