import { Search, X } from 'lucide-react'
import type { ReactNode } from 'react'

export interface SidebarFilterInputProps {
	readonly value: string
	readonly onChange: (value: string) => void
	readonly placeholder: string
	readonly ariaLabel: string
	readonly clearLabel: string
	readonly inputType?: 'text' | 'search' | undefined
	readonly onEnter?: (() => void) | undefined
	readonly trailingSlot?: ReactNode | undefined
}

/** Compact sidebar filter input with centered search/clear buttons and Escape-to-clear. */
export function SidebarFilterInput({
	value,
	onChange,
	placeholder,
	ariaLabel,
	clearLabel,
	inputType = 'text',
	onEnter,
	trailingSlot
}: SidebarFilterInputProps) {
	return (
		<div className="flex items-center gap-1 px-0.5 pb-1.5">
			<div className="relative min-w-0 flex-1">
				<Search
					className="pointer-events-none absolute top-1/2 left-2.5 size-3.5 -translate-y-1/2 text-sidebar-muted-foreground/80"
					aria-hidden
				/>
				<input
					type={inputType}
					value={value}
					onChange={(ev) => onChange(ev.target.value)}
					onKeyDown={(ev) => {
						if (ev.key === 'Escape' && value) {
							ev.preventDefault()
							onChange('')
						} else if (ev.key === 'Enter' && onEnter) {
							ev.preventDefault()
							onEnter()
						}
					}}
					placeholder={placeholder}
					aria-label={ariaLabel}
					className="h-8 w-full rounded-lg border border-sidebar-border/70 bg-sidebar-icon-well/60 pr-7 pl-8 text-[13px] text-sidebar-foreground outline-none transition-colors placeholder:text-sidebar-muted-foreground/70 hover:bg-sidebar-icon-well focus-visible:border-sidebar-primary/60 focus-visible:bg-sidebar focus-visible:ring-2 focus-visible:ring-sidebar-primary/20"
				/>
				{value ? (
					<button
						type="button"
						aria-label={clearLabel}
						onClick={() => onChange('')}
						className="absolute top-1/2 right-1.5 flex size-5 -translate-y-1/2 items-center justify-center rounded-md text-sidebar-muted-foreground outline-none transition-colors hover:bg-sidebar-border/60 hover:text-sidebar-foreground focus-visible:ring-2 focus-visible:ring-sidebar-primary/60"
					>
						<X className="size-3.5" aria-hidden />
					</button>
				) : null}
			</div>
			{trailingSlot}
		</div>
	)
}
