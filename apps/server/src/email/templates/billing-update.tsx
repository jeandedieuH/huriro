import { HuriroEmailLayout } from '../components/email-layout'
import { CalloutCard, MetadataTable, Paragraph, PrimaryButton } from '../components/email-primitives'
import type { EmailTone } from '../components/theme'

export interface BillingUpdateEmailProps {
	readonly recipientName?: string | undefined
	readonly workspaceName: string
	readonly plan: 'free' | 'pro' | 'enterprise'
	readonly status: 'active' | 'trialing' | 'past_due' | 'canceled' | 'incomplete'
	readonly provider: string
	readonly currency: 'USD' | 'RWF'
	readonly amountCharged: number
	readonly periodEndIso?: string | null | undefined
	readonly billingUrl: string
	readonly appName?: string | undefined
	readonly baseUrl?: string | undefined
}

function formatAmount(currency: 'USD' | 'RWF', amount: number): string {
	if (currency === 'USD') {
		return `$${(amount / 100).toFixed(2)} USD`
	}
	return `${amount.toLocaleString('en-US')} RWF`
}

function resolveBillingCopy(
	status: BillingUpdateEmailProps['status'],
	plan: string,
	workspaceName: string
): {
	readonly eyebrow: string
	readonly heading: string
	readonly subtitle: string
	readonly tone: EmailTone
	readonly summary: string
} {
	switch (status) {
		case 'active':
		case 'trialing':
			return {
				eyebrow: 'Subscription active',
				heading: `${workspaceName} is on ${plan.toUpperCase()}`,
				subtitle: 'Your workspace subscription and limits are up to date.',
				tone: 'success',
				summary: 'Your payment succeeded and workspace entitlements are active.'
			}
		case 'past_due':
			return {
				eyebrow: 'Payment attention needed',
				heading: `Action needed for ${workspaceName} billing`,
				subtitle: 'A subscription renewal payment could not be completed.',
				tone: 'danger',
				summary: 'Please update your payment method or complete renewal in web billing to avoid interruption.'
			}
		case 'canceled':
			return {
				eyebrow: 'Subscription canceled',
				heading: `${workspaceName} moved to Free plan`,
				subtitle: 'Your paid subscription was canceled.',
				tone: 'warning',
				summary: 'Your workspace data remains intact under Free tier limits. You can resubscribe anytime.'
			}
		default:
			return {
				eyebrow: 'Billing update',
				heading: `Billing status updated for ${workspaceName}`,
				subtitle: 'A billing event was recorded for your workspace.',
				tone: 'info',
				summary: 'Open web billing settings to review your invoice status and subscription details.'
			}
	}
}

export function BillingUpdateEmail({
	recipientName,
	workspaceName,
	plan,
	status,
	provider,
	currency,
	amountCharged,
	periodEndIso,
	billingUrl,
	appName = 'Huriro',
	baseUrl
}: BillingUpdateEmailProps) {
	const copy = resolveBillingCopy(status, plan, workspaceName)
	const greeting = recipientName?.trim() ? `Hi ${recipientName.trim()},` : 'Hi there,'
	const providerLabel = provider === 'irembopay' ? 'IremboPay' : provider === 'polar' ? 'Polar' : provider

	return (
		<HuriroEmailLayout
			previewText={`${copy.heading} — ${formatAmount(currency, amountCharged)}`}
			eyebrow={copy.eyebrow}
			heading={copy.heading}
			subtitle={copy.subtitle}
			tone={copy.tone}
			workspaceName={workspaceName}
			appName={appName}
			baseUrl={baseUrl}
			footerReason={`Sent to workspace owners and billing contacts for ${workspaceName}.`}
		>
			<Paragraph>{greeting}</Paragraph>
			<Paragraph>{copy.summary}</Paragraph>
			<MetadataTable
				rows={[
					{ label: 'Workspace', value: workspaceName },
					{ label: 'Plan', value: plan.toUpperCase() },
					{ label: 'Status', value: status.replace('_', ' ') },
					{ label: 'Provider', value: providerLabel },
					{ label: 'Amount', value: formatAmount(currency, amountCharged), monospace: true },
					...(periodEndIso
						? [{ label: 'Current period ends', value: periodEndIso.slice(0, 10), monospace: true }]
						: [])
				]}
			/>
			{status === 'past_due' ? (
				<CalloutCard tone="danger" title="Renew via Web Billing">
					Update your card on Polar or complete your MTN MoMo / Airtel Money renewal in the Huriro web app.
				</CalloutCard>
			) : null}
			<PrimaryButton href={billingUrl} label="Manage workspace billing" tone={copy.tone} />
		</HuriroEmailLayout>
	)
}

BillingUpdateEmail.PreviewProps = {
	recipientName: 'Grace Hopper',
	workspaceName: 'Acme Engineering',
	plan: 'pro',
	status: 'active',
	provider: 'polar',
	currency: 'USD',
	amountCharged: 1000,
	periodEndIso: '2026-12-24T00:00:00Z',
	billingUrl: 'https://app.huriro.dev/settings?section=billing',
	appName: 'Huriro',
	baseUrl: 'https://app.huriro.dev'
} satisfies BillingUpdateEmailProps

export default BillingUpdateEmail
