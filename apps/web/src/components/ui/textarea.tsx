import type { TextareaHTMLAttributes } from 'react'
import { cn } from '@/lib/utils'

export interface TextareaProps extends TextareaHTMLAttributes<HTMLTextAreaElement> {
	invalid?: boolean
}

export function Textarea({ className, invalid, ...props }: TextareaProps) {
	return (
		<textarea
			aria-invalid={invalid || undefined}
			className={cn(
				'flex min-h-20 w-full rounded-md border border-input bg-transparent px-3 py-2 text-sm shadow-(--shadow-1) transition-colors duration-(--motion-duration-fast)',
				'placeholder:text-muted-foreground focus-visible:border-ring disabled:cursor-not-allowed disabled:opacity-50',
				'aria-invalid:border-destructive aria-invalid:focus-visible:border-destructive',
				className
			)}
			{...props}
		/>
	)
}
