import { HuriroEmailLayout } from '../components/email-layout'
import {
	CalloutCard,
	FallbackLink,
	MetadataTable,
	Paragraph,
	PrimaryButton
} from '../components/email-primitives'

export interface VerifyEmailProps {
	readonly recipientName?: string | undefined
	readonly verificationUrl: string
	readonly expiresInLabel?: string | undefined
	readonly appName?: string | undefined
	readonly baseUrl?: string | undefined
}

export function VerifyEmail({
	recipientName,
	verificationUrl,
	expiresInLabel = '24 hours',
	appName = 'Huriro',
	baseUrl
}: VerifyEmailProps) {
	const greeting = recipientName?.trim() ? `Hi ${recipientName.trim()},` : 'Hi there,'
	return (
		<HuriroEmailLayout
			previewText={`Verify your email address to activate your ${appName} account`}
			eyebrow="Account security"
			heading="Verify your email address"
			subtitle="Confirm this address belongs to you to unlock sign-in, workspace invitations, and security alerts."
			tone="brand"
			appName={appName}
			baseUrl={baseUrl}
			footerReason={`You received this message because a ${appName} account was registered with this email address.`}
		>
			<Paragraph>{greeting}</Paragraph>
			<Paragraph>
				Welcome to {appName}. Click the button below to verify your email address and finish setting up your
				account.
			</Paragraph>
			<PrimaryButton href={verificationUrl} label="Verify email address" tone="brand" />
			<MetadataTable rows={[{ label: 'Link validity', value: expiresInLabel }]} />
			<CalloutCard tone="info" title="Didn't create an account?">
				If you did not sign up for {appName}, you can safely ignore this email—no account will be activated
				without confirmation.
			</CalloutCard>
			<FallbackLink url={verificationUrl} />
		</HuriroEmailLayout>
	)
}

VerifyEmail.PreviewProps = {
	recipientName: 'Ada Lovelace',
	verificationUrl: 'https://app.huriro.dev/api/auth/verify-email?token=sample_verification_token',
	expiresInLabel: '24 hours',
	appName: 'Huriro',
	baseUrl: 'https://app.huriro.dev'
} satisfies VerifyEmailProps

export default VerifyEmail
