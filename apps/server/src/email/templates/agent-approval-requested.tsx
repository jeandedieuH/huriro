import { HuriroEmailLayout } from '../components/email-layout'
import { CalloutCard, MetadataTable, Paragraph, PrimaryButton } from '../components/email-primitives'

export interface AgentApprovalRequestedEmailProps {
	readonly recipientName: string
	readonly workspaceName: string
	readonly agentName: string
	readonly toolName: string
	readonly tier: string
	readonly approvalId: string
	readonly reviewUrl: string
	readonly preferencesUrl: string
	readonly appName?: string | undefined
	readonly baseUrl?: string | undefined
}

export function AgentApprovalRequestedEmail({
	recipientName,
	workspaceName,
	agentName,
	toolName,
	tier,
	approvalId,
	reviewUrl,
	preferencesUrl,
	appName = 'Huriro',
	baseUrl
}: AgentApprovalRequestedEmailProps) {
	return (
		<HuriroEmailLayout
			previewText={`Approval required: ${agentName} requested ${toolName} in ${workspaceName}`}
			eyebrow="Agent governance"
			heading="Human approval required"
			subtitle={`${agentName} paused at a ${tier} action gate and needs your decision before continuing.`}
			tone="warning"
			workspaceName={workspaceName}
			appName={appName}
			baseUrl={baseUrl}
			preferencesUrl={preferencesUrl}
			footerReason={`Sent to workspace approvers in ${workspaceName} for R2 agent tool calls.`}
		>
			<Paragraph>Hi {recipientName},</Paragraph>
			<Paragraph>
				An agent action in <strong>{workspaceName}</strong> is waiting in the approval queue. No side effects
				will execute until an authorized reviewer approves the request.
			</Paragraph>
			<MetadataTable
				rows={[
					{ label: 'Agent', value: agentName },
					{ label: 'Tool', value: toolName, monospace: true },
					{ label: 'Risk tier', value: tier },
					{ label: 'Workspace', value: workspaceName },
					{ label: 'Approval ID', value: approvalId, monospace: true }
				]}
			/>
			<CalloutCard tone="warning" title="Time-sensitive request">
				Pending R2 approvals expire automatically if left undecided. Review the arguments in {appName} before
				approving or denying.
			</CalloutCard>
			<PrimaryButton href={reviewUrl} label="Review & decide" tone="warning" />
		</HuriroEmailLayout>
	)
}

AgentApprovalRequestedEmail.PreviewProps = {
	recipientName: 'Grace Hopper',
	workspaceName: 'Acme Engineering',
	agentName: 'Release Bot',
	toolName: 'mail.send_reply',
	tier: 'R2',
	approvalId: '0190a0b1-0000-7000-8000-000000000901',
	reviewUrl: 'https://app.huriro.dev/settings?section=approvals',
	preferencesUrl: 'https://app.huriro.dev/settings?section=notifications',
	appName: 'Huriro',
	baseUrl: 'https://app.huriro.dev'
} satisfies AgentApprovalRequestedEmailProps

export default AgentApprovalRequestedEmail
