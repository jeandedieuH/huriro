import { Section, Text } from 'react-email'
import { HuriroEmailLayout } from '../components/email-layout'
import { MetadataTable, Paragraph, PrimaryButton } from '../components/email-primitives'
import { EMAIL_COLORS } from '../components/theme'

export interface WelcomeEmailProps {
	readonly recipientName: string
	readonly workspaceName: string
	readonly workspaceSlug: string
	readonly workspaceUrl: string
	readonly appName?: string | undefined
	readonly baseUrl?: string | undefined
}

const PILLARS = [
	{
		title: 'Tasks & Cycles',
		detail: 'Track issues, priorities, and sprint cycles with instant offline-first sync.'
	},
	{
		title: 'Collaborative Docs',
		detail: 'Write specs and meeting notes together in real time with anchored comments.'
	},
	{
		title: 'Chat & Shared Mail',
		detail: 'Coordinate in channels and triage customer conversations from one inbox.'
	}
] as const

export function WelcomeEmail({
	recipientName,
	workspaceName,
	workspaceSlug,
	workspaceUrl,
	appName = 'Huriro',
	baseUrl
}: WelcomeEmailProps) {
	return (
		<HuriroEmailLayout
			previewText={`Your ${workspaceName} workspace is ready on ${appName}`}
			eyebrow="Workspace ready"
			heading={`Welcome to ${appName}`}
			subtitle={`Your ${workspaceName} workspace is provisioned and ready for your team.`}
			tone="brand"
			workspaceName={workspaceName}
			appName={appName}
			baseUrl={baseUrl}
			footerReason={`Sent when your ${workspaceName} workspace was created on ${appName}.`}
		>
			<Paragraph>Hi {recipientName},</Paragraph>
			<Paragraph>
				Your new workspace <strong>{workspaceName}</strong> is live. Invite teammates, create your first
				project, and tailor notification preferences anytime from settings.
			</Paragraph>
			<MetadataTable
				rows={[
					{ label: 'Workspace', value: workspaceName },
					{ label: 'Slug', value: `/${workspaceSlug}`, monospace: true }
				]}
			/>
			<Section style={{ margin: '18px 0 8px' }}>
				{PILLARS.map((pillar) => (
					<Section
						key={pillar.title}
						style={{
							backgroundColor: EMAIL_COLORS.surfaceSubtle,
							border: `1px solid ${EMAIL_COLORS.border}`,
							borderRadius: '10px',
							padding: '12px 14px',
							marginBottom: '8px'
						}}
						className="email-surface email-border"
					>
						<Text
							style={{
								margin: '0 0 2px',
								fontSize: '13px',
								fontWeight: 600,
								color: EMAIL_COLORS.inkPrimary
							}}
							className="email-text"
						>
							{pillar.title}
						</Text>
						<Text
							style={{
								margin: '0',
								fontSize: '12px',
								lineHeight: '18px',
								color: EMAIL_COLORS.inkSecondary
							}}
							className="email-muted"
						>
							{pillar.detail}
						</Text>
					</Section>
				))}
			</Section>
			<PrimaryButton href={workspaceUrl} label="Open workspace" tone="brand" />
		</HuriroEmailLayout>
	)
}

WelcomeEmail.PreviewProps = {
	recipientName: 'Grace Hopper',
	workspaceName: 'Acme Engineering',
	workspaceSlug: 'acme-eng',
	workspaceUrl: 'https://app.huriro.dev/',
	appName: 'Huriro',
	baseUrl: 'https://app.huriro.dev'
} satisfies WelcomeEmailProps

export default WelcomeEmail
