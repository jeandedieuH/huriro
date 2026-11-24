import { HuriroEmailLayout } from '../components/email-layout'
import { CalloutCard, MetadataTable, Paragraph } from '../components/email-primitives'

export interface AccountErasedEmailProps {
	readonly erasedAtIso: string
	readonly revokedWorkspaceCount: number
	readonly appName?: string | undefined
	readonly baseUrl?: string | undefined
}

export function AccountErasedEmail({
	erasedAtIso,
	revokedWorkspaceCount,
	appName = 'Huriro',
	baseUrl
}: AccountErasedEmailProps) {
	return (
		<HuriroEmailLayout
			previewText={`Confirmation: your ${appName} account identity has been erased`}
			eyebrow="GDPR Art. 17 receipt"
			heading="Account erasure completed"
			subtitle="Your personal profile, active sessions, push tokens, and authentication credentials have been removed."
			tone="neutral"
			appName={appName}
			baseUrl={baseUrl}
			footerReason={`Final confirmation receipt sent prior to removing your email address from ${appName}.`}
		>
			<Paragraph>
				This email confirms that your self-service identity erasure request on {appName} completed
				successfully.
			</Paragraph>
			<MetadataTable
				rows={[
					{ label: 'Completed at (UTC)', value: erasedAtIso, monospace: true },
					{ label: 'Workspaces disconnected', value: String(revokedWorkspaceCount) },
					{ label: 'Credentials & sessions', value: 'Revoked and deleted' },
					{ label: 'Push subscriptions', value: 'Deleted' }
				]}
			/>
			<CalloutCard tone="neutral" title="No further action required">
				Your email address is no longer stored on {appName}. This confirmation is the final message you will
				receive from this instance unless you register a new account in the future.
			</CalloutCard>
		</HuriroEmailLayout>
	)
}

AccountErasedEmail.PreviewProps = {
	erasedAtIso: '2026-11-24T15:00:00.000Z',
	revokedWorkspaceCount: 2,
	appName: 'Huriro',
	baseUrl: 'https://app.huriro.dev'
} satisfies AccountErasedEmailProps

export default AccountErasedEmail
