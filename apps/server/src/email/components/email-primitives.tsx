import type { CSSProperties, ReactNode } from 'react'
import { Button, Column, Hr, Link, Row, Section, Text } from 'react-email'
import { EMAIL_COLORS, EMAIL_FONT_MONO, EMAIL_TONES, type EmailTone, toSafeEmailHref } from './theme'

export function Paragraph({
	children,
	muted = false
}: {
	readonly children: ReactNode
	readonly muted?: boolean
}) {
	return (
		<Text
			style={{
				margin: '0 0 14px',
				fontSize: '14px',
				lineHeight: '23px',
				color: muted ? EMAIL_COLORS.inkSecondary : EMAIL_COLORS.inkPrimary
			}}
			className={muted ? 'email-muted' : 'email-text'}
		>
			{children}
		</Text>
	)
}

export function PrimaryButton({
	href,
	label,
	tone = 'brand'
}: {
	readonly href: string
	readonly label: string
	readonly tone?: EmailTone | undefined
}) {
	const safeHref = toSafeEmailHref(href)
	const bg = tone === 'brand' ? EMAIL_COLORS.brand600 : EMAIL_TONES[tone].accent
	return (
		<Section style={{ margin: '22px 0' }}>
			<Button
				href={safeHref}
				style={{
					display: 'inline-block',
					backgroundColor: bg,
					color: EMAIL_COLORS.white,
					fontSize: '14px',
					fontWeight: 600,
					lineHeight: '20px',
					textDecoration: 'none',
					padding: '12px 22px',
					borderRadius: '10px',
					textAlign: 'center'
				}}
			>
				{label}
			</Button>
		</Section>
	)
}

export function SecondaryButton({ href, label }: { readonly href: string; readonly label: string }) {
	const safeHref = toSafeEmailHref(href)
	return (
		<Section style={{ margin: '14px 0' }}>
			<Button
				href={safeHref}
				style={{
					display: 'inline-block',
					backgroundColor: EMAIL_COLORS.surfaceSubtle,
					border: `1px solid ${EMAIL_COLORS.border}`,
					color: EMAIL_COLORS.inkPrimary,
					fontSize: '13px',
					fontWeight: 600,
					lineHeight: '18px',
					textDecoration: 'none',
					padding: '10px 18px',
					borderRadius: '10px',
					textAlign: 'center'
				}}
				className="email-surface email-text"
			>
				{label}
			</Button>
		</Section>
	)
}

export function StatusBadge({
	label,
	tone = 'neutral'
}: {
	readonly label: string
	readonly tone?: EmailTone
}) {
	const palette = EMAIL_TONES[tone]
	return (
		<span
			style={{
				display: 'inline-block',
				padding: '3px 9px',
				borderRadius: '999px',
				backgroundColor: palette.bg,
				border: `1px solid ${palette.border}`,
				color: palette.text,
				fontSize: '11px',
				fontWeight: 600,
				lineHeight: '14px'
			}}
		>
			{label}
		</span>
	)
}

export function CalloutCard({
	title,
	children,
	tone = 'neutral'
}: {
	readonly title?: string | undefined
	readonly children: ReactNode
	readonly tone?: EmailTone | undefined
}) {
	const palette = EMAIL_TONES[tone]
	return (
		<Section
			style={{
				backgroundColor: palette.bg,
				border: `1px solid ${palette.border}`,
				borderLeft: `3px solid ${palette.accent}`,
				borderRadius: '10px',
				padding: '14px 16px',
				margin: '18px 0'
			}}
		>
			{title ? (
				<Text
					style={{
						margin: '0 0 4px',
						fontSize: '12px',
						fontWeight: 700,
						color: palette.text,
						letterSpacing: '0.01em'
					}}
				>
					{title}
				</Text>
			) : null}
			<Text
				style={{
					margin: '0',
					fontSize: '13px',
					lineHeight: '20px',
					color: palette.text
				}}
			>
				{children}
			</Text>
		</Section>
	)
}

export interface MetadataRowItem {
	readonly label: string
	readonly value: string
	readonly monospace?: boolean | undefined
}

export function MetadataTable({ rows }: { readonly rows: readonly MetadataRowItem[] }) {
	const tableCardStyle: CSSProperties = {
		backgroundColor: EMAIL_COLORS.surfaceSubtle,
		border: `1px solid ${EMAIL_COLORS.border}`,
		borderRadius: '12px',
		padding: '4px 16px',
		margin: '18px 0'
	}
	return (
		<Section style={tableCardStyle} className="email-surface email-border">
			{rows.map((item, idx) => (
				<Row
					key={`${item.label}:${item.value}`}
					style={{
						borderBottom: idx < rows.length - 1 ? `1px solid ${EMAIL_COLORS.divider}` : undefined,
						padding: '10px 0'
					}}
					className="email-border"
				>
					<Column style={{ width: '38%', verticalAlign: 'top', paddingRight: '12px' }}>
						<Text
							style={{
								margin: '0',
								fontSize: '12px',
								fontWeight: 500,
								lineHeight: '18px',
								color: EMAIL_COLORS.inkTertiary
							}}
							className="email-subtle"
						>
							{item.label}
						</Text>
					</Column>
					<Column align="right" style={{ width: '62%', verticalAlign: 'top' }}>
						<Text
							style={{
								margin: '0',
								fontSize: '13px',
								fontWeight: 600,
								lineHeight: '18px',
								color: EMAIL_COLORS.inkPrimary,
								fontFamily: item.monospace ? EMAIL_FONT_MONO : undefined,
								wordBreak: 'break-word'
							}}
							className="email-text"
						>
							{item.value}
						</Text>
					</Column>
				</Row>
			))}
		</Section>
	)
}

