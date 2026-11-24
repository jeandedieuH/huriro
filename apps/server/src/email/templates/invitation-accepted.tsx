import { HuriroEmailLayout } from '../components/email-layout'
import { MetadataTable, Paragraph, PrimaryButton } from '../components/email-primitives'

export interface InvitationAcceptedEmailProps {
	readonly inviterName: string
	readonly memberName: string
	readonly memberEmail: string
	readonly workspaceName: string
	readonly role: string
	readonly membersUrl: string
	readonly appName?: string | undefined
	readonly baseUrl?: string | undefined
}

export function InvitationAcceptedEmail({
	inviterName,
	memberName,
	memberEmail,
	workspaceName,
	role,
	membersUrl,
	appName = 'Huriro',
	baseUrl
}: InvitationAcceptedEmailProps) {
	const roleLabel = role.charAt(0).toUpperCase() + role.slice(1)
	return (
		<HuriroEmailLayout
			previewText={`${memberName} accepted your invitation to ${workspaceName}`}
			eyebrow="Team update"
			heading={`${memberName} joined ${workspaceName}`}
			subtitle="Your workspace invitation has been accepted and their seat is now active."
			tone="success"
			workspaceName={workspaceName}
			appName={appName}
			baseUrl={baseUrl}
			footerReason={`You received this notification because you invited ${memberEmail} to ${workspaceName}.`}
		>
			<Paragraph>Hi {inviterName},</Paragraph>
			<Paragraph>
				<strong>{memberName}</strong> accepted your invitation and is now an active member of{' '}
				<strong>{workspaceName}</strong>.
			</Paragraph>
			<MetadataTable
				rows={[
					{ label: 'Member', value: memberName },
					{ label: 'Email', value: memberEmail, monospace: true },
					{ label: 'Role', value: roleLabel },
					{ label: 'Workspace', value: workspaceName }
				]}
			/>
			<PrimaryButton href={membersUrl} label="View workspace members" tone="success" />
		</HuriroEmailLayout>
	)
}

InvitationAcceptedEmail.PreviewProps = {
	inviterName: 'Grace Hopper',
	memberName: 'Ada Lovelace',
	memberEmail: 'ada@example.org',
	workspaceName: 'Acme Engineering',
	role: 'member',
	membersUrl: 'https://app.huriro.dev/settings?section=members',
	appName: 'Huriro',
	baseUrl: 'https://app.huriro.dev'
} satisfies InvitationAcceptedEmailProps

export default InvitationAcceptedEmail
