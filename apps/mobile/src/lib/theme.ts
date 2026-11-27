import { darkTheme, lightTheme } from '@huriro/design-tokens/rn-theme'
import { useThemeColor } from 'heroui-native'
import { useCSSVariable, useUniwind } from 'uniwind'
import { resolveAvailabilityColor } from '../stores/availability-store'

export { resolveAvailabilityColor }

export interface HuriroMobileColors {
	readonly background: string
	readonly foreground: string
	readonly surface: string
	readonly surfaceForeground: string
	readonly border: string
	readonly muted: string
	readonly accent: string
	readonly accentForeground: string
	readonly accentSoftForeground: string
	readonly success: string
	readonly warning: string
	readonly warningForeground: string
	readonly danger: string
	readonly dangerForeground: string
	readonly info: string
}

function validColor(resolved: unknown, fallbackColor: string): string {
	return typeof resolved === 'string' && resolved.length > 0 && resolved !== 'invalid'
		? resolved
		: fallbackColor
}

/**
 * Resolve active Huriro semantic colors as hex strings for React Native props that do
 * not accept Tailwind classes (Lucide icon `color`, React Navigation chrome, `TextInput`).
 */
export function useHuriroColors(): HuriroMobileColors {
	const { theme } = useUniwind()
	const isDark = theme === 'dark'
	const fallback = isDark ? darkTheme.colors : lightTheme.colors

	const [
		bg,
		fg,
		surface,
		surfaceFg,
		border,
		muted,
		accent,
		accentFg,
		accentSoftFg,
		success,
		warning,
		warningFg,
		danger,
		dangerFg
	] = useThemeColor([
		'background',
		'foreground',
		'surface',
		'surface-foreground',
		'border',
		'muted',
		'accent',
		'accent-foreground',
		'accent-soft-foreground',
		'success',
		'warning',
		'warning-foreground',
		'danger',
		'danger-foreground'
	])
	const info = useCSSVariable('--color-info')

	return {
		background: validColor(bg, (isDark ? fallback['background'] : fallback['surface-2']) ?? '#ffffff'),
		foreground: validColor(fg, fallback['foreground'] ?? '#1d1f24'),
		surface: validColor(surface, fallback['card'] ?? '#ffffff'),
		surfaceForeground: validColor(surfaceFg, fallback['card-foreground'] ?? '#1d1f24'),
		border: validColor(border, fallback['border'] ?? '#e3e4e8'),
		muted: validColor(muted, fallback['muted-foreground'] ?? '#52555b'),
		accent: validColor(accent, fallback['primary'] ?? '#d91f56'),
		accentForeground: validColor(accentFg, fallback['primary-foreground'] ?? '#fcfcfc'),
		accentSoftForeground: validColor(accentSoftFg, fallback['primary'] ?? '#d91f56'),
		success: validColor(success, fallback['success'] ?? '#25984d'),
		warning: validColor(warning, fallback['warning'] ?? '#dfa11a'),
		warningForeground: validColor(
			warningFg,
			(isDark ? fallback['background'] : fallback['foreground']) ?? '#1d1f24'
		),
		danger: validColor(danger, fallback['destructive'] ?? '#d73431'),
		dangerForeground: validColor(dangerFg, fallback['destructive-foreground'] ?? '#fcfcfc'),
		info: validColor(info, fallback['info'] ?? '#008fd6')
	}
}
