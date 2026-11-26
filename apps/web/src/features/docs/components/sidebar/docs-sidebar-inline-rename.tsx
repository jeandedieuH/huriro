import { t } from '@huriro/i18n'
import { useEffect, useRef, useState } from 'react'

export interface DocsSidebarInlineRenameProps {
	readonly initialTitle: string
	readonly onCommit: (title: string) => void
	readonly onCancel: () => void
}

/**
 * In-row title editor. Enter/blur commit, Escape cancels. A `done` latch makes the
 * Enter→unmount→blur sequence commit exactly once.
 */
export function DocsSidebarInlineRename({ initialTitle, onCommit, onCancel }: DocsSidebarInlineRenameProps) {
	const [draft, setDraft] = useState(initialTitle)
	const inputRef = useRef<HTMLInputElement>(null)
	const doneRef = useRef(false)

	// Focus on the next tick: the actions menu that launched the rename is still tearing down its
	// focus trap this frame, and focusing synchronously would be yanked back (blur → premature commit).
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
			maxLength={200}
			aria-label={t('docs.sidebar.rename-label')}
			onChange={(ev) => setDraft(ev.target.value)}
			onBlur={() => finish(true)}
			onKeyDown={(ev) => {
				// Keep tree navigation shortcuts (arrows, F2) from firing while typing.
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
