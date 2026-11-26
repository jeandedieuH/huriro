import { activateI18n } from '@huriro/i18n'
import { SyncProvider } from '@huriro/sync-client'
import { fireEvent, render, screen, waitFor } from '@testing-library/react'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { createPreviewWorkspace } from '@/lib/sync-bootstrap'
import { expectNoViolations } from '@/lib/test-setup'
import { useUiStore } from '@/stores/ui-store'
import { CommandPalette } from './components/command-palette'

activateI18n('en')

describe('CommandPalette', () => {
	beforeEach(() => {
		useUiStore.setState({
			commandPaletteOpen: true,
			destination: 'tasks',
			selectedIssueId: null,
			detailPanelOpen: false
		})
	})

	it('runs 120ms debounced search hits and > action mode with zero axe violations', async () => {
		const boot = await createPreviewWorkspace()
		try {
			const { container } = render(
				<SyncProvider engine={boot.engine}>
					<CommandPalette api={boot.api} />
				</SyncProvider>
			)
			await expectNoViolations(container)

			const input = screen.getByRole('textbox', { name: 'Command palette' })
			fireEvent.change(input, { target: { value: 'SEC-1' } })

			await waitFor(() => {
				expect(screen.getByText(/SEC-1 · Audit FORCE ROW LEVEL SECURITY/)).toBeInTheDocument()
			})

			fireEvent.change(input, { target: { value: '> Toggle dark mode' } })
			expect(screen.getByRole('option', { name: /Toggle dark mode/ })).toBeInTheDocument()

			fireEvent.change(input, { target: { value: '> Force resync workspace' } })
			const resyncOption = screen.getByRole('option', { name: /Force resync workspace/ })
			expect(resyncOption).toBeInTheDocument()
			const resyncSpy = vi.spyOn(boot.engine, 'resyncSnapshot').mockResolvedValue(true)
			fireEvent.click(resyncOption)
			await waitFor(() => {
				expect(resyncSpy).toHaveBeenCalledTimes(1)
			})
		} finally {
			boot.engine.dispose()
		}
	})
})
