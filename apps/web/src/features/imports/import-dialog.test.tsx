import { activateI18n } from '@huriro/i18n'
import { SyncProvider } from '@huriro/sync-client'
import { fireEvent, render, screen, waitFor } from '@testing-library/react'
import { beforeEach, describe, expect, it } from 'vitest'
import { createPreviewWorkspace } from '@/lib/sync-bootstrap'
import { expectNoViolations } from '@/lib/test-setup'
import { useUiStore } from '@/stores/ui-store'
import { ImportDialog } from './components/import-dialog'

activateI18n('en')

describe('ImportDialog', () => {
	beforeEach(() => {
		useUiStore.setState({ importDialogOpen: true, toasts: [] })
	})

	it('previews dry-run counts and executes import with zero axe violations', async () => {
		const boot = await createPreviewWorkspace()
		try {
			const { container } = render(
				<SyncProvider engine={boot.engine}>
					<ImportDialog api={boot.api} />
				</SyncProvider>
			)
			await expectNoViolations(container)

			fireEvent.click(screen.getByRole('button', { name: 'Dry-run preview' }))
			await waitFor(() => {
				expect(screen.getByText(/Ready: 1 issues, 0 comments \(0 skipped\)/)).toBeInTheDocument()
			})

			fireEvent.click(screen.getByRole('button', { name: 'Run import' }))
			await waitFor(() => {
				expect(screen.getByText(/Imported 1 issues and 0 comments/)).toBeInTheDocument()
			})
		} finally {
			boot.engine.dispose()
		}
	})
})
