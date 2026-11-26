/**
 * Global keyboard shortcuts (§17.6) with single-key WCAG 2.1.4 disable toggle
 * and strict editable-target guarding so shortcuts never fire inside inputs.
 */
import { useEffect, useRef } from 'react'
import { type AppDestination, useUiStore } from '@/stores/ui-store'

export interface KeyboardShortcutHandlers {
	readonly orderedIssueIds: readonly string[]
	readonly onMoveColumn?: (issueId: string, direction: -1 | 1) => void
	readonly onReorderWithinColumn?: (issueId: string, direction: -1 | 1) => void
	readonly onClearInputOrModal?: () => void
}

function isEditableElement(target: EventTarget | null): boolean {
	if (!(target instanceof HTMLElement)) return false
	const tag = target.tagName
	if (tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT') return true
	if (target.isContentEditable) return true
	if (target.closest('[contenteditable="true"]')) return true
	if (target.getAttribute('role') === 'textbox') return true
	return false
}

const GO_DESTINATIONS: Record<string, AppDestination> = {
	h: 'home',
	i: 'inbox',
	t: 'tasks',
	d: 'docs',
	c: 'chat',
	s: 'settings'
}

export function useKeyboardShortcuts(handlers: KeyboardShortcutHandlers): void {
	const chordRef = useRef<{ key: string; at: number } | null>(null)

	useEffect(() => {
		function onKeyDown(ev: KeyboardEvent): void {
			const state = useUiStore.getState()
			const mod = ev.metaKey || ev.ctrlKey
			const key = ev.key.toLowerCase()

			// Mod shortcuts always work even inside inputs (§17.6 / WCAG 2.1.4).
			if (mod && key === 'k') {
				ev.preventDefault()
				state.setCommandPaletteOpen(!state.commandPaletteOpen)
				return
			}

			if (mod && key === 'j') {
				ev.preventDefault()
				if (state.selectedIssueId) {
					state.setDetailPanelOpen(!state.detailPanelOpen)
				}
				return
			}

			if (mod && ev.key === '\\') {
				ev.preventDefault()
				state.toggleSidebarCollapsed()
				return
			}

			// Mod+A selects every issue in the current view order (§3.4). Unlike
			// the other Mod chords it must NEVER hijack native text selection, so the
			// editable-target guard applies here.
			if (mod && key === 'a' && !isEditableElement(ev.target)) {
				if (handlers.orderedIssueIds.length > 0) {
					ev.preventDefault()
					state.selectAllIssues(handlers.orderedIssueIds)
				}
				return
			}

			if (mod && (ev.key === 'ArrowUp' || ev.key === 'ArrowDown') && !isEditableElement(ev.target)) {
				const targetId = state.focusedIssueId ?? state.selectedIssueId
				if (targetId && handlers.onReorderWithinColumn) {
					ev.preventDefault()
					handlers.onReorderWithinColumn(targetId, ev.key === 'ArrowUp' ? -1 : 1)
				}
				return
			}

			if (ev.key === 'Escape') {
				if (state.commandPaletteOpen) {
					state.setCommandPaletteOpen(false)
					return
				}
				if (state.shortcutsDialogOpen) {
					state.setShortcutsDialogOpen(false)
					return
				}
				if (state.createIssueOpen) {
					state.setCreateIssueOpen(false)
					return
				}
				if (state.createProjectOpen) {
					state.setCreateProjectOpen(false)
					return
				}
				if (state.createDocOpen) {
					state.setCreateDocOpen(false)
					return
				}
				if (state.docShareOpen) {
					state.setDocShareOpen(false)
					return
				}
				if (state.docImportOpen) {
					state.setDocImportOpen(false)
					return
				}
				if (state.detailPanelOpen) {
					state.setDetailPanelOpen(false)
					return
				}
				if (state.selectedIssueIds.length > 0) {
					state.clearMultiSelect()
					return
				}
				handlers.onClearInputOrModal?.()
				return
			}

			// Single-key shortcuts below must never hijack typing or trigger when disabled (WCAG 2.1.4).
			if (!state.shortcutsEnabled) return
			if (ev.altKey || mod || isEditableElement(ev.target)) return
			if (
				state.commandPaletteOpen ||
				state.createIssueOpen ||
				state.createProjectOpen ||
				state.createDocOpen ||
				state.docShareOpen ||
				state.docImportOpen
			) {
				return
			}

			if (ev.key === '?') {
				ev.preventDefault()
				state.setShortcutsDialogOpen(!state.shortcutsDialogOpen)
				return
			}

			// Two-key `G` + destination chord within 800ms
			const pendingChord = chordRef.current
			if (pendingChord && pendingChord.key === 'g' && Date.now() - pendingChord.at < 800) {
				chordRef.current = null
				const dest = GO_DESTINATIONS[key]
				if (dest) {
					ev.preventDefault()
					state.setDestination(dest)
					return
				}
			}

			if (key === 'g') {
				chordRef.current = { key: 'g', at: Date.now() }
				return
			}
			chordRef.current = null

			if (key === 'c') {
				ev.preventDefault()
				if (state.destination === 'docs') state.setCreateDocOpen(true)
				else {
					// CreateTaskDialog only mounts inside TasksWorkspace; switch destination
					// first so pressing C from Chat/Mail/Home opens the dialog reliably.
					if (state.destination !== 'tasks') state.setDestination('tasks')
					state.setCreateIssueOpen(true)
				}
				return
			}

			const { orderedIssueIds } = handlers
			if (orderedIssueIds.length === 0) return

			if (key === 'j' || key === 'k') {
				ev.preventDefault()
				const currentId = state.focusedIssueId ?? state.selectedIssueId
				const idx = currentId ? orderedIssueIds.indexOf(currentId) : -1
				const nextIdx =
					key === 'j' ? Math.min(orderedIssueIds.length - 1, idx + 1) : Math.max(0, idx <= 0 ? 0 : idx - 1)
				const nextId = orderedIssueIds[nextIdx]
				if (nextId) state.setFocusedIssueId(nextId)
				return
			}

			const activeId = state.focusedIssueId ?? state.selectedIssueId
			if (!activeId) return

			if (ev.key === 'Enter') {
				ev.preventDefault()
				state.selectIssue(activeId, true)
				return
			}

			if (ev.key === ' ') {
				ev.preventDefault()
				state.toggleMultiSelectIssue(activeId)
				return
			}

			if ((key === 'h' || key === 'l') && handlers.onMoveColumn) {
				ev.preventDefault()
				handlers.onMoveColumn(activeId, key === 'l' ? 1 : -1)
			}
		}

		window.addEventListener('keydown', onKeyDown)
		return () => window.removeEventListener('keydown', onKeyDown)
	}, [handlers])
}
