import { HuriroEmailLayout } from '../components/email-layout'
import { CalloutCard, MetadataTable, Paragraph, PrimaryButton } from '../components/email-primitives'
import type { EmailTone } from '../components/theme'

export interface InstantNotificationEmailProps {
	readonly recipientName: string
	readonly workspaceName: string
	readonly kind: string
	readonly title: string
	readonly body?: string | undefined
	readonly contextLabel?: string | undefined
	readonly actionUrl: string
	readonly preferencesUrl: string
	readonly appName?: string | undefined
	readonly baseUrl?: string | undefined
}

function resolveKindMeta(kind: string): { readonly label: string; readonly tone: EmailTone } {
	switch (kind) {
		case 'issue.assigned':
			return { label: 'Issue assigned', tone: 'info' }
		case 'issue.mentioned':
			return { label: 'Issue mention', tone: 'brand' }
		case 'doc.mentioned':
			return { label: 'Document mention', tone: 'brand' }
		case 'chat.mentioned':
			return { label: 'Chat mention', tone: 'brand' }
		case 'chat.dm':
			return { label: 'Direct message', tone: 'success' }
		case 'mail.assigned':
			return { label: 'Mail assigned', tone: 'warning' }
		case 'mail.mentioned':
			return { label: 'Mail mention', tone: 'warning' }
		case 'project.access_granted':
		case 'doc.access_granted':
		case 'channel.access_granted':
			return { label: 'Access granted', tone: 'info' }
		default:
			return { label: 'Notification', tone: 'neutral' }
	}
}

export function InstantNotificationEmail({
	recipientName,
	workspaceName,
	kind,
	title,
	body,
	contextLabel,
	actionUrl,
	preferencesUrl,
	appName = 'Huriro',
	baseUrl
}: InstantNotificationEmailProps) {
	const meta = resolveKindMeta(kind)
	const rows = [
		{ label: 'Workspace', value: workspaceName },
		{ label: 'Category', value: meta.label },
		...(contextLabel ? [{ label: 'Reference', value: contextLabel }] : [])
	]

	return (
		<HuriroEmailLayout
			previewText={`${title} — ${workspaceName}`}
			eyebrow={meta.label}
			heading={title}
			subtitle={`New activity requiring your attention in ${workspaceName}.`}
			tone={meta.tone}
			workspaceName={workspaceName}
			appName={appName}
			baseUrl={baseUrl}
			preferencesUrl={preferencesUrl}
			footerReason={`Instant email alert for ${workspaceName}. You can pause instant emails or adjust quiet hours anytime.`}
		>
			<Paragraph>Hi {recipientName},</Paragraph>
			{body?.trim() ? (
				<CalloutCard tone="neutral" title="Message preview">
					{body.trim().slice(0, 480)}
				</CalloutCard>
			) : (
				<Paragraph muted>Open {appName} to review the full context and respond.</Paragraph>
			)}
			<MetadataTable rows={rows} />
			<PrimaryButton href={actionUrl} label={`Open in ${appName}`} tone={meta.tone} />
		</HuriroEmailLayout>
	)
}

InstantNotificationEmail.PreviewProps = {
	recipientName: 'Ada Lovelace',
	workspaceName: 'Acme Engineering',
	kind: 'issue.mentioned',
	title: 'Mentioned on ENG-42: Ship email notification pipeline',
	body: '@ada Can you double-check the Resend and Emailit retry behavior?',
	contextLabel: 'ENG-42',
	actionUrl: 'https://app.huriro.dev/tasks',
	preferencesUrl: 'https://app.huriro.dev/settings?section=notifications',
	appName: 'Huriro',
	baseUrl: 'https://app.huriro.dev'
} satisfies InstantNotificationEmailProps

export default InstantNotificationEmail
