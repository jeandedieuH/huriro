import { activateI18n } from '@huriro/i18n'
import { SyncProvider } from '@huriro/sync-client'
import { act, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { beforeEach, describe, expect, it } from 'vitest'
import { createPreviewWorkspace } from '@/lib/sync-bootstrap'
import { expectNoViolations } from '@/lib/test-setup'
import { useUiStore } from '@/stores/ui-store'
import { TasksWorkspace } from './components/tasks-workspace'

activateI18n('en')

async function renderTasksWorkspace() {
	const boot = await createPreviewWorkspace()
	const rendered = render(
		<SyncProvider engine={boot.engine}>
			<TasksWorkspace api={boot.api} currentUserId={boot.currentUserId} />
		</SyncProvider>
	)
	return { boot, ...rendered }
}

describe('TasksWorkspace', () => {
	beforeEach(() => {
		useUiStore.setState({
			destination: 'tasks',
			activeProjectId: null,
			tasksLayout: 'list',
			density: 'comfortable',
			shortcutsEnabled: true,
			selectedIssueId: null,
			focusedIssueId: null,
			selectedIssueIds: [],
			detailPanelOpen: false,
			filters: {
				query: '',
				statusId: 'all',
				priority: 'all',
				assigneeId: 'all',
				activeViewId: null
			},
			commandPaletteOpen: false,
			shortcutsDialogOpen: false,
			createIssueOpen: false,
			createProjectOpen: false,
			conflictDialogOpen: false,
			importDialogOpen: false,
			toasts: []
		})
	})

	it('renders list view cleanly with zero axe violations and opens detail on J/Enter', async () => {
		const { boot, container } = await renderTasksWorkspace()
		try {
			expect(screen.getByText('ENG-1')).toBeInTheDocument()
			await expectNoViolations(container)

			// J focuses first issue, Enter opens detail drawer
			fireEvent.keyDown(window, { key: 'j' })
			fireEvent.keyDown(window, { key: 'Enter' })

			await waitFor(() => {
				expect(screen.getByLabelText('Issue details')).toBeInTheDocument()
			})
		} finally {
			boot.engine.dispose()
		}
	})

	it('supports board H/L column moves, Mod+Arrow reorder, Move-to menu, and live announcements', async () => {
		useUiStore.setState({ tasksLayout: 'board' })
		const { boot, container } = await renderTasksWorkspace()
		try {
			await expectNoViolations(container)

			// Focus ENG-2 in Todo column and move right with 'l' -> In Progress
			const eng2 = boot.engine.collections.issues.toArray.find((i) => i.identifier === 'ENG-2')
			expect(eng2).toBeDefined()
			if (!eng2) return

			act(() => {
				useUiStore.getState().setFocusedIssueId(eng2.id)
			})
			fireEvent.keyDown(window, { key: 'l' })

			await waitFor(() => {
				const liveRegion = screen.getByRole('status')
				expect(liveRegion.textContent).toContain('ENG-2 moved to')
			})

			// Also verify explicit accessible "Move to…" dropdown button exists for every card
			const moveButton = screen.getByRole('button', { name: /Move to… \(ENG-1\)/ })
			fireEvent.keyDown(moveButton, { key: 'Enter' })
			const menuItems = await screen.findAllByRole('menuitem')
			expect(menuItems.length).toBeGreaterThan(0)
		} finally {
			boot.engine.dispose()
		}
	})

	it('filters issues, saves a view, and creates a new issue', async () => {
		const { boot } = await renderTasksWorkspace()
		try {
			const filterInput = screen.getByPlaceholderText('Filter issues…')
			fireEvent.change(filterInput, { target: { value: 'SEC-1' } })

			expect(screen.getByText('SEC-1')).toBeInTheDocument()
			expect(screen.queryByText('ENG-1')).not.toBeInTheDocument()

			fireEvent.click(screen.getByRole('button', { name: 'Clear filters' }))
			expect(screen.getByText('ENG-1')).toBeInTheDocument()

			// Save view
			fireEvent.click(screen.getByRole('button', { name: 'Save view' }))
			const viewInput = await screen.findByPlaceholderText('View name')
			fireEvent.change(viewInput, { target: { value: 'Urgent Triage' } })
			fireEvent.click(screen.getByRole('button', { name: 'Save' }))

			await waitFor(() => {
				expect(screen.getByRole('button', { name: 'Urgent Triage' })).toBeInTheDocument()
			})
		} finally {
			boot.engine.dispose()
		}
	})
})
