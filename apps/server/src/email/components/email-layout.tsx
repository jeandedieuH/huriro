import type { CSSProperties, ReactNode } from 'react'
import {
	Body,
	Column,
	Container,
	Head,
	Heading,
	Hr,
	Html,
	Link,
	Preview,
	Row,
	Section,
	Text
} from 'react-email'
import { EMAIL_COLORS, EMAIL_FONT_SANS, EMAIL_TONES, type EmailTone, toSafeEmailHref } from './theme'

export interface HuriroEmailLayoutProps {
	readonly previewText: string
	readonly heading: string
	readonly subtitle?: string | undefined
	readonly eyebrow?: string | undefined
	readonly tone?: EmailTone | undefined
	readonly workspaceName?: string | undefined
	readonly appName?: string | undefined
	readonly baseUrl?: string | undefined
	readonly footerReason?: string | undefined
	readonly preferencesUrl?: string | undefined
	readonly children: ReactNode
}

const DARK_MODE_CSS = `
:root {
	color-scheme: light dark;
	supported-color-schemes: light dark;
}
@media only screen and (max-width: 600px) {
	.email-container {
		width: 100% !important;
		padding: 20px 12px !important;
	}
	.email-card-body {
		padding: 24px 20px !important;
	}
}
@media (prefers-color-scheme: dark) {
	body, .email-canvas {
		background-color: ${EMAIL_COLORS.darkCanvas} !important;
		color: ${EMAIL_COLORS.darkInkPrimary} !important;
	}
	.email-card {
		background-color: ${EMAIL_COLORS.darkCard} !important;
		border-color: ${EMAIL_COLORS.darkBorder} !important;
	}
	.email-surface {
		background-color: ${EMAIL_COLORS.darkSurfaceSubtle} !important;
		border-color: ${EMAIL_COLORS.darkBorder} !important;
	}
	.email-border {
		border-color: ${EMAIL_COLORS.darkBorder} !important;
	}
	.email-heading, .email-text {
		color: ${EMAIL_COLORS.darkInkPrimary} !important;
	}
	.email-muted {
		color: ${EMAIL_COLORS.darkInkSecondary} !important;
	}
	.email-subtle {
		color: ${EMAIL_COLORS.darkInkTertiary} !important;
	}
}
`

const bodyStyle: CSSProperties = {
	backgroundColor: EMAIL_COLORS.canvas,
	color: EMAIL_COLORS.inkPrimary,
	fontFamily: EMAIL_FONT_SANS,
	margin: '0',
	padding: '0',
	WebkitFontSmoothing: 'antialiased'
}

const containerStyle: CSSProperties = {
	maxWidth: '580px',
	margin: '0 auto',
	padding: '32px 16px 40px'
}

const headerSectionStyle: CSSProperties = {
	padding: '0 4px 18px'
}

const brandMarkCellStyle: CSSProperties = {
	width: '32px',
	verticalAlign: 'middle'
}

const brandBadgeStyle: CSSProperties = {
	display: 'inline-block',
	width: '28px',
	height: '28px',
	lineHeight: '28px',
	borderRadius: '8px',
	backgroundColor: EMAIL_COLORS.brand600,
	color: EMAIL_COLORS.white,
	fontSize: '15px',
	fontWeight: 700,
	textAlign: 'center',
	letterSpacing: '-0.02em'
}

const wordmarkStyle: CSSProperties = {
	margin: '0',
	paddingLeft: '8px',
	fontSize: '16px',
	fontWeight: 700,
	color: EMAIL_COLORS.inkPrimary,
	letterSpacing: '-0.02em',
	lineHeight: '28px'
}

const workspacePillStyle: CSSProperties = {
	display: 'inline-block',
	padding: '4px 10px',
	borderRadius: '999px',
	backgroundColor: EMAIL_COLORS.white,
	border: `1px solid ${EMAIL_COLORS.border}`,
	color: EMAIL_COLORS.inkSecondary,
	fontSize: '12px',
	fontWeight: 500,
	lineHeight: '16px'
}

const cardStyle: CSSProperties = {
	backgroundColor: EMAIL_COLORS.card,
	border: `1px solid ${EMAIL_COLORS.border}`,
	borderRadius: '16px',
	overflow: 'hidden',
	boxShadow: '0 2px 10px rgba(17, 24, 39, 0.04)'
}

const cardBodyStyle: CSSProperties = {
	padding: '32px 32px 28px'
}

