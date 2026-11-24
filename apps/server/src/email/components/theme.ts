/**
 * Huriro email visual design tokens derived from `packages/design-tokens`
 * (`color.json` & `semantic.json`), translated into email-client-safe hex values
 * with dark-mode overrides for Apple Mail, iOS Mail, and modern webmail clients.
 */

export type EmailTone = 'brand' | 'info' | 'success' | 'warning' | 'danger' | 'neutral'

export interface TonePalette {
	readonly bg: string
	readonly border: string
	readonly text: string
	readonly accent: string
}

export const EMAIL_FONT_SANS =
	'-apple-system, BlinkMacSystemFont, "Inter", "Segoe UI", Roboto, "Helvetica Neue", Arial, sans-serif'

export const EMAIL_FONT_MONO =
	'"JetBrains Mono", "SFMono-Regular", Menlo, Monaco, Consolas, "Liberation Mono", monospace'

export const EMAIL_COLORS = {
	// Brand crimson-rose palette (color.brand.50..700)
	brand50: '#FFF1F3',
	brand100: '#FFE0E6',
	brand200: '#FEC5D1',
	brand500: '#F43F5E',
	brand600: '#D91E48',
	brand700: '#B5143B',

	// Cool neutral surface & ink scale (color.neutral.*)
	canvas: '#F5F6F8',
	card: '#FFFFFF',
	surfaceSubtle: '#F8F9FB',
	surfaceMuted: '#F1F3F6',
	border: '#E4E6EB',
	divider: '#EEEFF3',
	inkPrimary: '#181A20',
	inkSecondary: '#525663',
	inkTertiary: '#7B8090',
	white: '#FFFFFF',

	// Dark mode counterpart tokens
	darkCanvas: '#111216',
	darkCard: '#191B21',
	darkSurfaceSubtle: '#21242C',
	darkBorder: '#2C303A',
	darkInkPrimary: '#F4F5F7',
	darkInkSecondary: '#B3B8C4',
	darkInkTertiary: '#868C9B'
} as const

export const EMAIL_TONES: Record<EmailTone, TonePalette> = {
	brand: {
		bg: '#FFF1F3',
		border: '#FEC5D1',
		text: '#B5143B',
		accent: '#D91E48'
	},
	info: {
		bg: '#EFF6FF',
		border: '#BFDBFE',
		text: '#1D4ED8',
		accent: '#2563EB'
	},
	success: {
		bg: '#ECFDF5',
		border: '#A7F3D0',
		text: '#047857',
		accent: '#059669'
	},
	warning: {
		bg: '#FFFBEB',
		border: '#FDE68A',
		text: '#B45309',
		accent: '#D97706'
	},
	danger: {
		bg: '#FEF2F2',
		border: '#FECACA',
		text: '#B91C1C',
		accent: '#DC2626'
	},
	neutral: {
		bg: '#F4F5F7',
		border: '#E4E6EB',
		text: '#3F4350',
		accent: '#525663'
	}
}

/** Reject unsafe URL schemes (`javascript:`, `data:`, etc.) before rendering `<Button>`/`<Link>`. */
export function toSafeEmailHref(rawUrl: string | undefined, fallback = '#'): string {
	if (!rawUrl) return fallback
	const trimmed = rawUrl.trim()
	if (!trimmed) return fallback
	try {
		const parsed = new URL(trimmed)
		if (parsed.protocol === 'http:' || parsed.protocol === 'https:') {
			return parsed.toString()
		}
		return fallback
	} catch {
		return fallback
	}
}
