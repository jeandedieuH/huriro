import { useEffect, useRef, useState } from 'react'

export interface SidebarInlineRenameProps {
	readonly initialValue: string
	readonly ariaLabel: string
	readonly maxLength?: number | undefined
	readonly onCommit: (value: string) => void
	readonly onCancel: () => void
}

/**
 * In-row inline rename input. Defers focus to the next tick so an enclosing
 * Radix dropdown teardown never steals focus and triggers a premature blur commit.
 */
export function SidebarInlineRename({
	initialValue,
	ariaLabel,
	maxLength = 120,
	onCommit,
	onCancel
}: SidebarInlineRenameProps) {
	const [draft, setDraft] = useState(initialValue)
	const inputRef = useRef<HTMLInputElement>(null)
	const doneRef = useRef(false)

	useEffect(() => {
		const timer = setTimeout(() => {
			inputRef.current?.focus()
			inputRef.current?.select()
		}, 0)
		return () => clearTimeout(timer)
	}, [])

	function finish(commit: boolean) {
		if (doneRef.current) return
		doneRef.current = true
		if (commit) onCommit(draft)
		else onCancel()
	}

	return (
		<input
			ref={inputRef}
			type="text"
			value={draft}
			maxLength={maxLength}
			aria-label={ariaLabel}
			onChange={(ev) => setDraft(ev.target.value)}
			onBlur={() => finish(true)}
			onKeyDown={(ev) => {
				ev.stopPropagation()
				if (ev.key === 'Enter') {
					ev.preventDefault()
					finish(true)
				} else if (ev.key === 'Escape') {
					ev.preventDefault()
					finish(false)
				}
			}}
			className="mx-0.5 h-7 min-w-0 flex-1 rounded-md border border-sidebar-primary/60 bg-background px-2 text-[13px] text-foreground outline-none ring-2 ring-sidebar-primary/20"
		/>
	)
}
