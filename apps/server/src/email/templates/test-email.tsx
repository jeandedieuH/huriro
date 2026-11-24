import { HuriroEmailLayout } from '../components/email-layout'
import { CalloutCard, MetadataTable, Paragraph, PrimaryButton } from '../components/email-primitives'

export interface TestEmailProps {
	readonly workspaceName: string
	readonly provider: string
	readonly fromAddress: string
	readonly recipientEmail: string
	readonly sentAtIso: string
	readonly settingsUrl: string
	readonly appName?: string | undefined
	readonly baseUrl?: string | undefined
}

export function TestEmail({
	workspaceName,
	provider,
	fromAddress,
	recipientEmail,
	sentAtIso,
	settingsUrl,
	appName = 'Huriro',
	baseUrl
}: TestEmailProps) {
	const providerLabel =
		provider === 'emailit'
			? 'Emailit (Cloud)'
			: provider === 'resend'
				? 'Resend (Self-hosted)'
				: provider === 'smtp'
					? 'SMTP Relay (Self-hosted)'
					: provider

	return (
		<HuriroEmailLayout
			previewText={`${appName} email pipeline test succeeded via ${providerLabel}`}
			eyebrow="Pipeline diagnostics"
			heading="Email delivery is working"
			subtitle={`Your ${appName} instance successfully rendered and dispatched this React Email diagnostic message.`}
			tone="success"
			workspaceName={workspaceName}
			appName={appName}
			baseUrl={baseUrl}
			footerReason={`Diagnostic test triggered by a workspace administrator in ${workspaceName}.`}
		>
			<Paragraph>
				Everything is wired up properly. Both HTML and plain-text MIME representations were generated and
				delivered through your configured transport.
			</Paragraph>
			<MetadataTable
				rows={[
					{ label: 'Transport provider', value: providerLabel },
					{ label: 'From address', value: fromAddress, monospace: true },
					{ label: 'Recipient', value: recipientEmail, monospace: true },
					{ label: 'Workspace', value: workspaceName },
					{ label: 'Sent at (UTC)', value: sentAtIso, monospace: true }
				]}
			/>
			<CalloutCard tone="success" title="Pipeline ready">
				Verification emails, password recovery, workspace invitations, instant alerts, and scheduled digests
				will deliver using this provider configuration.
			</CalloutCard>
			<PrimaryButton href={settingsUrl} label="Return to notification settings" tone="brand" />
		</HuriroEmailLayout>
	)
}

TestEmail.PreviewProps = {
	workspaceName: 'Acme Engineering',
	provider: 'resend',
	fromAddress: 'Huriro <noreply@acme.dev>',
	recipientEmail: 'admin@acme.dev',
	sentAtIso: '2026-11-24T15:00:00.000Z',
	settingsUrl: 'https://app.huriro.dev/settings?section=notifications',
	appName: 'Huriro',
	baseUrl: 'https://app.huriro.dev'
} satisfies TestEmailProps

export default TestEmail
