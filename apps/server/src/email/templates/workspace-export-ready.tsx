import { HuriroEmailLayout } from '../components/email-layout'
import { CalloutCard, MetadataTable, Paragraph, PrimaryButton } from '../components/email-primitives'

export interface WorkspaceExportReadyEmailProps {
	readonly recipientName: string
	readonly workspaceName: string
	readonly exportId: string
	readonly byteSize: number
	readonly expiresAtIso?: string | null | undefined
	readonly downloadUrl: string
	readonly manifestSummary: {
		readonly issues?: number | undefined
		readonly docPages?: number | undefined
		readonly chatMessages?: number | undefined
		readonly mailConversations?: number | undefined
	}
	readonly appName?: string | undefined
	readonly baseUrl?: string | undefined
}

function formatBytes(bytes: number): string {
	if (bytes < 1024) return `${bytes} B`
	if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`
	return `${(bytes / (1024 * 1024)).toFixed(2)} MB`
}

export function WorkspaceExportReadyEmail({
	recipientName,
	workspaceName,
	exportId,
	byteSize,
	expiresAtIso,
	downloadUrl,
	manifestSummary,
	appName = 'Huriro',
	baseUrl
}: WorkspaceExportReadyEmailProps) {
	return (
		<HuriroEmailLayout
			previewText={`Your ${workspaceName} workspace export is ready (${formatBytes(byteSize)})`}
			eyebrow="Data governance"
			heading="Workspace export ready"
			subtitle={`Your JSON archive for ${workspaceName} has been generated and is ready to download.`}
			tone="info"
			workspaceName={workspaceName}
			appName={appName}
			baseUrl={baseUrl}
			footerReason={`Sent because you requested a workspace export for ${workspaceName}.`}
		>
			<Paragraph>Hi {recipientName},</Paragraph>
			<Paragraph>
				Your export bundle for <strong>{workspaceName}</strong> completed cleanly. Use the authenticated link
				below to download it before the temporary archive expires.
			</Paragraph>
			<MetadataTable
				rows={[
					{ label: 'Export ID', value: exportId, monospace: true },
					{ label: 'Archive size', value: formatBytes(byteSize), monospace: true },
					{ label: 'Issues included', value: String(manifestSummary.issues ?? 0) },
					{ label: 'Documents included', value: String(manifestSummary.docPages ?? 0) },
					{ label: 'Chat messages', value: String(manifestSummary.chatMessages ?? 0) },
					{ label: 'Mail threads', value: String(manifestSummary.mailConversations ?? 0) },
					...(expiresAtIso ? [{ label: 'Expires at (UTC)', value: expiresAtIso, monospace: true }] : [])
				]}
			/>
			<PrimaryButton href={downloadUrl} label="Download export archive" tone="brand" />
			<CalloutCard tone="info" title="Security reminder">
				Exports contain workspace operational data. Store the downloaded archive securely and share it only
				with authorized personnel.
			</CalloutCard>
		</HuriroEmailLayout>
	)
}

WorkspaceExportReadyEmail.PreviewProps = {
	recipientName: 'Grace Hopper',
	workspaceName: 'Acme Engineering',
	exportId: '0190a0b1-0000-7000-8000-000000000950',
	byteSize: 284_910,
	expiresAtIso: '2026-11-25T15:00:00.000Z',
	downloadUrl: 'https://app.huriro.dev/settings?section=governance',
	manifestSummary: {
		issues: 148,
		docPages: 34,
		chatMessages: 812,
		mailConversations: 19
	},
	appName: 'Huriro',
	baseUrl: 'https://app.huriro.dev'
} satisfies WorkspaceExportReadyEmailProps

export default WorkspaceExportReadyEmail
