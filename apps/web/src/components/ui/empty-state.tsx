import { t } from '@huriro/i18n'
import type { HTMLAttributes, ReactNode } from 'react'
import { cn } from '@/lib/utils'

export interface EmptyStateProps extends HTMLAttributes<HTMLDivElement> {
	title?: string
	hint?: string
	action?: ReactNode
}

export function EmptyState({ title, hint, action, className, children, ...props }: EmptyStateProps) {
	return (
		<div
			className={cn(
				'flex flex-col items-center justify-center gap-2 rounded-lg border border-dashed border-border p-8 text-center',
				className
			)}
			{...props}
		>
			<p className="text-sm font-medium text-foreground">{title ?? t('empty.title')}</p>
			<p className="max-w-72 text-xs text-muted-foreground">{hint ?? t('empty.hint')}</p>
			{action}
			{children}
		</div>
	)
}
