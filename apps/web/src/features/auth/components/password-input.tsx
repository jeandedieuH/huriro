import { t } from '@huriro/i18n'
import { Eye, EyeOff } from 'lucide-react'
import { useState } from 'react'
import { Input, type InputProps } from '@/components/ui/input'
import { cn } from '@/lib/utils'
import { evaluatePasswordStrength } from '../schemas'

export interface PasswordInputProps extends Omit<InputProps, 'type'> {
	readonly showStrength?: boolean | undefined
	readonly currentValue?: string | undefined
}

const STRENGTH_BAR_TONES = {
	danger: 'bg-destructive',
	warning: 'bg-(--warning)',
	info: 'bg-(--info)',
	success: 'bg-(--success)'
} as const

const STRENGTH_TEXT_TONES = {
	danger: 'text-destructive',
	warning: 'text-(--warning)',
	info: 'text-(--info)',
	success: 'text-(--success)'
} as const

/**
 * Password field with accessible show/hide toggle and optional strength meter.
 * Paste stays enabled for password managers (WCAG 3.3.8).
 */
export function PasswordInput({
	className,
	showStrength = false,
	currentValue = '',
	...props
}: PasswordInputProps) {
	const [isVisible, setIsVisible] = useState(false)
	const strength = showStrength ? evaluatePasswordStrength(currentValue) : null

	return (
		<div className="flex flex-col gap-1.5">
			<div className="relative flex items-center">
				<Input {...props} type={isVisible ? 'text' : 'password'} className={cn('pe-9', className)} />
				<button
					type="button"
					onClick={() => setIsVisible((prev) => !prev)}
					aria-label={isVisible ? t('auth.password.hide') : t('auth.password.show')}
					aria-pressed={isVisible}
					className="absolute end-1.5 inline-flex size-7 items-center justify-center rounded-sm text-muted-foreground transition-colors hover:bg-accent hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
				>
					{isVisible ? <EyeOff className="size-3.5" aria-hidden /> : <Eye className="size-3.5" aria-hidden />}
				</button>
			</div>

			{strength && currentValue.length > 0 ? (
				<div className="flex items-center justify-between gap-2 pt-0.5">
					<div className="grid flex-1 grid-cols-4 gap-1" aria-hidden="true">
						{[1, 2, 3, 4].map((step) => (
							<span
								key={step}
								className={cn(
									'h-1 rounded-full transition-colors duration-(--motion-duration-fast)',
									strength.score >= step ? STRENGTH_BAR_TONES[strength.tone] : 'bg-muted'
								)}
							/>
						))}
					</div>
					<span className={cn('text-xs font-medium', STRENGTH_TEXT_TONES[strength.tone])}>
						{t(strength.labelKey)}
					</span>
				</div>
			) : null}
		</div>
	)
}
