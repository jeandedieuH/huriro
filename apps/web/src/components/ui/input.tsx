import type { InputHTMLAttributes } from 'react'
import { cn } from '@/lib/utils'

export interface InputProps extends InputHTMLAttributes<HTMLInputElement> {
	invalid?: boolean
}

export function Input({ className, invalid, ...props }: InputProps) {
	return (
		<input
			aria-invalid={invalid || undefined}
			className={cn(
				'flex h-9 w-full rounded-md border border-input bg-transparent px-3 py-1 text-sm shadow-(--shadow-1) transition-colors duration-(--motion-duration-fast)',
				'placeholder:text-muted-foreground focus-visible:border-ring disabled:cursor-not-allowed disabled:opacity-50',
				'aria-invalid:border-destructive aria-invalid:focus-visible:border-destructive',
				className
			)}
			{...props}
		/>
	)
}
