import { HuriroEmailLayout } from '../components/email-layout'
import {
	CalloutCard,
	FallbackLink,
	MetadataTable,
	Paragraph,
	PrimaryButton
} from '../components/email-primitives'

export interface ChangeEmailConfirmationProps {
	readonly recipientName?: string | undefined
	readonly currentEmail: string
	readonly newEmail: string
	readonly confirmUrl: string
	readonly appName?: string | undefined
	readonly baseUrl?: string | undefined
}

export function ChangeEmailConfirmationEmail({
	recipientName,
	currentEmail,
	newEmail,
	confirmUrl,
	appName = 'Huriro',
	baseUrl
}: ChangeEmailConfirmationProps) {
	const greeting = recipientName?.trim() ? `Hi ${recipientName.trim()},` : 'Hi there,'
	return (
		<HuriroEmailLayout
			previewText={`Confirm changing your ${appName} email to ${newEmail}`}
			eyebrow="Account change"
			heading="Approve email address change"
			subtitle="Verify that you want to move your account login and notifications to a new address."
			tone="info"
			appName={appName}
			baseUrl={baseUrl}
			footerReason={`Sent to your current email address (${currentEmail}) to protect your ${appName} account.`}
		>
			<Paragraph>{greeting}</Paragraph>
			<Paragraph>
				A request was submitted to update the email address associated with your {appName} account. Review the
				change below before confirming.
			</Paragraph>
			<MetadataTable
				rows={[
					{ label: 'Current email', value: currentEmail, monospace: true },
					{ label: 'New email', value: newEmail, monospace: true }
				]}
			/>
			<PrimaryButton href={confirmUrl} label="Confirm email change" tone="brand" />
			<CalloutCard tone="warning" title="Keep your account secure">
				If you did not request this update, do not click the button above and consider rotating your password.
			</CalloutCard>
			<FallbackLink url={confirmUrl} />
		</HuriroEmailLayout>
	)
}

ChangeEmailConfirmationEmail.PreviewProps = {
	recipientName: 'Ada Lovelace',
	currentEmail: 'ada@example.org',
	newEmail: 'ada.lovelace@example.com',
	confirmUrl: 'https://app.huriro.dev/api/auth/verify-email?token=sample_change_token',
	appName: 'Huriro',
	baseUrl: 'https://app.huriro.dev'
} satisfies ChangeEmailConfirmationProps

export default ChangeEmailConfirmationEmail
