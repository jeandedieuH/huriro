import { activateI18n } from '@huriro/i18n'
import { SyncProvider } from '@huriro/sync-client'
import { fireEvent, render, screen } from '@testing-library/react'
import { beforeEach, describe, expect, it } from 'vitest'
import { createPreviewWorkspace } from '@/lib/sync-bootstrap'
import { expectNoViolations } from '@/lib/test-setup'
import { WorkspaceProvider } from '@/lib/workspace'
import { useUiStore } from '@/stores/ui-store'
import { HomeView } from './components/home-view'

activateI18n('en')

describe('HomeView', () => {
	beforeEach(() => {
		useUiStore.setState({
			destination: 'home',
			sidebarLevel: 'root',
			tasksPreset: 'all',
			selectedIssueId: null,
			detailPanelOpen: false
		})
	})

	it('renders summary cards, navigates to Tasks on View all, and passes axe', async () => {
		const boot = await createPreviewWorkspace()
		try {
			const { container } = render(
				<SyncProvider engine={boot.engine}>
					<WorkspaceProvider boot={boot}>
						<HomeView />
					</WorkspaceProvider>
				</SyncProvider>
			)

			expect(screen.getByText(/Good (morning|afternoon|evening), Hagen/i)).toBeInTheDocument()
			expect(screen.getByLabelText('Due this week')).toBeInTheDocument()
			expect(screen.getByLabelText('Unread in Inbox')).toBeInTheDocument()
			expect(screen.getByLabelText('Recently updated docs')).toBeInTheDocument()
			expect(screen.getByText('ENG-1')).toBeInTheDocument()
			expect(screen.getByText('Engineering Handbook')).toBeInTheDocument()

			await expectNoViolations(container)

			const viewAllButtons = screen.getAllByRole('button', { name: 'View all' })
			fireEvent.click(viewAllButtons[0] as HTMLElement)
			expect(useUiStore.getState().destination).toBe('tasks')
			expect(useUiStore.getState().sidebarLevel).toBe('feature')
			expect(useUiStore.getState().tasksPreset).toBe('this-week')
		} finally {
			boot.engine.dispose()
		}
	})
})
