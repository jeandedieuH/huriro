import { HuriroEmailLayout } from '../components/email-layout'
import {
	CalloutCard,
	MetadataTable,
	NotificationItemCard,
	Paragraph,
	PrimaryButton
} from '../components/email-primitives'
import type { EmailTone } from '../components/theme'

export interface DigestNotificationItem {
	readonly kind: string
	readonly title: string
	readonly body?: string | undefined
	readonly createdAt?: string | undefined
}

export interface NotificationDigestEmailProps {
	readonly recipientName: string
	readonly workspaceName: string
	readonly cadence: 'hourly' | 'daily'
	readonly totalUnread: number
	readonly items: readonly DigestNotificationItem[]
	readonly inboxUrl: string
	readonly preferencesUrl: string
	readonly appName?: string | undefined
	readonly baseUrl?: string | undefined
}

function formatCategory(kind: string): { readonly label: string; readonly tone: EmailTone } {
	if (kind.startsWith('issue.')) return { label: 'Tasks', tone: 'info' }
	if (kind.startsWith('doc.')) return { label: 'Docs', tone: 'brand' }
	if (kind.startsWith('chat.')) return { label: 'Chat', tone: 'success' }
	if (kind.startsWith('mail.')) return { label: 'Mail', tone: 'warning' }
	if (kind.startsWith('approval.')) return { label: 'Approval', tone: 'danger' }
	return { label: 'Workspace', tone: 'neutral' }
}

function formatTimestamp(raw?: string): string | undefined {
	if (!raw) return undefined
	const date = new Date(raw)
	if (Number.isNaN(date.getTime())) return undefined
	return `${date.toISOString().slice(11, 16)} UTC`
}

export function NotificationDigestEmail({
	recipientName,
	workspaceName,
	cadence,
	totalUnread,
	items,
	inboxUrl,
	preferencesUrl,
	appName = 'Huriro',
	baseUrl
}: NotificationDigestEmailProps) {
	const visibleItems = items.slice(0, 15)
	const remaining = Math.max(0, totalUnread - visibleItems.length)
	const cadenceLabel = cadence === 'hourly' ? 'Hourly digest' : 'Daily digest'

	return (
		<HuriroEmailLayout
			previewText={`${totalUnread} unread notification${totalUnread === 1 ? '' : 's'} in ${workspaceName}`}
			eyebrow={cadenceLabel}
			heading={`${totalUnread} unread notification${totalUnread === 1 ? '' : 's'}`}
			subtitle={`Catch up on recent activity across ${workspaceName}.`}
			tone="brand"
			workspaceName={workspaceName}
			appName={appName}
			baseUrl={baseUrl}
			preferencesUrl={preferencesUrl}
			footerReason={`Delivered according to your ${cadence} email digest schedule for ${workspaceName}.`}
		>
			<Paragraph>Hi {recipientName},</Paragraph>
			<Paragraph>
				Here is your {cadence} summary of unread updates in <strong>{workspaceName}</strong>:
			</Paragraph>
			<MetadataTable
				rows={[
					{ label: 'Workspace', value: workspaceName },
					{ label: 'Unread updates', value: String(totalUnread) },
					{ label: 'Digest cadence', value: cadence === 'hourly' ? 'Every hour' : 'Daily' }
				]}
			/>
			{visibleItems.map((item) => {
				const cat = formatCategory(item.kind)
				return (
					<NotificationItemCard
						key={`${item.kind}:${item.title}:${item.createdAt}`}
						categoryLabel={cat.label}
						tone={cat.tone}
						title={item.title}
						body={item.body ? item.body.slice(0, 180) : undefined}
						timestamp={formatTimestamp(item.createdAt)}
					/>
				)
			})}
			{remaining > 0 ? (
				<CalloutCard tone="neutral">
					Plus {remaining} additional unread notification{remaining === 1 ? '' : 's'} waiting in your inbox.
				</CalloutCard>
			) : null}
			<PrimaryButton href={inboxUrl} label="Open Inbox" tone="brand" />
		</HuriroEmailLayout>
	)
}

NotificationDigestEmail.PreviewProps = {
	recipientName: 'Ada Lovelace',
	workspaceName: 'Acme Engineering',
	cadence: 'daily',
	totalUnread: 3,
	items: [
		{
			kind: 'issue.assigned',
			title: 'Assigned to ENG-42: Ship email notification pipeline',
			body: 'Please verify Resend, SMTP, and Emailit transports.',
			createdAt: '2026-11-24T13:15:00Z'
		},
		{
			kind: 'chat.mentioned',
			title: 'Grace mentioned you in #platform',
			body: '@ada Ready to review the new React Email templates?',
			createdAt: '2026-11-24T14:05:00Z'
		},
		{
			kind: 'doc.commented',
			title: 'New comment on Architecture RFC',
			body: 'Looks clean — let us run the full verify suite.',
			createdAt: '2026-11-24T14:40:00Z'
		}
	],
	inboxUrl: 'https://app.huriro.dev/inbox',
	preferencesUrl: 'https://app.huriro.dev/settings?section=notifications',
	appName: 'Huriro',
	baseUrl: 'https://app.huriro.dev'
} satisfies NotificationDigestEmailProps

export default NotificationDigestEmail