const eyebrowPillStyle = (tone: EmailTone): CSSProperties => {
	const palette = EMAIL_TONES[tone]
	return {
		display: 'inline-block',
		margin: '0 0 12px',
		padding: '4px 10px',
		borderRadius: '999px',
		backgroundColor: palette.bg,
		border: `1px solid ${palette.border}`,
		color: palette.text,
		fontSize: '11px',
		fontWeight: 600,
		letterSpacing: '0.04em',
		textTransform: 'uppercase',
		lineHeight: '14px'
	}
}

const headingStyle: CSSProperties = {
	margin: '0',
	fontSize: '22px',
	fontWeight: 700,
	lineHeight: '30px',
	letterSpacing: '-0.025em',
	color: EMAIL_COLORS.inkPrimary
}

const subtitleStyle: CSSProperties = {
	margin: '8px 0 0',
	fontSize: '14px',
	lineHeight: '22px',
	color: EMAIL_COLORS.inkSecondary
}

const footerContainerStyle: CSSProperties = {
	padding: '20px 8px 0',
	textAlign: 'center'
}

const footerTextStyle: CSSProperties = {
	margin: '0 0 8px',
	fontSize: '12px',
	lineHeight: '18px',
	color: EMAIL_COLORS.inkTertiary
}

const footerLinkStyle: CSSProperties = {
	color: EMAIL_COLORS.inkSecondary,
	textDecoration: 'underline',
	fontSize: '12px'
}

export function HuriroEmailLayout({
	previewText,
	heading,
	subtitle,
	eyebrow,
	tone = 'brand',
	workspaceName,
	appName = 'Huriro',
	baseUrl,
	footerReason,
	preferencesUrl,
	children
}: HuriroEmailLayoutProps) {
	const accentColor = EMAIL_TONES[tone].accent
	const safeAppUrl = baseUrl ? toSafeEmailHref(baseUrl, '') : ''
	const safePrefsUrl = preferencesUrl ? toSafeEmailHref(preferencesUrl, '') : ''
	const year = new Date().getUTCFullYear()

	return (
		<Html lang="en" dir="ltr">
			<Head>
				<meta name="color-scheme" content="light dark" />
				<meta name="supported-color-schemes" content="light dark" />
				<style>{DARK_MODE_CSS}</style>
			</Head>
			<Preview>{previewText}</Preview>
			<Body style={bodyStyle} className="email-canvas">
				<Container style={containerStyle} className="email-container">
					{/* Top Brand & Workspace Bar */}
					<Section style={headerSectionStyle}>
						<Row>
							<Column style={brandMarkCellStyle}>
								<div style={brandBadgeStyle}>{(appName.trim()[0] ?? 'H').toUpperCase()}</div>
							</Column>
							<Column style={{ verticalAlign: 'middle' }}>
								<Text style={wordmarkStyle} className="email-heading">
									{appName}
								</Text>
							</Column>
							{workspaceName ? (
								<Column align="right" style={{ verticalAlign: 'middle' }}>
									<span style={workspacePillStyle} className="email-surface email-muted">
										{workspaceName}
									</span>
								</Column>
							) : null}
						</Row>
					</Section>

					{/* Primary Elevated Card */}
					<Section style={cardStyle} className="email-card">
						{/* Subtle Top Tone Accent Bar */}
						<div style={{ height: '3px', width: '100%', backgroundColor: accentColor }} />
						<Section style={cardBodyStyle} className="email-card-body">
							{eyebrow ? <Text style={eyebrowPillStyle(tone)}>{eyebrow}</Text> : null}
							<Heading as="h1" style={headingStyle} className="email-heading">
								{heading}
							</Heading>
							{subtitle ? (
								<Text style={subtitleStyle} className="email-muted">
									{subtitle}
								</Text>
							) : null}
							<Hr
								style={{
									borderColor: EMAIL_COLORS.divider,
									borderTopWidth: '1px',
									margin: '22px 0'
								}}
								className="email-border"
							/>
							{children}
						</Section>
					</Section>

					{/* Clean External Footer */}
					<Section style={footerContainerStyle}>
						{footerReason ? (
							<Text style={footerTextStyle} className="email-subtle">
								{footerReason}
							</Text>
						) : null}
						<Text style={footerTextStyle} className="email-subtle">
							{safeAppUrl ? (
								<>
									<Link href={safeAppUrl} style={footerLinkStyle} className="email-muted">
										Open {appName}
									</Link>
									{safePrefsUrl ? ' · ' : ''}
								</>
							) : null}
							{safePrefsUrl ? (
								<Link href={safePrefsUrl} style={footerLinkStyle} className="email-muted">
									Email preferences
								</Link>
							) : null}
						</Text>
						<Text style={{ ...footerTextStyle, marginBottom: '0' }} className="email-subtle">
							© {year} {appName}. Modular workspace platform.
						</Text>
					</Section>
				</Container>
			</Body>
		</Html>
	)
}
