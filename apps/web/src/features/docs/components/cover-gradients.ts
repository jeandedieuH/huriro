import type { DocCoverGradient } from '@huriro/contracts'
import { t } from '@huriro/i18n'

export interface CoverGradientOption {
	readonly id: DocCoverGradient
	readonly label: () => string
	readonly background: string
}

export const COVER_GRADIENTS: readonly CoverGradientOption[] = [
	{
		id: 'sunrise',
		label: () => t('docs.cover.gradient.sunrise'),
		background:
			'radial-gradient(120% 90% at 15% 20%, color-mix(in oklch, var(--warning) 44%, transparent), transparent 60%), linear-gradient(135deg, color-mix(in oklch, var(--warning) 36%, var(--card)), color-mix(in oklch, var(--destructive) 28%, var(--card)))'
	},
	{
		id: 'ocean',
		label: () => t('docs.cover.gradient.ocean'),
		background:
			'radial-gradient(110% 90% at 85% 15%, color-mix(in oklch, var(--info) 46%, transparent), transparent 58%), linear-gradient(135deg, color-mix(in oklch, var(--info) 38%, var(--card)), color-mix(in oklch, var(--primary) 30%, var(--card)))'
	},
	{
		id: 'forest',
		label: () => t('docs.cover.gradient.forest'),
		background:
			'radial-gradient(100% 90% at 20% 80%, color-mix(in oklch, var(--success) 42%, transparent), transparent 58%), linear-gradient(135deg, color-mix(in oklch, var(--success) 34%, var(--card)), color-mix(in oklch, var(--info) 24%, var(--card)))'
	},
	{
		id: 'slate',
		label: () => t('docs.cover.gradient.slate'),
		background:
			'radial-gradient(110% 85% at 80% 20%, color-mix(in oklch, var(--foreground) 10%, transparent), transparent 60%), linear-gradient(135deg, var(--muted), var(--secondary))'
	},
	{
		id: 'plum',
		label: () => t('docs.cover.gradient.plum'),
		background:
			'radial-gradient(115% 90% at 25% 15%, color-mix(in oklch, var(--primary) 42%, transparent), transparent 60%), linear-gradient(135deg, color-mix(in oklch, var(--primary) 34%, var(--card)), color-mix(in oklch, var(--muted) 65%, var(--card)))'
	}
]

export function getCoverGradient(id: string | null | undefined): CoverGradientOption | null {
	if (!id) return null
	return COVER_GRADIENTS.find((g) => g.id === id) ?? null
}
