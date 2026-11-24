import { HuriroEmailLayout } from '../components/email-layout'
import {
	CalloutCard,
	CodeBlock,
	FallbackLink,
	MetadataTable,
	Paragraph,
	PrimaryButton
} from '../components/email-primitives'

export interface WorkspaceInvitationEmailProps {
	readonly workspaceName: string
	readonly inviterName: string
	readonly role: string
	readonly acceptUrl: string
	readonly inviteToken: string
	readonly expiresAtLabel?: string | undefined
	readonly appName?: string | undefined
	readonly baseUrl?: string | undefined
}

export function WorkspaceInvitationEmail({
	workspaceName,
	inviterName,
	role,
	acceptUrl,
	inviteToken,
	expiresAtLabel = '7 days',
	appName = 'Huriro',
	baseUrl
}: WorkspaceInvitationEmailProps) {
	const roleLabel = role.charAt(0).toUpperCase() + role.slice(1)
	return (
		<HuriroEmailLayout
			previewText={`${inviterName} invited you to join ${workspaceName} on ${appName}`}
			eyebrow="Workspace invitation"
			heading={`Join ${workspaceName}`}
			subtitle={`${inviterName} invited you to collaborate on tasks, docs, chat, and shared mail.`}
			tone="brand"
			workspaceName={workspaceName}
			appName={appName}
			baseUrl={baseUrl}
			footerReason={`You received this invitation because ${inviterName} invited your email address to ${workspaceName}.`}
		>
			<Paragraph>
				You have been invited to join the <strong>{workspaceName}</strong> workspace on {appName}. Accept the
				invitation to access shared projects, documents, and team channels.
			</Paragraph>
			<MetadataTable
				rows={[
					{ label: 'Workspace', value: workspaceName },
					{ label: 'Assigned role', value: roleLabel },
					{ label: 'Invited by', value: inviterName },
					{ label: 'Expires in', value: expiresAtLabel }
				]}
			/>
			<PrimaryButton href={acceptUrl} label={`Accept invitation to ${workspaceName}`} tone="brand" />
			<CodeBlock label="Or enter this invite code during onboarding" value={inviteToken} />
			<CalloutCard tone="info" title="Sign in with this email address">
				Workspace invitations are bound to the invited email address. Sign in or create an account with this
				email before accepting.
			</CalloutCard>
			<FallbackLink url={acceptUrl} />
		</HuriroEmailLayout>
	)
}

WorkspaceInvitationEmail.PreviewProps = {
	workspaceName: 'Acme Engineering',
	inviterName: 'Grace Hopper',
	role: 'member',
	acceptUrl: 'https://app.huriro.dev/onboarding?invite=sample_invite_token_abc123',
	inviteToken: 'sample_invite_token_abc123',
	expiresAtLabel: '7 days',
	appName: 'Huriro',
	baseUrl: 'https://app.huriro.dev'
} satisfies WorkspaceInvitationEmailProps

export default WorkspaceInvitationEmail
