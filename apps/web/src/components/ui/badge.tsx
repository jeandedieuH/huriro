import { cva, type VariantProps } from 'class-variance-authority'
import type { HTMLAttributes } from 'react'
import { cn } from '@/lib/utils'

const badgeVariants = cva(
	'inline-flex items-center gap-1 rounded-md border px-2 py-0.5 text-xs font-medium tabular-nums',
	{
		variants: {
			tone: {
				default: 'border-transparent bg-primary text-primary-foreground',
				secondary: 'border-transparent bg-secondary text-secondary-foreground',
				outline: 'border-border text-foreground',
				success: 'border-transparent bg-(--success)/15 text-(--success)',
				warning: 'border-transparent bg-(--warning)/15 text-(--warning)',
				danger: 'border-transparent bg-destructive/15 text-destructive',
				info: 'border-transparent bg-(--info)/15 text-(--info)'
			}
		},
		defaultVariants: { tone: 'default' }
	}
)

export interface BadgeProps extends HTMLAttributes<HTMLSpanElement>, VariantProps<typeof badgeVariants> {}

export function Badge({ className, tone, ...props }: BadgeProps) {
	return <span className={cn(badgeVariants({ tone, className }))} {...props} />
}
