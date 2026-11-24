import { HuriroEmailLayout } from '../components/email-layout'
import { CalloutCard, MetadataTable, Paragraph, PrimaryButton } from '../components/email-primitives'

export interface PasswordChangedEmailProps {
	readonly recipientName?: string | undefined
	readonly changedAtIso: string
	readonly signInUrl: string
	readonly appName?: string | undefined
	readonly baseUrl?: string | undefined
}

export function PasswordChangedEmail({
	recipientName,
	changedAtIso,
	signInUrl,
	appName = 'Huriro',
	baseUrl
}: PasswordChangedEmailProps) {
	const greeting = recipientName?.trim() ? `Hi ${recipientName.trim()},` : 'Hi there,'
	return (
		<HuriroEmailLayout
			previewText={`Your ${appName} password was updated`}
			eyebrow="Security notice"
			heading="Your password was changed"
			subtitle="Your credentials were updated and existing sessions were signed out for your protection."
			tone="success"
			appName={appName}
			baseUrl={baseUrl}
			footerReason={`Security confirmation sent automatically for your ${appName} account.`}
		>
			<Paragraph>{greeting}</Paragraph>
			<Paragraph>
				This is a confirmation that the password for your {appName} account was just reset. All previously
				active sessions have been revoked.
			</Paragraph>
			<MetadataTable
				rows={[
					{ label: 'Event', value: 'Password updated' },
					{ label: 'Timestamp (UTC)', value: changedAtIso, monospace: true },
					{ label: 'Sessions', value: 'Revoked across devices' }
				]}
			/>
			<PrimaryButton href={signInUrl} label="Sign in with new password" tone="brand" />
			<CalloutCard tone="danger" title="Wasn't you?">
				If you did not authorize this change, contact your workspace administrator immediately and secure your
				email account.
			</CalloutCard>
		</HuriroEmailLayout>
	)
}

PasswordChangedEmail.PreviewProps = {
	recipientName: 'Ada Lovelace',
	changedAtIso: '2026-11-24T15:00:00.000Z',
	signInUrl: 'https://app.huriro.dev/sign-in',
	appName: 'Huriro',
	baseUrl: 'https://app.huriro.dev'
} satisfies PasswordChangedEmailProps

export default PasswordChangedEmail