export function CodeBlock({ label, value }: { readonly label: string; readonly value: string }) {
	return (
		<Section
			style={{
				backgroundColor: EMAIL_COLORS.surfaceSubtle,
				border: `1px solid ${EMAIL_COLORS.border}`,
				borderRadius: '10px',
				padding: '14px 16px',
				margin: '16px 0'
			}}
			className="email-surface email-border"
		>
			<Text
				style={{
					margin: '0 0 6px',
					fontSize: '11px',
					fontWeight: 600,
					letterSpacing: '0.04em',
					textTransform: 'uppercase',
					color: EMAIL_COLORS.inkTertiary
				}}
				className="email-subtle"
			>
				{label}
			</Text>
			<Text
				style={{
					margin: '0',
					fontFamily: EMAIL_FONT_MONO,
					fontSize: '13px',
					fontWeight: 600,
					lineHeight: '20px',
					color: EMAIL_COLORS.inkPrimary,
					wordBreak: 'break-all'
				}}
				className="email-text"
			>
				{value}
			</Text>
		</Section>
	)
}

export function FallbackLink({
	url,
	label = 'Or copy and paste this link into your browser:'
}: {
	readonly url: string
	readonly label?: string
}) {
	const safeUrl = toSafeEmailHref(url)
	return (
		<Section style={{ margin: '18px 0 0' }}>
			<Text
				style={{
					margin: '0 0 4px',
					fontSize: '12px',
					lineHeight: '18px',
					color: EMAIL_COLORS.inkTertiary
				}}
				className="email-subtle"
			>
				{label}
			</Text>
			<Text
				style={{
					margin: '0',
					fontSize: '12px',
					lineHeight: '18px',
					wordBreak: 'break-all'
				}}
			>
				<Link href={safeUrl} style={{ color: EMAIL_COLORS.brand600, textDecoration: 'underline' }}>
					{safeUrl}
				</Link>
			</Text>
		</Section>
	)
}

export function EmailDivider() {
	return (
		<Hr
			style={{
				borderColor: EMAIL_COLORS.divider,
				borderTopWidth: '1px',
				margin: '20px 0'
			}}
			className="email-border"
		/>
	)
}

export interface NotificationItemCardProps {
	readonly categoryLabel: string
	readonly tone?: EmailTone | undefined
	readonly title: string
	readonly body?: string | undefined
	readonly timestamp?: string | undefined
}

export function NotificationItemCard({
	categoryLabel,
	tone = 'neutral',
	title,
	body,
	timestamp
}: NotificationItemCardProps) {
	const palette = EMAIL_TONES[tone]
	return (
		<Section
			style={{
				backgroundColor: EMAIL_COLORS.surfaceSubtle,
				border: `1px solid ${EMAIL_COLORS.border}`,
				borderRadius: '10px',
				padding: '12px 14px',
				margin: '0 0 10px'
			}}
			className="email-surface email-border"
		>
			<Row style={{ marginBottom: '6px' }}>
				<Column style={{ verticalAlign: 'middle' }}>
					<span
						style={{
							display: 'inline-block',
							padding: '2px 8px',
							borderRadius: '999px',
							backgroundColor: palette.bg,
							border: `1px solid ${palette.border}`,
							color: palette.text,
							fontSize: '10px',
							fontWeight: 700,
							letterSpacing: '0.03em',
							textTransform: 'uppercase'
						}}
					>
						{categoryLabel}
					</span>
				</Column>
				{timestamp ? (
					<Column align="right" style={{ verticalAlign: 'middle' }}>
						<Text
							style={{
								margin: '0',
								fontSize: '11px',
								color: EMAIL_COLORS.inkTertiary
							}}
							className="email-subtle"
						>
							{timestamp}
						</Text>
					</Column>
				) : null}
			</Row>
			<Text
				style={{
					margin: '0',
					fontSize: '13px',
					fontWeight: 600,
					lineHeight: '19px',
					color: EMAIL_COLORS.inkPrimary
				}}
				className="email-text"
			>
				{title}
			</Text>
			{body ? (
				<Text
					style={{
						margin: '4px 0 0',
						fontSize: '12px',
						lineHeight: '18px',
						color: EMAIL_COLORS.inkSecondary
					}}
					className="email-muted"
				>
					{body}
				</Text>
			) : null}
		</Section>
	)
}
