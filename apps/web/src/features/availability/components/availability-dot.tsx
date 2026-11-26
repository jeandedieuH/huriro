import type { EffectiveAvailabilityState } from '@huriro/contracts'
import { t } from '@huriro/i18n'
import { cn } from '@/lib/utils'
import {
	AVAILABILITY_STATE_LABEL_ID,
	availabilityStateGlyph,
	availabilityStateTone
} from '../availability-state'

export interface AvailabilityDotProps {
	readonly state: EffectiveAvailabilityState
	readonly size?: 'sm' | 'md' | 'lg'
	readonly className?: string | undefined
	readonly srLabel?: string | undefined
}

const SIZE: Record<NonNullable<AvailabilityDotProps['size']>, string> = {
	sm: 'size-2 text-[7px]',
	md: 'size-2.5 text-[8px]',
	lg: 'size-3.5 text-[10px]'
}

/** Color + glyph + accessible label — never color alone (WCAG 1.4.1). */
export function AvailabilityDot({ state, size = 'sm', className, srLabel }: AvailabilityDotProps) {
	const tone = availabilityStateTone(state)
	const label = srLabel ?? t(AVAILABILITY_STATE_LABEL_ID[state])
	return (
		<span
			role="img"
			aria-label={label}
			data-state={state}
			className={cn(
				'inline-flex shrink-0 items-center justify-center rounded-full font-bold leading-none text-background ring-2 ring-background',
				tone.dot,
				SIZE[size],
				className
			)}
		>
			<span aria-hidden className="translate-y-px">
				{availabilityStateGlyph(state)}
			</span>
		</span>
	)
}
