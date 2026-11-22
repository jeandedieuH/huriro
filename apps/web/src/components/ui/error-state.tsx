import { t } from '@huriro/i18n'
import type { HTMLAttributes, ReactNode } from 'react'
import { cn } from '@/lib/utils'

export interface ErrorStateProps extends HTMLAttributes<HTMLDivElement> {
	title?: string
	message?: string
	action?: ReactNode
}

export function ErrorState({ title, message, action, className, ...props }: ErrorStateProps) {
	return (
		<div
			role="alert"
			className={cn(
				'flex flex-col items-center justify-center gap-2 rounded-lg border border-destructive/30 bg-destructive/5 p-8 text-center',
				className
			)}
			{...props}
		>
			<p className="text-sm font-medium text-destructive">{title ?? t('error.title')}</p>
			{message && <p className="max-w-72 text-xs text-muted-foreground">{message}</p>}
			{action}
		</div>
	)
}
