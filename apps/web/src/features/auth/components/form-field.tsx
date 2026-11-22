import type { ReactNode } from 'react'

export interface FormFieldProps {
	readonly id: string
	readonly label: string
	readonly hint?: string | undefined
	readonly error?: string | undefined
	readonly action?: ReactNode | undefined
	readonly children: ReactNode
}

/** Labelled field row with accessible error/hint wiring shared across auth & setup forms. */
export function FormField({ id, label, hint, error, action, children }: FormFieldProps) {
	return (
		<div className="flex flex-col gap-1.5">
			<div className="flex items-center justify-between gap-2">
				<label htmlFor={id} className="text-xs font-medium text-foreground">
					{label}
				</label>
				{action ? <div className="text-xs text-muted-foreground">{action}</div> : null}
			</div>
			{children}
			{error ? (
				<p id={`${id}-error`} role="alert" className="text-xs text-destructive">
					{error}
				</p>
			) : hint ? (
				<p id={`${id}-hint`} className="text-xs text-muted-foreground">
					{hint}
				</p>
			) : null}
		</div>
	)
}
